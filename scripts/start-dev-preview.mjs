import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const source = process.env.YEISME_PREVIEW_SOURCE_CONFIG || join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "yeisme-control-center",
  "config.json",
);
const origin = process.env.YEISME_PREVIEW_ORIGIN || "http://127.0.0.1:4312";
const bind = process.env.YEISME_PREVIEW_BIND || "127.0.0.1";
const port = Number(process.env.YEISME_PREVIEW_PORT || 4312);
const uiHost = process.env.YEISME_PREVIEW_UI_HOST || "127.0.0.1";
const uiPort = Number(process.env.YEISME_PREVIEW_UI_PORT || 4298);
const username = process.env.YEISME_PREVIEW_USERNAME || "preview-admin";
const password = process.env.YEISME_PREVIEW_PASSWORD || randomBytes(18).toString("base64url");

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("YEISME_PREVIEW_PORT must be a valid port");
if (!Number.isInteger(uiPort) || uiPort < 1 || uiPort > 65535) throw new Error("YEISME_PREVIEW_UI_PORT must be a valid port");
const parsed = new URL(origin);
if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
  throw new Error("preview origin must be loopback HTTP; use HTTPS separately for an external deployment");

const sourceConfig = JSON.parse(await readFile(source, "utf8"));
const tempDir = await mkdtemp("/tmp/yeisme-control-center-preview-");
const passwordRef = join(tempDir, "password");
const configRef = join(tempDir, "config.json");
const hash = await import("../server/password.ts").then(({ hashPassword }) => hashPassword(password));
await writeFile(passwordRef, hash + "\n", { mode: 0o600 });
const config = {
  ...sourceConfig,
  origin,
  bind,
  port,
  personal: {
    ...sourceConfig.personal,
    username,
    role: "admin",
    password_hash_ref: passwordRef,
    users: [],
  },
};
await writeFile(configRef, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

const children = [];
function start(command, args, env = {}, stdio = "inherit") {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio,
  });
  children.push(child);
  return child;
}
async function waitFor(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const child of children) if (!child.killed) child.kill("SIGKILL");
  await rm(tempDir, { recursive: true, force: true });
}
process.once("SIGINT", async () => { await stop(); process.exit(130); });
process.once("SIGTERM", async () => { await stop(); process.exit(143); });

try {
  // --watch restarts the API on server changes so the live preview never runs stale routes;
  // sessions survive restarts because the preview database lives next to the temp config.
  const server = start("bun", ["--watch", "--no-clear-screen", "server/index.ts"], {
    YEISME_CONTROL_CONFIG: configRef,
    YEISME_CONTROL_BIND: bind,
    YEISME_CONTROL_ORIGIN: origin,
    YEISME_CONTROL_PORT: String(port),
  });
  server.once("exit", async (code, signal) => {
    if (!stopping) {
      console.error(`Control center exited (${code ?? signal ?? "unknown"})`);
      await stop();
      process.exitCode = code || 1;
    }
  });
  const vite = start("bun", ["node_modules/vite/bin/vite.js", "--host", uiHost, "--port", String(uiPort)], {
    V18_API_ORIGIN: origin,
  }, ["ignore", "ignore", "pipe"]);
  vite.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  await Promise.all([
    waitFor(`${origin}/api/control-center/v1/health`),
    waitFor(`http://${uiHost === "0.0.0.0" ? "127.0.0.1" : uiHost}:${uiPort}/`),
  ]);
  console.log(`Preview UI: http://127.0.0.1:${uiPort}/`);
  console.log(`Preview API: ${origin}`);
  console.log(`Preview login username: ${username}`);
  console.log(`Preview login password (temporary): ${password}`);
  console.log("Preview uses current configured owner connections in read-only mode; Provider submit remains a separate gate.");
  await new Promise(() => {});
} finally {
  await stop();
}
