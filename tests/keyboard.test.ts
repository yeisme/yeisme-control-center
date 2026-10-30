import { describe, expect, it } from "vitest";
import { modifierLabel, moveIndex, shellShortcut, shortcutGroups, type Box } from "../src/shared/keyboard";

const list: Box[] = [0, 1, 2].map((row) => ({ left: 0, top: row * 48, width: 600, height: 48 }));
// Three columns of 200×160 cards with 16px gaps; the last row holds two cards.
const grid: Box[] = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({ left: (index % 3) * 216, top: Math.floor(index / 3) * 176, width: 200, height: 160 }));
const key = (value: string, extra: Partial<Parameters<typeof shellShortcut>[0]> = {}) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, target: null, ...extra });

describe("moveIndex", () => {
  it("steps through a list and stops at the ends", () => {
    expect(moveIndex(list, 0, "ArrowDown", "list")).toBe(1);
    expect(moveIndex(list, 2, "ArrowDown", "list")).toBeNull();
    expect(moveIndex(list, 0, "ArrowUp", "list")).toBeNull();
    expect(moveIndex(list, 1, "End", "list")).toBe(2);
    expect(moveIndex(list, 0, "Home", "list")).toBeNull();
    expect(moveIndex(list, 1, "ArrowRight", "list")).toBeNull();
  });

  it("moves along grid rows and to the closest column of the next row", () => {
    expect(moveIndex(grid, 1, "ArrowRight", "grid")).toBe(2);
    expect(moveIndex(grid, 2, "ArrowRight", "grid")).toBe(3);
    expect(moveIndex(grid, 1, "ArrowDown", "grid")).toBe(4);
    expect(moveIndex(grid, 4, "ArrowUp", "grid")).toBe(1);
    // Column 3 of the middle row has no card below it; the nearest card in the last row wins.
    expect(moveIndex(grid, 5, "ArrowDown", "grid")).toBe(7);
    expect(moveIndex(grid, 7, "ArrowDown", "grid")).toBeNull();
    expect(moveIndex(grid, 0, "ArrowUp", "grid")).toBeNull();
  });
});

describe("shellShortcut", () => {
  const input = { closest: (selector: string) => selector.includes("input") ? {} : null };
  const checkbox = { closest: () => null };

  it("opens search with Ctrl or ⌘ K even while typing", () => {
    expect(shellShortcut(key("k", { ctrlKey: true, target: input as unknown as EventTarget }), false)).toBe("search");
    expect(shellShortcut(key("K", { metaKey: true }), true)).toBe("search");
  });

  it("only triggers page shortcuts outside text entry and dialogs", () => {
    expect(shellShortcut(key("/"), false)).toBe("page-search");
    expect(shellShortcut(key("?"), false)).toBe("shortcuts");
    expect(shellShortcut(key("/", { target: input as unknown as EventTarget }), false)).toBeNull();
    expect(shellShortcut(key("/", { target: checkbox as unknown as EventTarget }), false)).toBe("page-search");
    expect(shellShortcut(key("?"), true)).toBeNull();
    expect(shellShortcut(key("/", { defaultPrevented: true }), false)).toBeNull();
    expect(shellShortcut(key("/", { altKey: true }), false)).toBeNull();
  });
});

describe("shortcut reference", () => {
  it("uses the platform modifier and lists every handled group", () => {
    expect(modifierLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("⌘");
    expect(modifierLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Ctrl");
    const groups = shortcutGroups("Ctrl");
    expect(groups.map((group) => group.title)).toEqual(["全局", "列表", "查看器", "播放器"]);
    expect(groups[0].entries[0].keys).toEqual(["Ctrl", "K"]);
  });
});
