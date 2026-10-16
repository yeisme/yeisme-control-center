export const taskOwners = ["eikona", "sonora", "scaena"] as const;
export type TaskOwner = (typeof taskOwners)[number];
export interface TaskLocator {
  owner: TaskOwner;
  instance_id: string;
  project: string;
  task_family: string;
  task_ref: string;
}
export interface TaskProgress {
  kind: "indeterminate" | "count" | "percent";
  completed: number | null;
  total: number | null;
  percent: number | null;
}
export interface TaskArtifact {
  ref: string;
  name: string;
  mime: string;
  bytes: number | null;
  state: string;
  width?: number;
  height?: number;
  duration_ms?: number;
}
export interface TaskSnapshot {
  schema_version: "yeisme.task_observation.v1";
  locator: TaskLocator;
  task_key?: string;
  connection_id?: string;
  title: string;
  state: string;
  native_state: string;
  stage: string;
  revision: string;
  created_at: string;
  updated_at: string | null;
  observed_at: string;
  started_at: string | null;
  progress: TaskProgress;
  source: string;
  actor: string | null;
  parent_ref: string | null;
  episode_ref?: string;
  work_url?: string;
  results: TaskArtifact[];
  allowed_actions: {
    action: "cancel" | "preview" | "download";
    enabled: boolean;
    reason?: string;
  }[];
  coverage: "complete" | "partial";
}
export interface TaskEvent {
  id: string;
  occurred_at: string;
  stage: string;
  state: string;
}
export interface TaskConnectionState {
  id: string;
  owner: TaskOwner;
  instance_id: string;
  label: string;
  environment: string;
  project: string;
  state: string;
  observed_at: string;
  runtime?: ConnectionObservation;
}
export interface ConnectionObservation {
  state: string;
  checked_at: string;
  last_success_at: string | null;
  transport: "verified" | "unknown";
  authorization: "verified" | "denied" | "unknown";
  contract: "supported" | "unsupported" | "unknown";
  task_families: string[];
  content: "not_requested" | "not_verified" | "supported" | "unsupported" | "denied";
  reason?: string;
}

export function contentStateMessage(content?: ConnectionObservation["content"]): string {
  if (!content) return "连接权限状态暂不可验证；预览和下载暂不可用。";
  const messages: Record<ConnectionObservation["content"], string> = {
    not_requested: "本地未开启内容读取；任务读取与内容权限独立。",
    not_verified: "本地内容意愿已开启，但来源能力或逐结果授权尚未验证。",
    supported: "来源合同支持内容读取；预览和下载仍需逐结果独立授权。",
    unsupported: "来源未提供媒体读取合同；请检查 owner 的 artifact_access 能力。",
    denied: "来源拒绝内容读取；请检查 owner 的独立 content purpose（Eikona/Scaena：personal-observer-content-v1；Sonora：--mcp-observer-content），不要重试生成。",
  };
  return messages[content];
}

export function contentActionEnabled(
  actions: TaskSnapshot["allowed_actions"],
  content: ConnectionObservation["content"] | undefined,
  action: "preview" | "download",
): boolean {
  return content === "supported" && actions.some((item) => item.action === action && item.enabled === true);
}
export interface TaskPage {
  rows: TaskSnapshot[];
  connections: TaskConnectionState[];
  next_cursors: Record<string, string>;
}
export const terminalTaskStates = new Set([
  "succeeded",
  "completed",
  "failed",
  "partial_failed",
  "partial",
  "rejected",
  "dry_run",
  "handoff_ready",
  "cancelled",
  "canceled",
  "waiting_review",
]);
export function taskIsActive(task: Pick<TaskSnapshot, "state">) {
  return !terminalTaskStates.has(task.state);
}
export function taskNeedsAttention(task: Pick<TaskSnapshot, "state">) {
  return [
    "unknown",
    "blocked",
    "failed",
    "partial",
    "partial_failed",
    "rejected",
    "waiting_review",
  ].includes(task.state);
}
export interface TaskFilters {
  text: string;
  connection: string;
  owner: string;
  project: string;
  state: string;
  family: string;
  modality: string;
  results: string;
  from: string;
  through: string;
}
// Filters operate only on the bounded, authorized observation batch. Missing
// timestamps cannot satisfy an explicit UTC creation-date range.
export function filterTasks(tasks: TaskSnapshot[], filters: TaskFilters) {
  const needle = filters.text.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    if (filters.connection && task.connection_id !== filters.connection)
      return false;
    if (filters.owner && task.locator.owner !== filters.owner) return false;
    if (filters.project && task.locator.project !== filters.project) return false;
    if (filters.state && task.state !== filters.state) return false;
    if (filters.family && task.locator.task_family !== filters.family)
      return false;
    const resultCount = task.results?.length || 0;
    if (filters.results === "yes" && resultCount === 0) return false;
    if (filters.results === "no" && resultCount > 0) return false;
    if (
      needle &&
      ![
        task.title,
        task.locator.task_ref,
        task.locator.project,
        task.locator.owner,
        task.episode_ref || "",
      ].some((v) => v.toLocaleLowerCase().includes(needle))
    )
      return false;
    if (filters.from || filters.through) {
      const created = Date.parse(task.created_at);
      if (!Number.isFinite(created)) return false;
      if (filters.from && created < Date.parse(filters.from + "T00:00:00Z"))
        return false;
      if (
        filters.through &&
        created >= Date.parse(filters.through + "T00:00:00Z") + 86400000
      )
        return false;
    }
    return true;
  });
}
export function progressLabel(p: TaskProgress): string {
  if (
    p.kind === "percent" &&
    p.percent !== null &&
    p.percent >= 0 &&
    p.percent <= 100
  )
    return `${p.percent}%`;
  if (
    p.kind === "count" &&
    p.total !== null &&
    p.total > 0 &&
    p.completed !== null
  )
    return `${p.completed} / ${p.total}`;
  return "未提供百分比";
}
export function observationDelay(
  active: boolean,
  detail: boolean,
  hidden: boolean,
  failures = 0,
) {
  if (failures) return Math.min(30_000, 5_000 * 2 ** (failures - 1));
  return hidden ? 30_000 : active ? (detail ? 2_000 : 5_000) : 15_000;
}
export const taskStateLabels: Record<string, string> = {
  created: "已受理",
  queued: "排队中",
  running: "执行中",
  pending: "等待执行",
  partial: "部分完成",
  partial_failed: "部分失败",
  rejected: "未通过",
  dry_run: "试运行完成",
  handoff_ready: "可交接",
  succeeded: "已完成",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  canceled: "已取消",
  unknown: "结果未知",
  waiting_review: "待审阅",
  blocked: "受阻",
  cancel_requested: "取消请求中",
};
export const taskStageLabels: Record<string, string> = {
  accepted: "已受理",
  queued: "等待执行",
  validating: "校验输入",
  submitting: "提交上游",
  generating: "生成中",
  running: "执行中",
  downloading: "回收结果",
  completed: "结果就绪",
  failed: "执行失败",
  unknown: "等待确认",
  cancelled: "已取消",
  waiting_review: "等待审阅",
  succeeded: "结果就绪",
};
