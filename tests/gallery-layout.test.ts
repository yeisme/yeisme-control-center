import { describe, expect, it } from "vitest";
import { gridColumns, justifiedTile, rowHeight, tileRatio } from "../src/pages/assets/gallery-layout";

describe("the works gallery", () => {
  it("keeps each picture's shape within 1:2 and 2.4:1, and reads a missing size as 16:10", () => {
    expect(tileRatio(1920, 1080)).toBeCloseTo(16 / 9);
    expect(tileRatio(240, 320)).toBe(0.75);
    expect(tileRatio(100, 1000)).toBe(0.5);
    expect(tileRatio(4000, 100)).toBe(2.4);
    expect(tileRatio(undefined, 320)).toBe(1.6);
    expect(tileRatio(0, 0)).toBe(1.6);
  });

  it("sizes 按比例 rows from the same tile setting as the grid", () => {
    expect(rowHeight(240)).toBe(150);
    expect(justifiedTile(0.75, 240)).toEqual({ flexGrow: 0.75, flexBasis: "113px" });
    expect(justifiedTile(1.6, 200)).toEqual({ flexGrow: 1.6, flexBasis: "200px" });
    expect(gridColumns(240)).toBe("repeat(auto-fill, minmax(min(240px, 100%), 1fr))");
  });
});
