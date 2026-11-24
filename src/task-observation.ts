import type { ProcessObservation, PromptCaptureObservation, ProcessProgress } from "./observation-contract";
import { compileTaskFilters } from "./shared/task-query";
import type { TaskFreshness, TaskFreshnessReason } from "./shared/task-freshness";

export const taskOwners = ["eikona", "sonora", "scaena", "anatomia"] as const;
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
  version?: string;
  ref: string;
  name: string;
  mime: string;
  bytes: number | null;
  state: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  thumbnail?: {
    state: "ready" | "unavailable" | "forbidden" | "needs_contract";
    ref?: string;
    observed_at?: string;
    reason?: string;
  };
}
/** Explicit, audited original-prompt read bound to one task. */
export interface TaskPromptContent {
  state: "complete" | "not_recorded";
  text?: string;
  truncated?: boolean;
  capture_ref?: string;
  task_ref?: string;
  receipt_ref?: string;
}

export interface TaskSnapshot {
  schema_version: "yeisme.task_observation.v1";
  locator: TaskLocator;
  task_key?: string;
  connection_id?: string;
  title: string;
  state: string;
  native_state: string;
  /** Owner-provided bounded failure diagnostics; never raw provider payload. */
  error_code?: string;
  error_summary?: string;
  stage: string;
  revision: string;
  created_at: string;
  updated_at: string | null;
  observed_at: string;
  /** Local liveness projection; never replaces the owner's state. */
  control_center_freshness?: TaskFreshness;
  control_center_freshness_reason?: TaskFreshnessReason;
  started_at: string | null;
  progress: TaskProgress;
  source: string;
  actor: string | null;
  /** Typed only when the owner mapped a verified credential or run identity. Free text in `actor` never sets this. */
  actor_type?: "human" | "agent" | "service" | "unknown";
  /** Trusted correlation refs. Joins to a gateway call only by exact `gateway_call_ref`, never by time. */
  origin_refs?: {
    gateway_call_ref?: string;
    mcp_session_ref?: string;
    run_identity_purpose?: string;
  };
  parent_ref: string | null;
  episode_ref?: string;
  /** The owner's own episode resource (for example `sonora://…`); not the Auctra/Scaena episode, so never matched against one directly. */
  owner_episode_ref?: string;
  work_url?: string;
  results: TaskArtifact[];
  allowed_actions: {
    action: "cancel" | "preview" | "download";
    enabled: boolean;
    reason?: string;
  }[];
  coverage: "complete" | "partial";
  provider_recovery?: TaskProviderRecovery;
  process?: ProcessObservation;
  prompt_capture?: PromptCaptureObservation;
  /** The owner's own `yeisme.process_timing.v1` record for this run. Absent when the owner sent none; never derived here. */
  timing?: ProcessTiming;
}

export const processTimingStatuses = [
  "created", "queued", "running", "stalled", "paused", "blocked", "waiting_for_human",
  "reconciling", "completed", "failed", "timed_out", "cancelled", "expired",
] as const;
export type ProcessTimingStatus = (typeof processTimingStatuses)[number];

/**
 * What the control center keeps of an owner's timing record: identity, status, times and the five durations, under the
 * owner's field names. A duration the owner did not send as a non-negative integer is `null`, not zero. Events, digests
 * and evidence refs are not carried.
 */
export interface ProcessTiming {
  run_ref: string;
  parent_run_ref?: string;
  phase: string;
  operation: string;
  status: ProcessTimingStatus;
  started_at: string;
  ended_at: string | null;
  wall_duration_ms: number | null;
  active_duration_ms: number | null;
  queue_duration_ms: number | null;
  blocked_duration_ms: number | null;
  human_wait_duration_ms: number | null;
  heartbeat_at: string | null;
  stall_after_ms: number | null;
  retry_count: number | null;
}
export interface TaskEvent {
  id: string;
  occurred_at: string;
  stage: string;
  state: string;
  sequence?: number;
  kind?: string;
  summary?: string;
  reason_code?: string;
  duration_ms?: number | null;
  attempt_ref?: string;
  progress?: ProcessProgress;
  evidence_refs?: string[];
  prompt_capture?: PromptCaptureObservation;
}
export interface TaskProviderRecovery {
  state: "not_submitted" | "rejected_no_generation" | "accepted_pending" | "generated" | "submission_unknown" | "blocked";
  native_state: string | null;
  submission_ref: string | null;
  binding_id: string | null;
  error_code: string | null;
  blocker: string | null;
  safe_to_resubmit: boolean | null;
  review_status: string | null;
  export_status: string | null;
  artifact_refs: string[];
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
  channels?: Partial<Record<TaskReadChannel, TaskChannelObservation>>;
  runtime?: ConnectionObservation;
}

export type TaskReadChannel = "connection" | "active" | "history" | "detail" | "events" | "artifacts";

export interface TaskChannelObservation {
  state: string;
  observed_at: string;
  reason?: string;
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
  channels?: Partial<Record<TaskReadChannel, TaskChannelObservation>>;
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
  /** The search box: words, quoted phrases, `-` exclusions and any `键:值` clause still typed there. */
  text: string;
  connection: string;
  owner: string;
  project: string;
  state: string;
  family: string;
  /** Media kind (`kind` in the address): image, video, audio or text. */
  modality: string;
  results: string;
  prompt: string;
  from: string;
  through: string;
  /** Episode refs, comma-separated (`episode`). */
  episode?: string;
  /** Updated within a window (`upd`): 24h, 7d, 今天, 本周 or a date range. */
  updated?: string;
}

export { promptCaptureForTask } from "./shared/task-query";
// Filters operate only on the bounded, authorized observation batch. Missing timestamps cannot satisfy an explicit
// date range. The rules live in `compileTaskFilters`, which also gives the per-filter counts and the match ranking.
export function filterTasks(tasks: TaskSnapshot[], filters: TaskFilters, options?: Parameters<typeof compileTaskFilters>[1]) {
  const compiled = compileTaskFilters(filters, options);
  return tasks.filter((task) => compiled.matches(task));
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
  waiting_review: "等你确认",
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
