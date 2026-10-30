import { createHash } from "node:crypto";
import { collectionFingerprint, type AuctraCollectionCoverage, type AuctraCollectionReader } from "./auctra";
import type { ScopeBinding, ServerConfig, Session } from "./contracts";
import type { AuctraCollectionStore } from "./db/auctra-collection-store";

/** One sync reads at most `maxPages` pages within `budgetMs`; whatever is left is reported as partial, never as complete. */
export const collectionSyncLimits = { pageSize: 200, maxPages: 50, budgetMs: 20_000 } as const;

export interface CollectionSyncResult {
  coverage: AuctraCollectionCoverage;
  freshness: "fresh" | "stale" | "unknown";
  observed_at: string;
  /** Where the next sync would continue; null once Auctra's last page was read. */
  cursor: string | null;
  counts: { inserted: number; updated: number; returned: number; total: number };
  pages: number;
  complete: boolean;
  blocker: string | null;
}

/**
 * Reads every page of the scope's Auctra collection into the local index. Auctra sorts records oldest first, so stopping after
 * one page drops exactly the newest screenplays; a run that stops early (page cap, time budget, or a failed page after some
 * succeeded) is recorded as partial so the episode list can say it may be missing some.
 */
export async function syncCollection(
  deps: { reader: Pick<AuctraCollectionReader, "snapshot">; store: AuctraCollectionStore; config: ServerConfig; clock?: () => number },
  scope: ScopeBinding,
  session: Session,
  options: { cursor?: string; updated_after?: string; limit?: number } = {},
): Promise<CollectionSyncResult> {
  const now = deps.clock || Date.now;
  const started = now();
  const limit = options.limit || collectionSyncLimits.pageSize;
  const counts = { inserted: 0, updated: 0, returned: 0, total: 0 };
  const digest = createHash("sha256");
  let cursor = options.cursor;
  let pages = 0;
  let stored = 0;
  let last: Awaited<ReturnType<AuctraCollectionReader["snapshot"]>> | undefined;
  let stop: string | undefined;
  for (;;) {
    if (pages >= collectionSyncLimits.maxPages) { stop = "collection_page_limit"; break; }
    if (pages > 0 && now() - started > collectionSyncLimits.budgetMs) { stop = "collection_time_budget"; break; }
    last = await deps.reader.snapshot(scope.id, scope, session, { ...(cursor ? { cursor } : {}), ...(options.updated_after ? { updated_after: options.updated_after } : {}), limit });
    pages++;
    if (last.coverage !== "complete") { stop = last.blocker || "owner_unavailable"; break; }
    const page = deps.store.upsertSnapshot(scope.id, last);
    stored++;
    counts.inserted += page.inserted;
    counts.updated += page.updated;
    counts.returned += page.returned;
    counts.total = page.total;
    digest.update(JSON.stringify(last.records));
    // An empty page with a cursor would loop forever on a misbehaving owner; treat it as the end.
    if (!last.next_cursor || !last.records.length) { cursor = undefined; break; }
    cursor = last.next_cursor;
  }
  const complete = !stop && !cursor;
  // A first page that failed stored nothing: the previous sync's record still describes the index.
  if (stored > 0) deps.store.saveCursor(scope.id, collectionFingerprint(deps.config, scope), cursor || "", digest.digest("hex"), complete ? "complete" : "partial", stop);
  const failedFirst = stored === 0 && !!last && last.coverage !== "complete";
  return {
    coverage: failedFirst ? last!.coverage : complete ? "complete" : "partial",
    freshness: last?.freshness || "unknown",
    observed_at: last?.observed_at || new Date(now()).toISOString(),
    cursor: cursor || null,
    counts,
    pages,
    complete,
    blocker: stop || null,
  };
}
