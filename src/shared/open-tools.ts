import type { CoverageState } from "../request-visibility";
import { needsContractLabel } from "./read-model/labels";

/**
 * yeisme.open_tool_projection.v1 — what the control center reads from open tools that are not task owners: the file
 * transfer service DriveBridge and the personal MCP Gateway. The server calls a short, fixed list of GET routes with a
 * 0600 bearer credential and keeps states, counts, sizes and codes; addresses, file paths, error text, environment
 * variable names and process details are dropped before anything reaches the browser.
 */
export const openToolProjectionSchema = "yeisme.open_tool_projection.v1" as const;
export const openToolKinds = ["drivebridge", "gateway"] as const;
export type OpenToolKind = (typeof openToolKinds)[number];

export const openToolNames: Record<OpenToolKind, string> = { drivebridge: "DriveBridge", gateway: "MCP Gateway" };

/** One reading of a tool. `degraded`: the tool answers, but a check or a backend it reports needs attention. */
export type OpenToolState = "ready" | "degraded" | "unavailable" | "forbidden" | "needs_contract" | "rate_limited";
export type OpenToolCheckState = "ok" | "failed" | "forbidden" | "needs_contract" | "unavailable" | "rate_limited";

export interface OpenToolCheck {
  id: string;
  label: string;
  state: OpenToolCheckState;
  reason?: string;
}

export const openToolOperationStates = ["queued", "running", "succeeded", "failed", "cancelled", "unknown"] as const;
export type OpenToolOperationState = (typeof openToolOperationStates)[number];

export interface OpenToolOperation {
  /** The owner's own id for the run; never a path or an address. */
  ref: string;
  /** Owner kind code, such as upload or tools/call. */
  kind: string;
  /** Readable kind, such as 上传 or 工具调用. */
  label: string;
  state: OpenToolOperationState;
  native_state: string;
  updated_at: string;
  progress?: { done: number; total: number; unit: "bytes" | "files" };
  size_bytes?: number;
  /** A code only, never owner error text. */
  error_code?: string;
  /** Gateway backend the run went to. */
  backend?: string;
}

export interface OpenToolBackend {
  id: string;
  namespace: string | null;
  enabled: boolean;
  state: "ready" | "degraded" | "down" | "disabled" | "unknown";
  native_state: string;
  tool_count: number | null;
  checked_at: string | null;
}

export interface OpenToolUsage {
  /** The window the owner counted over, such as 24h. */
  window: string;
  calls: number;
  failures: number;
  p95_ms: number | null;
  backends: { id: string; calls: number; failures: number; p95_ms: number | null }[];
}

export interface OpenToolProjection {
  schema_version: typeof openToolProjectionSchema;
  tool: OpenToolKind;
  label: string;
  state: OpenToolState;
  reason?: string;
  observed_at: string;
  freshness: "fresh" | "stale" | "unknown";
  checks: OpenToolCheck[];
  /** Short owner facts worth showing, such as the protocol version or the upload chunk size. */
  facts: { label: string; value: string }[];
  operations: {
    /** Newest first. */
    recent: OpenToolOperation[];
    /** Failed or unknown runs from the last 7 days, newest first. */
    attention: OpenToolOperation[];
    counts: Record<OpenToolOperationState, number>;
    coverage: CoverageState;
    reason?: string;
  };
  backends?: OpenToolBackend[];
  usage?: OpenToolUsage;
  coverage: { state: CoverageState; reason?: string };
}

export const openToolStateLabels: Record<OpenToolState, string> = {
  ready: "可读",
  degraded: "部分异常",
  unavailable: "来源不可用",
  forbidden: "无读取权限",
  needs_contract: needsContractLabel,
  rate_limited: "被限流",
};

export const openToolOperationStateLabels: Record<OpenToolOperationState, string> = {
  queued: "排队中",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  unknown: "结果未知",
};

export const emptyOperationCounts = (): Record<OpenToolOperationState, number> => ({ queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0, unknown: 0 });

export const isOpenToolKind = (value: unknown): value is OpenToolKind => typeof value === "string" && (openToolKinds as readonly string[]).includes(value);
