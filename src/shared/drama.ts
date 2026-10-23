import type { CoverageState } from "../request-visibility";
import { creativeFlowStages } from "./creative-flow";
import type { CreativeFlowOwner, CreativeFlowProjection, CreativeFlowStage, CreativeFlowState } from "./creative-flow";
import type { WorkQueueLink } from "./work-queue";

export const dramaEpisodesSchema = "yeisme.drama_episodes.v1" as const;
export const dramaEpisodeSchema = "yeisme.drama_episode.v1" as const;

/** `requested` rows come from the caller (task episode refs or a typed ref); the server cannot tell which, so the client labels them. */
export type DramaEpisodeOrigin = "collection" | "requested";
export type DramaReadState = "read" | "cached" | "deferred" | "failed";
export type DramaRailState = CreativeFlowState | "not_started";

/** Structure only: headings and camera facts. Script text, prompts, candidate bodies and media never enter this projection. */
export interface StoryboardOutlineShot {
  shot_ref: string;
  order: number;
  shot_size?: string;
  camera_angle?: string;
  camera_movement?: string;
  duration_ms?: number;
}

export interface StoryboardOutlineScene {
  scene_ref: string;
  order: number;
  heading: string;
  shots: StoryboardOutlineShot[];
}

export interface StoryboardOutline {
  head_breakdown_ref: string;
  head_state: CreativeFlowState;
  head_native_state: string;
  head_revision: string;
  older_attempts: number;
  truncated: boolean;
  scene_count: number;
  shot_count: number;
  duration_ms: number | null;
  finding_count: number | null;
  scenes: StoryboardOutlineScene[];
}

export interface DramaRailStage {
  stage: CreativeFlowStage;
  owner: CreativeFlowOwner;
  state: DramaRailState;
  coverage: CoverageState;
  freshness: "fresh" | "stale" | "unknown";
  source_current: boolean;
  blocker?: string;
  observed_at?: string;
}

export interface DramaFlowSummary {
  coverage: CoverageState;
  observed_at: string;
  rail: DramaRailStage[];
  next_attention?: CreativeFlowProjection["next_attention"];
  source_coverage: CreativeFlowProjection["source_coverage"];
  scaena_episode_ref?: string;
}

export interface DramaEpisodeRow {
  episode_ref: string;
  title: string;
  origin: DramaEpisodeOrigin;
  native_status?: string;
  record_ref?: string;
  updated_at?: string;
  source_state?: "fresh" | "stale" | "unknown";
  read: DramaReadState;
  read_reason?: string;
  flow?: DramaFlowSummary;
}

export interface DramaEpisodesResponse {
  schema_version: typeof dramaEpisodesSchema;
  epoch: number;
  scope: string;
  observed_at: string;
  universe: {
    source: "auctra_collection";
    coverage: CoverageState;
    bound: boolean;
    reason?: string;
    total: number;
    observed_at?: string;
  };
  read_count: number;
  row_count: number;
  total: number;
  rows: DramaEpisodeRow[];
  next_cursor?: string;
}

export interface DramaHandoff {
  stage: CreativeFlowStage;
  owner: CreativeFlowOwner;
  links: WorkQueueLink[];
}

export interface DramaEpisodeDetail {
  schema_version: typeof dramaEpisodeSchema;
  epoch: number;
  scope: string;
  episode_ref: string;
  scaena_episode_ref: string;
  scaena_episode_overridden: boolean;
  observed_at: string;
  cache: "hit" | "miss" | "refresh_limited";
  flow: CreativeFlowProjection;
  rail: DramaRailStage[];
  outline?: StoryboardOutline;
  handoff: DramaHandoff[];
}

export interface DramaEpisodesQuery {
  q?: string;
  limit?: number;
  cursor?: string;
  read?: "all";
}

export const maxDramaRef = 512;

/** One definition for both sides: both owners trim refs, so a padded ref would silently match nothing. */
export function validDramaRef(value: string) {
  return value.length > 0 && value.length <= maxDramaRef && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}

export const stageOwner = (stage: CreativeFlowStage): CreativeFlowOwner => stage === "production_breakdown" ? "scaena" : "auctra";

const absentStates = new Set<string>(["needs_contract", "forbidden", "unavailable"]);

/** Always five entries in pipeline order, so a missing stage is explained by its owner's coverage rather than dropped. */
export function railFromFlow(flow: Pick<CreativeFlowProjection, "stages" | "source_coverage">): DramaRailStage[] {
  const coverage = new Map(flow.source_coverage.map((item) => [item.owner, item]));
  return creativeFlowStages.map((stage) => {
    const owner = stageOwner(stage);
    const found = flow.stages.find((item) => item.stage === stage);
    if (found) {
      return {
        stage,
        owner,
        state: found.state,
        coverage: found.coverage,
        freshness: found.freshness,
        source_current: found.source_current,
        ...(found.blockers[0] ? { blocker: found.blockers[0] } : {}),
        observed_at: found.observed_at,
      };
    }
    const source = coverage.get(owner);
    const state: DramaRailState = source?.state === "complete" ? "not_started" : source && absentStates.has(source.state) ? source.state as CreativeFlowState : "unknown";
    return {
      stage,
      owner,
      state,
      coverage: source?.state ?? "unknown",
      freshness: "unknown",
      source_current: false,
      ...(source?.reason ? { blocker: source.reason } : {}),
    };
  });
}

/** Auctra reports a not-yet-accepted screenplay as blocked; that is progress waiting on a person, not a fault. */
export const neutralBlockers = new Set(["source_not_accepted"]);

export const isNeutralNode = (node: Pick<DramaRailStage, "state" | "blocker">) => node.state === "blocked" && !!node.blocker && neutralBlockers.has(node.blocker);

const problemStates = new Set<string>(["waiting_review", "blocked", "stale"]);

/**
 * A node that needs a person's attention. An accepted stage built on a source that is no longer current counts, and an `unknown`
 * counts only when the owner actually returned it; an unknown that is just "nobody answered" is unreadable, not a problem.
 */
export function isProblemNode(node: DramaRailStage) {
  if (problemStates.has(node.state)) return true;
  if (node.state === "unknown") return !!node.observed_at;
  return (node.state === "accepted" || node.state === "ready") && !node.source_current;
}

export interface DramaNextStep {
  kind: "attention" | "start" | "in_progress" | "unreadable" | "done";
  stage?: CreativeFlowStage;
  owner?: CreativeFlowOwner;
  action?: "review" | "repair" | "inspect" | "handoff" | "open_owner" | "start";
  reason?: string;
}

/**
 * Real problems first (a failure beats "start the next stage"), then the first stage nobody has started, then work in flight,
 * then anything unreadable. Done only when every stage is accepted and current, so an outage never looks like progress.
 */
export function dramaNextStep(rail: DramaRailStage[], attention?: CreativeFlowProjection["next_attention"]): DramaNextStep {
  const problems = rail.filter(isProblemNode);
  const pick = problems.find((node) => !isNeutralNode(node)) || problems[0];
  if (pick) {
    const action = pick.state === "waiting_review" ? "review" : pick.state === "unknown" ? "inspect" : "repair";
    const reason = pick.blocker || (attention?.stage === pick.stage ? attention.reason : undefined) || pick.state;
    return { kind: "attention", stage: pick.stage, owner: pick.owner, action, reason };
  }
  const pending = rail.find((node) => node.state === "not_started" || node.state === "missing");
  if (pending) return { kind: "start", stage: pending.stage, owner: pending.owner, action: "start" };
  const running = rail.find((node) => node.state === "in_progress");
  if (running) return { kind: "in_progress", stage: running.stage, owner: running.owner };
  const unread = rail.find((node) => !["accepted", "ready"].includes(node.state));
  if (unread) return { kind: "unreadable", stage: unread.stage, owner: unread.owner, ...(unread.blocker ? { reason: unread.blocker } : {}) };
  return { kind: "done" };
}
