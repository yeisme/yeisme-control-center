import { describe, expect, it } from "vitest";
import { accountPreferencesKey, clampInspectorWidth, clampTile, defaultAccountPreferences, legacyKeys, loadAccountPreferences, parseAccountPreferences, parseDevicePreferences, saveAccountPreferences } from "../src/shared/preferences";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.has(key) ? data.get(key)! : null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe("account preferences", () => {
  it("reads each section on its own, so one bad section never costs the rest", () => {
    const parsed = parseAccountPreferences(JSON.stringify({ version: 1, list: { pageSize: 80, density: "loud" }, assets: { view: "list", pageSize: 7, tile: 333 }, inspector: { modes: { tasks: "floating", assets: "sideways" }, width: 9000 }, views: [{ id: "a", name: "失败的图", query: "state=failed" }, { id: "a", name: "dup" }, { name: "no id" }] }));
    expect(parsed.list).toEqual({ pageSize: 80, density: "comfortable" });
    expect(parsed.assets).toEqual({ view: "list", pageSize: 48, tile: 320, layout: "grid" });
    expect(parsed.inspector).toEqual({ modes: { tasks: "floating", assets: "fixed", catalog: "fixed" }, width: 720 });
    expect(parsed.views.map((view) => view.name)).toEqual(["失败的图"]);
    expect(parseAccountPreferences("not json")).toEqual(defaultAccountPreferences);
    expect(parseAccountPreferences(JSON.stringify({ version: 2, list: { pageSize: 80 } }))).toEqual(defaultAccountPreferences);
  });

  it("keeps a separate entry per account", () => {
    const storage = memory();
    saveAccountPreferences(storage, "alice", { ...defaultAccountPreferences, list: { pageSize: 80, density: "compact" } });
    expect(loadAccountPreferences(storage, "alice").list.pageSize).toBe(80);
    expect(loadAccountPreferences(storage, "bob").list.pageSize).toBe(40);
    expect(accountPreferencesKey("a b")).toBe("yeisme.prefs.v1:a%20b");
  });

  it("carries the pre-v21 choices over once and removes the old keys, each panel keeping its own mode", () => {
    const storage = memory({
      [legacyKeys.list("alice")]: JSON.stringify({ version: 1, pageSize: 120, density: "spacious", pages: { tasks: 3 } }),
      [legacyKeys.taskInspector]: "fixed",
      [legacyKeys.assetInspector]: "floating",
      [legacyKeys.assetsView]: "compact",
    });
    const migrated = loadAccountPreferences(storage, "alice");
    expect(migrated.list).toEqual({ pageSize: 120, density: "spacious" });
    expect(migrated.inspector.modes).toEqual({ tasks: "fixed", assets: "floating", catalog: "fixed" });
    expect(migrated.assets.view).toBe("compact");
    expect([...storage.data.keys()]).toEqual([accountPreferencesKey("alice")]);
    // Page numbers are not carried: they live in the address now.
    expect(storage.data.get(accountPreferencesKey("alice"))).not.toContain("pages");
  });

  it("keeps tile size and inspector width inside their ranges", () => {
    expect([clampTile(10), clampTile(205), clampTile(999), clampTile("x")]).toEqual([140, 200, 320, 240]);
    expect([clampInspectorWidth(100), clampInspectorWidth(512.4), clampInspectorWidth(null)]).toEqual([400, 512, null]);
  });

  it("reads the device's motion choice and falls back to the system", () => {
    expect(parseDevicePreferences(JSON.stringify({ version: 1, motion: "reduced" })).motion).toBe("reduced");
    expect(parseDevicePreferences("{}").motion).toBe("system");
    expect(parseDevicePreferences(null).motion).toBe("system");
  });
});
