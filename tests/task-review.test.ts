import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskConnections } from "../server/task-connections";
import { TaskReviewReader, taskReviewCacheMs } from "../server/task-review";
import { normalizeTaskReview, stationReviewKeys, taskAwaitsPick, type TaskReviewRead } from "../src/shared/task-review";
import { buildProductionLine, stationOf, type ProductionInput } from "../src/shared/production-line";
import { ownerReviewText } from "../src/shared/read-model/production";
import { taskRow } from "../scripts/fixtures/world";
import { taskReviewObservation } from "../scripts/fixtures/task-review-world";
import type { ScopeBinding, ServerConfig, TaskConnection } from "../server/contracts";
import type { TaskConnectionState, TaskSnapshot } from "../src/task-observation";

const root = mkdtempSync(join(tmpdir(), "task-review-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const secret = join(root, "secret");
writeFileSync(secret, "test-observer-credential", { mode: 0o600 });

const connection: TaskConnection = { id: "ek", owner: "eikona", instance_id: "test", label: "Eikona", environment: "test", project: "p", endpoint: "http://127.0.0.1:1234/mcp", credential_ref: secret, allow_private_http: true, enabled: true };
const scope: ScopeBinding = { id: "s", tenant: "personal", team: "", project: "p", label: "P", connection_ids: ["ek"], owners: {} };
const config: ServerConfig = { origin: "http://127.0.0.1", port: 1, principals: [], owners: {}, connections: [connection] };

const answer = (patch: Record<string, unknown> = {}) => ({
  schema_version: "yeisme.task_review_observation.v1", task_ref: "run-1", task_family: "run", owner_decision: "pending", admission: "unknown",
  candidate_count: 2, decided_count: 0, pending_count: 2, revision: 0, observed_at: "2026-11-07T01:00:00Z", ...patch,
});

/** An Eikona MCP endpoint with one waiting run; `review` decides what `control_center.tasks.review` returns. */
function eikona(review: (args: any) => unknown) {
  const calls: { action: string; args: any; url: string }[] = [];
  const row = taskRow({ owner: "eikona", connection: "ek", project: "p", family: "run", ref: "run-1", title: "t", state: "waiting_review", stage: "waiting_review", createdMinutes: 5, updatedMinutes: 1 });
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
    const { action, args } = body.params.arguments;
    calls.push({ action, args, url: String(url) });
    if (action === "control_center.tasks.list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { result: { data: { rows: args.mode === "active" ? [] : [row] } } } } });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: review(args) });
  }) as typeof fetch;
  return { calls, fetcher };
}

async function keyOf(tasks: TaskConnections) {
  const page = await tasks.list(scope, "history");
  const key = page.rows.find((row) => row.locator.task_ref === "run-1")?.task_key;
  if (!key) throw new Error("no task key");
  return key;
}

describe("task review: normalize", () => {
  it("keeps the decision, admission and counts, and nothing else", () => {
    const read = normalizeTaskReview(answer({ owner_decision: "accepted", decided_count: 1, pending_count: 1, revision: 1, decided_at: "2026-11-07T00:30:00Z", decided_by: "someone", reason: "private" }), "run-1", "t");
    expect(read).toEqual({ state: "observed", observed_at: "2026-11-07T01:00:00Z", review: { owner_decision: "accepted", admission: "unknown", candidate_count: 2, decided_count: 1, pending_count: 1, revision: 1, decided_at: "2026-11-07T00:30:00Z" } });
    expect(JSON.stringify(read)).not.toMatch(/someone|private/);
  });

  it("refuses another run, another schema, an unknown decision, a foreign family or counts that do not add up", () => {
    expect(normalizeTaskReview(answer(), "run-2", "t")).toBeUndefined();
    expect(normalizeTaskReview(answer({ schema_version: "yeisme.other.v1" }), "run-1", "t")).toBeUndefined();
    expect(normalizeTaskReview(answer({ owner_decision: "stale" }), "run-1", "t")).toBeUndefined();
    expect(normalizeTaskReview(answer({ task_family: "video" }), "run-1", "t")).toBeUndefined();
    expect(normalizeTaskReview(answer({ pending_count: 1 }), "run-1", "t")).toBeUndefined();
    expect(normalizeTaskReview(answer({ revision: -1 }), "run-1", "t")).toBeUndefined();
  });

  it("serves fixture answers the same normalizer accepts, and none for a connection without the action", () => {
    const spec = { ref: "run-1", family: "run", state: "succeeded", updatedMinutes: 3, results: [{}, {}] };
    expect(normalizeTaskReview(taskReviewObservation("fx-eikona", spec, "run"), "run-1", "t")).toMatchObject({ state: "observed", review: { owner_decision: "accepted", pending_count: 1 } });
    expect(normalizeTaskReview(taskReviewObservation("fx-eikona", { ...spec, state: "waiting_review" }, undefined), "run-1", "t")).toMatchObject({ review: { owner_decision: "pending", pending_count: 2 } });
    expect(taskReviewObservation("fx-eikona-coast", spec, "run")).toBeNull();
    expect(taskReviewObservation("fx-eikona", spec, "video")).toBeNull();
  });
});

describe("task review: who waits to be picked", () => {
  const waiting = { state: "waiting_review", provider_recovery: undefined };
  const done = { state: "succeeded", provider_recovery: undefined };
  const observed = (patch: Record<string, unknown>): TaskReviewRead => normalizeTaskReview(answer(patch), "run-1", "t")!;

  it("follows Eikona's decision when it answered, and the task state otherwise", () => {
    expect(taskAwaitsPick(done, observed({}))).toBe(true);
    expect(taskAwaitsPick(waiting, observed({ owner_decision: "accepted", decided_count: 1, pending_count: 1 }))).toBe(false);
    expect(taskAwaitsPick(waiting, observed({ candidate_count: 0, pending_count: 0 }))).toBe(false);
    expect(taskAwaitsPick(waiting, { state: "needs_contract", reason: "review_observation_contract_missing" })).toBe(true);
    expect(taskAwaitsPick(done)).toBe(false);
  });
});

describe("task review: frames station", () => {
  const now = "2026-11-07T02:00:00.000Z";
  const task = (ref: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
    schema_version: "yeisme.task_observation.v1", locator: { owner: "eikona", instance_id: "i", project: "p", task_family: "run", task_ref: ref }, task_key: `key-${ref}`, connection_id: "c-eikona",
    title: ref, state: "succeeded", native_state: "succeeded", stage: "succeeded", revision: "1", created_at: "2026-11-07T01:00:00.000Z", updated_at: "2026-11-07T01:30:00.000Z", observed_at: now,
    started_at: null, progress: { kind: "indeterminate", completed: null, total: null, percent: null }, source: "", actor: null, parent_ref: null, results: [], allowed_actions: [], coverage: "complete", ...patch,
  });
  const connections: TaskConnectionState[] = [{ id: "c-eikona", owner: "eikona", instance_id: "i", label: "Eikona", environment: "test", project: "p", state: "ready", observed_at: now }];
  const image = (ref: string) => [{ ref, name: `${ref}.png`, mime: "image/png", bytes: 10, state: "candidate" }];
  const input = (tasks: TaskSnapshot[], reviews?: Record<string, TaskReviewRead>): ProductionInput => ({ scope: "s", now, range: { kind: "project" }, tasks, tasksReadable: true, connections, ...(reviews ? { reviews } : {}) });
  const tasks = [
    task("waiting", { state: "waiting_review", results: image("w"), updated_at: "2026-11-07T01:50:00.000Z" }),
    task("decided", { state: "waiting_review", results: image("d"), updated_at: "2026-11-07T01:40:00.000Z" }),
    task("finished", { results: image("f") }),
  ];

  it("asks about the tasks the station shows: picks first, then the tasks behind its results", () => {
    expect(stationReviewKeys(stationOf(buildProductionLine(input(tasks)), "frames"))).toEqual(["key-waiting", "key-decided", "key-finished"]);
    expect(stationReviewKeys(undefined)).toEqual([]);
  });

  it("drops a pick Eikona already decided, adds one it says is waiting, and says what it read", () => {
    const reviews: Record<string, TaskReviewRead> = {
      "key-decided": normalizeTaskReview(answer({ task_ref: "decided", owner_decision: "rejected", decided_count: 2, pending_count: 0, revision: 1 }), "decided", "t")!,
      "key-finished": normalizeTaskReview(answer({ task_ref: "finished", candidate_count: 1, pending_count: 1 }), "finished", "t")!,
      "key-waiting": { state: "needs_contract", reason: "review_observation_contract_missing" },
    };
    const frames = stationOf(buildProductionLine(input(tasks, reviews)), "frames")!;
    expect(frames.decisions.filter((d) => d.kind === "pick_result").map((d) => d.ref)).toEqual(["waiting", "finished"]);
    expect(frames.counts.waiting_review).toBe(2);
    expect(frames.next).toEqual({ actor: "human", action: "pick" });
    expect(frames.owner_review).toEqual({ awaiting: 1, decided: 1, unread: 1, reason: "review_observation_contract_missing" });
    expect(ownerReviewText(frames.owner_review!)).toBe("Eikona 审阅记录：1 个任务待挑选，1 个已有决定；1 个任务的审阅状态待接通");
    // Without any review read the station is what it was.
    const plain = stationOf(buildProductionLine(input(tasks)), "frames")!;
    expect(plain.owner_review).toBeUndefined();
    expect(plain.decisions.filter((d) => d.kind === "pick_result").map((d) => d.ref)).toEqual(["waiting", "decided"]);
  });

  it("leaves the other stations to their task states", () => {
    const motion = task("vid", { locator: { owner: "scaena", instance_id: "i", project: "p", task_family: "delegation", task_ref: "vid" }, state: "waiting_review", connection_id: "c-scaena" });
    const line = buildProductionLine({ ...input([motion], { "key-vid": normalizeTaskReview(answer({ task_ref: "vid", owner_decision: "accepted", decided_count: 2, pending_count: 0 }), "vid", "t")! }), connections: [...connections, { ...connections[0], id: "c-scaena", owner: "scaena" }] });
    expect(stationOf(line, "motion")?.counts.waiting_review).toBe(1);
    expect(stationOf(line, "motion")?.owner_review).toBeUndefined();
  });
});

describe("task review: reader", () => {
  it("asks the task's own Eikona connection with the observer key, never in the address, and caches the answer", async () => {
    const owner = eikona(() => ({ structuredContent: { result: { data: answer() } } }));
    let now = 1_000;
    const tasks = new TaskConnections(config, owner.fetcher);
    const key = await keyOf(tasks);
    const reader = new TaskReviewReader({ tasks, now: () => now });
    expect((await reader.readMany(scope, [key, key]))[key]).toMatchObject({ state: "observed", review: { owner_decision: "pending", pending_count: 2 } });
    const reviews = owner.calls.filter((call) => call.action === "control_center.tasks.review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0].args).toEqual({ task_ref: "run-1", task_family: "run", project_id: "p" });
    expect(reviews[0].url).not.toContain("test-observer-credential");
    await reader.readMany(scope, [key]);
    expect(owner.calls.filter((call) => call.action === "control_center.tasks.review")).toHaveLength(1);
    now += taskReviewCacheMs + 1;
    await reader.readMany(scope, [key]);
    expect(owner.calls.filter((call) => call.action === "control_center.tasks.review")).toHaveLength(2);
  });

  it("reads an Eikona without the action as needs_contract and a malformed answer as unavailable", async () => {
    const unknown = eikona(() => ({ isError: true, structuredContent: { error: { code: "UNKNOWN_ACTION" } } }));
    const tasks = new TaskConnections(config, unknown.fetcher);
    const key = await keyOf(tasks);
    expect((await new TaskReviewReader({ tasks }).readMany(scope, [key]))[key]).toEqual({ state: "needs_contract", reason: "review_observation_contract_missing" });
    const malformed = eikona(() => ({ structuredContent: { result: { data: answer({ task_ref: "run-9" }) } } }));
    const other = new TaskConnections(config, malformed.fetcher);
    const otherKey = await keyOf(other);
    expect((await new TaskReviewReader({ tasks: other }).readMany(scope, [otherKey]))[otherKey]).toEqual({ state: "unavailable", reason: "invalid_owner_response" });
  });

  it("a refusal of the review read does not cut the connection off from task reads", async () => {
    const owner = eikona(() => ({ structuredContent: { error: { code: "AUTH_ACTION_DENIED" } } }));
    const tasks = new TaskConnections(config, owner.fetcher);
    const key = await keyOf(tasks);
    expect((await new TaskReviewReader({ tasks }).readMany(scope, [key]))[key]).toEqual({ state: "needs_contract", reason: "review_observation_contract_missing" });
    const page = await tasks.list(scope, "history");
    expect(page.connections.find((c) => c.id === "ek")?.state).not.toBe("needs_authorization");
    expect(page.rows).toHaveLength(1);
  });

  it("refuses an empty batch, more than ten keys, and a key from another scope, before asking anyone", async () => {
    const owner = eikona(() => ({ structuredContent: { result: { data: answer() } } }));
    const tasks = new TaskConnections(config, owner.fetcher);
    const key = await keyOf(tasks);
    const reader = new TaskReviewReader({ tasks });
    await expect(reader.readMany(scope, [])).rejects.toMatchObject({ code: "invalid_task_key", status: 400 });
    await expect(reader.readMany(scope, Array.from({ length: 11 }, (_, i) => `${key}${i}`))).rejects.toMatchObject({ status: 400 });
    await expect(reader.readMany({ ...scope, id: "other" }, [key])).rejects.toMatchObject({ code: "task_not_found", status: 404 });
    await expect(reader.readMany(scope, ["forged.key"])).rejects.toMatchObject({ status: 404 });
    expect(owner.calls.filter((call) => call.action === "control_center.tasks.review")).toHaveLength(0);
  });
});
