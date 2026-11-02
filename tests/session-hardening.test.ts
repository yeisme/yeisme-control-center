import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SessionAuth } from "../server/auth";
import { hashPassword } from "../server/password";
import { createApp } from "../server/app";
import type { ServerConfig } from "../server/contracts";

const root = mkdtempSync(join(tmpdir(), "yeisme-hardening-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());
const origin = "http://127.0.0.1:4312";
const password = "owner-password-123";

type App = ReturnType<typeof createApp>;
/**
 * A personal-mode server whose configuration file is the one `personal-config` edits, in a directory of its own so a test
 * can make that directory read-only. The administrator is the configuration's own owner account, named `root`.
 */
async function running() {
  const home = mkdtempSync(join(root, "home-"));
  const file = join(home, "control.json");
  const passwordRef = join(home, "owner.password");
  writeFileSync(passwordRef, (await hashPassword(password)) + "\n", { mode: 0o600 });
  const config: ServerConfig = {
    origin,
    port: 4312,
    owners: {},
    auth_mode: "personal",
    personal: { name: "Owner", username: "root", role: "admin", password_hash_ref: passwordRef, scope_ids: ["personal"] },
    principals: [{ issuer: "config", subject: "personal", name: "Owner", scopes: [{ id: "personal", tenant: "personal", team: "", project: "personal", label: "Personal", owners: {} }] }],
  };
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  config.config_file = file;
  const auth = new SessionAuth(config);
  return { home, file, config, auth, app: createApp(config, { auth }) };
}
const call = (app: App, path: string, options: { method?: string; body?: unknown; cookie?: string; csrf?: string } = {}) =>
  app(new Request(origin + "/api/control-center/v1" + path, {
    method: options.method ?? "GET",
    headers: { Origin: origin, ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
const signIn = async (app: App, username: string, key: string) => {
  const response = await call(app, "/auth/personal", { method: "POST", body: { username, key } });
  return { response, cookie: response.headers.get("set-cookie") ?? "" };
};
/** Signs in as the administrator and returns what a state-changing request needs. */
async function asAdmin(app: App) {
  const { cookie } = await signIn(app, "root", password);
  const session = await (await call(app, "/session", { cookie })).json();
  return { cookie, csrf: session.csrf as string };
}
const cli = (...args: string[]) => spawnSync("bun", ["scripts/personal-config.ts", ...args], { encoding: "utf8" });
const stored = (file: string) => JSON.parse(readFileSync(file, "utf8")) as ServerConfig & Record<string, unknown>;
/** Another writer replaces the file the way personal-config does: a temporary file renamed over it. */
const rewrite = (file: string, change: (config: Record<string, any>) => void) => {
  const config = JSON.parse(readFileSync(file, "utf8"));
  change(config);
  const temp = file + ".other.tmp";
  writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, file);
};
const viewer = (username: string) => ({ username, name: username, role: "viewer" as const, scope_ids: ["personal"] });

describe("a running server follows the accounts in the configuration file", () => {
  it("applies add, revoke, enable and rotate from personal-config on the next request, with no restart", async () => {
    const { app, file, home } = await running();
    const keyFile = join(home, "reader.key");
    const added = cli("user", file, "add", "reader", "viewer", "Reader", "--key-file", keyFile);
    expect(added.status, added.stderr).toBe(0);
    expect(JSON.parse(added.stdout)).toMatchObject({ username: "reader", restart_required: false });
    const key = readFileSync(keyFile, "utf8").trim();
    // An account added while the server runs signs in at once.
    const first = await signIn(app, "reader", key);
    expect(first.response.status).toBe(200);
    expect((await call(app, "/session", { cookie: first.cookie })).status).toBe(200);
    // Revoked on disk: the open session ends and the key no longer signs in.
    const revoked = cli("user", file, "revoke", "reader");
    expect(revoked.status, revoked.stderr).toBe(0);
    expect(JSON.parse(revoked.stdout)).toMatchObject({ username: "reader", enabled: false, restart_required: false });
    expect((await call(app, "/session", { cookie: first.cookie })).status).toBe(401);
    expect((await signIn(app, "reader", key)).response.status).toBe(401);
    // Enabled again: the digest was never touched, so the same key works again.
    const enabled = cli("user", file, "enable", "reader");
    expect(JSON.parse(enabled.stdout)).toMatchObject({ username: "reader", enabled: true, changed: true, restart_required: false });
    const back = await signIn(app, "reader", key);
    expect(back.response.status).toBe(200);
    // Rotated: the open session ends, the old key is refused at once and only the new one signs in.
    const fresh = join(home, "reader-2.key");
    const rotated = cli("user", file, "rotate", "reader", "--key-file", fresh);
    expect(JSON.parse(rotated.stdout)).toMatchObject({ rotated: true, sessions_ended: true, restart_required: false });
    expect((await call(app, "/session", { cookie: back.cookie })).status).toBe(401);
    expect((await signIn(app, "reader", key)).response.status).toBe(401);
    expect((await signIn(app, "reader", readFileSync(fresh, "utf8").trim())).response.status).toBe(200);
  });

  it("takes only the account list from the file, and moves live sessions to a new epoch when it changes", async () => {
    const { app, auth, config, file } = await running();
    const { cookie } = await asAdmin(app);
    const epoch = async () => (await (await call(app, "/session", { cookie })).json()).epoch as number;
    const before = await epoch();
    expect(await epoch()).toBe(before);
    rewrite(file, (stored) => {
      stored.observation = { enabled: true, interval_minutes: 15 };
      stored.personal.users = [{ username: "added", name: "Added", role: "viewer", key_hash_ref: join(root, "added.key"), scope_ids: ["personal"], enabled: true }];
    });
    // The account list is the file's; nothing else in memory is.
    expect(auth.listPersonalUsers().map((user) => user.username)).toEqual(["added"]);
    expect(config.observation).toBeUndefined();
    expect(await epoch()).toBe(before + 1);
    expect(await epoch()).toBe(before + 1);
  });

  it("keeps what it has when the file is unreadable or holds no account list, and reads it again once it is fine", async () => {
    const { auth, file } = await running();
    await auth.createPersonalUser(viewer("kept"));
    const names = () => auth.listPersonalUsers().map((user) => user.username);
    const good = readFileSync(file, "utf8");
    writeFileSync(file, "{ not json");
    expect(names()).toEqual(["kept"]);
    const parsed = JSON.parse(good);
    writeFileSync(file, JSON.stringify({ ...parsed, personal: { ...parsed.personal, users: "nope" } }));
    expect(names()).toEqual(["kept"]);
    writeFileSync(file, good);
    rewrite(file, (stored) => stored.personal.users.push({ ...stored.personal.users[0], username: "later" }));
    expect(names()).toEqual(["kept", "later"]);
  });
});

/**
 * Two ways for the save of a revocation to fail while the server itself carries on. A read-only directory is the real
 * case, and does not stop a process running as root, so that variant only runs for everyone else; an unparseable file
 * fails the same save (nothing can be stored) wherever the tests run.
 */
const failures = [
  { name: "the file cannot be read", skip: false, fail: (_home: string, file: string) => { const good = readFileSync(file); writeFileSync(file, "{ not json"); return () => writeFileSync(file, good); } },
  { name: "the directory is read-only", skip: process.getuid?.() === 0, fail: (home: string) => { chmodSync(home, 0o500); return () => chmodSync(home, 0o700); } },
];

describe.each(failures)("a revocation made through the server is never undone when $name", ({ skip, fail }) => {
  /** Runs the body while saving fails, and always puts things back. */
  const failing = async (home: string, file: string, body: () => unknown) => {
    const restore = fail(home, file);
    try { return await body(); } finally { restore(); }
  };

  it.skipIf(skip)("stays revoked through a later successful write, which also stores it", async () => {
    const { app, auth, file, home } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    const session = await signIn(app, "reader", reader.access_key);
    expect(session.response.status).toBe(200);
    await failing(home, file, () => expect(auth.revokePersonalUser("reader")).rejects.toThrow(/user_management_unavailable/));
    expect((await call(app, "/session", { cookie: session.cookie })).status).toBe(401);
    expect((await signIn(app, "reader", reader.access_key)).response.status).toBe(401);
    // The failed save left the file saying enabled. A later create rebuilds the list from that file.
    expect(stored(file).personal?.users?.find((user) => user.username === "reader")?.enabled).toBe(true);
    await auth.createPersonalUser(viewer("second"));
    expect((await signIn(app, "reader", reader.access_key)).response.status).toBe(401);
    expect(auth.listPersonalUsers().find((user) => user.username === "reader")?.enabled).toBe(false);
    expect(stored(file).personal?.users?.find((user) => user.username === "reader")?.enabled).toBe(false);
  });

  it.skipIf(skip)("stays revoked when the file is replaced by another writer that still lists the account as enabled", async () => {
    const { app, auth, home, file } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    await failing(home, file, () => expect(auth.revokePersonalUser("reader")).rejects.toThrow(/user_management_unavailable/));
    rewrite(file, (config) => config.personal.users.push({ username: "other", name: "Other", role: "viewer", key_hash_ref: join(root, "other.key"), scope_ids: ["personal"], enabled: true }));
    expect((await signIn(app, "reader", reader.access_key)).response.status).toBe(401);
    expect(auth.listPersonalUsers().map((user) => [user.username, user.enabled])).toEqual([["reader", false], ["other", true]]);
  });

  it.skipIf(skip)("hands the decision back to the file once another writer has revoked the account too", async () => {
    const { app, auth, home, file } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    await failing(home, file, () => expect(auth.revokePersonalUser("reader")).rejects.toThrow(/user_management_unavailable/));
    // personal-config revokes it for real; the next request sees a file that holds the revocation, so it is no longer pending.
    expect(cli("user", file, "revoke", "reader").status).toBe(0);
    expect((await signIn(app, "reader", reader.access_key)).response.status).toBe(401);
    // Enabling it afterwards is then honoured, which a revocation that stayed pending would not allow.
    expect(cli("user", file, "enable", "reader").status).toBe(0);
    expect((await signIn(app, "reader", reader.access_key)).response.status).toBe(200);
  });
});

describe("a revocation that was stored", () => {
  it("lets the file decide again once it holds the revocation, so personal-config can enable the account", async () => {
    const { app, auth, file } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    await auth.revokePersonalUser("reader");
    expect(stored(file).personal?.users?.[0]?.enabled).toBe(false);
    const enabled = cli("user", file, "enable", "reader");
    expect(enabled.status, enabled.stderr).toBe(0);
    expect((await signIn(app, "reader", reader.access_key)).response.status).toBe(200);
  });
});

describe("account routes are matched exactly", () => {
  const create = { username: "mallory", name: "Mallory", role: "admin", scope_ids: ["personal"] };

  it("revokes through the revoke route whatever the body says", async () => {
    const { app, auth, file } = await running();
    await auth.createPersonalUser(viewer("one"));
    await auth.createPersonalUser(viewer("two"));
    const { cookie, csrf } = await asAdmin(app);
    // No body at all, as a browser or curl would send it.
    const bare = await call(app, "/admin/personal-users/one/revoke", { method: "POST", cookie, csrf });
    expect(bare.status).toBe(200);
    expect(await bare.json()).toEqual({ ok: true });
    // An empty object, and a body shaped like a new account: both are ignored.
    expect((await call(app, "/admin/personal-users/two/revoke", { method: "POST", cookie, csrf, body: {} })).status).toBe(200);
    expect(stored(file).personal?.users?.map((user) => [user.username, user.enabled])).toEqual([["one", false], ["two", false]]);
  });

  it("never creates an account from a body sent to the revoke route", async () => {
    const { app, auth, file, home } = await running();
    const { cookie, csrf } = await asAdmin(app);
    const response = await call(app, "/admin/personal-users/ghost/revoke", { method: "POST", cookie, csrf, body: create });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("user_not_found");
    expect(auth.listPersonalUsers()).toEqual([]);
    expect(stored(file).personal?.users).toBeUndefined();
    expect(existsSync(join(home, "control.json.users"))).toBe(false);
  });

  it("still creates through the collection route, once", async () => {
    const { app, file } = await running();
    const { cookie, csrf } = await asAdmin(app);
    const created = await call(app, "/admin/personal-users", { method: "POST", cookie, csrf, body: create });
    expect(created.status).toBe(201);
    expect((await created.json()).access_key).toMatch(/^yk_live_/);
    expect(stored(file).personal?.users?.map((user) => user.username)).toEqual(["mallory"]);
    expect((await call(app, "/admin/personal-users", { method: "POST", cookie, csrf, body: create })).status).toBe(409);
    const listed = await (await call(app, "/admin/personal-users", { cookie })).json();
    expect(listed.users.map((user: { username: string }) => user.username)).toEqual(["mallory"]);
  });

  it("answers every other account path with the right refusal, and needs an administrator first", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    const { cookie, csrf } = await asAdmin(app);
    const status = async (path: string, method: string) => (await call(app, path, { method, cookie, csrf, body: method === "POST" ? {} : undefined })).status;
    expect(await status("/admin/personal-users/reader", "GET")).toBe(404);
    expect(await status("/admin/personal-users/reader", "POST")).toBe(404);
    expect(await status("/admin/personal-users/reader/revoke/extra", "POST")).toBe(404);
    expect(await status("/admin/personal-users/reader/other", "POST")).toBe(404);
    expect(await status("/admin/personal-users/reader/revoke", "GET")).toBe(405);
    expect(await status("/admin/personal-users", "DELETE")).toBe(405);
    // A viewer is refused before the route is looked at.
    const member = await signIn(app, "reader", reader.access_key);
    const session = await (await call(app, "/session", { cookie: member.cookie })).json();
    for (const path of ["/admin/personal-users", "/admin/personal-users/reader/revoke", "/admin/personal-users/nothing"])
      expect((await call(app, path, { method: "POST", cookie: member.cookie, csrf: session.csrf, body: {} })).status, path).toBe(403);
  });
});

describe("bad client input is a 400 and not a 503", () => {
  it("rejects a malformed percent-escape in any path parameter", async () => {
    const { app } = await running();
    const { cookie, csrf } = await asAdmin(app);
    for (const [method, path] of [
      ["GET", "/projects/%E0%A4%A"],
      ["GET", "/projects/%ZZ/items/x/task"],
      ["GET", "/projects/p/generation-batches/%ZZ"],
      ["GET", "/tasks/%ZZ?scope=personal"],
      ["GET", "/organizations/%ZZ/members"],
      ["GET", "/auctra/collection/records/%ZZ?scope=personal"],
      ["GET", "/actions/receipts/%ZZ?scope=personal"],
      ["GET", "/provider-runs/%ZZ?scope=personal"],
      ["GET", "/requests/eikona/%ZZ?scope=personal"],
      ["GET", "/requests/eikona/%ZZ/observations?scope=personal"],
      ["POST", "/notifications/%ZZ/read?scope=personal"],
      ["POST", "/notifications/%ZZ/acknowledge?scope=personal"],
      ["POST", "/notifications/mute-rules/%ZZ/remove?scope=personal"],
      ["POST", "/tasks/%ZZ/artifacts/a/access?scope=personal"],
      ["POST", "/requests/eikona/%ZZ/content:read?scope=personal"],
      ["POST", "/requests/eikona/x/attachments/%ZZ/content:read?scope=personal"],
      ["POST", "/admin/personal-users/%ZZ/revoke"],
    ] as const) {
      // Valid in every other way, so the escape is the only thing wrong with the request.
      const body = path.includes("/artifacts/") ? { purpose: "preview" } : { purpose: "inspection", direction: "input" };
      const response = await call(app, path, { method, cookie, csrf, body: method === "POST" ? body : undefined });
      expect(response.status, `${method} ${path}`).toBe(400);
      expect((await response.json()).error, `${method} ${path}`).toBe("invalid_request");
    }
  });

  it("rejects a JSON body that is not an object", async () => {
    const { app } = await running();
    const { cookie, csrf } = await asAdmin(app);
    for (const [path, error] of [
      ["/requests/eikona/r1/content:read?scope=personal", "invalid_content_request"],
      ["/requests/eikona/r1/attachments/a1/content:read?scope=personal", "invalid_content_request"],
      ["/auctra/collection/sync?scope=personal", "invalid_request"],
    ] as const)
      for (const body of [null, [], "text", 7]) {
        const response = await call(app, path, { method: "POST", cookie, csrf, body });
        expect(response.status, `${path} ${JSON.stringify(body)}`).toBe(400);
        expect((await response.json()).error).toBe(error);
      }
  });

  it("answers two creates of one username with a created account and a 409", async () => {
    const { app, auth } = await running();
    const settled = await Promise.allSettled([auth.createPersonalUser(viewer("twin")), auth.createPersonalUser(viewer("twin"))]);
    expect(settled.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "user_exists", status: 409 });
    const { cookie, csrf } = await asAdmin(app);
    const create = { username: "twin-2", name: "Twin", role: "viewer", scope_ids: ["personal"] };
    const both = await Promise.all([1, 2].map(() => call(app, "/admin/personal-users", { method: "POST", cookie, csrf, body: create })));
    expect(both.map((response) => response.status).sort()).toEqual([201, 409]);
  });
});

describe("personal sessions and the clock", () => {
  const start = Date.parse("2026-11-02T08:00:00Z");
  const at = (minutes: number) => vi.setSystemTime(start + minutes * 60_000);
  const clock = () => { vi.useFakeTimers({ toFake: ["Date"] }); at(0); };

  it("ends a session 30 idle minutes after its last request, not 30 minutes after sign-in", async () => {
    const { app, auth } = await running();
    clock();
    const { cookie } = await signIn(app, "root", password);
    const id = auth.sessions.keys()[0];
    const status = async () => (await call(app, "/session", { cookie })).status;
    at(20);
    expect(await status()).toBe(200);
    // Thirty-five minutes after sign-in, but only fifteen after the last request.
    at(35);
    expect(await status()).toBe(200);
    at(55);
    expect(await status()).toBe(200);
    expect(auth.sessions.get(id)?.last_seen).toBe(start + 55 * 60_000);
    at(55 + 31);
    expect(await status()).toBe(401);
    expect(auth.sessions.get(id)).toBeUndefined();
  });

  it("writes the last-seen time at most once a minute", async () => {
    const { app, auth } = await running();
    clock();
    const { cookie } = await signIn(app, "root", password);
    const id = auth.sessions.keys()[0];
    const seen = () => auth.sessions.get(id)?.last_seen;
    expect(seen()).toBe(start);
    at(0.5);
    await call(app, "/session", { cookie });
    expect(seen()).toBe(start);
    at(1);
    await call(app, "/session", { cookie });
    expect(seen()).toBe(start + 60_000);
    at(1.5);
    await call(app, "/session", { cookie });
    expect(seen()).toBe(start + 60_000);
  });

  it("still ends every session at its absolute expiry, however active it is", async () => {
    const { app } = await running();
    clock();
    const { cookie } = await signIn(app, "root", password);
    // Busy enough never to be idle: a request every twenty minutes for almost twelve hours.
    for (let minute = 20; minute <= 11 * 60 + 40; minute += 20) {
      at(minute);
      expect((await call(app, "/session", { cookie })).status, `minute ${minute}`).toBe(200);
    }
    at(12 * 60 + 1);
    expect((await call(app, "/session", { cookie })).status).toBe(401);
  });
});

describe("the sign-in limit", () => {
  it("counts failed sign-ins only: successful ones never use it up", async () => {
    const { app } = await running();
    for (let i = 0; i < 7; i++) expect((await signIn(app, "root", password)).response.status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await signIn(app, "root", "wrong-password-123")).response.status).toBe(401);
    const limited = await signIn(app, "root", "wrong-password-123");
    expect(limited.response.status).toBe(429);
    expect((await limited.response.json()).error).toBe("login_rate_limited");
    // The limit is global and holds even for the right password until the failures are 15 minutes old.
    expect((await signIn(app, "root", password)).response.status).toBe(429);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 15 * 60_000 + 1000);
    expect((await signIn(app, "root", password)).response.status).toBe(200);
  });

  it("tells a sign-in that overlaps another apart from one that hit the limit", async () => {
    const { app } = await running();
    const [one, two] = await Promise.all([signIn(app, "root", password), signIn(app, "root", password)]);
    expect([one.response.status, two.response.status].sort()).toEqual([200, 429]);
    const busy = [one, two].find((attempt) => attempt.response.status === 429)!;
    expect((await busy.response.json()).error).toBe("login_busy");
    // Nothing was counted as a failure: the next sign-in goes through.
    expect((await signIn(app, "root", password)).response.status).toBe(200);
  });

  it("does not count a server-side credential problem as a guess", async () => {
    const { app, config } = await running();
    const ref = config.personal!.password_hash_ref;
    const good = readFileSync(ref, "utf8");
    rmSync(ref);
    for (let i = 0; i < 6; i++) expect((await signIn(app, "root", password)).response.status).toBe(503);
    writeFileSync(ref, good, { mode: 0o600 });
    expect((await signIn(app, "root", password)).response.status).toBe(200);
  });
});

describe("session epochs", () => {
  it("start above every earlier session's, so a tab holding an older one notices a new sign-in", async () => {
    const { app, auth } = await running();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-02T08:00:00Z"));
    const epochOf = async (cookie: string) => (await (await call(app, "/session", { cookie })).json()).epoch as number;
    // Two sign-ins in the same millisecond still differ.
    const first = await epochOf((await signIn(app, "root", password)).cookie);
    const second = await epochOf((await signIn(app, "root", password)).cookie);
    expect(second).toBeGreaterThan(first);
    // A permission change moves live sessions up, and the next sign-in starts above that too.
    auth.sessions.bumpAll();
    auth.sessions.bumpAll();
    const bumped = Math.max(...[...auth.sessions.values()].map((session) => session.epoch));
    expect(await epochOf((await signIn(app, "root", password)).cookie)).toBeGreaterThan(bumped);
    // Sign-ins later in time start above sign-ins earlier in time even when nothing is left to compare with.
    for (const session of [...auth.sessions.values()]) auth.sessions.delete(session.id);
    vi.setSystemTime(Date.parse("2026-11-02T09:00:00Z"));
    expect(await epochOf((await signIn(app, "root", password)).cookie)).toBeGreaterThan(bumped);
  });
});

describe("account creation is not offered through actions", () => {
  const request = { scope_id: "personal", owner: "control-center", target_kind: "personal_user", target_ref: "user:new", action: "admin.user.create", expected_revision: "0", idempotency_key: "create_user_0000000001", input: { username: "new", name: "New", role: "viewer", scope_ids: ["personal"] } };

  it("lists it as unavailable with a reason that names the command, and keeps revoke available", async () => {
    const { app } = await running();
    const { cookie } = await asAdmin(app);
    const listed = await (await call(app, "/actions?scope=personal&owner=control-center", { cookie })).json();
    const find = (action: string) => listed.actions.find((entry: { action: string }) => entry.action === action);
    expect(find("admin.user.create")).toMatchObject({ availability: "unavailable", reason: expect.stringMatching(/personal-config[\s\S]*--key-file/) });
    expect(find("admin.user.create").reason).toMatch(/[一-鿿]/);
    expect(find("admin.user.revoke")).toMatchObject({ availability: "available" });
  });

  it("refuses the preview with a 4xx and creates no account and no key", async () => {
    const { app, auth, file, home } = await running();
    const { cookie, csrf } = await asAdmin(app);
    const response = await call(app, "/actions/preview?scope=personal", { method: "POST", cookie, csrf, body: request });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "action_unavailable", class: "invalid" });
    expect(auth.listPersonalUsers()).toEqual([]);
    expect(stored(file).personal?.users).toBeUndefined();
    expect(existsSync(join(home, "control.json.users"))).toBe(false);
  });

  it("still previews and confirms a revoke", async () => {
    const { app, auth } = await running();
    await auth.createPersonalUser(viewer("gone"));
    const { cookie, csrf } = await asAdmin(app);
    const revoke = { ...request, action: "admin.user.revoke", target_ref: "user:gone", idempotency_key: "revoke_user_000000001", input: { username: "gone" } };
    const made = await (await call(app, "/actions/preview?scope=personal", { method: "POST", cookie, csrf, body: revoke })).json();
    expect(made.availability).toBe("available");
    const done = await call(app, "/actions/confirm?scope=personal", { method: "POST", cookie, csrf, body: { scope_id: "personal", preview_ref: made.preview_ref, preview_digest: made.preview_digest, idempotency_key: revoke.idempotency_key } });
    expect(done.status).toBe(202);
    expect(await done.json()).toMatchObject({ state: "succeeded", owner_state: "revoked" });
    expect(auth.listPersonalUsers().find((user) => user.username === "gone")?.enabled).toBe(false);
  });
});
