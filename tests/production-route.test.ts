import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { AuthError, SessionAuth } from "../server/auth";
import { AuctraCollectionStore } from "../server/db/auctra-collection-store";
import { createMemoryDB } from "../server/db/client";
import { AuctraCollectionReader } from "../server/auctra";
import { ScaenaStoryboardReader } from "../server/scaena-storyboard";
import type { TaskConnectionState, TaskOwner, TaskPage, TaskSnapshot } from "../src/task-observation";
import { auctraFlow, config, makeSession, origin, scaenaSnapshot, seed, unit } from "./fixtures/drama-fakes";

const at = new Date().toISOString();

const task = (owner: TaskOwner, ref: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  schema_version: "yeisme.task_observation.v1",
  locator: { owner, instance_id: "i", project: "p", task_family: "run", task_ref: ref },
  task_key: `${owner}:${ref}`,
  connection_id: `c-${owner}`,
  title: ref,
  state: "succeeded",
  native_state: "succeeded",
  stage: "succeeded",
  revision: "1",
  created_at: at,
  updated_at: at,
  observed_at: at,
  started_at: null,
  progress: { kind: "indeterminate", completed: null, total: null, percent: null },
  source: "",
  actor: null,
  parent_ref: null,
  results: [],
  allowed_actions: [{ action: "cancel", enabled: true }],
  coverage: "complete",
  ...patch,
} as TaskSnapshot);

const connection = (owner: TaskOwner, state = "ready"): TaskConnectionState => ({ id: `c-${owner}`, owner, instance_id: "i", label: owner, environment: "test", project: "p", state, observed_at: at });

function setup(options: { personal?: boolean; list?: (scope: unknown, mode: "active" | "history") => Promise<TaskPage> } = {}) {
  const db = createMemoryDB();
  const store = new AuctraCollectionStore(db);
  const session = { ...makeSession(), personal: options.personal ?? true };
  const auth = new SessionAuth(config);
  vi.spyOn(auth, "current").mockReturnValue(session);
  const creativeFlow = vi.fn(async (_s: string, _scope: unknown, _session: unknown, query: { episode_ref?: string } = {}) => auctraFlow(query.episode_ref || ""));
  const snapshot = vi.fn(async (_scope: unknown, _session: unknown, query: { episode_ref?: string } = {}) => scaenaSnapshot(query.episode_ref || ""));
  const rows: TaskSnapshot[] = [
    task("scaena", "video-1", { episode_ref: "ep-1", results: [{ ref: "art-v1", name: "clip.mp4", mime: "video/mp4", bytes: 10, state: "complete" }] }),
    task("eikona", "image-1", { results: [{ ref: "art-i1", name: "frame.png", mime: "image/png", bytes: 10, state: "complete" }] }),
  ];
  const list = vi.fn(options.list || (async (_scope: unknown, mode: "active" | "history"): Promise<TaskPage> => ({
    rows: mode === "history" ? rows : [rows[0]],
    connections: (["eikona", "scaena", "sonora", "anatomia"] as TaskOwner[]).map((owner) => connection(owner)),
    next_cursors: {},
  })));
  const tasks = { list, observe: async () => [] };
  const app = createApp(config, { auth, db, tasks: tasks as never, auctra: { creativeFlow } as unknown as AuctraCollectionReader, scaenaStoryboard: { snapshot } as unknown as ScaenaStoryboardReader });
  const get = (path: string) => app(new Request(origin + "/api/control-center/v1" + path, { headers: { Cookie: "yeisme_session=" + session.id } }));
  return { get, store, list, creativeFlow };
}

const station = (body: { stations: Array<{ station: string }> }, id: string) => body.stations.find((item) => item.station === id) as Record<string, any>;

describe("GET /production", () => {
  it("returns one episode as seven stations, built from the same episode read as the studio", async () => {
    const { get } = setup();
    const response = await get("/production?scope=scope-a&episode_ref=ep-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ schema_version: "yeisme.production_line.v1", scope: "scope-a", epoch: 1, range: { kind: "episode", episode_ref: "ep-1", scaena_episode_ref: "ep-1" } });
    expect(body.stations.map((item: { station: string }) => item.station)).toEqual(["story", "look", "board", "frames", "motion", "sound", "cut"]);

    const detail = await (await get("/drama/episode?scope=scope-a&episode_ref=ep-1")).json();
    const railState = (stage: string) => detail.rail.find((node: { stage: string }) => node.stage === stage).state;
    expect(station(body, "story").stages).toEqual([{ stage: "screenplay", state: railState("screenplay") }, { stage: "director_plan", state: railState("director_plan") }]);
    expect(station(body, "board").stages.map((item: { stage: string }) => item.stage)).toEqual(["creative_storyboard", "production_handoff", "production_breakdown"]);

    // Missing contracts stay missing; they never read as empty or done.
    expect(station(body, "look")).toMatchObject({ state: "needs_contract", reason: "reference_binding_contract_not_configured" });
    expect(station(body, "cut").gaps.map((gap: { part: string; state: string }) => `${gap.part}:${gap.state}`)).toEqual(expect.arrayContaining(["edit:needs_contract", "review_adoption:needs_contract", "delivery:needs_contract"]));

    // Only Scaena names episodes, so its video counts here and the unnamed Eikona image does not.
    expect(station(body, "motion")).toMatchObject({ state: "observed", counts: { total: 1 } });
    expect(station(body, "motion").results[0]).toMatchObject({ artifact_ref: "art-v1", kind: "video" });
    expect(station(body, "frames")).toMatchObject({ state: "needs_contract", reason: "episode_link_missing" });
    expect(body.unassigned_tasks).toBe(1);
  });

  it("carries no credentials, prompts or media bindings", async () => {
    const { get } = setup();
    const text = JSON.stringify(await (await get("/production?scope=scope-a&episode_ref=ep-1")).json());
    for (const forbidden of ["Authorization", "Bearer", "raw_prompt", "action_summary", "content_ref", "representation_ref", "media_type", "allowed_actions", "cancel"]) expect(text).not.toContain(forbidden);
  });

  it("serves a repeated read from its short cache instead of reading owner tasks again", async () => {
    const { get, list } = setup();
    await get("/production?scope=scope-a&episode_ref=ep-1");
    const calls = list.mock.calls.length;
    await get("/production?scope=scope-a&episode_ref=ep-1");
    expect(list.mock.calls.length).toBe(calls);
    await get("/production?scope=scope-a&episode_ref=ep-2");
    expect(list.mock.calls.length).toBeGreaterThan(calls);
  });

  it("reads the whole scope as one project line when no episode is named", async () => {
    const { get, store } = setup();
    seed(store, [unit("ep-1"), unit("ep-2")]);
    const body = await (await get("/production?scope=scope-a")).json();
    expect(body.range).toMatchObject({ kind: "project", project_ref: "project-a", title: "Project A" });
    expect(body.stations).toHaveLength(7);
    // The fake session has no delegated Auctra credential, so the episodes read are counted and the station says it is partial.
    expect(station(body, "story")).toMatchObject({ state: "partial", reason: "delegation_unavailable", counts: { total: 2 } });
    // Project range counts every task in scope, named or not.
    expect(station(body, "frames")).toMatchObject({ state: "observed", counts: { total: 1 } });
    expect(body.unassigned_tasks).toBeUndefined();
  });

  it("keeps task stations unreadable, not empty, for a session without a personal task connection", async () => {
    const { get, list } = setup({ personal: false });
    const body = await (await get("/production?scope=scope-a&episode_ref=ep-1")).json();
    expect(list).not.toHaveBeenCalled();
    for (const id of ["frames", "motion", "sound", "cut"]) expect(station(body, id), id).toMatchObject({ state: "unavailable", reason: "personal_connection_required" });
    expect(station(body, "story").state).toBe("observed");
    expect(body.unassigned_tasks).toBeUndefined();
  });

  it("keeps the episode stations when the task source fails, and the task stations when the episode read fails", async () => {
    const failing = setup({ list: async () => { throw new AuthError("source_unavailable", 503); } });
    const body = await (await failing.get("/production?scope=scope-a&episode_ref=ep-1")).json();
    expect(station(body, "motion")).toMatchObject({ state: "unavailable", reason: "source_unavailable" });
    expect(station(body, "story").state).toBe("observed");

    const broken = setup();
    broken.creativeFlow.mockRejectedValue(new Error("auctra down"));
    const partial = await broken.get("/production?scope=scope-a&episode_ref=ep-1");
    expect(partial.status).toBe(200);
    const line = await partial.json();
    expect(station(line, "motion").state).toBe("observed");
    expect(["unavailable", "partial"]).toContain(station(line, "story").state);
  });

  it("rejects malformed references", async () => {
    const { get } = setup();
    for (const query of ["episode_ref=bad%0Aref", "episode_ref=", "episode_ref=ep-1&scaena_episode_ref=", "scaena_episode_ref=episode%3A01"]) {
      const response = await get(`/production?scope=scope-a&${query}`);
      expect(response.status, query).toBe(400);
      expect((await response.json()).error).toBe("invalid_reference");
    }
    expect((await get("/production?scope=nope&episode_ref=ep-1")).status).toBe(404);
  });
});
