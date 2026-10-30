import { describe, expect, it, vi } from "vitest";
import { collectionSyncLimits, syncCollection } from "../server/auctra-sync";
import { collectionFingerprint, type AuctraCollectionSnapshot } from "../server/auctra";
import { AuctraCollectionStore } from "../server/db/auctra-collection-store";
import { createMemoryDB } from "../server/db/client";
import { DramaService } from "../server/drama";
import type { AuctraCollectionReader } from "../server/auctra";
import type { ScaenaStoryboardReader } from "../server/scaena-storyboard";
import { config, makeSession, scope, unit } from "./fixtures/drama-fakes";

const credentialed = { ...config, collection: { auctra: { ...config.collection!.auctra!, credential_ref: "/unused/collector.key" } } };

/** Auctra's shape: records oldest first, an offset cursor, and `partial` on every page of a multi-page collection. */
function pagedReader(records = Array.from({ length: 5 }, (_, index) => unit(`ep-${index + 1}`, { updated_at: `2026-10-0${index + 1}T00:00:00.000Z` })), fail?: (page: number) => string | undefined) {
  let page = 0;
  const snapshot = vi.fn(async (scopeId: string, _scope: unknown, _session: unknown, query: { cursor?: string; limit?: number } = {}): Promise<AuctraCollectionSnapshot> => {
    page++;
    const blocker = fail?.(page);
    if (blocker) return { schema_version: "auctra.collection.snapshot.v1", owner: "auctra", scope: scopeId, project_ref: "", observed_at: new Date().toISOString(), coverage: "unavailable", freshness: "unknown", returned: 0, total: 0, records: [], blocker };
    const start = Number(query.cursor || 0);
    const limit = query.limit || 100;
    const slice = records.slice(start, start + limit);
    const next = start + limit < records.length ? String(start + limit) : undefined;
    return { schema_version: "auctra.collection.snapshot.v1", owner: "auctra", scope: scopeId, project_ref: "project:a", observed_at: new Date().toISOString(), coverage: "complete", freshness: "fresh", ...(next ? { next_cursor: next } : {}), returned: slice.length, total: records.length, records: slice };
  });
  return { snapshot };
}

const drama = (store: AuctraCollectionStore) => new DramaService({
  config: credentialed,
  auctra: { creativeFlow: vi.fn() } as unknown as AuctraCollectionReader,
  scaena: { snapshot: vi.fn() } as unknown as ScaenaStoryboardReader,
  store,
});

describe("Auctra collection sync", () => {
  it("reads every page, because Auctra sorts oldest first and one page would drop the newest screenplays", async () => {
    const store = new AuctraCollectionStore(createMemoryDB());
    const reader = pagedReader();
    const result = await syncCollection({ reader, store, config: credentialed }, scope, makeSession(), { limit: 2 });
    expect(reader.snapshot).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ coverage: "complete", complete: true, pages: 3, cursor: null, blocker: null, counts: { inserted: 5, returned: 5, total: 5 } });
    expect(store.episodeUnits(scope.id).map((item) => item.unit_ref)).toEqual(["ep-1", "ep-2", "ep-3", "ep-4", "ep-5"]);
    expect(store.cursor(scope.id, collectionFingerprint(credentialed, scope))).toMatchObject({ coverage: "complete", cursor: "" });
    const { body } = await drama(store).episodes(scope, makeSession(), {});
    expect(body.universe).toMatchObject({ coverage: "complete", complete: true, can_sync: true, total: 5 });
    expect(body.universe.reason).toBeUndefined();
  });

  it("records a sync stopped by the page cap as partial, and the episode list says so", async () => {
    const store = new AuctraCollectionStore(createMemoryDB());
    const records = Array.from({ length: collectionSyncLimits.maxPages + 1 }, (_, index) => unit(`ep-${index + 1}`));
    const result = await syncCollection({ reader: pagedReader(records), store, config: credentialed }, scope, makeSession(), { limit: 1 });
    expect(result).toMatchObject({ coverage: "partial", complete: false, pages: collectionSyncLimits.maxPages, blocker: "collection_page_limit" });
    expect(result.cursor).toBe(String(collectionSyncLimits.maxPages));
    const { body } = await drama(store).episodes(scope, makeSession(), {});
    expect(body.universe).toMatchObject({ coverage: "partial", complete: false, reason: "collection_partial" });
  });

  it("keeps the pages it stored when a later page fails, and reports the failure instead of success", async () => {
    const store = new AuctraCollectionStore(createMemoryDB());
    const result = await syncCollection({ reader: pagedReader(undefined, (page) => page === 2 ? "owner_unavailable" : undefined), store, config: credentialed }, scope, makeSession(), { limit: 2 });
    expect(result).toMatchObject({ coverage: "partial", complete: false, blocker: "owner_unavailable", counts: { returned: 2 } });
    expect(store.episodeUnits(scope.id)).toHaveLength(2);
    expect(store.cursor(scope.id, collectionFingerprint(credentialed, scope))).toMatchObject({ coverage: "partial", reason: "owner_unavailable" });
  });

  it("leaves the last good sync record alone when the first page fails", async () => {
    const store = new AuctraCollectionStore(createMemoryDB());
    await syncCollection({ reader: pagedReader(), store, config: credentialed }, scope, makeSession());
    const result = await syncCollection({ reader: pagedReader(undefined, () => "owner_forbidden"), store, config: credentialed }, scope, makeSession());
    expect(result).toMatchObject({ coverage: "unavailable", complete: false, pages: 1, blocker: "owner_forbidden", counts: { returned: 0 } });
    expect(store.cursor(scope.id, collectionFingerprint(credentialed, scope))).toMatchObject({ coverage: "complete" });
  });

  it("stops on an empty page that still carries a cursor, instead of looping on a misbehaving owner", async () => {
    const store = new AuctraCollectionStore(createMemoryDB());
    const snapshot = vi.fn(async (scopeId: string): Promise<AuctraCollectionSnapshot> => ({ schema_version: "auctra.collection.snapshot.v1", owner: "auctra", scope: scopeId, project_ref: "project:a", observed_at: new Date().toISOString(), coverage: "complete", freshness: "fresh", next_cursor: "7", returned: 0, total: 9, records: [] }));
    const result = await syncCollection({ reader: { snapshot }, store, config: credentialed }, scope, makeSession());
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ complete: true, pages: 1 });
  });

  it("gives up on further pages once the time budget is spent", async () => {
    const store = new AuctraCollectionStore(createMemoryDB());
    let now = 0;
    const reader = pagedReader();
    const slow = { snapshot: vi.fn(async (...args: Parameters<typeof reader.snapshot>) => { now += collectionSyncLimits.budgetMs + 1; return reader.snapshot(...args); }) };
    const result = await syncCollection({ reader: slow, store, config: credentialed, clock: () => now }, scope, makeSession(), { limit: 2 });
    expect(result).toMatchObject({ complete: false, pages: 1, blocker: "collection_time_budget" });
  });
});
