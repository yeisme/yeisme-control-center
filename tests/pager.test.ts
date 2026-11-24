import { describe, expect, it } from "vitest";
import { pageNumbers, pageWindow, parsePage, rangeText, stepWithin } from "../src/shared/pager";

describe("pager", () => {
  it("reads a page from the address and treats anything odd as page 1", () => {
    expect([parsePage("3"), parsePage(null), parsePage(""), parsePage("0"), parsePage("-2"), parsePage("2.5"), parsePage("abc"), parsePage("9999999")]).toEqual([3, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("keeps the asked-for page within the pages that exist", () => {
    expect(pageWindow(57, 20, 2)).toEqual({ page: 2, pageCount: 3, start: 20, end: 40, total: 57 });
    expect(pageWindow(57, 20, 9)).toMatchObject({ page: 3, start: 40, end: 57 });
    expect(pageWindow(0, 20, 4)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0, total: 0 });
    expect(pageWindow(40, 20, 2)).toMatchObject({ page: 2, pageCount: 2, start: 20, end: 40 });
  });

  it("shows the first, last and nearby page numbers, and a gap only where two or more are left out", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(2, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(1, 10)).toEqual([1, 2, "gap", 10]);
    expect(pageNumbers(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageNumbers(3, 10)).toEqual([1, 2, 3, 4, "gap", 10]);
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("says the range in words", () => {
    expect(rangeText(pageWindow(57, 20, 2))).toBe("显示 21–40 / 57 条");
    expect(rangeText(pageWindow(0, 20, 1))).toBe("没有条目");
  });
});

describe("the item before or after the one shown", () => {
  const keys = Array.from({ length: 45 }, (_, index) => `t${index + 1}`);
  it("walks the whole list and says which page the next row is on", () => {
    expect(stepWithin(keys, "t20", 1, 20)).toEqual({ key: "t21", index: 20, page: 2 });
    expect(stepWithin(keys, "t21", -1, 20)).toEqual({ key: "t20", index: 19, page: 1 });
    expect(stepWithin(keys, "t44", 1, 40)).toEqual({ key: "t45", index: 44, page: 2 });
  });
  it("stops at either end and for a row that is not listed", () => {
    expect(stepWithin(keys, "t1", -1, 20)).toBeNull();
    expect(stepWithin(keys, "t45", 1, 20)).toBeNull();
    expect(stepWithin(keys, "gone", 1, 20)).toBeNull();
    expect(stepWithin(keys, null, 1, 20)).toBeNull();
  });
});
