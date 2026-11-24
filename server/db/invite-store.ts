import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { ControlDB } from "./client";
import { personalInviteTokens as table } from "./schema";

export const inviteTokenPrefix = "yki_live_";
export const minInviteTtlMs = 5 * 60_000;
export const maxInviteTtlMs = 30 * 24 * 3600_000;
export const defaultInviteTtlMs = 7 * 24 * 3600_000;

export interface PersonalInviteView {
  id: string;
  username: string;
  label: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  state: "pending" | "consumed" | "expired" | "revoked";
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

function toView(row: typeof table.$inferSelect, now = Date.now()): PersonalInviteView {
  let state: PersonalInviteView["state"] = "pending";
  if (row.revokedAt !== null) state = "revoked";
  else if (row.consumedAt !== null) state = "consumed";
  else if (row.expiresAt <= now) state = "expired";
  return {
    id: row.id,
    username: row.username,
    label: row.label,
    created_by: row.createdBy,
    created_at: new Date(row.createdAt).toISOString(),
    expires_at: new Date(row.expiresAt).toISOString(),
    consumed_at: row.consumedAt !== null ? new Date(row.consumedAt).toISOString() : null,
    revoked_at: row.revokedAt !== null ? new Date(row.revokedAt).toISOString() : null,
    state,
  };
}

/**
 * SQLite store for one-time personal invitation tokens. Plaintext tokens exist
 * only in the return value of `issue()` and are never persisted or logged.
 */
export class InviteStore {
  constructor(private db: ControlDB) {}

  issue(input: {
    username: string;
    label?: string;
    createdBy: string;
    ttlMs?: number;
    now?: number;
  }): { invite: PersonalInviteView; token: string } {
    const now = input.now ?? Date.now();
    const ttl = input.ttlMs ?? defaultInviteTtlMs;
    if (!Number.isFinite(ttl) || ttl < minInviteTtlMs || ttl > maxInviteTtlMs) {
      throw new RangeError("invalid_invite_ttl");
    }
    const id = "inv_" + randomBytes(16).toString("hex");
    const token = inviteTokenPrefix + randomBytes(32).toString("base64url");
    const tokenHash = hashInviteToken(token);
    const label = (input.label ?? "").trim().slice(0, 120);
    const expiresAt = Math.round(now + ttl);

    this.db
      .insert(table)
      .values({
        id,
        username: input.username,
        label,
        tokenHash,
        createdBy: input.createdBy,
        createdAt: now,
        expiresAt,
        consumedAt: null,
        revokedAt: null,
      })
      .run();

    const row = this.db.select().from(table).where(eq(table.id, id)).get()!;
    return { invite: toView(row, now), token };
  }

  /**
   * Atomically claims an unconsumed, unrevoked, unexpired token once.
   * Returns the claimed row on exact single-use match, or undefined otherwise.
   */
  claim(rawToken: string, now = Date.now()): PersonalInviteView | undefined {
    const trimmed = rawToken.trim();
    if (!trimmed.startsWith(inviteTokenPrefix) || trimmed.length > 200) return undefined;
    const digest = hashInviteToken(trimmed);
    const candidate = this.db
      .select()
      .from(table)
      .where(
        and(
          eq(table.tokenHash, digest),
          isNull(table.consumedAt),
          isNull(table.revokedAt),
          sql`${table.expiresAt} > ${now}`,
        ),
      )
      .get();
    if (!candidate) return undefined;

    const updated: unknown = this.db
      .update(table)
      .set({ consumedAt: now })
      .where(
        and(
          eq(table.id, candidate.id),
          isNull(table.consumedAt),
          isNull(table.revokedAt),
          sql`${table.expiresAt} > ${now}`,
        ),
      )
      .run();
    if (
      updated &&
      typeof updated === "object" &&
      "changes" in updated &&
      typeof updated.changes === "number" &&
      updated.changes !== 1
    ) {
      return undefined;
    }
    const verify = this.db.select().from(table).where(eq(table.id, candidate.id)).get();
    if (!verify || verify.consumedAt !== now || verify.revokedAt !== null) return undefined;
    return toView(verify, now);
  }

  get(id: string, now = Date.now()): PersonalInviteView | undefined {
    const row = this.db.select().from(table).where(eq(table.id, id)).get();
    return row ? toView(row, now) : undefined;
  }

  isSessionAllowed(id: string): boolean {
    const row = this.db.select().from(table).where(eq(table.id, id)).get();
    return !!row && row.consumedAt !== null && row.revokedAt === null;
  }

  list(username?: string, limit = 100, now = Date.now()): PersonalInviteView[] {
    const clamped = Math.min(200, Math.max(1, limit));
    const rows = username
      ? this.db
          .select()
          .from(table)
          .where(eq(table.username, username))
          .orderBy(desc(table.createdAt))
          .limit(clamped)
          .all()
      : this.db
          .select()
          .from(table)
          .orderBy(desc(table.createdAt))
          .limit(clamped)
          .all();
    return rows.map((row) => toView(row, now));
  }

  revoke(id: string, now = Date.now()): PersonalInviteView | undefined {
    const existing = this.db.select().from(table).where(eq(table.id, id)).get();
    if (!existing) return undefined;
    if (existing.revokedAt === null) {
      this.db.update(table).set({ revokedAt: now }).where(eq(table.id, id)).run();
    }
    return this.get(id, now);
  }

  revokeAllForUser(username: string, now = Date.now()): void {
    this.db
      .update(table)
      .set({ revokedAt: now })
      .where(and(eq(table.username, username), isNull(table.revokedAt)))
      .run();
  }
}
