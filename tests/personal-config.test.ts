import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    for (const origin of ["http://10.10.1.101", "ftp://localhost", "https://control.example.test/path", "https://name:pass@control.example.test"]) {
      expect(run("init", join(dir, "unsafe.json"), origin, "test-admin").status).not.toBe(0);
    }
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
