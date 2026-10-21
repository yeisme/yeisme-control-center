import type { CoverageState } from "../request-visibility";

export const creativeFlowStages = [
  "screenplay",
  "director_plan",
  "creative_storyboard",
  "production_handoff",
  "production_breakdown",
] as const;

export type CreativeFlowStage = (typeof creativeFlowStages)[number];
export type CreativeFlowOwner = "auctra" | "scaena" | "muweave" | "control-center";
export type CreativeFlowState =
  | "accepted"
  | "ready"
  | "waiting_review"
  | "blocked"
  | "stale"
  | "missing"
  | "needs_contract"
  | "unknown"
  | "unavailable"
  | "forbidden";
export type CreativeFlowAction = "review" | "repair" | "inspect" | "handoff" | "open_owner";

export interface CreativeFlowStageProjection {
  stage: CreativeFlowStage;
  owner: CreativeFlowOwner;
  object_kind: string;
  source_ref: string;
  state: CreativeFlowState;
  native_state: string;
  revision: string;
  digest?: string;
  observed_at: string;
  freshness: "fresh" | "stale" | "unknown";
  coverage: CoverageState;
  source_current: boolean;
  blockers: string[];
  safe_refs: string[];
  project_ref?: string;
  episode_ref?: string;
  scene_ref?: string;
  shot_ref?: string;
  breakdown_ref?: string;
}

export interface CreativeFlowEdge {
  from_stage: CreativeFlowStage;
  to_stage: CreativeFlowStage;
  from_ref: string;
  to_ref: string;
  relation: "feeds" | "handoff" | "projects";
  state: CreativeFlowState;
  source_revision?: string;
  digest?: string;
  evidence_refs: string[];
}

export interface CreativeFlowLaunchContext {
  owner: CreativeFlowOwner;
  target_route: "script" | "storyboard" | "director" | "breakdown";
  project_ref?: string;
  episode_ref?: string;
  scene_ref?: string;
  shot_ref?: string;
  breakdown_ref?: string;
  source_revision?: string;
  return_path: string;
  safe_object_refs: string[];
}

export interface CreativeFlowProjection {
  schema_version: "yeisme.creative_flow.v1";
  scope: string;
  project_ref: string;
  episode_ref?: string;
  observed_at: string;
  coverage: CoverageState;
  source_coverage: Array<{ owner: CreativeFlowOwner; state: CoverageState; observed_at: string; reason?: string }>;
  stages: CreativeFlowStageProjection[];
  edges: CreativeFlowEdge[];
  next_attention?: {
    stage: CreativeFlowStage;
    owner: CreativeFlowOwner;
    action: CreativeFlowAction;
    reason: string;
    source_ref?: string;
    evidence_refs: string[];
  };
  launch_contexts: CreativeFlowLaunchContext[];
}
