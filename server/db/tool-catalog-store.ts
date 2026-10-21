import { and, eq } from "drizzle-orm";
import type { CatalogChange, CatalogEntryKind, CatalogOwner } from "../../src/shared/tool-catalog";
import type { ControlDB } from "./client";
import { toolCatalogBaselines, toolCatalogEntries } from "./schema";

export const catalogChangeWindowMs = 7 * 24 * 60 * 60 * 1000;

export interface ObservedCatalogEntry {
  id: string;
  digest: string;
}

const entryKey = (scopeId: string, owner: string, kind: string, entryId: string) => `${scopeId}:${owner}:${kind}:${entryId}`;
const baselineKey = (scopeId: string, owner: string, kind: string) => `${scopeId}:${owner}:${kind}`;

/**
 * Change ledger for catalog entries. The first complete read of an owner kind is a baseline and
 * never reports "added"; removals are recorded only from complete reads.
 */
export class ToolCatalogStore {
  constructor(private readonly db: ControlDB) {}

  record(scopeId: string, owner: CatalogOwner, kind: CatalogEntryKind, entries: ObservedCatalogEntry[], at: string): void {
    const baselineId = baselineKey(scopeId, owner, kind);
    const baseline = this.db.select().from(toolCatalogBaselines).where(eq(toolCatalogBaselines.id, baselineId)).get();
    const existing = this.db
      .select()
      .from(toolCatalogEntries)
      .where(and(eq(toolCatalogEntries.scopeId, scopeId), eq(toolCatalogEntries.owner, owner), eq(toolCatalogEntries.kind, kind)))
      .all();
    const byEntry = new Map(existing.map((row) => [row.entryId, row]));
    const seen = new Set<string>();
    this.db.transaction((tx) => {
      if (!baseline) tx.insert(toolCatalogBaselines).values({ id: baselineId, scopeId, owner, kind, establishedAt: at }).run();
      for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        const row = byEntry.get(entry.id);
        if (!row) {
          tx.insert(toolCatalogEntries).values({
            id: entryKey(scopeId, owner, kind, entry.id), scopeId, owner, kind, entryId: entry.id, digest: entry.digest,
            baseline: !baseline, firstSeenAt: at, lastSeenAt: at, changedAt: null, removedAt: null,
          }).run();
        } else {
          const reappeared = row.removedAt !== null;
          const changed = row.digest !== entry.digest;
          tx.update(toolCatalogEntries).set({
            digest: entry.digest,
            lastSeenAt: at,
            removedAt: null,
            ...(reappeared ? { firstSeenAt: at, baseline: false, changedAt: null } : changed ? { changedAt: at } : {}),
          }).where(eq(toolCatalogEntries.id, row.id)).run();
        }
      }
      for (const row of existing)
        if (!seen.has(row.entryId) && row.removedAt === null)
          tx.update(toolCatalogEntries).set({ removedAt: at }).where(eq(toolCatalogEntries.id, row.id)).run();
    });
  }

  changes(scopeId: string, now = Date.now()): CatalogChange[] {
    const since = now - catalogChangeWindowMs;
    const recent = (value: string | null) => value !== null && Date.parse(value) >= since;
    const result: CatalogChange[] = [];
    for (const row of this.db.select().from(toolCatalogEntries).where(eq(toolCatalogEntries.scopeId, scopeId)).all()) {
      const owner = row.owner as CatalogOwner;
      const kind = row.kind as CatalogEntryKind;
      if (row.removedAt !== null) {
        if (recent(row.removedAt)) result.push({ owner, kind, entry_id: row.entryId, change: "removed", at: row.removedAt });
      } else if (!row.baseline && recent(row.firstSeenAt)) result.push({ owner, kind, entry_id: row.entryId, change: "added", at: row.firstSeenAt });
      else if (recent(row.changedAt)) result.push({ owner, kind, entry_id: row.entryId, change: "changed", at: row.changedAt! });
    }
    return result.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  }
}
