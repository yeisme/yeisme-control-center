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
const session = { id: "s", issuer: "local", subject: "u", name: "U", accessToken: "", accessAudience: [], expires: Date.now() + 10000, csrf: "c" };
process.env.TEST_PROVIDER_TOKEN = "test-token";
const request = (key = "canary-image-0001") => ({
  mode: "live" as const,
  owner: "eikona" as const,
  modality: "image" as const,
  model_ref: "openai/gpt-image-2.5-sunburst",
  scope_id: "scope-1",
  project_ref: "project-1",
  prompt: "A minimal abstract blue square",
  budget_cap: { amount: 15, currency: "CNY" as const },
  idempotency_key: key,
});
function fetcher() {
  let submit = 0;
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "initialize") return Response.json({ id: body.id, result: { protocolVersion: "2025-06-18" } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return Response.json({ id: body.id, result: { tools: [{ name: "eikona.execute" }] } });
    if (body.method === "tools/call") {
      if (body.params.arguments.action === "generate") {
        submit++;
        return Response.json({ id: body.id, result: { structuredContent: { result: { run_id: "eikona-run-1", state: "queued" } } } });
      }
      return Response.json({ id: body.id, result: { structuredContent: { result: { run_id: "eikona-run-1", state: "succeeded", outputs: ["artifact-1"], cost: 12, currency: "CNY" } } } });
    }
    return Response.json({ id: body.id, result: {} });
  };
  return { fetch: fetch as typeof globalThis.fetch, get submits() { return submit; } };
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
    await expect(manager.create({ ...request(), budget_cap: { amount: 16, currency: "CNY" } }, scope, session)).rejects.toThrow("provider_budget_exceeded");
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
