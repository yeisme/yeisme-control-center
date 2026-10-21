import { expect, it } from "vitest";
import { combineTaskPages, mergeConnectionObservations, mergeTaskObservation, readTaskPages } from "../src/task-polling";
import { contentActionEnabled, type ConnectionObservation, type TaskPage, type TaskSnapshot } from "../src/task-observation";

const runtime: ConnectionObservation = {
  state: "ready", checked_at: "2026-10-11T00:00:00Z", last_success_at: null,
  transport: "verified", authorization: "verified", contract: "supported", task_families: [], content: "supported",
};
const actions: TaskSnapshot["allowed_actions"] = [
  { action: "preview", enabled: true }, { action: "download", enabled: true }, { action: "cancel", enabled: true },
];
function task(connection: string): TaskSnapshot {
  return {
    schema_version: "yeisme.task_observation.v1", connection_id: connection, task_key: connection,
    locator: { owner: "eikona", instance_id: "instance", project: "project", task_family: "image", task_ref: connection },
    title: connection, state: "succeeded", native_state: "succeeded", stage: "complete", revision: "1",
    created_at: "2026-10-11T00:00:00Z", updated_at: null, observed_at: "2026-10-11T00:00:00Z", started_at: null,
    progress: { kind: "indeterminate", completed: null, total: null, percent: null }, source: "test",
    actor: null, parent_ref: null, results: [], allowed_actions: actions, coverage: "complete",
  };
}
const page: TaskPage = {
  rows: [task("c1"), task("c2")],
  connections: ["c1", "c2"].map((id) => ({
    id, owner: "eikona", instance_id: "instance", label: id, environment: "test", project: "project",
    state: "ready", observed_at: "", runtime,
  })),
  next_cursors: {},
};

it("requires supported content and the separately enabled action", () => {
  for (const content of [undefined, "not_requested", "not_verified", "unsupported", "denied"] as const) {
    expect(contentActionEnabled(actions, content, "preview")).toBe(false);
    expect(contentActionEnabled(actions, content, "download")).toBe(false);
  }
  expect(contentActionEnabled(actions, "supported", "preview")).toBe(true);
  expect(contentActionEnabled([], "supported", "preview")).toBe(false);
  expect(contentActionEnabled([{ action: "download", enabled: false }], "supported", "download")).toBe(false);
});

it("merges runtime by connection id and removes only explicitly unauthorized rows", () => {
  const result = mergeConnectionObservations(page, [
    { ...page.connections[0], runtime: { ...runtime, content: "not_requested" } },
    { ...page.connections[1], state: "needs_authorization" },
  ]);
  expect(result.rows.map((row) => row.task_key)).toEqual(["c1"]);
  expect(result.connections[0].runtime?.content).toBe("not_requested");
  expect(result.rows[0].allowed_actions.map((action) => action.enabled)).toEqual([false, false, true]);
});

it("preserves a fresh task denial when the cached observation still says ready", () => {
  const deniedPage = { ...page, connections: page.connections.map((connection) => ({ ...connection, state: "needs_authorization" })) };
  const result = mergeConnectionObservations(deniedPage, page.connections);
  expect(result.rows).toEqual([]);
  expect(result.connections.every((connection) => connection.state === "needs_authorization")).toBe(true);
  expect(mergeTaskObservation(page, result).rows).toEqual([]);
});

it("preserves task snapshots but drops stale content facts and both actions on observation failure", () => {
  const result = mergeConnectionObservations(page, []);
  expect(result.rows.map((row) => row.task_key)).toEqual(["c1", "c2"]);
  expect(result.connections.every((connection) => connection.runtime === undefined)).toBe(true);
  for (const row of result.rows) expect(row.allowed_actions.map((action) => action.enabled)).toEqual([false, false, true]);
  expect(page.rows[0].allowed_actions).toEqual(actions);
});

it("treats missing runtime as unavailable even when the connection itself is ready", () => {
  const result = mergeConnectionObservations(page, page.connections.map((connection) => ({ ...connection, runtime: undefined })));
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0].allowed_actions.map((action) => action.enabled)).toEqual([false, false, true]);
});

it("applies unavailable gates to retained rows after a failed task observation", () => {
  const unavailable = { ...page, rows: [], connections: page.connections.map((connection) => ({ ...connection, state: "source_unavailable" })) };
  const result = mergeConnectionObservations(mergeTaskObservation(page, unavailable), []);
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0].allowed_actions.map((action) => action.enabled)).toEqual([false, false, true]);
});

it("never revives denied rows from a later page in the same observation", async () => {
  let calls = 0;
  const result = await readTaskPages(async () => ++calls === 1 ? {
    ...page,
    connections: page.connections.map((connection) => ({ ...connection, state: "needs_authorization" })),
    next_cursors: { c1: "next" },
  } : page);
  expect(result.rows).toEqual([]);
  expect(calls).toBe(2);
});

it("keeps lane-specific coverage when history lacks an owner contract", () => {
  const active = {
    ...page,
    rows: [task("active")],
    connections: page.connections.map((connection) => ({
      ...connection,
      channels: { active: { state: "ready", observed_at: "2026-10-11T00:00:00Z" } },
    })),
  };
  const history: TaskPage = {
    rows: [],
    connections: page.connections.map((connection) => ({
      ...connection,
      state: "needs_contract",
      channels: { history: { state: "needs_contract", reason: "owner_action_contract_missing", observed_at: "2026-10-11T00:00:01Z" } },
    })),
    next_cursors: {},
  };
  const combined = combineTaskPages(active, history);
  expect(combined.rows.map((row) => row.task_key)).toEqual(["active"]);
  expect(combined.connections[0].channels).toMatchObject({
    active: { state: "ready" },
    history: { state: "needs_contract" },
  });
});
