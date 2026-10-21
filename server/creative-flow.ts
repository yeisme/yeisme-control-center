import type { AuctraCollectionRecordView } from "./db/auctra-collection-store";
import type { AuctraCreativeFlowSnapshot } from "./auctra";
import type { ScaenaStoryboardSnapshot } from "./scaena-storyboard";
import type { CoverageState } from "../src/request-visibility";
import {
  creativeFlowStages,
  type CreativeFlowAction,
  type CreativeFlowProjection,
  type CreativeFlowStage,
  type CreativeFlowStageProjection,
  type CreativeFlowState,
} from "../src/shared/creative-flow";

const text = (value: unknown, max = 512) => typeof value === "string" ? value.slice(0, max) : "";
const now = () => new Date().toISOString();

function freshness(value: string, at = Date.now()): "fresh" | "stale" | "unknown" {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "unknown";
  return at - parsed > 5 * 60 * 1000 ? "stale" : "fresh";
}

function state(value: unknown): CreativeFlowState {
  const raw = text(value, 96).toLowerCase();
  if (["accepted", "approved", "adopted"].includes(raw)) return "accepted";
  if (["ready", "export_ready", "handoff_ready"].includes(raw)) return "ready";
  if (["review", "reviewing", "waiting_review", "review_required", "needs_review", "pending_review"].includes(raw)) return "waiting_review";
  if (["blocked", "failed", "rejected"].includes(raw)) return "blocked";
  if (["stale", "superseded"].includes(raw)) return "stale";
  if (["missing"].includes(raw)) return "missing";
  if (["needs_contract"].includes(raw)) return "needs_contract";
  if (["forbidden"].includes(raw)) return "forbidden";
  if (["unavailable"].includes(raw)) return "unavailable";
  return raw ? "unknown" : "unknown";
}

function coverage(value: CoverageState, stageState: CreativeFlowState): CoverageState {
  if (stageState === "needs_contract") return "needs_contract";
  if (stageState === "forbidden") return "forbidden";
  if (stageState === "unavailable") return "unavailable";
  if (stageState === "stale") return "expired";
  return value;
}

function stageForRecord(record: AuctraCollectionRecordView): CreativeFlowStage | null {
  const value = `${record.record_kind} ${record.kind || ""}`.toLowerCase();
  if (/(screenplay|screenplay_revision|script|episode_script)/.test(value)) return "screenplay";
  if (/(director_scene_plan|director_plan|director)/.test(value)) return "director_plan";
  if (/(storyboard_plan|creative_storyboard|storyboard)/.test(value) && !/(handoff|production)/.test(value)) return "creative_storyboard";
  if (/(handoff|production_handoff|storyboard_handoff)/.test(value)) return "production_handoff";
  return null;
}

function legacyAuctraStages(records: AuctraCollectionRecordView[], projectRef: string, observedAt: string): CreativeFlowStageProjection[] {
  return records.flatMap((record) => {
    const stage = stageForRecord(record);
    if (!stage) return [];
    const stageState = state(record.status || record.collection_state);
    const observed_at = record.updated_at || record.last_seen_at || observedAt;
    return [{
      stage,
      owner: "auctra" as const,
      object_kind: record.record_kind,
      source_ref: record.record_ref,
      state: stageState,
      native_state: record.status || record.collection_state || "unknown",
      revision: record.source_revision || String(record.metadata_revision),
      ...(record.source_digest ? { digest: record.source_digest } : {}),
      observed_at,
      freshness: freshness(observed_at),
      coverage: coverage(record.source_state === "unknown" ? "unknown" : record.source_state === "stale" ? "expired" : "complete", stageState),
      source_current: stageState === "accepted" || stageState === "ready",
      blockers: stageState === "blocked" || stageState === "stale" ? [stageState] : [],
      safe_refs: [record.record_ref, record.unit_ref, record.work_ref].filter((value): value is string => !!value).slice(0, 12),
      project_ref: projectRef,
      ...(record.unit_ref ? { episode_ref: record.unit_ref } : {}),
    }];
  });
}

function auctraStages(snapshot: AuctraCreativeFlowSnapshot, projectRef: string): CreativeFlowStageProjection[] {
  return snapshot.stages.map((item) => {
    const itemState = state(item.state);
    return {
      stage: item.stage,
      owner: "auctra" as const,
      object_kind: item.object_kind,
      source_ref: item.source_ref,
      state: itemState,
      native_state: item.native_state,
      revision: item.revision || "",
      ...(item.digest ? { digest: item.digest } : {}),
      observed_at: item.observed_at,
      freshness: itemState === "stale" ? "stale" : freshness(item.observed_at),
      coverage: coverage(snapshot.coverage, itemState),
      source_current: item.source_current,
      blockers: item.blockers || [],
      safe_refs: item.safe_refs || [],
      project_ref: projectRef,
      episode_ref: item.episode_ref,
    };
  });
}

function scaenaStages(snapshot: ScaenaStoryboardSnapshot): CreativeFlowStageProjection[] {
  return snapshot.items.map((item) => {
    const itemState = state(item.state);
    const sourceDigestMismatch = Boolean(snapshot.source && item.source_digest && item.source_digest !== snapshot.source.digest);
    return {
      stage: "production_breakdown" as const,
      owner: "scaena" as const,
      object_kind: "storyboard_breakdown",
      source_ref: item.breakdown_ref,
      state: itemState,
      native_state: item.native_state,
      revision: item.revision,
      ...(item.digest ? { digest: item.digest } : {}),
      observed_at: item.observed_at,
      freshness: itemState === "stale" ? "stale" : freshness(item.observed_at),
      coverage: coverage(snapshot.coverage, itemState),
      source_current: (itemState === "accepted" || itemState === "ready") && !sourceDigestMismatch,
      blockers: [...item.blockers, ...(snapshot.source && (!snapshot.source.current || snapshot.source.state !== "accepted") ? ["source_not_current"] : []), ...(sourceDigestMismatch ? ["source_digest_mismatch"] : [])],
      safe_refs: [item.breakdown_ref, item.source_ref, snapshot.source?.source_ref, item.scene_ref, item.shot_ref].filter((value): value is string => !!value).slice(0, 12),
      project_ref: snapshot.project_ref,
      ...(item.episode_ref ? { episode_ref: item.episode_ref } : {}),
      ...(item.scene_ref ? { scene_ref: item.scene_ref } : {}),
      ...(item.shot_ref ? { shot_ref: item.shot_ref } : {}),
      breakdown_ref: item.breakdown_ref,
    };
  });
}

function attentionAction(stage: CreativeFlowStageProjection): CreativeFlowAction {
  if (stage.state === "waiting_review") return "review";
  if (stage.state === "stale" || stage.state === "blocked") return "repair";
  if (stage.state === "needs_contract" || stage.state === "unavailable" || stage.state === "forbidden") return "open_owner";
  if (stage.stage === "production_handoff" && (stage.state === "accepted" || stage.state === "ready")) return "handoff";
  return "inspect";
}

export function buildCreativeFlow(input: {
  scope: string;
  project_ref: string;
  episode_ref?: string;
  auctra_records?: AuctraCollectionRecordView[];
  auctra_coverage?: CoverageState;
  auctra_flow?: AuctraCreativeFlowSnapshot;
  scaena: ScaenaStoryboardSnapshot;
  observed_at?: string;
}): CreativeFlowProjection {
  const observed_at = input.observed_at || now();
  const auctraCoverage = input.auctra_flow?.coverage || input.auctra_coverage || "needs_contract";
  const stages = [
    ...(input.auctra_flow ? auctraStages(input.auctra_flow, input.project_ref) : legacyAuctraStages(input.auctra_records || [], input.project_ref, observed_at)),
    ...scaenaStages(input.scaena),
  ].filter((stage) => !input.episode_ref || !stage.episode_ref || stage.episode_ref === input.episode_ref);

  const episodeRefs = new Set(stages.map((stage) => stage.episode_ref).filter((value): value is string => !!value));
  const ambiguousEpisode = !input.episode_ref && episodeRefs.size > 1;
  const visibleStages = ambiguousEpisode ? [] : stages;
  const orderedStages = creativeFlowStages.flatMap((stage) => visibleStages.filter((value) => value.stage === stage));
  const lastByStage = new Map<CreativeFlowStage, CreativeFlowStageProjection>();
  for (const stage of orderedStages) lastByStage.set(stage.stage, stage);
  const edges = [];
  for (let index = 0; index < creativeFlowStages.length - 1; index++) {
    const from = lastByStage.get(creativeFlowStages[index]);
    const to = lastByStage.get(creativeFlowStages[index + 1]);
    if (!from || !to) continue;
    const edgeState: CreativeFlowState = from.source_current && to.source_current ? "accepted" : to.state;
    edges.push({
      from_stage: from.stage,
      to_stage: to.stage,
      from_ref: from.source_ref,
      to_ref: to.source_ref,
      relation: from.stage === "production_handoff" ? "handoff" as const : "feeds" as const,
      state: edgeState,
      ...(from.revision ? { source_revision: from.revision } : {}),
      ...(from.digest ? { digest: from.digest } : {}),
      evidence_refs: [...new Set([...from.safe_refs, ...to.safe_refs])].slice(0, 16),
    });
  }

  const attention = orderedStages.find((stage) =>
    ["waiting_review", "blocked", "unknown", "stale", "missing", "needs_contract", "unavailable", "forbidden"].includes(stage.state) ||
    stage.coverage !== "complete" ||
    !stage.source_current,
  );
  const sourceCoverage = [
    { owner: "auctra" as const, state: auctraCoverage, observed_at: input.auctra_flow?.observed_at || observed_at, ...(input.auctra_flow?.blocker ? { reason: input.auctra_flow.blocker } : {}) },
    { owner: "scaena" as const, state: input.scaena.coverage, observed_at: input.scaena.observed_at, ...(input.scaena.blocker ? { reason: input.scaena.blocker } : {}) },
  ];
  const coverageState: CoverageState = ambiguousEpisode
    ? "partial"
    : sourceCoverage.some((value) => ["forbidden", "unavailable", "needs_contract"].includes(value.state))
      ? "partial"
      : sourceCoverage.every((value) => value.state === "complete") && orderedStages.length >= creativeFlowStages.length
        ? "complete"
        : "partial";

  return {
    schema_version: "yeisme.creative_flow.v1",
    scope: input.scope,
    project_ref: input.project_ref,
    ...(input.episode_ref ? { episode_ref: input.episode_ref } : {}),
    observed_at,
    coverage: coverageState,
    source_coverage: sourceCoverage,
    stages: orderedStages,
    edges,
    ...(ambiguousEpisode
      ? { next_attention: { stage: "screenplay", owner: "auctra" as const, action: "open_owner" as const, reason: "episode_ref_required", evidence_refs: [] } }
      : attention
        ? { next_attention: { stage: attention.stage, owner: attention.owner, action: attentionAction(attention), reason: attention.blockers[0] || attention.state, ...(attention.source_ref ? { source_ref: attention.source_ref } : {}), evidence_refs: attention.safe_refs } }
        : {}),
    launch_contexts: orderedStages.map((stage) => ({
      owner: stage.owner,
      target_route: stage.stage === "screenplay" || stage.stage === "creative_storyboard" ? "script" as const : stage.stage === "director_plan" ? "director" as const : stage.stage === "production_breakdown" ? "breakdown" as const : "storyboard" as const,
      project_ref: stage.project_ref || input.project_ref,
      ...(stage.episode_ref ? { episode_ref: stage.episode_ref } : {}),
      ...(stage.scene_ref ? { scene_ref: stage.scene_ref } : {}),
      ...(stage.shot_ref ? { shot_ref: stage.shot_ref } : {}),
      ...(stage.breakdown_ref ? { breakdown_ref: stage.breakdown_ref } : {}),
      ...(stage.revision ? { source_revision: stage.revision } : {}),
      return_path: "/",
      safe_object_refs: stage.safe_refs,
    })),
  };
}
