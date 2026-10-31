import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
