import { describe, expect, it } from "vitest";
import { ProviderRunManager } from "../server/provider-live";
import type { ScopeBinding, ServerConfig } from "../server/contracts";

const scope: ScopeBinding = {
  id: "scope-discovery",
  tenant: "personal",
  team: "studio",
  project: "project-discovery",
  label: "Discovery",
  owners: {
    scaena: { tenant: "personal", project: "project-discovery", actor: "owner", audience: "scaena" },
    sonora: { tenant: "personal", project: "project-discovery", actor: "owner", audience: "sonora" },
  },
};

const config: ServerConfig = {
  origin: "http://127.0.0.1:4312",
  port: 4312,
  principals: [],
  owners: {},
  providers: {
    scaena: { owner: "scaena", endpoint: "https://scaena.example/mcp", credential_env: "TEST_SCAENA_TOKEN", project: "project-discovery", enabled: true, model_refs: ["wan3.0-video"] },
    sonora: { owner: "sonora", endpoint: "https://sonora.example/mcp", credential_env: "TEST_SONORA_TOKEN", project: "project-discovery", enabled: true, model_refs: ["sonora://voice/openai-tts/alloy"], action_manifest: { submit: "voice.audition" } },
  },
};

process.env.TEST_SCAENA_TOKEN = "test-scaena-token";
process.env.TEST_SONORA_TOKEN = "test-sonora-token";

function fetcher(malformedSonoraDiagnostic = false) {
  const calls: string[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body.method === "tools/call" ? `${body.params.name}:${body.params.arguments?.action || ""}` : body.method);
    if (body.method === "initialize") return Response.json({ id: body.id, result: { protocolVersion: "2025-06-18" } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "resources/read") return Response.json({ id: body.id, result: { contents: [{ text: JSON.stringify({ schema_version: "scaena.video_provider_task_guide.v1", bindings: [{ binding_id: "wan3-dashscope-cn", model: "wan3.0-video", enabled: false, disabled_reason: "binding_disabled" }] }) }] } });
    if (body.method === "tools/list") return Response.json({ id: body.id, result: { tools: [{ name: "scaena.execute" }, { name: "sonora.execute" }, { name: "sonora.search" }] } });
    if (body.method === "tools/call" && body.params.name === "sonora.search") return Response.json({ id: body.id, result: { structuredContent: { results: [{ provider_id: "openai-tts", model_ref: "openai-tts", voice_ref: "alloy" }] } } });
    if (body.method === "tools/call" && body.params.arguments.action === "getProjectMediaCapabilities") return Response.json({ id: body.id, result: { structuredContent: { state: "ready" } } });
    if (body.method === "tools/call" && body.params.arguments.action === "credential.status") return Response.json({ id: body.id, result: { structuredContent: { configured: true } } });
    if (body.method === "tools/call" && body.params.arguments.action === "doctor.run") return Response.json({ id: body.id, result: { structuredContent: malformedSonoraDiagnostic ? { unexpected: true } : { configured: false, diagnostic_status: "credential_missing" } } });
    throw new Error(`unexpected MCP call: ${JSON.stringify(body)}`);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe("provider read-only discovery", () => {
  it("projects Scaena bindings and keeps submit disabled", async () => {
    const transport = fetcher();
    const manager = new ProviderRunManager(config, transport.fetch);
    const rows = await manager.capabilities(scope);
    const scaena = rows.find((row) => row.owner === "scaena");
    expect(scaena?.readiness).toBe("needs_configuration");
    expect(scaena?.bindings[0]).toMatchObject({ binding_id: "wan3-dashscope-cn", enabled: false, disabled_reason: "binding_disabled" });
    expect(scaena?.submit_gate).toBe("disabled_by_default");
    expect(transport.calls.some((call) => call.includes("createVideoProviderTask"))).toBe(false);
  });

  it("projects Sonora provider diagnosis without calling voice.audition", async () => {
    const transport = fetcher();
    const manager = new ProviderRunManager(config, transport.fetch);
    const rows = await manager.capabilities(scope);
    const sonora = rows.find((row) => row.owner === "sonora");
    expect(sonora?.readiness).toBe("needs_configuration");
    expect(sonora?.diagnostic).toMatchObject({ code: "credential_missing", configured: false });
    expect(sonora?.provider_refs).toContain("openai-tts");
    expect(transport.calls.some((call) => call.includes("voice.audition"))).toBe(false);
  });

  it("does not promote a malformed Sonora diagnostic to ready", async () => {
    const transport = fetcher(true);
    const manager = new ProviderRunManager(config, transport.fetch);
    const rows = await manager.capabilities(scope);
    const sonora = rows.find((row) => row.owner === "sonora");
    expect(sonora?.readiness).toBe("unavailable");
    expect(sonora?.blocker).toBe("sonora_provider_not_ready");
  });
});
