import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryDB } from "../server/db/client";
import { CollaborationService } from "../server/collaboration";
import { isPersonalAdmin } from "../server/credentials";
import { personalAccounts, reminderRecipients } from "../server/personal-accounts";
import { duplicateNames, enabledUsers, findEnabledUser, isEnabledFlag } from "../server/personal-users";
import type { PersonalUser, ServerConfig } from "../server/contracts";
import { password, rewrite, running, signIn, viewer } from "./personal-server.support";

afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);
const entry = (username: string, enabled?: unknown, role: "admin" | "viewer" = "viewer") => ({ username, name: username, role, key_hash_ref: `/not-read/${username}`, scope_ids: ["personal"], ...(enabled === undefined ? {} : { enabled }) }) as unknown as PersonalUser;

describe("one rule for an enabled account", () => {
  it("is enabled only by `true` or by no flag at all", () => {
    for (const on of [true, undefined]) expect(isEnabledFlag(on), String(on)).toBe(true);
    for (const off of [false, "false", "true", "yes", 0, 1, null, "", [], {}]) expect(isEnabledFlag(off), JSON.stringify(off)).toBe(false);
  });

  it("disables every entry of a name that is listed more than once", () => {
    const list = [entry("a"), entry("b", true), entry("a", true), entry("c", "false"), entry("d", null)];
    expect([...duplicateNames(list)]).toEqual(["a"]);
    expect(enabledUsers(list).map((user) => user.username)).toEqual(["b"]);
    expect(findEnabledUser(list, "a")).toBeUndefined();
    expect(findEnabledUser(list, "b")?.username).toBe("b");
    expect(enabledUsers(undefined)).toEqual([]);
  });

  it("is applied by the server's accounts, credentials, reminder recipients and shared projects alike", () => {
    const users = [entry("flag-false", false, "admin"), entry("flag-string", "false", "admin"), entry("flag-zero", 0, "admin"), entry("twice", true, "admin"), entry("twice", true, "admin"), entry("on", true, "admin"), entry("absent", undefined, "admin")];
    const config = { origin: "http://127.0.0.1:4312", port: 4312, owners: {}, auth_mode: "personal", personal: { name: "Owner", username: "head", role: "admin", password_hash_ref: "/x", scope_ids: ["personal"], users },
      principals: [{ issuer: "config", subject: "personal", name: "Owner", scopes: [{ id: "personal", tenant: "t", team: "", project: "p", label: "P", owners: {} }] }] } as unknown as ServerConfig;
    // Accounts that may sign in and receive reminders.
    expect(personalAccounts(config).filter((account) => !account.legacy).map((account) => account.username)).toEqual(["on", "absent"]);
    expect(reminderRecipients(config, "personal").sort()).toEqual(["yeisme:personal|absent", "yeisme:personal|head", "yeisme:personal|on"]);
    // Who counts as a personal administrator.
    const admin = (subject: string) => isPersonalAdmin(config, { personal: true, issuer: "yeisme:personal", subject });
    expect(["on", "absent", "head"].map(admin)).toEqual([true, true, true]);
    expect(["flag-false", "flag-string", "flag-zero", "twice"].map(admin)).toEqual([false, false, false, false]);
    // Who may be offered as a member of a shared project.
    const service = new CollaborationService(createMemoryDB(), config, { principal: () => undefined, sessions: {} } as never);
    const offered = (service as unknown as { knownPrincipals(): { issuer: string; subject: string }[] }).knownPrincipals().filter((principal) => principal.issuer === "yeisme:personal").map((principal) => principal.subject);
    expect(offered).toEqual(["head", "on", "absent"]);
  });

  it("is the only place that decides it: no account code compares an account's flag on its own", () => {
    // (Connections, tools and providers have their own `enabled` and are not accounts.)
    for (const file of ["server/auth.ts", "server/collaboration.ts", "server/credentials.ts", "server/personal-accounts.ts", "scripts/personal-config.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/personal-users/);
      expect(source, file).not.toMatch(/\b(user|users|candidate|account|entry|entries|u)(\[\d+\])?\.enabled\s*[!=]==\s*false/);
    }
  });
});

describe("a running server applies the rule to the file it reads", () => {
  it("signs in an account only while its flag is true or absent, and shows it as disabled otherwise", async () => {
    quiet();
    const { app, auth, file } = await running();
    const key = (await auth.createPersonalUser(viewer("reader"))).access_key;
    const flagged = (flag: unknown) => rewrite(file, (config) => { const user = config.personal.users[0]; if (flag === undefined) delete user.enabled; else user.enabled = flag; });
    const shown = () => auth.listPersonalUsers()[0].enabled;
    for (const off of ["false", 0, null, "no", "true"]) { flagged(off); expect(shown(), JSON.stringify(off)).toBe(false); }
    expect((await signIn(app, "reader", key)).response.status).toBe(401);
    for (const on of [true, undefined]) { flagged(on); expect(shown(), String(on)).toBe(true); expect((await signIn(app, "reader", key)).response.status).toBe(200); }
  });

  it("disables both entries of a repeated name and says so once per version of the file", async () => {
    const warn = quiet();
    const { app, auth, file } = await running();
    const key = (await auth.createPersonalUser(viewer("twin"))).access_key;
    expect((await signIn(app, "twin", key)).response.status).toBe(200);
    rewrite(file, (config) => config.personal.users.push({ ...config.personal.users[0], name: "Second twin" }));
    for (let i = 0; i < 3; i++) expect(auth.listPersonalUsers().map((user) => [user.username, user.enabled])).toEqual([["twin", false], ["twin", false]]);
    expect((await signIn(app, "twin", key)).response.status).toBe(401);
    const duplicates = warn.mock.calls.filter((call) => String(call[0]).includes("listed more than once"));
    expect(duplicates).toHaveLength(1);
    expect(String(duplicates[0][0])).not.toContain("twin");
    // Corrected: one entry left, the account signs in again.
    rewrite(file, (config) => { config.personal.users.pop(); });
    expect((await signIn(app, "twin", key)).response.status).toBe(200);
  });

  it("keeps a revocation pending while any entry of the name is still switched on in the file", async () => {
    const { auth } = await running();
    const settle = (stored: unknown[]) => (auth as unknown as { settleRevocations(list: unknown[]): void }).settleRevocations(stored);
    const pending = () => [...(auth as unknown as { revoked: Set<string> }).revoked];
    (auth as unknown as { revoked: Set<string> }).revoked.add("d");
    settle([entry("d", false), entry("d", true)]);
    expect(pending()).toEqual(["d"]);
    settle([entry("d", false), entry("d", "false")]);
    expect(pending()).toEqual([]);
    (auth as unknown as { revoked: Set<string> }).revoked.add("gone");
    settle([entry("other", true)]);
    expect(pending()).toEqual([]);
  });
});

describe("a reload that fails is logged, once per version of the file, and never fails open silently", () => {
  const reloadWarnings = (warn: ReturnType<typeof quiet>) => warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("account list reload failed"));

  it("logs the code, not the path, once for each bad version, and not again for the same one", async () => {
    const warn = quiet();
    const { auth, file, home } = await running();
    await auth.createPersonalUser(viewer("kept"));
    writeFileSync(file, "{ not json");
    for (let i = 0; i < 4; i++) expect(auth.listPersonalUsers().map((user) => user.username)).toEqual(["kept"]);
    expect(reloadWarnings(warn)).toEqual(["[control-center] account list reload failed: invalid_json"]);
    writeFileSync(file, "{ still not json at all");
    auth.listPersonalUsers();
    expect(reloadWarnings(warn)).toHaveLength(2);
    expect(reloadWarnings(warn).join("\n")).not.toContain(home);
    const parsed = JSON.parse('{"personal":{"name":"Owner","password_hash_ref":"/x","scope_ids":[],"users":"nope"}}');
    writeFileSync(file, JSON.stringify(parsed));
    auth.listPersonalUsers();
    writeFileSync(file, JSON.stringify({ origin: "http://127.0.0.1:4312" }));
    auth.listPersonalUsers();
    expect(reloadWarnings(warn).slice(2)).toEqual(["[control-center] account list reload failed: users_not_a_list", "[control-center] account list reload failed: no_personal_block"]);
  });

  it.skipIf(process.getuid?.() === 0)("names the permission problem when the file is not readable by the server, as after a sudo rewrite", async () => {
    const warn = quiet();
    const { auth, file } = await running();
    await auth.createPersonalUser(viewer("kept"));
    rewrite(file, (config) => { config.personal.users[0].enabled = false; });
    chmodSync(file, 0o000);
    try {
      for (let i = 0; i < 3; i++) auth.listPersonalUsers();
      expect(reloadWarnings(warn)).toEqual(["[control-center] account list reload failed: EACCES"]);
    } finally {
      chmodSync(file, 0o600);
    }
    // Readable again: the file's list is taken, and the warning is not repeated.
    expect(auth.listPersonalUsers()[0].enabled).toBe(false);
    expect(reloadWarnings(warn)).toHaveLength(1);
  });

  it("logs a file that has gone missing by its code, once", async () => {
    const warn = quiet();
    const { auth, file } = await running();
    writeFileSync(file + ".gone", "");
    const missing = join(file + ".missing", "control.json");
    (auth as unknown as { config: ServerConfig }).config.config_file = missing;
    auth.listPersonalUsers();
    auth.listPersonalUsers();
    expect(reloadWarnings(warn)).toEqual(["[control-center] account list reload failed: ENOENT"]);
  });

  it("reads `users: null` as an empty list, so the accounts it held stop working, and logs nothing", async () => {
    const warn = quiet();
    const { app, auth, file } = await running();
    const key = (await auth.createPersonalUser(viewer("reader"))).access_key;
    const session = await signIn(app, "reader", key);
    expect(session.response.status).toBe(200);
    rewrite(file, (config) => { config.personal.users = null; });
    expect(auth.listPersonalUsers()).toEqual([]);
    expect(reloadWarnings(warn)).toEqual([]);
    expect((await app(new Request("http://127.0.0.1:4312/api/control-center/v1/session", { headers: { Origin: "http://127.0.0.1:4312", Cookie: session.cookie } }))).status).toBe(401);
    // The legacy owner is untouched.
    expect((await signIn(app, "root", password)).response.status).toBe(200);
  });
});
