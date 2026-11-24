import { describe, expect, it } from "vitest";
import { activeView, applyView, canonicalViewQuery, presetTaskViews, removeView, renameView, saveView } from "../src/shared/saved-views";
import type { StoredView } from "../src/shared/preferences";

describe("saved views", () => {
  it("compares views by their filters only, in any order, ignoring the open task and the page", () => {
    expect(canonicalViewQuery(new URLSearchParams("owner=eikona&task=x&state=failed&page=3&preview=y"))).toBe("owner=eikona&state=failed");
    const views: StoredView[] = [{ id: "v1", name: "失败的图", query: "state=failed&owner=eikona", created_at: "" }];
    expect(activeView(views, new URLSearchParams("owner=eikona&state=failed&task=t"))?.id).toBe("v1");
    expect(activeView(views, new URLSearchParams("owner=eikona"))).toBeUndefined();
    expect(activeView(views, new URLSearchParams(""))).toBeUndefined();
  });

  it("applies a view over the current address, dropping old filters and the page but keeping the rest", () => {
    const next = applyView(new URLSearchParams("owner=sonora&page=2&scope=a"), "state=unknown");
    expect(next.toString()).toBe("scope=a&state=unknown");
  });

  it("saves up to twenty, replaces a view saved under the same name, and refuses an empty name", () => {
    let views: StoredView[] = [];
    for (let index = 0; index < 20; index += 1) {
      const result = saveView(views, `视图 ${index}`, "state=failed", "t", `id-${index}`);
      if (!result.ok) throw new Error(result.reason);
      views = result.views;
    }
    expect(saveView(views, "第 21 个", "state=failed", "t", "x")).toEqual({ ok: false, reason: "full" });
    const replaced = saveView(views, "视图 3", "owner=eikona", "t2", "y");
    expect(replaced.ok && replaced.views.length).toBe(20);
    expect(replaced.ok && replaced.views.find((view) => view.name === "视图 3")?.query).toBe("owner=eikona");
    expect(saveView([], "  ", "state=failed", "t", "z")).toEqual({ ok: false, reason: "empty_name" });
    expect(removeView(views, "id-0").length).toBe(19);
    expect(renameView(views, "id-0", "视图 1").find((view) => view.id === "id-0")?.name).toBe("视图 0");
  });

  it("offers the five common questions as presets", () => {
    expect(presetTaskViews.map((view) => view.name)).toEqual(["需要回查", "等你确认", "今天更新", "有结果", "正在跑"]);
  });
});
