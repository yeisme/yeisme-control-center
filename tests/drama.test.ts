import { describe, expect, it, vi } from "vitest";
import { DramaService } from "../server/drama";
import { AuctraCollectionStore } from "../server/db/auctra-collection-store";
import { createMemoryDB } from "../server/db/client";
import type { AuctraCollectionReader } from "../server/auctra";
import type { ScaenaStoryboardReader } from "../server/scaena-storyboard";
import { auctraFlow, config, makeSession, scaenaSnapshot, scope, seed, unboundScope, unit } from "./fixtures/drama-fakes";

function setup(options: { delayMs?: number; auctraBlocker?: (call: number) => string | undefined } = {}) {
  const store = new AuctraCollectionStore(createMemoryDB());
  let clock = Date.parse("2026-10-22T10:00:00.000Z");
  let inflight = 0, peak = 0, calls = 0;
  const creativeFlow = vi.fn(async (_scopeId: string, _scope: unknown, _session: unknown, query: { episode_ref?: string } = {}) => {
    calls++;
    inflight++; peak = Math.max(peak, inflight);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    inflight--;
    const blocker = options.auctraBlocker?.(calls);
    return auctraFlow(query.episode_ref || "", ["accepted", "accepted", "accepted", "accepted"], blocker ? { coverage: "unavailable", stages: [], blocker } : {});
  });
  const snapshot = vi.fn(async (_scope: unknown, _session: unknown, query: { episode_ref?: string } = {}) => scaenaSnapshot(query.episode_ref || ""));
  const service = new DramaService({ config, auctra: { creativeFlow } as unknown as AuctraCollectionReader, scaena: { snapshot } as unknown as ScaenaStoryboardReader, store, clock: () => clock });
  return { service, store, creativeFlow, snapshot, advance: (ms: number) => { clock += ms; }, peak: () => peak };
}

describe("drama episode universe", () => {
  it("lists only screenplay units, in natural order, and hides archived ones", async () => {
    const { service, store } = setup();
    seed(store, [unit("ep-10"), unit("ep-2"), unit("ep-1"), unit("ep-3"), unit("hero", { kind: "character_profile" }), unit("outline-1", { kind: "outline" }), { ...unit("rev-1"), record_ref: "review:1", record_kind: "review", kind: "review" }]);
    store.archive(scope.id, "unit:ep-3", String(store.get(scope.id, "unit:ep-3").metadata_revision), "tester");
    const { body } = await service.episodes(scope, makeSession(), { limit: 24, read: "all" });
    expect(body.rows.map((row) => row.episode_ref)).toEqual(["ep-1", "ep-2", "ep-10"]);
    expect(body.universe).toMatchObject({ source: "auctra_collection", bound: true, total: 3 });
    expect(body.rows[0]).toMatchObject({ origin: "collection", title: "Title ep-1", read: "read" });
  });

  it("reports an unbound scope as needs_contract instead of denied, and still serves requested refs", async () => {
    const { service } = setup();
    const { body } = await service.episodes(unboundScope, makeSession(), { extra: ["ep-9"], read: "all" });
    expect(body.universe).toMatchObject({ bound: false, coverage: "needs_contract", reason: "source_not_configured", total: 0 });
    expect(body.rows).toEqual([expect.objectContaining({ episode_ref: "ep-9", origin: "requested" })]);
  });

  it("says so when the collection was never synced rather than claiming zero episodes", async () => {
    const { service } = setup();
    const { body } = await service.episodes(scope, makeSession(), {});
    expect(body.universe).toMatchObject({ bound: true, coverage: "unknown", reason: "collection_not_synced", total: 0 });
    expect(body.rows).toEqual([]);
  });

  it("defers rows beyond the read budget and reads them all on request", async () => {
    const { service, store, creativeFlow } = setup();
    seed(store, Array.from({ length: 12 }, (_, index) => unit(`ep-${index + 1}`)));
    const first = await service.episodes(scope, makeSession(), { limit: 12 });
    expect(first.body.rows.filter((row) => row.read === "deferred")).toHaveLength(4);
    expect(first.body.read_count).toBe(8);
    expect(creativeFlow).toHaveBeenCalledTimes(8);
    const all = await service.episodes(scope, makeSession(), { limit: 12, read: "all" });
    expect(all.body.rows.every((row) => row.flow)).toBe(true);
    expect(all.body.rows.filter((row) => row.read === "cached")).toHaveLength(8);
    expect(creativeFlow).toHaveBeenCalledTimes(12);
  });

  it("pages with an offset and filters by text", async () => {
    const { service, store } = setup();
    seed(store, Array.from({ length: 30 }, (_, index) => unit(`ep-${index + 1}`)));
    const page = await service.episodes(scope, makeSession(), { limit: 10, offset: 10 });
    expect(page.body.rows[0].episode_ref).toBe("ep-11");
    expect(page.next_offset).toBe(20);
    const filtered = await service.episodes(scope, makeSession(), { q: "ep-2", limit: 24 });
    expect(filtered.body.rows.map((row) => row.episode_ref)).toEqual(["ep-2", "ep-20", "ep-21", "ep-22", "ep-23", "ep-24", "ep-25", "ep-26", "ep-27", "ep-28", "ep-29"]);
    expect(filtered.body.total).toBe(11);
  });

  it("never runs more than four episode reads at once", async () => {
    const { service, store, peak } = setup({ delayMs: 5 });
    seed(store, Array.from({ length: 12 }, (_, index) => unit(`ep-${index + 1}`)));
    await service.episodes(scope, makeSession(), { limit: 12, read: "all" });
    expect(peak()).toBeLessThanOrEqual(4);
    expect(peak()).toBeGreaterThan(1);
  });

  it("builds an episode list from several recently updated units for the attention queue", async () => {
    const { service, store } = setup();
    seed(store, [unit("ep-1", { updated_at: "2026-10-01T00:00:00.000Z" }), unit("ep-2", { updated_at: "2026-10-05T00:00:00.000Z" }), unit("ep-3", { updated_at: "2026-10-09T00:00:00.000Z" }), unit("ep-4", { updated_at: "2026-10-02T00:00:00.000Z" })]);
    const sample = await service.attentionFlows(scope, makeSession(), 2);
    expect(sample.flows.map((flow) => flow.episode_ref).sort()).toEqual(["ep-2", "ep-3"]);
    expect(sample).toMatchObject({ checked: 2, total: 4 });
    expect(await service.attentionFlows(unboundScope, makeSession(), 2)).toEqual({ flows: [], checked: 0, total: 0 });
  });
});

describe("drama flow cache", () => {
  it("serves a repeat read from cache, but never across session, epoch or scope", async () => {
    const { service, creativeFlow } = setup();
    await service.episode(scope, makeSession(), "ep-1");
    const hit = await service.episode(scope, makeSession(), "ep-1");
    expect(hit.cache).toBe("hit");
    expect(creativeFlow).toHaveBeenCalledTimes(1);
    await service.episode(scope, makeSession("session-b"), "ep-1");
    await service.episode(scope, makeSession("session-a", 2), "ep-1");
    await service.episode({ ...scope, id: "scope-other" }, makeSession(), "ep-1");
    expect(creativeFlow).toHaveBeenCalledTimes(4);
  });

  it("expires entries after the TTL", async () => {
    const { service, creativeFlow, advance } = setup();
    await service.episode(scope, makeSession(), "ep-1");
    advance(44_000);
    expect((await service.episode(scope, makeSession(), "ep-1")).cache).toBe("hit");
    advance(2_000);
    expect((await service.episode(scope, makeSession(), "ep-1")).cache).toBe("miss");
    expect(creativeFlow).toHaveBeenCalledTimes(2);
  });

  it("remembers an owner outage for ten seconds so every page does not wait out the same dead owner, then retries", async () => {
    const { service, creativeFlow, advance } = setup({ auctraBlocker: (call) => call === 1 ? "owner_unavailable" : undefined });
    const failed = await service.episode(scope, makeSession(), "ep-1");
    expect(failed.flow.source_coverage.find((source) => source.owner === "auctra")?.state).toBe("unavailable");
    advance(9_000);
    expect((await service.episode(scope, makeSession(), "ep-1")).cache).toBe("hit");
    expect(creativeFlow).toHaveBeenCalledTimes(1);
    advance(2_000);
    const retried = await service.episode(scope, makeSession(), "ep-1");
    expect(retried.cache).toBe("miss");
    expect(retried.flow.source_coverage.find((source) => source.owner === "auctra")?.state).toBe("complete");
    expect(creativeFlow).toHaveBeenCalledTimes(2);
  });

  it("caches a scope that is only partly connected for the full TTL, instead of re-reading Scaena on every request", async () => {
    const { service, snapshot, advance } = setup();
    const partly = { ...unboundScope, owners: scope.owners };
    for (let index = 0; index < 5; index++) await service.episode(partly, makeSession(), "ep-9");
    expect(snapshot).toHaveBeenCalledTimes(1);
    advance(44_000);
    await service.episode(partly, makeSession(), "ep-9");
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a cached flow when the same scope id gets a different binding", async () => {
    const { service, creativeFlow } = setup();
    await service.episode(scope, makeSession(), "ep-1");
    const rebound = { ...scope, collection: { auctra: { ...scope.collection!.auctra!, project: "project:other" } } };
    expect((await service.episode(rebound, makeSession(), "ep-1")).cache).toBe("miss");
    expect(creativeFlow).toHaveBeenCalledTimes(2);
  });

  it("shares one owner read between concurrent requests for the same episode", async () => {
    const { service, creativeFlow } = setup({ delayMs: 10 });
    await Promise.all([service.episode(scope, makeSession(), "ep-1"), service.episode(scope, makeSession(), "ep-1"), service.episode(scope, makeSession(), "ep-1")]);
    expect(creativeFlow).toHaveBeenCalledTimes(1);
  });

  it("rate-limits forced refreshes to one per ten seconds", async () => {
    const { service, creativeFlow, advance } = setup();
    await service.episode(scope, makeSession(), "ep-1");
    advance(5_000);
    expect((await service.episode(scope, makeSession(), "ep-1", { refresh: true })).cache).toBe("refresh_limited");
    expect(creativeFlow).toHaveBeenCalledTimes(1);
    advance(6_000);
    expect((await service.episode(scope, makeSession(), "ep-1", { refresh: true })).cache).toBe("miss");
    expect(creativeFlow).toHaveBeenCalledTimes(2);
  });
});

describe("drama episode detail", () => {
  it("queries Scaena with its own episode ref when the operator names one", async () => {
    const { service, creativeFlow, snapshot } = setup();
    const detail = await service.episode(scope, makeSession(), "ep-3", { scaena_episode_ref: "episode:03" });
    expect(creativeFlow.mock.calls[0][3]).toMatchObject({ episode_ref: "ep-3" });
    expect(snapshot.mock.calls[0][2]).toMatchObject({ episode_ref: "episode:03" });
    expect(detail).toMatchObject({ episode_ref: "ep-3", scaena_episode_ref: "episode:03", scaena_episode_overridden: true });
    expect(detail.flow.stages.map((stage) => stage.stage)).toContain("production_breakdown");
  });

  it("builds owner hand-off links from the flow and a five-stage rail", async () => {
    const { service } = setup();
    const detail = await service.episode(scope, makeSession(), "ep-1", { clientOrigins: { muweave: "http://127.0.0.1:4399" } });
    expect(detail.rail.map((node) => node.stage)).toEqual(["screenplay", "director_plan", "creative_storyboard", "production_handoff", "production_breakdown"]);
    const breakdown = detail.handoff.find((item) => item.stage === "production_breakdown");
    const muweave = breakdown?.links.find((link) => link.target === "muweave");
    expect(muweave?.launch?.url).toContain("episode=ep-1");
    expect(muweave?.launch?.return_path).toBe("/drama");
  });

  it("rejects malformed references", async () => {
    const { service } = setup();
    await expect(service.episode(scope, makeSession(), "bad\nref")).rejects.toMatchObject({ code: "invalid_reference", status: 400 });
    await expect(service.episode(scope, makeSession(), "ep-1", { scaena_episode_ref: "x".repeat(600) })).rejects.toMatchObject({ code: "invalid_reference" });
  });

  it("infers the only episode for the legacy flow read, but not when there are several", async () => {
    const one = setup();
    seed(one.store, [unit("ep-1")]);
    await one.service.flow(scope, makeSession());
    expect(one.creativeFlow.mock.calls[0][3]).toMatchObject({ episode_ref: "ep-1" });
    const many = setup();
    seed(many.store, [unit("ep-1"), unit("ep-2")]);
    await many.service.flow(scope, makeSession());
    expect(many.creativeFlow.mock.calls[0][3]).toMatchObject({ episode_ref: undefined });
  });
});

describe("drama episode list budget and ordering", () => {
  it("spends the live-read budget only on rows that are not cached, so each load fills in the next batch", async () => {
    const { service, store, creativeFlow } = setup();
    seed(store, Array.from({ length: 20 }, (_, index) => unit(`ep-${index + 1}`)));
    const first = await service.episodes(scope, makeSession(), { limit: 20 });
    expect([first.body.read_count, first.body.rows.filter((row) => row.read === "deferred").length, creativeFlow.mock.calls.length]).toEqual([8, 12, 8]);
    const second = await service.episodes(scope, makeSession(), { limit: 20 });
    expect([second.body.read_count, second.body.rows.filter((row) => row.read === "cached").length, second.body.rows.filter((row) => row.read === "deferred").length, creativeFlow.mock.calls.length]).toEqual([16, 8, 4, 16]);
    const third = await service.episodes(scope, makeSession(), { limit: 20 });
    expect([third.body.read_count, creativeFlow.mock.calls.length]).toEqual([20, 20]);
  });

  it("can order by most recent update so attention views look at what was touched last", async () => {
    const { service, store } = setup();
    seed(store, [unit("ep-1", { updated_at: "2026-10-01T00:00:00.000Z" }), unit("ep-2", { updated_at: "2026-10-09T00:00:00.000Z" }), unit("ep-3", { updated_at: "2026-10-05T00:00:00.000Z" })]);
    const recent = await service.episodes(scope, makeSession(), { order: "recent", limit: 2 });
    expect(recent.body.rows.map((row) => row.episode_ref)).toEqual(["ep-2", "ep-3"]);
    expect(recent.body.total).toBe(3);
  });

  it("pages across collection rows and requested refs without losing or repeating any", async () => {
    const { service, store } = setup();
    seed(store, [unit("ep-1"), unit("ep-2")]);
    const first = await service.episodes(scope, makeSession(), { limit: 2, extra: ["task-a", "task-b"] });
    const second = await service.episodes(scope, makeSession(), { limit: 2, offset: first.next_offset, extra: ["task-a", "task-b"] });
    expect([...first.body.rows, ...second.body.rows].map((row) => `${row.origin}:${row.episode_ref}`)).toEqual(["collection:ep-1", "collection:ep-2", "requested:task-a", "requested:task-b"]);
    expect(second.next_offset).toBeUndefined();
  });

  it("does not ask Auctra about a ref the synced collection does not contain, because Auctra matches plans by trailing digits", async () => {
    const { service, store, creativeFlow, snapshot } = setup();
    seed(store, [unit("ep-3")]);
    const detail = await service.episode(scope, makeSession(), "episode:03");
    expect(creativeFlow).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(detail.flow.source_coverage.find((source) => source.owner === "auctra")).toMatchObject({ state: "unknown", reason: "episode_not_in_collection" });
    expect(detail.flow.stages.every((stage) => stage.owner === "scaena")).toBe(true);
    await service.episode(scope, makeSession(), "ep-3");
    expect(creativeFlow).toHaveBeenCalledTimes(1);
  });

  it("still asks Auctra when the collection was never synced, because then nothing can be ruled out", async () => {
    const { service, creativeFlow } = setup();
    await service.episode(scope, makeSession(), "ep-7");
    expect(creativeFlow).toHaveBeenCalledTimes(1);
  });

  it("rejects padded references that both owners would silently trim", async () => {
    const { service } = setup();
    await expect(service.episode(scope, makeSession(), " ep-1")).rejects.toMatchObject({ code: "invalid_reference" });
    await expect(service.episode(scope, makeSession(), "ep-1\u0007")).rejects.toMatchObject({ code: "invalid_reference" });
  });
});
