import { describe, expect, it } from "vitest";
import { releaseVelocity, sheetDragOffset, sheetRelease } from "../src/shared/sheet-drag";

describe("dragging the phone sheet by its top", () => {
  it("follows the finger down and only gives a little when pulled up", () => {
    expect(sheetDragOffset(120)).toBe(120);
    expect(sheetDragOffset(-4)).toBe(-4);
    expect(sheetDragOffset(-400)).toBe(-24);
    expect(sheetDragOffset(Number.NaN)).toBe(0);
  });

  it("closes past 140 px or a quarter of a short sheet, or on a downward flick", () => {
    expect(sheetRelease(150, 0, 800)).toBe("close");
    expect(sheetRelease(130, 0, 800)).toBe("settle");
    expect(sheetRelease(60, 0, 200)).toBe("close");
    expect(sheetRelease(30, 0.8, 800)).toBe("close");
    expect(sheetRelease(12, 0.8, 800)).toBe("settle");
    expect(sheetRelease(-10, 2, 800)).toBe("settle");
  });

  it("measures the speed over the last 80 ms", () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ y: 0, t: 0 }])).toBe(0);
    expect(releaseVelocity([{ y: 0, t: 0 }, { y: 10, t: 100 }, { y: 50, t: 140 }, { y: 90, t: 180 }])).toBe(1);
  });
});
