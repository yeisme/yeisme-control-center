import { and, desc, lt, eq, sql } from "drizzle-orm";
import { AuthError } from "../auth";
import type { ControlDB } from "./client";
import { auditEvents } from "./schema";

export const auditActions = [
  "auth.login",
  "auth.logout",
  "admin.user_created",
  "admin.user_revoked",
  "requests.content_read",
  "requests.attachment_read",
  "tasks.artifact_access",
  "media.read",
  "tasks.cancel",
  "provider_runs.create",
  "provider_runs.reconcile",
  "actions.preview",
  "actions.confirm",
  "actions.receipt_read",
  "auctra.collection.sync",
] as const;
export type AuditAction = (typeof auditActions)[number];
export type AuditOutcome =
  | "initiated"
  | "succeeded"
  | "denied"
  | "failed"
  | "unavailable";

export interface AuditContext {
  actor: string;
  sessionId?: string;
  scopeId?: string;
  action: AuditAction;
  owner?: string;
  targetRef?: string;
  purpose?: string;
  /** Redacted by construction: primitive allowlist only, never bodies or tokens. */
  meta?: Record<string, string | number | boolean | null>;
}

export interface AuditRow {
  id: number;
  occurred_at: string;
  actor: string;
  session_id: string | null;
  scope_id: string | null;
  action: string;
  owner: string | null;
  target_ref: string | null;
  purpose: string | null;
  outcome: AuditOutcome;
  error_code: string | null;
  meta: Record<string, string | number | boolean | null> | null;
}

export interface AuditPage {
  rows: AuditRow[];
  next_before: number | null;
}

/**
 * Append-only audit trail with write-ahead semantics: strict paths must call
 * begin() before touching an owner, and a failed write blocks the action.
 */
export class AuditStore {
  constructor(private db: ControlDB) {}

  /** Writes the initiated row. Throws audit_unavailable when the write fails. */
  begin(context: AuditContext): number {
    try {
      this.db
        .insert(auditEvents)
        .values({
          occurredAt: new Date().toISOString(),
          actor: context.actor.slice(0, 320),
          sessionId: context.sessionId?.slice(0, 128) ?? null,
          scopeId: context.scopeId?.slice(0, 128) ?? null,
          action: context.action,
          owner: context.owner?.slice(0, 64) ?? null,
          targetRef: context.targetRef?.slice(0, 512) ?? null,
          purpose: context.purpose?.slice(0, 200) ?? null,
          outcome: "initiated",
          errorCode: null,
          meta: context.meta ? JSON.stringify(context.meta) : null,
        })
        .run();
      // drizzle's raw .get() returns an array row under bun:sqlite but an object under better-sqlite3.
      const [row] = this.db
        .all<{ id: number }>(sql`select last_insert_rowid() as id`);
      if (!row || !Number.isInteger(row.id))
        throw new Error("audit_rowid_missing");
      return row.id;
    } catch (e) {
      throw e instanceof AuthError
        ? e
        : new AuthError("audit_unavailable", 503);
    }
  }

  /**
   * Records the outcome of a begun event. Best-effort: if this write fails the
   * row truthfully stays at "initiated", so failures never mask the action.
   */
  complete(
    eventId: number,
    outcome: Exclude<AuditOutcome, "initiated">,
    errorCode?: string,
  ): void {
    try {
      this.db
        .update(auditEvents)
        .set({
          outcome,
          errorCode: errorCode ? errorCode.slice(0, 160) : null,
        })
        .where(eq(auditEvents.id, eventId))
        .run();
    } catch {
      // The initiated row remains; audit-first ordering already holds.
    }
  }

  /** Single-shot best-effort event for non-blocking paths (auth lifecycle). */
  record(
    context: AuditContext,
    outcome: Exclude<AuditOutcome, "initiated">,
    errorCode?: string,
  ): void {
    try {
      this.db
        .insert(auditEvents)
        .values({
          occurredAt: new Date().toISOString(),
          actor: context.actor.slice(0, 320),
          sessionId: context.sessionId?.slice(0, 128) ?? null,
          scopeId: context.scopeId?.slice(0, 128) ?? null,
          action: context.action,
          owner: context.owner?.slice(0, 64) ?? null,
          targetRef: context.targetRef?.slice(0, 512) ?? null,
          purpose: context.purpose?.slice(0, 200) ?? null,
          outcome,
          errorCode: errorCode ? errorCode.slice(0, 160) : null,
          meta: context.meta ? JSON.stringify(context.meta) : null,
        })
        .run();
    } catch {
      // Best-effort by contract; the guarded action already happened.
    }
  }

  /** Admin read model: newest first, numeric before-cursor pagination. */
  page(options: { before?: number; limit?: number; action?: string }): AuditPage {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const filters = [
      options.before !== undefined
        ? lt(auditEvents.id, options.before)
        : undefined,
      options.action ? eq(auditEvents.action, options.action) : undefined,
    ].filter((v) => v !== undefined);
    const rows = this.db
      .select()
      .from(auditEvents)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditEvents.id))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({
        id: r.id,
        occurred_at: r.occurredAt,
        actor: r.actor,
        session_id: r.sessionId,
        scope_id: r.scopeId,
        action: r.action,
        owner: r.owner,
        target_ref: r.targetRef,
        purpose: r.purpose,
        outcome: r.outcome as AuditOutcome,
        error_code: r.errorCode,
        meta: parseMeta(r.meta),
      })),
      next_before: rows.length > limit ? page[page.length - 1].id : null,
    };
  }
}

const parseMeta = (
  value: string | null,
): Record<string, string | number | boolean | null> | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const out: Record<string, string | number | boolean | null> = {};
    for (const [key, entry] of Object.entries(
      parsed as Record<string, unknown>,
    ))
      if (
        entry === null ||
        ["string", "number", "boolean"].includes(typeof entry)
      )
        out[key] = entry as string | number | boolean | null;
    return out;
  } catch {
    return null;
  }
};
