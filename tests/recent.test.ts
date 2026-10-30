import { describe, expect, it } from "vitest";
import { clearRecentItems, pushRecent, readRecent, recentTarget, type RecentItem } from "../src/app/recent-store";

const item = (key: string): RecentItem => ({ key, kind: "task", label: `任务 ${key}`, meta: "Eikona · 任务", target: `/tasks?task=${key}` });

function memoryStorage(entries: Record<string, string>): Storage {
  const data = new Map(Object.entries(entries));
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
  };
}

describe("recent items", () => {
  it("keeps the newest first, one entry per key, at most eight", () => {
    let list: RecentItem[] = [];
    for (const key of ["a", "b", "c", "a"]) list = pushRecent(list, item(key));
    expect(list.map((entry) => entry.key)).toEqual(["a", "c", "b"]);
    for (let index = 0; index < 10; index += 1) list = pushRecent(list, item(`n${index}`));
    expect(list).toHaveLength(8);
  });

  it("drops the preview layer from the reopen route", () => {
    expect(recentTarget("/assets", new URLSearchParams("catalog=shared&result=r1&preview=r1"))).toBe("/assets?catalog=shared&result=r1");
    expect(recentTarget("/tasks", new URLSearchParams("preview=x"))).toBe("/tasks");
  });

  it("reads only well-formed in-app entries", () => {
    const storage = memoryStorage({ list: JSON.stringify([item("a"), { ...item("b"), target: "https://elsewhere.example" }, { key: "c" }]), broken: "{" });
    expect(readRecent(storage, "list").map((entry) => entry.key)).toEqual(["a"]);
    expect(readRecent(storage, "broken")).toEqual([]);
  });

  it("logout clears every identity and scope but leaves other tab state", () => {
    const storage = memoryStorage({ "yeisme.recent.v1:alice:scope-a": "[]", "yeisme.recent.v1:bob:scope-b": "[]", "yeisme.control.scope": "scope-a" });
    clearRecentItems(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem("yeisme.control.scope")).toBe("scope-a");
  });
});
