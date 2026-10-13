import { describe, expect, it } from "vitest";
import {
  pushBrowse,
  moveBrowse,
  sortObjects,
  nextItemIndex,
  type BrowseSnapshot,
} from "../src/finder-state";
const snapshot: BrowseSnapshot = {
  page: "projects",
  env: "main",
  project: "all",
  query: "雨",
  filter: "all",
  selection: { kind: "project", id: "rain" },
  scroll: 180,
  inspector: true,
};
describe("Finder browsing state", () => {
  it("restores selection, filter and scroll on back, truncating forward on a new visit", () => {
    const target = {
      ...snapshot,
      page: "tasks" as const,
      project: "rain",
      query: "",
      selection: null,
      scroll: 0,
    };
    const history = pushBrowse(
      { entries: [snapshot], index: 0 },
      snapshot,
      target,
    );
    const back = moveBrowse(history, target, -1)!;
    expect(back.snapshot).toEqual(snapshot);
    const next = pushBrowse(back.history, snapshot, {
      ...snapshot,
      page: "assets",
    });
    expect(next.entries.map((e) => e.page)).toEqual(["projects", "assets"]);
    expect(moveBrowse(next, next.entries[1], 1)).toBeNull();
  });
  it("rejects history across environments and preserves bounded history", () => {
    expect(
      moveBrowse(
        { entries: [{ ...snapshot, env: "staging" }, snapshot], index: 1 },
        snapshot,
        -1,
      ),
    ).toBeNull();
    let history = { entries: [snapshot], index: 0 };
    for (let i = 0; i < 50; i++) {
      const current = history.entries[history.index];
      history = pushBrowse(history, current, {
        ...snapshot,
        page: i % 2 ? "assets" : "tasks",
      });
    }
    expect(history.entries).toHaveLength(40);
    expect(history.index).toBe(39);
  });
  it("sorts naturally without changing source state and keeps missing data last", () => {
    const values = [
      { id: "b", name: "文件 10", updated: "14:21" },
      { id: "a", name: "文件 2", updated: "14:35" },
      { id: "c", name: "文件 1" },
    ];
    expect(sortObjects(values, "name-asc").map((v) => v.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(sortObjects(values, "updated").map((v) => v.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(values.map((v) => v.id)).toEqual(["b", "a", "c"]);
  });
  it("moves within list and grid boundaries including empty results", () => {
    expect(nextItemIndex(0, "ArrowLeft", 3)).toBe(0);
    expect(nextItemIndex(1, "ArrowDown", 9, 3)).toBe(4);
    expect(nextItemIndex(8, "ArrowDown", 9, 3)).toBe(8);
    expect(nextItemIndex(4, "Home", 9)).toBe(0);
    expect(nextItemIndex(0, "End", 9)).toBe(8);
    expect(nextItemIndex(0, "ArrowDown", 0)).toBe(-1);
  });
});
