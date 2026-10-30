import { describe, expect, it } from "vitest";
import { assetViewLabel, matchesAssetDate, matchesAssetFilters, parseAssetCatalog, parseAssetInspectorMode, parseAssetViewMode } from "../src/pages/assets/asset-view";

describe("asset library view state", () => {
  it("defaults unknown view values to the large gallery", () => {
    expect(parseAssetViewMode(null)).toBe("gallery");
    expect(parseAssetViewMode("table")).toBe("gallery");
    expect(assetViewLabel(parseAssetViewMode("gallery"))).toBe("大图网格");
  });

  it("keeps the owner catalog unless the shared catalog is explicit", () => {
    expect(parseAssetCatalog(null)).toBe("owner");
    expect(parseAssetCatalog("project")).toBe("owner");
    expect(parseAssetCatalog("shared")).toBe("shared");
  });

  it("filters loaded assets without treating a missing time as a date match", () => {
    const entry = { kind: "image", result: { name: "海报", state: "ready" }, task: { title: "封面", state: "succeeded", updated_at: "2026-10-02T00:00:00Z", created_at: null, locator: { owner: "eikona", project: "proj", task_ref: "task-1" } } };
    const filters = { kind: "all", owner: "", project: "", access: "all", result: "", task: "", from: "", to: "", text: "" };
    expect(matchesAssetFilters(entry, { ...filters, project: "proj", result: "ready" }, true)).toBe(true);
    expect(matchesAssetFilters(entry, { ...filters, access: "locked" }, true)).toBe(false);
    expect(matchesAssetFilters({ ...entry, task: { ...entry.task, updated_at: null, created_at: null } }, { ...filters, from: "2026-10-01" }, true)).toBe(false);
    expect(matchesAssetDate("2026-10-02T00:00:00Z", "2026-10-01", "2026-10-02")).toBe(true);
  });

  it("keeps supported list modes and inspector preference", () => {
    expect(parseAssetViewMode("list")).toBe("list");
    expect(parseAssetViewMode("compact")).toBe("compact");
    expect(parseAssetInspectorMode("floating")).toBe("floating");
    expect(parseAssetInspectorMode("dock")).toBe("fixed");
  });
});
