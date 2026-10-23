import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { AuctraCollectionStore } from "../server/db/auctra-collection-store";
import { createMemoryDB } from "../server/db/client";
import { AuctraCollectionReader } from "../server/auctra";
import { ScaenaStoryboardReader } from "../server/scaena-storyboard";
import { auctraFlow, config, makeSession, origin, scaenaSnapshot, scope, seed, unit } from "./fixtures/drama-fakes";

function setup(flowFor: (episode: string) => ReturnType<typeof auctraFlow> = (episode) => auctraFlow(episode)) {
  const db = createMemoryDB();
  const store = new AuctraCollectionStore(db);
  const session = makeSession();
  const auth = new SessionAuth(config);
  vi.spyOn(auth, "current").mockReturnValue(session);
  const creativeFlow = vi.fn(async (_s: string, _scope: unknown, _session: unknown, query: { episode_ref?: string } = {}) => flowFor(query.episode_ref || ""));
  const snapshot = vi.fn(async (_scope: unknown, _session: unknown, query: { episode_ref?: string } = {}) => scaenaSnapshot(query.episode_ref || ""));
  const tasks = { list: async () => ({ rows: [], connections: [], next_cursors: {} }), observe: async () => [] };
  const app = createApp(config, { auth, db, tasks: tasks as never, auctra: { creativeFlow } as unknown as AuctraCollectionReader, scaenaStoryboard: { snapshot } as unknown as ScaenaStoryboardReader });
  const get = (path: string) => app(new Request(origin + "/api/control-center/v1" + path, { headers: { Cookie: "yeisme_session=" + session.id } }));
  return { get, store, creativeFlow, snapshot };
}

describe("GET /drama/episodes", () => {
  it("returns scoped episode rows with a five-stage rail, the epoch and no credentials", async () => {
    const { get, store } = setup();
    seed(store, [unit("ep-1"), unit("ep-2")]);
    const response = await get("/drama/episodes?scope=scope-a");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ schema_version: "yeisme.drama_episodes.v1", scope: "scope-a", epoch: 1, total: 2, universe: { bound: true } });
    expect(body.rows[0].flow.rail).toHaveLength(5);
    const text = JSON.stringify(body);
    for (const forbidden of ["Authorization", "Bearer", "raw_prompt", "action_summary"]) expect(text).not.toContain(forbidden);
  });

  it("rejects unknown scopes and malformed queries", async () => {
    const { get } = setup();
    expect((await get("/drama/episodes?scope=nope")).status).toBe(404);
    for (const query of ["limit=0", "limit=25", "limit=abc", "read=some", "order=sideways", "q=" + "x".repeat(201), Array.from({ length: 13 }, (_, index) => "episode_ref=t" + index).join("&")]) {
      const response = await get(`/drama/episodes?scope=scope-a&${query}`);
      expect(response.status, query).toBe(400);
      expect((await response.json()).error).toBe("invalid_query");
    }
  });

  it("pages with a signed cursor that cannot be forged or reused for another query", async () => {
    const { get, store } = setup();
    seed(store, Array.from({ length: 5 }, (_, index) => unit(`ep-${index + 1}`)));
    const first = await (await get("/drama/episodes?scope=scope-a&limit=2")).json();
    expect(first.rows.map((row: { episode_ref: string }) => row.episode_ref)).toEqual(["ep-1", "ep-2"]);
    const second = await (await get(`/drama/episodes?scope=scope-a&limit=2&cursor=${encodeURIComponent(first.next_cursor)}`)).json();
    expect(second.rows.map((row: { episode_ref: string }) => row.episode_ref)).toEqual(["ep-3", "ep-4"]);
    const tampered = await get(`/drama/episodes?scope=scope-a&limit=2&cursor=${encodeURIComponent(first.next_cursor.slice(0, -2) + "xx")}`);
    expect(tampered.status).toBe(400);
    const reused = await get(`/drama/episodes?scope=scope-a&limit=2&q=ep&cursor=${encodeURIComponent(first.next_cursor)}`);
    expect(reused.status).toBe(409);
  });

  it("includes caller-named episodes so a scope with no Auctra collection can still show task episodes", async () => {
    const { get } = setup();
    const body = await (await get("/drama/episodes?scope=scope-a&episode_ref=ep-77&read=all")).json();
    expect(body.rows).toEqual([expect.objectContaining({ episode_ref: "ep-77", origin: "requested", read: "read" })]);
  });
});

describe("GET /drama/episode", () => {
  it("returns the flow, rail, outline slot and owner hand-off for one episode", async () => {
    const { get } = setup();
    const response = await get("/drama/episode?scope=scope-a&episode_ref=ep-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ schema_version: "yeisme.drama_episode.v1", episode_ref: "ep-1", scaena_episode_ref: "ep-1", scaena_episode_overridden: false, cache: "miss" });
    expect(body.flow.schema_version).toBe("yeisme.creative_flow.v1");
    expect(body.rail).toHaveLength(5);
    expect(body.handoff.length).toBeGreaterThan(0);
    expect((await (await get("/drama/episode?scope=scope-a&episode_ref=ep-1")).json()).cache).toBe("hit");
  });

  it("requires a well-formed episode reference", async () => {
    const { get } = setup();
    expect((await get("/drama/episode?scope=scope-a")).status).toBe(400);
    expect((await get("/drama/episode?scope=scope-a&episode_ref=bad%0Aref")).status).toBe(400);
    expect((await get("/drama/episode?scope=scope-a&episode_ref=ep-1&scaena_episode_ref=")).status).toBe(400);
  });

  it("lets the operator point Scaena at a different episode ref", async () => {
    const { get, snapshot } = setup();
    const body = await (await get("/drama/episode?scope=scope-a&episode_ref=ep-3&scaena_episode_ref=episode%3A03")).json();
    expect(body).toMatchObject({ scaena_episode_ref: "episode:03", scaena_episode_overridden: true });
    expect(snapshot.mock.calls[0][2]).toMatchObject({ episode_ref: "episode:03" });
  });
});

describe("GET /work-queue with episode flows", () => {
  const states: Record<string, string[]> = {
    "ep-1": ["accepted", "accepted", "accepted", "accepted"],
    "ep-2": ["accepted", "accepted", "waiting_review", "missing"],
  };

  it("never reads a flow without an episode, and shows no fake contract gap when nothing was synced", async () => {
    const { get, creativeFlow, snapshot } = setup();
    const body = await (await get("/work-queue?scope=scope-a")).json();
    expect(creativeFlow).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(body.items.filter((item: { title: string }) => item.title === "剧本到分镜流程暂不可读")).toEqual([]);
  });

  it("queues only real attention: a stage waiting for review, not stages nobody has started", async () => {
    const { get, store, creativeFlow } = setup((episode) => auctraFlow(episode, states[episode]));
    seed(store, [unit("ep-1"), unit("ep-2")]);
    const body = await (await get("/work-queue?scope=scope-a")).json();
    const flowItems = body.items.filter((item: { workflow_stage?: string }) => item.workflow_stage);
    expect(flowItems.map((item: { workflow_stage: string; kind: string }) => `${item.workflow_stage}:${item.kind}`).sort()).toEqual(["creative_storyboard:review_required"]);
    expect(creativeFlow.mock.calls.every((call) => !!call[3]?.episode_ref)).toBe(true);
    expect(body.counts.review_required).toBe(1);
  });
});

describe("GET /drama/episodes with owner-supplied refs", () => {
  it("ignores a malformed task episode ref instead of failing the whole list", async () => {
    const { get, store } = setup();
    seed(store, [unit("ep-1")]);
    const response = await get("/drama/episodes?scope=scope-a&episode_ref=bad%0Aref&episode_ref=%20padded&episode_ref=task-ok&read=all");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows.map((row: { episode_ref: string }) => row.episode_ref)).toEqual(["ep-1", "task-ok"]);
  });

  it("supports most-recent-first ordering for attention views", async () => {
    const { get, store } = setup();
    seed(store, [unit("ep-1", { updated_at: "2026-10-01T00:00:00.000Z" }), unit("ep-2", { updated_at: "2026-10-09T00:00:00.000Z" })]);
    const body = await (await get("/drama/episodes?scope=scope-a&order=recent&limit=1")).json();
    expect(body.rows.map((row: { episode_ref: string }) => row.episode_ref)).toEqual(["ep-2"]);
    const natural = await (await get("/drama/episodes?scope=scope-a&limit=1")).json();
    expect(natural.rows[0].episode_ref).toBe("ep-1");
  });
});

describe("the real owner readers behind the routes never leak what the owners send", () => {
  const poison = ["SECRET-ACTION-TEXT", "SECRET-PROMPT", "content-secret", "provider-payload-secret"];
  const sha = (char: string) => "sha256:" + char.repeat(64);

  function realReaders() {
    const db = createMemoryDB();
    const store = new AuctraCollectionStore(db);
    seed(store, [unit("ep-1")]);
    const session = makeSession();
    const auth = new SessionAuth(config);
    vi.spyOn(auth, "current").mockReturnValue({ ...session, accessToken: "owner-token", accessAudience: ["aud-auctra", "aud-scaena"] });
    const now = new Date().toISOString();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes("creative.flow.read")) {
        return Response.json({ data: { schema_version: "auctra.creative_flow_source.v1", project_ref: "project:a", episode_ref: "ep-1", observed_at: now, coverage: "partial", raw_prompt: poison[1], stages: [{ stage: "screenplay", owner: "auctra", object_kind: "screenplay", source_ref: "s", state: "accepted", native_state: "accepted", observed_at: now, source_current: true, episode_ref: "ep-1", safe_refs: ["s"], blockers: "not-an-array", provider_payload: poison[3] }] } });
      }
      return Response.json({ data: { schema_version: "scaena.storyboard_workspace_projection.v1", project_ref: "scaena-project", episode_ref: "ep-1", revision: 1, digest: sha("a"), raw_prompt: poison[1], source: { source_ref: "src", episode_ref: "ep-1", revision: 1, digest: sha("b"), current: true, state: "accepted", safe_refs: [] }, items: [{ breakdown_ref: "bd", episode_ref: "ep-1", source_ref: "src", source_version: 1, source_digest: sha("b"), version: 1, state: "accepted", updated_at: now, scene_count: 1, shot_count: 1, scenes: [{ scene_ref: "sc", order: 1, heading: "h", shots: [{ shot_ref: "sh", order: 1, action_summary: poison[0] }] }], media: [{ content_ref: poison[2], digest: sha("c"), media_type: "image/png" }] }] } });
    });
    const tasks = { list: async () => ({ rows: [], connections: [], next_cursors: {} }), observe: async () => [] };
    const app = createApp(config, { auth, db, tasks: tasks as never, auctra: new AuctraCollectionReader(config, fetcher as never), scaenaStoryboard: new ScaenaStoryboardReader(config, fetcher as never) });
    return { get: (path: string) => app(new Request(origin + "/api/control-center/v1" + path, { headers: { Cookie: "yeisme_session=" + session.id } })) };
  }

  it("keeps action summaries, prompts, media refs and payloads out of the episode detail and the list", async () => {
    const { get } = realReaders();
    const detail = await (await get("/drama/episode?scope=scope-a&episode_ref=ep-1")).text();
    const list = await (await get("/drama/episodes?scope=scope-a&read=all")).text();
    for (const secret of [...poison, "Authorization", "Bearer", "owner-token"]) { expect(detail).not.toContain(secret); expect(list).not.toContain(secret); }
    expect(JSON.parse(detail).outline).toMatchObject({ scene_count: 1, shot_count: 1 });
  });

  it("survives an owner that sends a string where a list of blockers belongs", async () => {
    const { get } = realReaders();
    const response = await get("/work-queue?scope=scope-a");
    expect(response.status).toBe(200);
  });
});
