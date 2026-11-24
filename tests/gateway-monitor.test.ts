import { afterAll, describe, expect, it } from "vitest";
import { GatewayMonitorService } from "../server/gateway-monitor";
import type { OpenToolConnection } from "../server/contracts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "gateway-monitor-"));
const readFile = join(dir, "read.token");
const adminFile = join(dir, "admin.token");
writeFileSync(readFile, "read", { mode: 0o600 });
writeFileSync(adminFile, "admin", { mode: 0o600 });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const connection: OpenToolConnection = { endpoint: "https://gateway.example.test", credential_ref: readFile, management_credential_ref: adminFile, enabled: true };
const at = "2026-11-07T00:00:00Z";
// Shape derived from the Gateway owner's versioned personal_telemetry.go contracts.
const routes = {
  "/v1/personal/mcp-telemetry": { schema: "gateway_personal_mcp_telemetry.v1", runtime: { active_sessions: 2, calls_total: 7, gateway_overhead_p95_ms: 12, upstream_latency_p95_ms: 31, estimated_tokens_total: 99 }, backends: [{ id: "backend-a", state: "ready", protocol_version: "2025-06-18", catalog_cache_state: "fresh", url: "https://secret.invalid" }] },
  "/v1/personal/agent-sessions": { schema: "gateway_personal_agent_sessions.v1", sessions: [{ session_ref: "msess_01", client_protocol: "2025-06-18", elicitation_capable: true, presentation_mode: "compact", in_flight_calls: 1, total_calls: 3, failed_calls: 1, last_seen_at: at }] },
  "/v1/personal/calls": { schema: "gateway_personal_calls.v1", calls: [{ call_ref: "inv_01", actor_id: "agent-a", tool: "files_read", state: "succeeded", time: at, arguments: "secret" }] },
  "/v1/personal/client-presets": { schema: "gateway_client_presets.v1", presets: [{ client: "codex", label: "Codex", snippet: "raw secret", commands: ["dangerous command https://secret.invalid"] }, { client: "unknown" }] },
  "/v1/personal/calls/inv_01": { schema: "gateway_personal_call_detail.v1", call: { call_ref: "inv_01", state: "unknown", time: at }, checkpoints: [{ time: at, stage: "dispatch", state: "unknown", error_code: "outcome_uncertain", payload: "secret" }] },
  "/v1/personal/calls/inv_02": { schema: "gateway_personal_call_detail.v1", call: { call_ref: "inv_02", state: "failed", time: at }, checkpoints: [{ time: at, stage: "upstream", state: "failed", error_code: "upstream_502" }] },
  "/v1/personal/calls/inv_03": { schema: "gateway_personal_call_detail.v1", call: { call_ref: "inv_03", state: "succeeded", time: at }, checkpoints: [{ time: at, stage: "dispatch", state: "succeeded" }] },
};
function transport(values: Record<string, unknown> = routes, statuses: Record<string, number> = {}) {
  return async (input: string | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const status = statuses[path] || 200;
    if (status !== 200) return Response.json({ error: { code: "denied" } }, { status });
    if (init?.method === "POST") return Response.json({ plan_ref: "plan_01", plan_digest: "sha256:plan", expected_revision: "cfg_01", action: "registry.backend.enable", state: "ready" });
    return Response.json(values[path] ?? {});
  };
}

describe("GatewayMonitorService", () => {
  it("projects actual runtime, session and preset contracts without raw strings or fabricated counters", async () => {
    const service = new GatewayMonitorService(connection, transport());
    const snapshot = await service.snapshot();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.telemetry).toMatchObject({ active_sessions: 2, rpc_calls: 7, proxy_latency_p95_ms: 12, upstream_latency_p95_ms: 31, token_estimate: 99 });
    expect(snapshot.telemetry?.backends[0]).toEqual({ id: "backend-a", state: "ready", protocol: "2025-06-18", freshness: "fresh" });
    expect(snapshot.sessions[0]).toMatchObject({ protocol_version: "2025-06-18", active: true, elicitation: true, calls: 3, failures: 1, in_flight: 1, display_mode: "compact" });
    expect(snapshot.calls[0]).toMatchObject({ call_ref: "inv_01", tool: "files_read", actor: "agent-a" });
    expect(snapshot.presets).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|dangerous|1970/);
    expect((await service.presets()).presets).toEqual(snapshot.presets);
  });
  it("keeps healthy resources when a sibling fails, and marks missing metrics unknown", async () => {
    const snapshot = await new GatewayMonitorService(connection, transport(routes, { "/v1/personal/mcp-telemetry": 503 })).snapshot();
    expect(snapshot).toMatchObject({ state: "degraded", telemetry: null, coverage: { state: "partial" } });
    expect(snapshot.calls).toHaveLength(1);
    const noRuntime = await new GatewayMonitorService(connection, transport({ ...routes, "/v1/personal/mcp-telemetry": { schema: "gateway_personal_mcp_telemetry.v1", runtime: null } })).snapshot();
    expect(noRuntime.telemetry).toBeNull();
    const invalid = new GatewayMonitorService(connection, transport({}));
    expect((await invalid.snapshot()).coverage.state).toBe("partial");
    await expect(invalid.sessions()).rejects.toMatchObject({ code: "gateway_contract_invalid" });
  });
  it("reads checkpoints and derives uncertain-call recovery, never arbitrary owner guidance", async () => {
    const detail = await new GatewayMonitorService(connection, transport()).callDetail("inv_01");
    expect(detail.recovery).toBe("reconcile_required");
    expect(detail.events).toEqual([{ at: "2026-11-07T00:00:00.000Z", stage: "dispatch", state: "unknown", code: "outcome_uncertain" }]);
    expect(JSON.stringify(detail)).not.toContain("secret");
    expect((await new GatewayMonitorService(connection, transport()).callDetail("inv_02")).recovery).toBe("query_original_operation");
    expect((await new GatewayMonitorService(connection, transport()).callDetail("inv_03")).recovery).toBe("none");
  });
  it("maps owner refusal to a stable AuthError and keeps management separate", async () => {
    const service = new GatewayMonitorService(connection, transport(routes, { "/v1/personal/mcp-telemetry": 403 }));
    await expect(service.snapshot()).rejects.toMatchObject({ code: "gateway_forbidden", status: 403 });
    expect(await new GatewayMonitorService(connection, transport()).plan({ action: "registry.backend.enable" })).toMatchObject({ plan_ref: "plan_01", state: "ready" });
  });
});
