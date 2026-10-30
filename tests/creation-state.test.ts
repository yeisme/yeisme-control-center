import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("batch creation draft state", () => {
  it("clears owner observations when adding a generation item", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/pages/creation/BatchGeneration.tsx"), "utf8");
    expect(source).toContain("setRows((list) => [...list, draft()]); resetDraftState();");
  });
});
