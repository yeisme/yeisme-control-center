import { describe, expect, it } from "vitest";
import { createMemoryDB } from "../server/db/client";
import { ToolCatalogStore } from "../server/db/tool-catalog-store";

const t = (minutes: number) => new Date(Date.UTC(2026, 9, 20, 8, minutes)).toISOString();
const now = Date.parse(t(30));

describe("tool catalog change ledger", () => {
  it("treats the first complete read as a baseline", () => {
    const store = new ToolCatalogStore(createMemoryDB());
    store.record("scope-a", "eikona", "model", [{ id: "m1", digest: "d1" }, { id: "m2", digest: "d2" }], t(0));
    expect(store.changes("scope-a", now)).toEqual([]);
  });

  it("reports added, changed and removed entries after the baseline", () => {
    const store = new ToolCatalogStore(createMemoryDB());
    store.record("scope-a", "eikona", "model", [{ id: "m1", digest: "d1" }, { id: "m2", digest: "d2" }], t(0));
    store.record("scope-a", "eikona", "model", [{ id: "m1", digest: "d1-changed" }, { id: "m3", digest: "d3" }], t(10));
    const changes = store.changes("scope-a", now).map((change) => [change.entry_id, change.change]);
    expect(changes).toEqual(expect.arrayContaining([["m1", "changed"], ["m2", "removed"], ["m3", "added"]]));
    expect(changes).toHaveLength(3);
  });

  it("baselines a kind that only becomes readable later instead of flooding additions", () => {
    const store = new ToolCatalogStore(createMemoryDB());
    store.record("scope-a", "eikona", "tool", [{ id: "eikona.execute", digest: "t" }], t(0));
    store.record("scope-a", "eikona", "model", [{ id: "m1", digest: "d1" }], t(5));
    expect(store.changes("scope-a", now)).toEqual([]);
  });

  it("keeps scopes isolated and forgets changes outside the seven-day window", () => {
    const store = new ToolCatalogStore(createMemoryDB());
    store.record("scope-a", "sonora", "action", [{ id: "a1", digest: "x" }], t(0));
    store.record("scope-a", "sonora", "action", [{ id: "a1", digest: "x" }, { id: "a2", digest: "y" }], t(1));
    store.record("scope-b", "sonora", "action", [{ id: "a1", digest: "x" }], t(2));
    expect(store.changes("scope-a", now).map((change) => change.entry_id)).toEqual(["a2"]);
    expect(store.changes("scope-b", now)).toEqual([]);
    expect(store.changes("scope-a", now + 8 * 24 * 60 * 60 * 1000)).toEqual([]);
  });

  it("re-reports an entry that reappears after removal as added", () => {
    const store = new ToolCatalogStore(createMemoryDB());
    store.record("scope-a", "scaena", "channel", [{ id: "kie", digest: "k" }], t(0));
    store.record("scope-a", "scaena", "channel", [], t(1));
    store.record("scope-a", "scaena", "channel", [{ id: "kie", digest: "k" }], t(2));
    expect(store.changes("scope-a", now)).toEqual([{ owner: "scaena", kind: "channel", entry_id: "kie", change: "added", at: t(2) }]);
  });
});
