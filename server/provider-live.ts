import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { AuthError, boundedJSON, secret } from "./auth";
import { RunStore } from "./db/run-store";
import { createMemoryDB } from "./db/client";
import type {
  ProviderConnection,
  ProviderModality,
  ProviderOwner,
  ScopeBinding,
  ServerConfig,
  Session,
} from "./contracts";
import type {
  CreativeCapabilityContract,
  CreativeGenerationMode,
  CreativeOutputSpec,
  CreativeReference,
  CreativeReferenceRole,
  CreativeTimeline,
} from "../src/shared/creative-input";
import type {
  CatalogAction,
  CatalogChannel,
  CatalogCoverageState,
  CatalogEntryKind,
  CatalogModel,
  CatalogTool,
  DomainReadiness,
} from "../src/shared/tool-catalog";
import {
  deriveCreativeContract,
  eikonaActions,
  normalizeChannels,
  normalizeModels,
  normalizeTools,
  scaenaGuide,
  sonoraDiscovery,
} from "./tool-catalog-normalize";

export type ProviderRunState =
  | "accepted"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown"
  | "reconciling"
  | "reconciled";
export type CostState = "confirmed" | "estimated" | "unknown";
export type ProviderReadinessState = "configured" | "needs_configuration" | "needs_contract" | "forbidden" | "unavailable" | "stale" | "observed";
export interface ProviderBinding {
  binding_id: string;
  model_ref: string;
  enabled: boolean;
  default?: boolean;
  duration_seconds?: number;
  resolution?: string;
  ratio?: string;
  output_format?: string;
  requires_reference?: boolean;
  disabled_reason?: string | null;
}
export interface ProviderDiagnostic {
  status: ProviderReadinessState;
  code: string | null;
  configured: boolean | null;
  blocker: string | null;
  observed_at: string;
}
export interface ProviderTaskRecovery {
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
export interface ProviderRunRequest {
  mode: "live";
  owner: ProviderOwner;
  modality: ProviderModality;
  model_ref: string;
  scope_id: string;
  project_ref: string;
  prompt: string;
  budget_cap: { amount: number; currency: "CNY" };
  idempotency_key: string;
  trace_ref?: string;
  generation_mode?: CreativeGenerationMode;
  references?: CreativeReference[];
  timeline?: CreativeTimeline;
  output?: CreativeOutputSpec;
  variant_count?: number;
}
export interface ProviderRunProjection {
  run_ref: string;
  owner: ProviderOwner;
  modality: ProviderModality;
  model_ref: string;
  scope_id: string;
  project_ref: string;
  trace_ref: string;
  source_ref: string | null;
  state: ProviderRunState;
  output_refs: string[];
  upstream_cost: number | null;
  currency: string;
  cost_state: CostState;
  observed_at: string;
  created_at: string;
  evidence_refs: string[];
  error_code: string | null;
  connection_state: "configured" | "needs_configuration" | "needs_contract";
}
export interface UsageEventProjection {
  source_ref: string;
  trace_ref: string;
  owner: ProviderOwner;
  model_ref: string;
  modality: ProviderModality;
  quantity: number | null;
  unit: string;
  upstream_cost: number | null;
  currency: string;
  cost_state: CostState;
  status: ProviderRunState;
  project_ref: string;
  created_at: string;
}
export interface CapabilityProjection {
  id: string;
  owner: ProviderOwner;
  modality: ProviderModality;
  name: string;
  model_ref: string;
  state: "configured" | "needs_configuration" | "needs_contract";
  transport: "mcp";
  supports_live_submit: boolean;
  observed_at: string;
  readiness: ProviderReadinessState;
  submit_gate: "disabled_by_default" | "owner_authorized";
  provider_refs: string[];
  model_refs: string[];
  voice_refs: string[];
  bindings: ProviderBinding[];
  diagnostic: ProviderDiagnostic | null;
  blocker: string | null;
  input_modes: CreativeCapabilityContract["input_modes"];
  reference_roles: CreativeCapabilityContract["reference_roles"];
  timeline_support: CreativeCapabilityContract["timeline_support"];
  output_constraints: CreativeCapabilityContract["output_constraints"];
  input_schema_ref: string | null;
  limits: CreativeCapabilityContract["limits"];
}
export interface ProviderAdapter {
  owner: ProviderOwner;
  discover(): Promise<Pick<CapabilityProjection, "state" | "readiness" | "observed_at" | "provider_refs" | "model_refs" | "voice_refs" | "bindings" | "diagnostic" | "blocker" | "input_modes" | "reference_roles" | "timeline_support" | "output_constraints" | "input_schema_ref" | "limits">>;
  observe(): Promise<OwnerObservation>;
  estimate(input: ProviderRunRequest): Promise<{ amount: number | null; currency: string }>;
  submit(input: ProviderRunRequest): Promise<ProviderReceipt>;
  status(run: ProviderRunProjection): Promise<ProviderReceipt>;
  reconcile(run: ProviderRunProjection): Promise<ProviderReceipt>;
}
export interface ProviderReceipt {
  state: ProviderRunState;
  source_ref: string | null;
  output_refs: string[];
  upstream_cost: number | null;
  currency: string;
  error_code: string | null;
  evidence_refs: string[];
}
export type CapabilityObservation = Pick<CapabilityProjection, "state" | "readiness" | "observed_at" | "provider_refs" | "model_refs" | "voice_refs" | "bindings" | "diagnostic" | "blocker" | "input_modes" | "reference_roles" | "timeline_support" | "output_constraints" | "input_schema_ref" | "limits">;
/** A single owner's read-only discovery result, shared by /capabilities and /tool-catalog. */
export interface OwnerObservation {
  owner: ProviderOwner;
  observed_at: string;
  coverage: { state: CatalogCoverageState; reason: string | null };
  server: { protocol_version: string | null; server_name: string | null; server_version: string | null };
  tools: CatalogTool[];
  actions: CatalogAction[];
  models: CatalogModel[];
  channels: CatalogChannel[];
  readiness: DomainReadiness[];
  latest_policy: string | null;
  native_channels: string[];
  /** Entry kinds read completely this pass; only these may record removals. */
  complete_kinds: CatalogEntryKind[];
  capability: CapabilityObservation;
}

const discoveryTimeoutMs = 8000;
const discoveryActions = new Set(["getProjectMediaCapabilities", "credential.status", "doctor.run"]);
const discoveryTools = new Set(["sonora.search"]);
const rpcErrorCode = (error: any) => {
  const code = error?.code;
  if (typeof code === "string" && code) return code.slice(0, 100);
  // Owners wrap their typed error in JSON-RPC `data` (e.g. Eikona `{ error: { code, message } }`).
  const nested = error?.data?.error && typeof error.data.error === "object" ? error.data.error : error?.data;
  const message = [error?.message, nested?.message].filter((item) => typeof item === "string").join(" ").toLowerCase();
  if (/unsupported|not supported|unknown resource|resource collection/.test(message)) return "mcp_resource_unsupported";
  if (/denied|forbidden|unauthori|not allowed|permission|for this credential/.test(message)) return "mcp_access_denied";
  if (typeof nested?.code === "string" && nested.code && !/^(BACKING_ERROR|INTERNAL)/i.test(nested.code)) return nested.code.slice(0, 100);
  if (code === -32601) return "mcp_method_not_found";
  if (code === -32002 || /not found/.test(message)) return "mcp_resource_not_found";
  if (code === -32602) return "mcp_invalid_params";
  return typeof code === "number" ? `mcp_error_${code}` : "provider_action_denied";
};
/** Owner resources may arrive wrapped in a `*.mcp.resource.v1` envelope; errors inside it are failures. */
const unwrapResource = (value: any) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (value.status === "error" || (value.error && typeof value.error === "object"))
    throw new AuthError(rpcErrorCode(value.error || {}), 422);
  if (typeof value.schema_version === "string" && /\.mcp\.resource\./.test(value.schema_version) && value.data && typeof value.data === "object") return value.data;
  return value;
};
const coverageFromError = (error: unknown): { state: CatalogCoverageState; reason: string } => {
  if (error instanceof AuthError) {
    const code = error.code;
    if (error.status === 403 || /unauthori|forbidden|denied|AUTH_/i.test(code)) return { state: "forbidden", reason: code };
    if (/credential/i.test(code)) return { state: "not_configured", reason: code };
    if (/contract|not_found|NOT_FOUND|unsupported/i.test(code)) return { state: "needs_contract", reason: code };
    return { state: "unavailable", reason: code };
  }
  const name = (error as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return { state: "unavailable", reason: "owner_timeout" };
  return { state: "unavailable", reason: "provider_unavailable" };
};
const errorReason = (error: unknown, fallback: string) => (error instanceof AuthError ? `${fallback}:${error.code}` : fallback);
const observationTtlMs = 60_000;
const forceRefreshMinMs = 15_000;
export interface OwnerObservationResult {
  observation: OwnerObservation;
  freshness: "fresh" | "stale" | "unknown";
  failure: OwnerObservation["coverage"] | null;
  forced: boolean;
  throttled: boolean;
}

const owners: ProviderOwner[] = ["eikona", "scaena", "sonora"];
const defaultManifest: Record<ProviderOwner, NonNullable<ProviderConnection["action_manifest"]>> = {
  eikona: { submit: "generate", status: "status", reconcile: "status" },
  scaena: { submit: "createVideoProviderTask", status: "getVideoProviderTask", reconcile: "getVideoProviderTask" },
  sonora: { submit: "voice", status: "status", reconcile: "status" },
};
const modalityFor: Record<ProviderOwner, ProviderModality> = {
  eikona: "image",
  scaena: "video",
  sonora: "audio",
};
const budgetCaps: Record<ProviderOwner, number> = { eikona: 15, scaena: 10, sonora: 5 };
const totalBudgetCap = 30;
const state = (value: unknown): ProviderRunState => {
  const v = typeof value === "string" ? value.toLowerCase() : "unknown";
  if (["accepted", "received", "submitted"].includes(v)) return "accepted";
  if (["queued", "pending", "created"].includes(v)) return "queued";
  if (["running", "processing", "in_progress"].includes(v)) return "running";
  if (["succeeded", "success", "completed", "complete", "done"].includes(v)) return "succeeded";
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(v)) return "failed";
  if (["reconciling"].includes(v)) return "reconciling";
  if (["reconciled"].includes(v)) return "reconciled";
  return "unknown";
};
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value: unknown, max = 500) =>
  typeof value === "string" && value.length <= max ? value : null;
const find = (value: any, keys: string[]): any => {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) if (value[key] !== undefined) return value[key];
  for (const key of ["result", "data", "projection", "structuredContent"]) {
    if (value[key] && typeof value[key] === "object") {
      const result = find(value[key], keys);
      if (result !== undefined) return result;
    }
  }
  return undefined;
};
const readiness = (value: unknown): ProviderReadinessState => {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  if (["configured", "ready", "available", "authorized", "success", "ok", "healthy"].includes(v)) return "configured";
  if (["observed", "verified"].includes(v)) return "observed";
  if (["forbidden", "denied", "unauthorized"].includes(v)) return "forbidden";
  if (["needs_contract", "unsupported", "not_supported"].includes(v)) return "needs_contract";
  if (["stale", "expired"].includes(v)) return "stale";
  if (["unavailable", "offline", "timeout"].includes(v)) return "unavailable";
  return "needs_configuration";
};
const jsonText = (value: any): any => {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const textValue = item?.text ?? item?.text_content;
      if (typeof textValue === "string") {
        const parsed = jsonText(textValue);
        if (parsed && typeof parsed === "object") return parsed;
      }
    }
  }
  return value;
};
const providerIdFromModel = (modelRef: string) => {
  const match = modelRef.match(/(?:sonora:\/\/voice\/|sonora\/voice\/)([^/]+)/);
  return match?.[1] || (modelRef.includes("/") ? modelRef.split("/").at(-1) || "openai-tts" : modelRef || "openai-tts");
};
const normalizeBinding = (value: any): ProviderBinding | null => {
  if (!value || typeof value !== "object") return null;
  const bindingId = text(value.binding_id || value.id, 160);
  const modelRef = text(value.model || value.model_ref || value.voice_model_ref, 200);
  if (!bindingId && !modelRef) return null;
  return {
    binding_id: bindingId || modelRef || "unknown",
    model_ref: modelRef || bindingId || "unknown",
    enabled: value.enabled !== false,
    default: value.default === true,
    duration_seconds: finite(value.duration_seconds) ?? undefined,
    resolution: text(value.resolution, 40) || undefined,
    ratio: text(value.ratio, 20) || undefined,
    output_format: text(value.output_format || value.format, 40) || undefined,
    requires_reference: value.require_reference === true || value.requires_reference === true,
    disabled_reason: text(value.disabled_reason || value.reason, 240),
  };
};
const normalizeCreativeContract = (value: any): Pick<CapabilityProjection, "input_modes" | "reference_roles" | "timeline_support" | "output_constraints" | "input_schema_ref" | "limits"> => {
  const raw = value && typeof value === "object" ? value : {};
  const modes = Array.isArray(raw.input_modes) ? raw.input_modes.filter((item: unknown): item is CreativeGenerationMode => ["text_to_image", "image_to_image", "image_upscale", "text_to_video", "image_to_video", "keyframe_video", "text_to_audio", "text_to_text"].includes(String(item))) : [];
  const roles = Array.isArray(raw.reference_roles) ? raw.reference_roles.filter((item: unknown): item is CreativeReferenceRole => ["subject", "style", "composition", "motion", "first_frame", "last_frame", "keyframe"].includes(String(item))) : [];
  const timeline = raw.timeline_support && typeof raw.timeline_support === "object" ? {
    enabled: raw.timeline_support.enabled === true,
    ...(Number.isFinite(raw.timeline_support.max_keyframes) ? { max_keyframes: raw.timeline_support.max_keyframes } : {}),
    ...(typeof raw.timeline_support.requires_start_end === "boolean" ? { requires_start_end: raw.timeline_support.requires_start_end } : {}),
    ...(Array.isArray(raw.timeline_support.transitions) ? { transitions: raw.timeline_support.transitions.filter((item: unknown): item is "cut" | "interpolate" => item === "cut" || item === "interpolate") } : {}),
  } : null;
  const output = raw.output_constraints && typeof raw.output_constraints === "object" ? {
    ...(Array.isArray(raw.output_constraints.ratios) ? { ratios: raw.output_constraints.ratios.filter((item: unknown): item is string => typeof item === "string").slice(0, 32) } : {}),
    ...(Array.isArray(raw.output_constraints.resolutions) ? { resolutions: raw.output_constraints.resolutions.filter((item: unknown): item is string => typeof item === "string").slice(0, 32) } : {}),
    ...(Array.isArray(raw.output_constraints.formats) ? { formats: raw.output_constraints.formats.filter((item: unknown): item is string => typeof item === "string").slice(0, 32) } : {}),
    ...(Array.isArray(raw.output_constraints.durations_ms) ? { durations_ms: raw.output_constraints.durations_ms.filter((item: unknown): item is number => typeof item === "number" && Number.isFinite(item)).slice(0, 32) } : {}),
  } : {};
  const limits = raw.limits && typeof raw.limits === "object" ? Object.fromEntries(Object.entries(raw.limits).filter(([key, item]) => ["max_prompt_length", "max_references", "max_keyframes", "max_duration_ms", "max_variants", "max_upload_bytes"].includes(key) && typeof item === "number" && Number.isFinite(item))) : {};
  return {
    input_modes: modes,
    reference_roles: roles,
    timeline_support: timeline,
    output_constraints: output,
    input_schema_ref: text(raw.input_schema_ref, 240),
    limits,
  };
};
const normalizeRecovery = (value: any, fallbackRef: string | null): ProviderTaskRecovery => {
  const raw = String(find(value, ["recovery_state", "state", "status", "outcome"]) || "unknown").toLowerCase();
  const recoveryState: ProviderTaskRecovery["state"] = raw.includes("not_submitted") ? "not_submitted" : raw.includes("rejected") || raw.includes("invalidapikey") || raw.includes("invalid_api_key") ? "rejected_no_generation" : raw.includes("generated") || raw.includes("succeeded") || raw.includes("completed") ? "generated" : raw.includes("accepted") || raw.includes("queued") || raw.includes("running") || raw.includes("pending") ? "accepted_pending" : raw.includes("blocked") || raw.includes("credential") || raw.includes("disabled") ? "blocked" : "submission_unknown";
  const artifacts = find(value, ["artifact_refs", "output_refs", "outputs", "artifacts"]);
  return {
    state: recoveryState,
    native_state: text(find(value, ["native_state", "provider_state", "status", "state"]), 100),
    submission_ref: text(find(value, ["submission_ref", "task_ref", "task_id", "run_id"])) || fallbackRef,
    binding_id: text(find(value, ["binding_id", "binding"]), 160),
    error_code: text(find(value, ["error_code", "code", "error"]), 160),
    blocker: text(find(value, ["blocker", "blocked_reason", "reason"]), 300),
    safe_to_resubmit: typeof find(value, ["safe_to_resubmit"]) === "boolean" ? Boolean(find(value, ["safe_to_resubmit"])) : null,
    review_status: text(find(value, ["review_status"]), 100),
    export_status: text(find(value, ["export_status"]), 100),
    artifact_refs: Array.isArray(artifacts) ? artifacts.flatMap((item: any) => {
      const ref = typeof item === "string" ? item : item?.ref || item?.artifact_ref;
      return typeof ref === "string" && ref.length <= 500 ? [ref] : [];
    }).slice(0, 50) : [],
  };
};
const normalizeReceipt = (value: any, fallback: ProviderRunProjection): ProviderReceipt => {
  const source = text(find(value, ["source_ref", "run_ref", "run_id", "task_ref", "submission_ref", "id", "request_ref"]));
  const outputs = find(value, ["output_refs", "outputs", "artifacts", "results"]);
  const outputRefs = Array.isArray(outputs)
    ? outputs.flatMap((item) => {
        const ref = typeof item === "string" ? item : item?.ref || item?.artifact_ref || item?.uri;
        return typeof ref === "string" && ref.length <= 500 ? [ref] : [];
      }).slice(0, 50)
    : [];
  const errorValue = find(value, ["error_code", "code", "error"]);
  return {
    state: state(find(value, ["state", "status", "native_state", "outcome"]) ?? fallback.state),
    source_ref: source || fallback.source_ref,
    output_refs: outputRefs,
    upstream_cost: finite(find(value, ["upstream_cost", "cost", "amount", "price"])),
    currency: text(find(value, ["currency", "currency_code"])) || "CNY",
    error_code: typeof errorValue === "string" ? errorValue.slice(0, 120) : null,
    evidence_refs: [],
  };
};

function endpoint(value: string) {
  let u: URL;
  try { u = new URL(value); } catch { throw new AuthError("provider_endpoint_invalid", 503); }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
  if (u.username || u.password || u.search || u.hash || (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)))
    throw new AuthError("provider_endpoint_denied", 503);
  return u;
}

class McpProviderAdapter implements ProviderAdapter {
  owner: ProviderOwner;
  private initialized = false;
  private protocol = "2025-06-18";
  private manifest: NonNullable<ProviderConnection["action_manifest"]>;
  constructor(private connection: ProviderConnection, private fetcher: typeof fetch = fetch) {
    this.owner = connection.owner;
    this.manifest = { ...defaultManifest[this.owner], ...(connection.action_manifest || {}) };
    endpoint(connection.endpoint);
  }
  private token() {
    const value = this.connection.credential_ref
      ? secret(this.connection.credential_ref)
      : this.connection.credential_env
        ? process.env[this.connection.credential_env] || ""
        : "";
    if (!value) throw new AuthError("provider_credential_missing", 503);
    return value;
  }
  private async rpc(method: string, params?: unknown, notification = false, timeoutMs = 15000) {
    const id = randomUUID();
    const response = await this.fetcher(endpoint(this.connection.endpoint), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: "Bearer " + this.token(),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": this.protocol,
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new AuthError("provider_unauthorized", 403);
    }
    if (notification) {
      await response.body?.cancel();
      if (!response.ok) throw new AuthError("provider_unavailable", 503);
      return null;
    }
    const value: any = await boundedJSON(response, 2 * 1024 * 1024);
    if (value.id !== id) throw new AuthError("provider_invalid_response", 503);
    const toolError = value.result?.structuredContent?.error || value.error;
    if (toolError) throw new AuthError(rpcErrorCode(toolError), 422);
    return value;
  }
  private async initialize() {
    if (this.initialized) return;
    const value: any = await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "yeisme-control-center", version: "0.1.0" },
    });
    const protocol = value?.result?.protocolVersion;
    if (typeof protocol !== "string") throw new AuthError("provider_initialization_failed", 503);
    this.protocol = protocol;
    this.serverInfo = {
      protocol_version: protocol,
      server_name: text(value?.result?.serverInfo?.name, 120),
      server_version: text(value?.result?.serverInfo?.version, 60),
    };
    await this.rpc("notifications/initialized", undefined, true);
    this.initialized = true;
  }
  private serverInfo: OwnerObservation["server"] = { protocol_version: null, server_name: null, server_version: null };
  /** Follows tools/list pagination; tool bodies are summarized by the catalog normalizer. */
  private async listTools(maxPages = 5) {
    await this.initialize();
    const tools: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const value: any = await this.rpc("tools/list", cursor ? { cursor } : {}, false, discoveryTimeoutMs);
      const list = value?.result?.tools || value?.result?.structuredContent?.tools;
      if (Array.isArray(list)) tools.push(...list);
      cursor = typeof value?.result?.nextCursor === "string" && value.result.nextCursor ? value.result.nextCursor : undefined;
      if (!cursor) break;
    }
    return tools;
  }
  private async readResourceJSON(uri: string) {
    await this.initialize();
    const value: any = await this.rpc("resources/read", { uri }, false, discoveryTimeoutMs);
    return unwrapResource(jsonText(value.result?.contents || value.result?.structuredContent || value.result || value));
  }
  /** Discovery may only issue owner calls that are documented as read-only diagnostics. */
  private async discoveryCall(name: string, args: Record<string, unknown>) {
    const action = name === this.owner + ".execute" ? String(args.action || "") : "";
    if (!(action ? discoveryActions.has(action) : discoveryTools.has(name))) throw new AuthError("discovery_call_not_allowed", 500);
    await this.initialize();
    const value: any = await this.rpc("tools/call", { name, arguments: args }, false, discoveryTimeoutMs);
    return value.result?.structuredContent || value.result || value;
  }
  private async callTool(toolName: string, args: Record<string, unknown>) {
    await this.initialize();
    const value: any = await this.rpc("tools/call", {
      name: toolName,
      arguments: args,
    });
    return value.result?.structuredContent || value.result || value;
  }
  private async call(action: string, args: Record<string, unknown>) {
    return this.callTool(this.owner + ".execute", { action, args });
  }
  /** One read-only discovery pass for this owner; the catalog and the capability projection share it. */
  async observe(): Promise<OwnerObservation> {
    const observedAt = new Date().toISOString();
    const result: OwnerObservation = {
      owner: this.owner, observed_at: observedAt, coverage: { state: "readable", reason: null }, server: this.serverInfo,
      tools: [], actions: [], models: [], channels: [], readiness: [], latest_policy: null, native_channels: [], complete_kinds: [],
      capability: { state: "needs_configuration", readiness: "needs_configuration", observed_at: observedAt, provider_refs: [], model_refs: this.connection.model_refs || [], voice_refs: [], bindings: [], diagnostic: null, blocker: null, ...normalizeCreativeContract(null) },
    };
    // Several resources can be unreadable in one pass; keep each distinct reason (joined by "|").
    const partial = (reason: string) => {
      if (result.coverage.state === "readable") result.coverage = { state: "partial", reason };
      else if (result.coverage.state === "partial" && !result.coverage.reason?.split("|").includes(reason)) result.coverage = { state: "partial", reason: [result.coverage.reason, reason].filter(Boolean).join("|") };
    };
    try {
      const rawTools = await this.listTools();
      result.server = this.serverInfo;
      result.tools = normalizeTools(this.owner, rawTools);
      result.complete_kinds.push("server", "tool");
      if (!result.tools.some((tool) => tool.name === this.owner + ".execute")) {
        result.coverage = { state: "needs_contract", reason: "owner_execute_tool_missing" };
        result.capability = { ...result.capability, state: "needs_contract", readiness: "needs_contract", blocker: "owner_execute_tool_missing" };
        return result;
      }
      if (this.owner === "scaena") {
        const media: any = await this.discoveryCall("scaena.execute", { action: "getProjectMediaCapabilities", args: { path: { project_id: this.connection.project || "" } } });
        const guide = await this.readResourceJSON("scaena://video-tasks/guide").catch((error) => { partial(errorReason(error, "guide_unreadable")); return null; });
        const parsed = scaenaGuide(guide);
        if (guide) result.complete_kinds.push("action", "model", "channel");
        Object.assign(result, { actions: parsed.actions, models: parsed.models, channels: parsed.channels, latest_policy: parsed.latest_policy, native_channels: parsed.native_channels });
        const rawBindings = parsed.bindings.length ? parsed.bindings : find(media, ["bindings"]);
        const bindings = Array.isArray(rawBindings) ? rawBindings.map(normalizeBinding).filter(Boolean) as ProviderBinding[] : [];
        const mediaState = String(find(media, ["state", "status"]) || "").toLowerCase();
        const guideBlocker = parsed.blocked_reason || text(find(guide, ["blocker", "reason"]), 300);
        const blocked = mediaState === "blocked" || guideBlocker !== null || bindings.some((binding) => binding.enabled === false);
        const bindingBlocker = bindings.find((binding) => binding.enabled === false)?.disabled_reason || null;
        result.capability = {
          ...result.capability,
          ...deriveCreativeContract("scaena", { actions: parsed.actions, bindings: parsed.bindings }),
          state: blocked ? "needs_configuration" : "configured",
          readiness: blocked ? "needs_configuration" : "configured",
          model_refs: [...new Set([...result.capability.model_refs, ...bindings.map((binding) => binding.model_ref).filter(Boolean)])],
          bindings,
          blocker: guideBlocker || (mediaState === "blocked" ? "project_media_capability_blocked" : bindingBlocker),
        };
        return result;
      }
      if (this.owner === "sonora") {
        const discovery = await this.readResourceJSON("sonora://capabilities").catch((error) => { partial(errorReason(error, "discovery_unreadable")); return null; });
        const parsed = sonoraDiscovery(discovery);
        if (discovery && parsed.actions.length) result.complete_kinds.push("action");
        result.actions = parsed.actions;
        result.readiness = parsed.readiness;
        const providerId = providerIdFromModel(this.connection.model_refs?.[0] || "openai-tts");
        const credentialStatus: any = await this.discoveryCall("sonora.execute", { action: "credential.status", args: { provider_id: providerId } }).catch(() => null);
        const diagnosis: any = await this.discoveryCall("sonora.execute", { action: "doctor.run", args: { provider_id: providerId } });
        const catalog: any = await this.discoveryCall("sonora.search", { query: providerId, types: ["provider", "model", "voice"], limit: 50 }).catch(() => null);
        const diagnosisConfigured = find(diagnosis, ["configured"]);
        const configured = diagnosisConfigured ?? find(credentialStatus, ["configured"]);
        const diagnosticCode = text(find(diagnosis, ["diagnostic_status", "status", "code", "error_code"]), 160);
        const diagnosticShapeValid = typeof diagnosisConfigured === "boolean" || diagnosticCode !== null || (diagnosis && typeof diagnosis === "object" && Object.keys(diagnosis).length > 0 && find(diagnosis, ["diagnostic", "provider", "readiness"]) !== undefined);
        const diagnosticState = !diagnosticShapeValid ? "unavailable" as const : diagnosticCode === "credential_missing" ? "needs_configuration" as const : ["success", "ok", "healthy", "ready"].includes((diagnosticCode || "").toLowerCase()) ? "configured" as const : diagnosisConfigured === false ? "needs_configuration" as const : readiness(diagnosticCode || "configured");
        const entries = jsonText(catalog);
        const refs = Array.isArray(find(entries, ["providers", "results", "items"])) ? find(entries, ["providers", "results", "items"]) as any[] : [];
        const providerRefs = refs.flatMap((item) => { const ref = text(item?.provider_id || item?.id || item?.ref, 200); return ref ? [ref] : []; });
        const modelRefs = refs.flatMap((item) => { const ref = text(item?.model_ref || item?.model_id, 200); return ref ? [ref] : []; });
        const voiceRefs = refs.flatMap((item) => { const ref = text(item?.voice_ref || item?.voice_id, 200); return ref ? [ref] : []; });
        const diagnostic: ProviderDiagnostic = { status: diagnosticState, code: diagnosticCode, configured: typeof configured === "boolean" ? configured : null, blocker: ["needs_configuration", "unavailable"].includes(diagnosticState) ? diagnosticCode || "sonora_provider_not_ready" : null, observed_at: observedAt };
        result.models = [...new Set([...result.capability.model_refs, ...modelRefs])].map((modelRef) => ({
          id: modelRef, owner: "sonora", model_ref: modelRef, original_model_ref: null, provider: providerRefs[0] || providerId, channel: null, operation: "speech", capabilities: [],
          input_modalities: ["text"], output_modalities: ["audio"], durations: [], resolutions: [], ratios: [], pricing: null, readiness: diagnosticState,
          status: "unknown", status_source: "undeclared", observed_at: observedAt, expires_at: null, digest: null, warnings: [], source: "sonora.search",
        }));
        // sonora.search is a bounded, query-scoped listing, not an authoritative model catalog: never record removals from it.
        result.capability = {
          ...result.capability,
          ...deriveCreativeContract("sonora", { actions: parsed.actions }),
          state: diagnosticState === "configured" || diagnosticState === "observed" ? "configured" : "needs_configuration",
          readiness: diagnosticState,
          provider_refs: [...new Set(providerRefs)],
          model_refs: [...new Set([...result.capability.model_refs, ...modelRefs])],
          voice_refs: [...new Set(voiceRefs)],
          diagnostic,
          blocker: diagnostic.blocker,
        };
        return result;
      }
      const runtime = await this.readResourceJSON("eikona://runtime/capabilities").catch((error) => { partial(errorReason(error, "runtime_capabilities_unreadable")); return null; });
      const parsed = eikonaActions(runtime);
      if (runtime) result.complete_kinds.push("action");
      result.actions = parsed.actions;
      const models = await this.readResourceJSON("eikona://models/readiness").catch((error) => { partial(errorReason(error, "model_snapshot_unreadable")); return null; });
      if (models) { result.models = normalizeModels("eikona", models, "eikona://models/readiness"); result.complete_kinds.push("model"); }
      const channels = await this.readResourceJSON("eikona://channels").catch((error) => { partial(errorReason(error, "channel_summary_unreadable")); return null; });
      if (channels) { result.channels = normalizeChannels("eikona", channels); result.complete_kinds.push("channel"); }
      result.capability = {
        ...result.capability,
        ...deriveCreativeContract("eikona", { actions: parsed.actions }),
        state: "configured",
        readiness: "configured",
        model_refs: [...new Set([...result.capability.model_refs, ...result.models.filter((model) => model.status !== "historical").map((model) => model.model_ref)])].slice(0, 50),
      };
      return result;
    } catch (error) {
      const coverage = coverageFromError(error);
      result.coverage = coverage;
      const providerState: ProviderReadinessState = coverage.state === "needs_contract" ? "needs_contract" : coverage.state === "forbidden" ? "forbidden" : coverage.state === "not_configured" ? "needs_configuration" : "unavailable";
      result.capability = { ...result.capability, state: providerState === "needs_contract" ? "needs_contract" : "needs_configuration", readiness: providerState, blocker: coverage.reason || "provider_unavailable" };
      return result;
    }
  }
  async discover() {
    return (await this.observe()).capability;
  }
  async estimate(input: ProviderRunRequest) {
    const action = this.manifest.estimate;
    if (!action) return { amount: input.budget_cap.amount, currency: input.budget_cap.currency };
    try {
      const result = await this.call(action, { model_ref: input.model_ref, project_ref: input.project_ref, modality: input.modality });
      return { amount: finite(find(result, ["amount", "cost", "price"])), currency: text(find(result, ["currency", "currency_code"])) || "CNY" };
    } catch {
      return { amount: null, currency: "CNY" };
    }
  }
  private args(input: ProviderRunRequest, sourceRef?: string) {
    const idempotency = input.idempotency_key;
    const creative = {
      ...(input.generation_mode ? { generation_mode: input.generation_mode } : {}),
      ...(input.references?.length ? { references: input.references } : {}),
      ...(input.timeline ? { timeline: input.timeline } : {}),
      ...(input.output && Object.keys(input.output).length ? { output: input.output } : {}),
      ...(input.variant_count ? { variant_count: input.variant_count } : {}),
    };
    if (this.owner === "eikona" && sourceRef) return { run_id: sourceRef };
    if (this.owner === "scaena") {
      const body = {
        prompt: input.prompt,
        model: input.model_ref,
        production_scope: "experiment",
        duration_seconds: 5,
        resolution: "720P",
        ratio: "16:9",
        confirmed: true,
        acknowledge_unknown_cost: true,
        max_cost_micro_usd: Math.max(1, Math.round(input.budget_cap.amount * 1_000_000)),
        ...creative,
      };
      return {
        path: { project_id: input.project_ref, ...(sourceRef ? { submission_ref: sourceRef } : {}) },
        body,
        idempotency_key: idempotency,
      };
    }
    if (this.owner === "sonora") {
      const providerId = input.model_ref.includes("/") ? input.model_ref.split("/")[1] : "openai-tts";
      return {
        confirm_external_call: true,
        max_cost_usd: Math.max(0.01, input.budget_cap.amount / 10).toFixed(2),
        provider_id: providerId,
        voice_model_ref: input.model_ref,
        text: input.prompt,
        idempotency_key: idempotency,
        ...creative,
      };
    }
    return {
      prompt: input.prompt,
      model: input.model_ref,
      project_id: input.project_ref,
      confirm_external_call: true,
      idempotency_key: idempotency,
      ...creative,
    };
  }
  async submit(input: ProviderRunRequest) {
    return normalizeReceipt(await this.call(this.manifest.submit, this.args(input)), {
      run_ref: "", owner: this.owner, modality: input.modality, model_ref: input.model_ref,
      scope_id: input.scope_id, project_ref: input.project_ref, trace_ref: input.trace_ref || "",
      source_ref: null, state: "accepted", output_refs: [], upstream_cost: null, currency: "CNY",
      cost_state: "unknown", observed_at: new Date().toISOString(), created_at: new Date().toISOString(), evidence_refs: [], error_code: null, connection_state: "configured",
    });
  }
  async status(run: ProviderRunProjection) {
    if (!run.source_ref || !this.manifest.status) return { state: run.state, source_ref: run.source_ref, output_refs: run.output_refs, upstream_cost: run.upstream_cost, currency: run.currency, error_code: run.error_code, evidence_refs: run.evidence_refs };
    return normalizeReceipt(await this.call(this.manifest.status, this.args({ mode: "live", owner: this.owner, modality: run.modality, model_ref: run.model_ref, scope_id: run.scope_id, project_ref: run.project_ref, prompt: "", budget_cap: { amount: 0, currency: "CNY" }, idempotency_key: run.trace_ref, trace_ref: run.trace_ref }, run.source_ref)), run);
  }
  async reconcile(run: ProviderRunProjection) {
    if (!run.source_ref) return this.status(run);
    const action = this.owner === "scaena" ? "reconcileVideoProviderTask" : this.manifest.reconcile;
    if (!action) return this.status(run);
    return normalizeReceipt(await this.call(action, this.args({ mode: "live", owner: this.owner, modality: run.modality, model_ref: run.model_ref, scope_id: run.scope_id, project_ref: run.project_ref, prompt: "", budget_cap: { amount: 0, currency: "CNY" }, idempotency_key: run.trace_ref, trace_ref: run.trace_ref }, run.source_ref)), run);
  }
}

export class ProviderRunManager {
  private listeners = new Map<string, Set<(run: ProviderRunProjection) => void>>();
  private adapters = new Map<ProviderOwner, ProviderAdapter>();
  private store: RunStore;
  constructor(private config: ServerConfig, private fetcher: typeof fetch = fetch, runs?: RunStore) {
    this.store = runs ?? new RunStore(createMemoryDB());
    for (const owner of owners) {
      const connection = config.providers?.[owner];
      if (connection?.enabled) this.adapters.set(owner, new McpProviderAdapter(connection, fetcher));
    }
  }
  private validate(input: ProviderRunRequest, scope: ScopeBinding) {
    if (input.mode !== "live" || input.prompt.length < 1 || input.prompt.length > 10000)
      throw new AuthError("invalid_provider_request", 400);
    if (input.scope_id !== scope.id) throw new AuthError("scope_mismatch", 403);
    if (input.budget_cap.currency !== "CNY" || !Number.isFinite(input.budget_cap.amount) || input.budget_cap.amount <= 0)
      throw new AuthError("invalid_provider_budget", 400);
    if (input.budget_cap.amount > budgetCaps[input.owner]) throw new AuthError("provider_budget_exceeded", 409);
    const reservedTotal = this.store.reservedBudget();
    if (reservedTotal + input.budget_cap.amount > totalBudgetCap) throw new AuthError("provider_total_budget_exceeded", 409);
    if (!/^[-a-zA-Z0-9_:.]{16,160}$/.test(input.idempotency_key)) throw new AuthError("invalid_idempotency_key", 400);
    if (input.owner !== ({ image: "eikona", video: "scaena", audio: "sonora" } as Record<ProviderModality, ProviderOwner>)[input.modality]) throw new AuthError("provider_modality_mismatch", 400);
    if (!scope.owners[input.owner] || scope.owners[input.owner]?.project !== input.project_ref) throw new AuthError("scope_mismatch", 403);
    const connection = this.config.providers?.[input.owner];
    if (!connection?.enabled) throw new AuthError("provider_not_configured", 503);
    if (connection.project && connection.project !== input.project_ref) throw new AuthError("provider_project_mismatch", 403);
  }
  private publish(run: ProviderRunProjection) {
    this.store.updateRun(run);
    for (const listener of this.listeners.get(run.run_ref) || []) listener(run);
  }
  private async monitor(runRef: string) {
    for (let i = 0; i < 80; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const current = this.store.getRun(runRef);
      if (!current || ["succeeded", "failed", "reconciled"].includes(current.state)) return;
      const adapter = this.adapters.get(current.owner);
      if (!adapter) return;
      try {
        const receipt = await adapter.status(current);
        const next = this.applyReceipt(current, receipt);
        this.publish(next);
        if (["succeeded", "failed"].includes(next.state)) return;
      } catch {
        // A transient status failure does not create a new attempt; timeout becomes unknown.
      }
    }
    const current = this.store.getRun(runRef);
    if (current && !["succeeded", "failed", "reconciled"].includes(current.state))
      this.publish({ ...current, state: "unknown", error_code: "status_timeout", observed_at: new Date().toISOString() });
  }
  private applyReceipt(run: ProviderRunProjection, receipt: ProviderReceipt): ProviderRunProjection {
    const next = {
      ...run,
      state: receipt.state,
      source_ref: receipt.source_ref || run.source_ref,
      output_refs: receipt.output_refs.length ? receipt.output_refs : run.output_refs,
      upstream_cost: receipt.upstream_cost ?? run.upstream_cost,
      currency: receipt.currency || run.currency,
      cost_state: receipt.upstream_cost === null ? run.cost_state : "confirmed" as const,
      evidence_refs: receipt.evidence_refs.length ? receipt.evidence_refs : run.evidence_refs,
      error_code: receipt.error_code,
      observed_at: new Date().toISOString(),
    };
    if (next.source_ref) {
      this.store.putUsage({
        source_ref: next.source_ref,
        trace_ref: next.trace_ref,
        owner: next.owner,
        model_ref: next.model_ref,
        modality: next.modality,
        quantity: next.output_refs.length || null,
        unit: next.modality === "video" ? "outputs" : next.modality === "audio" ? "outputs" : "images",
        upstream_cost: next.upstream_cost,
        currency: next.currency,
        cost_state: next.cost_state,
        status: next.state,
        project_ref: next.project_ref,
        created_at: next.created_at,
      });
    }
    return next;
  }
  private observations = new Map<ProviderOwner, { latest: OwnerObservation; at: number; forcedAt: number; lastGood: OwnerObservation | null }>();
  private inflight = new Map<ProviderOwner, Promise<OwnerObservation>>();
  /**
   * Cached, de-duplicated owner discovery shared by /capabilities and /tool-catalog. A transient
   * failure serves the last good pass marked stale; forced refreshes are rate-limited per owner.
   */
  async observeOwner(owner: ProviderOwner, options: { force?: boolean } = {}): Promise<OwnerObservationResult | null> {
    const adapter = this.adapters.get(owner);
    if (!adapter) return null;
    const now = Date.now();
    let entry = this.observations.get(owner);
    const throttled = !!options.force && !!entry && now - entry.forcedAt < forceRefreshMinMs;
    const forced = !!options.force && !throttled;
    if (!entry || now - entry.at >= observationTtlMs || forced) {
      let pending = this.inflight.get(owner);
      if (!pending) {
        pending = adapter.observe().finally(() => this.inflight.delete(owner));
        this.inflight.set(owner, pending);
      }
      const latest = await pending;
      const previous = this.observations.get(owner);
      entry = { latest, at: Date.now(), forcedAt: forced ? Date.now() : previous?.forcedAt ?? 0, lastGood: latest.coverage.state === "unavailable" ? previous?.lastGood ?? null : latest };
      this.observations.set(owner, entry);
    }
    const transient = entry.latest.coverage.state === "unavailable";
    if (transient && entry.lastGood)
      return { observation: entry.lastGood, freshness: "stale", failure: entry.latest.coverage, forced, throttled };
    return { observation: entry.latest, freshness: transient ? "unknown" : "fresh", failure: transient ? entry.latest.coverage : null, forced, throttled };
  }
  async capabilities(scope: ScopeBinding): Promise<CapabilityProjection[]> {
    const bound = owners.filter((owner) => scope.owners[owner]);
    const observed = await Promise.all(bound.map(async (owner) => [owner, await this.observeOwner(owner)] as const));
    return observed.map(([owner, entry]) => {
      const connection = this.config.providers?.[owner];
      const stale = entry?.freshness === "stale";
      const observation = entry
        ? { ...entry.observation.capability, ...(stale ? { readiness: "stale" as const, blocker: entry.failure?.reason || "owner_observation_stale" } : {}) }
        : { state: "needs_configuration" as const, readiness: "needs_configuration" as const, observed_at: new Date().toISOString(), provider_refs: [], model_refs: connection?.model_refs || [], voice_refs: [], bindings: [], diagnostic: null, blocker: "provider_not_configured", ...normalizeCreativeContract(null) };
      const model = connection?.model_refs?.[0] || observation.model_refs[0] || (owner === "eikona" ? "openai/gpt-image-2.5-sunburst" : owner === "scaena" ? "seedance25-ark-text-1080p" : "sonora/voice");
      return { id: owner + ":" + modalityFor[owner], owner, modality: modalityFor[owner], name: owner[0].toUpperCase() + owner.slice(1), model_ref: model, state: observation.state, transport: "mcp" as const, supports_live_submit: observation.state === "configured" && !stale, observed_at: observation.observed_at, readiness: observation.readiness, submit_gate: "disabled_by_default" as const, provider_refs: observation.provider_refs, model_refs: [...new Set([model, ...observation.model_refs])], voice_refs: observation.voice_refs, bindings: observation.bindings, diagnostic: observation.diagnostic, blocker: observation.blocker, input_modes: observation.input_modes, reference_roles: observation.reference_roles, timeline_support: observation.timeline_support, output_constraints: observation.output_constraints, input_schema_ref: observation.input_schema_ref, limits: observation.limits };
    });
  }
  async create(input: ProviderRunRequest, scope: ScopeBinding, _session: Session): Promise<ProviderRunProjection> {
    this.validate(input, scope);
    const existing = this.store.getIdempotency(input.idempotency_key);
    if (existing) {
      const prior = this.store.getRun(existing);
      if (prior) return prior;
      throw new AuthError("idempotency_state_missing", 409);
    }
    const runRef = "run_" + randomUUID().replaceAll("-", "");
    const now = new Date().toISOString();
    let run: ProviderRunProjection = {
      run_ref: runRef,
      owner: input.owner,
      modality: input.modality,
      model_ref: input.model_ref,
      scope_id: input.scope_id,
      project_ref: input.project_ref,
      trace_ref: input.trace_ref || "trace_" + randomUUID().replaceAll("-", ""),
      source_ref: null,
      state: "accepted",
      output_refs: [],
      upstream_cost: null,
      currency: "CNY",
      cost_state: "unknown",
      observed_at: now,
      created_at: now,
      evidence_refs: [],
      error_code: null,
      connection_state: "configured",
    };
    this.store.putIdempotency(input.idempotency_key, runRef);
    this.store.insertRun(run, input.budget_cap.amount);
    this.publish(run);
    const adapter = this.adapters.get(input.owner)!;
    try {
      const estimate = await adapter.estimate(input);
      if (estimate.amount !== null && estimate.amount > input.budget_cap.amount) throw new AuthError("provider_budget_exceeded", 409);
      const receipt = await adapter.submit(input);
      run = this.applyReceipt({ ...run, state: receipt.source_ref ? "queued" : "unknown", cost_state: receipt.upstream_cost === null ? "unknown" : "confirmed" }, receipt);
      this.publish(run);
      if (!["succeeded", "failed", "unknown"].includes(run.state)) void this.monitor(run.run_ref);
    } catch (error) {
      run = { ...run, state: error instanceof AuthError && error.code === "provider_budget_exceeded" ? "failed" : "unknown", error_code: error instanceof AuthError ? error.code : "provider_submit_unknown", observed_at: new Date().toISOString() };
      this.publish(run);
    }
    return run;
  }
  get(runRef: string) { return this.store.getRun(runRef); }
  usageRows(scope: ScopeBinding) { return this.store.usageRows(scope.project); }
  budgetStatus() {
    const reserved = this.store.reservedBudget();
    return { total: totalBudgetCap, reserved, remaining: Math.max(0, totalBudgetCap - reserved), per_owner: budgetCaps };
  }
  async reconcile(runRef: string) {
    const run = this.store.getRun(runRef);
    if (!run) throw new AuthError("run_not_found", 404);
    if (!run.source_ref) return run;
    const adapter = this.adapters.get(run.owner);
    if (!adapter) throw new AuthError("provider_not_configured", 503);
    const next = this.applyReceipt({ ...run, state: "reconciling", observed_at: new Date().toISOString() }, await adapter.reconcile(run));
    this.publish(next.state === "unknown" ? { ...next, state: "unknown" } : { ...next, state: next.state === "succeeded" || next.state === "failed" ? "reconciled" : next.state });
    return this.store.getRun(runRef)!;
  }
  subscribe(runRef: string, listener: (run: ProviderRunProjection) => void) {
    const set = this.listeners.get(runRef) || new Set<(run: ProviderRunProjection) => void>();
    set.add(listener); this.listeners.set(runRef, set);
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(runRef); };
  }
}
