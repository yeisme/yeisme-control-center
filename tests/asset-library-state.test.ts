import { describe, expect, it } from "vitest";
import { assets } from "../src/data";
import { emptyAssetFilters, filterLibraryAssets, folderMoveError, folderNameError, initialAssetLibrary } from "../src/asset-library-state";

describe("generation library organization", () => {
  it("rejects self and descendant moves without rejecting a different branch", () => {
    const folders = [...initialAssetLibrary().folders, { id: "child", name: "候选", parent: "visual" }];
    expect(Boolean(folderMoveError(folders, "visual", "visual"))).toBe(true);
    expect(Boolean(folderMoveError(folders, "visual", "child"))).toBe(true);
    expect(folderMoveError(folders, "child", "sound")).toBe("");
  });
  it("enforces sibling uniqueness but permits equal names in distinct parents", () => {
    const folders = [...initialAssetLibrary().folders, { id: "child", name: "Draft", parent: "visual" }];
    expect(Boolean(folderNameError(" draft ", folders, "visual"))).toBe(true);
    expect(folderNameError("Draft", folders, "sound")).toBe("");
    expect(Boolean(folderNameError("a/b", folders, null))).toBe(true);
    expect(Boolean(folderNameError(" ", folders, null))).toBe(true);
    expect(Boolean(folderNameError("a".repeat(41), folders, null))).toBe(true);
  });
  it("intersects recursive directories with owner, type, state and note search", () => {
    const state = initialAssetLibrary();
    state.folders.push({ id: "child", name: "待审阅", parent: "visual" });
    state.locations[assets[0].id] = "child";
    state.notes[assets[0].id] = "片头候选";
    const filters = { ...emptyAssetFilters, folder: "visual", owner: "scaena", status: "待审阅" };
    expect(filterLibraryAssets(assets, state, filters, "图像", "雨夜").map((a) => a.id)).toEqual([assets[0].id]);
    expect(filterLibraryAssets(assets, state, filters, "音频", "")).toEqual([]);
    expect(filterLibraryAssets(assets.filter((a) => a.project === "coast"), state, filters, "all", "")).toEqual([]);
  });
  it("keeps favorites and unfiled views restricted to supplied authorization scope", () => {
    const state = initialAssetLibrary();
    state.favorites = [assets[0].id, assets[1].id];
    delete state.locations[assets[1].id];
    const scoped = assets.filter((a) => a.id === assets[1].id);
    expect(filterLibraryAssets(scoped, state, { ...emptyAssetFilters, folder: "favorites" }, "all", "").map((a) => a.id)).toEqual([assets[1].id]);
    expect(filterLibraryAssets(assets, state, { ...emptyAssetFilters, folder: "unfiled" }, "all", "").map((a) => a.id)).toEqual([assets[1].id]);
  });
});
