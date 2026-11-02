import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createControlCenter } from "./app";
import { createObservationLoop, observationSettings } from "./observation-loop";
import { credentialReminders } from "./observation-credentials";
import { guardRejections } from "./process-guard";
import { planStatic } from "./static";
import { decoyDigest, validateControlBind, validateControlOrigin } from "./auth";
import type { ServerConfig } from "./contracts";
import {
  defaultDatabasePath,
  migrateDatabase,
  openDatabase,
} from "./db/client";
import { RunStore } from "./db/run-store";
// A detached task that rejects (a status poll, a loop cycle) is logged by code and the process keeps serving.
guardRejections(process);
const file = process.env.YEISME_CONTROL_CONFIG;
const loadBaseConfig = (path: string): ServerConfig => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ServerConfig;
  } catch {
    console.error("Invalid control center config file: " + path);
    process.exit(1);
  }
};
const providerEntries: Array<[string, { owner: "eikona" | "scaena" | "sonora"; endpoint: string; credential_env: string; enabled: boolean }]> = [];
for (const owner of ["eikona", "scaena", "sonora"] as const) {
  const upper = owner.toUpperCase();
  const endpoint = process.env[`YEISME_PROVIDER_${upper}_URL`];
  const credential_env = process.env[`YEISME_PROVIDER_${upper}_TOKEN_ENV`] || `YEISME_PROVIDER_${upper}_TOKEN`;
  if (endpoint) providerEntries.push([owner, { owner, endpoint, credential_env, enabled: true }]);
}
const baseConfig: ServerConfig = file
  ? loadBaseConfig(file)
  : {
      origin: process.env.YEISME_CONTROL_ORIGIN || "http://127.0.0.1:4312",
      port: Number(process.env.YEISME_CONTROL_PORT || 4312),
      principals: [],
      owners: {},
    };
const config: ServerConfig = {
  ...baseConfig,
  origin: validateControlOrigin(baseConfig.origin),
  bind: validateControlBind(process.env.YEISME_CONTROL_BIND || baseConfig.bind || "127.0.0.1"),
  ...(file ? { config_file: resolve(file) } : {}),
  providers: { ...(baseConfig.providers || {}), ...Object.fromEntries(providerEntries) },
};
// Persistence: explicit config wins, then beside the config file, then memory.
const dbPath =
  config.database?.path ||
  (config.config_file ? defaultDatabasePath(config.config_file) : ":memory:");
const db = openDatabase(dbPath);
migrateDatabase(db);
const interrupted = new RunStore(db).markInterrupted();
const { handle: app, services } = createControlCenter(config, { db }),
  root = resolve("dist");
// Background observation turns failures into reminders with no browser open. The release candidate check starts the
// server with YEISME_CONTROL_BACKGROUND=off so it never reads an owner on its own.
const backgroundOff = process.env.YEISME_CONTROL_BACKGROUND === "off";
// The observation block is checked once, here. A malformed block is logged by code and treated as switched off; it is
// never an error for the server or for /observation/status.
const observationConfig = observationSettings(config);
if (!observationConfig.valid) console.log(`[control-center] background observation is off: the observation block in the config is invalid (${observationConfig.problems.join(", ")})`);
// Credential problems become reminders too; they are worked out from what the control center already holds, so they
// add no owner request to a cycle.
const observation = observationConfig.enabled && !backgroundOff ? createObservationLoop(services, { credentials: credentialReminders(services) }) : undefined;
if (observation) services.observation = observation;
if (observationConfig.enabled && backgroundOff) console.log("[control-center] background observation is configured but switched off by YEISME_CONTROL_BACKGROUND=off");
// Made once now, off the request path, so a sign-in that names no account costs the same as a real one from the first request on.
void decoyDigest().catch(() => undefined);
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== new URL(config.origin).host) {
      res.writeHead(421);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", config.origin);
    if (url.pathname.startsWith("/api/control-center/")) {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        const limit = url.pathname.includes("/actions/preview") ? 524288 : url.pathname.includes("/notifications/") ? 524288 : 16384;
        if (bytes > limit) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (v) headers.set(k, Array.isArray(v) ? v.join("; ") : v);
      const controller = new AbortController();
      res.once("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const response = await app(
        new Request(url, {
          signal: controller.signal,
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method || "GET")
            ? undefined
            : Buffer.concat(chunks),
        }),
      );
      res.statusCode = response.status;
      response.headers.forEach((v, k) => {
        if (k !== "set-cookie") res.setHeader(k, v);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("set-cookie", cookies);
      if (response.body)
        await pipeline(Readable.fromWeb(response.body as any), res);
      else res.end();
      return;
    }
    if (!["GET", "HEAD"].includes(req.method || "")) {
      res.writeHead(405);
      res.end();
      return;
    }
    const plan = planStatic(root, url.pathname, { range: req.headers.range, ifModifiedSince: req.headers["if-modified-since"] });
    res.writeHead(plan.status, plan.headers);
    if (!plan.file || req.method === "HEAD") {
      res.end(plan.status === 503 ? "Build the client before starting the server." : undefined);
      return;
    }
    // Streamed, so a long video never sits whole in memory; a range sends only its bytes.
    await pipeline(createReadStream(plan.file, plan.start === undefined ? undefined : { start: plan.start, end: plan.end }), res);
  } catch {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"error":"request_failed"}');
  }
});
server.listen(config.port, config.bind, () => {
  console.log(
    "Control center listening on " + config.bind + ":" + config.port,
    dbPath === ":memory:"
      ? "(persistence: memory only)"
      : "(persistence: " + dbPath + ")",
    interrupted > 0 ? "(recovered " + interrupted + " interrupted provider run(s) as unknown)" : "",
  );
  if (observation) {
    observation.start();
    console.log(`[control-center] background observation on: every ${observationConfig.intervalMinutes} min, open tools every ${observationConfig.openToolsEvery} cycles`);
  }
});
// On a signal the server first stops accepting connections, then the running loop is stopped (its timer is cancelled
// and a cycle in flight is waited for, but not for long), then the process leaves. Without a loop the process keeps the
// default behaviour of both signals.
if (observation) {
  let leaving = false;
  const leave = (signal: NodeJS.Signals) => {
    if (leaving) return;
    leaving = true;
    const grace = setTimeout(() => process.exit(0), 8000);
    // No new request may start a read while the last cycle finishes.
    try { server.close(); } catch { /* not listening yet: nothing to stop */ }
    console.log(`[control-center] no longer accepting connections (${signal})`);
    void observation.stop().finally(() => {
      clearTimeout(grace);
      console.log(`[control-center] background observation stopped (${signal})`);
      process.exit(0);
    });
  };
  process.once("SIGTERM", leave);
  process.once("SIGINT", leave);
}
