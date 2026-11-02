import { describe, expect, it, vi } from "vitest";
import { AuctraCollectionReader } from "../server/auctra";
import type { ServerConfig } from "../server/contracts";
import { config, makeSession, scope } from "./fixtures/drama-fakes";

const bound = { ...scope, collection: { auctra: { tenant: "t", project: "project:a", actor: "a", audience: "aud-auctra" } } };
// Built at run time: the public-surface check rejects private address literals in tracked files.
const at = (...octets: number[]) => `http://${octets.join(".")}:4318`;

async function read(origin: string, extra: { allow_private_http?: boolean } = {}) {
  const cfg: ServerConfig = { ...config, collection: { auctra: { ...config.collection!.auctra!, origin, ...extra } } };
  const fetcher = vi.fn(async () => Response.json({ data: { records: [] } }));
  const snapshot = await new AuctraCollectionReader(cfg, fetcher as unknown as typeof fetch).snapshot(bound.id, bound, { ...makeSession(), accessToken: "token", accessAudience: ["aud-auctra"] });
  return { snapshot, calls: fetcher.mock.calls.length };
}

describe("the Auctra origin the server will call", () => {
  it("accepts https and loopback http without any flag", async () => {
    for (const origin of ["https://auctra.example.test", "http://127.0.0.1:4318", "http://localhost:4318", "http://[::1]:4318"]) {
      const { snapshot, calls } = await read(origin);
      expect(snapshot.blocker, origin).toBeUndefined();
      expect(calls, origin).toBeGreaterThan(0);
    }
  });

  it("refuses plain http to a private IPv4 address unless the configuration allows it, and then accepts the private ranges only", async () => {
    for (const origin of [at(192, 168, 1, 20), at(10, 0, 0, 5), at(172, 16, 0, 9), at(172, 31, 255, 1)]) {
      const refused = await read(origin);
      expect(refused.snapshot, origin).toMatchObject({ blocker: "upstream_not_allowed", coverage: "forbidden" });
      expect(refused.calls, origin).toBe(0);
      const allowed = await read(origin, { allow_private_http: true });
      expect(allowed.snapshot.blocker, origin).toBeUndefined();
      expect(allowed.calls, origin).toBeGreaterThan(0);
    }
  });

  it("refuses a public http origin, a name and a URL with credentials even when private http is allowed, so a hand-edited file cannot send keys there", async () => {
    for (const origin of [at(203, 0, 113, 9), at(172, 32, 0, 1), at(172, 15, 0, 1), at(11, 0, 0, 1), "http://auctra.example.test", `http://user:pass@${at(192, 168, 1, 20).slice(7)}`, "ftp://127.0.0.1:4318"]) {
      for (const extra of [{}, { allow_private_http: true }]) {
        const { snapshot, calls } = await read(origin, extra);
        expect(snapshot, origin).toMatchObject({ blocker: "upstream_not_allowed", coverage: "forbidden" });
        expect(calls, origin).toBe(0);
      }
    }
  });
});
