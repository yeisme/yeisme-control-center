import { describe, expect, it } from "vitest";
import { assetViewLabel, parseAssetInspectorMode, parseAssetViewMode } from "../src/pages/assets/asset-view";

describe("asset library view state", () => {
  it("defaults unknown view values to the large gallery", () => {
    expect(parseAssetViewMode(null)).toBe("gallery");
    expect(parseAssetViewMode("table")).toBe("gallery");
    expect(assetViewLabel(parseAssetViewMode("gallery"))).toBe("大图网格");
  });

  it("keeps supported list modes and inspector preference", () => {
    expect(parseAssetViewMode("list")).toBe("list");
    expect(parseAssetViewMode("compact")).toBe("compact");
    expect(parseAssetInspectorMode("floating")).toBe("floating");
    expect(parseAssetInspectorMode("dock")).toBe("fixed");
  });
});
