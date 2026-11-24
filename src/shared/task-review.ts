/**
 * Eikona's review fact for one run (`control_center.tasks.review`), as the control center keeps it: the owner's
 * decision, the downstream admission fact and counts. No candidate labels, reviewer identity or reasons; read-only.
 */
import type { TaskSnapshot } from "../task-observation";
import { taskNeedsReview } from "./read-model/review";

export const taskReviewSchema = "yeisme.task_review_observation.v1" as const;
export const taskReviewAction = "control_center.tasks.review";
/** At most this many tasks are asked about in one batch read. */
export const taskReviewBatchLimit = 10;

export const ownerReviewDecisions = ["pending", "accepted", "rejected", "request_revision"] as const;
export type OwnerReviewDecision = (typeof ownerReviewDecisions)[number];
export const reviewAdmissions = ["unknown", "pending", "admitted", "refused"] as const;
export type ReviewAdmission = (typeof reviewAdmissions)[number];

export interface TaskReview {
  owner_decision: OwnerReviewDecision;
  admission: ReviewAdmission;
  candidate_count: number;
  decided_count: number;
  pending_count: number;
  revision: number;
  decided_at?: string;
}

/**
 * What the control center could learn for one task. `observed` carries Eikona's fact; the other states say why nothing
 * was read and never stand for "no review".
 */
export type TaskReviewRead =
  | { state: "observed"; observed_at: string; review: TaskReview }
  | { state: "needs_contract" | "unavailable"; reason: string };

const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : undefined;
const time = (value: unknown) => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : undefined;

/** Eikona's answer for the run asked about; a body that does not match the schema or names another run is `undefined`. */
export function normalizeTaskReview(value: unknown, taskRef: string, now: string): TaskReviewRead | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.schema_version !== taskReviewSchema || raw.task_ref !== taskRef || (raw.task_family !== undefined && raw.task_family !== "run")) return undefined;
  const decision = raw.owner_decision as OwnerReviewDecision;
  const admission = raw.admission as ReviewAdmission;
  if (!ownerReviewDecisions.includes(decision) || !reviewAdmissions.includes(admission)) return undefined;
  const candidates = count(raw.candidate_count), decided = count(raw.decided_count), pending = count(raw.pending_count), revision = count(raw.revision);
  if (candidates === undefined || decided === undefined || pending === undefined || revision === undefined || decided + pending !== candidates) return undefined;
  const decidedAt = time(raw.decided_at);
  return {
    state: "observed",
    observed_at: time(raw.observed_at) || now,
    review: { owner_decision: decision, admission, candidate_count: candidates, decided_count: decided, pending_count: pending, revision, ...(decidedAt ? { decided_at: decidedAt } : {}) },
  };
}

/**
 * Whether a person still has to pick a result. When Eikona answered, its decision rules: a run with candidates and no
 * decision waits; a decided run does not, whatever the task state says. Otherwise the task's own state decides.
 */
export function taskAwaitsPick(task: Pick<TaskSnapshot, "state" | "provider_recovery">, read?: TaskReviewRead) {
  if (read?.state === "observed") return read.review.owner_decision === "pending" && read.review.pending_count > 0;
  return taskNeedsReview(task);
}

/**
 * The Eikona task keys a frames station shows, in the order it shows them: tasks waiting to be picked first, then the
 * tasks behind its results. These are the ones worth asking Eikona about, at most `taskReviewBatchLimit`.
 */
export function stationReviewKeys(station: { decisions: { kind: string; task_key?: string }[]; results: { task_key: string; owner: string }[] } | undefined, limit = taskReviewBatchLimit): string[] {
  if (!station) return [];
  const keys = [
    ...station.decisions.flatMap((decision) => decision.kind === "pick_result" && decision.task_key ? [decision.task_key] : []),
    ...station.results.flatMap((result) => result.owner === "eikona" ? [result.task_key] : []),
  ];
  return [...new Set(keys)].slice(0, limit);
}
