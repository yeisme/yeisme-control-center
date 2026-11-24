import { describe, expect, it } from "vitest";
import { facetCounts } from "../src/shared/facets";

describe("facet counts", () => {
  it("counts each option given every other filter, never its own", () => {
    const rows = [{ state: "failed", owner: "eikona" }, { state: "failed", owner: "sonora" }, { state: "running", owner: "eikona" }];
    const selected: Record<string, string> = { state: "failed", owner: "eikona" };
    const counts = facetCounts(rows, ["state", "owner"], (row, key) => row[key as "state" | "owner"], (row, except) => Object.entries(selected).every(([key, value]) => key === except || row[key as "state" | "owner"] === value));
    expect(counts.state).toEqual({ failed: 1, running: 1 });
    expect(counts.owner).toEqual({ eikona: 1, sonora: 1 });
  });

  it("counts a row once per value even when a row lists a value twice", () => {
    expect(facetCounts([{ tags: ["a", "a", "b"] }], ["tags"], (row) => row.tags, () => true)).toEqual({ tags: { a: 1, b: 1 } });
  });
});
