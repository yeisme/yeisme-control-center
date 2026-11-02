import type { TaskSnapshot } from "./task-observation";

/** States that may open one in-app reminder per failure fingerprint. */
export const reminderStates = new Set(["failed", "partial_failed", "blocked", "unknown"]);

export function isReminderState(state: string) {
  return reminderStates.has(state);
}

/** The unsigned half of a task key: the same task even when a server restart re-signed its key. */
export function taskIdentityOf(taskKey: string) {
  return taskKey.split(".")[0] || "";
}

/**
 * The one definition of an unread reminder, shared with the server: not read, not handled (acknowledged, muted,
 * archived), not snoozed and not recovered. The sidebar badge, the bell and the reminders page all count this.
 */
export function countsAsUnread(item: { state: string; read_at?: string | null; snoozed_until?: string | null; recovered_at?: string | null }, now = Date.now()) {
  if (item.read_at || item.recovered_at || item.state !== "unread") return false;
  return !(item.snoozed_until && Date.parse(item.snoozed_until) > now);
}

export type ReminderGroup = "new" | "open" | "quiet" | "archived";

/** True while a reminder is snoozed: it stays unread but quiet until the time has passed. */
export function isSnoozed(item: { snoozed_until?: string | null }, now = Date.now()) {
  return !!item.snoozed_until && Date.parse(item.snoozed_until) > now;
}

export function reminderGroup(item: { state: string; priority: string; recovered_at?: string | null; snoozed_until?: string | null }, now = Date.now()): ReminderGroup {
  if (item.state === "archived") return "archived";
  if (item.state === "muted" || item.state === "snoozed" || isSnoozed(item, now) || item.recovered_at || item.priority === "history" || item.priority === "low") return "quiet";
  if (item.state === "unread" && item.priority === "normal") return "new";
  return "open";
}

/** A handled or snoozed reminder can be put back among the unread ones. */
export function canReopen(item: { state: string; snoozed_until?: string | null; recovered_at?: string | null }, now = Date.now()) {
  return !item.recovered_at && (item.state === "archived" || item.state === "acknowledged" || item.state === "muted" || item.state === "snoozed" || isSnoozed(item, now));
}

/** Only an unread reminder that has not recovered can be snoozed (the server refuses the rest). */
export function canSnooze(item: { state: string; recovered_at?: string | null }) {
  return item.state === "unread" && !item.recovered_at;
}

/**
 * Where a reminder comes from. A task failure (the default category) is about one task and has a failure version;
 * `operation` is a failed run of an open tool, `credential` a credential that needs attention, and the rest
 * (`generation_batch`, `project_assignment`) are project collaboration.
 */
export type ReminderKind = "failure" | "operation" | "credential" | "collaboration";

export function reminderKind(item: { category?: string }): ReminderKind {
  return !item.category || item.category === "failure" ? "failure" : item.category === "operation" ? "operation" : item.category === "credential" ? "credential" : "collaboration";
}

export const reminderKindLabels: Record<ReminderKind, string> = {
  failure: "任务失败",
  operation: "工具运行",
  credential: "凭据",
  collaboration: "项目协作",
};

/** Failure reminders carry the task's failure version (revision, error code, owner state); the others have no task. */
export const hasFailureVersion = (item: { category?: string }) => reminderKind(item) === "failure";

/** A state label that tells a snoozed reminder from an unread one. */
export function reminderStateLabel(item: { state: string; snoozed_until?: string | null }, now = Date.now()) {
  return isSnoozed(item, now) ? "稍后提醒" : reminderStateLabels[item.state] || item.state;
}

/** Where a snooze can be chosen to end: an hour from now, tomorrow morning, next Monday morning (local time). */
export interface SnoozeChoice {
  id: "hour" | "tomorrow" | "next-week";
  label: string;
  /** RFC 3339, in UTC. */
  until: string;
}

const morning = 9;
const snoozeLabels: Record<SnoozeChoice["id"], string> = { hour: "1 小时后", tomorrow: "明天上午", "next-week": "下周一上午" };

/**
 * When a snooze chosen at `now` ends. Work it out when the choice is made: a time worked out when a menu was drawn is
 * stale by the time a page that stayed open is used again (an hour that has gone by, a "tomorrow" that is today).
 */
export function snoozeUntil(id: SnoozeChoice["id"], now = new Date()): string {
  if (id === "hour") return new Date(now.getTime() + 3_600_000).toISOString();
  if (id === "tomorrow") return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, morning, 0, 0, 0).toISOString();
  // The coming Monday, a full week away when today is Monday.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday, morning, 0, 0, 0).toISOString();
}

export function snoozeChoices(now = new Date()): SnoozeChoice[] {
  return (Object.keys(snoozeLabels) as SnoozeChoice["id"][]).map((id) => ({ id, label: snoozeLabels[id], until: snoozeUntil(id, now) }));
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
export function countsAsHomeAttention(item: { category?: string; state: string; priority: string; presence?: string; snoozed_until?: string | null; recovered_at?: string | null }, now = Date.now()) {
  if (item.category && item.category !== "failure") return false;
  if (item.state !== "unread" || item.priority !== "normal" || item.presence === "stale" || item.recovered_at) return false;
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
