import type { ProviderOwner, ScopeBinding } from "./contracts";
import type { OwnerObservation, OwnerObservationResult, ProviderRunManager } from "./provider-live";
import type { ToolCatalogStore } from "./db/tool-catalog-store";
import { digestOf } from "./tool-catalog-normalize";
import {
  toolCatalogSchemaVersion,
  type CatalogCoverage,
  type CatalogEntryKind,
  type CatalogFreshness,
  type CatalogOwner,
  type CatalogServer,
  type ToolCatalog,
} from "../src/shared/tool-catalog";

const providerOwners: ProviderOwner[] = ["eikona", "scaena", "sonora"];
const ownerNames: Record<CatalogOwner, string> = { eikona: "Eikona", scaena: "Scaena", sonora: "Sonora", aigora: "Aigora", gateway: "MCP Gateway", auctra: "Auctra" };

/** Owners whose catalogs exist but have no read contract the Control Center may use yet. */
const pendingOwners: { owner: CatalogOwner; transport: CatalogServer["transport"]; reason: string }[] = [
  { owner: "aigora", transport: "http", reason: "operator_session_required" },
  { owner: "gateway", transport: "http", reason: "tools_read_scope_required" },
  { owner: "auctra", transport: "cli", reason: "runtime_contract_cli_only" },
];

const entryDigests = (observation: OwnerObservation): Record<CatalogEntryKind, { id: string; digest: string }[]> => ({
  server: [{ id: observation.owner, digest: digestOf({ ...observation.server, latest_policy: observation.latest_policy, native_channels: observation.native_channels }) }],
  tool: observation.tools.map((tool) => ({ id: tool.id, digest: digestOf({ input: tool.input.digest, annotations: tool.annotations, title: tool.title, description: tool.description }) })),
  action: observation.actions.map((action) => ({ id: action.id, digest: digestOf({ risk: action.risk, availability: action.availability, lane: action.lane, input: action.input.digest, confirm: action.requires_confirm, idempotency: action.requires_idempotency }) })),
  model: observation.models.map((model) => ({ id: model.id, digest: digestOf({ status: model.status, readiness: model.readiness, capabilities: model.capabilities, durations: model.durations, resolutions: model.resolutions, ratios: model.ratios, pricing: model.pricing, digest: model.digest }) })),
  channel: observation.channels.map((channel) => ({ id: channel.id, digest: digestOf({ status: channel.status, models: channel.models, capabilities: channel.capabilities, routing: channel.routing, pricing: channel.pricing }) })),
});

/** Read-only cross-owner catalog; presence in the catalog never implies the Control Center may call an entry. */
export class ToolCatalogService {
  constructor(private readonly providers: ProviderRunManager, private readonly store: ToolCatalogStore) {}

  async snapshot(scope: ScopeBinding, options: { refresh?: boolean } = {}): Promise<ToolCatalog> {
    const bound = providerOwners.filter((owner) => scope.owners[owner]);
    const results = await Promise.all(bound.map(async (owner) => [owner, await this.providers.observeOwner(owner, { force: options.refresh })] as const));
    const catalog: ToolCatalog = {
      schema_version: toolCatalogSchemaVersion,
      scope: scope.id,
      observed_at: new Date().toISOString(),
      freshness: "unknown",
      refresh: { forced: false, throttled: false, ttl_ms: 60_000 },
      servers: [], tools: [], actions: [], models: [], channels: [], changes: [], coverage: [],
    };
    const freshness: CatalogFreshness[] = [];
    for (const [owner, result] of results) {
      this.addOwner(catalog, scope, owner, result);
      if (result) {
        freshness.push(result.freshness);
        catalog.refresh.forced ||= result.forced;
        catalog.refresh.throttled ||= result.throttled;
      }
    }
    for (const pending of pendingOwners) {
      catalog.servers.push(this.server(pending.owner, pending.transport, "needs_contract", pending.reason, null, "unknown"));
      catalog.coverage.push({ owner: pending.owner, state: "needs_contract", reason: pending.reason, observed_at: null, freshness: "unknown" });
    }
    catalog.freshness = freshness.includes("stale") ? "stale" : freshness.length && freshness.every((value) => value === "fresh") ? "fresh" : "unknown";
    const times = catalog.coverage.flatMap((item) => (item.observed_at ? [item.observed_at] : [])).sort();
    if (times.length) catalog.observed_at = times[times.length - 1];
    catalog.changes = this.store.changes(scope.id);
    return catalog;
  }

  private addOwner(catalog: ToolCatalog, scope: ScopeBinding, owner: ProviderOwner, result: OwnerObservationResult | null) {
    if (!result) {
      catalog.servers.push(this.server(owner, "mcp", "not_configured", "provider_not_configured", null, "unknown"));
      catalog.coverage.push({ owner, state: "not_configured", reason: "provider_not_configured", observed_at: null, freshness: "unknown" });
      return;
    }
    const { observation } = result;
    const reason = result.freshness === "stale" ? result.failure?.reason || "owner_observation_stale" : observation.coverage.reason;
    const coverage: CatalogCoverage = { owner, state: observation.coverage.state, reason, observed_at: observation.observed_at, freshness: result.freshness };
    catalog.coverage.push(coverage);
    const server = this.server(owner, "mcp", coverage.state, reason, observation.observed_at, result.freshness);
    Object.assign(server, {
      protocol_version: observation.server.protocol_version,
      server_name: observation.server.server_name,
      server_version: observation.server.server_version,
      latest_policy: observation.latest_policy,
      native_channels: observation.native_channels,
      readiness: observation.readiness,
      counts: { tools: observation.tools.length, actions: observation.actions.length, models: observation.models.length, channels: observation.channels.length },
    });
    catalog.servers.push(server);
    catalog.tools.push(...observation.tools);
    catalog.actions.push(...observation.actions);
    catalog.models.push(...observation.models);
    catalog.channels.push(...observation.channels);
    if (result.freshness !== "fresh") return;
    const digests = entryDigests(observation);
    for (const kind of new Set(observation.complete_kinds)) this.store.record(scope.id, owner, kind, digests[kind], observation.observed_at);
  }

  private server(owner: CatalogOwner, transport: CatalogServer["transport"], coverage: CatalogServer["coverage"], reason: string | null, observedAt: string | null, freshness: CatalogFreshness): CatalogServer {
    return {
      id: owner,
      owner,
      name: ownerNames[owner],
      transport,
      protocol_version: null,
      server_name: null,
      server_version: null,
      coverage,
      reason,
      observed_at: observedAt,
      freshness,
      latest_policy: null,
      native_channels: [],
      readiness: [],
      counts: { tools: 0, actions: 0, models: 0, channels: 0 },
    };
  }
}
