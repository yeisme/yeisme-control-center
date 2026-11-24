import { describe, expect, it } from "vitest";
import { defaultInspectorWidth, draggedInspectorWidth, inspectorWidthLimits, inspectorWidthValue, keyedInspectorWidth, shownInspectorWidth, snapDistance, snappedInspectorWidth } from "../src/shared/inspector-size";

describe("the docked inspector's width", () => {
  it("defaults to clamp(400px, 34vw, 520px), so a 2048 screen still gets 520", () => {
    expect(defaultInspectorWidth(1280)).toBe(435);
    expect(defaultInspectorWidth(1440)).toBe(490);
    expect(defaultInspectorWidth(2048)).toBe(520);
    expect(defaultInspectorWidth(1000)).toBe(400);
  });

  it("stays between 400 and 720 and leaves the page 480 px beside the navigation", () => {
    expect(inspectorWidthLimits(2048)).toEqual({ min: 400, max: 720 });
    expect(inspectorWidthLimits(1280)).toEqual({ min: 400, max: 712 });
    expect(inspectorWidthLimits(900)).toEqual({ min: 400, max: 400 });
    expect(shownInspectorWidth(null, 1440)).toBe(490);
    expect(shownInspectorWidth(900, 1280)).toBe(712);
    expect(shownInspectorWidth(300, 1440)).toBe(400);
  });

  it("answers the handle's keys like a window splitter on the panel's left edge", () => {
    expect(keyedInspectorWidth(520, "ArrowLeft", false, 1440)).toBe(536);
    expect(keyedInspectorWidth(520, "ArrowRight", false, 1440)).toBe(504);
    expect(keyedInspectorWidth(520, "ArrowRight", true, 1440)).toBe(456);
    expect(keyedInspectorWidth(700, "ArrowLeft", true, 1440)).toBe(720);
    expect(keyedInspectorWidth(410, "ArrowRight", false, 1440)).toBe(400);
    expect(keyedInspectorWidth(520, "Home", false, 1440)).toBe(400);
    expect(keyedInspectorWidth(520, "End", false, 1280)).toBe(712);
    expect(keyedInspectorWidth(520, "Enter", false, 1440)).toBeNull();
    expect(keyedInspectorWidth(520, "ArrowUp", false, 1440)).toBeUndefined();
  });

  it("follows the pointer while dragged, within the limits", () => {
    expect(draggedInspectorWidth(520, 900, 860, 1440)).toBe(560);
    expect(draggedInspectorWidth(520, 900, 1100, 1440)).toBe(400);
    expect(draggedInspectorWidth(520, 900, 100, 1440)).toBe(720);
  });

  it("writes a CSS width that still gives way to the page when the window narrows", () => {
    expect(inspectorWidthValue(null)).toBeNull();
    expect(inspectorWidthValue(Number.NaN)).toBeNull();
    expect(inspectorWidthValue(600)).toBe("clamp(400px, 600px, max(400px, calc(100vw - 568px)))");
  });

  it("settles a drag near the default width on the default, which then follows the window again", () => {
    const preset = shownInspectorWidth(null, 1440);
    expect(snappedInspectorWidth(preset + snapDistance, 1440)).toEqual({ width: preset, chosen: null });
    expect(snappedInspectorWidth(preset - snapDistance, 1440)).toEqual({ width: preset, chosen: null });
    expect(snappedInspectorWidth(preset + snapDistance + 1, 1440)).toEqual({ width: preset + snapDistance + 1, chosen: preset + snapDistance + 1 });
    expect(snappedInspectorWidth(640, 1440)).toEqual({ width: 640, chosen: 640 });
  });
});
