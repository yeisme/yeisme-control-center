import { describe, expect, it } from "vitest";
import { catalogMetrics, changesByDay, entryRef, filterActions, filterChannels, filterModels, findEntry, latestHighlights, parseCatalogTab, parseOwnerFilter, parseRiskFilter, precheckTarget } from "../src/pages/capabilities/catalog-view";
import type { CatalogAction, CatalogModel, ToolCatalog } from "../src/shared/tool-catalog";

const schema = { digest: null, fields: [], field_count: 0, truncated: false };
const model = (id: string, owner: CatalogModel["owner"], status: CatalogModel["status"], capabilities: string[] = []): CatalogModel => ({
  id, owner, model_ref: id.split("@")[0], original_model_ref: null, provider: "p", channel: null, operation: null, capabilities, input_modalities: [], output_modalities: [],
  durations: [], resolutions: [], ratios: [], pricing: null, readiness: null, status, status_source: status === "unknown" ? "undeclared" : "owner", observed_at: "2026-10-20T08:00:00Z", expires_at: null, digest: null, warnings: [], source: "test",
});
const action = (name: string, owner: CatalogAction["owner"], risk: CatalogAction["risk"], extra: Partial<CatalogAction> = {}): CatalogAction => ({
  id: `${owner}.execute#${name}`, owner, name, tool: `${owner}.execute`, summary: null, description: null, risk, availability: "unknown", lane: null, blockers: [], next_actions: [], conditions: [],
  requires_confirm: null, requires_idempotency: null, side_effects: [], creative_mode: null, input: schema, source: "test", ...extra,
});

const catalog: ToolCatalog = {
  schema_version: "yeisme.tool_catalog.v1",
  scope: "scope",
  observed_at: "2026-10-20T08:00:00Z",
  freshness: "fresh",
  refresh: { forced: false, throttled: false, ttl_ms: 60000 },
  servers: [
    { id: "eikona", owner: "eikona", name: "Eikona", transport: "mcp", protocol_version: "2025-06-18", server_name: null, server_version: null, coverage: "readable", reason: null, observed_at: null, freshness: "fresh", latest_policy: null, native_channels: [], readiness: [], counts: { tools: 1, actions: 2, models: 3, channels: 1 } },
    { id: "aigora", owner: "aigora", name: "Aigora", transport: "http", protocol_version: null, server_name: null, server_version: null, coverage: "needs_contract", reason: "operator_session_required", observed_at: null, freshness: "unknown", latest_policy: null, native_channels: [], readiness: [], counts: { tools: 0, actions: 0, models: 0, channels: 0 } },
  ],
  tools: [],
  actions: [action("generate", "eikona", "paid_external", { creative_mode: "text_to_image" }), action("models.readiness", "eikona", "read_only"), action("upscale", "eikona", "paid_external", { creative_mode: "image_upscale", availability: "blocked" })],
  models: [model("old@x", "eikona", "historical"), model("new@x", "eikona", "latest_ready", ["text_to_image"]), model("plain@x", "eikona", "unknown"), model("wan@kie", "scaena", "unknown", ["frames"])],
  channels: [
    { id: "b", owner: "eikona", channel_id: "b", name: "b", provider: null, protocol: null, models: [], capabilities: [], status: "blocked", observed_at: null, routing: { priority: 1, weight: 1, default: false, selection_mode: null }, pricing: null, note_required: false, last_attempt: null, last_success: null },
    { id: "a", owner: "eikona", channel_id: "a", name: "a", provider: null, protocol: null, models: ["new"], capabilities: [], status: "ready", observed_at: null, routing: { priority: 5, weight: 1, default: true, selection_mode: null }, pricing: null, note_required: true, last_attempt: null, last_success: null },
  ],
  changes: [
    { owner: "eikona", kind: "model", entry_id: "plain@x", change: "added", at: "2026-10-20T07:00:00Z" },
    { owner: "eikona", kind: "channel", entry_id: "gone", change: "removed", at: "2026-10-19T07:00:00Z" },
  ],
  coverage: [],
};

describe("catalog view", () => {
  it("parses URL state defensively", () => {
    expect(parseCatalogTab("models")).toBe("models");
    expect(parseCatalogTab("nope")).toBe("overview");
    expect(parseOwnerFilter("scaena")).toBe("scaena");
    expect(parseOwnerFilter("aigora")).toBe("all");
    expect(parseRiskFilter("human_gate")).toBe("human_gate");
    expect(parseRiskFilter("x")).toBe("all");
  });

  it("separates historical models and orders latest first", () => {
    const { current, historical } = filterModels(catalog.models, { query: "", owner: "eikona" });
    expect(current.map((item) => item.id)).toEqual(["new@x", "plain@x"]);
    expect(historical.map((item) => item.id)).toEqual(["old@x"]);
    expect(filterModels(catalog.models, { query: "frames", owner: "all" }).current.map((item) => item.id)).toEqual(["wan@kie"]);
  });

  it("lists ready channels first and filters actions by risk", () => {
    expect(filterChannels(catalog.channels, { query: "", owner: "all" }).map((item) => item.id)).toEqual(["a", "b"]);
    expect(filterActions(catalog.actions, { query: "", owner: "all", risk: "read_only" }).map((item) => item.name)).toEqual(["models.readiness"]);
  });

  it("resolves entry refs including ids that contain separators", () => {
    expect(findEntry(catalog, entryRef("action", "eikona", "eikona.execute#generate"))?.kind).toBe("action");
    expect(findEntry(catalog, entryRef("model", "eikona", "new@x"))?.value.id).toBe("new@x");
    expect(findEntry(catalog, "model:eikona:missing")).toBeNull();
  });

  it("highlights observed additions and owner-declared latest models, never removed entries", () => {
    const highlights = latestHighlights(catalog);
    expect(highlights.map((item) => [item.label, item.reason])).toEqual([["plain@x", "added"], ["new", "owner_latest"]]);
  });

  it("summarizes the catalog and groups changes by day", () => {
    expect(catalogMetrics(catalog)).toMatchObject({ servers: 1, readableServers: 1, pendingServers: 1, models: 3, latestReady: 1, historical: 1, readyChannels: 1, actions: 3, readOnlyActions: 1, gatedActions: 2, changes: 2 });
    expect(changesByDay(catalog.changes).map((group) => group.day)).toEqual(["2026-10-20", "2026-10-19"]);
  });

  it("only offers AI creation pre-check for current generation entries", () => {
    expect(precheckTarget({ kind: "model", value: catalog.models[1] })).toBe("/creation?owner=eikona&mode=text_to_image&model=new");
    expect(precheckTarget({ kind: "model", value: catalog.models[0] })).toBeNull();
    expect(precheckTarget({ kind: "model", value: catalog.models[3] })).toBe("/creation?owner=scaena&mode=keyframe_video&model=wan");
    expect(precheckTarget({ kind: "action", value: catalog.actions[0] })).toBe("/creation?owner=eikona&mode=text_to_image");
    expect(precheckTarget({ kind: "action", value: catalog.actions[2] })).toBeNull();
    expect(precheckTarget({ kind: "server", value: catalog.servers[0] })).toBeNull();
  });
});
