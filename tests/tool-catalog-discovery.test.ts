import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { createMemoryDB } from "../server/db/client";
import { ToolCatalogStore } from "../server/db/tool-catalog-store";
import { ProviderRunManager } from "../server/provider-live";
import { ToolCatalogService } from "../server/tool-catalog";
import type { ScopeBinding, ServerConfig } from "../server/contracts";
import { eikonaChannels, eikonaModels, eikonaRuntimeCapabilities, providerTools, scaenaGuide, sonoraDiscovery } from "../scripts/fixtures/provider-catalog";

const scope: ScopeBinding = {
  id: "scope-catalog",
  tenant: "personal",
  team: "studio",
  project: "project-catalog",
  label: "Catalog",
  owners: Object.fromEntries((["eikona", "scaena", "sonora"] as const).map((owner) => [owner, { tenant: "personal", project: "project-catalog", actor: "owner", audience: owner }])),
};
const config: ServerConfig = {
  origin: "http://127.0.0.1:4312",
  port: 4312,
  principals: [{ issuer: "local", subject: "u", name: "U", scopes: [scope] }],
  owners: {},
  providers: Object.fromEntries((["eikona", "scaena", "sonora"] as const).map((owner) => [owner, {
    owner, endpoint: `https://${owner}.example/mcp`, credential_env: "TEST_CATALOG_TOKEN", enabled: true, ...(owner === "scaena" ? { project: "project-catalog" } : {}),
  }])),
};
process.env.TEST_CATALOG_TOKEN = "catalog-secret-token";

interface Options { revision?: number; denyEikonaModels?: boolean; failScaena?: boolean }

function owners(options: Options = {}) {
  const calls: string[] = [];
  const state = { ...options };
  const fetch = async (url: unknown, init?: RequestInit) => {
    const owner = new URL(String(url)).hostname.split(".")[0];
    const body = JSON.parse(String(init?.body));
    const call = body.method === "tools/call" ? `${owner}:${body.params.name}:${body.params.arguments?.action || ""}` : `${owner}:${body.method}${body.params?.uri ? ":" + body.params.uri : ""}`;
    calls.push(call);
    if (state.failScaena && owner === "scaena") return new Response("unavailable", { status: 503 });
    const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") return reply({ protocolVersion: "2025-06-18", serverInfo: { name: owner + "-mcp", version: "1.4.0" } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      const pages = providerTools(owner, state.revision || 0);
      const page = Number(String(body.params?.cursor || "page-0").replace("page-", ""));
      return reply({ tools: pages[page], ...(page + 1 < pages.length ? { nextCursor: `page-${page + 1}` } : {}) });
    }
    if (body.method === "resources/read") {
      const uri = body.params.uri;
      if (state.denyEikonaModels && (uri === "eikona://models/readiness" || uri === "eikona://channels"))
        return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "action is unknown or unavailable for this credential" } });
      const documents: Record<string, unknown> = {
        "eikona://runtime/capabilities": eikonaRuntimeCapabilities(),
        "eikona://models/readiness": eikonaModels(state.revision || 0),
        "eikona://channels": eikonaChannels(state.revision || 0),
        "sonora://capabilities": sonoraDiscovery(),
        "scaena://video-tasks/guide": scaenaGuide(state.revision || 0),
      };
      if (!(uri in documents)) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "Resource not found" } });
      return reply({ contents: [{ uri, text: JSON.stringify(documents[uri]) }] });
    }
    if (body.method === "tools/call") {
      const action = body.params.arguments?.action;
      if (body.params.name === "sonora.search") return reply({ structuredContent: { results: [{ provider_id: "openai-tts", model_ref: "sonora/voice/openai-tts", voice_ref: "alloy" }] } });
      if (action === "getProjectMediaCapabilities") return reply({ structuredContent: { state: "ready" } });
      if (action === "credential.status") return reply({ structuredContent: { configured: true } });
      if (action === "doctor.run") return reply({ structuredContent: { diagnostic_status: "success", configured: true } });
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unexpected" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls, state };
}

const readOnlyCall = /:(initialize|notifications\/initialized|tools\/list|resources\/read:[a-z]+:\/\/[a-z/-]+)$|:sonora\.search:$|:(scaena|sonora)\.execute:(getProjectMediaCapabilities|credential\.status|doctor\.run)$/;

describe("tool catalog discovery", () => {
  it("builds a cross-owner catalog from read-only discovery only", async () => {
    const transport = owners();
    const providers = new ProviderRunManager(config, transport.fetch);
    const catalog = await new ToolCatalogService(providers, new ToolCatalogStore(createMemoryDB())).snapshot(scope);
    expect(catalog.schema_version).toBe("yeisme.tool_catalog.v1");
    expect(catalog.freshness).toBe("fresh");
    expect(catalog.servers.map((server) => [server.owner, server.coverage])).toEqual([
      ["eikona", "readable"], ["scaena", "readable"], ["sonora", "readable"],
      ["aigora", "needs_contract"], ["gateway", "needs_contract"], ["auctra", "needs_contract"],
    ]);
    expect(catalog.servers[0]).toMatchObject({ server_name: "eikona-mcp", server_version: "1.4.0", counts: { tools: 3 } });
    expect(catalog.servers[1].latest_policy).toContain("latest mainline");
    expect(catalog.tools.filter((tool) => tool.owner === "sonora").map((tool) => tool.name)).toEqual(["sonora.execute", "sonora.search", "sonora.fetch"]);
    expect(catalog.models.find((model) => model.model_ref === "openai/gpt-image-1")?.status).toBe("historical");
    expect(catalog.actions.find((action) => action.name === "music.generate")?.risk).toBe("paid_external");
    expect(catalog.channels.filter((channel) => channel.owner === "scaena")).toHaveLength(4);
    expect(catalog.changes).toEqual([]);
    const unexpected = transport.calls.filter((call) => !readOnlyCall.test(call));
    expect(unexpected).toEqual([]);
    expect(JSON.stringify(catalog)).not.toContain("catalog-secret-token");
  });

  it("shares one cached discovery pass with the capability projection", async () => {
    const transport = owners();
    const providers = new ProviderRunManager(config, transport.fetch);
    const service = new ToolCatalogService(providers, new ToolCatalogStore(createMemoryDB()));
    const [catalog, capabilities] = await Promise.all([service.snapshot(scope), providers.capabilities(scope)]);
    expect(transport.calls.filter((call) => call === "eikona:initialize")).toHaveLength(1);
    expect(catalog.models.length).toBeGreaterThan(0);
    const video = capabilities.find((row) => row.owner === "scaena")!;
    expect(video.input_modes).toEqual(["text_to_video", "image_to_video", "keyframe_video"]);
    expect(video.submit_gate).toBe("disabled_by_default");
    expect(capabilities.find((row) => row.owner === "eikona")!.input_modes).toEqual(["text_to_image", "image_to_image", "image_upscale"]);
  });

  it("reports an observer credential that cannot read model snapshots as partial coverage", async () => {
    const transport = owners({ denyEikonaModels: true });
    const catalog = await new ToolCatalogService(new ProviderRunManager(config, transport.fetch), new ToolCatalogStore(createMemoryDB())).snapshot(scope);
    const coverage = catalog.coverage.find((item) => item.owner === "eikona")!;
    expect(coverage.state).toBe("partial");
    expect(coverage.reason).toBe("model_snapshot_unreadable:mcp_access_denied|channel_summary_unreadable:mcp_access_denied");
    expect(catalog.models.filter((model) => model.owner === "eikona")).toEqual([]);
    expect(catalog.actions.filter((action) => action.owner === "eikona").length).toBeGreaterThan(0);
  });

  it("classifies an owner version without model resources as unsupported, not forbidden", async () => {
    const transport = owners();
    const base = transport.fetch;
    const fetch = (async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "resources/read" && (body.params.uri === "eikona://models/readiness" || body.params.uri === "eikona://channels"))
        return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "BACKING_ERROR", data: { error: { code: "BACKING_ERROR", message: "unsupported eikona resource collection: models" } } } });
      return base(url as string, init);
    }) as typeof globalThis.fetch;
    const catalog = await new ToolCatalogService(new ProviderRunManager(config, fetch), new ToolCatalogStore(createMemoryDB())).snapshot(scope);
    const coverage = catalog.coverage.find((item) => item.owner === "eikona")!;
    expect(coverage).toMatchObject({ state: "partial", reason: "model_snapshot_unreadable:mcp_resource_unsupported|channel_summary_unreadable:mcp_resource_unsupported" });
  });

  it("serves the last good owner pass as stale and rate-limits forced refreshes", async () => {
    const transport = owners();
    const providers = new ProviderRunManager(config, transport.fetch);
    const service = new ToolCatalogService(providers, new ToolCatalogStore(createMemoryDB()));
    await service.snapshot(scope);
    transport.state.failScaena = true;
    const refreshed = await service.snapshot(scope, { refresh: true });
    expect(refreshed.refresh.forced).toBe(true);
    expect(refreshed.freshness).toBe("stale");
    const scaena = refreshed.coverage.find((item) => item.owner === "scaena")!;
    expect(scaena).toMatchObject({ freshness: "stale", state: "readable" });
    expect(refreshed.channels.filter((channel) => channel.owner === "scaena")).toHaveLength(4);
    const callsBefore = transport.calls.length;
    const throttled = await service.snapshot(scope, { refresh: true });
    expect(throttled.refresh.throttled).toBe(true);
    expect(transport.calls.length).toBe(callsBefore);
    const capability = (await providers.capabilities(scope)).find((row) => row.owner === "scaena")!;
    expect(capability).toMatchObject({ readiness: "stale", supports_live_submit: false });
  });

  it("records owner drift as catalog changes after the baseline", async () => {
    const db = createMemoryDB();
    const first = owners();
    await new ToolCatalogService(new ProviderRunManager(config, first.fetch), new ToolCatalogStore(db)).snapshot(scope);
    const later = owners({ revision: 1 });
    const catalog = await new ToolCatalogService(new ProviderRunManager(config, later.fetch), new ToolCatalogStore(db)).snapshot(scope);
    const changes = catalog.changes.map((change) => `${change.owner}:${change.kind}:${change.entry_id}:${change.change}`);
    expect(changes).toEqual(expect.arrayContaining([
      "eikona:model:black-forest/flux-2-pro@openrouter:added",
      "eikona:channel:legacy-gateway:removed",
      "eikona:tool:eikona.search:changed",
      "scaena:channel:wan3-frames-5s:changed",
    ]));
  });

  it("serves the catalog only to scoped sessions over GET", async () => {
    const transport = owners();
    const auth = new SessionAuth(config);
    const session = { id: "s", issuer: "local", subject: "u", name: "U", accessToken: "", accessAudience: [], expires: Date.now() + 10000, csrf: "c", epoch: 3 };
    auth.sessions.set(session.id, session);
    const app = createApp(config, { auth, providers: new ProviderRunManager(config, transport.fetch) });
    const request = (path: string, method = "GET", cookie = true) => new Request(config.origin + "/api/control-center/v1" + path, { method, headers: { ...(cookie ? { Cookie: "yeisme_session=s" } : {}), Origin: config.origin, "X-CSRF-Token": "c" } });
    const ok = await app(request("/tool-catalog?scope=scope-catalog"));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ schema_version: "yeisme.tool_catalog.v1", scope: "scope-catalog", epoch: 3 });
    expect((await app(request("/tool-catalog?scope=scope-catalog", "POST"))).status).toBe(405);
    expect((await app(request("/tool-catalog?scope=other"))).status).toBe(404);
    expect((await app(request("/tool-catalog?scope=scope-catalog", "GET", false))).status).toBe(401);
  });
});
