import { describe, expect, it } from "vitest";
import { TASK_EXPIRED_AFTER_MS, TASK_STALE_AFTER_MS, projectTaskFreshness } from "../src/shared/task-freshness";
import { NotificationStore, livenessFact } from "../server/notifications";
import { createMemoryDB } from "../server/db/client";
import type { TaskSnapshot } from "../src/task-observation";

const task = (extra: Partial<TaskSnapshot> = {}) => ({
  schema_version: "yeisme.task_observation.v1" as const,
  locator: { owner: "eikona" as const, instance_id: "i", project: "p", task_family: "run", task_ref: "run_20261105_081147_115031762" },
  title: "Long run",
  state: "running",
  native_state: "running",
  stage: "generating",
  revision: "1",
  created_at: "2026-11-05T08:11:47.000Z",
  updated_at: "2026-11-05T08:11:47.000Z",
  observed_at: "2026-11-05T08:11:47.000Z",
  started_at: "2026-11-05T08:11:47.000Z",
  progress: { kind: "indeterminate" as const, completed: null, total: null, percent: null },
  source: "owner",
  actor: null,
  parent_ref: null,
  results: [],
  allowed_actions: [],
  coverage: "complete" as const,
  task_key: "signed-task-key",
  connection_id: "connection-eikona",
  ...extra,
} satisfies TaskSnapshot);

describe("local task freshness", () => {
  const now = Date.parse("2026-11-05T10:11:47.000Z");

  it("keeps the owner state and classifies stale and expired locally", () => {
    expect(projectTaskFreshness(task({ updated_at: new Date(now - TASK_STALE_AFTER_MS + 1).toISOString() }), now)).toMatchObject({ control_center_freshness: "fresh" });
    expect(projectTaskFreshness(task({ updated_at: new Date(now - TASK_STALE_AFTER_MS).toISOString() }), now)).toMatchObject({ control_center_freshness: "stale", control_center_freshness_reason: "owner_update_old" });
    expect(projectTaskFreshness(task({ updated_at: new Date(now - TASK_EXPIRED_AFTER_MS).toISOString() }), now)).toMatchObject({ control_center_freshness: "expired" });
    expect(task({ state: "succeeded", updated_at: new Date(now - TASK_EXPIRED_AFTER_MS * 3).toISOString() })).toMatchObject({ state: "succeeded" });
  });

  it("does not infer liveness from a missing timestamp and emits only a local operation fact", () => {
    expect(projectTaskFreshness(task({ updated_at: null, started_at: null, created_at: "" }), now).control_center_freshness).toBe("unknown");
    const fact = livenessFact("scope-a", task(), now);
    expect(fact).toMatchObject({ category: "operation", error_code: "task_liveness_expired", task_key: "signed-task-key", task_identity: expect.any(String) });
    expect(fact?.state).toBe("running");
  });

  it("stores a direct task path for liveness reminders", () => {
    const fact = livenessFact("scope-a", task(), now)!;
    const store = new NotificationStore(createMemoryDB());
    store.sync({ scopeId: "scope-a", sessionId: "session", subject: "test|admin", observed: [fact], presentTaskKeys: ["signed-task-key"], complete: false, now: new Date(now).toISOString() });
    expect(store.list("scope-a", "session", "test|admin")[0]).toMatchObject({ category: "operation", target_path: "/tasks?task=signed-task-key", task_state: "running" });
  });
});
