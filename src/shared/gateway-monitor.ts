export const gatewayMonitorSchema = "yeisme.gateway_monitor.v1" as const;

export type GatewayState = "ready" | "degraded" | "unavailable" | "forbidden" | "needs_contract" | "unknown";
export type GatewayCallState = "queued" | "running" | "succeeded" | "failed" | "unknown" | "in_progress" | "awaiting_approval" | "blocked";

export interface GatewayTelemetry {
  active_sessions: number;
  rpc_calls: number;
  proxy_latency_p95_ms: number | null;
  upstream_latency_p95_ms: number | null;
  token_estimate: number | null;
  backends: { id: string; state: string; protocol: string | null; freshness: string }[];
  stdio_supervisor?: { state: string; restarts: number };
}

export interface GatewayAgentSession {
  session_ref: string;
  protocol_version: string | null;
  elicitation: boolean;
  display_mode: string | null;
  active: boolean;
  in_flight: number;
  calls: number;
  failures: number;
  updated_at: string;
}

export interface GatewayCall {
  call_ref: string;
  session_ref: string | null;
  actor: string | null;
  backend: string | null;
  tool: string | null;
  state: GatewayCallState;
  stage: string | null;
  category: string | null;
  updated_at: string;
  error_code?: string;
}

export interface GatewayCallDetail extends GatewayCall {
  events: { at: string; stage: string; state: string; code?: string }[];
  recovery: "none" | "query_original_operation" | "reconcile_required";
}

export interface GatewayClientPreset {
  id: string;
  label: string;
  command?: string;
  config: string;
}

export interface GatewayMonitorSnapshot {
  schema_version: typeof gatewayMonitorSchema;
  state: GatewayState;
  observed_at: string;
  telemetry: GatewayTelemetry | null;
  sessions: GatewayAgentSession[];
  calls: GatewayCall[];
  presets: GatewayClientPreset[];
  coverage: { state: string; reason?: string };
  sources?: { resource: string; state: string }[];
}

export interface GatewayPlan {
  plan_ref: string;
  plan_digest: string;
  expected_revision: string;
  action: string;
  state: "pending" | "approval_required" | "ready" | "expired" | "conflict";
  approval_id?: string;
  operation_ref?: string;
}
