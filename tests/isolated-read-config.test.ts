import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error The shared entry is also imported by the plain JS preview launcher.
import { isolateReadConfig, isolatedReadEnvironment } from "../scripts/isolated-read-config.mjs";
import { readOnlyRequestAllowed } from "../server/read-only-policy";
import { createApp } from "../server/app";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "read-isolation-test-"));
  directories.push(root);
  const directory = join(root, "private");
  mkdirSync(directory, { mode: 0o700 });
  const sourcePath = join(root, "source.json");
  const db = join(root, "source.sqlite");
  writeFileSync(db, "source database sentinel");
  const source = { origin: "https://control.example", database: { path: db }, observation: { enabled: true }, config_file: sourcePath,
    providers: { eikona: { enabled: true } }, connections: [{ allow_cancel: true, credential_ref: "existing-ref" }],
    open_tools: { "mcp-gateway": { credential_ref: "observer-ref", management_credential_ref: "management-ref" } } };
  writeFileSync(sourcePath, JSON.stringify(source));
  const options = { directory, configPath: join(directory, "config.json"), sourcePath, origin: "http://127.0.0.1:4329", port: 4329 };
  return { source, options, db };
}

describe("real read isolation", () => {
  it("never retains the source database or write configuration and does not mutate the source", () => {
    const { source, options, db } = fixture();
    const before = JSON.stringify(source);
    const isolated = isolateReadConfig(source, options);
    expect(isolated.database.path).toBe(join(options.directory, "read-check.sqlite"));
    expect(isolated.config_file).toBe(options.configPath);
    expect(isolated.observation).toEqual({ enabled: false });
    expect(isolated.read_only).toBe(true);
    expect(isolated.providers).toEqual({});
    expect(isolated.connections[0]).toMatchObject({ allow_cancel: false, credential_ref: "existing-ref" });
    expect(isolated.open_tools["mcp-gateway"]).toEqual({ credential_ref: "observer-ref" });
    expect(JSON.stringify(source)).toBe(before);
    expect(readFileSync(db, "utf8")).toBe("source database sentinel");
    expect(readFileSync(options.sourcePath, "utf8")).toBe(before);
  });
  it("rejects symlink escapes, source reuse, non-loopback and public directories", () => {
    const { source, options, db } = fixture();
    symlinkSync(db, join(options.directory, "read-check.sqlite"));
    expect(() => isolateReadConfig(source, options)).toThrow(/escape|reused/);
    rmSync(join(options.directory, "read-check.sqlite"));
    expect(() => isolateReadConfig(source, { ...options, configPath: options.sourcePath })).toThrow(/escape|reused/);
    expect(() => isolateReadConfig(source, { ...options, origin: "https://public.example" })).toThrow("isolated_origin_invalid");
  });
  it("clears inherited execution and control overrides", () => {
    expect(isolatedReadEnvironment({ PATH: "/bin", YEISME_PROVIDER_EIKONA_URL: "unsafe", YEISME_PROVIDER_EIKONA_TOKEN: "unsafe", YEISME_CONTROL_BACKGROUND: "on", YEISME_CONTROL_CONFIG: "source" }, "/tmp/config", 4329))
      .toEqual({ PATH: "/bin", YEISME_CONTROL_CONFIG: "/tmp/config", YEISME_CONTROL_PORT: "4329", YEISME_CONTROL_BIND: "127.0.0.1", YEISME_CONTROL_BACKGROUND: "off" });
  });
  it("uses a bounded read allowlist, not a generic POST exemption", () => {
    for (const path of ["/actions/preview", "/actions/confirm", "/provider-runs", "/tasks/key/cancel", "/auctra/authoring", "/users", "/notifications/cleanup"])
      expect(readOnlyRequestAllowed("POST", path), path).toBe(false);
    for (const path of ["/auth/personal", "/auctra/collection/sync", "/requests/eikona/id/content:read", "/tasks/key/artifacts/artifact/access"])
      expect(readOnlyRequestAllowed("POST", path), path).toBe(true);
    expect(readOnlyRequestAllowed("DELETE", "/tasks/key")).toBe(false);
  });
  it("enforces the policy before any side-effecting route", async () => {
    const app = createApp({ origin: "http://127.0.0.1:4329", port: 4329, owners: {}, principals: [], read_only: true });
    for (const path of ["/actions/confirm", "/provider-runs", "/auctra/authoring", "/tasks/key/cancel"]) {
      const response = await app(new Request(`http://127.0.0.1:4329/api/control-center/v1${path}`, { method: "POST", body: "{}" }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "read_only_run" });
    }
  });
});
