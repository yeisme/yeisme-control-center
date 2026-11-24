import { AuthError } from "./auth";
import type { ScopeBinding, Session } from "./contracts";
import type { TaskConnections } from "./task-connections";
import { normalizeEpisodeProductionPage, type EpisodeProductionRead } from "../src/shared/episode-production";

/** Scaena answers from its own stored records; one read per episode and scope is enough for this long. */
export const episodeProductionCacheMs = 45_000;
const cacheLimit = 200;
export const episodeProductionAction = "control_center.production.episodes";

/**
 * `control_center.production.episodes` through the scope's Scaena task connection, with the observer key it already
 * has. Read-only. An owner without the operation, a refusal and a malformed page each say so; none becomes "nothing".
 */
export class EpisodeProductionReader {
  private entries = new Map<string, { at: number; read: EpisodeProductionRead }>();
  private inflight = new Map<string, Promise<EpisodeProductionRead>>();

  constructor(private deps: { tasks: Pick<TaskConnections, "connections" | "call">; now?: () => number }) {}

  private now() { return this.deps.now ? this.deps.now() : Date.now(); }

  async read(scope: ScopeBinding, episode: string, scaenaEpisode?: string, session?: Pick<Session, "id" | "epoch">): Promise<EpisodeProductionRead> {
    // Resolve effective connections before a cache hit; revoked access must not reuse an old projection.
    const connections = this.deps.tasks.connections(scope).filter((entry) => entry.owner === "scaena");
    const key = JSON.stringify([session?.id, session?.epoch, scope, connections, episode, scaenaEpisode || ""]);
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < episodeProductionCacheMs) return hit.read;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetch(scope, episode, scaenaEpisode).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    const read = await pending;
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), read });
    while (this.entries.size > cacheLimit) this.entries.delete(this.entries.keys().next().value as string);
    return read;
  }

  private async fetch(scope: ScopeBinding, episode: string, scaenaEpisode?: string): Promise<EpisodeProductionRead> {
    const connections = this.deps.tasks.connections(scope).filter((c) => c.owner === "scaena");
    if (!connections.length) return { state: "unconnected", reason: "no_task_connection" };
    // Scaena keys the summary by its production episode when the episode studio knows it, else by the center episode.
    const asked = scaenaEpisode || episode;
    let last: EpisodeProductionRead = { state: "unavailable", reason: "source_unavailable" };
    let contractGap: EpisodeProductionRead | undefined;
    for (const c of connections.slice(0, 2)) {
      try {
        const page = await this.deps.tasks.call(c, episodeProductionAction, { episode: asked, limit: 1 });
        const read = normalizeEpisodeProductionPage(page, [episode, scaenaEpisode || ""], new Date(this.now()).toISOString());
        if (!read) { last = { state: "unavailable", reason: "invalid_owner_response" }; continue; }
        return read;
      } catch (error) {
        const failed = failure(error);
        // Keep an explicit owner contract gap visible when another configured
        // connection is merely unavailable; an outage must not hide a
        // published-contract dependency.
        if (failed.state === "needs_contract") contractGap = failed;
        last = failed;
      }
    }
    return contractGap || last;
  }
}

function failure(error: unknown): EpisodeProductionRead {
  if (!(error instanceof AuthError)) return { state: "unavailable", reason: "source_unavailable" };
  // An owner that predates the operation answers UNKNOWN_ACTION or refuses it outright; either way it is not published.
  if (["needs_contract", "owner_action_contract_missing", "owner_action_denied"].includes(error.code)) return { state: "needs_contract", reason: "episode_production_contract_missing" };
  if (error.code === "needs_authorization") return { state: "unavailable", reason: "needs_authorization" };
  return { state: "unavailable", reason: error.code || "source_unavailable" };
}
