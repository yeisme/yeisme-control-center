import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { AuthError, boundedJSON, secret } from "./auth";
import type {
  ProviderConnection,
  ProviderModality,
  ProviderOwner,
  ScopeBinding,
  ServerConfig,
  Session,
} from "./contracts";

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
}
export interface ProviderAdapter {
  owner: ProviderOwner;
  discover(): Promise<{ state: CapabilityProjection["state"]; observed_at: string }>;
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
const find = (value: any, keys: string[]): unknown => {
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
  private async rpc(method: string, params?: unknown, notification = false) {
    const id = randomUUID();
    const response = await this.fetcher(endpoint(this.connection.endpoint), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: "Bearer " + this.token(),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": this.protocol,
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
    });
    if (notification) {
      await response.body?.cancel();
      if (!response.ok) throw new AuthError(response.status === 401 || response.status === 403 ? "provider_unauthorized" : "provider_unavailable", response.status === 401 || response.status === 403 ? 403 : 503);
      return null;
    }
    const value: any = await boundedJSON(response, 2 * 1024 * 1024);
    if (value.id !== id) throw new AuthError("provider_invalid_response", 503);
    const toolError = value.result?.structuredContent?.error || value.error;
    if (toolError) throw new AuthError(String(toolError.code || "provider_action_denied").slice(0, 100), 422);
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
    await this.rpc("notifications/initialized", undefined, true);
    this.initialized = true;
  }
  private async call(action: string, args: Record<string, unknown>) {
    await this.initialize();
    const value: any = await this.rpc("tools/call", {
      name: this.owner + ".execute",
      arguments: { action, args },
    });
    return value.result?.structuredContent || value.result || value;
  }
  async discover() {
    try {
      await this.initialize();
      const value: any = await this.rpc("tools/list", { cursor: undefined });
      const tools = value?.result?.tools || value?.result?.structuredContent?.tools;
      if (!Array.isArray(tools) || !tools.some((v) => v?.name === this.owner + ".execute"))
        return { state: "needs_contract" as const, observed_at: new Date().toISOString() };
      if (this.owner === "scaena") {
        const readiness: any = await this.call("getProjectMediaCapabilities", { path: { project_id: this.connection.project || "" } });
        if (!readiness || find(readiness, ["state", "status"]) === "blocked")
          return { state: "needs_configuration" as const, observed_at: new Date().toISOString() };
      }
      if (this.owner === "sonora") {
        const providerId = (this.connection.model_refs?.[0] || "").split("/")[1] || "openai-tts";
        const readiness: any = await this.call("doctor.run", { provider_id: providerId });
        const configured = find(readiness, ["configured"]);
        const diagnostic = find(readiness, ["diagnostic_status", "status"]);
        if (configured === false || diagnostic === "credential_missing")
          return { state: "needs_configuration" as const, observed_at: new Date().toISOString() };
      }
      return { state: "configured" as const, observed_at: new Date().toISOString() };
    } catch (error) {
      if (error instanceof AuthError && error.code.includes("contract")) return { state: "needs_contract" as const, observed_at: new Date().toISOString() };
      if (error instanceof AuthError && error.code.includes("credential")) return { state: "needs_configuration" as const, observed_at: new Date().toISOString() };
      return { state: "needs_configuration" as const, observed_at: new Date().toISOString() };
    }
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
      };
    }
    return {
      prompt: input.prompt,
      model: input.model_ref,
      project_id: input.project_ref,
      confirm_external_call: true,
      idempotency_key: idempotency,
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
    if (!run.source_ref || !this.manifest.reconcile) return this.status(run);
    return normalizeReceipt(await this.call(this.manifest.reconcile, this.args({ mode: "live", owner: this.owner, modality: run.modality, model_ref: run.model_ref, scope_id: run.scope_id, project_ref: run.project_ref, prompt: "", budget_cap: { amount: 0, currency: "CNY" }, idempotency_key: run.trace_ref, trace_ref: run.trace_ref }, run.source_ref)), run);
  }
}

export class ProviderRunManager {
  private runs = new Map<string, ProviderRunProjection>();
  private usage = new Map<string, UsageEventProjection>();
  private idempotency = new Map<string, string>();
  private listeners = new Map<string, Set<(run: ProviderRunProjection) => void>>();
  private adapters = new Map<ProviderOwner, ProviderAdapter>();
  private reservations = new Map<string, number>();
  constructor(private config: ServerConfig, private fetcher: typeof fetch = fetch) {
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
    const reservedTotal = [...this.reservations.values()].reduce((sum, value) => sum + value, 0);
    if (reservedTotal + input.budget_cap.amount > totalBudgetCap) throw new AuthError("provider_total_budget_exceeded", 409);
    if (!/^[-a-zA-Z0-9_:.]{16,160}$/.test(input.idempotency_key)) throw new AuthError("invalid_idempotency_key", 400);
    if (input.owner !== ({ image: "eikona", video: "scaena", audio: "sonora" } as Record<ProviderModality, ProviderOwner>)[input.modality]) throw new AuthError("provider_modality_mismatch", 400);
    if (!scope.owners[input.owner] || scope.owners[input.owner]?.project !== input.project_ref) throw new AuthError("scope_mismatch", 403);
    const connection = this.config.providers?.[input.owner];
    if (!connection?.enabled) throw new AuthError("provider_not_configured", 503);
    if (connection.project && connection.project !== input.project_ref) throw new AuthError("provider_project_mismatch", 403);
  }
  private publish(run: ProviderRunProjection) {
    this.runs.set(run.run_ref, run);
    for (const listener of this.listeners.get(run.run_ref) || []) listener(run);
  }
  private async monitor(runRef: string) {
    for (let i = 0; i < 80; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const current = this.runs.get(runRef);
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
    const current = this.runs.get(runRef);
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
      this.usage.set(run.owner + ":" + next.source_ref, {
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
  async capabilities(scope: ScopeBinding): Promise<CapabilityProjection[]> {
    const result: CapabilityProjection[] = [];
    for (const owner of owners) {
      if (!scope.owners[owner]) continue;
      const connection = this.config.providers?.[owner];
      const adapter = this.adapters.get(owner);
      const observation = adapter ? await adapter.discover() : { state: "needs_configuration" as const, observed_at: new Date().toISOString() };
      const model = connection?.model_refs?.[0] || (owner === "eikona" ? "openai/gpt-image-2.5-sunburst" : owner === "scaena" ? "seedance25-ark-text-1080p" : "sonora/voice");
      result.push({ id: owner + ":" + modalityFor[owner], owner, modality: modalityFor[owner], name: owner[0].toUpperCase() + owner.slice(1), model_ref: model, state: observation.state, transport: "mcp", supports_live_submit: observation.state === "configured", observed_at: observation.observed_at });
    }
    if (!scope) return [];
    return result;
  }
  async create(input: ProviderRunRequest, scope: ScopeBinding, _session: Session): Promise<ProviderRunProjection> {
    this.validate(input, scope);
    const existing = this.idempotency.get(input.idempotency_key);
    if (existing) {
      const prior = this.runs.get(existing);
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
    this.idempotency.set(input.idempotency_key, runRef);
    this.reservations.set(runRef, input.budget_cap.amount);
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
      if (error instanceof AuthError && ["provider_budget_exceeded", "provider_total_budget_exceeded"].includes(error.code)) this.reservations.delete(runRef);
      this.publish(run);
    }
    return run;
  }
  get(runRef: string) { return this.runs.get(runRef) || null; }
  usageRows(scope: ScopeBinding) { return [...this.usage.values()].filter((v) => v.project_ref === scope.project).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  budgetStatus() {
    const reserved = [...this.reservations.values()].reduce((sum, value) => sum + value, 0);
    return { total: totalBudgetCap, reserved, remaining: Math.max(0, totalBudgetCap - reserved), per_owner: budgetCaps };
  }
  async reconcile(runRef: string) {
    const run = this.runs.get(runRef);
    if (!run) throw new AuthError("run_not_found", 404);
    if (!run.source_ref) return run;
    const adapter = this.adapters.get(run.owner);
    if (!adapter) throw new AuthError("provider_not_configured", 503);
    const next = this.applyReceipt({ ...run, state: "reconciling", observed_at: new Date().toISOString() }, await adapter.reconcile(run));
    this.publish(next.state === "unknown" ? { ...next, state: "unknown" } : { ...next, state: next.state === "succeeded" || next.state === "failed" ? "reconciled" : next.state });
    return this.runs.get(runRef)!;
  }
  subscribe(runRef: string, listener: (run: ProviderRunProjection) => void) {
    const set = this.listeners.get(runRef) || new Set<(run: ProviderRunProjection) => void>();
    set.add(listener); this.listeners.set(runRef, set);
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(runRef); };
  }
}
