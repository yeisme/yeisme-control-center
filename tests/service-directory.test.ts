import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { serviceDirectory } from "../server/service-directory";
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
      // The credential panel lists this scope's enabled connections by slot id; the file behind it is not readable here.
      expect(result.credentials).toEqual([{ id: "connection:allowed", owner: "eikona", label: "allowed", state: "unreadable", reason: "missing", shared_with: [] }]);
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
  it("adds credential statuses for personal administrators from the observations it already has, and for nobody else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "service-directory-credentials-"));
    try {
      const key = join(dir, "observer.key");
      writeFileSync(key, "observer-token\n", { mode: 0o600 });
      const { config, session } = setup();
      config.auth_mode = "personal";
      config.personal = { name: "Owner", password_hash_ref: "/not-read", scope_ids: [scope.id], role: "admin", users: [{ username: "vic", name: "Vic", role: "viewer", key_hash_ref: "/not-read", scope_ids: [scope.id] }] };
      config.connections = [
        { ...connection("allowed"), credential_ref: key, credential_expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() },
        { ...connection("disabled"), credential_ref: key, enabled: false },
        { ...connection("other-scope"), credential_ref: key },
      ];
      const runtime = (authorization: "verified" | "denied") => ({
        state: authorization === "verified" ? "ready" : "needs_authorization", checked_at: "2026-10-12T08:00:00Z", last_success_at: authorization === "verified" ? "2026-10-12T08:00:00Z" : null,
        transport: "verified" as const, authorization, contract: "supported" as const, content: "supported" as const,
      });
      const observe = vi.fn(async () => [{ id: "allowed", owner: "eikona", instance_id: "allowed", label: "allowed", environment: "test", project: "a", state: "ready", observed_at: "2026-10-12T08:00:00Z", runtime: runtime("verified") }]);
      const get = async (who: Partial<Session>, query: string) => {
        const auth = new SessionAuth(config);
        vi.spyOn(auth, "current").mockReturnValue({ ...session, ...who });
        const app = createApp(config, { auth, tasks: { observe } as never });
        return (await app(new Request(origin + "/api/control-center/v1/services?scope=scope-a" + query, { headers: { Cookie: "yeisme_session=test-session" } }))).json();
      };
      const admin = { issuer: "yeisme:personal", subject: "owner", personal: true };
      // Without ?observe=1 nothing was observed: the row is judged by the file and the recorded expiry alone.
      const quiet = await get(admin, "");
      expect(quiet.credentials).toEqual([{ id: "connection:allowed", owner: "eikona", label: "allowed", state: "expiring", stage: "7d", expires_at: expect.any(String), days_left: 3, shared_with: [] }]);
      expect(observe).not.toHaveBeenCalled();
      const observed = await get(admin, "&observe=1");
      expect(observed.credentials[0]).toMatchObject({ id: "connection:allowed", state: "expiring", last_accepted_at: "2026-10-12T08:00:00Z" });
      const serialized = JSON.stringify(observed);
      for (const leaked of [key, dir, "observer-token", "credential_ref", "credential_expires_at"]) expect(serialized, leaked).not.toContain(leaked);
      // Expiry dates and shared files are for administrators: a personal viewer, an OIDC session and a session the server does not know get no section.
      for (const [name, who] of [["viewer", { ...admin, subject: "vic" }], ["oidc", { personal: false }], ["unknown account", { ...admin, subject: "nobody" }]] as const) {
        const body = await get(who, "&observe=1");
        expect(body, name).not.toHaveProperty("credentials");
        expect(JSON.stringify(body), name).not.toContain("expires_at");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("lists a provider, a request owner and Auctra only for scopes that bind them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "service-directory-bound-"));
    try {
      const key = join(dir, "server.key");
      writeFileSync(key, "server-token\n", { mode: 0o600 });
      const { config, session } = setup();
      config.auth_mode = "personal";
      config.personal = { name: "Owner", password_hash_ref: "/not-read", scope_ids: [scope.id], role: "admin" };
      config.connections = [];
      config.owners = { aigora: { origin: "https://aigora.example.test", audience: "aud", credential_ref: key, credential_expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString() } };
      config.providers = { eikona: { owner: "eikona", endpoint: "https://eikona.example.test/mcp", credential_ref: key, enabled: true } };
      config.collection = { auctra: { origin: "https://auctra.example.test", audience: "aud", credential_ref: key, enabled: true } };
      const ids = async (bound: ScopeBinding) => {
        // The scope the route reads comes from the configuration the auth object was built from.
        const bound_config = { ...config, principals: [{ issuer: "test", subject: "user", name: "Test", role: "admin" as const, scopes: [bound] }] };
        const auth = new SessionAuth(bound_config);
        vi.spyOn(auth, "current").mockReturnValue({ ...session, issuer: "yeisme:personal", subject: "owner", personal: true });
        const app = createApp(bound_config, { auth });
        const body = await (await app(new Request(origin + "/api/control-center/v1/services?scope=scope-a", { headers: { Cookie: "yeisme_session=test-session" } }))).json();
        return (body.credentials as { id: string }[]).map((row) => row.id);
      };
      // This scope binds nothing the server holds credentials for, so it sees none of them.
      expect(await ids({ ...scope, connection_ids: [] })).toEqual([]);
      expect(await ids({ ...scope, connection_ids: [], owners: { aigora: { tenant: "a", project: "a", actor: "u", audience: "aud" } } })).toEqual(["owner:aigora"]);
      expect(await ids({ ...scope, connection_ids: [], owners: { eikona: { tenant: "a", project: "a", actor: "u", audience: "aud" } } })).toEqual(["provider:eikona"]);
      expect(await ids({ ...scope, connection_ids: [], collection: { auctra: { tenant: "a", project: "a", actor: "u", audience: "aud" } } })).toEqual(["collection:auctra"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("gives the tool projects registered in the control center their own credential rows, from the connection list it is handed", () => {
    const { config, session } = setup();
    config.auth_mode = "personal";
    config.personal = { name: "Owner", password_hash_ref: "/not-read", scope_ids: [scope.id], role: "admin" };
    const template = config.connections![0];
    const registered: TaskConnection = { ...template, id: "eikona-reg-1", label: "Eikona · 预告片", project: "teaser" };
    const listed = serviceDirectory(config, scope, { ...session, issuer: "yeisme:personal", subject: "owner", personal: true }, [], [template, registered]);
    expect(listed.credentials?.map((row) => [row.id, row.label, row.shared_with])).toEqual([["connection:allowed", "allowed", ["connection:eikona-reg-1"]], ["connection:eikona-reg-1", "Eikona · 预告片", ["connection:allowed"]]]);
  });
  it("reports liveness without exposing configuration or querying owners", async () => {
    const { app, request } = setup();
    const response = await app(request("/health", false));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "yeisme-control-center" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
