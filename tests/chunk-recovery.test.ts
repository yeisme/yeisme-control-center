import { describe, expect, it } from "vitest";
import { claimChunkReload, isChunkLoadError, mayReloadForChunk } from "../src/app/chunk-recovery";

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

describe("isChunkLoadError", () => {
  it("recognises failed dynamic imports in Chrome, Firefox and Safari, and nothing else", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1/assets/UsageAnalytics-x.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: http://127.0.0.1/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'rows')"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("claimChunkReload", () => {
  it("allows one automatic reload a minute", () => {
    const storage = memory();
    expect(mayReloadForChunk(storage, 1_000_000)).toBe(true);
    expect(claimChunkReload(storage, 1_000_000)).toBe(true);
    expect(mayReloadForChunk(storage, 1_030_000)).toBe(false);
    expect(claimChunkReload(storage, 1_030_000)).toBe(false);
    expect(claimChunkReload(storage, 1_060_000)).toBe(true);
  });
});
