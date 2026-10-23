import type { TaskSnapshot } from "./task-observation";

/** States that may open one in-app reminder per failure fingerprint. */
export const reminderStates = new Set(["failed", "partial_failed", "blocked", "unknown"]);

export function isReminderState(state: string) {
  return reminderStates.has(state);
}

export function failureFingerprint(scopeId: string, task: Pick<TaskSnapshot, "task_key" | "state" | "revision" | "native_state" | "provider_recovery">) {
  return [
    scopeId,
    task.task_key || "",
    task.state,
    task.revision || "",
    task.native_state || "",
    task.provider_recovery?.error_code || "",
  ].join("\u001f");
}

export type ReminderGroup = "new" | "open" | "quiet" | "archived";

export function reminderGroup(item: { state: string; priority: string }): ReminderGroup {
  if (item.state === "archived") return "archived";
  if (item.state === "muted" || item.state === "snoozed" || item.priority === "history" || item.priority === "low") return "quiet";
  if (item.state === "unread" && item.priority === "normal") return "new";
  return "open";
}

export const reminderStateLabels: Record<string, string> = {
  unread: "未查看",
  acknowledged: "已确认",
  muted: "已免提醒",
  snoozed: "暂时降噪",
  archived: "已归档",
};

export const reminderGroupLabels: Record<ReminderGroup, string> = {
  new: "新失败",
  open: "需要处理",
  quiet: "已降噪",
  archived: "已归档",
};

/** Compact, human-readable version context without exposing the raw fingerprint. */
export function failureVersionLabel(item: { task_revision?: string; last_error_code?: string; native_state?: string }) {
  const parts = [
    item.task_revision ? `revision ${item.task_revision}` : "revision 未提供",
    item.last_error_code ? `错误码 ${item.last_error_code}` : "错误码未提供",
    item.native_state ? `owner ${item.native_state}` : "owner 状态未提供",
  ];
  return parts.join(" · ");
}

/** Home attention counts only fresh unread reminders, not every historical failure. */
export function countsAsHomeAttention(item: { category?: string; state: string; priority: string; presence?: string; snoozed_until?: string | null }, now = Date.now()) {
  if (item.category && item.category !== "failure") return false;
  if (item.state !== "unread" || item.priority !== "normal" || item.presence === "stale") return false;
  if (item.snoozed_until && Date.parse(item.snoozed_until) > now) return false;
  return true;
}

/** Terminal failures are swept locally. Running tasks may only be safely cancelled. */
export function taskAllowsSafeCancel(task: Pick<TaskSnapshot, "state" | "allowed_actions">) {
  if (!["queued", "pending", "created", "running", "cancel_requested"].includes(task.state)) return false;
  return task.allowed_actions.some((action) => action.action === "cancel" && action.enabled);
}

export function taskDeleteAvailable() {
  return false;
}
