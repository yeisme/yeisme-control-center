import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const root = process.cwd();
const uiPort = Number(process.env.CI_UI_PORT || 4298);
const livePort = Number(process.env.CI_LIVE_PORT || 4312);
const children = [];
function start(command, args, env = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return child;
}
async function waitFor(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}
try {
  if (!existsSync("dist/index.html")) throw new Error("Build the client before browser verification.");
  start(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], { V18_API_ORIGIN: `http://127.0.0.1:${livePort}` });
  start("bun", ["server/index.ts"], { YEISME_CONTROL_ORIGIN: `http://127.0.0.1:${livePort}`, YEISME_CONTROL_BIND: "127.0.0.1", YEISME_CONTROL_PORT: String(livePort) });
  await Promise.all([waitFor(`http://127.0.0.1:${uiPort}/`), waitFor(`http://127.0.0.1:${livePort}/api/control-center/v1/health`)]);
  await run("bun", ["run", "test:app"], { APP_URL: `http://127.0.0.1:${uiPort}/` });
} finally {
  for (const child of children.reverse()) { child.kill("SIGTERM"); child.kill("SIGKILL"); }
}
