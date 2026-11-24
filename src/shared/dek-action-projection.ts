import type { CreativeFlowProjection } from "./creative-flow";
import type { WorkQueueItem } from "./work-queue";

export type DEKCompletionLevel = "ACCEPTED" | "COMPLETED" | "BOUND" | "REVIEWED" | "UNKNOWN" | "TERMINAL_REJECTED";

export interface DEKActionRefBinding {
  action_id: string;
  event_cursor: string;
  eikona_run_id?: string;
  scaena_submission_ref?: string;
  control_center_revision?: string;
  readback_ref?: string;
  binding_digest?: string;
  review_decision_ref?: string;
  outcome: DEKCompletionLevel;
  preview_only?: boolean;
}

export interface DEKActionQueueEntry {
  item: WorkQueueItem;
  action_id: string;
  event_cursor: string;
  eikona_run_id?: string;
  scaena_submission_ref?: string;
  control_center_revision: string;
  outcome: DEKCompletionLevel;
  preview_owner_written: false;
  production_ready: boolean;
}

export interface CreativeFlowDEKMilestoneRail {
  schema_version: "yeisme.creative_flow.dek_milestones.v1";
  project_ref: string;
  episode_ref?: string;
  action_id: string;
  event_cursor: string;
  accepted: boolean;
  completed: boolean;
  bound: boolean;
  reviewed: boolean;
  preview_owner_written: false;
  production_ready: false;
  stage_outcomes: Array<{
    stage: CreativeFlowProjection["stages"][number]["stage"];
    owner: CreativeFlowProjection["stages"][number]["owner"];
    level: DEKCompletionLevel;
    revision: string;
  }>;
}

const outcomeRank: Record<DEKCompletionLevel, number> = {
  UNKNOWN: 0,
  TERMINAL_REJECTED: 1,
  ACCEPTED: 2,
  COMPLETED: 3,
  BOUND: 4,
  REVIEWED: 5,
};

function compareCursor(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB) && a.trim() !== "" && b.trim() !== "") {
    return numA - numB;
  }
  return a.localeCompare(b);
}

export function deriveControlCenterActionID(item: Pick<WorkQueueItem, "operation_ref" | "task_ref" | "source_ref" | "work_ref">): string {
  const candidate = item.operation_ref || item.task_ref || item.source_ref || item.work_ref;
  if (candidate.startsWith("dekact_")) return candidate;
  return `dekact_cc_${candidate.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function normalizeDEKOutcome(binding: DEKActionRefBinding): DEKCompletionLevel {
  if (binding.outcome === "UNKNOWN" || binding.outcome === "TERMINAL_REJECTED") {
    return binding.outcome;
  }
  if (binding.review_decision_ref && binding.binding_digest && binding.readback_ref) {
    return "REVIEWED";
  }
  if (binding.binding_digest && binding.readback_ref) {
    return "BOUND";
  }
  if (binding.readback_ref) {
    return "COMPLETED";
  }
  return "ACCEPTED";
}

function fallbackOutcomeFromItemState(state: string): DEKCompletionLevel {
  if (state === "unknown") return "UNKNOWN";
  if (state === "accepted" || state === "reviewed") return "REVIEWED";
  return "ACCEPTED";
}

function stageOutcomeLevel(state: CreativeFlowProjection["stages"][number]["state"]): DEKCompletionLevel {
  if (state === "accepted") return "REVIEWED";
  if (state === "ready") return "BOUND";
  if (state === "unknown") return "UNKNOWN";
  if (state === "blocked") return "TERMINAL_REJECTED";
  return "ACCEPTED";
}

export function mapOwnerRefToActionProjection(
  item: WorkQueueItem,
  binding?: Partial<DEKActionRefBinding>,
): DEKActionQueueEntry {
  const actionID = binding?.action_id || deriveControlCenterActionID(item);
  const eventCursor = binding?.event_cursor || item.revision || "0";
  const resolvedOutcome = binding
    ? normalizeDEKOutcome({
        action_id: actionID,
        event_cursor: eventCursor,
        eikona_run_id: binding.eikona_run_id,
        scaena_submission_ref: binding.scaena_submission_ref,
        control_center_revision: binding.control_center_revision || item.revision,
        readback_ref: binding.readback_ref,
        binding_digest: binding.binding_digest,
        review_decision_ref: binding.review_decision_ref,
        outcome: binding.outcome || "ACCEPTED",
        preview_only: binding.preview_only,
      })
    : fallbackOutcomeFromItemState(item.state);

  return {
    item,
    action_id: actionID,
    event_cursor: eventCursor,
    eikona_run_id: binding?.eikona_run_id ?? (item.owner === "eikona" ? item.task_ref : undefined),
    scaena_submission_ref: binding?.scaena_submission_ref ?? (item.owner === "scaena" ? item.operation_ref : undefined),
    control_center_revision: binding?.control_center_revision ?? item.revision,
    outcome: resolvedOutcome,
    preview_owner_written: false,
    production_ready: false,
  };
}

export function dedupeWorkQueueByActionCursor(entries: DEKActionQueueEntry[]): DEKActionQueueEntry[] {
  const map = new Map<string, DEKActionQueueEntry>();
  for (const entry of entries) {
    const prev = map.get(entry.action_id);
    if (!prev) {
      map.set(entry.action_id, entry);
      continue;
    }
    const cursorCmp = compareCursor(entry.event_cursor, prev.event_cursor);
    const merged: DEKActionQueueEntry =
      cursorCmp > 0 || (cursorCmp === 0 && outcomeRank[entry.outcome] >= outcomeRank[prev.outcome])
        ? {
            ...entry,
            eikona_run_id: entry.eikona_run_id || prev.eikona_run_id,
            scaena_submission_ref: entry.scaena_submission_ref || prev.scaena_submission_ref,
            control_center_revision: entry.control_center_revision || prev.control_center_revision,
          }
        : {
            ...prev,
            eikona_run_id: prev.eikona_run_id || entry.eikona_run_id,
            scaena_submission_ref: prev.scaena_submission_ref || entry.scaena_submission_ref,
            control_center_revision: prev.control_center_revision || entry.control_center_revision,
          };
    map.set(entry.action_id, merged);
  }
  return Array.from(map.values());
}

export function projectCreativeFlowCompletionMilestones(
  flow: CreativeFlowProjection,
  binding: DEKActionRefBinding,
): CreativeFlowDEKMilestoneRail {
  const effective = normalizeDEKOutcome(binding);
  const rank = outcomeRank[effective];
  return {
    schema_version: "yeisme.creative_flow.dek_milestones.v1",
    project_ref: flow.project_ref,
    episode_ref: flow.episode_ref,
    action_id: binding.action_id,
    event_cursor: binding.event_cursor,
    accepted: rank >= outcomeRank.ACCEPTED,
    completed: rank >= outcomeRank.COMPLETED,
    bound: rank >= outcomeRank.BOUND,
    reviewed: rank >= outcomeRank.REVIEWED,
    preview_owner_written: false,
    production_ready: false,
    stage_outcomes: flow.stages.map((s) => ({
      stage: s.stage,
      owner: s.owner,
      level: stageOutcomeLevel(s.state),
      revision: s.revision,
    })),
  };
}
