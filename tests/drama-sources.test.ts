import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuctraCollectionReader } from "../server/auctra";
import { config, makeSession, scope } from "./fixtures/drama-fakes";
import type { TaskSnapshot } from "../src/task-observation";
import { collectionSyncMessage, mergeEpisodeEntries, railNodeInfo, recentEpisodeKey, recentEpisodes, requestedEpisodeRefs, sourceText, taskEpisodeRefs, universeGapText } from "../src/shared/read-model/drama";

const task = (ref: string, updated: string) => ({ episode_ref: ref, updated_at: updated, created_at: updated }) as unknown as TaskSnapshot;

describe("episode list without a full collection", () => {
  it("keeps the episodes the newest tasks mention, and says how many there were in all", () => {
    const tasks = [task("episode:10", "2026-10-28T09:00:00Z"), task("episode:2", "2026-10-01T00:00:00Z"), task("episode:3", "2026-10-27T00:00:00Z"), task("episode:10", "2026-09-01T00:00:00Z"), task("bad\nref", "2026-10-28T10:00:00Z")];
    expect(taskEpisodeRefs(tasks, 2)).toEqual({ refs: ["episode:3", "episode:10"], total: 3 });
    expect(taskEpisodeRefs(tasks).refs).toEqual(["episode:2", "episode:3", "episode:10"]);
  });

  it("filters client-added episodes by the search like the server does, and never hides the open one", () => {
    const entries = mergeEpisodeEntries([], { task: ["episode:01", "episode:02"], recent: [{ episode_ref: "scene_007", title: "Rain stops" }], manual: "episode:09", q: "rain" });
    expect(entries.map((entry) => [entry.episode_ref, entry.origin])).toEqual([["scene_007", "recent"], ["episode:09", "manual"]]);
    const all = mergeEpisodeEntries([{ episode_ref: "episode:02", title: "episode:02", origin: "requested", read: "read" }], { task: ["episode:02"], recent: [{ episode_ref: "episode:02", title: "x" }, { episode_ref: "scene_007", title: "Rain" }] });
    expect(all.map((entry) => [entry.episode_ref, entry.origin, entry.title])).toEqual([["episode:02", "task", "episode:02"], ["scene_007", "recent", "Rain"]]);
  });

  it("reads recently opened episodes out of the tab's recent items and asks the server for tasks first", () => {
    const items = [
      { key: recentEpisodeKey("scene_007"), kind: "episode", label: "Ep 1" },
      { key: "task:abc", kind: "task", label: "A task" },
      { key: recentEpisodeKey(" padded"), kind: "episode", label: "bad" },
      { key: "episode-without-prefix", kind: "episode", label: "bad" },
    ];
    const opened = recentEpisodes(items);
    expect(opened).toEqual([{ episode_ref: "scene_007", title: "Ep 1" }]);
    expect(requestedEpisodeRefs(["episode:01", "scene_007"], opened)).toEqual(["episode:01", "scene_007"]);
    expect(requestedEpisodeRefs(Array.from({ length: 30 }, (_, index) => `t${index}`), opened)).toHaveLength(20);
  });
});

describe("source and sync wording", () => {
  it("never reports a partial or failed sync as done", () => {
    const counts = { inserted: 2, returned: 40, total: 90 };
    expect(collectionSyncMessage({ coverage: "partial", counts, blocker: "collection_page_limit", complete: false }).tone).toBe("warning");
    expect(collectionSyncMessage({ coverage: "complete", counts: { ...counts, returned: 90 }, blocker: null, complete: true }).tone).toBe("success");
    expect(collectionSyncMessage({ coverage: "unavailable", counts: { inserted: 0, returned: 0, total: 0 }, blocker: "owner_forbidden", complete: false }).tone).toBe("warning");
    // A server that predates paging only says coverage; complete there means the one page it read.
    expect(collectionSyncMessage({ coverage: "complete", counts, blocker: null }).tone).toBe("success");
  });

  it("explains each missing piece separately, and still words an older server's generic reason", () => {
    const texts = ["collection_target_missing", "collection_binding_missing", "delegation_unavailable", "source_not_configured", undefined].map(universeGapText);
    expect(new Set(texts).size).toBe(texts.length - 1);
    for (const text of texts) expect(text).not.toMatch(/[a-z]_[a-z]/);
    expect(sourceText({ owner: "scaena", state: "target_missing" })).not.toBe("");
    expect(sourceText({ owner: "auctra", state: "connected" })).toBe("");
  });

  it("labels a stage nobody connected as not connected, and keeps a real missing contract as it was", () => {
    expect(railNodeInfo({ state: "needs_contract", blocker: "source_not_configured" })).toMatchObject({ tone: "neutral", shape: "plug" });
    expect(railNodeInfo({ state: "needs_contract", blocker: "scaena_storyboard_binding_missing" }).label).toBe(railNodeInfo({ state: "needs_contract", blocker: "source_not_configured" }).label);
    expect(railNodeInfo({ state: "needs_contract", blocker: "needs_contract" })).toMatchObject({ tone: "review" });
    expect(railNodeInfo({ state: "needs_contract" })).toMatchObject({ tone: "review" });
  });
});

describe("Auctra reader keys", () => {
  it("sends the collector key to collection.* and the reader key to creative.flow.read, without project_ref", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auctra-keys-"));
    const collector = join(dir, "collector.key"), reader = join(dir, "reader.key");
    writeFileSync(collector, "auctra-ak-collector\n", { mode: 0o600 });
    writeFileSync(reader, "auctra-ak-reader\n", { mode: 0o600 });
    const calls: { op: string; auth: string; args: Record<string, unknown> }[] = [];
    const fetcher = (async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ op: body.operation_id, auth: (init.headers as Record<string, string>).Authorization, args: body.args });
      if (body.operation_id === "collection.snapshot") return Response.json({ data: { records: [], total: 0 } });
      return Response.json({ data: { schema_version: "auctra.creative_flow_source.v1", project_ref: "project:a", episode_ref: "ep-1", observed_at: new Date().toISOString(), coverage: "partial", stages: [] } });
    }) as unknown as typeof fetch;
    try {
      const keyed = { ...config, collection: { auctra: { ...config.collection!.auctra!, credential_ref: collector, flow_credential_ref: reader } } };
      const auctra = new AuctraCollectionReader(keyed, fetcher);
      await auctra.snapshot(scope.id, scope, makeSession());
      await auctra.creativeFlow(scope.id, scope, makeSession(), { episode_ref: "ep-1" });
      expect(calls.map((call) => [call.op, call.auth])).toEqual([["collection.snapshot", "Bearer auctra-ak-collector"], ["creative.flow.read", "Bearer auctra-ak-reader"]]);
      // Auctra resolves the project from its served root and rejects any other spelling, so only work_ref is sent.
      expect(calls[1].args).toEqual({ episode_ref: "ep-1", work_ref: "project:a" });
      // One credential still serves both, for a deployment with a single token.
      const single = new AuctraCollectionReader({ ...config, collection: { auctra: { ...config.collection!.auctra!, credential_ref: collector } } }, fetcher);
      await single.creativeFlow(scope.id, scope, makeSession(), { episode_ref: "ep-1" });
      expect(calls[2].auth).toBe("Bearer auctra-ak-collector");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
