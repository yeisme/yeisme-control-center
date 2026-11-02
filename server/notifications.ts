import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AuthError } from "./auth";
import type { ControlDB } from "./db/client";
import { notificationMuteRules, taskNotifications } from "./db/schema";
import { taskIdentity, taskIdentityOf } from "./task-connections";
import type { TaskSnapshot } from "../src/task-observation";

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
  /** Unsigned half of the task key; see `taskIdentity`. It survives restarts, the signed key may not. */
  task_identity: string;
  state: string;
  revision: string;
  native_state: string;
  error_code: string;
  /** Display-only fields copied from the projection; never the task body. */
  title?: string;
  owner?: string;
  project?: string;
}

/**
 * The failure fact a verified task snapshot yields in one scope. The browser sync and the background observation loop
 * both build their facts here, so the same failure always gets the same fingerprint and therefore the same reminder.
 */
export function failureFact(scopeId: string, task: TaskSnapshot): FailureFact {
  return {
    scope_id: scopeId,
    task_key: task.task_key || "",
    // From the verified snapshot, not the key string a browser proposed.
    task_identity: task.connection_id ? taskIdentity({ scope: scopeId, c: task.connection_id, ref: task.locator.task_ref, family: task.locator.task_family }) : taskIdentityOf(task.task_key || ""),
    state: task.state,
    revision: task.revision || "",
    native_state: task.native_state || "",
    error_code: task.provider_recovery?.error_code || "",
    title: task.title,
    owner: task.locator.owner,
    project: task.locator.project,
  };
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
  category?: string;
  read_at?: string | null;
  target_path?: string | null;
  task_identity?: string;
  recovered_at?: string | null;
}

export interface NotificationSyncResult {
  inserted: string[];
  touched: string[];
  staled: string[];
  recovered: string[];
}

export type MuteRuleKind = "task" | "error_code";
export interface NotificationMuteRule {
  id: string;
  scope_id: string;
  kind: MuteRuleKind;
  owner: string;
  key: string;
  label: string;
  created_at: string;
}

type Row = typeof taskNotifications.$inferSelect;

/** In-app places a server-authored reminder may open. */
const eventTargets = /^\/(projects|creation|reminders|services)(\?|$)/;

/**
 * A server-authored reminder: collaboration events, open-tool operations that need attention and, once the credential
 * lifecycle exists, credential problems. It is written once per recipient, scope and `event`.
 */
export interface ReminderEvent {
  scope: string;
  recipient: string;
  /** Names the event for this recipient and scope; a repeat of it is not written again. */
  event: string;
  category: string;
  title: string;
  /** In-app link the reminder opens: /projects, /creation, /reminders or /services. */
  path: string;
  /** The owner or tool the event concerns; defaults to the control center. */
  owner?: string;
  /** An owner error code or state name worth keeping with the reminder; never owner text. */
  errorCode?: string;
  /** What the owner reports for the subject, shown by the state pill; defaults to "succeeded". */
  taskState?: string;
  nativeState?: string;
  /** What wrote the row: browsers leave it empty and the background observation loop writes "background". */
  sessionId?: string;
  now?: string;
}

function clip(value: string | undefined, max: number) {
  return (value || "").slice(0, max);
}

/**
 * Stable identity of one failure version. Polling the same facts does not change it, and neither does a server
 * restart: it uses the task identity, not the signed task key, whose signature used to change with every process.
 */
export function failureFingerprint(fact: Pick<FailureFact, "scope_id" | "task_identity" | "state" | "revision" | "native_state" | "error_code">) {
  return [
    fact.scope_id,
    fact.task_identity,
    fact.state,
    fact.revision,
    fact.native_state,
    fact.error_code,
  ].join("\u001f");
}

/** How far a reminder has been dealt with. Rows of one failure version always show the furthest state. */
export function handledRank(state: string) {
  return state === "archived" ? 4 : state === "muted" ? 3 : state === "acknowledged" ? 2 : state === "snoozed" ? 1 : 0;
}

/** True when `candidate` should stand for its failure version instead of `current`. */
function prefer(candidate: { state: string; readAt?: string | null }, current: { state: string; readAt?: string | null }) {
  const rank = handledRank(candidate.state) - handledRank(current.state);
  return rank > 0 || (rank === 0 && !!candidate.readAt && !current.readAt);
}

/**
 * The one definition of an unread reminder, shared by the sidebar badge, the bell and the reminders page: not read,
 * not handled (acknowledged, muted, archived), not snoozed and not recovered.
 */
export function countsAsUnread(item: Pick<TaskNotification, "state" | "read_at" | "snoozed_until" | "recovered_at">, now = Date.now()) {
  if (item.read_at || item.recovered_at || item.state !== "unread") return false;
  return !(item.snoozed_until && Date.parse(item.snoozed_until) > now);
}

export function notificationId(sessionId: string, fingerprint: string) {
  return "notification_" + createHash("sha256").update(JSON.stringify([sessionId, fingerprint])).digest("hex");
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
    category: row.category, read_at: row.readAt, target_path: row.targetPath,
    task_identity: row.taskIdentity || taskIdentityOf(row.taskKey), recovered_at: row.recoveredAt,
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
        eq(taskNotifications.subject, subject),
      ))
      .orderBy(desc(taskNotifications.lastSeenAt))
      .all();
    const unique = new Map<string, { row: Row; view: TaskNotification }>();
    for (const row of rows) {
      const key = `${row.category}|${row.failureFingerprint}`;
      const previous = unique.get(key);
      if (!previous || prefer(row, previous.row)) unique.set(key, { row, view: toView(row, now) });
    }
    return [...unique.values()].map((entry) => entry.view);
  }

  /** Unread reminders still shown on the home attention surface (not yet demoted). */
  unreadCount(scopeId: string, sessionId: string, subject: string, now = Date.now()) {
    return this.list(scopeId, sessionId, subject, now).filter((item) => this.actionable(item, now)).length;
  }

  actionable(item: TaskNotification, now = Date.now()) {
    if (item.category && item.category !== "failure") return false;
    if (item.state !== "unread") return false;
    if (item.presence !== "live") return false;
    if (item.recovered_at) return false;
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
    /** Task identities a fresh owner read showed are no longer failing. */
    recovered?: string[];
    now?: string;
  }): NotificationSyncResult {
    const nowIso = input.now || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const seenFacts = new Set<string>();
    const facts = input.observed.filter((fact) => {
      if (!attentionStates.has(fact.state) || !fact.task_key || !fact.task_identity || fact.scope_id !== input.scopeId) return false;
      const fingerprint = failureFingerprint(fact);
      if (seenFacts.has(fingerprint)) return false;
      seenFacts.add(fingerprint);
      return true;
    });
    const present = new Set(input.presentTaskKeys ? input.presentTaskKeys.map(taskIdentityOf) : facts.map((fact) => fact.task_identity));
    const existing = this.db
      .select()
      .from(taskNotifications)
      .where(and(
        eq(taskNotifications.scopeId, input.scopeId),
        eq(taskNotifications.subject, input.subject),
      ))
      .all();
    // Older restarts left several rows per failure version; the furthest-handled one stands for all of them.
    const byFingerprint = new Map<string, Row>();
    for (const row of existing) {
      const current = byFingerprint.get(row.failureFingerprint);
      if (!current || prefer(row, current)) byFingerprint.set(row.failureFingerprint, row);
    }
    const rules = this.muteRuleRows(input.scopeId, input.subject);
    const inserted: string[] = [];
    const touched: string[] = [];
    const seenTasks = new Set<string>();

    for (const fact of facts) {
      seenTasks.add(fact.task_identity);
      const fingerprint = failureFingerprint(fact);
      const current = byFingerprint.get(fingerprint);
      if (current) {
        const priority = priorityFor(current.firstSeenAt, nowMs, current.priority as NotificationPriority);
        this.db.update(taskNotifications).set({
          lastSeenAt: nowIso,
          presence: "live",
          priority,
          // The key's signature may differ after a restart; keep the link current.
          taskKey: clip(fact.task_key, 4096),
          taskIdentity: fact.task_identity,
          recoveredAt: null,
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
      const id = notificationId(input.scopeId + "|" + input.subject, fingerprint);
      // A lasting rule keeps later failure versions quiet: they are recorded, shown as muted and never counted.
      const muted = rules.some((rule) => rule.kind === "task" ? rule.key === fact.task_identity : !!fact.error_code && rule.key === fact.error_code && rule.owner === (fact.owner || ""));
      this.db.insert(taskNotifications).values({
        id,
        scopeId: input.scopeId,
        sessionId: input.sessionId,
        subject: input.subject,
        taskKey: clip(fact.task_key, 4096),
        taskIdentity: fact.task_identity,
        taskRevision: clip(fact.revision, 160),
        failureFingerprint: fingerprint,
        state: muted ? "muted" : "unread",
        mutedAt: muted ? nowIso : null,
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
    const identityOf = (row: Row) => row.taskIdentity || taskIdentityOf(row.taskKey);
    const canMarkAbsent = input.complete !== false && input.presentTaskKeys !== undefined;
    if (canMarkAbsent) for (const row of existing) {
      if (row.category !== "failure" || seenTasks.has(identityOf(row)) || row.presence === "stale") continue;
      if (present.has(identityOf(row))) {
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
    // A task the owner now reports as not failing: its reminders stop counting, and stay listed as recovered.
    const recoveredIdentities = new Set((input.recovered || []).filter((identity) => !seenTasks.has(identity)));
    const recovered: string[] = [];
    for (const row of existing) {
      if (row.category !== "failure" || row.recoveredAt || !recoveredIdentities.has(identityOf(row))) continue;
      this.db.update(taskNotifications).set({ recoveredAt: nowIso }).where(eq(taskNotifications.id, row.id)).run();
      recovered.push(row.id);
    }
    return { inserted, touched, staled, recovered };
  }

  /** Open failure reminders whose task may have recovered: worth one fresh owner read. */
  recoveryCandidates(scopeId: string, subject: string) {
    return this.list(scopeId, "", subject)
      .filter((item) => (!item.category || item.category === "failure") && item.state === "unread" && !item.recovered_at)
      .map((item) => item.task_identity || taskIdentityOf(item.task_key));
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
    if (!row || row.scopeId !== scopeId || row.subject !== subject) {
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
   * Mute a reminder. `fingerprint` mutes this failure version only. `task` and `error_code` also record a lasting
   * rule, so later failure versions of the task, or of the owner's error code, arrive muted instead of reopening.
   */
  mute(id: string, scopeId: string, sessionId: string, subject: string, now = new Date().toISOString(), scope: "fingerprint" | "task" | "error_code" = "fingerprint") {
    const row = this.owned(id, scopeId, sessionId, subject);
    const identity = row.taskIdentity || taskIdentityOf(row.taskKey);
    if (scope === "error_code" && !row.lastErrorCode) throw new AuthError("invalid_request", 400);
    const targets = scope === "error_code"
      ? this.db.select().from(taskNotifications).where(and(
        eq(taskNotifications.scopeId, scopeId),
        eq(taskNotifications.subject, subject),
        eq(taskNotifications.owner, row.owner),
        eq(taskNotifications.lastErrorCode, row.lastErrorCode),
      )).all()
      : scope === "task"
        ? this.db.select().from(taskNotifications).where(and(eq(taskNotifications.scopeId, scopeId), eq(taskNotifications.subject, subject))).all()
          .filter((candidate) => (candidate.taskIdentity || taskIdentityOf(candidate.taskKey)) === identity)
        : [row];
    for (const target of targets) {
      this.db.update(taskNotifications).set({
        state: "muted",
        mutedAt: now,
        reopened: false,
      }).where(eq(taskNotifications.id, target.id)).run();
    }
    let rule: NotificationMuteRule | null = null;
    if (scope !== "fingerprint") {
      const key = scope === "task" ? identity : row.lastErrorCode;
      const existing = this.muteRuleRows(scopeId, subject).find((candidate) => candidate.kind === scope && candidate.key === key && candidate.owner === row.owner);
      if (existing) rule = existing;
      else {
        rule = { id: "mute_" + randomBytes(12).toString("hex"), scope_id: scopeId, kind: scope, owner: row.owner, key, label: clip(scope === "task" ? row.title : row.lastErrorCode, 240), created_at: now };
        this.db.insert(notificationMuteRules).values({ id: rule.id, scopeId, subject, kind: rule.kind, owner: rule.owner, key: rule.key, label: rule.label, createdAt: now }).run();
      }
    }
    return { updated: targets.map((target) => target.id), rule, owner_writes: 0 };
  }

  private muteRuleRows(scopeId: string, subject: string): NotificationMuteRule[] {
    return this.db.select().from(notificationMuteRules)
      .where(and(eq(notificationMuteRules.scopeId, scopeId), eq(notificationMuteRules.subject, subject)))
      .orderBy(desc(notificationMuteRules.createdAt)).all()
      .map((rule) => ({ id: rule.id, scope_id: rule.scopeId, kind: rule.kind as MuteRuleKind, owner: rule.owner, key: rule.key, label: rule.label, created_at: rule.createdAt }));
  }

  /** Lasting mute rules in the given scopes. Rule keys are task identities or error codes, never task bodies. */
  muteRules(scopeIds: string[], subject: string) {
    return scopeIds.flatMap((scopeId) => this.muteRuleRows(scopeId, subject));
  }

  /** Remove a lasting rule. Reminders it already muted stay muted; later failure versions notify again. */
  removeMuteRule(id: string, scopeIds: string[], subject: string) {
    const rule = this.db.select().from(notificationMuteRules).where(eq(notificationMuteRules.id, id)).get();
    if (!rule || rule.subject !== subject || !scopeIds.includes(rule.scopeId)) throw new AuthError("notification_rule_not_found", 404);
    this.db.delete(notificationMuteRules).where(eq(notificationMuteRules.id, id)).run();
    return { removed: id };
  }

  /** The scope a reminder belongs to, for routes that list reminders of several projects at once. */
  scopeOf(id: string, subject: string) {
    const row = this.db.select().from(taskNotifications).where(eq(taskNotifications.id, id)).get();
    if (!row || row.subject !== subject) throw new AuthError("notification_not_found", 404);
    return row.scopeId;
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

  /** Explicit reopen: unread again, including for the badge. The next new failure version may notify again. */
  reopen(id: string, scopeId: string, sessionId: string, subject: string) {
    this.owned(id, scopeId, sessionId, subject);
    this.db.update(taskNotifications).set({
      state: "unread",
      reopened: true,
      acknowledgedAt: null,
      mutedAt: null,
      archivedAt: null,
      readAt: null,
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

  read(id: string, scopeId: string, sessionId: string, subject: string) {
    const current = this.owned(id, scopeId, sessionId, subject);
    if (!current.readAt) this.db.update(taskNotifications).set({ readAt: new Date().toISOString() }).where(eq(taskNotifications.id, id)).run();
    return this.requireView(id);
  }

  /** Server-authored events share the existing reminder ledger. */
  event(input: ReminderEvent) {
    return this.openEvent(input).id;
  }

  /** Like `event`, and says whether this call wrote the row: one event is written once per recipient and scope. */
  openEvent(input: ReminderEvent) {
    if (!eventTargets.test(input.path)) throw new AuthError("invalid_notification_target", 400);
    const now = input.now || new Date().toISOString();
    const key = notificationId(input.recipient, input.scope + "|" + input.event);
    if (this.db.select({ id: taskNotifications.id }).from(taskNotifications).where(eq(taskNotifications.id, key)).get()) return { id: key, created: false };
    this.db.insert(taskNotifications).values({ id: key, scopeId: input.scope, sessionId: input.sessionId ?? "", subject: input.recipient,
      taskKey: "", failureFingerprint: input.event, category: input.category, title: clip(input.title, 240), targetPath: input.path,
      firstSeenAt: now, lastSeenAt: now, project: input.scope, owner: clip(input.owner, 64) || "control-center", taskState: input.taskState || "succeeded",
      nativeState: clip(input.nativeState, 120), lastErrorCode: clip(input.errorCode, 120) }).onConflictDoNothing().run();
    return { id: key, created: true };
  }
}

export function countBySql(db: ControlDB) {
  return db.select({ n: sql<number>`count(*)` }).from(taskNotifications).get()?.n ?? 0;
}
