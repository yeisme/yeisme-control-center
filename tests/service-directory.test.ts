import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import type { ScopeBinding, ServerConfig, Session, TaskConnection } from "../server/contracts";
import { serviceDefinitions } from "../src/service-directory";

const origin = "https://control.example.test";
const scope: ScopeBinding = {
  id: "scope-a", tenant: "a", project: "a", team: "", label: "Allowed scope",
  owners: {}, connection_ids: ["allowed", "disabled"],
};
const connection = (id: string): TaskConnection => ({
  id, owner: "eikona", instance_id: id, label: id, environment: "test", project: "a",
  endpoint: "https://owner.example.test/private-endpoint", credential_ref: "/not-readable/secret",
  enabled: true, allow_cancel: true, allow_content: true,
});
function setup() {
  const config: ServerConfig = {
    origin, port: 4312, owners: {},
    principals: [{ issuer: "test", subject: "user", name: "Test", role: "admin", scopes: [scope] }],
    connections: [connection("allowed"), { ...connection("disabled"), enabled: false }, connection("other-scope")],
  };
  const auth = new SessionAuth(config);
  const session: Session = {
    id: "test-session", issuer: "test", subject: "user", name: "Test", csrf: "test-csrf",
    accessToken: "", accessAudience: [], expires: Date.now() + 60_000, epoch: 1,
  };
  auth.sessions.set(session.id, session);
  const app = createApp(config, { auth });
  const request = (path: string, authenticated = true) => new Request(origin + "/api/control-center/v1" + path, {
    headers: authenticated ? { Cookie: "yeisme_session=test-session" } : {},
  });
  return { app, config, session, request };
}
describe("service directory", () => {
  it("includes current products without resurrecting retired or empty directories", () => {
    const ids = serviceDefinitions.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["scaena", "eikona", "sonora", "gateway", "aigora", "opendesign"]));
    for (const id of ["yeitra", "radar", "ordo", "workbench", "mediahub", "n8n"])
      expect(ids).not.toContain(id);
  });
  it("requires login and exact scope even for a control-center admin", async () => {
    const { app, request } = setup();
    expect((await app(request("/services?scope=scope-a", false))).status).toBe(401);
    expect((await app(request("/services?scope=scope-b"))).status).toBe(404);
    expect((await app(request("/services"))).status).toBe(404);
  });
  it("projects only non-secret current-scope configuration without upstream calls", async () => {
    const { app, session, request } = setup();
    // Personal connections cannot be consumed by OIDC sessions.
    let result = await (await app(request("/services?scope=scope-a"))).json();
    expect(result.services.find((v: { id: string }) => v.id === "eikona").connections).toEqual([]);
    // Use the production personal-binding path without reading any credential.
    const { config } = setup();
    config.auth_mode = "personal";
    config.personal = { name: "Owner", password_hash_ref: "/not-read", scope_ids: [scope.id], role: "admin" };
    const auth = new SessionAuth(config);
    const current = { ...session, issuer: "yeisme:personal", subject: "owner", personal: true };
    vi.spyOn(auth, "current").mockReturnValue(current);
    const personalApp = createApp(config, { auth });
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No upstream call allowed"));
    try {
      const response = await personalApp(request("/services?scope=scope-a"));
      expect(response.status).toBe(200);
      result = await response.json();
      expect(result.schema_version).toBe("yeisme.service_directory.v1");
      const eikona = result.services.find((v: { id: string }) => v.id === "eikona");
      expect(eikona.observation).toBe("not_checked");
      expect(eikona.configuration).toBe("configured");
      expect(eikona.connections.map((v: { id: string }) => v.id)).toEqual(["allowed", "disabled"]);
      expect(eikona.connections[1].configuration).toBe("disabled");
      const serialized = JSON.stringify(result);
      for (const forbidden of ["other-scope", "private-endpoint", "credential_ref", "/not-readable", "password_hash"])
        expect(serialized).not.toContain(forbidden);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it("propagates connection freshness into per-service coverage", async () => {
    const { config, session } = setup();
    config.auth_mode = "personal";
    config.personal = { name: "Owner", password_hash_ref: "/not-read", scope_ids: [scope.id], role: "admin" };
    const auth = new SessionAuth(config);
    const current = { ...session, issuer: "yeisme:personal", subject: "owner", personal: true };
    vi.spyOn(auth, "current").mockReturnValue(current);
    const runtime = (state: string) => ({
      state, checked_at: "2026-10-12T08:00:00Z", last_success_at: state === "ready" ? "2026-10-12T08:00:00Z" : null,
      transport: "verified" as const, authorization: "verified" as const, contract: "supported" as const,
      content: "supported" as const,
    });
    const tasks = {
      observe: async () => [
        { id: "allowed", owner: "eikona", instance_id: "allowed", label: "allowed", environment: "test", project: "a", state: "ready", observed_at: "2026-10-12T08:00:00Z", runtime: runtime("ready") },
      ],
    };
    const personalApp = createApp(config, { auth, tasks: tasks as never });
    const response = await personalApp(new Request(origin + "/api/control-center/v1/services?scope=scope-a&observe=1", {
      headers: { Cookie: "yeisme_session=test-session" },
    }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.epoch).toBe(1);
    const eikona = result.services.find((v: { id: string }) => v.id === "eikona");
    expect(eikona.coverage).toEqual({ state: "complete", observed_at: "2026-10-12T08:00:00Z" });
    expect(eikona.observed_at).toBe("2026-10-12T08:00:00Z");
    const scaena = result.services.find((v: { id: string }) => v.id === "scaena");
    expect(scaena.coverage).toEqual({ state: "not_recorded", observed_at: undefined });
  });
  it("keeps history contract gaps visible even when active tasks are ready", async () => {
    const { config, session } = setup();
    config.auth_mode = "personal";
    config.personal = { name: "Owner", password_hash_ref: "/not-read", scope_ids: [scope.id], role: "admin" };
    const auth = new SessionAuth(config);
    const current = { ...session, issuer: "yeisme:personal", subject: "owner", personal: true };
    vi.spyOn(auth, "current").mockReturnValue(current);
    const runtime = {
      state: "ready", checked_at: "2026-10-12T08:00:00Z", last_success_at: "2026-10-12T08:00:00Z",
      transport: "verified" as const, authorization: "verified" as const, contract: "supported" as const,
      content: "supported" as const,
    };
    const tasks = {
      observe: async () => [{
        id: "allowed", owner: "eikona", instance_id: "allowed", label: "allowed", environment: "test", project: "a", state: "ready", observed_at: "2026-10-12T08:00:00Z",
        runtime: {
          ...runtime,
          channels: {
            active: { state: "ready", observed_at: "2026-10-12T08:00:00Z" },
            history: { state: "needs_contract", reason: "owner_action_contract_missing", observed_at: "2026-10-12T08:00:01Z" },
          },
        },
      }],
    };
    const personalApp = createApp(config, { auth, tasks: tasks as never });
    const result = await (await personalApp(new Request(origin + "/api/control-center/v1/services?scope=scope-a&observe=1", {
      headers: { Cookie: "yeisme_session=test-session" },
    }))).json();
    const eikona = result.services.find((v: { id: string }) => v.id === "eikona");
    expect(eikona.coverage.state).toBe("needs_contract");
    expect(eikona.connections[0].runtime.channels.history).toMatchObject({ state: "needs_contract" });
  });
  it("marks configured request-owner projections as partial, never complete", async () => {
    const { config, session } = setup();
    const enterprise: ServerConfig = {
      ...config,
      owners: { eikona: { origin: "https://eikona.example.test", audience: "aud-e" } },
      principals: [{
        issuer: "test", subject: "user", name: "Test", role: "admin",
        scopes: [{ ...scope, owners: { eikona: { tenant: "a", project: "a", actor: "user", audience: "aud-e" } } }],
      }],
    };
    const auth = new SessionAuth(enterprise);
    auth.sessions.set(session.id, { ...session, accessToken: "tok", accessAudience: ["aud-e"] });
    const app = createApp(enterprise, { auth });
    const response = await app(new Request(origin + "/api/control-center/v1/services?scope=scope-a", {
      headers: { Cookie: "yeisme_session=test-session" },
    }));
    const result = await response.json();
    const eikona = result.services.find((v: { id: string }) => v.id === "eikona");
    expect(eikona.configuration).toBe("configured");
    expect(eikona.coverage).toEqual({ state: "partial", observed_at: undefined });
  });
  it("reports liveness without exposing configuration or querying owners", async () => {
    const { app, request } = setup();
    const response = await app(request("/health", false));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "yeisme-control-center" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
