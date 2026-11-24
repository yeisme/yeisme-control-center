import { createHash } from "node:crypto";
import { AuthError } from "./auth";
import type { ScopeBinding, Session } from "./contracts";
import { dramaLimits, validDramaRef, type DramaService } from "./drama";
import type { TaskConnections } from "./task-connections";
import type { EpisodeProductionReader } from "./episode-production";
import type { TaskReviewReader } from "./task-review";
import { stationReviewKeys } from "../src/shared/task-review";
import type { DramaEpisodeDetail } from "../src/shared/drama";
import { buildProductionLine, taskKeyOf, type ProductionInput, type ProductionLine, type ProductionRange } from "../src/shared/production-line";
import type { TaskConnectionState, TaskSnapshot } from "../src/task-observation";

/**
 * An agent polling one episode must not become an owner task read per poll. Episode and list reads keep their own
 * caches in the drama service; this one holds the finished line per session, epoch, scope and range.
 */
export const productionCacheMs = 15_000;
const cacheLimit = 200;

export interface ProductionQuery {
  episode_ref?: string;
  scaena_episode_ref?: string;
}

interface Entry {
  at: number;
  line: ProductionLine;
}

/**
 * `GET /production`: the same seven-station line the episode studio and the project view draw, built by the same
 * function from the same reads. Read-only; it never starts, retries or cancels anything.
 */
export class ProductionReader {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<ProductionLine>>();

  constructor(private deps: {
    drama: Pick<DramaService, "episode" | "episodes">;
    tasks: Pick<TaskConnections, "list">;
    /** Scaena's per-episode summary; absent in callers that do not read it, and then the cut station keeps its gaps. */
    episodeProduction?: Pick<EpisodeProductionReader, "read">;
    /** Eikona's review records for the frames station's tasks; absent in callers that do not read them. */
    taskReviews?: Pick<TaskReviewReader, "readMany">;
    clientOrigins?: { muweave?: string };
    now?: () => number;
  }) {}

  private now() { return this.deps.now ? this.deps.now() : Date.now(); }

  async read(scope: ScopeBinding, session: Session, query: ProductionQuery): Promise<{ line: ProductionLine; cache: "hit" | "miss" }> {
    const episode = query.episode_ref;
    if (episode !== undefined && !validDramaRef(episode)) throw new AuthError("invalid_reference", 400);
    if (query.scaena_episode_ref !== undefined && (episode === undefined || !validDramaRef(query.scaena_episode_ref))) throw new AuthError("invalid_reference", 400);
    const key = createHash("sha256").update(JSON.stringify([session.id, session.epoch, scope, episode ?? null, query.scaena_episode_ref ?? null, "production_line.v3"])).digest("hex");
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < productionCacheMs) return { line: hit.line, cache: "hit" };
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.build(scope, session, query).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    const line = await pending;
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), line });
    while (this.entries.size > cacheLimit) this.entries.delete(this.entries.keys().next().value as string);
    return { line, cache: "miss" };
  }

  private async build(scope: ScopeBinding, session: Session, query: ProductionQuery): Promise<ProductionLine> {
    const [tasks, episode] = await Promise.all([this.tasks(scope, session), query.episode_ref ? this.episode(scope, session, query) : Promise.resolve(undefined)]);
    const now = new Date(this.now()).toISOString();
    if (query.episode_ref) {
      const detail = episode ?? null;
      const range: ProductionRange = {
        kind: "episode",
        episode_ref: query.episode_ref,
        ...(detail?.scaena_episode_ref ? { scaena_episode_ref: detail.scaena_episode_ref } : query.scaena_episode_ref ? { scaena_episode_ref: query.scaena_episode_ref } : {}),
      };
      const production = session.personal && this.deps.episodeProduction
        ? await this.deps.episodeProduction.read(scope, query.episode_ref, range.scaena_episode_ref, session).catch(() => ({ state: "unavailable" as const, reason: "source_unavailable" }))
        : undefined;
      return this.withReviews(scope, session, { scope: scope.id, now: detail?.observed_at || now, range, detail, ...tasks, ...(production ? { production } : {}) });
    }
    let list: Awaited<ReturnType<DramaService["episodes"]>>["body"] | null = null;
    try {
      list = (await this.deps.drama.episodes(scope, session, { limit: dramaLimits.defaultPage, order: "recent" })).body;
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) throw error;
    }
    return this.withReviews(scope, session, {
      scope: scope.id,
      now: list?.observed_at || now,
      range: { kind: "project", ...(scope.project ? { project_ref: scope.project } : {}), ...(scope.label ? { title: scope.label } : {}) },
      episodes: list?.rows || [],
      sources: list?.sources,
      episodesReadable: !!list,
      ...tasks,
    });
  }

  /** The line, then again with Eikona's review records for the tasks its frames station shows, when they could be asked. */
  private async withReviews(scope: ScopeBinding, session: Session, input: ProductionInput): Promise<ProductionLine> {
    const line = buildProductionLine(input);
    const keys = session.personal && this.deps.taskReviews ? stationReviewKeys(line.stations.find((station) => station.station === "frames")) : [];
    if (!keys.length) return line;
    const reviews = await this.deps.taskReviews!.readMany(scope, keys).catch((error) => {
      if (error instanceof AuthError && error.status === 401) throw error;
      return Object.fromEntries(keys.map((key) => [key, { state: "unavailable" as const, reason: "source_unavailable" }]));
    });
    return buildProductionLine({ ...input, reviews });
  }

  /** A failed episode read leaves story and board unreadable; the task stations still answer for themselves. */
  private async episode(scope: ScopeBinding, session: Session, query: ProductionQuery): Promise<Omit<DramaEpisodeDetail, "epoch"> | null> {
    try {
      return await this.deps.drama.episode(scope, session, query.episode_ref!, {
        ...(query.scaena_episode_ref ? { scaena_episode_ref: query.scaena_episode_ref } : {}),
        clientOrigins: this.deps.clientOrigins,
      });
    } catch (error) {
      if (error instanceof AuthError && (error.status === 400 || error.status === 401)) throw error;
      return null;
    }
  }

  /** Both lanes, each task once. Only a personal session has task connections, the same rule as `GET /tasks`. */
  private async tasks(scope: ScopeBinding, session: Session): Promise<{ tasks: TaskSnapshot[]; tasksReadable: boolean; tasksReason?: string; connections: TaskConnectionState[] }> {
    if (!session.personal) return { tasks: [], tasksReadable: false, tasksReason: "personal_connection_required", connections: [] };
    try {
      const [active, history] = await Promise.all([this.deps.tasks.list(scope, "active"), this.deps.tasks.list(scope, "history")]);
      const seen = new Set<string>();
      const rows = [...active.rows, ...history.rows].filter((task) => {
        const key = taskKeyOf(task);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const connections = [...active.connections, ...history.connections].filter((connection, index, all) => all.findIndex((other) => other.id === connection.id) === index);
      return { tasks: rows, tasksReadable: true, connections };
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) throw error;
      return { tasks: [], tasksReadable: false, tasksReason: error instanceof AuthError ? error.code : "task_source_unavailable", connections: [] };
    }
  }
}
