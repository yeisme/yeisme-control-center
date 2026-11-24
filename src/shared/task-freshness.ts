import type { TaskSnapshot } from "../task-observation";

export const TASK_STALE_AFTER_MS = 15 * 60 * 1000;
export const TASK_EXPIRED_AFTER_MS = 2 * 60 * 60 * 1000;

export const activeTaskStates = new Set(["queued", "pending", "created", "running", "cancel_requested"]);

export type TaskFreshness = "fresh" | "stale" | "expired" | "unknown";
export type TaskFreshnessReason = "owner_update_old" | "owner_read_unavailable" | "timestamp_missing";

export interface TaskFreshnessProjection {
  control_center_freshness: TaskFreshness;
  control_center_freshness_reason?: TaskFreshnessReason;
}

export function taskActivityAt(task: Pick<TaskSnapshot, "updated_at" | "started_at" | "created_at">) {
  const value = task.updated_at || task.started_at || task.created_at;
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
}

/** Local liveness only; it never changes the owner state. */
export function projectTaskFreshness(
  task: Pick<TaskSnapshot, "state" | "updated_at" | "started_at" | "created_at">,
  now = Date.now(),
): TaskFreshnessProjection {
  if (!activeTaskStates.has(task.state)) return { control_center_freshness: "fresh" };
  const at = taskActivityAt(task);
  if (at === null) return { control_center_freshness: "unknown", control_center_freshness_reason: "timestamp_missing" };
  const age = Math.max(0, now - at);
  if (age >= TASK_EXPIRED_AFTER_MS) return { control_center_freshness: "expired", control_center_freshness_reason: "owner_update_old" };
  if (age >= TASK_STALE_AFTER_MS) return { control_center_freshness: "stale", control_center_freshness_reason: "owner_update_old" };
  return { control_center_freshness: "fresh" };
}

export function taskFreshnessLabel(value: TaskFreshness) {
  return value === "expired" ? "本地已过期" : value === "stale" ? "长时间未更新" : value === "unknown" ? "更新时间未知" : "状态新鲜";
}
