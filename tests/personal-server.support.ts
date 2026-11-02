import { afterAll } from "vitest";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { SessionAuth } from "../server/auth";
import { hashPassword } from "../server/password";
import { createApp } from "../server/app";
import type { ServerConfig } from "../server/contracts";

/** A personal-mode control center running on a real configuration file, for the tests of how accounts are stored and signed in. */
export const root = mkdtempSync(join(tmpdir(), "yeisme-accounts-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
export const origin = "http://127.0.0.1:4312";
export const password = "owner-password-123";

export type App = ReturnType<typeof createApp>;

/** The administrator is the configuration's own owner account, named `root`; each server gets a directory of its own. */
export async function running(extra: Partial<ServerConfig["personal"]> = {}) {
  const home = mkdtempSync(join(root, "home-"));
  const file = join(home, "control.json");
  const passwordRef = join(home, "owner.password");
  writeFileSync(passwordRef, (await hashPassword(password)) + "\n", { mode: 0o600 });
  const config: ServerConfig = {
    origin,
    port: 4312,
    owners: {},
    auth_mode: "personal",
    personal: { name: "Owner", username: "root", role: "admin", password_hash_ref: passwordRef, scope_ids: ["personal"], ...extra },
    principals: [{ issuer: "config", subject: "personal", name: "Owner", scopes: [{ id: "personal", tenant: "personal", team: "", project: "personal", label: "Personal", owners: {} }] }],
  };
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  config.config_file = file;
  const auth = new SessionAuth(config);
  return { home, file, config, auth, app: createApp(config, { auth }) };
}

/** `peer` is the address of the connection the request arrived on, as the server entry passes it; `forwardedFor` is the header a proxy sets. */
export const call = (app: App, path: string, options: { method?: string; body?: unknown; cookie?: string; csrf?: string; peer?: string; forwardedFor?: string } = {}) =>
  app(new Request(origin + "/api/control-center/v1" + path, {
    method: options.method ?? "GET",
    headers: { Origin: origin, ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}), ...(options.forwardedFor ? { "X-Forwarded-For": options.forwardedFor } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), { peer: options.peer });

export const signIn = async (app: App, username: string, key: string, from: { peer?: string; forwardedFor?: string } = {}) => {
  const response = await call(app, "/auth/personal", { method: "POST", body: { username, key }, ...from });
  return { response, cookie: response.headers.get("set-cookie") ?? "" };
};

export const cli = (...args: string[]) => spawnSync("bun", ["scripts/personal-config.ts", ...args], { encoding: "utf8" });

/** Runs the command line without waiting for it, so a test can act while it is still working. */
export function cliAsync(...args: string[]) {
  const child = spawn("bun", ["scripts/personal-config.ts", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => child.on("close", (status) => resolve({ status, stdout, stderr })));
  return { done };
}

export const stored = (file: string) => JSON.parse(readFileSync(file, "utf8")) as ServerConfig & Record<string, any>;

/** Another writer replaces the file the way personal-config does: a temporary file renamed over it. */
export const rewrite = (file: string, change: (config: Record<string, any>) => void) => {
  const config = JSON.parse(readFileSync(file, "utf8"));
  change(config);
  const temp = file + ".other.tmp";
  writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, file);
};

export const viewer = (username: string) => ({ username, name: username, role: "viewer" as const, scope_ids: ["personal"] });
export const waitFor = async (check: () => boolean, ms = 10_000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
