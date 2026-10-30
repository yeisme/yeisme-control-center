import { describe, expect, it } from "vitest";
import { clampPan, fitted, maxZoom, slidePosition, stepSlide, stepWhere, swipeIntent, toggleZoom, zoomAt, zoomPercent } from "../src/shared/viewer";

describe("media viewer helpers", () => {
  it("zooms about the pointer so the image point under it stays put", () => {
    const zoomed = zoomAt(fitted, 2, { x: 100, y: -40 });
    expect(zoomed).toEqual({ scale: 2, x: -100, y: 40 });
    // The image point under the pointer before (100,-40 at scale 1) maps back to the same screen point.
    expect(zoomed.x + 2 * 100).toBe(100);
    expect(zoomAt(zoomed, 1, { x: 0, y: 0 })).toEqual(fitted);
    expect(zoomAt(fitted, 99).scale).toBe(maxZoom);
    expect(zoomAt(fitted, Number.NaN)).toEqual(fitted);
  });

  it("limits panning to the overflow of a zoomed image", () => {
    const content = { width: 400, height: 300 };
    const stage = { width: 600, height: 400 };
    expect(clampPan({ scale: 2, x: 500, y: -500 }, content, stage)).toEqual({ scale: 2, x: 100, y: -100 });
    expect(clampPan({ scale: 1.2, x: 50, y: 50 }, content, stage)).toEqual({ scale: 1.2, x: 0, y: 0 });
  });

  it("toggles between fit and a pointer zoom on double click", () => {
    const zoomed = toggleZoom(fitted, { x: 10, y: 10 });
    expect(zoomed.scale).toBe(2.5);
    expect(toggleZoom(zoomed, { x: 0, y: 0 })).toEqual(fitted);
    expect(zoomPercent(zoomed)).toBe("250%");
  });

  it("reads only deliberate horizontal swipes as navigation", () => {
    expect(swipeIntent(-80, 10)).toBe(1);
    expect(swipeIntent(90, -20)).toBe(-1);
    expect(swipeIntent(-30, 0)).toBe(0);
    expect(swipeIntent(-80, 75)).toBe(0);
  });

  it("steps through slides without wrapping and labels the position", () => {
    const slides = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(stepSlide(slides, "b", 1)).toBe("c");
    expect(stepSlide(slides, "c", 1)).toBeNull();
    expect(stepSlide(slides, "a", -1)).toBeNull();
    expect(stepSlide(slides, "missing", 1)).toBeNull();
    expect(slidePosition(slides, "b")).toEqual({ index: 1, total: 3, label: "2 / 3" });
    expect(slidePosition(slides, null).label).toBe("");
  });
});

describe("stepWhere", () => {
  const set = [{ key: "a", kind: "image" }, { key: "b", kind: "video" }, { key: "c", kind: "image" }, { key: "d", kind: "image" }];
  const otherImage = (pinned: string) => (slide: { key: string; kind: string }) => slide.kind === "image" && slide.key !== pinned;

  it("walks past ineligible slides in either direction and stops at the ends", () => {
    expect(stepWhere(set, "a", 1, otherImage("a"))).toBe("c");
    expect(stepWhere(set, "c", 1, otherImage("a"))).toBe("d");
    expect(stepWhere(set, "d", 1, otherImage("a"))).toBeNull();
    expect(stepWhere(set, "c", -1, otherImage("a"))).toBeNull();
    expect(stepWhere(set, "d", -1, otherImage("c"))).toBe("a");
    expect(stepWhere(set, "missing", 1, () => true)).toBeNull();
  });
});
