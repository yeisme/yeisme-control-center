import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionAuth } from "../server/auth";
import { createApp } from "../server/app";
import { hashPassword } from "../server/password";
import type { ServerConfig } from "../server/contracts";
import { accountPatch, accountStatus, accountStatusCounts, draftProblem, takenUsernames, visibleAccounts } from "../src/shared/accounts";
import { adminTabFor, adminTabsFor } from "../src/shared/admin-tabs";
import { accountError } from "../src/shared/account-errors";
import type { PersonalUserView } from "../src/shared/api/control-center-client";

const dir = mkdtempSync(join(tmpdir(), "yeisme-accounts-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const origin = "http://127.0.0.1:4318";
const ownerKey = "owner-only-test-key-123";

/** A server whose account list lives in a 0600 file, signed in as the configuration's owner (an admin with a username). */
async function server(options: { manage?: boolean; ownerUsername?: string | null } = {}) {
  const home = mkdtempSync(join(dir, "server-"));
  const ownerRef = join(home, "owner.key");
  writeFileSync(ownerRef, (await hashPassword(ownerKey)) + "\n", { mode: 0o600 });
  const scope = (id: string, label: string) => ({ id, tenant: "studio", team: "", project: id, label, owners: {} });
  const config: ServerConfig = {
    origin,
    port: 4318,
    owners: {},
    auth_mode: "personal",
    personal: {
      name: "Owner",
      ...(options.ownerUsername === null ? {} : { username: options.ownerUsername ?? "owner-admin" }),
      role: "admin",
      password_hash_ref: ownerRef,
      scope_ids: ["rain", "coast"],
      users: [],
      ...(options.manage === false ? { web_accounts: { manage: false } } : {}),
    },
    principals: [{ issuer: "config", subject: "owner", name: "Owner", scopes: [scope("rain", "雨夜重逢"), scope("coast", "海岸来信")] }],
  };
  const file = join(home, "control-center.json");
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  config.config_file = file;
  const auth = new SessionAuth(config);
  const app = createApp(config, { auth });
  const call = async (path: string, init: { method?: string; body?: unknown; who?: Who; csrf?: boolean } = {}) => app(new Request(origin + "/api/control-center/v1" + path, {
    method: init.method || "GET",
    headers: { Origin: origin, "Content-Type": "application/json", ...(init.who ? { Cookie: init.who.cookie } : {}), ...(init.who && init.csrf !== false ? { "X-CSRF-Token": init.who.csrf } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
  const signIn = async (username: string | undefined, key: string): Promise<Who | number> => {
    const response = await call("/auth/personal", { method: "POST", body: { ...(username ? { username } : {}), key } });
    if (response.status !== 200) return response.status;
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const session = await (await app(new Request(origin + "/api/control-center/v1/session", { headers: { Origin: origin, Cookie: cookie } }))).json() as { csrf: string };
    return { cookie, csrf: session.csrf };
  };
  const signedIn = async (username: string | undefined, key: string) => {
    const who = await signIn(username, key);
    if (typeof who === "number") throw new Error(`sign-in refused: ${who}`);
    return who;
  };
  const sessionStatus = async (who: Who) => (await call("/session", { who })).status;
  const stored = () => JSON.parse(readFileSync(file, "utf8")) as ServerConfig;
  const audit = async (who: Who, query = "") => (await (await call(`/audit?limit=100${query}`, { who })).json()) as { rows: { action: string; outcome: string; actor: string; target_ref?: string; error_code?: string }[] };
  return { app, auth, config, file, call, signIn, signedIn, sessionStatus, stored, audit };
}
type Who = { cookie: string; csrf: string };

describe("web account management", () => {
  it("lists accounts with a version, the owner as command-line only, and the scopes an account can be given", async () => {
    const { call, signedIn } = await server();
    const admin = await signedIn("owner-admin", ownerKey);
    const listed = await call("/admin/personal-users", { who: admin });
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.users).toEqual([]);
    expect(body.management).toEqual({ enabled: true, reason: null, legacy_owner: { username: "owner-admin", name: "Owner", role: "admin" }, needs_owner_username: false });
    expect(body.scopes.map((scope: { id: string }) => scope.id)).toEqual(["rain", "coast"]);
  });

  it("creates an account whose key is shown once and stored only as a 0600 digest", async () => {
    const { call, signedIn, stored, file, audit } = await server();
    const admin = await signedIn("owner-admin", ownerKey);
    const created = await call("/admin/personal-users", { method: "POST", who: admin, body: { username: "lin.zhou", name: "林舟", role: "viewer", scope_ids: ["rain"] } });
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toContain("no-store");
    const { access_key, user } = await created.json();
    expect(access_key).toMatch(/^yk_live_/);
    expect(user).toMatchObject({ username: "lin.zhou", name: "林舟", role: "viewer", scope_ids: ["rain"], enabled: true });
    const entry = stored().personal!.users![0]!;
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(entry.key_hash_ref).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain(access_key);
    expect(readFileSync(entry.key_hash_ref, "utf8")).not.toContain(access_key);
    expect(JSON.stringify(await audit(admin))).not.toContain(access_key);
    expect((await audit(admin, "&action=admin.user_created")).rows).toMatchObject([{ action: "admin.user_created", outcome: "succeeded", target_ref: "lin.zhou" }]);
    // The owner's own username cannot be taken: an account of that name would stand in front of the owner.
    const shadow = await call("/admin/personal-users", { method: "POST", who: admin, body: { username: "owner-admin", name: "Shadow", role: "admin", scope_ids: ["rain"] } });
    expect(shadow.status).toBe(409);
    expect((await shadow.json()).error).toBe("user_exists");
  });

  it("refuses the first account while the owner has no username, because the owner could not sign in afterwards", async () => {
    const { call, signedIn } = await server({ ownerUsername: null });
    const admin = await signedIn(undefined, ownerKey);
    expect((await (await call("/admin/personal-users", { who: admin })).json()).management.needs_owner_username).toBe(true);
    const refused = await call("/admin/personal-users", { method: "POST", who: admin, body: { username: "lin.zhou", name: "林舟", role: "viewer", scope_ids: ["rain"] } });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("owner_username_required");
  });

  it("an administrator's reset ends the account's sessions at once and only the new key signs in", async () => {
    const { auth, call, signIn, signedIn, sessionStatus, stored, audit } = await server();
    const admin = await signedIn("owner-admin", ownerKey);
    const { access_key: first } = await auth.createPersonalUser({ username: "lin.zhou", name: "林舟", role: "viewer", scope_ids: ["rain"] });
    const lin = await signedIn("lin.zhou", first);
    expect(await sessionStatus(lin)).toBe(200);
    const rotated = await call("/admin/personal-users/lin.zhou/rotate", { method: "POST", who: admin, body: {} });
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get("cache-control")).toContain("no-store");
    const { access_key: second } = await rotated.json();
    expect(second).toMatch(/^yk_live_/);
    expect(second).not.toBe(first);
    expect(await sessionStatus(lin)).toBe(401);
    expect(await signIn("lin.zhou", first)).toBe(401);
    expect(typeof await signIn("lin.zhou", second)).toBe("object");
    const entry = stored().personal!.users![0]!;
    expect(entry.key_rotated_at).toMatch(/^\d{4}-/);
    expect(statSync(entry.key_hash_ref).mode & 0o777).toBe(0o600);
    expect((await audit(admin, "&action=admin.user_rotated")).rows).toMatchObject([{ outcome: "succeeded", target_ref: "lin.zhou" }]);
    expect(JSON.stringify(await audit(admin))).not.toContain(second);
  });

  it("disabling signs the person out, enabling lets the same key back in, and a name listed twice stays off", async () => {
    const { auth, call, signIn, signedIn, sessionStatus, file, stored } = await server();
    const admin = await signedIn("owner-admin", ownerKey);
    const { access_key } = await auth.createPersonalUser({ username: "lin.zhou", name: "林舟", role: "viewer", scope_ids: ["rain"] });
    const lin = await signedIn("lin.zhou", access_key);
    expect((await call("/admin/personal-users/lin.zhou/revoke", { method: "POST", who: admin, body: {} })).status).toBe(200);
    expect(await sessionStatus(lin)).toBe(401);
    expect(await signIn("lin.zhou", access_key)).toBe(401);
    expect((await call("/admin/personal-users/lin.zhou/enable", { method: "POST", who: admin, body: {} })).status).toBe(200);
    expect(stored().personal!.users![0]!.enabled).toBe(true);
    expect(typeof await signIn("lin.zhou", access_key)).toBe("object");
    // A second entry of the name (a hand edit): both are off, and enabling is refused until the file is corrected.
    const edited = stored();
    edited.personal!.users = [...edited.personal!.users!, { ...edited.personal!.users![0]!, name: "林舟 2" }];
    writeFileSync(file, JSON.stringify(edited, null, 2) + "\n", { mode: 0o600 });
    const listed = await (await call("/admin/personal-users", { who: admin })).json();
    expect(listed.users.map((user: PersonalUserView) => [user.duplicate, user.enabled])).toEqual([[true, false], [true, false]]);
    const refused = await call("/admin/personal-users/lin.zhou/enable", { method: "POST", who: admin, body: {} });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("user_duplicate");
  });

  it("an edit carries the version it read: a change made meanwhile is refused, and the last admin keeps the role", async () => {
    const { auth, call, signedIn, stored } = await server();
    const admin = await signedIn("owner-admin", ownerKey);
    await auth.createPersonalUser({ username: "lin.zhou", name: "林舟", role: "admin", scope_ids: ["rain"] });
    const read = async () => (await (await call("/admin/personal-users", { who: admin })).json()).users[0] as PersonalUserView;
    const before = await read();
    const saved = await call("/admin/personal-users/lin.zhou", { method: "PATCH", who: admin, body: { name: "林舟 · 剪辑", scope_ids: ["rain", "coast"], if_match: before.version } });
    expect(saved.status).toBe(200);
    expect((await saved.json()).user).toMatchObject({ name: "林舟 · 剪辑", scope_ids: ["rain", "coast"] });
    expect(stored().personal!.users![0]).toMatchObject({ name: "林舟 · 剪辑", scope_ids: ["rain", "coast"], role: "admin" });
    const stale = await call("/admin/personal-users/lin.zhou", { method: "PATCH", who: admin, body: { name: "又改一次", if_match: before.version } });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("user_changed");
    const unknownScope = await call("/admin/personal-users/lin.zhou", { method: "PATCH", who: admin, body: { scope_ids: ["elsewhere"], if_match: (await read()).version } });
    expect(unknownScope.status).toBe(404);
    expect((await unknownScope.json()).error).toBe("scope_not_found");
    // The owner is an admin too, so lin.zhou may become a viewer; the owner itself is the command line's to change.
    expect((await call("/admin/personal-users/lin.zhou", { method: "PATCH", who: admin, body: { role: "viewer", if_match: (await read()).version } })).status).toBe(200);
    for (const [method, path, body] of [["PATCH", "/admin/personal-users/owner-admin", { name: "x", if_match: "0" }], ["POST", "/admin/personal-users/owner-admin/rotate", {}], ["POST", "/admin/personal-users/owner-admin/revoke", {}]] as const) {
      const response = await call(path, { method, who: admin, body });
      expect(response.status, path).toBe(409);
      expect((await response.json()).error, path).toBe("legacy_owner_managed_by_cli");
    }
  });

  it("never leaves the server without an enabled admin, and an admin cannot disable itself", async () => {
    const { auth, config, call, signedIn } = await server({ ownerUsername: "owner-admin" });
    // The owner becomes a viewer by hand: lin.zhou is then the only admin.
    config.personal!.role = "viewer";
    const { access_key } = await auth.createPersonalUser({ username: "lin.zhou", name: "林舟", role: "admin", scope_ids: ["rain"] });
    const lin = await signedIn("lin.zhou", access_key);
    const read = async () => (await (await call("/admin/personal-users", { who: lin })).json()).users[0] as PersonalUserView;
    const demote = await call("/admin/personal-users/lin.zhou", { method: "PATCH", who: lin, body: { role: "viewer", if_match: (await read()).version } });
    expect(demote.status).toBe(409);
    expect((await demote.json()).error).toBe("last_admin_required");
    const self = await call("/admin/personal-users/lin.zhou/revoke", { method: "POST", who: lin, body: {} });
    expect(self.status).toBe(409);
    expect((await self.json()).error).toBe("cannot_revoke_self");
  });
});

describe("resetting one's own key", () => {
  it("needs the current key, ends the person's other sessions, keeps this one until it signs out, and only the new key signs in", async () => {
    const { auth, call, signIn, signedIn, sessionStatus, audit } = await server();
    const admin = await signedIn("owner-admin", ownerKey);
    const { access_key: first } = await auth.createPersonalUser({ username: "lin.zhou", name: "林舟", role: "viewer", scope_ids: ["rain"] });
    const here = await signedIn("lin.zhou", first);
    const elsewhere = await signedIn("lin.zhou", first);
    expect((await (await call("/session", { who: here })).json()).own_key).toBe("available");
    const wrong = await call("/account/rotate-key", { method: "POST", who: here, body: { current_key: "yk_live_not-the-key" } });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe("invalid_credentials");
    expect(await sessionStatus(here)).toBe(200);
    expect((await call("/account/rotate-key", { method: "POST", who: here, body: { current_key: first, username: "owner-admin" } })).status).toBe(400);
    expect((await call("/account/rotate-key", { method: "POST", who: here, csrf: false, body: { current_key: first } })).status).toBe(403);
    const rotated = await call("/account/rotate-key", { method: "POST", who: here, body: { current_key: first } });
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get("cache-control")).toContain("no-store");
    const { access_key: second } = await rotated.json();
    expect(second).not.toBe(first);
    // The page that shows the new key is not signed out under it; every other session of the account ends now.
    expect(await sessionStatus(here)).toBe(200);
    expect(await sessionStatus(elsewhere)).toBe(401);
    expect(await signIn("lin.zhou", first)).toBe(401);
    expect(typeof await signIn("lin.zhou", second)).toBe("object");
    // Newest first: the reset, and before it the refused try with a wrong key. A malformed body or a missing token is refused
    // before anything is recorded.
    const rows = (await audit(admin, "&action=account.key_rotated")).rows;
    expect(rows.map((row) => [row.outcome, row.error_code || null, row.target_ref])).toEqual([["succeeded", null, "lin.zhou"], ["denied", "invalid_credentials", "lin.zhou"]]);
    expect(JSON.stringify(await audit(admin))).not.toContain(second);
  });

  it("is the command line's for the configuration's owner, and refused while web management is switched off", async () => {
    const owner = await server();
    const admin = await owner.signedIn("owner-admin", ownerKey);
    expect((await (await owner.call("/session", { who: admin })).json()).own_key).toBe("legacy_owner_managed_by_cli");
    const refused = await owner.call("/account/rotate-key", { method: "POST", who: admin, body: { current_key: ownerKey } });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("legacy_owner_managed_by_cli");

    const off = await server({ manage: false });
    await expect(off.auth.createPersonalUser({ username: "lin.zhou", name: "林舟", role: "viewer", scope_ids: ["rain"] })).rejects.toMatchObject({ code: "web_account_management_disabled", status: 403 });
    const offAdmin = await off.signedIn("owner-admin", ownerKey);
    const management = (await (await off.call("/admin/personal-users", { who: offAdmin })).json()).management;
    expect(management).toMatchObject({ enabled: false, reason: "web_account_management_disabled" });
    for (const [method, path, body] of [["POST", "/admin/personal-users", { username: "a.b", name: "A", role: "viewer", scope_ids: ["rain"] }], ["POST", "/admin/personal-users/a.b/rotate", {}], ["POST", "/admin/personal-users/a.b/enable", {}], ["PATCH", "/admin/personal-users/a.b", { name: "x", if_match: "0" }]] as const) {
      const response = await off.call(path, { method, who: offAdmin, body });
      expect(response.status, path).toBe(403);
      expect((await response.json()).error, path).toBe("web_account_management_disabled");
    }
    expect((await (await off.call("/session", { who: offAdmin })).json()).own_key).toBe("web_account_management_disabled");
  });
});

describe("who may manage accounts", () => {
  it("refuses a viewer every account route, before reading what it sent", async () => {
    const { auth, call, signedIn } = await server();
    const { access_key } = await auth.createPersonalUser({ username: "reader", name: "Reader", role: "viewer", scope_ids: ["rain"] });
    const reader = await signedIn("reader", access_key);
    for (const [method, path] of [["GET", "/admin/personal-users"], ["POST", "/admin/personal-users"], ["POST", "/admin/personal-users/reader/rotate"], ["POST", "/admin/personal-users/reader/enable"], ["POST", "/admin/personal-users/reader/revoke"], ["PATCH", "/admin/personal-users/reader"], ["GET", "/audit"]] as const) {
      const response = await call(path, { method, who: reader, body: method === "GET" ? undefined : { name: "x" } });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("filters the audit log by outcome, actor and day, and refuses a malformed day", async () => {
    const { auth, call, signedIn, audit } = await server();
    const admin = await signedIn("owner-admin", ownerKey);
    await auth.createPersonalUser({ username: "lin.zhou", name: "林舟", role: "viewer", scope_ids: ["rain"] });
    await call("/admin/personal-users/nobody/rotate", { method: "POST", who: admin, body: {} });
    await call("/admin/personal-users/lin.zhou/revoke", { method: "POST", who: admin, body: {} });
    const failed = (await audit(admin, "&outcome=failed")).rows;
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((row) => row.outcome === "failed")).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await audit(admin, `&from=${today}&to=${today}`)).rows.length).toBeGreaterThan(0);
    expect((await audit(admin, `&from=${tomorrow}`)).rows).toEqual([]);
    const actor = (await audit(admin, "&action=admin.user_revoked")).rows[0]!.actor;
    expect((await audit(admin, `&actor=${encodeURIComponent(actor)}`)).rows.every((row) => row.actor === actor)).toBe(true);
    expect((await call("/audit?from=yesterday", { who: admin })).status).toBe(400);
    expect((await call("/audit?outcome=maybe", { who: admin })).status).toBe(400);
  });
});

describe("account rules on the page", () => {
  const user = (username: string, extra: Partial<PersonalUserView> = {}): PersonalUserView => ({ username, name: username.toUpperCase(), role: "viewer", scope_ids: ["rain"], enabled: true, version: "v1", ...extra });

  it("checks a draft before it can be saved", () => {
    const draft = { username: "lin.zhou", name: "林舟", role: "viewer" as const, scope_ids: ["rain"] };
    expect(draftProblem(draft, [], true)).toBeNull();
    expect(draftProblem({ ...draft, username: ".lin" }, [], true)).toMatch(/字母或数字开头/);
    expect(draftProblem({ ...draft, username: "林舟" }, [], true)).toMatch(/字母、数字/);
    expect(draftProblem(draft, ["lin.zhou"], true)).toBe("这个用户名已经有了");
    // Editing never looks at the username, which cannot change.
    expect(draftProblem(draft, ["lin.zhou"], false)).toBeNull();
    expect(draftProblem({ ...draft, name: "  " }, [], true)).toMatch(/显示名/);
    expect(draftProblem({ ...draft, scope_ids: [] }, [], true)).toMatch(/范围/);
  });

  it("reads status, counts and the search the way the list shows them", () => {
    const users = [user("lin.zhou"), user("an.yu", { enabled: false }), user("twice", { enabled: false, duplicate: true }), user("coast.only", { scope_ids: ["coast"] })];
    expect(users.map(accountStatus)).toEqual(["active", "disabled", "duplicate", "active"]);
    expect(accountStatusCounts(users)).toEqual({ all: 4, active: 2, disabled: 1, duplicate: 1 });
    expect(visibleAccounts(users, "active", "").map((entry) => entry.username)).toEqual(["lin.zhou", "coast.only"]);
    expect(visibleAccounts(users, "all", "coast").map((entry) => entry.username)).toEqual(["coast.only"]);
    expect(visibleAccounts(users, "all", "LIN").map((entry) => entry.username)).toEqual(["lin.zhou"]);
    expect(takenUsernames(users, { enabled: true, reason: null, legacy_owner: { username: "owner-admin", name: "Owner", role: "admin" } })).toContain("owner-admin");
  });

  it("sends only what an edit changed", () => {
    const stored = user("lin.zhou", { name: "林舟", scope_ids: ["rain", "coast"] });
    expect(accountPatch({ username: "lin.zhou", name: "林舟 ", role: "viewer", scope_ids: ["coast", "rain"] }, stored)).toEqual({});
    expect(accountPatch({ username: "lin.zhou", name: "林舟 · 剪辑", role: "admin", scope_ids: ["rain"] }, stored)).toEqual({ name: "林舟 · 剪辑", role: "admin", scope_ids: ["rain"] });
  });

  it("opens the tab a visit asks for, and only the tabs the person may see", () => {
    expect(adminTabsFor(true)).toEqual(["accounts", "organizations", "members", "audit"]);
    expect(adminTabsFor(false)).toEqual(["organizations", "members"]);
    expect(adminTabFor(null, "admin", adminTabsFor(true))).toBe("accounts");
    expect(adminTabFor(null, "audit", adminTabsFor(true))).toBe("audit");
    expect(adminTabFor(null, "members", adminTabsFor(true))).toBe("members");
    expect(adminTabFor("collaboration", "team", adminTabsFor(true))).toBe("organizations");
    // A viewer who follows an audit link lands on what it may see.
    expect(adminTabFor("audit", "admin", adminTabsFor(false))).toBe("organizations");
    expect(adminTabFor(null, "audit", adminTabsFor(false))).toBe("organizations");
  });

  it("says why the server refused in words, and names an unknown code", () => {
    expect(accountError("last_admin_required")).toMatch(/管理员/);
    expect(accountError("owner_username_required")).toMatch(/personal-config account <配置文件>/);
    expect(accountError("something_new")).toBe("没有完成（错误码 something_new）。");
  });
});
