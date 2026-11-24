import { describe, expect, it } from "vitest";
import { actorOfRequest, actorOfTask, buildActivity } from "../src/shared/read-model/activity";
import type { TaskNotification } from "../src/shared/api/control-center-client";
import type { RequestProjection } from "../src/request-visibility";
import type { TaskOwner, TaskSnapshot } from "../src/task-observation";

const now = Date.parse("2026-11-06T15:00:00.000Z");
const today = "2026-11-06T09:00:00.000Z";
const yesterday = "2026-11-04T09:00:00.000Z";

const task = (owner: TaskOwner, ref: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  schema_version: "yeisme.task_observation.v1",
  locator: { owner, instance_id: "i", project: "p", task_family: "run", task_ref: ref },
  task_key: `${owner}:${ref}`,
  title: ref,
  state: "succeeded",
  native_state: "succeeded",
  stage: "succeeded",
  revision: "1",
  created_at: today,
  updated_at: today,
  observed_at: today,
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

const reminder = (id: string, patch: Partial<TaskNotification> = {}): TaskNotification => ({
  id, scope_id: "s", task_key: `eikona:${id}`, task_revision: "1", failure_fingerprint: "f", state: "unread", priority: "normal", presence: "live",
  task_state: "failed", native_state: "failed", title: id, owner: "eikona", project: "p", first_seen_at: today, last_seen_at: today,
  acknowledged_at: null, muted_at: null, archived_at: null, snoozed_until: null, last_error_code: "", reopened: false, ...patch,
});

const request = (id: string, patch: Partial<RequestProjection> = {}): RequestProjection => ({
  id, owner: "eikona", tenant: "t", project: "p", title: id, kind: "generation", state: "succeeded", native_state: "succeeded",
  actor: "", actor_type: "unknown", created_at: today, duration_ms: null, model: null, parent_ref: null, attempts: [], output_refs: [],
  attachments: [], input: "complete", output: "complete", submitted: {}, effective: {}, coverage: { owner: "eikona", state: "complete" } as RequestProjection["coverage"],
  ...patch,
});

describe("activity timeline", () => {
  it("puts running work under 现在, the rest by day, newest first", () => {
    const { groups } = buildActivity({
      now,
      tasks: [task("eikona", "old", { updated_at: yesterday }), task("scaena", "running", { state: "running", updated_at: yesterday }), task("sonora", "done")],
      reminders: [],
      requests: [],
    });
    expect(groups.now.map((event) => event.title)).toEqual(["running"]);
    expect(groups.today.map((event) => event.title)).toEqual(["done"]);
    expect(groups.earlier.map((event) => event.title)).toEqual(["old"]);
    expect(groups.now[0]).toMatchObject({ verb: "在跑", tone: "running", target: "/tasks?task=scaena%3Arunning" });
  });

  it("says unknown, failed and waiting in a person's words and never reads unknown as failed", () => {
    const { events } = buildActivity({ now, reminders: [], requests: [], tasks: [task("eikona", "u", { state: "unknown" }), task("eikona", "f", { state: "failed" }), task("eikona", "w", { state: "waiting_review" })] });
    const verb = (title: string) => events.find((event) => event.title === title)?.verb;
    expect([verb("u"), verb("f"), verb("w")]).toEqual(["结果未知，先回查", "没做成", "等你挑选"]);
  });

  it("names who did it only from a typed field, quotes a task's own text, and never guesses an agent", () => {
    expect(actorOfRequest({ actor: "小林", actor_type: "human" })).toEqual({ kind: "person", name: "小林", typed: true });
    expect(actorOfRequest({ actor: "batch-runner", actor_type: "service" })).toEqual({ kind: "service", name: "batch-runner", typed: true });
    expect(actorOfRequest({ actor: "", actor_type: "unknown" })).toEqual({ kind: "unknown", typed: false });
    // Free text that looks like an agent is quoted, not classified.
    expect(actorOfTask({ actor: "claude-code agent" })).toEqual({ kind: "unknown", name: "claude-code agent", typed: false });
    const { events } = buildActivity({ now, reminders: [], tasks: [task("eikona", "linked"), task("eikona", "bare", { actor: "codex" })], requests: [request("r-1", { task_ref: "linked", actor: "小林", actor_type: "human" }), request("r-2", { actor_type: "service", actor: "nightly" })] });
    expect(events.find((event) => event.title === "linked")?.actor).toEqual({ kind: "person", name: "小林", typed: true });
    expect(events.find((event) => event.title === "bare")?.actor).toEqual({ kind: "unknown", name: "codex", typed: false });
    // The request that names a task is folded into it; one that names none stays a request of its own.
    expect(events.map((event) => event.id).sort()).toEqual(["request:eikona:r-2", "task:eikona:bare", "task:eikona:linked"]);
    expect(events.some((event) => event.actor.kind === "agent")).toBe(false);
  });

  it("shows a reminded task once, as its reminder, and says what each kind of reminder is about", () => {
    const { events, groups } = buildActivity({
      now,
      tasks: [task("eikona", "r-fail", { state: "failed" })],
      reminders: [reminder("r-fail"), reminder("cred", { category: "credential", task_key: "credential:x" }), reminder("gone", { archived_at: today, state: "archived" }), reminder("back", { recovered_at: today, state: "acknowledged" })],
      requests: [],
    });
    expect(events.filter((event) => event.title === "r-fail").map((event) => event.source)).toEqual(["reminder"]);
    expect(events.find((event) => event.title === "cred")?.verb).toBe("提醒：凭据要处理");
    expect(events.find((event) => event.title === "back")).toMatchObject({ verb: "提醒：已经恢复", group: "today" });
    expect(events.some((event) => event.title === "gone")).toBe(false);
    expect(groups.now.map((event) => event.title).sort()).toEqual(["cred", "r-fail"]);
    expect(events.find((event) => event.title === "r-fail")?.target).toBe("/reminders?focus=r-fail");
  });

  it("folds repeated failure versions of one task into the current activity reminder", () => {
    const taskRow = task("eikona", "run-1", { task_key: "task-1.signature-2", state: "failed" });
    const older = reminder("older", {
      task_key: "task-1.signature-1",
      task_identity: "task-1",
      title: "旧失败版本",
      task_revision: "rev-1",
      last_seen_at: "2026-11-06T10:00:00.000Z",
      state: "acknowledged",
    });
    const current = reminder("current", {
      task_key: "task-1.signature-2",
      task_identity: "task-1",
      title: "当前失败版本",
      task_revision: "rev-2",
      last_seen_at: "2026-11-06T14:00:00.000Z",
    });
    const { events } = buildActivity({ now, tasks: [taskRow], reminders: [older, current, reminder("cred", { category: "credential", task_key: "credential:gateway" })], requests: [] });
    expect(events.filter((event) => event.source === "reminder").map((event) => event.title)).toEqual(["当前失败版本", "cred"]);
    expect(events.filter((event) => event.title === "run-1")).toHaveLength(0);
    expect(events.find((event) => event.title === "当前失败版本")?.task?.task_key).toBe(taskRow.task_key);
  });

  it("links a request to its owner-qualified row", () => {
    const { events } = buildActivity({ now, tasks: [], reminders: [], requests: [request("req/1", { owner: "sonora", state: "failed" })] });
    expect(events[0]).toMatchObject({ source: "request", verb: "没做成", target: "/requests?request=sonora%3Areq%2F1" });
  });
});
