import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { actionGroups, renderActions, type ItemAction } from "../src/components/ui/actions";

const run = () => undefined;
const actions: ItemAction[] = [
  { id: "open", label: "打开", group: "open", run },
  { id: "tasks", label: "查看任务", group: "open", run },
  { id: "copy", label: "复制引用", group: "copy", run },
  { id: "copy-link", label: "复制链接", run },
  { id: "hide", label: "隐藏", group: "state", disabled: true, disabledReason: "只读", run },
];

// Stand-ins for the dropdown and context menu parts: both menus are built from the same two pieces.
const Item = ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => createElement("li", { "data-disabled": disabled || undefined }, children);
const Separator = () => createElement("hr");

describe("item actions", () => {
  it("groups consecutive actions, an ungrouped one joining the group before it", () => {
    expect(actionGroups(actions).map((group) => group.map((action) => action.id))).toEqual([["open", "tasks"], ["copy", "copy-link"], ["hide"]]);
    expect(actionGroups([])).toEqual([]);
  });

  it("renders the same items with a separator between groups, and says why one is unavailable", () => {
    const html = renderToString(createElement("ul", null, renderActions(actions, Item, Separator)));
    expect(html.match(/<hr\/>/g)).toHaveLength(2);
    expect([...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""))).toEqual(["打开", "查看任务", "复制引用", "复制链接", "隐藏只读"]);
    expect(html).toContain('data-disabled="true"');
  });
});
