/** Redacted semantic capability snapshot. It is a read-only fact, never an executable tool catalog. */
export const serviceCapabilitySnapshotSchemaVersion = "yeisme.service_capability_snapshot.v1" as const;

export const serviceCapabilityStates = ["ready", "needs_contract", "unavailable", "forbidden", "stale"] as const;
export type ServiceCapabilityState = (typeof serviceCapabilityStates)[number];
export type CapabilityContractStatus = "ready" | "needs_contract";

const refPattern = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,200}$/;
const semanticCapabilityPattern = /^[a-z][a-z0-9._:-]{0,120}$/;
const forbiddenCapabilityPattern = /(?:execute|call|shell|command|payload|credential|token|secret|password|authorization|https?:|[\\/])/i;
const timestamp = (value: unknown) => typeof value === "string" && value.length <= 64 && !/[\x00-\x1f]/.test(value) ? value : null;

export interface ServiceCapabilitySnapshot {
  schema_version: typeof serviceCapabilitySnapshotSchemaVersion;
  service_id: string;
  scope_id: string;
  epoch: number;
  project_ref?: string;
  observed_at: string;
  state: ServiceCapabilityState;
  capabilities: string[];
  /** Only bounded, semantic facts are allowed. Provider payloads, tool schemas and credentials are not. */
  limits: Record<string, string | number | boolean>;
  digest: string | null;
  blocker?: "capability_contract_missing" | "capability_snapshot_invalid";
}

export interface ServiceCapabilitySnapshotInput {
  service_id: string;
  scope_id: string;
  epoch: number;
  project_ref?: string;
  observed_at?: string;
  state?: ServiceCapabilityState;
  capabilities: string[];
  limits?: Record<string, string | number | boolean>;
  digest?: string | null;
}

function validRef(value: unknown): value is string {
  return typeof value === "string" && refPattern.test(value) && !value.includes("..");
}

function validCapability(value: unknown): value is string {
  return typeof value === "string" && semanticCapabilityPattern.test(value) && !forbiddenCapabilityPattern.test(value);
}

function safeLimits(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    if (!/^[a-z][a-z0-9._:-]{0,80}$/.test(key) || forbiddenCapabilityPattern.test(key)) continue;
    if (typeof raw === "string" && raw.length <= 160 && !/[\x00-\x1f]/.test(raw) && !forbiddenCapabilityPattern.test(raw)) result[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === "boolean") result[key] = raw;
  }
  return result;
}

export function createCapabilitySnapshot(input: ServiceCapabilitySnapshotInput): ServiceCapabilitySnapshot {
  const capabilities = [...new Set(input.capabilities.filter(validCapability))].slice(0, 64);
  const valid = validRef(input.service_id) && validRef(input.scope_id) && Number.isInteger(input.epoch) && input.epoch >= 0 && capabilities.length > 0;
  const state: ServiceCapabilityState = valid && input.state && serviceCapabilityStates.includes(input.state) ? input.state : "needs_contract";
  return {
    schema_version: serviceCapabilitySnapshotSchemaVersion,
    service_id: validRef(input.service_id) ? input.service_id : "unknown",
    scope_id: validRef(input.scope_id) ? input.scope_id : "unknown",
    epoch: Number.isInteger(input.epoch) && input.epoch >= 0 ? input.epoch : 0,
    ...(validRef(input.project_ref) ? { project_ref: input.project_ref } : {}),
    observed_at: timestamp(input.observed_at) || new Date(0).toISOString(),
    state: state === "ready" && capabilities.length > 0 ? "ready" : state === "ready" ? "needs_contract" : state,
    capabilities,
    limits: safeLimits(input.limits),
    digest: typeof input.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(input.digest) ? input.digest : null,
    ...(!valid || state === "needs_contract" ? { blocker: valid ? "capability_contract_missing" as const : "capability_snapshot_invalid" as const } : {}),
  };
}

/** Missing, malformed or unpublished capability data is a contract gap, never an empty ready snapshot. */
export function normalizeCapabilitySnapshot(raw: unknown): ServiceCapabilitySnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createCapabilitySnapshot({ service_id: "unknown", scope_id: "unknown", epoch: 0, capabilities: [] });
  const value = raw as Record<string, unknown>;
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities.filter(validCapability) : [];
  return createCapabilitySnapshot({
    service_id: String(value.service_id ?? "unknown"),
    scope_id: String(value.scope_id ?? "unknown"),
    epoch: typeof value.epoch === "number" ? value.epoch : 0,
    project_ref: typeof value.project_ref === "string" ? value.project_ref : undefined,
    observed_at: value.observed_at as string | undefined,
    state: serviceCapabilityStates.includes(value.state as ServiceCapabilityState) ? value.state as ServiceCapabilityState : "needs_contract",
    capabilities,
    limits: value.limits as Record<string, string | number | boolean> | undefined,
    digest: typeof value.digest === "string" ? value.digest : null,
  });
}

export function capabilityContractStatus(snapshot: ServiceCapabilitySnapshot): CapabilityContractStatus {
  return snapshot.state === "ready" && snapshot.capabilities.length > 0 ? "ready" : "needs_contract";
}

export function isCapabilityReady(snapshot: ServiceCapabilitySnapshot, required: string[] = []): boolean {
  return capabilityContractStatus(snapshot) === "ready" && required.every((item) => snapshot.capabilities.includes(item));
}
