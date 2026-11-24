import { describe, expect, it } from "vitest";
import { rankSearch, readScopePrefix, type SearchItem } from "../src/shared/search/rank";

const items: SearchItem[] = [
  { key: "page:settings", group: "page", label: "设置", meta: "外观、动效、快捷键与本机数据", target: "/settings" },
  { key: "page:usage", group: "page", label: "用量与成本", meta: "花了多少、预算还剩多少", target: "/usage" },
  { key: "action:theme", group: "action", label: "切换到深色主题", meta: "外观", boost: 700 },
  { key: "action:system", group: "action", label: "主题跟随系统", meta: "外观", boost: 700 },
  { key: "action:shortcuts", group: "action", label: "查看键盘快捷键", meta: "帮助 · 在页面上按 ?", boost: 700 },
  { key: "task:a", group: "task", label: "深色背景 · 海报", meta: "Eikona · run-1", target: "/tasks?task=a" },
  { key: "recent:task:a", group: "recent", label: "深色背景 · 海报", meta: "Eikona · 任务", target: "/tasks?task=a", boost: 150 },
  ...Array.from({ length: 8 }, (_, index): SearchItem => ({ key: `work:${index}`, group: "work", label: `雨夜 ${index}`, meta: "Eikona · 图片", target: `/assets?result=${index}` })),
];

describe("⌘K ranking", () => {
  it("puts the theme and shortcut actions first for the words people type for them", () => {
    for (const [query, key] of [["深色", "action:theme"], ["跟随系统", "action:system"], ["快捷键", "action:shortcuts"]]) {
      const [first] = rankSearch(items, query);
      expect(first.group, query).toBe("top");
      expect(first.items[0].key, query).toBe(key);
    }
  });

  it("lists one place once, where it scored best, and marks what matched", () => {
    const groups = rankSearch(items, "海报");
    const keys = groups.flatMap((group) => group.items.map((item) => item.key));
    expect(keys.filter((key) => key.endsWith("task:a"))).toEqual(["recent:task:a"]);
    expect(groups[0].items[0].labelRanges).toEqual([[7, 9]]);
  });

  it("keeps three best first, then five of each kind, with the total for 「显示全部」", () => {
    const groups = rankSearch(items, "雨夜");
    expect(groups[0]).toMatchObject({ group: "top" });
    expect(groups[0].items).toHaveLength(3);
    const works = groups.find((group) => group.group === "work")!;
    expect(works.items).toHaveLength(5);
    expect(works.total).toBe(5);
    expect(rankSearch(items, "雨夜", { expanded: ["work"] }).find((group) => group.group === "work")!.items).toHaveLength(5);
    expect(rankSearch(items, "雨夜", { scope: "work" })).toEqual([expect.objectContaining({ group: "work", total: 8 })]);
    expect(rankSearch(items, "雨夜", { scope: "work" })[0].items).toHaveLength(5);
    expect(rankSearch(items, "雨夜", { scope: "work", expanded: ["work"] })[0].items).toHaveLength(8);
  });

  it("with nothing typed shows recent, then actions, then pages, and no task of its own", () => {
    const groups = rankSearch(items, "");
    expect(groups.map((group) => group.group)).toEqual(["recent", "action", "page"]);
  });

  it("reads a scope prefix", () => {
    expect(readScopePrefix("任务: 雨夜")).toEqual({ scope: "task", rest: "雨夜" });
    expect(readScopePrefix("作品：海报")).toEqual({ scope: "work", rest: "海报" });
    expect(readScopePrefix("状态:失败")).toEqual({ scope: null, rest: "状态:失败" });
  });
});
