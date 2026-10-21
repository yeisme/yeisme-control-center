import type { CreativeGenerationMode } from "./creative-input";

/**
 * yeisme.tool_catalog.v1 — read-only, cross-owner catalog of MCP servers, tools, owner actions,
 * models and channels. Catalog presence never means "callable": callability stays with each owner
 * and the Control Center never invokes catalog entries.
 */
export const toolCatalogSchemaVersion = "yeisme.tool_catalog.v1" as const;

export type CatalogOwner = "eikona" | "scaena" | "sonora" | "aigora" | "gateway" | "auctra";
export type CatalogCoverageState = "readable" | "partial" | "forbidden" | "needs_contract" | "unavailable" | "not_configured";
export type CatalogFreshness = "fresh" | "stale" | "unknown";
export type CatalogEntryKind = "server" | "tool" | "action" | "model" | "channel";
export type ModelSnapshotStatus = "latest_ready" | "latest_unverified" | "unavailable" | "historical" | "drifted" | "unknown_cost" | "unknown";
export type RiskTier = "read_only" | "remote_query" | "mutation" | "paid_external" | "human_gate" | "unknown";
export type ActionAvailability = "available" | "blocked" | "unavailable" | "planned" | "unknown";
export type ChannelStatus = "ready" | "blocked" | "unknown";

export const ownerModelStatuses: readonly ModelSnapshotStatus[] = ["latest_ready", "latest_unverified", "unavailable", "historical", "drifted", "unknown_cost"];

export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
  enum: string[] | null;
  default: string | null;
}

export interface SchemaSummary {
  digest: string | null;
  fields: SchemaField[];
  field_count: number;
  truncated: boolean;
}

export interface DomainReadiness {
  domain: string;
  status: ActionAvailability;
  note: string | null;
}

export interface CatalogServer {
  id: string;
  owner: CatalogOwner;
  name: string;
  transport: "mcp" | "http" | "cli";
  protocol_version: string | null;
  server_name: string | null;
  server_version: string | null;
  coverage: CatalogCoverageState;
  reason: string | null;
  observed_at: string | null;
  freshness: CatalogFreshness;
  latest_policy: string | null;
  native_channels: string[];
  readiness: DomainReadiness[];
  counts: { tools: number; actions: number; models: number; channels: number };
}

export interface CatalogTool {
  id: string;
  owner: CatalogOwner;
  name: string;
  title: string | null;
  description: string | null;
  annotations: { read_only: boolean | null; destructive: boolean | null; idempotent: boolean | null; open_world: boolean | null };
  dispatcher: boolean;
  input: SchemaSummary;
}

export interface CatalogAction {
  id: string;
  owner: CatalogOwner;
  name: string;
  tool: string | null;
  summary: string | null;
  description: string | null;
  risk: RiskTier;
  availability: ActionAvailability;
  lane: string | null;
  blockers: string[];
  next_actions: string[];
  conditions: string[];
  requires_confirm: boolean | null;
  requires_idempotency: boolean | null;
  side_effects: string[];
  creative_mode: CreativeGenerationMode | null;
  input: SchemaSummary;
  source: string;
}

export interface CatalogPricing {
  source: string | null;
  currency: string | null;
  unit: string | null;
  price_type: string | null;
}

export interface CatalogModel {
  id: string;
  owner: CatalogOwner;
  model_ref: string;
  original_model_ref: string | null;
  provider: string | null;
  channel: string | null;
  operation: string | null;
  capabilities: string[];
  input_modalities: string[];
  output_modalities: string[];
  durations: string[];
  resolutions: string[];
  ratios: string[];
  pricing: CatalogPricing | null;
  readiness: string | null;
  status: ModelSnapshotStatus;
  status_source: "owner" | "undeclared";
  observed_at: string | null;
  expires_at: string | null;
  digest: string | null;
  warnings: string[];
  source: string;
}

export interface CatalogChannel {
  id: string;
  owner: CatalogOwner;
  channel_id: string;
  name: string;
  provider: string | null;
  protocol: string | null;
  models: string[];
  capabilities: string[];
  status: ChannelStatus;
  observed_at: string | null;
  routing: { priority: number | null; weight: number | null; default: boolean | null; selection_mode: string | null } | null;
  pricing: CatalogPricing | null;
  note_required: boolean;
  last_attempt: string | null;
  last_success: string | null;
}

export interface CatalogChange {
  owner: CatalogOwner;
  kind: CatalogEntryKind;
  entry_id: string;
  change: "added" | "changed" | "removed";
  at: string;
}

export interface CatalogCoverage {
  owner: CatalogOwner;
  state: CatalogCoverageState;
  reason: string | null;
  observed_at: string | null;
  freshness: CatalogFreshness;
}

export interface ToolCatalog {
  schema_version: typeof toolCatalogSchemaVersion;
  scope: string;
  observed_at: string;
  freshness: CatalogFreshness;
  refresh: { forced: boolean; throttled: boolean; ttl_ms: number };
  servers: CatalogServer[];
  tools: CatalogTool[];
  actions: CatalogAction[];
  models: CatalogModel[];
  channels: CatalogChannel[];
  changes: CatalogChange[];
  coverage: CatalogCoverage[];
}

/** Generation entries that a user may pre-check in AI 创作; historical or undeclared callability never qualifies. */
export const canPrecheckModel = (model: CatalogModel) =>
  model.status !== "historical" && model.status !== "unavailable" && model.status !== "drifted";

/** Observation-cache key the catalog page publishes to so the command palette can search without a request. */
export const toolCatalogCacheKey = "tool-catalog";
