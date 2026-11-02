import type { ScopeBinding, ServerConfig } from "../contracts";
import { openToolKinds, type OpenToolKind, type OpenToolProjection } from "../../src/shared/open-tools";
import { DriveBridgeAdapter } from "./drivebridge";
import { GatewayAdapter } from "./gateway";
import { unreadableProjection } from "./projection";
import type { Fetcher, OpenToolAdapter, OpenToolObservation } from "./types";

const observationTtlMs = 60_000;
const forceRefreshMinMs = 15_000;

/**
 * Owner requests one uncached reading of each tool makes at most. DriveBridge: health, capabilities and operations.
 * The Gateway: readiness, tenant, backends, tools, operations and usage. A reading served from the cache makes none.
 */
export const observeRequests: Record<OpenToolKind, number> = { drivebridge: 3, gateway: 6 };

export interface OpenToolResult {
  observation: OpenToolObservation;
  freshness: "fresh" | "stale" | "unknown";
  forced: boolean;
  throttled: boolean;
  /** Owner requests this call itself made: none when it was served from the cache or joined a reading already running. */
  requests: number;
}

interface Entry {
  latest: OpenToolObservation;
  at: number;
  forcedAt: number;
  lastGood: OpenToolObservation | null;
}

/** Reads that may pass on their own; the last good reading stays on screen, marked stale, while they last. */
const transient = (projection: OpenToolProjection) => projection.state === "unavailable" || projection.state === "rate_limited";

/**
 * Open tools configured on the server and the scopes allowed to see them. Readings are cached per tool for a minute
 * and shared between concurrent requests; a forced refresh is honoured at most every 15 s.
 */
export class OpenToolService {
  private readonly adapters = new Map<OpenToolKind, OpenToolAdapter | { failed: string }>();
  private readonly entries = new Map<OpenToolKind, Entry>();
  private readonly inflight = new Map<OpenToolKind, Promise<OpenToolObservation>>();
  /** Requests made to each tool so far, counted where the adapters hand them to the transport. */
  private readonly made = new Map<OpenToolKind, number>();

  constructor(private readonly config: ServerConfig, fetcher: Fetcher = fetch) {
    for (const kind of openToolKinds) {
      const connection = config.open_tools?.[kind];
      if (!connection || connection.enabled === false) continue;
      const counted: Fetcher = (input, init) => {
        this.made.set(kind, (this.made.get(kind) ?? 0) + 1);
        return fetcher(input, init);
      };
      try {
        this.adapters.set(kind, kind === "drivebridge" ? new DriveBridgeAdapter(connection, counted) : new GatewayAdapter(connection, counted));
      } catch {
        // A refused address is a configuration fault; it shows as such instead of stopping the server.
        this.adapters.set(kind, { failed: "open_tool_endpoint_denied" });
      }
    }
  }

  /** Configured, enabled open tools this scope lists. */
  inScope(scope: ScopeBinding): OpenToolKind[] {
    return openToolKinds.filter((kind) => this.adapters.has(kind) && scope.open_tools?.includes(kind));
  }

  async observe(kind: OpenToolKind, options: { force?: boolean } = {}): Promise<OpenToolResult | null> {
    const adapter = this.adapters.get(kind);
    if (!adapter) return null;
    const label = this.config.open_tools?.[kind]?.label;
    if ("failed" in adapter) return { observation: { projection: unreadableProjection(kind, label, "unavailable", adapter.failed), tools: null }, freshness: "unknown", forced: false, throttled: false, requests: 0 };
    const now = Date.now();
    let entry = this.entries.get(kind);
    const throttled = !!options.force && !!entry && now - entry.forcedAt < forceRefreshMinMs;
    const forced = !!options.force && !throttled;
    let requests = 0;
    if (!entry || now - entry.at >= (adapter.ttlMs ?? observationTtlMs) || forced) {
      let pending = this.inflight.get(kind);
      let before: number | undefined;
      if (!pending) {
        before = this.made.get(kind) ?? 0;
        pending = adapter.observe().finally(() => this.inflight.delete(kind));
        this.inflight.set(kind, pending);
      }
      const latest = await pending;
      if (before !== undefined) requests = (this.made.get(kind) ?? 0) - before;
      const previous = this.entries.get(kind);
      entry = { latest, at: Date.now(), forcedAt: forced ? Date.now() : previous?.forcedAt ?? 0, lastGood: transient(latest.projection) ? previous?.lastGood ?? null : latest };
      this.entries.set(kind, entry);
    }
    if (transient(entry.latest.projection) && entry.lastGood) {
      // Keep the last good runs and backends, but say plainly that the tool is not answering now.
      const { state, reason, checks } = entry.latest.projection;
      return { observation: { projection: { ...entry.lastGood.projection, state, ...(reason ? { reason } : {}), checks, freshness: "stale" }, tools: entry.lastGood.tools }, freshness: "stale", forced, throttled, requests };
    }
    return { observation: entry.latest, freshness: transient(entry.latest.projection) ? "unknown" : "fresh", forced, throttled, requests };
  }

  /** The most owner requests one reading of this tool makes, for a caller that keeps a budget; none when it is not configured. */
  observeCost(kind: OpenToolKind): number {
    const adapter = this.adapters.get(kind);
    return adapter && !("failed" in adapter) ? observeRequests[kind] : 0;
  }

  /** One projection per open tool in scope, in a fixed order. */
  async projections(scope: ScopeBinding, options: { force?: boolean } = {}): Promise<OpenToolProjection[]> {
    const results = await Promise.all(this.inScope(scope).map((kind) => this.observe(kind, options)));
    return results.flatMap((result) => result ? [result.observation.projection] : []);
  }
}
