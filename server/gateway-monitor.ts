import { AuthError, boundedJSON, secret } from "./auth";
import { endpointURL } from "./task-connections";
import type { OpenToolConnection, ScopeBinding } from "./contracts";
import { gatewayMonitorSchema, type GatewayCall, type GatewayCallDetail, type GatewayClientPreset, type GatewayMonitorSnapshot, type GatewayPlan, type GatewayAgentSession, type GatewayTelemetry } from "../src/shared/gateway-monitor";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
const safeRef = (value: unknown, prefix = "") => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) && (!prefix || value.startsWith(prefix)) ? value : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown) => Array.isArray(value) ? value : [];
const code = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : undefined;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const validDate = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";
const callState = (value: unknown): GatewayCall["state"] => ["queued", "running", "succeeded", "failed", "unknown", "in_progress", "awaiting_approval", "blocked"].includes(String(value)) ? value as GatewayCall["state"] : "unknown";
const recoveryFor = (state: GatewayCall["state"]): GatewayCallDetail["recovery"] => {
  if (state === "unknown") return "reconcile_required";
  if (state === "failed") return "query_original_operation";
  return "none";
};

export class GatewayMonitorService {
  private readonly base: URL;
  constructor(private readonly connection: OpenToolConnection, private readonly fetcher: Fetcher = fetch) {
    const endpoint = endpointURL(connection.endpoint, connection.allow_private_http, "open_tool_endpoint_denied");
    this.base = new URL(endpoint.href.endsWith("/") ? endpoint.href : `${endpoint.href}/`);
  }

  private async request<T>(route: string, options: { management?: boolean; method?: string; body?: unknown } = {}): Promise<T> {
    const ref = options.management ? this.connection.management_credential_ref : this.connection.credential_ref;
    if (!ref) throw new AuthError(options.management ? "gateway_management_credential_not_configured" : "gateway_observer_credential_not_configured", 422);
    let token: string;
    try { token = secret(ref); } catch { throw new AuthError("gateway_credential_unreadable", 403); }
    const response = await this.fetcher(new URL(route.replace(/^\//, ""), this.base), {
      method: options.method || "GET", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).catch(() => { throw new AuthError("gateway_unreachable", 503); });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new AuthError("gateway_forbidden", response.status);
      if (response.status === 404 || response.status === 405) throw new AuthError("gateway_route_missing", 422);
      if (response.status === 409) throw new AuthError("gateway_revision_conflict", 409);
      throw new AuthError("gateway_unavailable", 503);
    }
    return await boundedJSON(response, 1024 * 1024) as T;
  }

  async snapshot(): Promise<GatewayMonitorSnapshot> {
    const results = await Promise.allSettled([
      this.request<unknown>("/v1/personal/mcp-telemetry"),
      this.request<unknown>("/v1/personal/agent-sessions"),
      this.request<unknown>("/v1/personal/calls?limit=50"),
      this.request<unknown>("/v1/personal/client-presets"),
    ]);
    const schemas = ["gateway_personal_mcp_telemetry.v1", "gateway_personal_agent_sessions.v1", "gateway_personal_calls.v1", "gateway_client_presets.v1"];
    const values = results.map((result, index) => {
      if (result.status === "rejected") return null;
      const value = object(result.value);
      return value.schema === schemas[index] ? value : null;
    });
    const denied = results.find((result) => result.status === "rejected" && result.reason instanceof AuthError && [401, 403].includes(result.reason.status));
    if (denied?.status === "rejected") throw denied.reason;
    const [t, s, c, p] = values;
    const runtime = object(t?.runtime);
    const metric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    const completeMetrics = metric(runtime.active_sessions) !== null && metric(runtime.calls_total) !== null;
    const telemetryView: GatewayTelemetry | null = t && completeMetrics ? {
      active_sessions: count(runtime.active_sessions), rpc_calls: count(runtime.calls_total),
      proxy_latency_p95_ms: metric(runtime.gateway_overhead_p95_ms),
      upstream_latency_p95_ms: metric(runtime.upstream_latency_p95_ms),
      token_estimate: metric(runtime.estimated_tokens_total),
      backends: array(t.backends).flatMap((raw) => { const row = object(raw); const id = safeRef(row.id); return id ? [{ id, state: code(row.state) || "unknown", protocol: code(row.protocol_version) || null, freshness: code(row.catalog_cache_state) || "unknown" }] : []; }),
    } : null;
    const sources = values.map((value, index) => ({ resource: ["telemetry", "sessions", "calls", "presets"][index], state: value ? "ready" : "unavailable" }));
    const complete = values.every(Boolean) && telemetryView !== null;
    return { schema_version: gatewayMonitorSchema, state: complete ? "ready" : "degraded", observed_at: new Date().toISOString(), telemetry: telemetryView,
      sessions: array(s?.sessions).flatMap((raw) => { const row = this.callSession(raw); return row ? [row] : []; }),
      calls: array(c?.calls).flatMap((raw) => this.call(raw)), presets: this.projectPresets(p),
      coverage: { state: complete ? "complete" : "partial", ...(complete ? {} : { reason: "gateway_resource_unavailable" }) }, sources };
  }

  private call(raw: unknown): GatewayCall[] { const row = object(raw); const ref = safeRef(row.call_ref, "inv_"); return ref && validDate(row.time) ? [{ call_ref: ref, session_ref: safeRef(row.session_ref, "msess_"), actor: safeRef(row.actor_id), backend: safeRef(row.backend), tool: safeRef(row.tool), state: callState(row.state), stage: code(row.stage) || null, category: code(row.category) || null, updated_at: validDate(row.time), ...(code(row.error_code) ? { error_code: code(row.error_code) } : {}) }] : []; }
  async sessions() { const body = object(await this.request("/v1/personal/agent-sessions")); this.schema(body, "gateway_personal_agent_sessions.v1"); return { sessions: array(body.sessions).flatMap((row) => { const value = this.callSession(row); return value ? [value] : []; }) }; }
  private callSession(raw: unknown): GatewayAgentSession | null { const row = object(raw); const ref = safeRef(row.session_ref, "msess_"); return ref && validDate(row.last_seen_at) ? { session_ref: ref, protocol_version: code(row.client_protocol) || null, elicitation: row.elicitation_capable === true, display_mode: code(row.presentation_mode) || null, active: true, in_flight: count(row.in_flight_calls), calls: count(row.total_calls), failures: count(row.failed_calls), updated_at: validDate(row.last_seen_at) } : null; }
  async calls(query: string) { const body = object(await this.request(`/v1/personal/calls${query ? `?${query}` : ""}`)); this.schema(body, "gateway_personal_calls.v1"); return { calls: array(body.calls).flatMap((row) => this.call(row)) }; }
  async callDetail(ref: string): Promise<GatewayCallDetail> { const safe = safeRef(ref, "inv_"); if (!safe) throw new AuthError("invalid_gateway_call_ref", 400); const row = object(await this.request(`/v1/personal/calls/${encodeURIComponent(safe)}`)); this.schema(row, "gateway_personal_call_detail.v1"); const call = this.call(row.call)[0]; if (!call) throw new AuthError("gateway_call_not_found", 404); return { ...call, events: array(row.checkpoints).slice(0, 500).flatMap((raw) => { const event = object(raw); const stage = code(event.stage) || code(event.event); return stage && validDate(event.time) ? [{ at: validDate(event.time), stage, state: code(event.state) || "unknown", ...(code(event.error_code) ? { code: code(event.error_code) } : {}) }] : []; }), recovery: recoveryFor(call.state) }; }
  private projectPresets(body: unknown): GatewayClientPreset[] {
    const labels: Record<string, string> = { codex: "Codex CLI", "claude-code": "Claude Code", cursor: "Cursor", pi: "Pi Coding Agent", "cherry-studio": "Cherry Studio", opencode: "OpenCode", "generic-http": "Generic HTTP" };
    // Never forward arbitrary upstream commands/snippets: only recognized clients and a local placeholder template.
    return array(object(body).presets).flatMap((raw) => {
      const id = safeRef(object(raw).client);
      return id && Object.hasOwn(labels, id) ? [{ id, label: labels[id], config: "MCP endpoint: <gateway-mcp-url>\nBearer credential: ${MCP_GATEWAY_TOKEN}" }] : [];
    });
  }
  async presets() { const body = object(await this.request("/v1/personal/client-presets")); this.schema(body, "gateway_client_presets.v1"); return { presets: this.projectPresets(body) }; }
  private schema(body: Record<string, unknown>, expected: string) { if (body.schema !== expected) throw new AuthError("gateway_contract_invalid", 502); }
  async plan(body: unknown): Promise<GatewayPlan> { return await this.request("/v1/admin/plans", { management: true, method: "POST", body }) as GatewayPlan; }
  async apply(planRef: string, body: unknown): Promise<GatewayPlan> { const safe = safeRef(planRef, "plan_"); if (!safe) throw new AuthError("invalid_gateway_plan_ref", 400); return await this.request(`/v1/admin/plans/${encodeURIComponent(safe)}/apply`, { management: true, method: "POST", body }) as GatewayPlan; }
  async events(afterSeq?: string, signal?: AbortSignal): Promise<Response> {
    if (afterSeq && !/^[0-9]{1,20}$/.test(afterSeq)) throw new AuthError("gateway_cursor_invalid", 400);
    const ref = this.connection.credential_ref;
    if (!ref) throw new AuthError("gateway_observer_credential_not_configured", 422);
    let token: string;
    try { token = secret(ref); } catch { throw new AuthError("gateway_credential_unreadable", 403); }
    const route = `/v1/personal/events${afterSeq ? `?after_seq=${encodeURIComponent(afterSeq)}` : ""}`;
    let response: Response;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 5000);
    try { response = await this.fetcher(new URL(route.slice(1), this.base), { method: "GET", redirect: "error", signal: controller.signal, headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` } }); }
    catch { signal?.removeEventListener("abort", abort); throw new AuthError("gateway_unreachable", 503); }
    finally { clearTimeout(timer); }
    if (!response.ok) { if (response.status === 401 || response.status === 403) throw new AuthError("gateway_forbidden", response.status); if (response.status === 404 || response.status === 405) throw new AuthError("gateway_route_missing", 422); throw new AuthError("gateway_unavailable", 503); }
    if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) { controller.abort(); signal?.removeEventListener("abort", abort); throw new AuthError("gateway_contract_invalid", 502); }
    const reader = response.body.getReader();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    return new Response(new ReadableStream({
      async pull(output) { try { const chunk = await reader.read(); if (chunk.done) { cleanup(); output.close(); } else output.enqueue(chunk.value); } catch { cleanup(); output.error(new Error("gateway_stream_closed")); } },
      async cancel() { cleanup(); controller.abort(); await reader.cancel(); },
    }), { headers: response.headers });
  }
}

export function gatewayConnection(config: { open_tools?: Partial<Record<"gateway", OpenToolConnection>> }, scope: ScopeBinding) {
  if (!scope.open_tools?.includes("gateway")) throw new AuthError("scope_not_found", 404);
  const connection = config.open_tools?.gateway;
  if (!connection || connection.enabled === false) throw new AuthError("gateway_not_configured", 422);
  return connection;
}
