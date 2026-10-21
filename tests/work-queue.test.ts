import { describe, expect, it } from "vitest";
import { buildWorkQueue, filterAndPageWorkQueue } from "../server/work-queue";
import type { ScopeBinding, Session } from "../server/contracts";
import type { TaskSnapshot, TaskConnectionState } from "../src/task-observation";
import { sortWorkQueueItems, type WorkQueueItem } from "../src/shared/work-queue";

const scope: ScopeBinding = {
  id: "scope:one",
  tenant: "tenant:one",
  team: "team:one",
  project: "project:one",
  label: "测试范围",
  owners: {},
  collection: { auctra: { tenant: "tenant:one", project: "project:one", actor: "actor:one", audience: "audience:auctra" } },
};

const session: Session = {
  id: "session:one",
  issuer: "issuer:one",
  subject: "subject:one",
  name: "测试用户",
  accessToken: "",
  accessAudience: [],
  expires: Date.now() + 60_000,
  csrf: "csrf",
  personal: true,
  epoch: 4,
};

function task(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    schema_version: "yeisme.task_observation.v1",
    locator: { owner: "eikona", instance_id: "instance:one", project: "project:one", task_family: "image", task_ref: "task:one" },
    task_key: "task:one",
    title: "测试任务",
    state: "failed",
    native_state: "failed",
    stage: "complete",
    revision: "rev:one",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:01:00.000Z",
    observed_at: "2026-10-20T00:01:00.000Z",
    started_at: "2026-10-20T00:00:10.000Z",
    progress: { kind: "indeterminate", completed: null, total: null, percent: null },
    source: "fixture",
    actor: "actor:one",
    parent_ref: null,
    results: [],
    allowed_actions: [],
    coverage: "complete",
    ...overrides,
  };
}

function connection(overrides: Partial<TaskConnectionState> = {}): TaskConnectionState {
  return {
    id: "connection:one",
    owner: "sonora",
    instance_id: "instance:sonora",
    label: "Sonora",
    environment: "fixture",
    project: "project:one",
    state: "needs_contract",
    observed_at: "2026-10-20T00:02:00.000Z",
    ...overrides,
  };
}

describe("work queue projection", () => {
  it("derives failure, review, handoff, source blocker and contract-gap items", () => {
    const response = buildWorkQueue({
      scope,
      session,
      tasks: [
        task(),
        task({ task_key: "task:review", state: "waiting_review", native_state: "waiting_review", title: "待审阅", locator: { ...task().locator, task_ref: "task:review" } }),
        task({ task_key: "task:handoff", state: "handoff_ready", native_state: "handoff_ready", title: "待交接", locator: { ...task().locator, task_ref: "task:handoff" } }),
      ],
      connections: [connection()],
      notifications: [],
    }, Date.parse("2026-10-20T00:04:00.000Z"));

    expect(response.schema_version).toBe("yeisme.work_queue.v1");
    expect(response.epoch).toBe(4);
    expect(response.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
      "task_failure",
      "review_required",
      "handoff_ready",
      "contract_gap",
    ]));
    expect(response.counts.contract_gap).toBeGreaterThan(0);
  });

  it("does not duplicate a live task when a matching reminder exists", () => {
    const response = buildWorkQueue({
      scope,
      session,
      tasks: [task()],
      connections: [],
      notifications: [{
        id: "notification:one",
        scope_id: scope.id,
        session_id: session.id,
        subject: session.subject,
        task_key: "task:one",
        task_revision: "rev:one",
        failure_fingerprint: "fingerprint",
        state: "unread",
        priority: "normal",
        presence: "live",
        task_state: "failed",
        native_state: "failed",
        title: "同一任务提醒",
        owner: "eikona",
        project: "project:one",
        first_seen_at: "2026-10-20T00:00:00.000Z",
        last_seen_at: "2026-10-20T00:01:00.000Z",
        acknowledged_at: null,
        muted_at: null,
        archived_at: null,
        snoozed_until: null,
        last_error_code: "same_failure",
        reopened: false,
      }],
    });
    expect(response.items.filter((item) => item.source_ref === "task:one")).toHaveLength(1);
  });

  it("sorts by risk before freshness and binds paging to filtered items", () => {
    const items = [
      { work_ref: "low", kind: "handoff_ready", owner: "auctra", project: "p", scope_id: "s", title: "low", state: "handoff_ready", native_state: "handoff_ready", priority: "normal", attention_reason: "", observed_at: "2026-10-20T00:10:00Z", freshness: "fresh", coverage: "complete", revision: "", source_ref: "low", safe_links: [], allowed_actions: [], preview_state: "needs_contract" },
      { work_ref: "high", kind: "task_unknown", owner: "eikona", project: "p", scope_id: "s", title: "high", state: "unknown", native_state: "unknown", priority: "critical", attention_reason: "", observed_at: "2026-10-20T00:01:00Z", freshness: "fresh", coverage: "unknown", revision: "", source_ref: "high", safe_links: [], allowed_actions: [], preview_state: "not_applicable" },
    ] as WorkQueueItem[];
    expect(sortWorkQueueItems(items).map((item) => item.work_ref)).toEqual(["high", "low"]);
    const response = { schema_version: "yeisme.work_queue.v1" as const, epoch: 1, scope: "s", observed_at: "2026-10-20T00:00:00Z", coverage: { state: "complete" as const, observed_at: "2026-10-20T00:00:00Z", sources: [] }, counts: { total: 2, actionable: 2, blocked: 1, review_required: 0, unknown: 1, handoff_ready: 1, stale: 0, contract_gap: 0 }, items };
    const page = filterAndPageWorkQueue(response, { kind: "task_unknown" }, 0, 1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.work_ref).toBe("high");
    expect(page.next_offset).toBeUndefined();
  });
});
