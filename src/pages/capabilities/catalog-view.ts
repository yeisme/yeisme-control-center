import type { CatalogAction, CatalogChange, CatalogChannel, CatalogEntryKind, CatalogModel, CatalogOwner, CatalogServer, CatalogTool, RiskTier, ToolCatalog } from "../../shared/tool-catalog";
import { canPrecheckModel } from "../../shared/tool-catalog";

export const catalogTabs = ["overview", "models", "channels", "tools", "changes"] as const;
export type CatalogTab = (typeof catalogTabs)[number];
export const parseCatalogTab = (value: string | null): CatalogTab => (catalogTabs as readonly string[]).includes(value || "") ? value as CatalogTab : "overview";

export type OwnerFilter = "all" | CatalogOwner;
export const parseOwnerFilter = (value: string | null): OwnerFilter => (["eikona", "scaena", "sonora"] as const).includes(value as "eikona") ? value as CatalogOwner : "all";

export type CatalogEntry =
  | { kind: "server"; value: CatalogServer }
  | { kind: "tool"; value: CatalogTool }
  | { kind: "action"; value: CatalogAction }
  | { kind: "model"; value: CatalogModel }
  | { kind: "channel"; value: CatalogChannel };

export const entryRef = (kind: CatalogEntryKind, owner: string, id: string) => `${kind}:${owner}:${id}`;

export function findEntry(catalog: ToolCatalog, ref: string | null): CatalogEntry | null {
  if (!ref) return null;
  const [kind, owner, ...rest] = ref.split(":");
  const id = rest.join(":");
  const match = <T extends { owner: string; id: string }>(list: T[]) => list.find((item) => item.owner === owner && item.id === id);
  if (kind === "server") { const value = match(catalog.servers); return value ? { kind, value } : null; }
  if (kind === "tool") { const value = match(catalog.tools); return value ? { kind, value } : null; }
  if (kind === "action") { const value = match(catalog.actions); return value ? { kind, value } : null; }
  if (kind === "model") { const value = match(catalog.models); return value ? { kind, value } : null; }
  if (kind === "channel") { const value = match(catalog.channels); return value ? { kind, value } : null; }
  return null;
}

const includes = (query: string, values: (string | null | undefined)[]) => {
  const needle = query.trim().toLowerCase();
  return !needle || values.some((value) => value?.toLowerCase().includes(needle));
};
const ownerMatches = (owner: OwnerFilter, value: string) => owner === "all" || owner === value;

const statusRank: Record<CatalogModel["status"], number> = { latest_ready: 0, latest_unverified: 1, unknown_cost: 2, drifted: 3, unknown: 4, unavailable: 5, historical: 6 };

export function filterModels(models: CatalogModel[], filter: { query: string; owner: OwnerFilter }) {
  const rows = models
    .filter((model) => ownerMatches(filter.owner, model.owner) && includes(filter.query, [model.model_ref, model.provider, model.channel, model.operation, ...model.capabilities]))
    .sort((a, b) => statusRank[a.status] - statusRank[b.status] || a.owner.localeCompare(b.owner) || a.model_ref.localeCompare(b.model_ref));
  return { current: rows.filter((model) => model.status !== "historical"), historical: rows.filter((model) => model.status === "historical") };
}

export function filterChannels(channels: CatalogChannel[], filter: { query: string; owner: OwnerFilter }) {
  return channels
    .filter((channel) => ownerMatches(filter.owner, channel.owner) && includes(filter.query, [channel.channel_id, channel.name, channel.provider, channel.protocol, ...channel.models, ...channel.capabilities]))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "ready" ? -1 : b.status === "ready" ? 1 : 0) || (a.routing?.priority ?? 9999) - (b.routing?.priority ?? 9999));
}

export type RiskFilter = "all" | RiskTier;
export const parseRiskFilter = (value: string | null): RiskFilter => (["read_only", "remote_query", "mutation", "paid_external", "human_gate", "unknown"] as const).includes(value as "read_only") ? value as RiskTier : "all";

export function filterActions(actions: CatalogAction[], filter: { query: string; owner: OwnerFilter; risk: RiskFilter }) {
  return actions.filter((action) => ownerMatches(filter.owner, action.owner) && (filter.risk === "all" || action.risk === filter.risk) && includes(filter.query, [action.name, action.summary, action.description, action.lane]));
}

export function filterTools(tools: CatalogTool[], filter: { query: string; owner: OwnerFilter }) {
  return tools.filter((tool) => ownerMatches(filter.owner, tool.owner) && includes(filter.query, [tool.name, tool.title, tool.description]));
}

export interface Highlight {
  ref: string;
  owner: CatalogOwner;
  kind: CatalogEntryKind;
  label: string;
  reason: "owner_latest" | CatalogChange["change"];
  at: string | null;
}

/** "最新上线": owner-declared latest models plus entries the Control Center saw appear or change. */
export function latestHighlights(catalog: ToolCatalog, limit = 8): Highlight[] {
  const result: Highlight[] = [];
  const seen = new Set<string>();
  for (const change of catalog.changes) {
    if (change.change === "removed") continue;
    const ref = entryRef(change.kind, change.owner, change.entry_id);
    if (seen.has(ref) || !findEntry(catalog, ref)) continue;
    seen.add(ref);
    result.push({ ref, owner: change.owner, kind: change.kind, label: change.entry_id, reason: change.change, at: change.at });
  }
  for (const model of catalog.models) {
    if (model.status !== "latest_ready" && model.status !== "latest_unverified") continue;
    const ref = entryRef("model", model.owner, model.id);
    if (seen.has(ref)) continue;
    seen.add(ref);
    result.push({ ref, owner: model.owner, kind: "model", label: model.model_ref, reason: "owner_latest", at: model.observed_at });
  }
  return result.slice(0, limit);
}

export function catalogMetrics(catalog: ToolCatalog) {
  const providerServers = catalog.servers.filter((server) => server.transport === "mcp");
  const risks = catalog.actions.reduce<Record<string, number>>((counts, action) => ({ ...counts, [action.risk]: (counts[action.risk] || 0) + 1 }), {});
  return {
    servers: providerServers.length,
    readableServers: providerServers.filter((server) => server.coverage === "readable" || server.coverage === "partial").length,
    pendingServers: catalog.servers.filter((server) => server.coverage === "needs_contract").length,
    models: catalog.models.filter((model) => model.status !== "historical").length,
    latestReady: catalog.models.filter((model) => model.status === "latest_ready").length,
    historical: catalog.models.filter((model) => model.status === "historical").length,
    channels: catalog.channels.length,
    readyChannels: catalog.channels.filter((channel) => channel.status === "ready").length,
    tools: catalog.tools.length,
    actions: catalog.actions.length,
    readOnlyActions: risks.read_only || 0,
    gatedActions: (risks.paid_external || 0) + (risks.human_gate || 0),
    changes: catalog.changes.length,
  };
}

export function changesByDay(changes: CatalogChange[]) {
  const groups = new Map<string, CatalogChange[]>();
  for (const change of changes) {
    const day = change.at.slice(0, 10);
    groups.set(day, [...(groups.get(day) || []), change]);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, items]) => ({ day, items }));
}

const scaenaModeFor = (capabilities: string[]) =>
  capabilities.includes("frames") ? "keyframe_video" : capabilities.includes("reference") ? "image_to_video" : "text_to_video";

/** Deep link into AI 创作 for a pre-check only; never offered for historical or blocked entries. */
export function precheckTarget(entry: CatalogEntry): string | null {
  if (entry.kind === "model") {
    const model = entry.value;
    if (!canPrecheckModel(model) || !["eikona", "scaena", "sonora"].includes(model.owner)) return null;
    const mode = model.owner === "scaena" ? scaenaModeFor(model.capabilities) : model.owner === "sonora" ? "text_to_audio" : model.capabilities.includes("text_to_image") || !model.capabilities.length ? "text_to_image" : model.capabilities[0];
    return `/creation?${new URLSearchParams({ owner: model.owner, mode, model: model.model_ref })}`;
  }
  if (entry.kind === "action" && entry.value.creative_mode && entry.value.availability !== "unavailable" && entry.value.availability !== "blocked")
    return `/creation?${new URLSearchParams({ owner: entry.value.owner, mode: entry.value.creative_mode })}`;
  return null;
}
