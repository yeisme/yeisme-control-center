import type { Scenario } from "./world";

/** Bearer credential the fake DriveBridge and Gateway accept; anything else is refused with 401. */
export const openToolToken = "fixture-open-tool-token";
/** A token the fake owners never accept: a tool configured with it answers 401 on every read that needs a credential. */
export const revokedOpenToolToken = "fixture-open-tool-revoked";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/**
 * DriveBridge as an Agent token sees it: health, capabilities and the run list, each wrapped in `{ data }`. Runs carry
 * paths and owner error text on purpose, so the checks can prove the control center drops them.
 */
function driveBridge(path: string, scenario: Scenario) {
  if (scenario === "degraded" && path === "/api/v1/capabilities") return new Response(null, { status: 503 });
  if (path === "/healthz") return json({ data: { status: "ok", enabled: true } });
  if (path === "/api/v1/capabilities") return json({ data: { spec_version: "drivebridge.v1", instance_id: "fixture", public_base_url: "https://files.fixture.invalid", part_size: 8 * 1048576, max_bytes: 50 * 1073741824, limits: { max_file_bytes: 50 * 1073741824, max_batch_items: null } } });
  if (path === "/api/v1/operations") {
    if (scenario === "empty") return json({ data: [] });
    return json({ data: [
      { id: "op_fx_upload", kind: "upload", status: "transferring", size_bytes: 734003200, bytes_transferred: 293601280, path: "/fixture/rain/episode-01.mov", updated_at: minutesAgo(2) },
      { id: "op_fx_failed", kind: "export", status: "failed", error: "open /srv/fixture/rain/cut.mov: permission denied", path: "/fixture/rain/cut.mov", updated_at: minutesAgo(25) },
      { id: "op_fx_interrupted", kind: "upload", status: "interrupted", error: "resume_required", path: "/fixture/rain/poster.png", updated_at: minutesAgo(50) },
      { id: "op_fx_batch", kind: "copy", status: "completed", total_files: 12, progress_files: 12, path: "/fixture/rain/frames", updated_at: minutesAgo(90) },
    ] });
  }
  return new Response(null, { status: 404 });
}

/**
 * The personal Gateway as a workspace-bound read token sees it. Backends carry an address, missing environment
 * variable names and error text, and runs carry a result, so the checks can prove the control center drops them.
 * In `degraded` the Gateway is not ready and names one failed backend.
 */
function gateway(path: string, url: URL, scenario: Scenario) {
  if (path === "/readyz") return scenario === "degraded"
    ? json({ schema: "gateway_readiness.v1", ready: false, reason: "backend_unready", failed_backends: ["sonora"], backends: 3 }, 503)
    : json({ schema: "gateway_readiness.v1", ready: true, backends: 3, ledger_status: "ok" });
  if (path === "/v1/tenants/current") return json({ schema: "gateway_subject.v1", subject: { tenant_id: "personal", actor_type: "service_account", actor_id: "yeisme-control-center", workspace_id: "studio", scopes: ["mcp:tools:read", "mcp:audit:read"] } });
  if (path === "/v1/backends") return json({ schema: "gateway_backends.v1", backends: [
    { id: "eikona", namespace: "eikona", enabled: true, transport: "http", status: "unknown", tool_count: 0, url_summary: "https://eikona.fixture.invalid/mcp" },
    { id: "sonora", namespace: "sonora", enabled: true, transport: "http", status: "unknown", tool_count: 0, missing_env: ["SONORA_FIXTURE_TOKEN"], last_error: "dial tcp backend-leak.example.test:443: connection refused" },
    { id: "blender", namespace: "blender", enabled: false, transport: "stdio", status: "unknown", tool_count: 0 },
  ] });
  if (path === "/v1/tools") return json({ schema: "gateway_tool_index.v1", cache: { ttl_seconds: 60, stale: false, state: "fresh", generation: 3 }, tools: scenario === "empty" ? [] : [
    { name: "eikona_search", title: "Eikona 动作搜索", description: "按关键词找 Eikona 动作", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { query: { type: "string", description: "关键词" } }, required: ["query"] } },
    { name: "eikona_execute", title: "Eikona 执行", description: "执行一个 Eikona 动作", annotations: { readOnlyHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { action: { type: "string" }, args: { type: "object" } }, required: ["action"] } },
    { name: "sonora_execute", title: "Sonora 执行", description: "执行一个 Sonora 动作", annotations: { readOnlyHint: false }, inputSchema: { type: "object", properties: { action: { type: "string" }, args: { type: "object" } }, required: ["action"] } },
    { name: "gateway_tools_search", title: "工具搜索", description: "在网关里搜索工具", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { query: { type: "string" } } } },
  ] });
  if (path === "/v1/operations") return json({ schema: "gateway_operation_list.v1", cursor: "", operations: scenario === "empty" ? [] : [
    { id: "op_gw_reload", kind: "runtime_reload", status: "succeeded", created_at: minutesAgo(70), updated_at: minutesAgo(70), result: {} },
    { id: "op_gw_call", kind: "tool_invocation", status: "failed", created_at: minutesAgo(12), updated_at: minutesAgo(11), result: { tool: "sonora_execute", invocation_id: "inv_fx_1", error: "upstream 502 from https://sonora.fixture.invalid/mcp" } },
  ] });
  if (path === "/v1/usage") {
    if (url.searchParams.get("group_by") !== "backend") return json({ error: "invalid group_by" }, 400);
    return json({ schema: "gateway_usage_summary.v1", status: "partial", from: minutesAgo(7 * 24 * 60), to: minutesAgo(0), hop_usage: { calls: 1204, failures: 12, latency_p95_ms: 340 }, groups: { eikona: { calls: 800, failures: 2, latency_p95_ms: 300 }, sonora: { calls: 404, failures: 10, latency_p95_ms: 900 } } });
  }
  return new Response(null, { status: 404 });
}

/** Routes under `/drivebridge/` and `/gateway/` on the fake owner origin; null for anything else. */
export function fakeOpenTool(url: URL, request: Request, scenario: Scenario): Response | null {
  const match = url.pathname.match(/^\/(drivebridge|gateway)(\/.*)$/);
  if (!match) return null;
  if (request.method !== "GET") return new Response(null, { status: 405 });
  const [, tool, path] = match;
  const open = tool === "gateway" ? ["/readyz"] : ["/healthz"];
  if (!open.includes(path) && request.headers.get("authorization") !== `Bearer ${openToolToken}`) return new Response(null, { status: 401 });
  return tool === "drivebridge" ? driveBridge(path, scenario) : gateway(path, url, scenario);
}
