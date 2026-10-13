import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { createApp } from "./app";
import type { ServerConfig } from "./contracts";
const file = process.env.YEISME_CONTROL_CONFIG;
const config: ServerConfig = file
  ? JSON.parse(readFileSync(file, "utf8"))
  : { origin: "http://127.0.0.1:4312", port: 4312, principals: [], owners: {} };
const app = createApp(config),
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
        if (bytes > 4096) {
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
}).listen(config.port, "127.0.0.1", () =>
  console.log("Control center listening on loopback port " + config.port),
);
