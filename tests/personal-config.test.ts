import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkPassword } from "../server/password";

const dir = mkdtempSync(join(tmpdir(), "control-config-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const run = (...args: string[]) => spawnSync("bun", ["scripts/personal-config.ts", ...args], { encoding: "utf8" });
describe("personal configuration CLI", () => {
  it("creates a named admin without storing a password or granting owner rights", () => {
    const file = join(dir, "new.json");
    expect(run("init", file, "https://control.example.test", "test-admin").status).toBe(0);
    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(config.personal).toMatchObject({ username: "test-admin", role: "admin" });
    expect(config.connections).toEqual([]);
    expect(config.owners).toEqual({});
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(run("init", file, "https://control.example.test", "replacement").status).not.toBe(0);
    expect(run("account", file, "replacement", "admin").status).not.toBe(0);
    expect(run("account", file, "test-admin", "viewer").status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).personal.role).toBe("viewer");
  });
  it("upgrades an unnamed local binding explicitly and leaves owner connections empty", () => {
    const file = join(dir, "legacy.json");
    expect(run("init", file).status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).personal.role).toBe("viewer");
    expect(run("account", file, "legacy-admin", "admin").status).toBe(0);
    const status = run("status", file);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ username: "legacy-admin", role: "admin", password_configured: false, connections: [] });
  });
  it("rejects unsafe origins and malformed account identifiers before writing", () => {
    for (const origin of ["http://control.example.test", "http://control.example.test:51874", "ftp://localhost", "https://control.example.test/path", "https://name:pass@control.example.test"]) {
      expect(run("init", join(dir, "unsafe.json"), origin, "test-admin").status).not.toBe(0);
    }
    expect(run("init", join(dir, "local.json"), "http://127.0.0.1:4312", "test-admin").status).toBe(0);
    expect(run("init", join(dir, "bad-user.json"), "https://control.example.test", "bad user").status).not.toBe(0);
  });
  it("toggles local content preference and reports it without secrets", () => {
    const file = join(dir, "content.json");
    expect(run("init", file).status).toBe(0);
    expect(run("connect", file, "e", "eikona", "http://127.0.0.1:1234/mcp", "p", join(dir, "credential"), "--private-http").status).toBe(0);
    writeFileSync(join(dir, "credential"), "secret");
    const before = JSON.parse(readFileSync(file, "utf8"));
    const enabled = run("content", file, "e", "on");
    expect(enabled.status).toBe(0);
    expect(enabled.stdout).toContain("owner authorization is unchanged");
    expect(enabled.stdout).toContain("Restart to reload");
    before.connections[0].allow_content = true;
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(before);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const status = run("status", file);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout).connections).toEqual([
      { id: "e", owner: "eikona", project: "p", enabled: true, content_requested: true, credential_configured: true },
    ]);
    expect(status.stdout).not.toContain("secret");
    expect(status.stdout).not.toContain(join(dir, "credential"));
    expect(status.stdout).not.toContain("http://127.0.0.1:1234/mcp");
    expect(run("content", file, "e", "off").status).toBe(0);
    expect(JSON.parse(run("status", file).stdout).connections[0].content_requested).toBe(false);
  });
  it("rejects invalid content changes without rewriting configuration", () => {
    const file = join(dir, "invalid-content.json");
    expect(run("init", file).status).toBe(0);
    expect(run("connect", file, "e", "eikona", "https://owner.example.test/mcp", "p", join(dir, "missing-credential"), "--content").status).toBe(0);
    expect(JSON.parse(run("status", file).stdout).connections[0]).toMatchObject({ enabled: true, content_requested: true });
    const before = readFileSync(file, "utf8");
    const inode = statSync(file).ino;
    for (const args of [["e", "yes"], ["e", "ON"], ["missing", "on"], ["e"], ["e", "off", "extra"]]) {
      expect(run("content", file, ...args).status).not.toBe(0);
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(statSync(file).ino).toBe(inode);
    }
    const invalidOwner = JSON.parse(before);
    invalidOwner.connections[0].owner = "other";
    const invalid = JSON.stringify(invalidOwner);
    writeFileSync(file, invalid);
    expect(run("content", file, "e", "off").status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(invalid);
  });
});
describe("personal configuration CLI: Auctra collection", () => {
  it("registers the Auctra origin, project and both keys for the personal scope, without a network call", () => {
    const file = join(dir, "auctra.json");
    expect(run("init", file, "http://127.0.0.1:4312", "test-admin").status).toBe(0);
    const collector = join(dir, "collector.key"), reader = join(dir, "reader.key");
    writeFileSync(collector, "auctra-ak-collector\n", { mode: 0o600 });
    writeFileSync(reader, "auctra-ak-reader\n", { mode: 0o600 });
    const added = run("auctra", file, "https://auctra.example.test", "project:rain", collector, reader);
    expect(added.status).toBe(0);
    expect(JSON.parse(added.stdout)).toMatchObject({ project: "project:rain", collector_key_configured: true, reader_key_configured: true, network_called: false });
    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(config.collection.auctra).toEqual({ origin: "https://auctra.example.test", audience: "auctra", credential_ref: collector, flow_credential_ref: reader, enabled: true });
    expect(config.principals[0].scopes[0].collection.auctra).toEqual({ tenant: "project:rain", project: "project:rain", actor: "personal", audience: "auctra" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const status = run("status", file);
    expect(JSON.parse(status.stdout).auctra).toEqual({ origin_configured: true, enabled: true, project: "project:rain", collector_key_configured: true, reader_key_configured: true });
    for (const leaked of ["auctra-ak-collector", "auctra-ak-reader", "https://auctra.example.test", collector]) expect(status.stdout).not.toContain(leaked);
  });
  it("refuses unsafe input and an accidental replacement without rewriting configuration", () => {
    const file = join(dir, "auctra-reject.json");
    expect(run("init", file, "http://127.0.0.1:4312", "test-admin").status).toBe(0);
    const key = join(dir, "only.key"), loose = join(dir, "loose.key");
    writeFileSync(key, "k\n", { mode: 0o600 });
    writeFileSync(loose, "k\n", { mode: 0o644 });
    const before = readFileSync(file, "utf8");
    for (const args of [["http://auctra.example.test", "project:a", key], ["https://auctra.example.test", "rain", key], ["https://auctra.example.test", "project:a", loose], ["https://auctra.example.test", "project:a", join(dir, "missing.key")], ["https://auctra.example.test", "project:a"]]) {
      expect(run("auctra", file, ...args).status).not.toBe(0);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(run("auctra", file, "https://auctra.example.test", "project:a", key).status).toBe(0);
    expect(run("auctra", file, "https://auctra.example.test", "project:b", key).status).not.toBe(0);
    expect(run("auctra", file, "https://auctra.example.test", "project:b", key, "--replace").status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).collection.auctra.flow_credential_ref).toBeUndefined();
  });
  it("registers a read-only open tool for the personal scope without its address or credential in status", () => {
    const file = join(dir, "open-tool.json");
    expect(run("init", file).status).toBe(0);
    const key = join(dir, "open-tool.key");
    writeFileSync(key, "open-tool-secret", { mode: 0o644 });
    expect(run("open-tool", file, "drivebridge", "https://drive.example.test", key).status).not.toBe(0);
    chmodSync(key, 0o600);
    expect(run("open-tool", file, "ftp-tool", "https://drive.example.test", key).status).not.toBe(0);
    expect(run("open-tool", file, "drivebridge", "http://drive.example.test", key).status).not.toBe(0);
    expect(run("open-tool", file, "drivebridge", "http://127.0.0.1:8080", key).status).not.toBe(0);
    expect(run("open-tool", file, "drivebridge", "http://127.0.0.1:8080", key, "--private-http").status).toBe(0);
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", key).status).toBe(0);
    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(config.open_tools.drivebridge).toEqual({ endpoint: "http://127.0.0.1:8080", credential_ref: key, allow_private_http: true, enabled: true });
    expect(config.principals[0].scopes[0].open_tools).toEqual(["drivebridge", "gateway"]);
    expect(run("open-tool", file, "gateway", "https://other.example.test", key).status).not.toBe(0);
    expect(run("open-tool", file, "gateway", "https://other.example.test", key, "--replace").status).toBe(0);
    const status = run("status", file);
    expect(JSON.parse(status.stdout).open_tools).toEqual({ drivebridge: { enabled: true, private_http: true, credential_configured: true }, gateway: { enabled: true, private_http: false, credential_configured: true } });
    for (const hidden of ["open-tool-secret", key, "127.0.0.1:8080", "other.example.test"]) expect(status.stdout).not.toContain(hidden);
    expect(run("open-tool", file, "gateway", "off").status).toBe(0);
    const off = JSON.parse(readFileSync(file, "utf8"));
    expect(off.open_tools.gateway.enabled).toBe(false);
    expect(off.principals[0].scopes[0].open_tools).toEqual(["drivebridge"]);
  });
  it("connects Anatomia without pinning a delegated-read project and never allows cancelling it", () => {
    const file = join(dir, "anatomia.json");
    expect(run("init", file).status).toBe(0);
    const key = join(dir, "anatomia.key");
    writeFileSync(key, "anatomia-observer", { mode: 0o600 });
    expect(run("connect", file, "anatomia-main", "anatomia", "https://anatomia.example.test/mcp", "project:rain", key).status).toBe(0);
    expect(run("content", file, "anatomia-main", "on").status).toBe(0);
    expect(run("cancel", file, "anatomia-main", "on").status).not.toBe(0);
    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(config.connections[0]).toMatchObject({ id: "anatomia-main", owner: "anatomia", project: "project:rain", allow_content: true, allow_cancel: false });
    expect(config.principals[0].scopes[0].connection_ids).toEqual(["anatomia-main"]);
    expect(config.principals[0].scopes[0].owners.anatomia).toBeUndefined();
  });
});

describe("personal configuration CLI: accounts", () => {
  const init = (name: string) => {
    const file = join(dir, name);
    expect(run("init", file, "http://127.0.0.1:4312", "test-admin").status).toBe(0);
    return file;
  };
  const users = (file: string) => JSON.parse(readFileSync(file, "utf8")).personal.users as { username: string; enabled?: boolean; key_hash_ref: string }[];
  const keyOf = (file: string) => readFileSync(file, "utf8").trim();

  it("writes a new account's one-time key to a new private file and keeps it off the screen", async () => {
    const file = init("keyfile.json");
    const keyFile = join(dir, "account-reader.key");
    const added = run("user", file, "add", "reader", "viewer", "Reader", "--key-file", keyFile);
    expect(added.status, added.stderr).toBe(0);
    const key = keyOf(keyFile);
    expect(key).toMatch(/^yk_live_[A-Za-z0-9_-]{40,}$/);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(added.stdout).not.toContain(key);
    expect(JSON.parse(added.stdout)).toMatchObject({ username: "reader", role: "viewer", key_file: keyFile, shown_once: false });
    expect(JSON.parse(added.stdout).access_key).toBeUndefined();
    const [account] = users(file);
    expect(account).toMatchObject({ username: "reader", enabled: true });
    expect(statSync(account.key_hash_ref).mode & 0o777).toBe(0o600);
    expect(await checkPassword(key, readFileSync(account.key_hash_ref, "utf8").trim())).toBe(true);
    // The digest and the key are different things: the file holds no key.
    expect(readFileSync(file, "utf8")).not.toContain(key);
    expect(readFileSync(account.key_hash_ref, "utf8")).not.toContain(key);
  });

  it("refuses an existing key file, or a missing value, before it writes anything", () => {
    const file = init("keyfile-refuse.json");
    const keyFile = join(dir, "taken.key");
    writeFileSync(keyFile, "someone-elses-file\n", { mode: 0o600 });
    const before = readFileSync(file, "utf8");
    const refused = run("user", file, "add", "reader", "viewer", "Reader", "--key-file", keyFile);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("refusing overwrite");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readFileSync(keyFile, "utf8")).toBe("someone-elses-file\n");
    expect(existsSync(file + ".users") ? readdirSync(file + ".users") : []).toEqual([]);
    for (const args of [["add", "reader", "viewer", "Reader", "--key-file"], ["add", "reader", "viewer", "Reader", "--key-file", "--other"], ["revoke", "reader", "--key-file", join(dir, "n.key")], ["add", "reader", "viewer", "Reader", "--unknown"]])
      expect(run("user", file, ...args).status, args.join(" ")).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("keeps printing the key once when no key file is given, and accepts the action before the file", () => {
    const file = init("print-once.json");
    const added = run("user", "add", file, "printed", "viewer", "Printed");
    expect(added.status, added.stderr).toBe(0);
    expect(JSON.parse(added.stdout)).toMatchObject({ username: "printed", shown_once: true, access_key: expect.stringMatching(/^yk_live_/) });
    expect(run("user", file, "add", "printed", "viewer", "Again").status).not.toBe(0);
  });

  it("rotates a key into a new file: the old key stops matching, the new one matches, the configuration is untouched", async () => {
    const file = init("rotate.json");
    const first = join(dir, "rotate-first.key");
    expect(run("user", file, "add", "rotated", "viewer", "Rotated", "--key-file", first).status).toBe(0);
    const digestFile = users(file)[0].key_hash_ref;
    const digestBefore = readFileSync(digestFile, "utf8");
    const configBefore = readFileSync(file, "utf8");
    const second = join(dir, "rotate-second.key");
    const rotated = run("user", file, "rotate", "rotated", "--key-file", second);
    expect(rotated.status, rotated.stderr).toBe(0);
    expect(JSON.parse(rotated.stdout)).toMatchObject({ username: "rotated", rotated: true, sessions_ended: true, key_file: second });
    expect(rotated.stdout).not.toContain(keyOf(second));
    expect(statSync(second).mode & 0o777).toBe(0o600);
    expect(statSync(digestFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(digestFile, "utf8")).not.toBe(digestBefore);
    expect(await checkPassword(keyOf(first), readFileSync(digestFile, "utf8").trim())).toBe(false);
    expect(await checkPassword(keyOf(second), readFileSync(digestFile, "utf8").trim())).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(configBefore);
    expect(readdirSync(join(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    // Printed once when no file is given.
    const printed = run("user", file, "rotate", "rotated");
    expect(printed.status).toBe(0);
    const { access_key } = JSON.parse(printed.stdout);
    expect(await checkPassword(access_key, readFileSync(digestFile, "utf8").trim())).toBe(true);
  });

  it("refuses to rotate an unknown account or into an existing file, and changes nothing", () => {
    const file = init("rotate-refuse.json");
    expect(run("user", file, "add", "kept", "viewer", "Kept", "--key-file", join(dir, "kept.key")).status).toBe(0);
    const digestFile = users(file)[0].key_hash_ref;
    const before = readFileSync(digestFile, "utf8");
    const taken = join(dir, "rotate-taken.key");
    writeFileSync(taken, "taken\n", { mode: 0o600 });
    expect(run("user", file, "rotate", "kept", "--key-file", taken).status).not.toBe(0);
    expect(run("user", file, "rotate", "nobody", "--key-file", join(dir, "nobody.key")).status).not.toBe(0);
    expect(run("user", file, "rotate").status).not.toBe(0);
    expect(run("user", file, "rotate", "kept", "extra", "--key-file", join(dir, "extra.key")).status).not.toBe(0);
    expect(readFileSync(digestFile, "utf8")).toBe(before);
    expect(existsSync(join(dir, "nobody.key"))).toBe(false);
    expect(readFileSync(taken, "utf8")).toBe("taken\n");
  });

  it("re-enables a revoked account, which cannot be added again", () => {
    const file = init("enable.json");
    expect(run("user", file, "add", "returning", "viewer", "Returning", "--key-file", join(dir, "returning.key")).status).toBe(0);
    expect(run("user", file, "revoke", "returning").status).toBe(0);
    expect(users(file)[0].enabled).toBe(false);
    expect(run("user", file, "add", "returning", "viewer", "Returning").status).not.toBe(0);
    const enabled = run("user", file, "enable", "returning");
    expect(enabled.status, enabled.stderr).toBe(0);
    expect(JSON.parse(enabled.stdout)).toMatchObject({ username: "returning", enabled: true, changed: true, key_unchanged: true });
    expect(users(file)[0].enabled).toBe(true);
    expect(JSON.parse(run("user", file, "list").stdout)[0]).toMatchObject({ username: "returning", enabled: true });
    // Enabling an account that is already enabled changes nothing and rewrites nothing.
    const before = readFileSync(file, "utf8");
    expect(JSON.parse(run("user", file, "enable", "returning").stdout)).toEqual({ username: "returning", enabled: true, changed: false });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(run("user", file, "enable", "nobody").status).not.toBe(0);
    expect(run("user", file, "enable").status).not.toBe(0);
  });
});

describe("personal configuration CLI: observation", () => {
  const observation = (file: string) => JSON.parse(readFileSync(file, "utf8")).observation;
  it("turns server-side observation on with its defaults, off again without losing the settings, and reports it in status", () => {
    const file = join(dir, "observe.json");
    expect(run("init", file).status).toBe(0);
    expect(observation(file)).toBeUndefined();
    const on = run("observe", file, "on");
    expect(on.status, on.stderr).toBe(0);
    expect(observation(file)).toEqual({ enabled: true, interval_minutes: 10, open_tools_every: 3 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(run("observe", file, "on", "--interval-minutes", "15", "--open-tools-every", "2", "--recipients", "yeisme:personal|test-admin,config|personal").status).toBe(0);
    expect(observation(file)).toEqual({ enabled: true, interval_minutes: 15, open_tools_every: 2, recipients: ["yeisme:personal|test-admin", "config|personal"] });
    expect(run("observe", file, "off").status).toBe(0);
    expect(observation(file)).toMatchObject({ enabled: false, interval_minutes: 15, open_tools_every: 2 });
    // Turning it back on without flags keeps what was chosen; `default` returns the recipients to every enabled admin.
    expect(run("observe", file, "on").status).toBe(0);
    expect(observation(file)).toMatchObject({ enabled: true, interval_minutes: 15, recipients: ["yeisme:personal|test-admin", "config|personal"] });
    expect(run("observe", file, "on", "--recipients", "default").status).toBe(0);
    expect(observation(file).recipients).toBeUndefined();
    expect(JSON.parse(run("status", file).stdout).observation).toEqual({ enabled: true, interval_minutes: 15, open_tools_every: 2, recipients: "default" });
  });

  it("rejects out-of-range or malformed settings without rewriting the configuration", () => {
    const file = join(dir, "observe-reject.json");
    expect(run("init", file).status).toBe(0);
    expect(run("observe", file, "on").status).toBe(0);
    const before = readFileSync(file, "utf8");
    const inode = statSync(file).ino;
    const bad = [
      ["maybe"], [], ["on", "--interval-minutes", "4"], ["on", "--interval-minutes", "0"], ["on", "--interval-minutes", "-10"], ["on", "--interval-minutes", "1.5"], ["on", "--interval-minutes", "abc"], ["on", "--interval-minutes", "1441"],
      ["on", "--open-tools-every", "0"], ["on", "--open-tools-every", "x"], ["on", "--recipients", "nobody"], ["on", "--recipients", "a|b,c"], ["on", "--recipients", "|b"], ["on", "--recipients", ""],
      ["on", "--interval-minutes"], ["on", "--interval-minutes", "10", "--interval-minutes", "20"], ["on", "--unknown", "1"], ["on", "extra"],
    ];
    for (const args of bad) {
      expect(run("observe", file, ...args).status, args.join(" ")).not.toBe(0);
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(statSync(file).ino).toBe(inode);
    }
    // The lower bounds are accepted exactly.
    expect(run("observe", file, "on", "--interval-minutes", "5", "--open-tools-every", "1").status).toBe(0);
    expect(observation(file)).toMatchObject({ interval_minutes: 5, open_tools_every: 1 });
  });
});

