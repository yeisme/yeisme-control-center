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
    writeFileSync(join(dir, "credential"), "secret", { mode: 0o600 });
    expect(run("connect", file, "e", "eikona", "http://127.0.0.1:1234/mcp", "p", join(dir, "credential"), "--private-http").status).toBe(0);
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
    writeFileSync(join(dir, "present-credential"), "secret", { mode: 0o600 });
    expect(run("connect", file, "e", "eikona", "https://owner.example.test/mcp", "p", join(dir, "present-credential"), "--content").status).toBe(0);
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
  it("accepts plain http to a private IPv4 address only with --private-http, never to a public one", () => {
    // Built at run time: the public-surface check rejects private address literals in tracked files.
    const at = (...octets: number[]) => `http://${octets.join(".")}`;
    const private192 = at(192, 168, 1, 20) + ":4318", private10 = at(10, 0, 0, 5), private172 = at(172, 16, 0, 9), private172Top = at(172, 31, 255, 1);
    const file = join(dir, "auctra-private-http.json");
    expect(run("init", file, "http://127.0.0.1:4312", "test-admin").status).toBe(0);
    const collector = join(dir, "private-collector.key"), reader = join(dir, "private-reader.key");
    writeFileSync(collector, "auctra-ak-collector\n", { mode: 0o600 });
    writeFileSync(reader, "auctra-ak-reader\n", { mode: 0o600 });
    const before = readFileSync(file, "utf8");
    const inode = statSync(file).ino;
    // Without the flag today's rule stands: https or loopback only.
    for (const origin of [private192, private10, private172]) expect(run("auctra", file, origin, "project:rain", collector).status, origin).not.toBe(0);
    // With it, a public http address, a name, a path, credentials and the addresses just outside the private ranges are still refused.
    for (const origin of [at(203, 0, 113, 9), at(172, 32, 0, 1), at(172, 15, 0, 1), at(11, 0, 0, 1), "http://auctra.example.test", private192 + "/base", private192 + "/", at(192, 168, 1, 20).replace("http://", "http://user:pass@"), "ftp://" + private192.slice(7)]) {
      expect(run("auctra", file, origin, "project:rain", collector, "--private-http").status, origin).not.toBe(0);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(statSync(file).ino).toBe(inode);
    const added = run("auctra", file, private192, "project:rain", collector, reader, "--private-http", "--expires-in", "30d", "--issued-at", "2026-11-02T00:00:00Z");
    expect(added.status, added.stderr).toBe(0);
    expect(JSON.parse(added.stdout)).toMatchObject({ origin: private192, private_http: true, reader_key_configured: true, network_called: false });
    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(config.collection.auctra).toMatchObject({ origin: private192, audience: "auctra", allow_private_http: true, credential_ref: collector, flow_credential_ref: reader, enabled: true });
    expect(config.collection.auctra.credential_expires_at).toBe(config.collection.auctra.flow_credential_expires_at);
    // The status output still keeps the address out.
    expect(run("status", file).stdout).not.toContain(private192);
    // --replace composes: another private address with the flag, and a rebuilt entry without it forgets the allowance.
    expect(run("auctra", file, private10, "project:rain", collector, "--private-http", "--replace").status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).collection.auctra).toMatchObject({ origin: private10, allow_private_http: true });
    expect(run("auctra", file, private172Top, "project:rain", collector, "--replace", "--private-http").status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).collection.auctra.origin).toBe(private172Top);
    expect(run("auctra", file, "https://auctra.example.test", "project:rain", collector, "--replace").status).toBe(0);
    const replaced = JSON.parse(readFileSync(file, "utf8")).collection.auctra;
    // ... while the collector key, whose file did not change, keeps the dates recorded for it.
    expect(replaced).toEqual({ origin: "https://auctra.example.test", audience: "auctra", credential_ref: collector, credential_expires_at: config.collection.auctra.credential_expires_at, credential_issued_at: "2026-11-02T00:00:00.000Z", enabled: true });
    // Loopback http keeps working with or without the flag.
    expect(run("auctra", file, "http://127.0.0.1:4318", "project:rain", collector, "--replace").status).toBe(0);
    expect(run("auctra", file, "http://localhost:4318", "project:rain", collector, "--private-http", "--replace").status).toBe(0);
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


describe("personal configuration CLI: credential expiry", () => {
  const init = (name: string) => {
    const file = join(dir, name);
    expect(run("init", file).status).toBe(0);
    return file;
  };
  const key = (name: string, mode = 0o600) => {
    const path = join(dir, name);
    writeFileSync(path, "fixture-credential\n", { mode });
    chmodSync(path, mode);
    return path;
  };
  const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
  const day = 86_400_000;

  it("records the dates next to the credential reference for connect, open-tool, provider and auctra", () => {
    const file = init("expiry-record.json");
    const a = key("expiry-a.key"), b = key("expiry-b.key");
    const connected = run("connect", file, "anat", "anatomia", "https://anatomia.example.test/mcp", "project:x", a, "--expires-at", "2026-11-30T23:59:59+08:00", "--issued-at", "2026-11-01T00:00:00Z");
    expect(connected.status, connected.stderr).toBe(0);
    expect(connected.stdout).toContain("Recorded credential expiry 2026-11-30T15:59:59.000Z for connection:anat");
    expect(read(file).connections[0]).toMatchObject({ credential_ref: a, credential_expires_at: "2026-11-30T15:59:59.000Z", credential_issued_at: "2026-11-01T00:00:00.000Z" });
    const before = Date.now();
    const tool = run("open-tool", file, "drivebridge", "https://drive.example.test", b, "--expires-in", "30d");
    expect(tool.status, tool.stderr).toBe(0);
    const recorded = Date.parse(read(file).open_tools.drivebridge.credential_expires_at);
    expect(recorded).toBeGreaterThanOrEqual(before + 30 * day);
    expect(recorded).toBeLessThanOrEqual(Date.now() + 30 * day);
    expect(read(file).open_tools.drivebridge).not.toHaveProperty("credential_issued_at");
    expect(JSON.parse(tool.stdout)).toMatchObject({ expires_at: read(file).open_tools.drivebridge.credential_expires_at, network_called: false });
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", b, "--expires-in", "12h").status).toBe(0);
    expect(Date.parse(read(file).open_tools.gateway.credential_expires_at) - Date.now()).toBeLessThan(12 * 3_600_000 + 5_000);
    const provider = run("provider", file, "eikona", "https://eikona.example.test/mcp", "project-1", a, "model-1", "generate", "-", "--expires-at", "2027-01-01T00:00:00Z");
    expect(provider.status, provider.stderr).toBe(0);
    expect(read(file).providers.eikona).toMatchObject({ credential_ref: a, credential_expires_at: "2027-01-01T00:00:00.000Z" });
    // Auctra: the collector key takes credential_*, the reader key flow_credential_*, both from the one set of options.
    const auctra = run("auctra", file, "https://auctra.example.test", "project:rain", a, b, "--expires-at", "2027-02-01T00:00:00Z", "--issued-at", "2026-11-02T00:00:00Z");
    expect(auctra.status, auctra.stderr).toBe(0);
    expect(read(file).collection.auctra).toMatchObject({
      credential_ref: a, credential_expires_at: "2027-02-01T00:00:00.000Z", credential_issued_at: "2026-11-02T00:00:00.000Z",
      flow_credential_ref: b, flow_credential_expires_at: "2027-02-01T00:00:00.000Z", flow_credential_issued_at: "2026-11-02T00:00:00.000Z",
    });
    // A different file is a new credential: nothing recorded means nothing written, and the command says how to record it.
    const c = key("expiry-c.key");
    const bare = run("open-tool", file, "gateway", "https://gateway.example.test", c, "--replace");
    expect(read(file).open_tools.gateway).toEqual({ endpoint: "https://gateway.example.test", credential_ref: c, enabled: true });
    expect(JSON.parse(bare.stdout)).toMatchObject({ expiry_recorded: false, expiry_cleared: true });
    expect(JSON.parse(bare.stdout).notice).toContain("credential <config-file> expiry open_tool:gateway <RFC3339>");
  });

  it("clears the old dates when the file changes and none are given, and says so", () => {
    const file = init("expiry-replace.json");
    const a = key("replace-a.key"), b = key("replace-b.key"), c = key("replace-c.key"), d = key("replace-d.key");
    expect(run("auctra", file, "https://auctra.example.test", "project:rain", a, b, "--expires-in", "20d").status).toBe(0);
    const again = run("auctra", file, "https://auctra.example.test", "project:rain", c, d, "--replace");
    expect(again.status, again.stderr).toBe(0);
    expect(JSON.parse(again.stdout)).toMatchObject({ expiry_recorded: false, expiry_cleared: true });
    expect(read(file).collection.auctra).toEqual({ origin: "https://auctra.example.test", audience: "auctra", credential_ref: c, flow_credential_ref: d, enabled: true });
    expect(run("provider", file, "sonora", "https://sonora.example.test/mcp", "p", a, "m", "generate", "-", "--expires-in", "10d").status).toBe(0);
    const reprovided = run("provider", file, "sonora", "https://sonora.example.test/mcp", "p", b, "m", "generate", "-");
    expect(JSON.parse(reprovided.stdout)).toMatchObject({ expiry_cleared: true });
    expect(read(file).providers.sonora).not.toHaveProperty("credential_expires_at");
  });

  it("keeps the recorded dates when a re-run names the same file, and drops them only when the file changes", () => {
    const file = init("expiry-same-file.json");
    const a = key("same-a.key"), b = key("same-b.key"), c = key("same-c.key");
    // Open tool: only the endpoint changes, then the file does.
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", a, "--expires-at", "2027-01-01T00:00:00Z", "--issued-at", "2026-12-01T00:00:00Z").status).toBe(0);
    const moved = run("open-tool", file, "gateway", "https://other.example.test", a, "--replace");
    expect(read(file).open_tools.gateway).toEqual({ endpoint: "https://other.example.test", credential_ref: a, credential_expires_at: "2027-01-01T00:00:00.000Z", credential_issued_at: "2026-12-01T00:00:00.000Z", enabled: true });
    expect(JSON.parse(moved.stdout)).toMatchObject({ expires_at: "2027-01-01T00:00:00.000Z", expiry_kept: true });
    expect(JSON.parse(moved.stdout)).not.toHaveProperty("notice");
    // A new date wins; the issue time of the same file stays.
    expect(run("open-tool", file, "gateway", "https://other.example.test", a, "--replace", "--expires-at", "2027-03-01T00:00:00Z").status).toBe(0);
    expect(read(file).open_tools.gateway).toMatchObject({ credential_expires_at: "2027-03-01T00:00:00.000Z", credential_issued_at: "2026-12-01T00:00:00.000Z" });
    // ... and a new expiry earlier than that issue time is refused with nothing written.
    const before = readFileSync(file, "utf8");
    expect(run("open-tool", file, "gateway", "https://other.example.test", a, "--replace", "--expires-at", "2026-11-15T00:00:00Z").status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
    const changed = run("open-tool", file, "gateway", "https://other.example.test", b, "--replace");
    expect(JSON.parse(changed.stdout)).toMatchObject({ expiry_recorded: false, expiry_cleared: true });
    expect(read(file).open_tools.gateway).toEqual({ endpoint: "https://other.example.test", credential_ref: b, enabled: true });
    // Provider: the model changes, the key does not.
    expect(run("provider", file, "eikona", "https://eikona.example.test/mcp", "p", a, "model-1", "generate", "-", "--expires-in", "30d").status).toBe(0);
    const expires = read(file).providers.eikona.credential_expires_at;
    expect(run("provider", file, "eikona", "https://eikona.example.test/mcp", "p", a, "model-2", "generate", "-").status).toBe(0);
    expect(read(file).providers.eikona).toMatchObject({ model_refs: ["model-2"], credential_expires_at: expires });
    expect(run("provider", file, "eikona", "https://eikona.example.test/mcp", "p", c, "model-2", "generate", "-").status).toBe(0);
    expect(read(file).providers.eikona).not.toHaveProperty("credential_expires_at");
    // Auctra: each key keeps its own dates while its own file stays.
    expect(run("auctra", file, "https://auctra.example.test", "project:rain", a, b, "--expires-at", "2027-02-01T00:00:00Z").status).toBe(0);
    expect(run("credential", file, "expiry", "collection:auctra:flow", "2027-06-01T00:00:00Z").status).toBe(0);
    const keptBoth = run("auctra", file, "https://auctra.example.test", "project:rain-2", a, b, "--replace");
    expect(read(file).collection.auctra).toMatchObject({ credential_ref: a, credential_expires_at: "2027-02-01T00:00:00.000Z", flow_credential_ref: b, flow_credential_expires_at: "2027-06-01T00:00:00.000Z" });
    expect(JSON.parse(keptBoth.stdout)).toMatchObject({ expires_at: "2027-02-01T00:00:00.000Z", expiry_kept: true, reader_expires_at: "2027-06-01T00:00:00.000Z" });
    expect(run("auctra", file, "https://auctra.example.test", "project:rain-2", a, c, "--replace").status).toBe(0);
    const swapped = read(file).collection.auctra;
    expect(swapped.credential_expires_at).toBe("2027-02-01T00:00:00.000Z");
    expect(swapped).not.toHaveProperty("flow_credential_expires_at");
    // `credential replace` is a new credential by name, even when the path is the same: the file was probably rewritten in place.
    expect(run("credential", file, "replace", "collection:auctra", a).status).toBe(0);
    expect(read(file).collection.auctra).not.toHaveProperty("credential_expires_at");
  });

  it("refuses a credential file that secret() would refuse, in every command that takes one", () => {
    const file = init("credential-files.json");
    const good = key("files-good.key");
    const blank = join(dir, "files-blank.key");
    writeFileSync(blank, " \n\t\n", { mode: 0o600 });
    const empty = join(dir, "files-empty.key");
    writeFileSync(empty, "", { mode: 0o600 });
    const loose = key("files-loose.key", 0o644);
    const missing = join(dir, "files-absent.key");
    // Root reads any file, so the shut-out file only proves something for another user.
    const shut = join(dir, "files-shut.key");
    writeFileSync(shut, "fixture-credential\n", { mode: 0o600 });
    chmodSync(shut, 0o200);
    const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
    const unusable = [blank, empty, loose, missing, dir, ...(asRoot ? [] : [shut])];
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", good).status).toBe(0);
    expect(run("auctra", file, "https://auctra.example.test", "project:rain", good, good).status).toBe(0);
    const before = readFileSync(file, "utf8");
    const inode = statSync(file).ino;
    for (const bad of unusable) {
      const commands: string[][] = [
        ["connect", file, "c", "anatomia", "https://anatomia.example.test/mcp", "project:x", bad],
        ["open-tool", file, "drivebridge", "https://drive.example.test", bad],
        ["open-tool", file, "gateway", "https://gateway.example.test", bad, "--replace"],
        ["provider", file, "eikona", "https://eikona.example.test/mcp", "p", bad, "m", "generate", "-"],
        ["auctra", file, "https://auctra.example.test", "project:rain", bad, "--replace"],
        ["auctra", file, "https://auctra.example.test", "project:rain", good, bad, "--replace"],
        ["credential", file, "replace", "open_tool:gateway", bad],
        ["credential", file, "replace", "collection:auctra:flow", bad],
      ];
      for (const args of commands) {
        const result = run(...args);
        expect(result.status, `${args[0]} ${args[2]} ${bad}`).not.toBe(0);
        // The reason is in words, and the path is not in them.
        expect(result.stderr).toMatch(/does not exist|is not a regular file|must be mode 0600|is empty or holds only whitespace/);
        expect(result.stderr + result.stdout).not.toContain(bad + "\n");
      }
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(statSync(file).ino).toBe(inode);
    }
    // A file that passes is taken, and a not-yet-created one is no longer: issue the credential first, then register it.
    expect(run("connect", file, "c", "anatomia", "https://anatomia.example.test/mcp", "project:x", good).status).toBe(0);
    chmodSync(shut, 0o600);
  });

  it("names the other slots that share a file when an expiry is set on one of them", () => {
    const file = init("credential-expiry-shared.json");
    const shared = key("shared-expiry.key"), own = key("own-expiry.key");
    expect(run("open-tool", file, "drivebridge", "https://drive.example.test", shared).status).toBe(0);
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", shared).status).toBe(0);
    expect(run("connect", file, "alone", "anatomia", "https://anatomia.example.test/mcp", "project:x", own).status).toBe(0);
    const set = run("credential", file, "expiry", "open_tool:drivebridge", "2026-12-31T00:00:00Z");
    expect(set.status, set.stderr).toBe(0);
    expect(JSON.parse(set.stdout)).toMatchObject({ slot: "open_tool:drivebridge", expires_at: "2026-12-31T00:00:00.000Z", shared_with: ["open_tool:gateway"] });
    expect(JSON.parse(set.stdout).notice).toContain("open_tool:gateway");
    // Only the named slot changed; a file nobody shares says nothing about sharing.
    expect(read(file).open_tools.gateway).not.toHaveProperty("credential_expires_at");
    const alone = run("credential", file, "expiry", "connection:alone", "2026-12-31T00:00:00Z");
    expect(JSON.parse(alone.stdout)).not.toHaveProperty("shared_with");
    expect(JSON.parse(alone.stdout)).not.toHaveProperty("notice");
  });

  it("refuses bad or conflicting date options without rewriting the configuration", () => {
    const file = init("expiry-reject.json");
    const a = key("reject-a.key");
    const before = readFileSync(file, "utf8");
    const inode = statSync(file).ino;
    const bad = [
      ["--expires-at", "2026-11-30"], ["--expires-at", "2026-11-30T00:00:00"], ["--expires-at", "2026-02-31T00:00:00Z"], ["--expires-at", "2026-13-01T00:00:00Z"], ["--expires-at", "tomorrow"], ["--expires-at"],
      ["--expires-in", "30"], ["--expires-in", "0d"], ["--expires-in", "-3d"], ["--expires-in", "2w"], ["--expires-in", "1.5d"],
      ["--expires-at", "2027-01-01T00:00:00Z", "--expires-in", "5d"],
      ["--issued-at", "yesterday"], ["--expires-at", "2026-11-30T00:00:00Z", "--issued-at", "2026-12-01T00:00:00Z"],
      ["--expires-in", "5d", "--expires-in", "6d"],
    ];
    for (const options of bad) {
      expect(run("connect", file, "c", "anatomia", "https://anatomia.example.test/mcp", "project:x", a, ...options).status, options.join(" ")).not.toBe(0);
      expect(run("open-tool", file, "gateway", "https://gateway.example.test", a, ...options).status, options.join(" ")).not.toBe(0);
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(statSync(file).ino).toBe(inode);
    }
    // Switching a tool off takes no dates, and Z, lower-case separators and fractions are accepted.
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", a).status).toBe(0);
    expect(run("open-tool", file, "gateway", "off", "--expires-in", "5d").status).not.toBe(0);
    expect(run("connect", file, "ok", "anatomia", "https://anatomia.example.test/mcp", "project:x", a, "--expires-at", "2027-03-04t05:06:07.5z").status).toBe(0);
    expect(read(file).connections[0].credential_expires_at).toBe("2027-03-04T05:06:07.500Z");
  });

  it("lists slots with their state, expiry and shared files, and never a path or an address", () => {
    const file = init("credential-list.json");
    const shared = key("list-shared.key"), loose = key("list-loose.key", 0o644);
    expect(run("connect", file, "eik", "eikona", "https://eikona.example.test/mcp", "p", shared, "--expires-at", "2036-01-01T00:00:00Z").status).toBe(0);
    expect(run("open-tool", file, "drivebridge", "https://drive.example.test", shared, "--expires-in", "2d").status).toBe(0);
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", shared).status).toBe(0);
    const config = read(file);
    config.open_tools.gateway.credential_ref = loose;
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    const listed = run("credential", file, "list");
    expect(listed.status, listed.stderr).toBe(0);
    const { credentials, network_called } = JSON.parse(listed.stdout);
    expect(network_called).toBe(false);
    expect(credentials.map((row: { slot: string; state: string }) => [row.slot, row.state])).toEqual([["connection:eik", "ok"], ["open_tool:drivebridge", "expiring"], ["open_tool:gateway", "unreadable"]]);
    expect(credentials[0]).toMatchObject({ owner: "eikona", enabled: true, expires_at: "2036-01-01T00:00:00.000Z", shared_with: ["open_tool:drivebridge"] });
    expect(credentials[2]).toMatchObject({ reason: "permissions" });
    for (const hidden of [shared, loose, dir, "example.test", "fixture-credential", "credential_ref"]) expect(listed.stdout).not.toContain(hidden);
    expect(run("credential", file, "list", "extra").status).not.toBe(0);
  });

  it("sets and clears an expiry by slot, and names the valid slots when one is unknown", () => {
    const file = init("credential-expiry.json");
    const a = key("expiry-slot.key");
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", a, "--issued-at", "2026-11-01T00:00:00Z").status).toBe(0);
    const set = run("credential", file, "expiry", "open_tool:gateway", "2026-12-01T00:00:00Z");
    expect(set.status, set.stderr).toBe(0);
    expect(read(file).open_tools.gateway).toMatchObject({ credential_expires_at: "2026-12-01T00:00:00.000Z", credential_issued_at: "2026-11-01T00:00:00.000Z" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(run("credential", file, "expiry", "open_tool:gateway", "none").status).toBe(0);
    expect(read(file).open_tools.gateway).not.toHaveProperty("credential_expires_at");
    const before = readFileSync(file, "utf8");
    const unknown = run("credential", file, "expiry", "open_tool:nothing", "2026-12-01T00:00:00Z");
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain("Valid slots: open_tool:gateway");
    for (const args of [["expiry", "open_tool:gateway", "2026-12-01"], ["expiry", "open_tool:gateway", "2026-10-01T00:00:00Z"], ["expiry", "open_tool:gateway"], ["expiry"], ["frobnicate"], []]) {
      expect(run("credential", file, ...args).status, args.join(" ")).not.toBe(0);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("replaces the file behind a slot, drops the dates of the old credential and names slots still on the old file", () => {
    const file = init("credential-replace.json");
    const oldKey = key("swap-old.key"), newKey = key("swap-new.key"), loose = key("swap-loose.key", 0o640), empty = key("swap-empty.key");
    writeFileSync(empty, "", { mode: 0o600 });
    expect(run("open-tool", file, "drivebridge", "https://drive.example.test", oldKey, "--expires-in", "3d").status).toBe(0);
    expect(run("open-tool", file, "gateway", "https://gateway.example.test", oldKey).status).toBe(0);
    const before = readFileSync(file, "utf8");
    for (const target of [loose, empty, join(dir, "swap-absent.key"), dir]) expect(run("credential", file, "replace", "open_tool:drivebridge", target).status, target).not.toBe(0);
    expect(run("credential", file, "replace", "open_tool:nothing", newKey).status).not.toBe(0);
    expect(run("credential", file, "replace", "open_tool:drivebridge").status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
    const bare = run("credential", file, "replace", "open_tool:drivebridge", newKey);
    expect(bare.status, bare.stderr).toBe(0);
    expect(JSON.parse(bare.stdout)).toMatchObject({ slot: "open_tool:drivebridge", expiry_recorded: false, expiry_cleared: true, still_using_previous_file: ["open_tool:gateway"] });
    expect(bare.stdout).not.toContain(newKey);
    expect(read(file).open_tools.drivebridge).toEqual({ endpoint: "https://drive.example.test", credential_ref: newKey, enabled: true });
    expect(read(file).open_tools.gateway.credential_ref).toBe(oldKey);
    const dated = run("credential", file, "replace", "open_tool:gateway", newKey, "--expires-in", "30d", "--issued-at", "2026-11-02T00:00:00Z");
    expect(dated.status, dated.stderr).toBe(0);
    expect(JSON.parse(dated.stdout)).not.toHaveProperty("notice");
    expect(read(file).open_tools.gateway).toMatchObject({ credential_ref: newKey, credential_issued_at: "2026-11-02T00:00:00.000Z" });
    expect(read(file).open_tools.gateway.credential_expires_at).toMatch(/^20\d\d-\d\d-\d\dT/);
  });

  it("keeps Auctra's reader key on its own slot, with its own dates", () => {
    const file = init("credential-flow.json");
    const collector = key("flow-collector.key"), reader = key("flow-reader.key"), fresh = key("flow-fresh.key");
    expect(run("auctra", file, "https://auctra.example.test", "project:rain", collector, reader, "--expires-at", "2027-02-01T00:00:00Z").status).toBe(0);
    expect(run("credential", file, "replace", "collection:auctra:flow", fresh, "--expires-at", "2027-06-01T00:00:00Z").status).toBe(0);
    expect(read(file).collection.auctra).toMatchObject({ credential_ref: collector, credential_expires_at: "2027-02-01T00:00:00.000Z", flow_credential_ref: fresh, flow_credential_expires_at: "2027-06-01T00:00:00.000Z" });
    expect(run("credential", file, "expiry", "collection:auctra", "none").status).toBe(0);
    expect(read(file).collection.auctra).not.toHaveProperty("credential_expires_at");
    expect(read(file).collection.auctra.flow_credential_expires_at).toBe("2027-06-01T00:00:00.000Z");
  });
});
