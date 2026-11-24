import { AuthError } from "./auth";
import type { ScopeBinding } from "./contracts";
import type { TaskConnections } from "./task-connections";
import { normalizeTaskReview, taskReviewAction, taskReviewBatchLimit, type TaskReviewRead } from "../src/shared/task-review";

/** A decision changes when a person records one in Eikona; a short cache keeps one studio visit to one read per task. */
export const taskReviewCacheMs = 30_000;
const cacheLimit = 500;

/**
 * `control_center.tasks.review` through the task's own Eikona connection, with the observer key it already has.
 * Read-only: it never decides, supersedes or records admission. An owner without the action, a refusal and a malformed
 * answer each say so; none becomes "nothing to pick".
 */
export class TaskReviewReader {
  private entries = new Map<string, { at: number; read: TaskReviewRead }>();
  private inflight = new Map<string, Promise<TaskReviewRead>>();

  constructor(private deps: { tasks: Pick<TaskConnections, "locate" | "call">; now?: () => number }) {}

  private now() { return this.deps.now ? this.deps.now() : Date.now(); }

  /** One read per distinct key, at most `taskReviewBatchLimit`; a key that does not resolve in this scope is refused. */
  async readMany(scope: ScopeBinding, keys: string[]): Promise<Record<string, TaskReviewRead>> {
    const unique = [...new Set(keys)];
    if (!unique.length || unique.length > taskReviewBatchLimit) throw new AuthError("invalid_task_key", 400);
    const located = unique.map((key) => ({ key, ...this.deps.tasks.locate(key, scope) }));
    const reads = await Promise.all(located.map((item) => this.read(scope, item)));
    return Object.fromEntries(located.map((item, index) => [item.key, reads[index]]));
  }

  private async read(scope: ScopeBinding, at: ReturnType<TaskConnections["locate"]>): Promise<TaskReviewRead> {
    const cacheKey = JSON.stringify([scope.id, at.c.id, at.ref]);
    const hit = this.entries.get(cacheKey);
    if (hit && this.now() - hit.at < taskReviewCacheMs) return hit.read;
    let pending = this.inflight.get(cacheKey);
    if (!pending) {
      pending = this.fetch(at).finally(() => this.inflight.delete(cacheKey));
      this.inflight.set(cacheKey, pending);
    }
    const read = await pending;
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, { at: this.now(), read });
    while (this.entries.size > cacheLimit) this.entries.delete(this.entries.keys().next().value as string);
    return read;
  }

  private async fetch({ c, ref, family }: ReturnType<TaskConnections["locate"]>): Promise<TaskReviewRead> {
    // Only Eikona runs have owner review decisions today; anything else has no such contract.
    if (c.owner !== "eikona" || family !== "run") return { state: "needs_contract", reason: "review_observation_contract_missing" };
    try {
      const answer = await this.deps.tasks.call(c, taskReviewAction, { task_ref: ref, task_family: family });
      return normalizeTaskReview(answer, ref, new Date(this.now()).toISOString()) || { state: "unavailable", reason: "invalid_owner_response" };
    } catch (error) {
      return failure(error);
    }
  }
}

function failure(error: unknown): TaskReviewRead {
  if (!(error instanceof AuthError)) return { state: "unavailable", reason: "source_unavailable" };
  // An Eikona that predates the action answers UNKNOWN_ACTION or refuses it outright; either way it is not published.
  if (["needs_contract", "owner_action_contract_missing", "owner_action_denied"].includes(error.code)) return { state: "needs_contract", reason: "review_observation_contract_missing" };
  if (error.code === "needs_authorization") return { state: "unavailable", reason: "needs_authorization" };
  return { state: "unavailable", reason: error.code || "source_unavailable" };
}
