import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskConnections } from "../server/task-connections";
import { EpisodeProductionReader, episodeProductionCacheMs } from "../server/episode-production";
import { normalizeEpisodeProductionPage } from "../src/shared/episode-production";
import { episodeProductionPage } from "../scripts/fixtures/episode-production-world";
import type { ScopeBinding, ServerConfig, TaskConnection } from "../server/contracts";

const root = mkdtempSync(join(tmpdir(), "episode-production-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const secret = join(root, "secret");
writeFileSync(secret, "test-observer-credential", { mode: 0o600 });

const connection: TaskConnection = { id: "sc", owner: "scaena", instance_id: "test", label: "Scaena", environment: "test", project: "p", endpoint: "http://127.0.0.1:1234/mcp", credential_ref: secret, allow_private_http: true, enabled: true };
const scope: ScopeBinding = { id: "s", tenant: "personal", team: "", project: "p", label: "P", connection_ids: ["sc"], owners: {} };
const config: ServerConfig = { origin: "http://127.0.0.1", port: 1, principals: [], owners: {}, connections: [connection] };

const goldenPath = join(__dirname, "fixtures/owner-golden/scaena-episode-production-observation.json");
const ownerGolden = join(__dirname, "../../../agent/scaena/internal/productionbackend/app/testdata/episode_production_observation.golden.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

/** A Scaena MCP endpoint: `answer` decides what `control_center.production.episodes` returns; everything is recorded. */
function scaena(answer: (args: any) => unknown) {
  const calls: { action: string; args: any; authorization: string | null; url: string }[] = [];
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
    const { action, args } = body.params.arguments;
    calls.push({ action, args, authorization: new Headers(init.headers).get("authorization"), url: String(url) });
    if (action === "control_center.tasks.list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { data: { rows: [] } } } });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: answer(args) });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("episode production summary: normalize", () => {
  it("keeps the golden row's refs, states and counts, and nothing else", () => {
    const read = normalizeEpisodeProductionPage({ ...golden, rows: golden.rows.slice(0, 1) }, ["episode-1"], "2026-11-07T00:00:00Z");
    expect(read?.state).toBe("observed");
    if (read?.state !== "observed") return;
    expect(read.row.episode_ref).toBe("episode_workspace_a");
    expect(read.row.production_episode_ref).toBe("episode-1");
    expect(read.row.sections.delivery).toMatchObject({ state: "needs_contract", reason: "delivery_episode_link_missing" });
    expect(read.row.sections.assembly).toMatchObject({ state: "observed", status: "completed", artifact_ref: "artifact" });
    expect(read.row.sections.edit).toMatchObject({ state: "observed", status: "bound" });
    expect(read.row.owners.find((owner) => owner.owner === "sonora")).toMatchObject({ resource_ref: "sonora://episodes/e1", delegations: { completed: 1, running: 1 } });
    expect(JSON.stringify(read)).not.toMatch(/private|private-action|private-media/);
  });

  it("refuses a page for another episode, another schema, or a malformed section, and says empty only for no rows", () => {
    expect(normalizeEpisodeProductionPage({ ...golden, rows: golden.rows.slice(0, 1) }, ["other"], "t")).toBeUndefined();
    expect(normalizeEpisodeProductionPage({ ...golden, schema_version: "yeisme.other.v1" }, ["episode-1"], "t")).toBeUndefined();
    const broken = structuredClone(golden.rows[0]);
    broken.sections.edit.state = "done";
    expect(normalizeEpisodeProductionPage({ ...golden, rows: [broken] }, ["episode-1"], "t")).toBeUndefined();
    const negative = structuredClone(golden.rows[0]);
    negative.sections.review.counts.reviews = -1;
    expect(normalizeEpisodeProductionPage({ ...golden, rows: [negative] }, ["episode-1"], "t")).toBeUndefined();
    expect(normalizeEpisodeProductionPage({ ...golden, rows: [] }, ["episode-1"], "t")?.state).toBe("empty");
  });

  it("keeps Scaena's timing rollup with null durations as null, and drops a malformed one without losing the row", () => {
    const read = normalizeEpisodeProductionPage(golden, ["episode-1"], "t");
    expect(read?.state === "observed" && read.row.timing).toMatchObject({ state: "observed", run_count: 1, timed_run_count: 1, wall_duration_ms: 2_550_000, blocked_duration_ms: null, splits_recorded: false });
    const empty = normalizeEpisodeProductionPage({ ...golden, rows: golden.rows.slice(1) }, [golden.rows[1].episode_ref], "t");
    expect(empty?.state === "observed" && empty.row.timing).toMatchObject({ timed_run_count: 0, wall_duration_ms: null, queue_duration_ms: null });
    const bad = structuredClone(golden.rows[0]);
    bad.timing = { state: "done", wall_duration_ms: -5 };
    const kept = normalizeEpisodeProductionPage({ ...golden, rows: [bad] }, ["episode-1"], "t");
    expect(kept?.state).toBe("observed");
    expect(kept?.state === "observed" && "timing" in kept.row).toBe(false);
    const old = structuredClone(golden.rows[0]);
    delete old.timing;
    const before = normalizeEpisodeProductionPage({ ...golden, rows: [old] }, ["episode-1"], "t");
    expect(before?.state === "observed" && "timing" in before.row).toBe(false);
  });

  it("matches the golden in the Scaena repository when it is checked out next to this one", () => {
    if (!existsSync(ownerGolden)) return;
    expect(JSON.parse(readFileSync(ownerGolden, "utf8"))).toEqual(golden);
  });

  it("serves fixture pages the same normalizer accepts", () => {
    const full = normalizeEpisodeProductionPage(episodeProductionPage("rain-reunion", "ep-01"), ["ep-01"], "t");
    expect(full?.state).toBe("observed");
    const partial = normalizeEpisodeProductionPage(episodeProductionPage("rain-reunion", "ep-02"), ["ep-02"], "t");
    expect(partial?.state === "observed" && partial.row.sections.assembly.state).toBe("unavailable");
    expect(episodeProductionPage("rain-reunion", "ep-03")).toBeUndefined();
  });
});

describe("episode production summary: reader", () => {
  it("asks Scaena once per episode with the observer connection, keyed by Scaena's own episode, and caches the answer", async () => {
    const owner = scaena(() => ({ structuredContent: { data: { ...golden, rows: golden.rows.slice(0, 1) } } }));
    let now = 1_000;
    const reader = new EpisodeProductionReader({ tasks: new TaskConnections(config, owner.fetcher), now: () => now });
    const read = await reader.read(scope, "ep-01", "episode-1");
    expect(read.state).toBe("observed");
    expect(owner.calls).toHaveLength(1);
    expect(owner.calls[0]).toMatchObject({ action: "control_center.production.episodes", args: { path: { project_id: "p" }, query: { episode: "episode-1", limit: "1" } } });
    expect(owner.calls[0].url).not.toContain("test-observer-credential");
    await reader.read(scope, "ep-01", "episode-1");
    expect(owner.calls).toHaveLength(1);
    now += episodeProductionCacheMs + 1;
    await reader.read(scope, "ep-01", "episode-1");
    expect(owner.calls).toHaveLength(2);
  });

  it("reads an owner without the operation as needs_contract, a malformed page as unavailable, and no Scaena connection as unconnected", async () => {
    const unknown = scaena(() => ({ isError: true, structuredContent: { error: { code: "UNKNOWN_ACTION" } } }));
    expect(await new EpisodeProductionReader({ tasks: new TaskConnections(config, unknown.fetcher) }).read(scope, "ep-01")).toEqual({ state: "needs_contract", reason: "episode_production_contract_missing" });
    const malformed = scaena(() => ({ structuredContent: { data: { schema_version: "yeisme.episode_production_observation.v1", rows: "x" } } }));
    expect(await new EpisodeProductionReader({ tasks: new TaskConnections(config, malformed.fetcher) }).read(scope, "ep-01")).toEqual({ state: "unavailable", reason: "invalid_owner_response" });
    const none = new EpisodeProductionReader({ tasks: new TaskConnections({ ...config, connections: [] }, unknown.fetcher) });
    expect(await none.read({ ...scope, connection_ids: [] }, "ep-01")).toEqual({ state: "unconnected", reason: "no_task_connection" });
  });

  it("a refusal of the summary does not cut the connection off from task reads", async () => {
    const owner = scaena(() => ({ isError: true, structuredContent: { error: { code: "FORBIDDEN" } } }));
    const tasks = new TaskConnections(config, owner.fetcher);
    expect(await new EpisodeProductionReader({ tasks }).read(scope, "ep-01")).toEqual({ state: "needs_contract", reason: "episode_production_contract_missing" });
    const page = await tasks.list(scope, "active");
    expect(page.connections.find((c) => c.id === "sc")?.state).not.toBe("needs_authorization");
    expect(owner.calls.map((call) => call.action)).toContain("control_center.tasks.list");
  });

  it("keeps a contract gap visible when a later Scaena connection is unavailable", async () => {
    const first = scaena(() => ({ isError: true, structuredContent: { error: { code: "UNKNOWN_ACTION" } } }));
    const second = scaena(() => { throw new Error("owner timeout"); });
    const multi: ServerConfig = { ...config, connections: [connection, { ...connection, id: "sc-2", endpoint: "http://127.0.0.1:1235/mcp" }] };
    const tasks = new TaskConnections(multi, async (url, init) => {
      if (String(url).includes("1234")) return first.fetcher(url, init);
      throw new Error("owner timeout");
    });
    const read = await new EpisodeProductionReader({ tasks }).read({ ...scope, connection_ids: ["sc", "sc-2"] }, "ep-01");
    expect(read).toEqual({ state: "needs_contract", reason: "episode_production_contract_missing" });
    void second;
  });
});
