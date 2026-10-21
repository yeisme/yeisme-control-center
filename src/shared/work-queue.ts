import type { CoverageState } from "../request-visibility";
import type { CreativeFlowStage } from "./creative-flow";

export const workQueueKinds = [
  "task_failure",
  "task_unknown",
  "review_required",
  "handoff_ready",
  "service_blocked",
  "contract_gap",
] as const;
export type WorkQueueKind = (typeof workQueueKinds)[number];

export const workQueuePriorities = ["critical", "high", "normal", "low"] as const;
export type WorkQueuePriority = (typeof workQueuePriorities)[number];

export type WorkQueueOwner = "aigora" | "eikona" | "sonora" | "scaena" | "auctra" | "muweave" | "control-center";
export type WorkQueuePreviewState = "available" | "needs_contract" | "forbidden" | "unavailable" | "not_applicable";

export interface WorkQueueLaunchContext {
  schema_version: "yeisme.control_center.launch_context.v1";
  source: "control-center";
  owner: WorkQueueOwner;
  scope_id: string;
  project_ref?: string;
  work_ref?: string;
  task_ref?: string;
  operation_ref?: string;
  episode_ref?: string;
  scene_ref?: string;
  shot_ref?: string;
  breakdown_ref?: string;
  source_revision?: string;
  target_route?: "script" | "storyboard" | "director" | "breakdown";
  return_path: string;
  safe_object_refs: string[];
  url?: string;
}

export interface WorkQueueLink {
  kind: "control-center" | "owner";
  label: string;
  target: "home" | "tasks" | "requests" | "services" | "review" | "muweave" | "auctra" | "scaena";
  ref?: string;
  command?: string;
  launch?: WorkQueueLaunchContext;
}

export interface WorkQueueAction {
  action: string;
  enabled: boolean;
  preview_state: WorkQueuePreviewState;
  reason?: string;
}

export interface WorkQueueItem {
  work_ref: string;
  kind: WorkQueueKind;
  owner: WorkQueueOwner;
  project: string;
  scope_id: string;
  title: string;
  state: string;
  native_state: string;
  priority: WorkQueuePriority;
  attention_reason: string;
  observed_at: string;
  freshness: "fresh" | "stale" | "unknown";
  coverage: CoverageState;
  revision: string;
  source_ref: string;
  workflow_stage?: CreativeFlowStage;
  object_kind?: string;
  flow_ref?: string;
  lineage_refs?: string[];
  source_revision?: string;
  digest?: string;
  task_ref?: string;
  operation_ref?: string;
  safe_links: WorkQueueLink[];
  allowed_actions: WorkQueueAction[];
  preview_state: WorkQueuePreviewState;
}

export interface WorkQueueCounts {
  total: number;
  actionable: number;
  blocked: number;
  review_required: number;
  unknown: number;
  handoff_ready: number;
  stale: number;
  contract_gap: number;
}

export interface WorkQueueCoverage {
  state: CoverageState;
  observed_at: string;
  sources: Array<{
    owner: WorkQueueOwner;
    state: CoverageState;
    observed_at: string;
    reason?: string;
  }>;
}

export interface WorkQueueResponse {
  schema_version: "yeisme.work_queue.v1";
  epoch: number;
  scope: string;
  observed_at: string;
  coverage: WorkQueueCoverage;
  counts: WorkQueueCounts;
  items: WorkQueueItem[];
  next_cursor?: string;
}

export interface WorkQueueFilters {
  kind?: WorkQueueKind;
  owner?: WorkQueueOwner;
  state?: string;
  workflow_stage?: CreativeFlowStage;
}

const priorityRank: Record<WorkQueuePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function priorityForWorkItem(kind: WorkQueueKind, state: string, coverage: CoverageState): WorkQueuePriority {
  if (["blocked", "unknown", "unavailable", "conflict"].includes(state) || ["unavailable", "forbidden", "integrity_failed"].includes(coverage)) return "critical";
  if (["waiting_review", "needs_contract"].includes(state) || coverage === "needs_contract") return "high";
  if (kind === "handoff_ready") return "normal";
  if (["stale", "partial"].includes(state) || coverage === "partial" || coverage === "expired") return "low";
  return "normal";
}

export function matchesWorkQueueFilters(item: WorkQueueItem, filters: WorkQueueFilters): boolean {
  return (!filters.kind || item.kind === filters.kind)
    && (!filters.owner || item.owner === filters.owner)
    && (!filters.state || item.state === filters.state)
    && (!filters.workflow_stage || item.workflow_stage === filters.workflow_stage);
}

export function sortWorkQueueItems(items: WorkQueueItem[]): WorkQueueItem[] {
  return [...items].sort((a, b) => {
    const priority = priorityRank[a.priority] - priorityRank[b.priority];
    if (priority) return priority;
    const observed = Date.parse(b.observed_at || "") - Date.parse(a.observed_at || "");
    if (Number.isFinite(observed) && observed) return observed;
    const owner = a.owner.localeCompare(b.owner);
    if (owner) return owner;
    return a.source_ref.localeCompare(b.source_ref);
  });
}

export function summarizeWorkQueue(items: WorkQueueItem[]): WorkQueueCounts {
  return {
    total: items.length,
    actionable: items.filter((item) => item.priority !== "low" && item.preview_state !== "not_applicable").length,
    blocked: items.filter((item) => ["blocked", "unavailable", "conflict"].includes(item.state) || item.kind === "service_blocked").length,
    review_required: items.filter((item) => item.kind === "review_required").length,
    unknown: items.filter((item) => item.kind === "task_unknown" || item.state === "unknown").length,
    handoff_ready: items.filter((item) => item.kind === "handoff_ready").length,
    stale: items.filter((item) => item.freshness === "stale" || item.state === "stale").length,
    contract_gap: items.filter((item) => item.kind === "contract_gap" || item.preview_state === "needs_contract").length,
  };
}
