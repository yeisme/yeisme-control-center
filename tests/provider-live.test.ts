import { describe, expect, it, vi } from "vitest";
import { ProviderRunManager } from "../server/provider-live";
import { RunStore } from "../server/db/run-store";
import { createMemoryDB } from "../server/db/client";
import type { ScopeBinding, ServerConfig } from "../server/contracts";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { eikonaRuntimeCapabilities } from "../scripts/fixtures/provider-catalog";

// As personal-config writes a scope: its own `project` is a label of the scope, not the owner project its runs name.
const scope: ScopeBinding = {
  id: "scope-1",
  tenant: "personal",
  team: "studio",
  project: "personal",
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
/** Eikona's runtime capabilities; an older Eikona's generate does not declare `max_cost_usd`. */
function runtimeCapabilities(capDeclared: boolean) {
  const document = eikonaRuntimeCapabilities();
  if (!capDeclared) for (const action of document.data.actions) delete (action.input_schema as { properties: Record<string, unknown> }).properties.max_cost_usd;
  return document;
}
function fetcher(status: Record<string, unknown> = { cost: 0.04, currency: "USD" }, options: { capDeclared?: boolean; capUnreadable?: boolean; refuse?: string; runId?: string } = {}) {
  const runId = options.runId ?? "eikona-run-1";
  let submit = 0;
  const calls: { action: string; args: Record<string, any>; idempotency_key?: string }[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "initialize") return Response.json({ id: body.id, result: { protocolVersion: "2025-06-18" } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return Response.json({ id: body.id, result: { tools: [{ name: "eikona.execute" }] } });
    if (body.method === "resources/read" && body.params.uri === "eikona://runtime/capabilities" && options.capUnreadable)
      return Response.json({ id: body.id, error: { code: -32603, message: "backing unavailable" } });
    if (body.method === "resources/read" && body.params.uri === "eikona://runtime/capabilities")
      return Response.json({ id: body.id, result: { contents: [{ uri: body.params.uri, text: JSON.stringify(runtimeCapabilities(options.capDeclared ?? true)) }] } });
    if (body.method === "tools/call") {
      calls.push(body.params.arguments);
      if (options.refuse && body.params.arguments.action === "generate")
        return Response.json({ id: body.id, result: { isError: true, structuredContent: { request_id: "req-1", error: { code: options.refuse, message: "refused before provider submit" } } } });
      if (["generate", "createVideoProviderTask", "voice"].includes(body.params.arguments.action)) {
        submit++;
        return Response.json({ id: body.id, result: { structuredContent: { result: { run_id: runId, state: "queued" } } } });
      }
      return Response.json({ id: body.id, result: { structuredContent: { result: { run_id: runId, state: "succeeded", outputs: ["artifact-1"], ...status } } } });
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
  it("reads Sonora's synchronous audition: its usage record, its audio asset and its cost in USD", async () => {
    const audition = { status: "success", data: { projection: { status: "success", data: { audio_asset_ref: "sonora://audio-asset/audition-1", provider_usage_ref: "sonora://provider-usage/audition-1", cost_usd: 0, review_status: "pending_review" } } } };
    const fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "initialize") return Response.json({ id: body.id, result: { protocolVersion: "2025-06-18" } });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return Response.json({ id: body.id, result: { tools: [{ name: "sonora.execute" }] } });
      return Response.json({ id: body.id, result: { structuredContent: { request_id: "req-1", result: { action: body.params.arguments.action, schema_version: "sonora.execute.v1", ...audition } } } });
    }) as typeof globalThis.fetch;
    const sonora = { ...config, providers: { sonora: { owner: "sonora", endpoint: "https://provider.example/mcp", credential_env: "TEST_PROVIDER_TOKEN", enabled: true, action_manifest: { submit: "voice.audition" } } } } as ServerConfig;
    const manager = new ProviderRunManager(sonora, fetch);
    const run = await manager.create({ ...request("canary-audio-sync1"), owner: "sonora", modality: "audio", model_ref: "sonora://voice/openai-tts/alloy", budget_cap: { amount: 0.5, currency: "USD" } }, scope, session);
    expect(run).toMatchObject({ state: "succeeded", source_ref: "sonora://provider-usage/audition-1", output_refs: ["sonora://audio-asset/audition-1"], upstream_cost: 0, currency: "USD", cost_state: "confirmed" });
    expect(manager.usageRows(scope)).toHaveLength(1);
  });
  it("hands each owner its cap in USD exactly as given", async () => {
    const transport = fetcher();
    const providers = { ...config.providers, scaena: { owner: "scaena", endpoint: "https://provider.example/mcp", credential_env: "TEST_PROVIDER_TOKEN", enabled: true }, sonora: { owner: "sonora", endpoint: "https://provider.example/mcp", credential_env: "TEST_PROVIDER_TOKEN", enabled: true } } as ServerConfig["providers"];
    const manager = new ProviderRunManager({ ...config, providers }, transport.fetch);
    await manager.create({ ...request("canary-video-0001"), owner: "scaena", modality: "video", model_ref: "scaena/video", budget_cap: { amount: 1.2, currency: "USD" } }, scope, session);
    await manager.create({ ...request("canary-audio-0001"), owner: "sonora", modality: "audio", model_ref: "sonora://voice/openai-tts/alloy", budget_cap: { amount: 0.5, currency: "USD" } }, scope, session);
    const submitted = (action: string) => transport.calls.find((call) => call.action === action)!.args;
    expect(submitted("createVideoProviderTask").body.max_cost_micro_usd).toBe(1_200_000);
    // The provider comes from the voice reference, as Sonora's voice.audition requires.
    // Only the arguments voice.audition declares, with the idempotency key beside them as Sonora requires.
    expect(submitted("voice")).toEqual({ max_cost_usd: "0.50", provider_id: "openai-tts", voice_model_ref: "sonora://voice/openai-tts/alloy", confirm_external_call: true, text: "A minimal abstract blue square" });
    expect(transport.calls.find((call) => call.action === "voice")).toMatchObject({ idempotency_key: "canary-audio-0001" });
  });
  it("accounts an owner's cost only with its currency, and keeps a cost without one unknown", async () => {
    for (const [status, cost, currency, state] of [[{ cost: 0.04, currency: "USD" }, 0.04, "USD", "confirmed"], [{ cost: 12 }, null, "USD", "unknown"], [{ cost_usd: 0.003 }, 0.003, "USD", "confirmed"], [{ cost_micro_usd: 25_000 }, 0.025, "USD", "confirmed"]] as const) {
      const manager = new ProviderRunManager(config, fetcher(status).fetch);
      const run = await manager.create(request(`canary-cost-${state}-01`), scope, session);
      const reconciled = await manager.reconcile(run.run_ref);
      expect([reconciled.upstream_cost, reconciled.currency, reconciled.cost_state]).toEqual([cost, currency, state]);
      expect(manager.usageRows(scope)[0]).toMatchObject({ upstream_cost: cost, cost_state: state });
    }
  });
  it("lists the usage of the runs a scope made, whatever name its own project carries", async () => {
    // Two scopes that label themselves alike and bind different owner projects; each run names the owner project of its scope.
    const store = new RunStore(createMemoryDB());
    const other: ScopeBinding = { ...scope, id: "scope-2", owners: { ...scope.owners, eikona: { tenant: "personal", project: "project-2", actor: "owner", audience: "eikona" } } };
    expect(other.project).toBe(scope.project);
    const first = new ProviderRunManager(config, fetcher(undefined, { runId: "eikona-run-a" }).fetch, store);
    const second = new ProviderRunManager(config, fetcher(undefined, { runId: "eikona-run-b" }).fetch, store);
    await first.create(request("canary-scope-one-01"), scope, session);
    await second.create({ ...request("canary-scope-two-01"), scope_id: "scope-2", project_ref: "project-2" }, other, session);
    expect(first.usageRows(scope).map((row) => [row.source_ref, row.project_ref])).toEqual([["eikona-run-a", "project-1"]]);
    expect(first.usageRows(other).map((row) => [row.source_ref, row.project_ref])).toEqual([["eikona-run-b", "project-2"]]);
    // A scope that never ran anything sees nothing, whatever its project is called.
    expect(first.usageRows({ ...scope, id: "scope-3" })).toEqual([]);
  });
  it("lets the status monitor end quietly when the ledger cannot be read, so the process keeps running", async () => {
    vi.useFakeTimers();
    try {
      const store = new RunStore(createMemoryDB());
      const manager = new ProviderRunManager(config, fetcher().fetch, store);
      const run = await manager.create(request("canary-monitor-0001"), scope, session);
      expect(run.state).toBe("queued");
      // The monitor started by create() is waiting for its first poll; from now on every read of the ledger fails.
      vi.spyOn(store, "getRun").mockImplementation(() => { throw new Error("database is locked"); });
      const monitor = (manager as unknown as { monitor(ref: string): Promise<void> }).monitor(run.run_ref);
      const outcome = expect(monitor).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(1500 * 3);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps unknown outcomes unknown instead of retrying", async () => {
    const transport = fetcher();
    const manager = new ProviderRunManager(config, transport.fetch);
    const first = await manager.create(request("canary-image-unknown"), scope, session);
    expect(first.state).toBe("queued");
    expect(transport.submits).toBe(1);
  });
  it("hands Eikona the cap, and does not submit to an Eikona that does not declare one", async () => {
    const declared = fetcher();
    await new ProviderRunManager(config, declared.fetch).create(request("canary-image-capped"), scope, session);
    expect(declared.calls.find((call) => call.action === "generate")!.args.max_cost_usd).toBe(2);
    // An older Eikona ignores arguments it does not declare, so its run would carry no owner-enforced cap.
    const older = fetcher(undefined, { capDeclared: false });
    const manager = new ProviderRunManager(config, older.fetch);
    const run = await manager.create(request("canary-image-uncapped"), scope, session);
    expect([run.state, run.error_code, older.calls.filter((call) => call.action === "generate").length]).toEqual(["failed", "provider_cost_cap_unsupported", 0]);
    expect(manager.budgetStatus().reserved).toBe(0);
    expect((await manager.capabilities(scope))[0]).toMatchObject({ owner: "eikona", supports_live_submit: false, readiness: "needs_contract", blocker: "owner_cost_cap_undeclared" });
  });
  it("does not submit when Eikona's contract cannot be read, and says so rather than calling it unsupported", async () => {
    const unreadable = fetcher(undefined, { capUnreadable: true });
    const manager = new ProviderRunManager(config, unreadable.fetch);
    const run = await manager.create(request("canary-image-unverified"), scope, session);
    expect([run.state, run.error_code, unreadable.submits]).toEqual(["failed", "provider_cost_cap_unverified", 0]);
    expect(manager.budgetStatus().reserved).toBe(0);
    expect((await manager.capabilities(scope))[0]).toMatchObject({ supports_live_submit: false, blocker: "runtime_capabilities_unreadable" });
  });
  it("ends a run Eikona refuses for cost as failed and releases its reservation", async () => {
    for (const code of ["COST_LIMIT_EXCEEDED", "UNKNOWN_COST_REJECTED"]) {
      const manager = new ProviderRunManager(config, fetcher(undefined, { refuse: code }).fetch);
      const run = await manager.create(request(`canary-refused-${code.toLowerCase()}`), scope, session);
      expect([run.state, run.error_code]).toEqual(["failed", code]);
      expect(manager.budgetStatus().reserved).toBe(0);
    }
  });
  it("serves scoped capability, usage, run and SSE projections", async () => {
    const transport = fetcher();
    const scopedConfig: ServerConfig = {
      ...config,
      principals: [{ issuer: "local", subject: "u", name: "U", role: "admin", scopes: [scope] }],
    };
    const auth = new SessionAuth(scopedConfig);
    auth.sessions.set(session.id, session);
    const manager = new ProviderRunManager(scopedConfig, transport.fetch);
    const app = createApp(scopedConfig, { auth, providers: manager });
    const requestTo = (path: string, method = "GET", body?: unknown) => new Request(scopedConfig.origin + "/api/control-center/v1" + path, { method, headers: { Cookie: "yeisme_session=" + session.id, Origin: scopedConfig.origin, "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const caps = await app(requestTo("/capabilities?scope=scope-1"));
    // Each capability names the owner project this scope binds, which a live run must use.
    expect((await caps.json()).capabilities[0]).toMatchObject({ owner: "eikona", project_ref: "project-1", supports_live_submit: true });
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
