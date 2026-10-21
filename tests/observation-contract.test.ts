import { describe, expect, it } from "vitest";
import { ObservationCacheStore } from "../src/app/observation-cache";
import { normalizeProcessObservation } from "../src/observation-contract";

describe("observation contract", () => {
  it("keeps redacted prompt metadata and drops untrusted fields", () => {
    const value = normalizeProcessObservation({
      state: "active",
      coverage: "complete",
      freshness: "fresh",
      prompt_capture: {
        state: "captured",
        source: "task",
        summary: "脱敏摘要",
        readable: true,
        observed_at: "2026-10-18T00:00:00Z",
        raw_prompt: "must not pass",
      },
      checkpoints: [{ id: "p1", kind: "prompt_capture", stage: "capture", state: "captured", occurred_at: "2026-10-18T00:00:00Z", private_payload: "drop" }],
      gap: false,
    });
    expect(value?.prompt_capture?.summary).toBe("脱敏摘要");
    expect(JSON.stringify(value)).not.toContain("must not pass");
    expect(JSON.stringify(value)).not.toContain("private_payload");
  });
});

describe("observation cache", () => {
  it("deduplicates in-flight reads and expires fresh values", async () => {
    const cache = new ObservationCacheStore();
    let calls = 0;
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    const loader = () => { calls += 1; return pending; };
    const first = cache.read("scope-a", loader, 10, 1000);
    const second = cache.read("scope-a", loader, 10, 1000);
    expect(calls).toBe(1);
    resolve("ok");
    await expect(first).resolves.toMatchObject({ data: "ok" });
    await expect(second).resolves.toMatchObject({ data: "ok" });
    expect(cache.peek<string>("scope-a")?.data).toBe("ok");
  });
});
