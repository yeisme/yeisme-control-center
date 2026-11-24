import { describe, expect, it } from "vitest";
import { applyDirectoryFilters } from "../src/components/FilterBar";

describe("directory filters in the address", () => {
  it("drops the page cursor and page number when a filter changes", () => {
    const next = applyDirectoryFilters(new URLSearchParams("sharedProject=p&batchFilterq=old&batchFiltercursor=c1&batchFilterpage=3"), { q: "new" }, "batchFilter");
    expect(next?.toString()).toBe("sharedProject=p&batchFilterq=new");
  });

  it("removes a cleared filter", () => {
    const next = applyDirectoryFilters(new URLSearchParams("batchFilterq=old&batchFilterstate=failed"), { q: null, state: null }, "batchFilter");
    expect(next?.toString()).toBe("");
  });

  it("changes nothing, and keeps the page, when the address already says the same", () => {
    // A debounced search that lands after 重置 must not undo the page the person moved to since.
    expect(applyDirectoryFilters(new URLSearchParams("sharedProject=p&batchFiltercursor=c2"), { q: "" }, "batchFilter")).toBeNull();
    expect(applyDirectoryFilters(new URLSearchParams("batchFilterq=rain&batchFiltercursor=c2"), { q: "rain" }, "batchFilter")).toBeNull();
  });
});
