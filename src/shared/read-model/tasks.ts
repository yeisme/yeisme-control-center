import type { TaskArtifact, TaskConnectionState, TaskSnapshot } from "../../task-observation";
import { taskIsActive, taskNeedsAttention, taskStageLabels } from "../../task-observation";
import { kindOf, type MediaKind } from "../../components/ui/Kind";
import { formatBytes, formatDurationMs } from "./format";

export const ownerModality: Record<string, MediaKind> = { eikona: "image", scaena: "video", sonora: "audio" };

export function taskKind(task: TaskSnapshot): MediaKind {
  const first = task.results.find((result) => result.mime);
  return kindOf(first?.mime, ownerModality[task.locator.owner]);
}

export function stageLabel(stage: string) {
  return taskStageLabels[stage] || stage || "阶段未提供";
}

export type TaskView = "all" | "active" | "attention" | "history";

const inProgressStates = new Set(["queued", "pending", "created", "running", "cancel_requested"]);

/** Known to be executing; unknown/blocked are non-terminal but not shown as progress. */
export function taskInProgress(task: Pick<TaskSnapshot, "state">) {
  return inProgressStates.has(task.state);
}

export function inView(task: TaskSnapshot, view: TaskView) {
  if (view === "active") return taskInProgress(task);
  if (view === "attention") return taskNeedsAttention(task);
  if (view === "history") return !taskIsActive(task);
  return true;
}

const connectionStateLabels: Record<string, string> = {
  ready: "可读",
  not_checked: "尚未观察",
  needs_authorization: "需要 owner 授权",
  needs_contract: "缺少观测合同",
  source_unavailable: "来源不可用",
  source_rate_limited: "来源限流",
  source_busy: "来源繁忙",
  invalid_task_page: "任务页不符合合同",
  invalid_mcp_response: "响应不符合合同",
  mcp_initialization_failed: "MCP 初始化失败",
  cursor_expired: "游标已过期",
  task_not_found: "游标无效",
  connection_endpoint_denied: "连接地址未获准",
  secret_permissions_invalid: "凭据文件权限不正确",
  owner_action_denied: "owner 拒绝动作",
  owner_action_contract_missing: "缺少 owner 动作合同",
  forbidden: "无读取权限",
};

export function connectionStateLabel(state: string) {
  return connectionStateLabels[state] || state || "未知";
}

export function connectionTone(state: string): "success" | "danger" | "warning" | "neutral" {
  if (state === "ready") return "success";
  if (state === "needs_authorization" || state === "owner_action_denied") return "danger";
  if (state === "not_checked" || !state) return "neutral";
  return "warning";
}

const actionReasons: Record<string, string> = {
  content_not_authorized: "内容读取未授权",
  control_center_admin_required: "需要控制中心管理员",
  not_supported: "来源不支持该动作",
  cancel_not_supported: "该任务不支持安全取消",
  cancel_not_authorized: "本地未开启取消",
  owner_result_access_requested: "来源结果访问待逐结果授权",
};

export function actionReasonLabel(reason: string | undefined) {
  if (!reason) return "来源未开放该动作";
  return actionReasons[reason] || reason;
}

export function resultAction(task: TaskSnapshot, action: "preview" | "download") {
  const found = task.allowed_actions.find((item) => item.action === action);
  const requestable = found?.reason === "owner_result_access_requested";
  const enabled = found?.enabled === true || requestable;
  if (!enabled || requestable) return { enabled, reason: actionReasonLabel(found?.reason) };
  return { enabled, reason: null };
}

export function connectionFor(task: TaskSnapshot, connections: TaskConnectionState[]) {
  return connections.find((connection) => connection.id === task.connection_id);
}

export function resultMeta(result: TaskArtifact) {
  const parts: string[] = [];
  if (result.width && result.height) parts.push(`${result.width}×${result.height}`);
  const duration = formatDurationMs(result.duration_ms ?? null);
  if (duration) parts.push(duration);
  const size = formatBytes(result.bytes);
  if (size) parts.push(size);
  if (result.mime) parts.push(result.mime);
  return parts;
}

export interface ResultEntry {
  key: string;
  task: TaskSnapshot;
  result: TaskArtifact;
  kind: MediaKind;
}

export function collectResults(tasks: TaskSnapshot[]): ResultEntry[] {
  return tasks.flatMap((task) => task.results.map((result) => ({
    key: `${task.task_key}:${result.ref}`,
    task,
    result,
    kind: kindOf(result.mime, ownerModality[task.locator.owner]),
  })));
}

export const recoveryLabels: Record<string, string> = {
  not_submitted: "未提交",
  rejected_no_generation: "已拒绝，未生成",
  accepted_pending: "已受理，等待结果",
  generated: "已生成",
  submission_unknown: "提交结果未知",
  blocked: "受阻",
};
