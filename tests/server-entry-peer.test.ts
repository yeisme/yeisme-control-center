import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

/**
 * The sign-in limits count a client by the address on the connection, and the connection's socket stops knowing it once the client
 * has reset the connection: a request that was already whole would then be counted as coming from nowhere. So the handler of each
 * HTTP entry reads `req.socket.remoteAddress` first, before anything is awaited. These entries are scripts that start a server, so
 * what is checked is the source: where the address is read, relative to the first `await`.
 */
describe("the HTTP entries read the peer address before they await anything", () => {
  for (const [file, handler] of [["server/index.ts", "createServer(async (req, res) =>"], ["scripts/fixture-preview.ts", "createHttpServer(async (req, res) =>"]] as const) {
    it(`${file}: the peer is read at the top of the request handler and the request is handed it`, () => {
      const source = readFileSync(join(root, file), "utf8");
      const start = source.indexOf(handler);
      expect(start, `${handler} in ${file}`).toBeGreaterThan(-1);
      const body = source.slice(start);
      const read = body.indexOf("req.socket.remoteAddress");
      const firstAwait = body.search(/\bawait\b/);
      expect(read, "the peer is read").toBeGreaterThan(-1);
      expect(firstAwait, "the handler awaits").toBeGreaterThan(-1);
      expect(read).toBeLessThan(firstAwait);
      // Read once, and passed on as read: not asked of the socket again later.
      expect(body.match(/req\.socket\.remoteAddress/g)).toHaveLength(1);
      expect(body).toMatch(/\bpeer\b[\s\S]*\{ peer \}|handle\([\s\S]*?\bpeer\b\)/);
    });
  }
});
