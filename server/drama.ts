import { createHash } from "node:crypto";
import { AuthError } from "./auth";
import type { AuctraCollectionReader, AuctraCreativeFlowSnapshot } from "./auctra";
import type { ScopeBinding, ServerConfig, Session } from "./contracts";
import type { AuctraCollectionStore } from "./db/auctra-collection-store";
import type { ScaenaStoryboardReader } from "./scaena-storyboard";
import { buildCreativeFlow } from "./creative-flow";
import { stageOwnerLinks } from "./work-queue";
import type { CoverageState } from "../src/request-visibility";
import type { CreativeFlowProjection } from "../src/shared/creative-flow";
import {
  dramaEpisodeSchema,
  dramaEpisodesSchema,
  railFromFlow,
  validDramaRef,
  type DramaEpisodeDetail,
  type DramaEpisodeRow,
  type DramaEpisodesResponse,
  type DramaFlowSummary,
  type StoryboardOutline,
} from "../src/shared/drama";

const ttlMs = 45_000;
/** An owner outage is remembered briefly, so the board, the queue and the review page do not each wait out the same dead owner. */
const outageTtlMs = 10_000;
const refreshGapMs = 10_000;
const cacheLimit = 200;
const poolSize = 4;
const defaultReadBudget = 8;
export const dramaLimits = { maxPage: 24, defaultPage: 12, maxExtra: 12 } as const;
export { validDramaRef };

interface FlowValue {
  flow: CreativeFlowProjection;
  outline?: StoryboardOutline;
  scaena_episode_ref: string;
  read_at: number;
  ttl: number;
}

type CacheOutcome = "hit" | "miss" | "refresh_limited";

async function mapPool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index]);
    }
  }));
  return out;
}

export class DramaService {
  private entries = new Map<string, FlowValue>();
  private inflight = new Map<string, Promise<FlowValue>>();

  constructor(private readonly deps: {
    config: ServerConfig;
    auctra: AuctraCollectionReader;
    scaena: ScaenaStoryboardReader;
    store: AuctraCollectionStore;
    clock?: () => number;
  }) {}

  private now() { return (this.deps.clock || Date.now)(); }

  private auctraBound(scope: ScopeBinding) {
    const target = this.deps.config.collection?.auctra;
    return Boolean(target && target.enabled !== false && scope.collection?.auctra);
  }

  /** Owner reads are delegated per session, so no cached projection may cross a session, epoch, scope or binding. */
  private key(session: Session, scope: ScopeBinding, episode: string, scaenaEpisode: string, skipAuctra: boolean) {
    const binding = createHash("sha256").update(JSON.stringify([scope.project, scope.collection?.auctra ?? null, scope.owners.scaena ?? null])).digest("hex").slice(0, 16);
    return createHash("sha256").update(JSON.stringify([session.id, session.epoch, scope.id, binding, episode, scaenaEpisode, skipAuctra])).digest("hex");
  }

  /**
   * A ref the synced collection does not contain is not an Auctra episode (it is usually a Scaena ref taken from a task), and Auctra
   * matches plans by the ref's trailing digits, so asking it would show another episode's plans. Never synced means we cannot tell.
   */
  private notInCollection(scope: ScopeBinding, episode: string) {
    if (!episode || !this.auctraBound(scope) || this.deps.store.coverage(scope.id).state === "unknown") return false;
    return !this.deps.store.episodeUnits(scope.id).some((unit) => unit.unit_ref === episode);
  }

  private peek(session: Session, scope: ScopeBinding, episode: string, scaenaEpisode: string) {
    const hit = this.entries.get(this.key(session, scope, episode, scaenaEpisode, this.notInCollection(scope, episode)));
    return hit && this.now() - hit.read_at < hit.ttl ? hit : undefined;
  }

  private async fetch(scope: ScopeBinding, session: Session, episode: string, scaenaEpisode: string, skipAuctra: boolean, breakdownRef?: string): Promise<FlowValue> {
    const skipped = (): AuctraCreativeFlowSnapshot => ({
      schema_version: "auctra.creative_flow_source.v1", owner: "auctra", project_ref: scope.collection?.auctra?.project || scope.project, episode_ref: episode,
      observed_at: new Date(this.now()).toISOString(), coverage: "unknown", stages: [], blocker: "episode_not_in_collection",
    });
    const [auctraFlow, scaena] = await Promise.all([
      skipAuctra ? Promise.resolve(skipped()) : this.deps.auctra.creativeFlow(scope.id, scope, session, { episode_ref: episode || undefined }),
      this.deps.scaena.snapshot(scope, session, { episode_ref: scaenaEpisode || undefined, breakdown_ref: breakdownRef }),
    ]);
    const flow = buildCreativeFlow({
      scope: scope.id,
      project_ref: scope.project,
      ...(episode ? { episode_ref: episode } : {}),
      ...(scaenaEpisode && scaenaEpisode !== episode ? { scaena_episode_ref: scaenaEpisode } : {}),
      auctra_flow: auctraFlow,
      scaena,
    });
    const outage = flow.source_coverage.some((source) => source.state === "unavailable");
    return { flow, ...(scaena.outline ? { outline: scaena.outline } : {}), scaena_episode_ref: scaenaEpisode || episode, read_at: this.now(), ttl: outage ? outageTtlMs : ttlMs };
  }

  private async read(scope: ScopeBinding, session: Session, episode: string, scaenaEpisode: string, options: { refresh?: boolean; breakdown_ref?: string } = {}): Promise<{ value: FlowValue; cache: CacheOutcome }> {
    const skipAuctra = this.notInCollection(scope, episode);
    if (options.breakdown_ref) return { value: await this.fetch(scope, session, episode, scaenaEpisode, skipAuctra, options.breakdown_ref), cache: "miss" };
    const key = this.key(session, scope, episode, scaenaEpisode, skipAuctra);
    const hit = this.entries.get(key);
    const age = hit ? this.now() - hit.read_at : Infinity;
    if (hit && age < hit.ttl && (!options.refresh || age < refreshGapMs)) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return { value: hit, cache: options.refresh ? "refresh_limited" : "hit" };
    }
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetch(scope, session, episode, scaenaEpisode, skipAuctra).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    const value = await pending;
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > cacheLimit) this.entries.delete(this.entries.keys().next().value as string);
    return { value, cache: "miss" };
  }

  /** Back-compat for GET /creative-flow: a single known episode is inferred; otherwise the owners report episode_ref_required. */
  async flow(scope: ScopeBinding, session: Session, query: { episode_ref?: string; breakdown_ref?: string } = {}): Promise<CreativeFlowProjection> {
    let episode = query.episode_ref || "";
    if (!episode && this.auctraBound(scope)) {
      const units = this.deps.store.episodeUnits(scope.id);
      if (units.length === 1) episode = units[0].unit_ref;
    }
    const { value } = await this.read(scope, session, episode, episode, { breakdown_ref: query.breakdown_ref });
    return value.flow;
  }

  /** Flows for the most recently updated episodes, for the attention queue. Served from the same cache as the board. */
  async attentionFlows(scope: ScopeBinding, session: Session, max = 3): Promise<{ flows: CreativeFlowProjection[]; checked: number; total: number }> {
    if (!this.auctraBound(scope)) return { flows: [], checked: 0, total: 0 };
    const all = this.deps.store.episodeUnits(scope.id);
    const units = [...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, max);
    const flows = await mapPool(units, max, async (unit) => {
      try { return (await this.read(scope, session, unit.unit_ref, unit.unit_ref)).value.flow; } catch { return null; }
    });
    return { flows: flows.filter((flow): flow is CreativeFlowProjection => !!flow), checked: units.length, total: all.length };
  }

  private summary(value: FlowValue): DramaFlowSummary {
    const { flow } = value;
    return {
      coverage: flow.coverage,
      observed_at: flow.observed_at,
      rail: railFromFlow(flow),
      ...(flow.next_attention ? { next_attention: flow.next_attention } : {}),
      source_coverage: flow.source_coverage,
      scaena_episode_ref: value.scaena_episode_ref,
    };
  }

  async episodes(scope: ScopeBinding, session: Session, query: { q?: string; limit?: number; offset?: number; read?: "all"; order?: "recent" | "natural"; extra?: string[] }) {
    const limit = Math.min(Math.max(query.limit ?? dramaLimits.defaultPage, 1), dramaLimits.maxPage);
    const offset = Math.max(query.offset ?? 0, 0);
    const bound = this.auctraBound(scope);
    const sync = this.deps.store.coverage(scope.id);
    const units = bound ? this.deps.store.episodeUnits(scope.id) : [];
    const universeCoverage: CoverageState = !bound ? "needs_contract" : sync.state === "unknown" ? "unknown" : sync.state === "stale" ? "expired" : "complete";
    const universeReason = !bound ? "source_not_configured" : sync.state === "unknown" ? "collection_not_synced" : undefined;

    const rows: DramaEpisodeRow[] = units.map((unit) => ({
      episode_ref: unit.unit_ref,
      title: unit.title || unit.unit_ref,
      origin: "collection",
      ...(unit.status ? { native_status: unit.status } : {}),
      record_ref: unit.record_ref,
      updated_at: unit.updated_at,
      source_state: unit.source_state,
      read: "deferred",
    }));
    const known = new Set(rows.map((row) => row.episode_ref));
    for (const ref of query.extra || []) {
      if (known.has(ref)) continue;
      known.add(ref);
      rows.push({ episode_ref: ref, title: ref, origin: "requested", read: "deferred" });
    }
    const needle = (query.q || "").trim().toLowerCase();
    const filtered = needle ? rows.filter((row) => `${row.episode_ref} ${row.title}`.toLowerCase().includes(needle)) : rows;
    // "recent" is for attention views (stage reviews): the episodes someone touched last matter more than episode 1.
    const matched = query.order === "recent" ? [...filtered].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")) : filtered;
    const page = matched.slice(offset, offset + limit);
    // Cached rows cost nothing, so only rows that need an owner call spend the budget.
    let budget = query.read === "all" ? page.length : defaultReadBudget;
    const chosen = page.filter((row) => {
      if (this.peek(session, scope, row.episode_ref, row.episode_ref)) return true;
      if (budget <= 0) return false;
      budget--;
      return true;
    });

    await mapPool(chosen, poolSize, async (row) => {
      try {
        const { value, cache } = await this.read(scope, session, row.episode_ref, row.episode_ref);
        row.flow = this.summary(value);
        const unreadable = value.flow.source_coverage.every((source) => ["unavailable", "forbidden", "needs_contract"].includes(source.state));
        row.read = unreadable ? "failed" : cache === "hit" ? "cached" : "read";
        if (unreadable) row.read_reason = value.flow.source_coverage.find((source) => source.reason)?.reason || "owner_unreadable";
      } catch (error) {
        row.read = "failed";
        row.read_reason = error instanceof AuthError ? error.code : "owner_unavailable";
      }
    });

    const next = offset + limit < matched.length ? offset + limit : undefined;
    const body: Omit<DramaEpisodesResponse, "epoch" | "next_cursor"> = {
      schema_version: dramaEpisodesSchema,
      scope: scope.id,
      observed_at: new Date(this.now()).toISOString(),
      universe: {
        source: "auctra_collection",
        coverage: universeCoverage,
        bound,
        ...(universeReason ? { reason: universeReason } : {}),
        total: units.length,
        ...(sync.observed_at ? { observed_at: sync.observed_at } : {}),
      },
      read_count: page.filter((row) => row.flow).length,
      row_count: page.length,
      total: matched.length,
      rows: page,
    };
    return { body, next_offset: next };
  }

  async episode(scope: ScopeBinding, session: Session, episodeRef: string, options: { scaena_episode_ref?: string; refresh?: boolean; clientOrigins?: { muweave?: string } } = {}): Promise<Omit<DramaEpisodeDetail, "epoch">> {
    if (!validDramaRef(episodeRef)) throw new AuthError("invalid_reference", 400);
    if (options.scaena_episode_ref !== undefined && !validDramaRef(options.scaena_episode_ref)) throw new AuthError("invalid_reference", 400);
    const scaenaEpisode = options.scaena_episode_ref || episodeRef;
    const { value, cache } = await this.read(scope, session, episodeRef, scaenaEpisode, { refresh: options.refresh });
    const { flow } = value;
    return {
      schema_version: dramaEpisodeSchema,
      scope: scope.id,
      episode_ref: episodeRef,
      scaena_episode_ref: scaenaEpisode,
      scaena_episode_overridden: scaenaEpisode !== episodeRef,
      observed_at: flow.observed_at,
      cache,
      flow,
      rail: railFromFlow(flow),
      ...(value.outline ? { outline: value.outline } : {}),
      handoff: flow.stages.map((stage) => ({ stage: stage.stage, owner: stage.owner, links: stageOwnerLinks(stage, flow, scope.id, options.clientOrigins, "/drama") })),
    };
  }
}
