import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DriveBridgeAdapter, driveBridgeOperation } from "../server/open-tools/drivebridge";
import { GatewayAdapter } from "../server/open-tools/gateway";
import { OpenToolService } from "../server/open-tools/service";
import { summarizeOperations } from "../server/open-tools/projection";
import { refusal, type Fetcher } from "../server/open-tools/types";
import { buildWorkQueue } from "../server/work-queue";
import { serviceDirectory } from "../server/service-directory";
import { ToolCatalogService } from "../server/tool-catalog";
import { ToolCatalogStore } from "../server/db/tool-catalog-store";
import { ProviderRunManager } from "../server/provider-live";
import { createMemoryDB } from "../server/db/client";
import type { OpenToolConnection, ScopeBinding, ServerConfig, Session } from "../server/contracts";
import type { OpenToolOperation, OpenToolProjection } from "../src/shared/open-tools";

const dir = mkdtempSync(join(tmpdir(), "open-tools-test-"));
const tokenFile = join(dir, "token");
writeFileSync(tokenFile, "open-tool-test-token\n", { mode: 0o600 });
const looseFile = join(dir, "loose");
writeFileSync(looseFile, "open-tool-test-token\n", { mode: 0o644 });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const scope: ScopeBinding = { id: "scope-1", tenant: "personal", team: "studio", project: "project-1", label: "Project", owners: {}, open_tools: ["drivebridge"] };
const session: Session = { id: "s", issuer: "local", subject: "u", name: "U", accessToken: "", accessAudience: [], expires: now + 10_000, csrf: "c", epoch: 1, personal: true };
const connection = (extra: Partial<OpenToolConnection> = {}): OpenToolConnection => ({ endpoint: "https://drive.example/base", credential_ref: tokenFile, ...extra });
const config = (extra: Partial<OpenToolConnection> = {}): ServerConfig => ({ origin: "http://127.0.0.1:4312", port: 4312, principals: [], owners: {}, open_tools: { drivebridge: connection(extra) } });

/** DriveBridge rows as the owner returns them, including the fields the projection must drop. */
const rows = [
  { id: "op_run", kind: "upload", status: "transferring", size_bytes: 1000, bytes_transferred: 400, path: "/secret/clip.mov", source_path: "/srv/u/someone-else/clip.mov", sha256: "abc", updated_at: ago(1) },
  { id: "op_fail", kind: "export", status: "failed", error: "open /srv/data/x: permission denied", path: "/secret/x", updated_at: ago(10) },
  { id: "op_resume", kind: "upload", status: "interrupted", error: "resume_required", updated_at: ago(20) },
  { id: "op_old", kind: "copy", status: "failed", updated_at: ago(60 * 24 * 9) },
  { id: "op_done", kind: "directory_copy", status: "completed", total_files: 4, progress_files: 4, updated_at: ago(30) },
  { id: "op_odd", kind: "upload", status: "brand_new_state", updated_at: ago(40) },
  { id: "../etc/passwd", kind: "upload", status: "failed", updated_at: ago(2) },
];

type Reply = { status: number; body?: unknown } | "network";
function fetcher(replies: Record<string, Reply>, seen: { url: string; auth: string | null }[] = []): Fetcher {
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ url: url.pathname + url.search, auth: headers.get("authorization") });
    const reply = replies[url.pathname] ?? { status: 404 };
    if (reply === "network") throw new TypeError("fetch failed");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  };
}
const healthy: Record<string, Reply> = {
  "/base/healthz": { status: 200, body: { data: { status: "ok", enabled: true } } },
  "/base/api/v1/capabilities": { status: 200, body: { data: { spec_version: "drivebridge.v1", part_size: 8 * 1048576, public_base_url: "https://files.leak.example", limits: { max_file_bytes: 50 * 1073741824 } } } },
  "/base/api/v1/operations": { status: 200, body: { data: rows } },
};

describe("DriveBridge run projection", () => {
  it("keeps states, sizes and codes and drops paths, digests and owner error text", () => {
    const run = driveBridgeOperation(rows[0])!;
    expect(run).toMatchObject({ ref: "op_run", kind: "upload", label: "上传", state: "running", native_state: "transferring", progress: { done: 400, total: 1000, unit: "bytes" } });
    const failed = driveBridgeOperation(rows[1])!;
    expect(failed).toMatchObject({ state: "failed", label: "导出" });
    expect(failed.error_code).toBeUndefined();
    expect(driveBridgeOperation(rows[2])).toMatchObject({ state: "failed", native_state: "interrupted", error_code: "resume_required" });
    expect(driveBridgeOperation(rows[4])).toMatchObject({ state: "succeeded", label: "目录复制", progress: { done: 4, total: 4, unit: "files" } });
    expect(driveBridgeOperation(rows[5])).toMatchObject({ state: "unknown", native_state: "brand_new_state" });
    expect(driveBridgeOperation(rows[6])).toBeNull();
    const text = JSON.stringify(rows.map(driveBridgeOperation));
    for (const leaked of ["/secret", "someone-else", "/srv/", "permission denied", "abc"]) expect(text).not.toContain(leaked);
  });

  it("reads three fixed routes with the bearer credential and summarises runs", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const { projection } = await new DriveBridgeAdapter(connection(), fetcher(healthy, seen)).observe();
    expect(seen.map((call) => call.url).sort()).toEqual(["/base/api/v1/capabilities", "/base/api/v1/operations?limit=50", "/base/healthz"]);
    // The health route is public, so the credential goes only to the two routes that need it.
    expect(seen.find((call) => call.url === "/base/healthz")?.auth).toBeNull();
    expect(seen.filter((call) => call.url !== "/base/healthz").every((call) => call.auth === "Bearer open-tool-test-token")).toBe(true);
    expect(projection).toMatchObject({ tool: "drivebridge", state: "ready", freshness: "fresh", coverage: { state: "partial", reason: "agent_token_operations_only" } });
    expect(projection.facts).toEqual([{ label: "接口", value: "drivebridge.v1" }, { label: "分块", value: "8 MiB" }, { label: "单文件上限", value: "50 GiB" }]);
    expect(projection.operations.counts).toMatchObject({ running: 1, failed: 3, unknown: 1, succeeded: 1 });
    // The failure from nine days ago is counted but needs no attention any more.
    // An unrecognised status is listed as unknown but is not raised.
    expect(projection.operations.attention.map((run) => run.ref)).toEqual(["op_fail", "op_resume"]);
    expect(JSON.stringify(projection)).not.toContain("leak.example");
  });
});

describe("refused and failed reads", () => {
  it("maps owner statuses to stable reasons without owner text", () => {
    expect(refusal(401)).toEqual({ ok: false, state: "forbidden", reason: "open_tool_unauthenticated" });
    expect(refusal(403)).toEqual({ ok: false, state: "forbidden", reason: "open_tool_forbidden" });
    expect(refusal(404).state).toBe("needs_contract");
    expect(refusal(405).state).toBe("needs_contract");
    expect(refusal(429).state).toBe("rate_limited");
    expect(refusal(500).state).toBe("unavailable");
  });

  it("says forbidden when the credential is refused even though the public health route answers", async () => {
    const refused = await new DriveBridgeAdapter(connection(), fetcher({ ...healthy, "/base/api/v1/capabilities": { status: 401 }, "/base/api/v1/operations": { status: 401 } })).observe();
    expect(refused.projection).toMatchObject({ state: "forbidden", reason: "open_tool_unauthenticated", coverage: { state: "forbidden" } });
    const partly = await new DriveBridgeAdapter(connection(), fetcher({ ...healthy, "/base/api/v1/capabilities": "network" })).observe();
    expect(partly.projection).toMatchObject({ state: "degraded", reason: "open_tool_unreachable" });
    expect(partly.projection.operations.recent.length).toBeGreaterThan(0);
  });

  it("names a DriveBridge started without --enabled instead of a generic outage", async () => {
    const off = await new DriveBridgeAdapter(connection(), fetcher({ "/base/healthz": { status: 200, body: { data: { status: "ok", enabled: false } } }, "/base/api/v1/capabilities": { status: 503 }, "/base/api/v1/operations": { status: 503 } })).observe();
    expect(off.projection).toMatchObject({ state: "unavailable", reason: "drivebridge_disabled" });
  });

  it("never sends a credential that is readable by others, and refuses public http", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const loose = await new DriveBridgeAdapter(connection({ credential_ref: looseFile }), fetcher(healthy, seen)).observe();
    expect(loose.projection).toMatchObject({ state: "forbidden", reason: "open_tool_credential_unreadable" });
    // Only the public health route was called, and without a credential.
    expect(seen.map((call) => [call.url, call.auth])).toEqual([["/base/healthz", null]]);
    expect(() => new DriveBridgeAdapter(connection({ endpoint: "http://drive.example" }), fetcher(healthy))).toThrow();
    expect(() => new DriveBridgeAdapter(connection({ endpoint: "http://127.0.0.1:8080" }), fetcher(healthy))).toThrow();
    expect(() => new DriveBridgeAdapter(connection({ endpoint: "http://127.0.0.1:8080", allow_private_http: true }), fetcher(healthy))).not.toThrow();
    const service = new OpenToolService(config({ endpoint: "http://drive.example" }), fetcher(healthy));
    expect((await service.observe("drivebridge"))?.observation.projection).toMatchObject({ state: "unavailable", reason: "open_tool_endpoint_denied" });
  });
});

describe("open tool service", () => {
  it("lists only tools the scope names, caches a reading for a minute and shares concurrent reads", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const service = new OpenToolService(config(), fetcher(healthy, seen));
    expect(service.inScope(scope)).toEqual(["drivebridge"]);
    expect(service.inScope({ ...scope, open_tools: [] })).toEqual([]);
    expect(service.inScope({ ...scope, open_tools: ["gateway"] })).toEqual([]);
    await Promise.all([service.observe("drivebridge"), service.observe("drivebridge")]);
    await service.observe("drivebridge");
    expect(seen).toHaveLength(3);
    const forced = await service.observe("drivebridge", { force: true });
    expect(forced).toMatchObject({ forced: true, throttled: false });
    expect(await service.observe("drivebridge", { force: true })).toMatchObject({ forced: false, throttled: true });
    expect(seen).toHaveLength(6);
  });

  it("keeps the last good runs on screen, marked stale, while the tool does not answer", async () => {
    let down = false;
    const replies = () => down ? { "/base/healthz": "network" as const, "/base/api/v1/capabilities": "network" as const, "/base/api/v1/operations": "network" as const } : healthy;
    const live: Fetcher = (input, init) => fetcher(replies())(input, init);
    const service = new OpenToolService(config(), live);
    expect((await service.observe("drivebridge"))?.freshness).toBe("fresh");
    down = true;
    const stale = await service.observe("drivebridge", { force: true });
    expect(stale?.freshness).toBe("stale");
    expect(stale?.observation.projection).toMatchObject({ state: "unavailable", reason: "open_tool_unreachable", freshness: "stale" });
    expect(stale?.observation.projection.operations.recent.length).toBeGreaterThan(0);
  });
});

const run = (ref: string, state: OpenToolOperation["state"], minutes: number): OpenToolOperation => ({ ref, kind: "upload", label: "上传", state, native_state: state === "unknown" ? "submission_unknown" : state, updated_at: ago(minutes) });
function tool(patch: Partial<OpenToolProjection> = {}): OpenToolProjection {
  const operations = summarizeOperations([run("op_a", "failed", 5), run("op_b", "unknown", 8), run("op_c", "running", 1)], "partial");
  return { schema_version: "yeisme.open_tool_projection.v1", tool: "drivebridge", label: "DriveBridge", state: "ready", observed_at: ago(1), freshness: "fresh", checks: [], facts: [], operations, coverage: { state: "partial", reason: "agent_token_operations_only" }, ...patch };
}

describe("open tools on the workbench", () => {
  const queue = (tools: OpenToolProjection[]) => buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], openTools: tools });

  it("raises failed and unknown runs and reports the tool as a source", () => {
    const response = queue([tool()]);
    expect(response.items.map((item) => [item.kind, item.owner, item.state, item.operation_ref])).toEqual(expect.arrayContaining([
      ["operation_failure", "drivebridge", "unknown", "op_b"],
      ["operation_failure", "drivebridge", "failed", "op_a"],
    ]));
    expect(response.items).toHaveLength(2);
    expect(response.items.find((item) => item.operation_ref === "op_a")?.title).toBe("DriveBridge 上传失败");
    expect(response.coverage.sources).toContainEqual(expect.objectContaining({ owner: "drivebridge", state: "partial" }));
  });

  it("blocks on a tool that cannot be read and on each backend it reports down", () => {
    const blocked = queue([tool({ state: "forbidden", reason: "open_tool_unauthenticated", coverage: { state: "forbidden" }, operations: summarizeOperations([], "forbidden") })]);
    expect(blocked.items).toEqual([expect.objectContaining({ kind: "service_blocked", owner: "drivebridge", state: "forbidden", attention_reason: "open_tool_unauthenticated", title: "DriveBridge 拒绝了读取" })]);
    const gap = queue([tool({ state: "needs_contract", coverage: { state: "needs_contract" }, operations: summarizeOperations([], "needs_contract") })]);
    expect(gap.items[0].kind).toBe("contract_gap");
    const backends = queue([tool({ tool: "gateway", label: "MCP Gateway", state: "degraded", operations: summarizeOperations([], "complete"), backends: [
      { id: "eikona", namespace: null, enabled: true, state: "down", native_state: "unhealthy", tool_count: 3, checked_at: ago(2) },
      { id: "old", namespace: null, enabled: false, state: "down", native_state: "unhealthy", tool_count: 0, checked_at: ago(2) },
      { id: "sonora", namespace: null, enabled: true, state: "ready", native_state: "healthy", tool_count: 4, checked_at: ago(2) },
    ] })]);
    expect(backends.items.map((item) => item.title)).toEqual(["MCP Gateway 后端 eikona 不可用"]);
  });

  it("marks runs from a stale reading as stale", () => {
    const response = queue([tool({ freshness: "stale", state: "unavailable", coverage: { state: "unavailable" } })]);
    expect(response.items.filter((item) => item.kind === "operation_failure").every((item) => item.freshness === "stale")).toBe(true);
    expect(response.coverage.sources).toContainEqual(expect.objectContaining({ owner: "drivebridge", state: "expired" }));
  });
});

describe("open tools in the service directory", () => {
  const entry = (directory: ReturnType<typeof serviceDirectory>, id: string) => directory.services.find((service) => service.id === id)!;

  it("attaches the reading for personal sessions and keeps it from others", () => {
    const projection = tool();
    const personal = serviceDirectory(config(), scope, session, [], [], { configured: ["drivebridge"], projections: [projection] });
    expect(entry(personal, "drivebridge")).toMatchObject({ integration: "operation_projection", configuration: "configured", coverage: { state: "partial" }, open_tool: projection });
    expect(entry(personal, "gateway")).toMatchObject({ integration: "operation_projection", configuration: "not_configured" });
    expect(entry(personal, "gateway").open_tool).toBeUndefined();
    const other = serviceDirectory(config(), scope, { ...session, personal: false }, [], [], { configured: ["drivebridge"], projections: [projection] });
    expect(entry(other, "drivebridge").open_tool).toBeUndefined();
    const unobserved = serviceDirectory(config(), scope, session, [], [], { configured: ["drivebridge"], projections: [] });
    expect(entry(unobserved, "drivebridge")).toMatchObject({ configuration: "configured", coverage: { state: "not_recorded" } });
  });
});

describe("MCP Gateway projection", () => {
  const gatewayConnection = (): OpenToolConnection => ({ endpoint: "https://gateway.example", credential_ref: tokenFile });
  const subject = { status: 200, body: { schema: "gateway_subject.v1", subject: { tenant_id: "personal", workspace_id: "studio", scopes: ["mcp:tools:read", "mcp:audit:read"] } } };
  const tools = [
    { name: "eikona_execute", title: "Eikona", description: "run", annotations: { readOnlyHint: false }, inputSchema: { type: "object", properties: { action: { type: "string" } }, required: ["action"] } },
    { name: "eikona_search", description: "find", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: {} } },
    { name: "sonora_execute", inputSchema: { type: "object", properties: {} } },
  ];
  const gatewayReplies = (patch: Record<string, Reply> = {}): Record<string, Reply> => ({
    "/readyz": { status: 200, body: { schema: "gateway_readiness.v1", ready: true, backends: 2 } },
    "/v1/tenants/current": subject,
    "/v1/backends": { status: 200, body: { schema: "gateway_backends.v1", backends: [
      { id: "eikona", namespace: "eikona", enabled: true, status: "unknown", tool_count: 0, url_summary: "https://eikona.leak.example/mcp" },
      { id: "sonora", namespace: "sonora", enabled: true, status: "misconfigured", tool_count: 0, missing_env: ["SONORA_SECRET_TOKEN"], last_error: "dial tcp backend-leak.example.test:443" },
      { id: "off", namespace: "off", enabled: false, status: "unknown", tool_count: 4 },
    ] } },
    "/v1/tools": { status: 200, body: { schema: "gateway_tool_index.v1", cache: { stale: false }, tools } },
    "/v1/operations": { status: 200, body: { schema: "gateway_operation_list.v1", cursor: "", operations: [
      { id: "op_ok", kind: "runtime_reload", status: "succeeded", created_at: ago(30), updated_at: ago(30), result: {} },
      { id: "op_bad", kind: "tool_invocation", status: "failed", created_at: ago(6), updated_at: ago(5), result: { tool: "sonora_execute", error: "upstream 502 from https://sonora.leak.example" } },
    ] } },
    "/v1/usage": { status: 200, body: { schema: "gateway_usage_summary.v1", from: ago(7 * 24 * 60), to: ago(0), hop_usage: { calls: 120, failures: 3, latency_p95_ms: 250 }, groups: { eikona: { calls: 100, failures: 1, latency_p95_ms: 200 }, sonora: { calls: 20, failures: 2, latency_buckets: [] } } } },
    ...patch,
  });

  it("reads six fixed routes, never the process or file-path routes, and drops addresses and error text", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const { projection, tools: listed } = await new GatewayAdapter(gatewayConnection(), fetcher(gatewayReplies(), seen)).observe();
    expect(seen.map((call) => call.url).sort()).toEqual(["/readyz", "/v1/backends", "/v1/operations", "/v1/tenants/current", "/v1/tools", "/v1/usage?group_by=backend"]);
    expect(seen.find((call) => call.url === "/readyz")?.auth).toBeNull();
    expect(projection).toMatchObject({ tool: "gateway", state: "degraded", reason: "gateway_backend_degraded" });
    expect(projection.backends?.map((backend) => [backend.id, backend.state, backend.tool_count])).toEqual([["eikona", "ready", 2], ["sonora", "degraded", 1], ["off", "disabled", 0]]);
    expect(projection.operations.attention).toEqual([expect.objectContaining({ ref: "op_bad", label: "工具调用", state: "failed", backend: "sonora" })]);
    expect(projection.operations.coverage).toBe("partial");
    expect(projection.usage).toEqual({ window: "7 天", calls: 120, failures: 3, p95_ms: 250, backends: [{ id: "eikona", calls: 100, failures: 1, p95_ms: 200 }, { id: "sonora", calls: 20, failures: 2, p95_ms: null }] });
    expect(listed?.map((tool) => tool.name)).toEqual(["eikona_execute", "eikona_search", "sonora_execute"]);
    expect(listed?.every((tool) => tool.owner === "gateway")).toBe(true);
    const text = JSON.stringify(projection);
    for (const leaked of ["leak.example", "SONORA_SECRET_TOKEN", "backend-leak.example.test", "upstream 502"]) expect(text).not.toContain(leaked);
  });

  it("stays ready when the credential simply was not granted usage", async () => {
    const healthy = gatewayReplies({
      "/v1/backends": { status: 200, body: { backends: [{ id: "eikona", namespace: "eikona", enabled: true, status: "unknown" }] } },
      "/v1/usage": { status: 403 },
    });
    const { projection } = await new GatewayAdapter(gatewayConnection(), fetcher(healthy)).observe();
    expect(projection.state).toBe("ready");
    expect(projection.checks.find((entry) => entry.id === "usage")).toMatchObject({ state: "forbidden", reason: "open_tool_forbidden" });
    expect(projection.usage).toBeUndefined();
  });

  it("marks the backends a not-ready Gateway names as down", async () => {
    const { projection } = await new GatewayAdapter(gatewayConnection(), fetcher(gatewayReplies({ "/readyz": { status: 503, body: { ready: false, reason: "backend_unready", failed_backends: ["eikona"] } } }))).observe();
    expect(projection.state).toBe("degraded");
    expect(projection.checks.find((entry) => entry.id === "health")).toMatchObject({ state: "failed", reason: "gateway_not_ready" });
    expect(projection.backends?.find((backend) => backend.id === "eikona")?.state).toBe("down");
  });

  it("says the token has no workspace instead of showing an empty Gateway", async () => {
    const { projection } = await new GatewayAdapter(gatewayConnection(), fetcher(gatewayReplies({
      "/v1/tenants/current": { status: 200, body: { subject: { tenant_id: "personal", scopes: [] } } },
      "/v1/backends": { status: 200, body: { backends: [] } },
      "/v1/operations": { status: 403 },
      "/v1/usage": { status: 403 },
    }))).observe();
    expect(projection.checks.find((entry) => entry.id === "credential")).toMatchObject({ state: "forbidden", reason: "gateway_workspace_unbound" });
    expect(projection.state).toBe("degraded");
    const revoked = await new GatewayAdapter(gatewayConnection(), fetcher(Object.fromEntries(Object.entries(gatewayReplies()).map(([route, reply]) => [route, route === "/readyz" ? reply : { status: 401 }])))).observe();
    expect(revoked.projection).toMatchObject({ state: "forbidden", reason: "open_tool_unauthenticated" });
    expect(revoked.tools).toBeNull();
  });
});

describe("Gateway tools in the catalog", () => {
  it("replaces the placeholder with the Gateway's own tools only for sessions allowed to see open tools", async () => {
    const gatewayConfig: ServerConfig = { origin: "http://127.0.0.1:4312", port: 4312, principals: [], owners: {}, open_tools: { gateway: { endpoint: "https://gateway.example", credential_ref: tokenFile } } };
    const gatewayScope: ScopeBinding = { ...scope, open_tools: ["gateway"] };
    const replies: Record<string, Reply> = {
      "/readyz": { status: 200, body: { ready: true } },
      "/v1/tenants/current": { status: 200, body: { subject: { workspace_id: "studio" } } },
      "/v1/backends": { status: 200, body: { backends: [{ id: "eikona", namespace: "eikona", enabled: true, status: "unknown" }] } },
      "/v1/tools": { status: 200, body: { tools: [{ name: "eikona_execute", inputSchema: { type: "object", properties: { action: { type: "string" } }, required: ["action"] } }] } },
      "/v1/operations": { status: 200, body: { operations: [] } },
      "/v1/usage": { status: 200, body: { hop_usage: { calls: 0, failures: 0 } } },
    };
    const store = new ToolCatalogStore(createMemoryDB());
    const service = new ToolCatalogService(new ProviderRunManager(gatewayConfig, fetch), store, new OpenToolService(gatewayConfig, fetcher(replies)));
    const hidden = await service.snapshot(gatewayScope);
    expect(hidden.servers.find((server) => server.owner === "gateway")).toMatchObject({ coverage: "needs_contract", reason: "tools_read_scope_required" });
    const shown = await service.snapshot(gatewayScope, { openTools: true });
    expect(shown.servers.find((server) => server.owner === "gateway")).toMatchObject({ coverage: "readable", transport: "http", counts: { tools: 1 } });
    expect(shown.tools.filter((tool) => tool.owner === "gateway").map((tool) => tool.name)).toEqual(["eikona_execute"]);
    expect(shown.coverage.find((entry) => entry.owner === "gateway")).toMatchObject({ state: "readable", freshness: "fresh" });
  });
});
