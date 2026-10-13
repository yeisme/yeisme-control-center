/** Proposed consumer projections. These declarations are design artifacts, not deployed APIs. */
import type { OperationState } from "./data";
export interface CapabilityDescriptor {
  contract_version: string;
  owner: string;
  capability_ref: string;
  operation_kind: string;
  risk: string;
  approval: string;
  idempotency: string;
  execution: string;
  readiness: string;
  input_schema_ref?: string;
  output_schema_ref?: string;
  service_version?: string;
}
export interface InvocationContext {
  request_id: string;
  idempotency_key?: string;
  project_ref: string;
  actor_ref: string;
  purpose: string;
  budget_ref?: string;
  cost_ceiling?: number;
  evidence_level: string;
}
export interface OperationProjection {
  product: string;
  operation_kind: string;
  operation_ref: string;
  state: OperationState;
  native_state: string;
  terminal: boolean;
  blockers: string[];
  event_cursor?: string;
  artifact_refs: string[];
  evidence_refs: string[];
  actions: string[];
}
export interface ServiceInstanceSummary {
  instance_ref: string;
  owner: string;
  environment_ref: string;
  service_version?: string;
  project_refs: string[];
  observed_at: string | null;
  freshness: "fresh" | "stale" | "not_observed";
  transport: "reachable" | "unreachable" | "unknown" | "not_applicable";
  authentication: "authorized" | "denied" | "unknown" | "not_applicable";
  capabilities: CapabilityDescriptor[];
  allowed_actions: string[];
  credential_ref?: string;
  evidence_refs: string[];
  readiness_source: "owner" | "prototype" | "not_verified";
}
export interface ControlCenterLaunchContext {
  source: "frame";
  environment_ref: string;
  source_project_ref: string;
  owner_project_bindings?: { owner: string; project_ref: string }[];
  operation_ref?: string;
  asset_ref?: string;
  shot_ref?: string;
  target_view: "overview" | "services" | "tasks" | "audit";
  return_route: string;
}
