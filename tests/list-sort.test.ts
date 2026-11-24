import { describe, expect, it } from "vitest";
import { ariaSort, formatSort, nextSort, parseSort, sortRows } from "../src/shared/list-sort";

describe("list sort", () => {
  it("reads only columns the list offers", () => {
    expect(parseSort("updated:desc", ["updated", "state"])).toEqual({ id: "updated", dir: "desc" });
    expect(parseSort("secret:asc", ["updated"])).toBeNull();
    expect(parseSort("updated:sideways", ["updated"])).toBeNull();
    expect(parseSort(null, ["updated"])).toBeNull();
    expect(formatSort({ id: "state", dir: "asc" })).toBe("state:asc");
    expect(formatSort(null)).toBeNull();
  });

  it("cycles a header: its natural direction, flipped, then the list's own order", () => {
    const first = nextSort(null, "updated", "desc");
    expect(first).toEqual({ id: "updated", dir: "desc" });
    const second = nextSort(first, "updated", "desc");
    expect(second).toEqual({ id: "updated", dir: "asc" });
    expect(nextSort(second, "updated", "desc")).toBeNull();
    expect(nextSort(second, "title")).toEqual({ id: "title", dir: "asc" });
  });

  it("sorts stably, Chinese text by collation with numbers by value, and missing values last either way", () => {
    const rows = [{ t: "第 10 集", n: 3 }, { t: "第 2 集", n: null }, { t: "第 2 集", n: 1 }, { t: "", n: 2 }];
    expect(sortRows(rows, (row) => row.t, "asc").map((row) => `${row.t}|${row.n}`)).toEqual(["第 2 集|null", "第 2 集|1", "第 10 集|3", "|2"]);
    expect(sortRows(rows, (row) => row.n, "desc").map((row) => row.n)).toEqual([3, 2, 1, null]);
    expect(sortRows(rows, (row) => row.n, "asc").map((row) => row.n)).toEqual([1, 2, 3, null]);
    expect(rows[0].t).toBe("第 10 集");
  });

  it("marks only the sorted header", () => {
    expect(ariaSort({ id: "updated", dir: "desc" }, "updated")).toBe("descending");
    expect(ariaSort({ id: "updated", dir: "asc" }, "updated")).toBe("ascending");
    expect(ariaSort({ id: "updated", dir: "asc" }, "state")).toBe("none");
    expect(ariaSort(null, "state")).toBe("none");
  });
});
