import { describe, expect, it, vi } from "vitest";
import { MediaSessionCache } from "../src/app/media-cache";

describe("media session cache", () => {
  it("deduplicates loads and evicts least recently used entries", async () => {
    const revoked: string[] = [];
    let created = 0;
    const cache = new MediaSessionCache({
      maxEntries: 1,
      createObjectURL: () => `blob:${++created}`,
      revokeObjectURL: (url) => revoked.push(url),
    });
    let calls = 0;
    const loader = () => {
      calls += 1;
      return Promise.resolve({ blob: new Blob(["ok"], { type: "audio/wav" }), expiresAt: Date.now() + 10_000 });
    };
    const [first, second] = await Promise.all([cache.load("a", loader), cache.load("a", loader)]);
    expect(first?.url).toBe("blob:1");
    expect(second?.url).toBe("blob:1");
    expect(calls).toBe(1);
    await cache.load("b", loader);
    expect(cache.get("a")).toBeNull();
    expect(revoked).toContain("blob:1");
  });

  it("clears on identity changes and ignores expired entries", async () => {
    const revoke = vi.fn();
    const cache = new MediaSessionCache({ createObjectURL: () => "blob:1", revokeObjectURL: revoke });
    cache.setIdentity("scope-a|1");
    await cache.load("a", () => Promise.resolve({ blob: new Blob(["ok"]), expiresAt: Date.now() + 1_000 }));
    cache.setIdentity("scope-b|1");
    expect(cache.get("a")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:1");
    await cache.load("expired", () => Promise.resolve({ blob: new Blob(["old"]), expiresAt: Date.now() - 1 }));
    expect(cache.get("expired")).toBeNull();
  });

  it("propagates loader failures so playback can classify the owner error", async () => {
    const cache = new MediaSessionCache();
    await expect(cache.load("failed", async () => { throw new Error("media_source_not_found"); })).rejects.toThrow("media_source_not_found");
    await expect(cache.load("failed", async () => ({ blob: new Blob(["ok"], { type: "audio/wav" }), expiresAt: Date.now() + 1000 }))).resolves.toBeTruthy();
  });
});
