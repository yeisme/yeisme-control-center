import { describe, expect, it } from "vitest";
import { buildProductionLine, productionStations, stationOf, taskSourceAnswered, type ProductionInput } from "../src/shared/production-line";
import type { DramaEpisodeDetail, DramaEpisodeRow, DramaRailStage, StoryboardOutline } from "../src/shared/drama";
import type { CreativeFlowStage } from "../src/shared/creative-flow";
import type { TaskConnectionState, TaskOwner, TaskSnapshot } from "../src/task-observation";

const stages: CreativeFlowStage[] = ["screenplay", "director_plan", "creative_storyboard", "production_handoff", "production_breakdown"];
const now = "2026-11-06T08:00:00.000Z";

function rail(states: DramaRailStage["state"][], patch: Partial<Record<CreativeFlowStage, Partial<DramaRailStage>>> = {}): DramaRailStage[] {
  return stages.map((stage, index) => ({
    stage,
    owner: stage === "production_breakdown" ? "scaena" : "auctra",
    state: states[index],
    coverage: "complete",
    freshness: "fresh",
    source_current: true,
    observed_at: now,
    ...patch[stage],
  }));
}

function detail(states: DramaRailStage["state"][], outline?: StoryboardOutline, patch?: Partial<Record<CreativeFlowStage, Partial<DramaRailStage>>>): DramaEpisodeDetail {
  return {
    schema_version: "yeisme.drama_episode.v1",
    epoch: 1,
    scope: "scope-a",
    episode_ref: "ep-01",
    scaena_episode_ref: "episode:01",
    scaena_episode_overridden: false,
    observed_at: now,
    cache: "miss",
    flow: { schema_version: "yeisme.creative_flow.v1", scope: "scope-a", project_ref: "p", observed_at: now, coverage: "complete", source_coverage: [], stages: [], edges: [], launch_contexts: [] },
    rail: rail(states, patch),
    ...(outline ? { outline } : {}),
    handoff: [],
  };
}

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
  created_at: "2026-11-06T07:00:00.000Z",
  updated_at: "2026-11-06T07:30:00.000Z",
  observed_at: now,
  started_at: null,
  progress: { kind: "indeterminate", completed: null, total: null, percent: null },
  source: "",
  actor: null,
  parent_ref: null,
  results: [],
  allowed_actions: [],
  coverage: "complete",
  ...patch,
});

const connection = (owner: TaskOwner, state = "ready"): TaskConnectionState => ({ id: `c-${owner}`, owner, instance_id: "i", label: owner, environment: "test", project: "p", state, observed_at: now });
const allConnected = (["eikona", "scaena", "sonora", "anatomia"] as TaskOwner[]).map((owner) => connection(owner));

const episodeInput = (patch: Partial<ProductionInput> = {}): ProductionInput => ({
  scope: "scope-a",
  now,
  range: { kind: "episode", episode_ref: "ep-01", scaena_episode_ref: "episode:01", title: "第 1 集" },
  detail: detail(["accepted", "accepted", "accepted", "accepted", "accepted"]),
  tasks: [],
  tasksReadable: true,
  connections: allConnected,
  ...patch,
});

const outline = (shots: Array<{ ref: string; frame?: "ready" | "pending"; ready?: boolean }>): StoryboardOutline => ({
  head_breakdown_ref: "bd-1", head_state: "accepted", head_native_state: "accepted", head_revision: "3", older_attempts: 0, truncated: false,
  scene_count: 1, shot_count: shots.length, duration_ms: 12_000, finding_count: 0,
  scenes: [{ scene_ref: "sc-1", order: 1, heading: "站台", shots: shots.map((shot, index) => ({ shot_ref: shot.ref, order: index + 1, ...(shot.frame ? { frame_state: shot.frame } : {}), ...(shot.ready !== undefined ? { generation_ready: shot.ready } : {}) })) }],
});

describe("production line: shape", () => {
  it("always has seven stations in pipeline order with their tools", () => {
    const line = buildProductionLine(episodeInput());
    expect(line.schema_version).toBe("yeisme.production_line.v1");
    expect(line.stations.map((station) => station.station)).toEqual([...productionStations]);
    expect(stationOf(line, "frames")?.tools).toEqual(["eikona"]);
    expect(stationOf(line, "cut")?.tools).toEqual(["anatomia", "scaena", "drivebridge"]);
  });
});

describe("production line: honest states", () => {
  it("keeps references and the cut's editing, adoption and delivery as waiting for a contract", () => {
    const line = buildProductionLine(episodeInput());
    expect(stationOf(line, "look")).toMatchObject({ state: "needs_contract", reason: "reference_binding_contract_not_configured", next: null });
    const cut = stationOf(line, "cut")!;
    expect(cut.gaps.map((gap) => `${gap.part}:${gap.state}`)).toEqual(["episode_link:needs_contract", "edit:needs_contract", "review_adoption:needs_contract", "delivery:needs_contract"]);
    // Anatomia names no episode, so for one episode the station cannot be read at all.
    expect(cut.state).toBe("needs_contract");
    // For the whole project Anatomia's answer counts, yet the station is never whole without the other parts.
    const project = buildProductionLine({ scope: "scope-a", now, range: { kind: "project" }, tasks: [], tasksReadable: true, connections: allConnected, episodes: [], sources: [] });
    expect(stationOf(project, "cut")?.state).toBe("partial");
    expect(stationOf(project, "cut")?.gaps.map((gap) => gap.part)).toEqual(["edit", "review_adoption", "delivery"]);
  });

  it("reports an unreadable episode as unavailable instead of not started", () => {
    const line = buildProductionLine(episodeInput({ detail: null }));
    expect(stationOf(line, "story")).toMatchObject({ state: "unavailable", next: { actor: "agent", action: "inspect" } });
    expect(stationOf(line, "board")?.state).toBe("unavailable");
  });

  it("reads Auctra and Scaena outages per stage, and an unconnected owner as unconnected", () => {
    const down = buildProductionLine(episodeInput({ detail: detail(["unavailable", "unavailable", "unavailable", "unavailable", "unavailable"]) }));
    expect(stationOf(down, "story")?.state).toBe("unavailable");
    const mixed = buildProductionLine(episodeInput({ detail: detail(["accepted", "accepted", "accepted", "accepted", "needs_contract"], undefined, { production_breakdown: { blocker: "scaena_storyboard_binding_missing" } }) }));
    expect(stationOf(mixed, "board")).toMatchObject({ state: "partial", reason: "scaena_storyboard_binding_missing" });
    const none = buildProductionLine(episodeInput({ detail: detail(["needs_contract", "needs_contract", "accepted", "accepted", "accepted"], undefined, { screenplay: { blocker: "source_not_configured" }, director_plan: { blocker: "source_not_configured" } }) }));
    expect(stationOf(none, "story")).toMatchObject({ state: "unconnected", next: { actor: "human", action: "connect" } });
  });

  it("never shows an unreadable task source as an empty station", () => {
    const line = buildProductionLine(episodeInput({ tasksReadable: false }));
    for (const id of ["frames", "motion", "sound"] as const) expect(stationOf(line, id)).toMatchObject({ state: "unavailable", reason: "task_source_unavailable" });
    const unconnected = buildProductionLine(episodeInput({ connections: [] }));
    expect(stationOf(unconnected, "frames")).toMatchObject({ state: "unconnected", reason: "no_task_connection" });
    const refused = buildProductionLine(episodeInput({ connections: [connection("eikona", "needs_authorization")] }));
    expect(stationOf(refused, "frames")).toMatchObject({ state: "unavailable", reason: "needs_authorization" });
  });

  it("is empty only when the source answered and had nothing for this episode", () => {
    const line = buildProductionLine(episodeInput());
    // Scaena names episodes on its tasks, so an answer with nothing for this one really is empty.
    expect(stationOf(line, "motion")).toMatchObject({ state: "empty", counts: { total: 0 }, next: { actor: "agent", action: "generate_quote" } });
  });

  it("says an owner that never names episodes cannot be matched, instead of showing the episode as empty", () => {
    const line = buildProductionLine(episodeInput({ tasks: [task("eikona", "img-anywhere"), task("sonora", "aud-anywhere")] }));
    for (const id of ["frames", "sound"] as const) {
      const station = stationOf(line, id)!;
      expect(station, id).toMatchObject({ state: "needs_contract", reason: "episode_link_missing", counts: { total: 0 } });
      expect(station.gaps[0]).toMatchObject({ part: "episode_link", state: "needs_contract" });
    }
    // The agent can still make keyframes for the episode; nothing about that needs the link.
    expect(stationOf(line, "frames")?.next).toEqual({ actor: "agent", action: "generate_quote" });
    // Once every shot has a bound keyframe there is nothing left to ask for.
    const bound = buildProductionLine(episodeInput({ detail: detail(["accepted", "accepted", "accepted", "accepted", "accepted"], outline([{ ref: "s1", frame: "ready" }, { ref: "s2", frame: "ready" }])) }));
    expect(stationOf(bound, "frames")).toMatchObject({ state: "observed", next: null, shots: { total: 2, frames_ready: 2 } });
  });
});

describe("production line: episode range", () => {
  it("counts only tasks that name this episode by either owner's ref, and says how many name none", () => {
    const tasks = [
      task("eikona", "img-1", { episode_ref: "ep-01", results: [{ ref: "a-1", name: "a.png", mime: "image/png", bytes: 10, state: "complete" }] }),
      task("eikona", "img-2", { episode_ref: "ep-02" }),
      task("scaena", "vid-1", { episode_ref: "episode:01", state: "waiting_review" }),
      task("sonora", "aud-1"),
    ];
    const line = buildProductionLine(episodeInput({ tasks }));
    expect(stationOf(line, "frames")).toMatchObject({ state: "observed", counts: { total: 1, done: 1 } });
    expect(stationOf(line, "frames")?.results).toEqual([expect.objectContaining({ artifact_ref: "a-1", kind: "image", owner: "eikona" })]);
    expect(stationOf(line, "motion")).toMatchObject({ counts: { total: 1, waiting_review: 1 }, next: { actor: "human", action: "pick" } });
    expect(stationOf(line, "sound")).toMatchObject({ state: "needs_contract", reason: "episode_link_missing", counts: { total: 0 } });
    expect(line.unassigned_tasks).toBe(1);
  });

  it("puts an unknown outcome before a failure before a pick, and leaves reconciling an unknown to an agent", () => {
    const tasks = [
      task("eikona", "review", { episode_ref: "ep-01", state: "waiting_review", updated_at: "2026-11-06T07:59:00.000Z" }),
      task("eikona", "failed", { episode_ref: "ep-01", state: "failed" }),
      task("eikona", "unknown", { episode_ref: "ep-01", state: "unknown" }),
    ];
    const frames = stationOf(buildProductionLine(episodeInput({ tasks })), "frames")!;
    expect(frames.decisions.map((item) => item.kind)).toEqual(["unknown_task", "failed_task", "pick_result"]);
    // Picking is a person's call and comes first; the agent's reconcile waits behind it.
    expect(frames.next).toEqual({ actor: "human", action: "pick" });
    const onlyUnknown = stationOf(buildProductionLine(episodeInput({ tasks: [tasks[2]] })), "frames")!;
    expect(onlyUnknown.next).toEqual({ actor: "agent", action: "reconcile" });
  });

  it("carries shot readiness and bound keyframes from the outline, and counts bound frames as something observed", () => {
    const shots = outline([{ ref: "s1", frame: "ready", ready: true }, { ref: "s2", frame: "pending", ready: true }, { ref: "s3", frame: "pending", ready: false }]);
    const line = buildProductionLine(episodeInput({ detail: detail(["accepted", "accepted", "accepted", "accepted", "accepted"], shots) }));
    expect(stationOf(line, "board")?.shots).toEqual({ total: 3, generation_ready: 2, frames_ready: 1 });
    expect(stationOf(line, "frames")).toMatchObject({ state: "observed", shots: { frames_ready: 1 } });
    const silent = buildProductionLine(episodeInput({ detail: detail(["accepted", "accepted", "accepted", "accepted", "accepted"], outline([{ ref: "s1" }])) }));
    expect(stationOf(silent, "board")?.shots).toEqual({ total: 1 });
  });

  it("asks a person to review a stage waiting for review and points the line at it", () => {
    const line = buildProductionLine(episodeInput({ detail: detail(["accepted", "accepted", "waiting_review", "missing", "not_started"]) }));
    const board = stationOf(line, "board")!;
    expect(board.decisions).toEqual([expect.objectContaining({ kind: "stage_review", stage: "creative_storyboard" })]);
    expect(board.next).toEqual({ actor: "human", action: "review" });
    expect(line.current).toBe("board");
  });

  it("lets an agent draft a stage nobody started and treats an unaccepted screenplay as waiting, not broken", () => {
    const start = buildProductionLine(episodeInput({ detail: detail(["accepted", "not_started", "not_started", "not_started", "not_started"]) }));
    expect(stationOf(start, "story")?.next).toEqual({ actor: "agent", action: "draft" });
    const unaccepted = buildProductionLine(episodeInput({ detail: detail(["blocked", "not_started", "not_started", "not_started", "not_started"], undefined, { screenplay: { blocker: "source_not_accepted" } }) }));
    expect(stationOf(unaccepted, "story")?.counts.problem).toBe(0);
  });
});

describe("production line: project range", () => {
  const row = (ref: string, states: DramaRailStage["state"][], read: DramaEpisodeRow["read"] = "read"): DramaEpisodeRow => ({
    episode_ref: ref, title: `第 ${ref} 集`, origin: "collection", read,
    ...(read === "failed" ? {} : { flow: { coverage: "complete", observed_at: now, rail: rail(states), source_coverage: [] } }),
  });

  it("uses every task in scope, including ones that name no episode", () => {
    const tasks = [task("eikona", "a"), task("eikona", "b", { episode_ref: "ep-02" }), task("sonora", "c", { state: "running" })];
    const line = buildProductionLine({ scope: "scope-a", now, range: { kind: "project" }, tasks, tasksReadable: true, connections: allConnected, episodes: [], sources: [{ owner: "auctra", state: "binding_missing" }, { owner: "scaena", state: "target_missing" }] });
    expect(stationOf(line, "frames")?.counts.total).toBe(2);
    expect(stationOf(line, "sound")).toMatchObject({ counts: { running: 1 } });
    expect(stationOf(line, "story")).toMatchObject({ state: "unconnected", reason: "collection_binding_missing" });
    expect(stationOf(line, "board")).toMatchObject({ state: "unconnected" });
    expect(line.unassigned_tasks).toBeUndefined();
  });

  it("counts episodes once per station and lists the ones waiting on a person", () => {
    const episodes = [row("01", ["accepted", "accepted", "accepted", "accepted", "accepted"]), row("02", ["accepted", "accepted", "waiting_review", "missing", "not_started"]), row("03", [], "failed")];
    const line = buildProductionLine({ scope: "scope-a", now, range: { kind: "project" }, tasks: [], tasksReadable: true, connections: allConnected, episodes, sources: [{ owner: "auctra", state: "connected" }, { owner: "scaena", state: "connected" }] });
    const board = stationOf(line, "board")!;
    expect(board.counts).toMatchObject({ total: 2, waiting_review: 1, done: 1 });
    expect(board.state).toBe("partial");
    expect(board.decisions).toEqual([expect.objectContaining({ kind: "stage_review", ref: "02", stage: "creative_storyboard" })]);
    expect(stationOf(line, "story")).toMatchObject({ counts: { total: 2, done: 2 } });
  });

  it("is empty only when the connected collection has no episodes, and unavailable when the list failed", () => {
    const connected = [{ owner: "auctra" as const, state: "connected" as const }, { owner: "scaena" as const, state: "connected" as const }];
    expect(stationOf(buildProductionLine({ scope: "s", now, range: { kind: "project" }, tasks: [], tasksReadable: true, connections: allConnected, episodes: [], sources: connected }), "story")?.state).toBe("empty");
    expect(stationOf(buildProductionLine({ scope: "s", now, range: { kind: "project" }, tasks: [], tasksReadable: true, connections: allConnected, episodesReadable: false, sources: connected }), "story")?.state).toBe("unavailable");
  });
});

describe("production line: task source", () => {
  it("counts a read that returned coverage as answered, so one refused connection only costs its own station", () => {
    expect(taskSourceAnswered({ rows: [], connections: [], status: "forbidden" })).toBe(false);
    expect(taskSourceAnswered({ rows: [], connections: [], status: "empty" })).toBe(true);
    const refused = [connection("eikona", "forbidden"), connection("scaena"), connection("sonora"), connection("anatomia")];
    expect(taskSourceAnswered({ rows: [], connections: refused, status: "forbidden" })).toBe(true);
    const line = buildProductionLine(episodeInput({ connections: refused }));
    expect(stationOf(line, "frames")).toMatchObject({ state: "unavailable", reason: "forbidden" });
    expect(stationOf(line, "motion")?.state).toBe("empty");
  });

  it("says why every task station is unreadable when the read did not answer", () => {
    const line = buildProductionLine(episodeInput({ tasksReadable: false, tasksReason: "personal_connection_required" }));
    for (const id of ["frames", "motion", "sound", "cut"] as const) expect(stationOf(line, id), id).toMatchObject({ state: "unavailable", reason: "personal_connection_required" });
    expect(line.unassigned_tasks).toBeUndefined();
  });

  it("keeps episodes already read when the collection has since lost its connection", () => {
    const rows: DramaEpisodeRow[] = [{ episode_ref: "01", title: "一", origin: "collection", read: "cached", flow: { rail: rail(["accepted", "accepted", "accepted", "accepted", "accepted"]) } as DramaEpisodeRow["flow"] }];
    const line = buildProductionLine({ scope: "s", now, range: { kind: "project" }, tasks: [], tasksReadable: true, connections: allConnected, episodes: rows, sources: [{ owner: "auctra", state: "no_credential" }, { owner: "scaena", state: "no_credential" }] });
    expect(stationOf(line, "story")).toMatchObject({ state: "partial", reason: "delegation_unavailable", counts: { total: 1, done: 1 } });
  });
});

describe("production line: privacy", () => {
  it("carries refs and titles only, never prompts, bodies, URLs or handles", () => {
    const tasks = [task("eikona", "img-1", { episode_ref: "ep-01", work_url: "https://owner.example/secret", results: [{ ref: "a-1", name: "a.png", mime: "image/png", bytes: 10, state: "complete", thumbnail: { state: "ready", ref: "thumb-secret" } }], prompt_capture: { state: "captured", source: "task", readable: true, observed_at: now, summary: "SECRET-SUMMARY" } as unknown as TaskSnapshot["prompt_capture"] })];
    const serialized = JSON.stringify(buildProductionLine(episodeInput({ tasks })));
    for (const forbidden of ["https://", "thumb-secret", "SECRET-SUMMARY", "work_url", "prompt"]) expect(serialized).not.toContain(forbidden);
  });
});

describe("production line: Scaena's production summary", () => {
  const section = (state: "observed" | "needs_contract" | "unavailable", extra: Record<string, unknown> = {}) => ({ state, counts: {}, ...extra });
  const summary = (patch: Record<string, unknown> = {}, owners: Array<{ owner: string; resource_ref: string }> = []): NonNullable<ProductionInput["production"]> => ({
    state: "observed",
    observed_at: now,
    row: {
      episode_ref: "episode_workspace_01",
      production_episode_ref: "episode:01",
      version: 2,
      updated_at: now,
      owners: owners.map((o) => ({ ...o, purpose: "audio", version: "1", delegations: {} })),
      sections: {
        references: section("observed", { status: "complete", counts: { total: 9, disabled: 1, "kind:character": 8 } }),
        review: section("observed", { status: "reviewed", counts: { reviews: 2, critical_errors: 1 } }),
        edit: section("observed", { status: "bound", counts: { sessions: 1 } }),
        assembly: section("observed", { status: "completed", counts: { previews: 3 }, artifact_ref: "artifact:cut:ep-01:v3" }),
        delivery: section("needs_contract", { reason: "delivery_episode_link_missing" }),
        ...patch,
      } as never,
    },
  });

  it("counts the project's usable references on the look station and says they are project-wide", () => {
    const look = stationOf(buildProductionLine(episodeInput({ production: summary() })), "look")!;
    expect(look).toMatchObject({ state: "observed", reason: "project_scope", counts: { total: 8, done: 8 }, gaps: [] });
    expect(look.facts?.[0]).toMatchObject({ part: "references", project_scope: true });
    const unpublished = stationOf(buildProductionLine(episodeInput({ production: summary({ references: section("needs_contract", { reason: "reference_catalog_unpublished" }) }) })), "look")!;
    expect(unpublished).toMatchObject({ state: "needs_contract", reason: "reference_catalog_unpublished" });
  });

  it("turns observed cut parts into facts, keeps delivery as a gap, and stays partial while it does", () => {
    const cut = stationOf(buildProductionLine(episodeInput({ production: summary() })), "cut")!;
    expect(cut.facts?.map((fact) => fact.part)).toEqual(["edit", "review", "assembly"]);
    expect(cut.facts?.find((fact) => fact.part === "assembly")).toMatchObject({ artifact_ref: "artifact:cut:ep-01:v3" });
    expect(cut.gaps.map((gap) => `${gap.part}:${gap.reason}`)).toEqual(["episode_link:episode_link_missing", "delivery:delivery_episode_link_missing"]);
    const unbound = stationOf(buildProductionLine(episodeInput({ production: summary({ assembly: section("unavailable", { reason: "production_episode_unbound" }) }) })), "cut")!;
    expect(unbound.gaps.find((gap) => gap.part === "assembly")).toMatchObject({ state: "unavailable", reason: "production_episode_unbound" });
    // An owner without the operation leaves the three gaps exactly as before.
    const missing = stationOf(buildProductionLine(episodeInput({ production: { state: "needs_contract", reason: "episode_production_contract_missing" } })), "cut")!;
    expect(missing.gaps.map((gap) => gap.part)).toEqual(["episode_link", "edit", "review_adoption", "delivery"]);
    expect(missing.facts).toBeUndefined();
  });

  it("counts Eikona and Sonora tasks for the episode only through a binding Scaena recorded for it", () => {
    const tasks = [task("sonora", "sonora://voice/1", { owner_episode_ref: "sonora://episodes/e1" }), task("sonora", "sonora://voice/2", { owner_episode_ref: "sonora://episodes/e9" }), task("eikona", "run-7"), task("eikona", "run-8")];
    const unlinked = buildProductionLine(episodeInput({ tasks }));
    expect(stationOf(unlinked, "sound")).toMatchObject({ state: "needs_contract", reason: "episode_link_missing" });
    expect(unlinked.unassigned_tasks).toBe(4);
    const linked = buildProductionLine(episodeInput({ tasks, production: summary({}, [{ owner: "sonora", resource_ref: "sonora://episodes/e1" }, { owner: "eikona", resource_ref: "run-7" }]) }));
    expect(stationOf(linked, "sound")).toMatchObject({ state: "observed", counts: { total: 1 }, linked_by: "scaena_binding" });
    expect(stationOf(linked, "frames")).toMatchObject({ counts: { total: 1 }, linked_by: "scaena_binding" });
    expect(linked.unassigned_tasks).toBe(2);
    // A binding with nothing made under it yet is "nothing yet", not a missing link.
    const empty = buildProductionLine(episodeInput({ tasks: [], production: summary({}, [{ owner: "sonora", resource_ref: "sonora://episodes/e1" }]) }));
    expect(stationOf(empty, "sound")).toMatchObject({ state: "empty" });
    expect(stationOf(empty, "sound")?.linked_by).toBeUndefined();
  });
});

describe("production line: time", () => {
  const timed = (ref: string, wall: number, patch: Partial<TaskSnapshot> = {}) => task("scaena", ref, {
    episode_ref: "episode:01",
    timing: { run_ref: ref, phase: "run", operation: "video", status: "completed", started_at: "2026-11-06T07:00:00.000Z", ended_at: "2026-11-06T07:30:00.000Z", wall_duration_ms: wall, active_duration_ms: wall, queue_duration_ms: 0, blocked_duration_ms: null, human_wait_duration_ms: null, heartbeat_at: null, stall_after_ms: null, retry_count: 0 },
    ...patch,
  });

  it("gives story, look and board a missing contract, and task stations their owners' time", () => {
    const line = buildProductionLine(episodeInput({ tasks: [timed("a", 600_000), task("scaena", "b", { episode_ref: "episode:01" })] }));
    for (const id of ["story", "look", "board"] as const) expect(stationOf(line, id)?.time).toMatchObject({ state: "needs_contract" });
    const timedStation = line.stations.find((station) => station.time?.state === "observed" && station.time.rollup.timed);
    expect(timedStation?.time).toMatchObject({ state: "observed", rollup: { wall_ms: 600_000, timed: 1, total: 2 } });
    expect(line.time?.total).toMatchObject({ wall_ms: 600_000, timed: 1, total: 2 });
  });

  it("has no time at all when the task source was not read, rather than a zero", () => {
    const line = buildProductionLine(episodeInput({ tasksReadable: false }));
    expect(line.time).toBeUndefined();
    expect(stationOf(line, "frames")?.time).toBeUndefined();
  });

  it("keeps Scaena's whole-episode total apart, and says it is missing when the summary has none", () => {
    const missing = buildProductionLine(episodeInput({ tasks: [timed("a", 600_000)] }));
    expect(missing.time?.owner_total).toEqual({ state: "needs_contract", reason: "episode_timing_contract_missing" });
    const timing = { state: "observed" as const, run_count: 5, timed_run_count: 5, wall_duration_ms: 7_440_000, active_duration_ms: 1_860_000, queue_duration_ms: 480_000, blocked_duration_ms: null, human_wait_duration_ms: null, retry_count: 0, running: 0, stalled: 1, splits_recorded: false };
    const section = { state: "needs_contract" as const, counts: {} };
    const production = { state: "observed" as const, observed_at: now, row: { episode_ref: "episode_workspace_01", version: 1, updated_at: now, owners: [], sections: { references: section, review: section, edit: section, assembly: section, delivery: section }, timing } };
    const line = buildProductionLine(episodeInput({ tasks: [timed("a", 600_000)], production }));
    expect(line.time?.owner_total).toEqual({ state: "observed", timing });
    // The two are never added: the read-time total stays what the tasks say.
    expect(line.time?.total.wall_ms).toBe(600_000);
    const down = buildProductionLine(episodeInput({ production: { state: "unavailable", reason: "owner_timeout" } }));
    expect(down.time?.owner_total).toEqual({ state: "unavailable", reason: "owner_timeout" });
  });

  it("splits a project's time by the Scaena episode each task names and links rows to listed episodes", () => {
    const episodes: DramaEpisodeRow[] = [{ episode_ref: "ep-01", title: "第 1 集", origin: "collection", read: "read", flow: { coverage: "complete", observed_at: now, rail: rail(["accepted", "accepted", "accepted", "accepted", "accepted"]), source_coverage: [], scaena_episode_ref: "episode:01" } as never }];
    const tasks = [timed("a", 600_000), timed("b", 300_000, { episode_ref: "episode:09" }), task("eikona", "c")];
    const line = buildProductionLine({ scope: "scope-a", now, range: { kind: "project" }, tasks, tasksReadable: true, connections: allConnected, episodes });
    expect(line.time?.episodes?.map((row) => [row.episode_ref, row.time.wall_ms, row.drama_episode_ref ?? null])).toEqual([["episode:01", 600_000, "ep-01"], ["episode:09", 300_000, null]]);
    expect(line.time?.unattributed).toMatchObject({ wall_ms: null, timed: 0, total: 1 });
    expect(line.time?.total).toMatchObject({ wall_ms: 900_000, timed: 2, total: 3 });
  });
});
