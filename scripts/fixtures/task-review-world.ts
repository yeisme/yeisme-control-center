/**
 * Eikona's review fact for one run as the fixture Eikona keeps it, shaped like `control_center.tasks.review`
 * (`cli/eikona/internal/mcp/task_review_observation.go`). Counts only: no candidate labels, reviewer or reasons.
 *
 * - fx-eikona answers: a run waiting on a person has every candidate pending; a finished run with results was accepted.
 * - every other connection is an Eikona that predates the action, so the fake owner answers UNKNOWN_ACTION.
 */
interface ReviewSpec {
  ref: string;
  family: string;
  state: string;
  updatedMinutes: number;
  results?: unknown[];
}

const answering = new Set(["fx-eikona"]);

export function taskReviewObservation(connection: string, spec: ReviewSpec | undefined, family: unknown, now = Date.now()) {
  if (!answering.has(connection) || !spec || spec.family !== "run" || (family !== undefined && family !== "" && family !== "run")) return null;
  const candidates = spec.results?.length || 0;
  const accepted = spec.state === "succeeded" && candidates > 0;
  return {
    schema_version: "yeisme.task_review_observation.v1",
    task_ref: spec.ref,
    task_family: "run",
    owner_decision: accepted ? "accepted" : "pending",
    admission: "unknown",
    candidate_count: candidates,
    decided_count: accepted ? 1 : 0,
    pending_count: accepted ? candidates - 1 : candidates,
    revision: accepted ? 1 : 0,
    observed_at: new Date(now).toISOString(),
    ...(accepted ? { decided_at: new Date(now - spec.updatedMinutes * 60_000).toISOString() } : {}),
  };
}
