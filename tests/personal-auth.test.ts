import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionAuth } from "../server/auth";
import { hashPassword } from "../server/password";
import { createApp } from "../server/app";
import { TaskConnections } from "../server/task-connections";
import { vi } from "vitest";
import type { ServerConfig } from "../server/contracts";
const dir = mkdtempSync(join(tmpdir(), "yeisme-auth-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const origin = "http://127.0.0.1:4312";
const lanOrigin = "http://10.10.1.101:51873";
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) =>
  new Request(origin + "/api/control-center/v1" + path, {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const lanRequest = (path: string, method = "GET", body?: unknown) =>
  new Request(lanOrigin + "/api/control-center/v1" + path, {
    method,
    headers: { Origin: lanOrigin },
    body: body ? JSON.stringify(body) : undefined,
  });
async function setup() {
  const ref = join(dir, crypto.randomUUID());
  writeFileSync(ref, await hashPassword("test-only-password-123"), {
    mode: 0o600,
  });
  const config: ServerConfig = {
    origin,
    port: 4312,
    owners: {},
    auth_mode: "personal",
    personal: {
      name: "Owner",
      password_hash_ref: ref,
      scope_ids: ["personal"],
    },
    principals: [
      {
        issuer: "config",
        subject: "owner",
        name: "Owner",
        scopes: [
          {
            id: "personal",
            tenant: "personal",
            team: "",
            project: "p",
            label: "Personal",
            owners: {},
          },
        ],
      },
    ],
  };
  const auth = new SessionAuth(config);
  return { auth, config, app: createApp(config, { auth }) };
}
describe("personal login", () => {
  it("accepts the explicitly approved LAN HTTP origin", async () => {
    const { app, config } = await setup();
    config.origin = lanOrigin;
    const result = await app(lanRequest("/auth/personal", "POST", { password: "test-only-password-123" }));
    expect(result.status).toBe(200);
  });
  it("uses a server session without exposing service credentials", async () => {
    const { app } = await setup();
    const result = await app(
      request("/auth/personal", "POST", { password: "test-only-password-123" }),
    );
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    const s = await (
      await app(request("/session", "GET", undefined, cookie))
    ).json();
    expect(s.scopes[0].id).toBe("personal");
    expect(s.identity).toBe("yeisme:personal|owner");
    expect(s.accessToken).toBeUndefined();
  });
  it("authenticates a named user with an administrator-distributed key", async () => {
    const { app, auth, config } = await setup();
    config.config_file = join(dir, crypto.randomUUID() + ".json");
    const created = await auth.createPersonalUser({ username: "editor-01", name: "Editor", role: "viewer", scope_ids: ["personal"] });
    expect(created.access_key).toMatch(/^yk_live_/);
    expect(JSON.stringify(auth.listPersonalUsers())).not.toContain(created.access_key);
    const denied = await app(request("/auth/personal", "POST", { username: "editor-01", key: "wrong-key" }));
    expect(denied.status).toBe(401);
    const login = await app(request("/auth/personal", "POST", { username: "editor-01", key: created.access_key }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(await (await app(request("/session", "GET", undefined, cookie))).json()).toMatchObject({ username: "editor-01", role: "viewer" });
    auth.revokePersonalUser("editor-01");
    expect((await app(request("/session", "GET", undefined, cookie))).status).toBe(401);
  });
  it("requires the configured username and exposes only a server-derived role", async () => {
    const { app, auth, config } = await setup();
    config.personal!.username = "test-admin";
    config.personal!.role = "admin";
    const methods = await (await app(request("/auth/methods"))).json();
    expect(methods.username_required).toBe(true);
    expect(JSON.stringify(methods)).not.toContain("test-admin");
    for (const username of [undefined, "other-user"]) {
      const denied = await app(request("/auth/personal", "POST", {
        username, password: "test-only-password-123",
      }));
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({ error: "invalid_credentials" });
    }
    expect(auth.sessions.size).toBe(0);
    expect((await app(request("/auth/personal", "POST", {
      username: "test-admin", password: "test-only-password-123", role: "admin",
    }))).status).toBe(400);
    const result = await app(request("/auth/personal", "POST", {
      username: "test-admin", password: "test-only-password-123",
    }));
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie")!;
    const session = await (await app(request("/session", "GET", undefined, cookie))).json();
    expect(session).toMatchObject({ username: "test-admin", role: "admin" });
    expect(JSON.stringify(session)).not.toContain("password_hash_ref");
    config.personal!.role = "viewer";
    expect((await (await app(request("/session", "GET", undefined, cookie))).json()).role).toBe("viewer");
    config.personal!.username = "replacement-user";
    expect((await app(request("/session", "GET", undefined, cookie))).status).toBe(403);
  });
  it("never lets an admin bypass scope, CSRF or the owner cancellation contract", async () => {
    const { auth, config } = await setup();
    config.personal!.role = "admin";
    const tasks = new TaskConnections(config);
    const cancel = vi.spyOn(tasks, "cancel");
    const app = createApp(config, { auth, tasks });
    const login = await app(request("/auth/personal", "POST", { password: "test-only-password-123" }));
    const cookie = login.headers.get("set-cookie")!;
    const session = await (await app(request("/session", "GET", undefined, cookie))).json();
    expect((await app(request("/services?scope=not-authorized", "GET", undefined, cookie))).status).toBe(404);
    const payload = { confirm: true, expected_revision: "1", idempotency_key: "test-cancel-identity" };
    expect((await app(request("/tasks/invalid-key/cancel?scope=personal", "POST", payload, cookie))).status).toBe(403);
    expect(cancel).not.toHaveBeenCalled();
    const authorized = request("/tasks/invalid-key/cancel?scope=personal", "POST", payload, cookie);
    authorized.headers.set("X-CSRF-Token", session.csrf);
    expect((await app(authorized)).status).not.toBe(200);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("defaults legacy accounts to viewer without trusting a client role", async () => {
    const { app } = await setup();
    const login = await app(request("/auth/personal", "POST", { password: "test-only-password-123" }));
    const cookie = login.headers.get("set-cookie")!;
    const session = await (await app(request("/session", "GET", undefined, cookie))).json();
    expect(session.role).toBe("viewer");
    const cancel = request("/tasks/anything/cancel?scope=personal", "POST", {
      confirm: true, expected_revision: "1", idempotency_key: "test-cancel-identity",
    }, cookie);
    cancel.headers.set("X-CSRF-Token", session.csrf);
    expect((await app(cancel)).status).toBe(403);
    const logout = request("/auth/logout", "POST", {}, cookie);
    expect((await app(logout)).status).toBe(403);
    logout.headers.set("X-CSRF-Token", session.csrf);
    expect((await app(logout)).status).toBe(200);
    expect((await app(request("/session", "GET", undefined, cookie))).status).toBe(401);
  });
  it("does not expose configured OIDC when personal mode is selected", async () => {
    const { app, config } = await setup();
    config.oidc = { issuer: "https://idp.invalid", clientId: "test" };
    expect((await app(request("/auth/login"))).status).toBe(503);
  });
  it("rejects cross-origin login and throttles failed attempts", async () => {
    const { app } = await setup();
    const r = request("/auth/personal", "POST", { password: "wrong" });
    r.headers.set("Origin", "https://evil.example");
    expect((await app(r)).status).toBe(403);
    for (let i = 0; i < 5; i++)
      expect(
        (await app(request("/auth/personal", "POST", { password: "wrong" })))
          .status,
      ).toBe(401);
    expect(
      (await app(request("/auth/personal", "POST", { password: "wrong" })))
        .status,
    ).toBe(429);
  });
  it("expires idle sessions and revokes them when password changes", async () => {
    const { app, auth, config } = await setup();
    const r = await app(
      request("/auth/personal", "POST", { password: "test-only-password-123" }),
    );
    const cookie = r.headers.get("set-cookie")!;
    const s = [...auth.sessions.values()][0];
    s.last_seen = Date.now() - 31 * 60_000;
    expect(
      (await app(request("/session", "GET", undefined, cookie))).status,
    ).toBe(401);
    const next = await app(
      request("/auth/personal", "POST", { password: "test-only-password-123" }),
    );
    writeFileSync(
      config.personal!.password_hash_ref,
      await hashPassword("replacement-test-password"),
      { mode: 0o600 },
    );
    expect(
      (
        await app(
          request(
            "/session",
            "GET",
            undefined,
            next.headers.get("set-cookie")!,
          ),
        )
      ).status,
    ).toBe(401);
  });
});
