import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { clientAddress, normalizeAddress } from "../server/client-address";

/**
 * The dev server's proxy (`vite.config.ts`, which `scripts/fixture-preview.ts` and `bun run dev` both use) stands where the TLS front
 * stands in a deployment: the control center believes the last entry of `X-Forwarded-For` from it, as the client's address. So it
 * must put there who is really on its connection, whatever the client wrote. These tests start the dev server on the repository's own
 * configuration, with a stand-in for the control center behind it that records what arrives.
 */
const seen: { forwarded: string | string[] | undefined; peer: string | undefined; headers: IncomingHttpHeaders }[] = [];
let api: Server;
let vite: ViteDevServer;
let port: number;
const cache = mkdtempSync(join(tmpdir(), "yeisme-dev-proxy-"));
const saved = { api: process.env.V18_API_ORIGIN, control: process.env.V18_CONTROL_ORIGIN };

beforeAll(async () => {
  api = createServer((req, res) => {
    seen.push({ forwarded: req.headers["x-forwarded-for"], peer: req.socket.remoteAddress, headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
  await new Promise<void>((done) => api.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  process.env.V18_API_ORIGIN = origin;
  process.env.V18_CONTROL_ORIGIN = origin;
  const quiet = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    vite = await createViteServer({
      configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
      cacheDir: join(cache, "vite"),
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: "127.0.0.1", port: 0, hmr: false, ws: false, watch: null },
    });
    await vite.listen();
  } finally {
    quiet.mockRestore();
  }
  port = (vite.httpServer!.address() as AddressInfo).port;
}, 60_000);

afterAll(async () => {
  await vite?.close();
  await new Promise<void>((done) => { api?.closeAllConnections(); api?.close(() => done()); });
  for (const [name, value] of [["V18_API_ORIGIN", saved.api], ["V18_CONTROL_ORIGIN", saved.control]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(cache, { recursive: true, force: true });
});

/** One request through the dev server's proxy, with the forwarding header(s) the client chooses to send; returns what the control center behind it was given. */
async function through(forwarded?: string | string[]) {
  const before = seen.length;
  await new Promise<void>((done, fail) => {
    const call = request({ host: "127.0.0.1", port, path: "/api/control-center/v1/health", headers: forwarded === undefined ? {} : { "X-Forwarded-For": forwarded } }, (response) => {
      response.resume();
      response.on("end", done);
    });
    call.on("error", fail);
    call.end();
  });
  expect(seen.length).toBe(before + 1);
  return seen[before];
}

describe("the dev server's proxy tells the control center who is really on its connection", () => {
  it("replaces a forwarding header the client wrote with the address of the connection", async () => {
    const arrived = await through("203.0.113.77");
    expect(arrived.forwarded).toBe("127.0.0.1");
    // What the control center would count the sign-in against: the client's real address, not the claimed one.
    expect(clientAddress(arrived.peer, arrived.forwarded as string)).toBe("127.0.0.1");
  });

  it("drops every entry of a longer chain, written as one header or as several", async () => {
    for (const written of ["203.0.113.5, 198.51.100.7", ["203.0.113.5", "198.51.100.7"], "2001:db8::1, ::1, 192.0.2.9"]) {
      const arrived = await through(written);
      expect(arrived.forwarded, JSON.stringify(written)).toBe("127.0.0.1");
      expect(String(arrived.forwarded)).not.toMatch(/203\.0\.113|198\.51\.100|2001:db8|192\.0\.2/);
    }
  });

  it("sets it when the client wrote none, so the control center is never left to guess from the proxy's own address", async () => {
    const arrived = await through();
    expect(normalizeAddress(arrived.forwarded as string)).toBe("127.0.0.1");
  });

  it("makes twenty-five invented addresses one client for the control center's limits", async () => {
    const counted = new Set<string>();
    for (let i = 1; i <= 25; i++) {
      const arrived = await through(`203.0.113.${i}`);
      counted.add(clientAddress(arrived.peer, arrived.forwarded as string));
    }
    expect([...counted]).toEqual(["127.0.0.1"]);
  });

  it("keeps the proxy's own work: the host and origin the control center expects", async () => {
    const arrived = await through("203.0.113.1");
    expect(arrived.headers.host).toBe(new URL(process.env.V18_CONTROL_ORIGIN!).host);
    expect(arrived.headers.origin).toBe(new URL(process.env.V18_CONTROL_ORIGIN!).origin);
  });
});
