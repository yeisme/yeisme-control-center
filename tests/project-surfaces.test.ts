import { describe, expect, it } from "vitest";
import { scopeSubtitle } from "../src/app-shell/AppShell";
import { coverLayout, coverLimit } from "../src/pages/projects/SharedProjectCard";
import { groupBindings } from "../src/pages/projects/ProjectConnections";
import { imageLimit } from "../src/pages/projects/ProjectHome";
import type { ProjectBinding } from "../src/shared/collaboration";

const binding = (owner: string, project_ref: string) => ({ owner, project_ref, source_scope: "scope_personal" }) as ProjectBinding;

describe("scope switcher subtitle", () => {
  it("names a project scope plainly and keeps raw ids out of the label", () => {
    expect(scopeSubtitle({ id: "project_a197df0c" })).toBe("共享项目");
    expect(scopeSubtitle({ id: "personal", project: "rain-night" })).toBe("项目 rain-night");
    expect(scopeSubtitle({ id: "personal" })).toBe("授权范围");
    expect(scopeSubtitle(null)).toBe("授权范围");
  });
});

describe("project card cover", () => {
  it("lays one to four results over the whole cover without gaps", () => {
    expect(coverLimit).toBe(4);
    expect(coverLayout(0)).toEqual(["col-span-2 row-span-2"]);
    expect(coverLayout(1)).toEqual(["col-span-2 row-span-2"]);
    expect(coverLayout(2)).toEqual(["row-span-2", "row-span-2"]);
    expect(coverLayout(3)).toEqual(["row-span-2", "", ""]);
    expect(coverLayout(4)).toHaveLength(4);
  });

  it("keeps the overview's images to two rows on a phone and one row on a wide screen", () => {
    expect(imageLimit).toEqual({ phone: 6, desktop: 8 });
  });
});

describe("connection groups", () => {
  it("groups bindings by tool in first-bound order and says a shared state once", () => {
    const groups = groupBindings([binding("eikona", "a"), binding("scaena", "b"), binding("eikona", "c")], () => "not_checked");
    expect(groups.map((group) => [group.owner, group.rows.length, group.state])).toEqual([["eikona", 2, "not_checked"], ["scaena", 1, "not_checked"]]);
    expect(groups.every((group) => !group.mixed)).toBe(true);
  });

  it("lets a problem in one row lead its group, and mixed fine and unread stay unread", () => {
    const states: Record<string, "ready" | "not_checked" | "needs_authorization"> = { a: "ready", b: "needs_authorization", c: "ready", d: "not_checked" };
    const groups = groupBindings([binding("eikona", "a"), binding("eikona", "b"), binding("scaena", "c"), binding("scaena", "d")], (item) => states[item.project_ref]);
    expect(groups.map((group) => [group.state, group.mixed])).toEqual([["needs_authorization", true], ["not_checked", true]]);
    expect(groupBindings([binding("eikona", "a"), binding("eikona", "c")], (item) => states[item.project_ref])[0].state).toBe("ready");
  });
});
