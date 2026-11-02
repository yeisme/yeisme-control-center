import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { hashPassword } from "../server/password";
import type { ServerConfig } from "../server/contracts";
import { loadProbeCredentials, probeUsernameEnv, readbackVerdict, runLiveReadback, type ReadbackResult } from "../scripts/live-readback";

const dir = mkdtempSync(join(tmpdir(), "live-readback-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const origin = "http://127.0.0.1:4312";
const prefix = "/api/control-center/v1";
const viewerKey = "yk_live_" + "v".repeat(43);
const adminKey = "yk_live_" + "a".repeat(43);

/** The real application behind a fetch: a viewer, an admin, and the ordinary personal scope. */
async function running() {
  const digest = async (name: string, key: string) => {
    const file = join(dir, name + "-" + crypto.randomUUID());
    writeFileSync(file, (await hashPassword(key)) + "\n", { mode: 0o600 });
    return file;
  };
  const config: ServerConfig = {
    origin, port: 4312, owners: {}, auth_mode: "personal",
    personal: {
      name: "Owner", password_hash_ref: await digest("owner", "owner-test-only-password"), scope_ids: ["personal"],
      users: [
        { username: "probe", name: "Probe", role: "viewer", key_hash_ref: await digest("probe", viewerKey), scope_ids: ["personal"], enabled: true },
        { username: "boss", name: "Boss", role: "admin", key_hash_ref: await digest("boss", adminKey), scope_ids: ["personal"], enabled: true },
      ],
    },
    principals: [{ issuer: "config", subject: "owner", name: "Owner", scopes: [{ id: "personal", tenant: "personal", team: "", project: "p", label: "Personal", owners: {} }] }],
  };
  const app = createApp(config, { auth: new SessionAuth(config) });
  const seen: { method: string; path: string }[] = [];
  const base = async (url: string, init?: RequestInit) => {
    seen.push({ method: init?.method ?? "GET", path: new URL(url).pathname.slice(prefix.length) });
    return app(new Request(url, init));
  };
  return { base, seen };
}
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Answers selected paths itself and lets the real application answer the rest. */
const override = (inner: Fetch, answer: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined): Fetch =>
  async (url, init) => (await answer(new URL(url).pathname.slice(prefix.length), init)) ?? inner(url, init);
const state = (result: ReadbackResult, name: string) => result.checks.find((check) => check.name === name)?.state;

describe("probe credentials", () => {
  const file = (content: string, mode = 0o600) => {
    const path = join(dir, "probe-" + crypto.randomUUID());
    writeFileSync(path, content, { mode });
    chmodSync(path, mode);
    return path;
  };
  it("reads the key alone with the username from the environment, or JSON with both", () => {
    expect(loadProbeCredentials(file(viewerKey + "\n"), { [probeUsernameEnv]: "probe" })).toEqual({ username: "probe", key: viewerKey });
    expect(loadProbeCredentials(file(JSON.stringify({ username: "probe", key: viewerKey })), {})).toEqual({ username: "probe", key: viewerKey });
    // The output of `personal-config.ts user add` can be saved as the probe file as it is.
    expect(loadProbeCredentials(file(JSON.stringify({ username: "probe", name: "Probe", role: "viewer", access_key: viewerKey, shown_once: true })), {})).toEqual({ username: "probe", key: viewerKey });
    expect(loadProbeCredentials(file(JSON.stringify({ username: "from-file", key: viewerKey })), { [probeUsernameEnv]: "from-env" }).username).toBe("from-env");
  });
  it("refuses a missing, loose, or incomplete file with a code that never contains the key", () => {
    const code = (path: string, env: Record<string, string | undefined> = {}) => { try { loadProbeCredentials(path, env); } catch (error) { return (error as Error).message; } return "no error"; };
    expect(code(join(dir, "does-not-exist"))).toBe("probe_file_missing");
    expect(code(file(viewerKey, 0o644), { [probeUsernameEnv]: "probe" })).toBe("probe_file_permissions_invalid");
    expect(code(file(viewerKey, 0o660), { [probeUsernameEnv]: "probe" })).toBe("probe_file_permissions_invalid");
    expect(code(file(viewerKey))).toBe("probe_username_missing");
    expect(code(file(viewerKey), { [probeUsernameEnv]: "bad name!" })).toBe("probe_username_invalid");
    expect(code(file("short"), { [probeUsernameEnv]: "probe" })).toBe("probe_key_invalid");
    expect(code(file("two words in one line"), { [probeUsernameEnv]: "probe" })).toBe("probe_key_invalid");
    expect(code(file('{ "username": "probe", "key": '), {})).toBe("probe_file_invalid");
    expect(code(file(JSON.stringify({ username: "probe" })), {})).toBe("probe_key_invalid");
    expect(code(dir, { [probeUsernameEnv]: "probe" })).toBe("probe_file_permissions_invalid");
    for (const path of [file(viewerKey, 0o644), file("x" + viewerKey + " y")]) expect(code(path, { [probeUsernameEnv]: "probe" })).not.toContain(viewerKey);
  });
});

describe("authenticated read-back", () => {
  it("passes for a viewer against the real application, with one login, and closes its session", async () => {
    const { base, seen } = await running();
    const result = await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: base });
    expect(result.checks.map((check) => `${check.name}:${check.state}`).filter((entry) => !entry.startsWith("observation_status"))).toEqual([
      "login:passed", "session_is_viewer:passed", "services_without_secrets:passed", "notifications_readable:passed",
      "admin_users_refused:passed", "audit_refused:passed", "admin_action_refused:passed", "logout:passed", "session_closed:passed",
    ]);
    // The observation route may not exist yet in the release under test: absent is not a failure.
    expect(["absent", "passed"]).toContain(state(result, "observation_status"));
    expect(result).toMatchObject({ status: "passed", server_error: false, login_attempts: 1, login_status: 200, transport: "http", loopback: true });
    expect(result.failure).toBeUndefined();
    expect(seen.filter((entry) => entry.path === "/auth/personal")).toHaveLength(1);
    // Without observe=1, so no owner is asked anything.
    expect(seen.find((entry) => entry.path === "/services")).toBeDefined();
    expect(JSON.stringify(seen)).not.toContain("observe=1");
    expect(seen.at(-1)).toEqual({ method: "GET", path: "/session" });
  });

  it("keeps the key, the cookie and the address out of the result", async () => {
    const { base } = await running();
    const result = await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: base });
    const text = JSON.stringify(result);
    for (const secret of [viewerKey, "yeisme_session", "yk_live", "127.0.0.1", "4312", "csrf"]) expect(text, secret).not.toContain(secret);
  });

  it("fails for an account that is not a viewer, and still signs out", async () => {
    const { base, seen } = await running();
    const result = await runLiveReadback({ origin, credentials: { username: "boss", key: adminKey }, fetchImpl: base });
    expect(result.status).toBe("failed");
    expect(result.failure).toBe("check_failed:session_is_viewer");
    expect(result.checks.find((check) => check.name === "session_is_viewer")).toMatchObject({ state: "failed", reason: "role_is_not_viewer" });
    // An admin is not refused the admin routes, so the refusal checks fail too: the account is the wrong kind of verifier.
    expect(state(result, "admin_users_refused")).toBe("failed");
    expect(state(result, "logout")).toBe("passed");
    expect(seen.filter((entry) => entry.path === "/auth/personal")).toHaveLength(1);
  });

  it("stops after the one login when it is refused, and says why", async () => {
    const { base, seen } = await running();
    const wrong = await runLiveReadback({ origin, credentials: { username: "probe", key: "yk_live_" + "x".repeat(43) }, fetchImpl: base });
    expect(wrong).toMatchObject({ status: "failed", failure: "login_unauthorized", login_attempts: 1, login_status: 401, server_error: false });
    expect(seen).toHaveLength(1);
    const counted: string[] = [];
    const fixed = (status: number): Fetch => async (url) => { counted.push(url); return new Response("{}", { status }); };
    expect(await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: fixed(429) })).toMatchObject({ failure: "login_rate_limited", login_status: 429, server_error: false });
    expect(await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: fixed(403) })).toMatchObject({ failure: "login_forbidden", server_error: false });
    expect(await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: fixed(503) })).toMatchObject({ failure: "login_server_error", login_status: 503, server_error: true });
    expect(await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: fixed(200) })).toMatchObject({ failure: "login_no_session", server_error: false });
    // One request each, never a retry.
    expect(counted).toHaveLength(4);
    const down = await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: async () => { throw new TypeError("fetch failed: ECONNREFUSED"); } });
    expect(down).toMatchObject({ status: "failed", failure: "login_unreachable", login_attempts: 1, server_error: false });
    const tls = await runLiveReadback({ origin: "https://control.example.test", credentials: { username: "probe", key: viewerKey }, fetchImpl: async () => { throw new Error("unable to verify the first certificate"); } });
    expect(tls).toMatchObject({ failure: "login_tls", transport: "https", loopback: false });
    const slow = await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, timeoutMs: 20, fetchImpl: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))) });
    expect(slow).toMatchObject({ failure: "login_timeout", server_error: false });
  });

  it("fails when services show a credential reference or a home directory", async () => {
    const { base } = await running();
    for (const [leak, reason] of [['{"credential_ref":"x"}', "leaks:credential_ref"], ['{"path":"/home/a/.config/key"}', "leaks:home_path"], ['{"key_hash_ref":"x"}', "leaks:hash_ref"]] as const) {
      const result = await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: override(base, (path) => (path.startsWith("/services") ? new Response(leak, { status: 200 }) : undefined)) });
      expect(result.status).toBe("failed");
      expect(result.checks.find((check) => check.name === "services_without_secrets")).toMatchObject({ state: "failed", reason });
      expect(result.server_error).toBe(false);
    }
  });

  it("fails when a viewer is let into an admin route or an admin action, and when a read is refused", async () => {
    const { base } = await running();
    const credentials = { username: "probe", key: viewerKey };
    for (const [path, check] of [["/audit", "audit_refused"], ["/admin/personal-users", "admin_users_refused"], ["/actions/preview", "admin_action_refused"]] as const) {
      const result = await runLiveReadback({ origin, credentials, fetchImpl: override(base, (requested) => (requested.startsWith(path) ? new Response("{}", { status: path === "/actions/preview" ? 200 : 200 }) : undefined)) });
      expect(result.checks.find((entry) => entry.name === check), path).toMatchObject({ state: "failed", http_status: 200 });
      expect(result.status).toBe("failed");
    }
    const unreadable = await runLiveReadback({ origin, credentials, fetchImpl: override(base, (path) => (path.startsWith("/notifications") ? new Response("{}", { status: 403 }) : undefined)) });
    expect(unreadable.checks.find((check) => check.name === "notifications_readable")).toMatchObject({ state: "failed", http_status: 403 });
  });

  it("treats a missing observation route as absent, an answering one as passed, and anything else as a failure", async () => {
    const { base } = await running();
    const credentials = { username: "probe", key: viewerKey };
    const answer = (status: number) => override(base, (path) => (path.startsWith("/observation/status") ? new Response("{}", { status }) : undefined));
    const absent = await runLiveReadback({ origin, credentials, fetchImpl: answer(404) });
    expect(state(absent, "observation_status")).toBe("absent");
    expect(absent.status).toBe("passed");
    expect(state(await runLiveReadback({ origin, credentials, fetchImpl: answer(200) }), "observation_status")).toBe("passed");
    const refused = await runLiveReadback({ origin, credentials, fetchImpl: answer(403) });
    expect(refused.checks.find((check) => check.name === "observation_status")).toMatchObject({ state: "failed", http_status: 403 });
  });

  it("reports a server error on any later request, so the release can be rolled back", async () => {
    const { base } = await running();
    const result = await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: override(base, (path) => (path.startsWith("/notifications") ? new Response("{}", { status: 502 }) : undefined)) });
    expect(result).toMatchObject({ status: "failed", server_error: true, failure: "check_failed:notifications_readable" });
    // It still looked at everything else and signed out.
    expect(state(result, "logout")).toBe("passed");
  });

  it("fails when the session is still usable after logout", async () => {
    const { base } = await running();
    const result = await runLiveReadback({ origin, credentials: { username: "probe", key: viewerKey }, fetchImpl: override(base, (path, init) => (path === "/auth/logout" && init?.method === "POST" ? new Response("{}", { status: 200 }) : undefined)) });
    expect(state(result, "logout")).toBe("passed");
    expect(result.checks.find((check) => check.name === "session_closed")).toMatchObject({ state: "failed", http_status: 200 });
  });
});

describe("what a release does with a read-back", () => {
  const credentials = { username: "probe", key: viewerKey };
  const fixed = (status: number): Fetch => async () => new Response("{}", { status });

  it("rolls back on a 5xx alone, wherever it happens", async () => {
    const { base } = await running();
    // The service itself failing: at login, or on a later read.
    expect(readbackVerdict(await runLiveReadback({ origin, credentials, fetchImpl: fixed(503) }))).toEqual({ authenticated_read: false, rollback: true, failure: "login_server_error" });
    const later = await runLiveReadback({ origin, credentials, fetchImpl: override(base, (path) => (path.startsWith("/services") ? new Response("{}", { status: 500 }) : undefined)) });
    expect(readbackVerdict(later)).toMatchObject({ authenticated_read: false, rollback: true });
  });

  it("marks the read-back failed without a rollback for a refused or limited login, and for any other failed check", async () => {
    const { base } = await running();
    expect(readbackVerdict(await runLiveReadback({ origin, credentials, fetchImpl: fixed(401) }))).toEqual({ authenticated_read: false, rollback: false, failure: "login_unauthorized" });
    expect(readbackVerdict(await runLiveReadback({ origin, credentials, fetchImpl: fixed(429) }))).toEqual({ authenticated_read: false, rollback: false, failure: "login_rate_limited" });
    expect(readbackVerdict(await runLiveReadback({ origin, credentials, fetchImpl: async () => { throw new TypeError("fetch failed"); } }))).toEqual({ authenticated_read: false, rollback: false, failure: "login_unreachable" });
    const notViewer = await runLiveReadback({ origin, credentials: { username: "boss", key: adminKey }, fetchImpl: base });
    expect(readbackVerdict(notViewer)).toEqual({ authenticated_read: false, rollback: false, failure: "check_failed:session_is_viewer" });
  });

  it("records a clean pass as verified and never as a rollback", async () => {
    const { base } = await running();
    expect(readbackVerdict(await runLiveReadback({ origin, credentials, fetchImpl: base }))).toEqual({ authenticated_read: true, rollback: false });
  });
});

