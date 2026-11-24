import { describe, expect, it } from "vitest";
import { actualPixels, coastSpeed, dismissIntent, dragAxis, isDoubleTap, originTransform, panVelocity, pinchScale, pullOpacity, rubberBand } from "../src/shared/viewer-gestures";

describe("viewer gestures", () => {
  it("lets a drag past either end follow less and less, never beyond the limit", () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(72)).toBe(36);
    expect(rubberBand(-72)).toBe(-36);
    expect(rubberBand(10_000)).toBeLessThan(72);
    expect(rubberBand(Number.NaN)).toBe(0);
  });

  it("decides the axis after 8 px and closes on a long pull or a flick down", () => {
    expect(dragAxis(3, 4)).toBeNull();
    expect(dragAxis(30, 10)).toBe("x");
    expect(dragAxis(5, -40)).toBe("y");
    expect(dismissIntent(130, 0)).toBe(true);
    expect(dismissIntent(50, 0.8)).toBe(true);
    expect(dismissIntent(50, 0.2)).toBe(false);
    expect(dismissIntent(30, 2)).toBe(false);
    expect(pullOpacity(0)).toBe(1);
    expect(pullOpacity(240)).toBe(0.5);
    expect(pullOpacity(-20)).toBe(1);
  });

  it("pinches within the zoom range", () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(2, 100, 50)).toBe(1);
    expect(pinchScale(4, 100, 400)).toBe(6);
    expect(pinchScale(2, 0, 100)).toBe(2);
  });

  it("finds 1:1 and never zooms out below fit", () => {
    expect(actualPixels({ width: 4000, height: 3000 }, { width: 1000, height: 750 })).toBe(4);
    expect(actualPixels({ width: 240, height: 320 }, { width: 240, height: 320 })).toBe(1);
    expect(actualPixels({ width: 9000, height: 100 }, { width: 900, height: 10 })).toBe(6);
    expect(actualPixels({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });

  it("knows a double tap and where the viewer grows from", () => {
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 14, y: 12, t: 250 })).toBe(true);
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 60, y: 12, t: 250 })).toBe(false);
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 400 })).toBe(false);
    expect(isDoubleTap(null, { x: 10, y: 10, t: 0 })).toBe(false);
    expect(originTransform({ x: 100, y: 100, width: 248, height: 155 }, { width: 1440, height: 960 })).toEqual({ x: -496, y: -302, scale: 0.215 });
  });

  it("lets a zoomed picture glide after a pan and slow down the same at any frame rate", () => {
    expect(panVelocity([])).toEqual({ x: 0, y: 0 });
    expect(panVelocity([{ x: 0, y: 0, t: 0 }, { x: 40, y: -20, t: 100 }, { x: 120, y: -60, t: 180 }])).toEqual({ x: 1, y: -0.5 });
    expect(coastSpeed({ x: 1, y: -0.5 }, 16)).toEqual({ x: 0.92, y: -0.46 });
    const twice = coastSpeed(coastSpeed({ x: 1, y: 0 }, 16), 16).x;
    expect(coastSpeed({ x: 1, y: 0 }, 32).x).toBeCloseTo(twice);
    expect(coastSpeed({ x: 1, y: 0 }, -5).x).toBe(1);
  });
});
