import type { ControlCenterErrorClass } from "../types";

export type ReadStatus = "loading" | "ready" | "empty" | "stale" | "forbidden" | "unavailable" | "unknown" | "needs_contract" | "login_required";

export interface ReadState<T> {
  status: ReadStatus;
  data: T | null;
  error: string | null;
  observedAt: string | null;
}

export const initialRead = <T,>(): ReadState<T> => ({ status: "loading", data: null, error: null, observedAt: null });

/** Maps a failed read onto a page-level status without guessing from message text. */
export function statusForFailure(errorClass: ControlCenterErrorClass, code: string, hasData: boolean): ReadStatus {
  if (errorClass === "login_required") return "login_required";
  if (code.includes("contract")) return "needs_contract";
  if (errorClass === "forbidden") return "forbidden";
  if (hasData) return "stale";
  if (errorClass === "not_found" || errorClass === "invalid") return "unknown";
  return "unavailable";
}

export const readStatusLabels: Record<ReadStatus, string> = {
  loading: "读取中",
  ready: "已读取",
  empty: "暂无记录",
  stale: "数据可能已过期",
  forbidden: "无读取权限",
  unavailable: "来源不可用",
  unknown: "尚未确认",
  needs_contract: "待补齐接口",
  login_required: "需要重新登录",
};

const readErrorMessages: Record<string, string> = {
  operation_not_allowed: "当前控制中心未开放此读取入口，请查看服务与连接。",
  owner_action_contract_missing: "owner 尚未提供该读取动作合同。",
  needs_contract: "owner 尚未提供该读取合同。",
  needs_authorization: "owner 尚未授权当前范围读取。",
  content_not_authorized: "当前范围没有结果内容读取权限。",
  source_unavailable: "owner 暂时没有返回数据，请稍后重试或检查连接。",
  source_rate_limited: "owner 当前限流，请稍后重试。",
  source_busy: "owner 当前繁忙，请稍后重试。",
  personal_connection_required: "当前会话没有个人任务连接。",
};

export function readErrorMessage(code?: string | null) {
  if (!code) return "读取失败，请查看服务与连接。";
  return readErrorMessages[code] || "来源返回了未分类错误，请查看服务与连接。";
}
