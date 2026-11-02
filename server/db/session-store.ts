import { asc, eq, lt, sql } from "drizzle-orm";
import type { Session } from "../contracts";
import type { ControlDB } from "./client";
import { sessions as table } from "./schema";

type Row = typeof table.$inferSelect;

/** How often a session's last-seen time is written while it is in use. */
export const touchEveryMs = 60_000;

const audiences = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

const toRow = (s: Session) => ({
  id: s.id,
  issuer: s.issuer,
  subject: s.subject,
  name: s.name,
  csrf: s.csrf,
  accessToken: s.accessToken,
  accessAudience: JSON.stringify(s.accessAudience || []),
  expires: s.expires,
  personal: s.personal === true,
  lastSeen: s.last_seen ?? null,
  credentialVersion: s.credential_version ?? null,
  epoch: s.epoch ?? 1,
});

const toSession = (r: Row): Session => ({
  id: r.id,
  issuer: r.issuer,
  subject: r.subject,
  name: r.name,
  csrf: r.csrf,
  accessToken: r.accessToken,
  accessAudience: audiences(r.accessAudience),
  expires: r.expires,
  personal: r.personal ? true : undefined,
  last_seen: r.lastSeen ?? undefined,
  credential_version: r.credentialVersion ?? undefined,
  epoch: r.epoch,
});

/**
 * SQLite-backed session registry with a Map-compatible surface so existing
 * call sites (auth flows, tests) keep working while sessions survive restarts.
 */
export class SessionStore {
  constructor(private db: ControlDB) {}

  get(id: string): Session | undefined {
    const row = this.db.select().from(table).where(eq(table.id, id)).get();
    return row ? toSession(row) : undefined;
  }

  set(id: string, value: Session): this {
    const row = toRow(value);
    this.db
      .insert(table)
      .values({ ...row, id, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: table.id, set: row })
      .run();
    return this;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  delete(id: string): boolean {
    this.db.delete(table).where(eq(table.id, id)).run();
    return true;
  }

  get size(): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .get();
    return Number(row?.n || 0);
  }

  *values(): IterableIterator<Session> {
    const rows = this.db.select().from(table).orderBy(asc(table.createdAt)).all();
    for (const row of rows) yield toSession(row);
  }

  keys(): string[] {
    return [...this.values()].map((s) => s.id);
  }

  prune(now = Date.now()): void {
    this.db.delete(table).where(lt(table.expires, now)).run();
  }

  /**
   * Removes personal sessions that have been idle for `idleMs` or longer. A session that idled out still occupies a row
   * until it is removed, so without this one account's forgotten sessions could use up the table for everyone. The rule is the
   * one a request applies (`last_seen + idle <= now`, a missing time counting as 0), so a session removed here is one the next request would have refused.
   */
  pruneIdle(now: number, idleMs: number): void {
    this.db
      .delete(table)
      .where(sql`${table.personal} = 1 and coalesce(${table.lastSeen}, 0) + ${idleMs} <= ${now}`)
      .run();
  }

  /**
   * Keeps at most `keep` sessions of one account by removing the oldest ones (by creation, then insertion order).
   * Returns how many it removed.
   */
  evictOldest(issuer: string, subject: string, keep: number): number {
    const ids = this.db
      .select({ id: table.id })
      .from(table)
      .where(sql`${table.issuer} = ${issuer} and ${table.subject} = ${subject}`)
      .orderBy(asc(table.createdAt), sql`rowid`)
      .all()
      .map((row) => row.id);
    const surplus = ids.slice(0, Math.max(0, ids.length - Math.max(0, keep)));
    for (const id of surplus) this.delete(id);
    return surplus.length;
  }

  /**
   * Records that a session was used at `now`. `get` returns a copy, so a change made to it is lost; this is the write
   * that keeps an active session from idling out. At most one write per `every` ms per session, so a busy page costs one
   * small update a minute; returns whether it wrote.
   */
  touch(id: string, now: number, every = touchEveryMs): boolean {
    const row = this.db.select({ lastSeen: table.lastSeen }).from(table).where(eq(table.id, id)).get();
    if (!row || (row.lastSeen !== null && now - row.lastSeen < every)) return false;
    this.db.update(table).set({ lastSeen: now }).where(eq(table.id, id)).run();
    return true;
  }

  /** The highest epoch any stored session has, or 0 with none. */
  maxEpoch(): number {
    const row = this.db.select({ n: sql<number | null>`max(${table.epoch})` }).from(table).get();
    return Number(row?.n || 0);
  }

  /** Permission bindings changed: every live session moves to a new epoch. */
  bumpAll(): void {
    this.db
      .update(table)
      .set({ epoch: sql`${table.epoch} + 1` })
      .run();
  }

  bumpSubject(issuer: string, subject: string): void {
    this.db
      .update(table)
      .set({ epoch: sql`${table.epoch} + 1` })
      .where(sql`${table.issuer} = ${issuer} and ${table.subject} = ${subject}`)
      .run();
  }
}
