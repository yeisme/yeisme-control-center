import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AuthError } from "./auth";
import type { ControlDB } from "./db/client";
import { taskNotifications } from "./db/schema";

/** Failure facts that open an in-app reminder. Owner state stays read-only. */
export const attentionStates = new Set([
  "failed",
  "partial_failed",
  "blocked",
  "unknown",
]);

export const notificationStates = [
  "unread",
  "acknowledged",
  "muted",
  "snoozed",
  "archived",
] as const;
export type NotificationState = (typeof notificationStates)[number];
export type NotificationPriority = "normal" | "low" | "history";

export const HOUR_MS = 60 * 60 * 1000;
export const DEMOTE_AFTER_MS = 24 * HOUR_MS;
export const HISTORY_AFTER_MS = 7 * 24 * HOUR_MS;

export interface FailureFact {
  scope_id: string;
  task_key: string;
  state: string;
  revision: string;
  native_state: string;
  error_code: string;
  /** Display-only fields copied from the projection; never the task body. */
  title?: string;
  owner?: string;
  project?: string;
}

export interface TaskNotification {
  id: string;
  scope_id: string;
  session_id: string;
  subject: string;
  task_key: string;
  task_revision: string;
  failure_fingerprint: string;
  state: NotificationState;
  priority: NotificationPriority;
  presence: "live" | "stale";
  task_state: string;
  native_state: string;
  title: string;
  owner: string;
  project: string;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  muted_at: string | null;
  archived_at: string | null;
  snoozed_until: string | null;
  last_error_code: string;
  reopened: boolean;
}

export interface NotificationSyncResult {
  inserted: string[];
  touched: string[];
  staled: string[];
}

type Row = typeof taskNotifications.$inferSelect;

function clip(value: string | undefined, max: number) {
  return (value || "").slice(0, max);
}

/** Stable identity of one failure version. Polling the same facts does not change it. */
export function failureFingerprint(fact: Pick<FailureFact, "scope_id" | "task_key" | "state" | "revision" | "native_state" | "error_code">) {
  return [
    fact.scope_id,
    fact.task_key,
    fact.state,
    fact.revision,
    fact.native_state,
    fact.error_code,
  ].join("\u001f");
}

export function notificationId(sessionId: string, fingerprint: string) {
  return `${sessionId}:${fingerprint}`.slice(0, 400);
}

export function priorityFor(firstSeenAt: string, now: number, current: NotificationPriority = "normal"): NotificationPriority {
  const age = now - Date.parse(firstSeenAt);
  if (!Number.isFinite(age)) return current;
  if (age >= HISTORY_AFTER_MS) return "history";
  if (age >= DEMOTE_AFTER_MS) return current === "history" ? "history" : "low";
  return current === "normal" ? "normal" : current;
}

/**
 * A new fingerprint always opens a reminder. Mute, acknowledge, and archive
 * apply only to the fingerprint they were recorded against.
 */
export function opensReminder(fingerprintIsNew: boolean) {
  return fingerprintIsNew;
}

function toView(row: Row, now = Date.now()): TaskNotification {
  const priority = priorityFor(row.firstSeenAt, now, row.priority as NotificationPriority);
  return {
    id: row.id,
    scope_id: row.scopeId,
    session_id: row.sessionId,
    subject: row.subject,
    task_key: row.taskKey,
    task_revision: row.taskRevision,
    failure_fingerprint: row.failureFingerprint,
    state: row.state as NotificationState,
    priority,
    presence: row.presence === "stale" ? "stale" : "live",
    task_state: row.taskState,
    native_state: row.nativeState,
    title: row.title,
    owner: row.owner,
    project: row.project,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    acknowledged_at: row.acknowledgedAt,
    muted_at: row.mutedAt,
    archived_at: row.archivedAt,
    snoozed_until: row.snoozedUntil,
    last_error_code: row.lastErrorCode,
    reopened: row.reopened,
  };
}

/**
 * Control-center reminder ledger. It stores failure fingerprints and reminder
 * state only; it never writes owner tasks and never deletes reminder rows.
 */
export class NotificationStore {
  constructor(private db: ControlDB) {}

  list(scopeId: string, sessionId: string, subject: string, now = Date.now()): TaskNotification[] {
    const rows = this.db
      .select()
      .from(taskNotifications)
      .where(and(
        eq(taskNotifications.scopeId, scopeId),
        eq(taskNotifications.sessionId, sessionId),
        eq(taskNotifications.subject, subject),
      ))
      .orderBy(desc(taskNotifications.lastSeenAt))
      .all();
    return rows.map((row) => toView(row, now));
  }

  /** Unread reminders still shown on the home attention surface (not yet demoted). */
  unreadCount(scopeId: string, sessionId: string, subject: string, now = Date.now()) {
    return this.list(scopeId, sessionId, subject, now).filter((item) => this.actionable(item, now)).length;
  }

  actionable(item: TaskNotification, now = Date.now()) {
    if (item.state !== "unread") return false;
    if (item.presence !== "live") return false;
    if (item.priority !== "normal") return false;
    if (item.snoozed_until && Date.parse(item.snoozed_until) > now) return false;
    return true;
  }

  /**
   * Fold one observation cycle into the ledger.
   * Same fingerprint updates last_seen_at. A new fingerprint inserts one row.
   * Tasks absent from a complete projection keep their reminder and are marked stale.
   * An incomplete page never marks reminders stale.
   */
  sync(input: {
    scopeId: string;
    sessionId: string;
    subject: string;
    observed: FailureFact[];
    /** Every task key present in this projection, including non-failures. */
    presentTaskKeys?: string[];
    /** False while paging is truncated; missing tasks stay live. */
    complete?: boolean;
    now?: string;
  }): NotificationSyncResult {
    const nowIso = input.now || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const seenFacts = new Set<string>();
    const facts = input.observed.filter((fact) => {
      if (!attentionStates.has(fact.state) || !fact.task_key || fact.scope_id !== input.scopeId) return false;
      const fingerprint = failureFingerprint(fact);
      if (seenFacts.has(fingerprint)) return false;
      seenFacts.add(fingerprint);
      return true;
    });
    const present = new Set(input.presentTaskKeys || facts.map((fact) => fact.task_key));
    const existing = this.db
      .select()
      .from(taskNotifications)
      .where(and(
        eq(taskNotifications.scopeId, input.scopeId),
        eq(taskNotifications.sessionId, input.sessionId),
        eq(taskNotifications.subject, input.subject),
      ))
      .all();
    const byFingerprint = new Map(existing.map((row) => [row.failureFingerprint, row]));
    const inserted: string[] = [];
    const touched: string[] = [];
    const seenTasks = new Set<string>();

    for (const fact of facts) {
      seenTasks.add(fact.task_key);
      const fingerprint = failureFingerprint(fact);
      const current = byFingerprint.get(fingerprint);
      if (current) {
        const priority = priorityFor(current.firstSeenAt, nowMs, current.priority as NotificationPriority);
        this.db.update(taskNotifications).set({
          lastSeenAt: nowIso,
          presence: "live",
          priority,
          title: clip(fact.title, 240) || current.title,
          owner: clip(fact.owner, 64) || current.owner,
          project: clip(fact.project, 200) || current.project,
          taskState: fact.state,
          nativeState: clip(fact.native_state, 120),
          lastErrorCode: clip(fact.error_code, 120),
          taskRevision: clip(fact.revision, 160),
        }).where(eq(taskNotifications.id, current.id)).run();
        touched.push(current.id);
        continue;
      }
      if (!opensReminder(true)) continue;
      const id = notificationId(input.sessionId, fingerprint);
      this.db.insert(taskNotifications).values({
        id,
        scopeId: input.scopeId,
        sessionId: input.sessionId,
        subject: input.subject,
        taskKey: clip(fact.task_key, 240),
        taskRevision: clip(fact.revision, 160),
        failureFingerprint: fingerprint,
        state: "unread",
        priority: "normal",
        presence: "live",
        taskState: fact.state,
        nativeState: clip(fact.native_state, 120),
        title: clip(fact.title, 240),
        owner: clip(fact.owner, 64),
        project: clip(fact.project, 200),
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        lastErrorCode: clip(fact.error_code, 120),
        reopened: false,
      }).run();
      inserted.push(id);
    }

    const staled: string[] = [];
    const canMarkAbsent = input.complete !== false && input.presentTaskKeys !== undefined;
    if (canMarkAbsent) for (const row of existing) {
      if (seenTasks.has(row.taskKey) || row.presence === "stale") continue;
      if (present.has(row.taskKey)) {
        // Still projected, but no longer a failure fact. Keep the reminder and
        // stop counting it as live. Do not infer that the owner succeeded.
      }
      const priority = priorityFor(row.firstSeenAt, nowMs, row.priority as NotificationPriority);
      this.db.update(taskNotifications).set({
        presence: "stale",
        priority,
        lastSeenAt: row.lastSeenAt,
      }).where(eq(taskNotifications.id, row.id)).run();
      staled.push(row.id);
    }
    return { inserted, touched, staled };
  }

  /** Age reminders in place. Rows are never deleted. */
  cleanup(scopeId: string, sessionId: string, subject: string, now = new Date().toISOString()) {
    const nowMs = Date.parse(now);
    const rows = this.list(scopeId, sessionId, subject, nowMs);
    let demoted = 0;
    for (const row of rows) {
      const next = priorityFor(row.first_seen_at, nowMs, row.priority);
      if (next === row.priority) continue;
      this.db.update(taskNotifications).set({ priority: next }).where(eq(taskNotifications.id, row.id)).run();
      demoted += 1;
    }
    return { demoted, deleted_tasks: 0, owner_writes: 0 };
  }

  private owned(id: string, scopeId: string, sessionId: string, subject: string) {
    const row = this.db.select().from(taskNotifications).where(eq(taskNotifications.id, id)).get();
    if (!row || row.scopeId !== scopeId || row.sessionId !== sessionId || row.subject !== subject) {
      throw new AuthError("notification_not_found", 404);
    }
    return row;
  }

  acknowledge(id: string, scopeId: string, sessionId: string, subject: string, now = new Date().toISOString()) {
    this.owned(id, scopeId, sessionId, subject);
    this.db.update(taskNotifications).set({
      state: "acknowledged",
      acknowledgedAt: now,
      reopened: false,
    }).where(eq(taskNotifications.id, id)).run();
    return this.requireView(id);
  }

  /**
   * Mute this failure fingerprint. `error_code` mutes current rows that share
   * the code. A later fingerprint still opens a new reminder.
   */
  mute(id: string, scopeId: string, sessionId: string, subject: string, now = new Date().toISOString(), scope: "fingerprint" | "error_code" = "fingerprint") {
    const row = this.owned(id, scopeId, sessionId, subject);
    const targets = scope === "error_code"
      ? this.db.select().from(taskNotifications).where(and(
        eq(taskNotifications.scopeId, scopeId),
        eq(taskNotifications.sessionId, sessionId),
        eq(taskNotifications.subject, subject),
        eq(taskNotifications.lastErrorCode, row.lastErrorCode),
      )).all()
      : [row];
    for (const target of targets) {
      this.db.update(taskNotifications).set({
        state: "muted",
        mutedAt: now,
        reopened: false,
      }).where(eq(taskNotifications.id, target.id)).run();
    }
    return { updated: targets.map((target) => target.id), owner_writes: 0 };
  }

  archive(id: string, scopeId: string, sessionId: string, subject: string, now = new Date().toISOString()) {
    this.owned(id, scopeId, sessionId, subject);
    this.db.update(taskNotifications).set({
      state: "archived",
      archivedAt: now,
      reopened: false,
    }).where(eq(taskNotifications.id, id)).run();
    return this.requireView(id);
  }

  /** Explicit reopen. The next new failure version may notify again. */
  reopen(id: string, scopeId: string, sessionId: string, subject: string) {
    this.owned(id, scopeId, sessionId, subject);
    this.db.update(taskNotifications).set({
      state: "unread",
      reopened: true,
      acknowledgedAt: null,
      mutedAt: null,
      archivedAt: null,
    }).where(eq(taskNotifications.id, id)).run();
    return this.requireView(id);
  }

  bulk(input: {
    scopeId: string;
    sessionId: string;
    subject: string;
    action: "acknowledge" | "archive" | "mute";
    ids?: string[];
    all?: boolean;
    now?: string;
  }) {
    if (input.action !== "acknowledge" && input.action !== "archive" && input.action !== "mute") {
      throw new AuthError("invalid_notification_action", 400);
    }
    const now = input.now || new Date().toISOString();
    const owned = this.db.select().from(taskNotifications).where(and(
      eq(taskNotifications.scopeId, input.scopeId),
      eq(taskNotifications.sessionId, input.sessionId),
      eq(taskNotifications.subject, input.subject),
    )).all();
    const allowed = new Set(owned.map((row) => row.id));
    const ids = input.all ? [...allowed] : (input.ids || []).filter((id) => allowed.has(id));
    if (!input.all && ids.length !== (input.ids || []).length) throw new AuthError("notification_not_found", 404);
    if (!ids.length) return { updated: [] as string[], owner_writes: 0 };
    const patch = input.action === "acknowledge"
      ? { state: "acknowledged", acknowledgedAt: now, reopened: false }
      : input.action === "archive"
        ? { state: "archived", archivedAt: now, reopened: false }
        : { state: "muted", mutedAt: now, reopened: false };
    this.db.update(taskNotifications).set(patch).where(inArray(taskNotifications.id, ids)).run();
    return { updated: ids, owner_writes: 0 };
  }

  private requireView(id: string) {
    const row = this.db.select().from(taskNotifications).where(eq(taskNotifications.id, id)).get();
    if (!row) throw new AuthError("notification_not_found", 404);
    return toView(row);
  }
}

export function countBySql(db: ControlDB) {
  return db.select({ n: sql<number>`count(*)` }).from(taskNotifications).get()?.n ?? 0;
}
