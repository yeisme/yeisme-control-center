import { describe, expect, it, vi } from "vitest";
import { OBSERVATION_CACHE_POLICIES, ObservationCacheStore } from "../src/app/observation-cache";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("observation cache", () => {
  it("returns fresh values without reloading", async () => {
    const cache = new ObservationCacheStore();
    const loader = vi.fn(async () => "one");
    expect(await cache.read("k", loader, 10_000, 20_000)).toMatchObject({ data: "one", stale: false });
    expect(await cache.read("k", loader, 10_000, 20_000)).toMatchObject({ data: "one", stale: false });
    expect(loader).toHaveBeenCalledOnce();
  });

  it("returns stale immediately and starts one background revalidation", async () => {
    vi.useFakeTimers();
    try {
      const cache = new ObservationCacheStore();
      const first = vi.fn(async () => "old");
      await cache.read("k", first, 10, 100);
      vi.advanceTimersByTime(11);
      const pending = deferred<string>();
      const second = vi.fn(() => pending.promise);
      expect(await cache.read("k", second, 10, 100)).toMatchObject({ data: "old", stale: true });
      expect(await cache.read("k", second, 10, 100)).toMatchObject({ data: "old", stale: true });
      expect(second).toHaveBeenCalledOnce();
      pending.resolve("new");
      await vi.waitFor(() => expect(cache.peek<string>("k")?.data).toBe("new"));
    } finally { vi.useRealTimers(); }
  });

  it("does not cache errors and retries on the next read", async () => {
    const cache = new ObservationCacheStore();
    const fail = vi.fn(async () => { throw new Error("temporary"); });
    await expect(cache.read("k", fail, 10_000, 20_000)).rejects.toThrow("temporary");
    expect(cache.peek("k")).toBeNull();
    await expect(cache.read("k", async () => "recovered", 10_000, 20_000)).resolves.toMatchObject({ data: "recovered", stale: false });
  });

  it("deduplicates consumers while allowing one consumer to abort", async () => {
    const cache = new ObservationCacheStore();
    const pending = deferred<string>();
    const loader = vi.fn((signal: AbortSignal) => {
      signal.addEventListener("abort", () => pending.reject(new DOMException("aborted", "AbortError")), { once: true });
      return pending.promise;
    });
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.read("k", loader, 10_000, 20_000, a.signal);
    const second = cache.read("k", loader, 10_000, 20_000, b.signal);
    a.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(loader).toHaveBeenCalledOnce();
    pending.resolve("ok");
    await expect(second).resolves.toMatchObject({ data: "ok", stale: false });
  });

  it("aborts the shared loader when the last consumer leaves", async () => {
    const cache = new ObservationCacheStore();
    const pending = deferred<string>();
    const loader = vi.fn((signal: AbortSignal) => {
      signal.addEventListener("abort", () => pending.reject(new DOMException("aborted", "AbortError")), { once: true });
      return pending.promise;
    });
    const controller = new AbortController();
    const read = cache.read("k", loader, 10_000, 20_000, controller.signal);
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    await expect(cache.read("k", async () => "retry", 10_000, 20_000)).resolves.toMatchObject({ data: "retry", stale: false });
  });

  it("drops late responses after identity change and precise invalidation", async () => {
    const cache = new ObservationCacheStore();
    cache.setIdentity("scope-a|epoch-1");
    const pending = deferred<string>();
    const controller = new AbortController();
    const read = cache.read("k", (signal) => {
      signal.addEventListener("abort", () => pending.reject(new DOMException("aborted", "AbortError")), { once: true });
      return pending.promise;
    }, 10_000, 20_000, controller.signal);
    cache.setIdentity("scope-b|epoch-2");
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    pending.resolve("old");
    expect(cache.peek("k")).toBeNull();
    await cache.read("a", async () => "a", 10_000, 20_000);
    await cache.read("b", async () => "b", 10_000, 20_000);
    cache.invalidate("a");
    expect(cache.peek("a")).toBeNull();
    expect(cache.peek<string>("b")?.data).toBe("b");
  });

  it("exposes explicit policies for the shared read resources", () => {
    expect(OBSERVATION_CACHE_POLICIES).toMatchObject({
      taskActive: { freshMs: 3_000, staleMs: 15_000 },
      taskHistory: { freshMs: 30_000, staleMs: 300_000 },
      taskEvents: { freshMs: 3_000, staleMs: 15_000 },
      requests: { freshMs: 10_000, staleMs: 60_000 },
      toolCatalog: { freshMs: 300_000, staleMs: 1_800_000 },
    });
  });
});
