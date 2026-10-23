import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { createApp } from "./app";
import { validateControlBind, validateControlOrigin } from "./auth";
import type { ServerConfig } from "./contracts";
import {
  defaultDatabasePath,
  migrateDatabase,
  openDatabase,
} from "./db/client";
import { RunStore } from "./db/run-store";
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
const app = createApp(config, { db }),
  root = resolve("dist"),
  types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
createServer(async (req, res) => {
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
        const limit = url.pathname.includes("/actions/preview") ? 524288 : url.pathname.includes("/notifications/") ? 262144 : 16384;
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
    const target = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!target.startsWith(root + sep) && target !== root) {
      res.writeHead(404);
      res.end();
      return;
    }
    const path =
      existsSync(target) && statSync(target).isFile()
        ? target
        : resolve(root, "index.html");
    if (!existsSync(path)) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Build the client before starting the server.");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : readFileSync(path));
  } catch {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"error":"request_failed"}');
  }
}).listen(config.port, config.bind, () =>
  console.log(
    "Control center listening on " + config.bind + ":" + config.port,
    dbPath === ":memory:"
      ? "(persistence: memory only)"
      : "(persistence: " + dbPath + ")",
    interrupted > 0 ? "(recovered " + interrupted + " interrupted provider run(s) as unknown)" : "",
  ),
);
