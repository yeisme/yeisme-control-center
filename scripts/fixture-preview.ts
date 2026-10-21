import { createServer as createHttpServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer as createViteServer } from "vite";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { createMemoryDB } from "../server/db/client";
import { SessionStore } from "../server/db/session-store";
import { RunStore } from "../server/db/run-store";
import { ProviderRunManager } from "../server/provider-live";
import { hashPassword } from "../server/password";
import type { ServerConfig, TaskConnection } from "../server/contracts";
import { delegationToken, observerToken, providerToken, startFakeOwners } from "./fixtures/fake-owners";
import { usageSeed, type Scenario } from "./fixtures/world";

const root = resolve(import.meta.dirname, "..");
const scenario = (["rich", "degraded", "empty"].includes(process.env.FIXTURE_SCENARIO || "") ? process.env.FIXTURE_SCENARIO : "rich") as Scenario;
const port = (name: string, fallback: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid port`);
  return value;
};
const uiPort = port("FIXTURE_UI_PORT", 4300);
const apiPort = port("FIXTURE_API_PORT", 4313);
const ownerPort = port("FIXTURE_OWNER_PORT", 4314);
const uiHost = process.env.FIXTURE_UI_HOST || "127.0.0.1";
const latencyMs = Math.max(0, Number(process.env.FIXTURE_LATENCY_MS || 0));
const username = "fixture-admin";
const password = process.env.FIXTURE_PASSWORD || randomBytes(18).toString("base64url");
const origin = `http://127.0.0.1:${apiPort}`;
const withVite = process.env.FIXTURE_NO_UI !== "1";

const temp = await mkdtemp("/tmp/yeisme-cc-fixture-");
const passwordRef = join(temp, "password");
const observerRef = join(temp, "observer");
await writeFile(passwordRef, (await hashPassword(password)) + "\n", { mode: 0o600 });
await writeFile(observerRef, observerToken + "\n", { mode: 0o600 });
process.env.YEISME_FIXTURE_PROVIDER_TOKEN = providerToken;

let videoBytes: Buffer | null = null;
if (Bun.which("ffmpeg")) {
  const out = join(temp, "alley.mp4");
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", out]);
  if (result.status === 0) videoBytes = await readFile(out);
}

const scopes = [
  { id: "fixture-a", tenant: "rain-studio", project: "rain-reunion", label: "Fixture · 雨夜重逢", connections: ["fx-eikona", "fx-sonora", "fx-sonora-locked", "fx-scaena", "fx-eikona-denied"] },
  { id: "fixture-b", tenant: "rain-studio", project: "coast-letters", label: "Fixture · 海岸来信", connections: ["fx-eikona-coast", "fx-sonora-coast"] },
];
const owners = startFakeOwners({ port: ownerPort, requestPorts: { eikona: ownerPort + 1, sonora: ownerPort + 2 }, scenario, latencyMs, videoBytes, scopes });

const connection = (id: string, owner: TaskConnection["owner"], project: string, label: string, extra: Partial<TaskConnection> = {}): TaskConnection => ({
  id, owner, project, label, instance_id: "fixture", environment: "fixture",
  endpoint: `${owners.origin}/mcp/${id}`, credential_ref: observerRef, enabled: true, allow_private_http: true, allow_content: true, ...extra,
});

const audience = (owner: string) => `fixture-${owner}`;
const config: ServerConfig = {
  origin,
  port: apiPort,
  bind: "127.0.0.1",
  auth_mode: "personal",
  personal: { name: "Fixture 管理员", username, role: "admin", password_hash_ref: passwordRef, scope_ids: scopes.map((scope) => scope.id), users: [] },
  principals: [{
    issuer: "fixture",
    subject: "fixture",
    name: "Fixture 管理员",
    scopes: scopes.map((scope) => ({
      id: scope.id,
      tenant: scope.tenant,
      team: "rain-studio",
      project: scope.project,
      label: scope.label,
      connection_ids: scope.connections,
      owners: Object.fromEntries(["aigora", "eikona", "scaena", "sonora"].map((owner) => [owner, { tenant: scope.tenant, project: scope.project, actor: "fixture-admin", audience: audience(owner) }])),
    })),
  }],
  owners: {
    aigora: { origin: owners.origin, audience: audience("aigora") },
    scaena: { origin: owners.origin, audience: audience("scaena") },
    eikona: { origin: owners.origins.eikona, audience: audience("eikona") },
    sonora: { origin: owners.origins.sonora, audience: audience("sonora") },
  },
  connections: [
    connection("fx-eikona", "eikona", "rain-reunion", "Eikona · 图像生产", { allow_cancel: true }),
    connection("fx-sonora", "sonora", "rain-reunion", "Sonora · 配音与音乐"),
    connection("fx-sonora-locked", "sonora", "rain-reunion-archive", "Sonora · 归档（内容未授权）", { allow_content: false }),
    connection("fx-scaena", "scaena", "rain-reunion", "Scaena · 片场委托", { studio_origin: "http://127.0.0.1:16920" }),
    connection("fx-eikona-denied", "eikona", "rain-reunion-legacy", "Eikona · 旧项目（未授权）"),
    connection("fx-eikona-coast", "eikona", "coast-letters", "Eikona · 海岸来信"),
    connection("fx-sonora-coast", "sonora", "coast-letters", "Sonora · 海岸来信"),
  ],
  providers: Object.fromEntries((["eikona", "scaena", "sonora"] as const).map((owner) => [owner, {
    owner, endpoint: `${owners.origin}/provider/${owner}`, credential_env: "YEISME_FIXTURE_PROVIDER_TOKEN", enabled: true,
    ...(owner === "scaena" ? { project: "rain-reunion" } : {}),
  }])),
};

const db = createMemoryDB();
const runs = new RunStore(db);
for (const scope of scopes) for (const event of usageSeed(scenario, scope.project, scope.id === "fixture-a" ? 36 : 8)) runs.putUsage(event);
const auth = new SessionAuth(config, undefined, new SessionStore(db));
const app = createApp(config, { db, auth, providers: new ProviderRunManager(config, undefined, runs) });

// Fixture-only shim: personal sessions carry no OIDC token, so grant a fixture delegation after login.
async function handle(request: Request) {
  const response = await app(request);
  if (request.method === "POST" && new URL(request.url).pathname.endsWith("/auth/personal") && response.status === 200) {
    const id = response.headers.getSetCookie().map((cookie) => cookie.match(/^yeisme_session=([^;]+)/)?.[1]).find(Boolean);
    const session = id ? auth.sessions.get(id) : undefined;
    if (id && session) auth.sessions.set(id, { ...session, accessToken: delegationToken, accessAudience: ["aigora", "eikona", "scaena", "sonora"].map(audience) });
  }
  return response;
}

const api = createHttpServer(async (req, res) => {
  try {
    if (req.headers.host !== new URL(origin).host) { res.writeHead(421).end(); return; }
    const url = new URL(req.url || "/", origin);
    if (!url.pathname.startsWith("/api/control-center/")) { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      const limit = url.pathname.includes("/notifications/") ? 262144 : 16384;
      if (bytes > limit) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join("; ") : value);
    const controller = new AbortController();
    res.once("close", () => { if (!res.writableEnded) controller.abort(); });
    const response = await handle(new Request(url, { signal: controller.signal, method: req.method, headers, body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : Buffer.concat(chunks) }));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    if (response.body) await pipeline(Readable.fromWeb(response.body as any), res);
    else res.end();
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise<void>((done) => api.listen(apiPort, "127.0.0.1", done));

process.env.V18_API_ORIGIN = origin;
process.env.V18_CONTROL_ORIGIN = origin;
const vite = withVite ? await createViteServer({
  configFile: resolve(root, "vite.config.ts"),
  cacheDir: resolve(root, "node_modules/.vite-fixture"),
  server: { host: uiHost, port: uiPort, strictPort: true },
  logLevel: "warn",
}) : null;
await vite?.listen();

let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  // Keep-alive browser sockets would otherwise hold the ports open after exit is requested.
  api.closeAllConnections();
  api.close();
  owners.stop();
  await Promise.race([vite?.close(), new Promise((resolve) => setTimeout(resolve, 1500))]);
  await rm(temp, { recursive: true, force: true });
  process.exit(code);
}
process.once("SIGINT", () => void stop(130));
process.once("SIGTERM", () => void stop(143));

console.log(JSON.stringify({
  status: "ready",
  scenario,
  ui: withVite ? `http://127.0.0.1:${uiPort}/` : null,
  api: origin,
  owners: owners.origin,
  username,
  password,
  video_fixture: videoBytes ? "ffmpeg" : "unavailable",
  note: "Fixture owners only; no real owner, provider or paid call is made.",
}, null, 2));
