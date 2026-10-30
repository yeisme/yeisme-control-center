import { describe, expect, it } from "vitest";
import { ProviderRunManager } from "../server/provider-live";
import type { ScopeBinding, ServerConfig } from "../server/contracts";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";

const scope: ScopeBinding = {
  id: "scope-1",
  tenant: "personal",
  team: "studio",
  project: "project-1",
  label: "Project",
  owners: {
    eikona: { tenant: "personal", project: "project-1", actor: "owner", audience: "eikona" },
    scaena: { tenant: "personal", project: "project-1", actor: "owner", audience: "scaena" },
    sonora: { tenant: "personal", project: "project-1", actor: "owner", audience: "sonora" },
  },
};
const config: ServerConfig = {
  origin: "http://127.0.0.1:4312",
  port: 4312,
  principals: [],
  owners: {},
  providers: {
    eikona: { owner: "eikona", endpoint: "https://provider.example/mcp", credential_env: "TEST_PROVIDER_TOKEN", enabled: true },
  },
};
const session = { id: "s", issuer: "local", subject: "u", name: "U", accessToken: "", accessAudience: [], expires: Date.now() + 10000, csrf: "c", epoch: 1 };
process.env.TEST_PROVIDER_TOKEN = "test-token";
const request = (key = "canary-image-0001") => ({
  mode: "live" as const,
  owner: "eikona" as const,
  modality: "image" as const,
  model_ref: "openai/gpt-image-2.5-sunburst",
  scope_id: "scope-1",
  project_ref: "project-1",
  prompt: "A minimal abstract blue square",
  budget_cap: { amount: 2, currency: "USD" as const },
  idempotency_key: key,
});
function fetcher(status: Record<string, unknown> = { cost: 0.04, currency: "USD" }) {
  let submit = 0;
  const calls: { action: string; args: Record<string, any> }[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "initialize") return Response.json({ id: body.id, result: { protocolVersion: "2025-06-18" } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return Response.json({ id: body.id, result: { tools: [{ name: "eikona.execute" }] } });
    if (body.method === "tools/call") {
      calls.push(body.params.arguments);
      if (["generate", "createVideoProviderTask", "voice"].includes(body.params.arguments.action)) {
        submit++;
        return Response.json({ id: body.id, result: { structuredContent: { result: { run_id: "eikona-run-1", state: "queued" } } } });
      }
      return Response.json({ id: body.id, result: { structuredContent: { result: { run_id: "eikona-run-1", state: "succeeded", outputs: ["artifact-1"], ...status } } } });
    }
    return Response.json({ id: body.id, result: {} });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls, get submits() { return submit; } };
}
describe("ProviderRunManager", () => {
  it("keeps live submissions idempotent and projects confirmed cost once", async () => {
    const transport = fetcher();
    const manager = new ProviderRunManager(config, transport.fetch);
    const first = await manager.create(request(), scope, session);
    const second = await manager.create(request(), scope, session);
    expect(second.run_ref).toBe(first.run_ref);
    expect(transport.submits).toBe(1);
    expect(first.source_ref).toBe("eikona-run-1");
    expect(first.upstream_cost).toBeNull();
    expect(manager.usageRows(scope)).toHaveLength(1);
  });
  it("rejects cross-scope or modality mismatches before a provider call", async () => {
    const manager = new ProviderRunManager(config, fetcher().fetch);
    await expect(manager.create({ ...request(), scope_id: "other" }, scope, session)).rejects.toThrow("scope_mismatch");
    await expect(manager.create({ ...request(), modality: "video" }, scope, session)).rejects.toThrow("provider_modality_mismatch");
    await expect(manager.create({ ...request(), budget_cap: { amount: 2.5, currency: "USD" } }, scope, session)).rejects.toThrow("provider_budget_exceeded");
  });
  it("refuses a cap in another currency before any owner call, since no exchange rate is assumed", async () => {
    const transport = fetcher();
    const manager = new ProviderRunManager(config, transport.fetch);
    await expect(manager.create({ ...request(), budget_cap: { amount: 15, currency: "CNY" } } as never, scope, session)).rejects.toThrow("provider_budget_currency_mismatch");
    expect(transport.calls).toHaveLength(0);
    expect(manager.budgetStatus()).toMatchObject({ currency: "USD", reserved: 0 });
  });
  it("does not send a run whose owner estimate is in another currency than the cap", async () => {
    const transport = fetcher();
    const estimating = { ...config, providers: { eikona: { ...config.providers!.eikona!, action_manifest: { submit: "generate", status: "status", reconcile: "status", estimate: "estimate" } } } } as ServerConfig;
    const original = transport.fetch;
    const fetch = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "tools/call" && body.params.arguments.action === "estimate") return Response.json({ id: body.id, result: { structuredContent: { result: { amount: 1, currency: "CNY" } } } });
      return original(url, init);
    }) as typeof globalThis.fetch;
    const run = await new ProviderRunManager(estimating, fetch).create(request("canary-estimate-cny"), scope, session);
    expect([run.state, run.error_code, transport.submits]).toEqual(["failed", "provider_budget_currency_mismatch", 0]);
  });
  it("hands each owner its cap in USD exactly as given", async () => {
    const transport = fetcher();
    const providers = { ...config.providers, scaena: { owner: "scaena", endpoint: "https://provider.example/mcp", credential_env: "TEST_PROVIDER_TOKEN", enabled: true }, sonora: { owner: "sonora", endpoint: "https://provider.example/mcp", credential_env: "TEST_PROVIDER_TOKEN", enabled: true } } as ServerConfig["providers"];
    const manager = new ProviderRunManager({ ...config, providers }, transport.fetch);
    await manager.create({ ...request("canary-video-0001"), owner: "scaena", modality: "video", model_ref: "scaena/video", budget_cap: { amount: 1.2, currency: "USD" } }, scope, session);
    await manager.create({ ...request("canary-audio-0001"), owner: "sonora", modality: "audio", model_ref: "sonora/openai-tts", budget_cap: { amount: 0.5, currency: "USD" } }, scope, session);
    const submitted = (action: string) => transport.calls.find((call) => call.action === action)!.args;
    expect(submitted("createVideoProviderTask").body.max_cost_micro_usd).toBe(1_200_000);
    expect(submitted("voice").max_cost_usd).toBe("0.50");
  });
  it("accounts an owner's cost only with its currency, and keeps a cost without one unknown", async () => {
    for (const [status, cost, currency, state] of [[{ cost: 0.04, currency: "USD" }, 0.04, "USD", "confirmed"], [{ cost: 12 }, null, "USD", "unknown"]] as const) {
      const manager = new ProviderRunManager(config, fetcher(status).fetch);
      const run = await manager.create(request(`canary-cost-${state}-01`), scope, session);
      const reconciled = await manager.reconcile(run.run_ref);
      expect([reconciled.upstream_cost, reconciled.currency, reconciled.cost_state]).toEqual([cost, currency, state]);
      expect(manager.usageRows(scope)[0]).toMatchObject({ upstream_cost: cost, cost_state: state });
    }
  });
  it("keeps unknown outcomes unknown instead of retrying", async () => {
    const transport = fetcher();
    const manager = new ProviderRunManager(config, transport.fetch);
    const first = await manager.create(request("canary-image-unknown"), scope, session);
    expect(first.state).toBe("queued");
    expect(transport.submits).toBe(1);
  });
  it("serves scoped capability, usage, run and SSE projections", async () => {
    const transport = fetcher();
    const scopedConfig: ServerConfig = {
      ...config,
      principals: [{ issuer: "local", subject: "u", name: "U", scopes: [scope] }],
    };
    const auth = new SessionAuth(scopedConfig);
    auth.sessions.set(session.id, session);
    const manager = new ProviderRunManager(scopedConfig, transport.fetch);
    const app = createApp(scopedConfig, { auth, providers: manager });
    const requestTo = (path: string, method = "GET", body?: unknown) => new Request(scopedConfig.origin + "/api/control-center/v1" + path, { method, headers: { Cookie: "yeisme_session=" + session.id, Origin: scopedConfig.origin, "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const caps = await app(requestTo("/capabilities?scope=scope-1"));
    expect((await caps.json()).capabilities[0].owner).toBe("eikona");
    const created = await app(requestTo("/provider-runs?scope=scope-1", "POST", request("canary-http-0001")));
    expect(created.status).toBe(202);
    const run = await created.json();
    expect((await app(requestTo(`/provider-runs/${run.run_ref}?scope=scope-1`))).status).toBe(200);
    const usage = await app(requestTo("/usage?scope=scope-1"));
    expect((await usage.json()).rows).toHaveLength(1);
    const events = await app(requestTo(`/provider-runs/${run.run_ref}/events?scope=scope-1`));
    expect(await events.text()).toContain(run.run_ref);
  });
});
