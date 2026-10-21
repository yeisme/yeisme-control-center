import type { TaskSnapshot } from "../../task-observation";

export function taskNeedsReview(task: Pick<TaskSnapshot, "state" | "provider_recovery">) {
  return task.state === "waiting_review" || Boolean(task.provider_recovery?.review_status && task.provider_recovery.review_status !== "approved");
}

export function reviewLabel(task: Pick<TaskSnapshot, "state" | "provider_recovery">) {
  return task.provider_recovery?.review_status || (task.state === "waiting_review" ? "待审阅" : "未提供");
}

