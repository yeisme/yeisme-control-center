import type { ScopeBinding, Session } from "./contracts";
import type { TaskNotification } from "./notifications";
import type { TaskConnectionState, TaskSnapshot } from "../src/task-observation";
import type {
  WorkQueueAction,
  WorkQueueCoverage,
  WorkQueueItem,
  WorkQueueLink,
  WorkQueueKind,
  WorkQueueLaunchContext,
  WorkQueueOwner,
  WorkQueuePreviewState,
  WorkQueueResponse,
} from "../src/shared/work-queue";
import { priorityForWorkItem, sortWorkQueueItems, summarizeWorkQueue } from "../src/shared/work-queue";
import type { CoverageState } from "../src/request-visibility";
import type { CreativeFlowProjection, CreativeFlowStageProjection } from "../src/shared/creative-flow";

const staleAfterMs = 5 * 60 * 1000;
const text = (value: unknown, max = 512) => typeof value === "string" ? value.slice(0, max) : "";
const validTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString();

function opaqueRef(payload: Record<string, string>) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function freshness(observedAt: string, now = Date.now()): "fresh" | "stale" | "unknown" {
  const parsed = Date.parse(observedAt);
  if (!Number.isFinite(parsed)) return "unknown";
  return now - parsed > staleAfterMs ? "stale" : "fresh";
}

function coverageForTask(task: TaskSnapshot): CoverageState {
  return task.coverage === "complete" ? "complete" : "partial";
}

function ownerForTask(task: TaskSnapshot): WorkQueueOwner {
  return task.locator.owner;
}

function launchContext(input: {
  owner: WorkQueueOwner;
  scopeId: string;
  project?: string;
  workRef?: string;
  taskRef?: string;
  operationRef?: string;
  episodeRef?: string;
  sceneRef?: string;
  shotRef?: string;
  breakdownRef?: string;
  sourceRevision?: string;
  targetRoute?: "script" | "storyboard" | "director" | "breakdown";
  returnPath: string;
  safeRefs: string[];
  url?: string;
}): WorkQueueLaunchContext {
  return {
    schema_version: "yeisme.control_center.launch_context.v1",
    source: "control-center",
    owner: input.owner,
    scope_id: input.scopeId,
    ...(input.project ? { project_ref: input.project } : {}),
    ...(input.workRef ? { work_ref: input.workRef } : {}),
    ...(input.taskRef ? { task_ref: input.taskRef } : {}),
    ...(input.operationRef ? { operation_ref: input.operationRef } : {}),
    ...(input.episodeRef ? { episode_ref: input.episodeRef } : {}),
    ...(input.sceneRef ? { scene_ref: input.sceneRef } : {}),
    ...(input.shotRef ? { shot_ref: input.shotRef } : {}),
    ...(input.breakdownRef ? { breakdown_ref: input.breakdownRef } : {}),
    ...(input.sourceRevision ? { source_revision: input.sourceRevision } : {}),
    ...(input.targetRoute ? { target_route: input.targetRoute } : {}),
    return_path: input.returnPath,
    safe_object_refs: input.safeRefs.slice(0, 12),
    ...(input.url ? { url: input.url } : {}),
  };
}

function shellArg(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function configuredClientURL(origin: string | undefined, route: "script" | "storyboard", input: { project?: string; episode?: string; scene?: string; shot?: string; breakdown?: string; revision?: string }) {
  if (!origin) return undefined;
  let url: URL;
  try { url = new URL(origin); } catch { return undefined; }
  if (!((url.protocol === "https:") || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  for (const [key, value] of Object.entries({ project: input.project, episode: input.episode, scene: input.scene, shot: input.shot, breakdown: input.breakdown, revision: input.revision })) if (value) url.searchParams.set(key, value);
  url.hash = `/${route}`;
  return url.href;
}

function controlLink(label: string, target: "home" | "tasks" | "requests" | "services" | "review", ref?: string) {
  return { kind: "control-center" as const, label, target, ...(ref ? { ref } : {}) };
}

function ownerLink(label: string, target: "muweave" | "auctra" | "scaena", launch: WorkQueueLaunchContext, command?: string) {
  return { kind: "owner" as const, label, target, launch, ...(command ? { command } : {}) };
}

function action(action: string, enabled: boolean, previewState: WorkQueuePreviewState, reason?: string): WorkQueueAction {
  return { action, enabled, preview_state: previewState, ...(reason ? { reason } : {}) };
}

function taskKind(task: TaskSnapshot): WorkQueueKind | null {
  if (task.state === "unknown" || task.provider_recovery?.state === "submission_unknown") return "task_unknown";
  if (["failed", "partial_failed", "blocked", "rejected"].includes(task.state) || task.provider_recovery?.state === "blocked" || task.provider_recovery?.state === "rejected_no_generation") return "task_failure";
  if (task.state === "waiting_review" || Boolean(task.provider_recovery?.review_status && task.provider_recovery.review_status !== "approved")) return "review_required";
  if (task.state === "handoff_ready" || ["ready", "prepared"].includes(task.provider_recovery?.export_status || "")) return "handoff_ready";
  return null;
}

function taskReason(task: TaskSnapshot, kind: WorkQueueKind) {
  if (task.provider_recovery?.blocker) return task.provider_recovery.blocker;
  if (task.provider_recovery?.error_code) return task.provider_recovery.error_code;
  if (kind === "task_unknown") return "owner 尚未返回最终状态";
  if (kind === "review_required") return task.provider_recovery?.review_status || "等待审阅决定";
  if (kind === "handoff_ready") return "结果已达到交接状态";
  return task.native_state || task.state;
}

function itemFromTask(task: TaskSnapshot, scopeId: string, now = Date.now()): WorkQueueItem | null {
  const kind = taskKind(task);
  if (!kind || !task.task_key) return null;
  const sourceRef = task.task_key;
  const observedAt = validTime(task.observed_at || task.updated_at || task.created_at);
  const coverage = coverageForTask(task);
  const owner = ownerForTask(task);
  const previewActions = task.allowed_actions.map((candidate) => action(
    candidate.action,
    candidate.enabled,
    candidate.enabled ? "available" : "forbidden",
    candidate.reason,
  ));
  return {
    work_ref: opaqueRef({ kind, owner, ref: sourceRef }),
    kind,
    owner,
    project: task.locator.project,
    scope_id: scopeId,
    title: text(task.title, 240) || sourceRef,
    state: task.state,
    native_state: text(task.native_state, 120) || task.state,
    priority: priorityForWorkItem(kind, task.state, coverage),
    attention_reason: taskReason(task, kind),
    observed_at: observedAt,
    freshness: task.process?.freshness === "stale" ? "stale" : freshness(observedAt, now),
    coverage,
    revision: text(task.revision, 160),
    source_ref: sourceRef,
    task_ref: text(task.locator.task_ref, 512),
    safe_links: [
      controlLink("查看任务", "tasks", sourceRef),
      ...(kind === "handoff_ready" ? [ownerLink("打开 Scaena 工作区", "scaena", launchContext({ owner: "scaena", scopeId, project: task.locator.project, taskRef: task.locator.task_ref, returnPath: "/tasks", safeRefs: [sourceRef, task.locator.task_ref] }))] : []),
    ],
    allowed_actions: previewActions,
    preview_state: previewActions.some((item) => item.enabled) ? "available" : previewActions.length ? "forbidden" : "not_applicable",
  };
}

function itemFromNotification(notification: TaskNotification, scopeId: string): WorkQueueItem {
  const kind: WorkQueueKind = notification.task_state === "unknown" ? "task_unknown" : "task_failure";
  const coverage: CoverageState = notification.presence === "stale" ? "expired" : "complete";
  return {
    work_ref: opaqueRef({ kind, owner: notification.owner, ref: notification.task_key }),
    kind,
    owner: (notification.owner as WorkQueueOwner) || "control-center",
    project: notification.project,
    scope_id: scopeId,
    title: notification.title || notification.task_key,
    state: notification.task_state || "unknown",
    native_state: notification.native_state || notification.task_state || "unknown",
    priority: priorityForWorkItem(kind, notification.task_state || "unknown", coverage),
    attention_reason: notification.last_error_code || "失败提醒仍需回查",
    observed_at: validTime(notification.last_seen_at || notification.first_seen_at),
    freshness: notification.presence === "stale" ? "stale" : "fresh",
    coverage,
    revision: notification.task_revision,
    source_ref: notification.task_key,
    safe_links: [controlLink("查看任务", "tasks", notification.task_key)],
    allowed_actions: [action("notification.acknowledge", notification.state === "unread", "available")],
    preview_state: "available",
  };
}

function connectionCoverage(connection: TaskConnectionState): CoverageState {
  if (connection.state === "ready") return "complete";
  if (connection.state.includes("contract")) return "needs_contract";
  if (connection.state.includes("forbidden") || connection.state.includes("authorization")) return "forbidden";
  if (connection.state === "stale") return "expired";
  return "unavailable";
}

function itemFromConnection(connection: TaskConnectionState, scopeId: string): WorkQueueItem | null {
  if (connection.state === "ready") return null;
  const coverage = connectionCoverage(connection);
  const kind: WorkQueueKind = coverage === "needs_contract" ? "contract_gap" : "service_blocked";
  const observedAt = validTime(connection.observed_at);
  return {
    work_ref: opaqueRef({ kind, owner: connection.owner, ref: connection.id }),
    kind,
    owner: connection.owner,
    project: connection.project,
    scope_id: scopeId,
    title: connection.label || `${connection.owner} connection`,
    state: connection.state,
    native_state: connection.runtime?.state || connection.state,
    priority: priorityForWorkItem(kind, connection.state, coverage),
    attention_reason: connection.runtime?.reason || connection.state,
    observed_at: observedAt,
    freshness: freshness(observedAt),
    coverage,
    revision: "",
    source_ref: connection.id,
    safe_links: [controlLink("查看服务", "services", connection.id)],
    allowed_actions: [action("service.inspect", true, "available")],
    preview_state: "not_applicable",
  };
}

function sourceCoverage(owner: WorkQueueOwner, state: CoverageState, observedAt: string, reason?: string) {
  return { owner, state, observed_at: observedAt, ...(reason ? { reason } : {}) };
}

export interface WorkQueueInput {
  scope: ScopeBinding;
  session: Session;
  tasks: TaskSnapshot[];
  connections: TaskConnectionState[];
  notifications: TaskNotification[];
  creativeFlow?: CreativeFlowProjection | null;
  clientOrigins?: { muweave?: string };
}

function workflowKind(stage: CreativeFlowStageProjection): WorkQueueKind | null {
  if (stage.coverage === "needs_contract") return "contract_gap";
  if (["forbidden", "unavailable", "integrity_failed", "expired"].includes(stage.coverage)) return "service_blocked";
  if (["blocked", "unknown", "stale", "missing", "unavailable", "forbidden"].includes(stage.state)) return "service_blocked";
  if (stage.state === "needs_contract") return "contract_gap";
  if (stage.state === "waiting_review") return "review_required";
  if (stage.stage === "production_handoff" && ["accepted", "ready", "handoff_ready"].includes(stage.state)) return "handoff_ready";
  return null;
}

function workflowReason(stage: CreativeFlowStageProjection) {
  if (stage.blockers.length) return stage.blockers[0];
  if (stage.state === "waiting_review") return "等待该阶段审阅决定";
  if (stage.stage === "production_handoff") return "accepted handoff 可进入 Scaena";
  if (stage.coverage === "needs_contract") return "owner 尚未提供该阶段读取合同";
  return stage.state;
}

function workflowItem(stage: CreativeFlowStageProjection, flow: CreativeFlowProjection, scopeId: string, clientOrigins?: { muweave?: string }, now = Date.now()): WorkQueueItem | null {
  const kind = workflowKind(stage);
  if (!kind) return null;
  const sourceRef = stage.source_ref || `${flow.project_ref}:${stage.stage}`;
  const route = stage.stage === "screenplay" || stage.stage === "creative_storyboard" ? "script" as const : stage.stage === "director_plan" ? "director" as const : stage.stage === "production_breakdown" ? "breakdown" as const : "storyboard" as const;
  const auctraCommand = stage.stage === "screenplay"
    ? `auctra screenplay workspace --project ${shellArg(flow.project_ref)} --json`
    : stage.stage === "director_plan"
      ? `auctra plan director show ${shellArg(sourceRef)} --project ${shellArg(flow.project_ref)} --json`
      : stage.stage === "creative_storyboard"
        ? `auctra plan storyboard show ${shellArg(sourceRef)} --project ${shellArg(flow.project_ref)} --json`
        : stage.stage === "production_handoff"
          ? `auctra production handoff inspect --project ${shellArg(flow.project_ref)} --target scaena --json`
          : undefined;
  const scaenaCommand = stage.stage === "production_breakdown" ? `scaena storyboard breakdown show ${shellArg(sourceRef)} --project ${shellArg(flow.project_ref)} --json` : undefined;
  const launch = launchContext({
    owner: stage.owner,
    scopeId,
    project: flow.project_ref,
    workRef: flow.project_ref,
    operationRef: sourceRef,
    episodeRef: stage.episode_ref || flow.episode_ref,
    sceneRef: stage.scene_ref,
    shotRef: stage.shot_ref,
    breakdownRef: stage.breakdown_ref,
    sourceRevision: stage.revision,
    targetRoute: route,
    returnPath: "/",
    safeRefs: [sourceRef, ...stage.safe_refs],
  });
  const muweaveURL = configuredClientURL(clientOrigins?.muweave, route === "breakdown" ? "storyboard" : route === "director" ? "storyboard" : route, { project: flow.project_ref, episode: stage.episode_ref || flow.episode_ref, scene: stage.scene_ref, shot: stage.shot_ref, breakdown: stage.breakdown_ref, revision: stage.revision });
  const muweaveLaunch = launchContext({ owner: "muweave", scopeId, project: flow.project_ref, workRef: flow.project_ref, operationRef: sourceRef, episodeRef: stage.episode_ref || flow.episode_ref, sceneRef: stage.scene_ref, shotRef: stage.shot_ref, breakdownRef: stage.breakdown_ref, sourceRevision: stage.revision, targetRoute: route === "breakdown" ? "storyboard" : route === "director" ? "storyboard" : route, returnPath: "/", safeRefs: [sourceRef, ...stage.safe_refs], url: muweaveURL });
  const ownerLinks: WorkQueueLink[] = [ownerLink(stage.owner === "auctra" ? "打开 Auctra" : "打开 Scaena", stage.owner === "auctra" ? "auctra" : "scaena", launch, auctraCommand || scaenaCommand)];
  if (muweaveURL || stage.stage === "creative_storyboard" || stage.stage === "production_breakdown") ownerLinks.push(ownerLink("打开 MuWeave", "muweave", muweaveLaunch));
  return {
    work_ref: opaqueRef({ kind, owner: stage.owner, ref: `${flow.project_ref}:${stage.stage}:${sourceRef}:${stage.revision}` }),
    kind,
    owner: stage.owner,
    project: flow.project_ref,
    scope_id: scopeId,
    title: `${stage.stage} · ${sourceRef}`,
    state: stage.state,
    native_state: stage.native_state,
    priority: priorityForWorkItem(kind, stage.state, stage.coverage),
    attention_reason: workflowReason(stage),
    observed_at: stage.observed_at,
    freshness: stage.freshness,
    coverage: stage.coverage,
    revision: stage.revision,
    source_ref: sourceRef,
    workflow_stage: stage.stage,
    object_kind: stage.object_kind,
    flow_ref: opaqueRef({ scope: flow.scope, project: flow.project_ref, episode: flow.episode_ref || "" }),
    lineage_refs: stage.safe_refs,
    source_revision: stage.revision,
    ...(stage.digest ? { digest: stage.digest } : {}),
    safe_links: [controlLink("查看工作台", "home"), ...ownerLinks],
    allowed_actions: [],
    preview_state: "not_applicable",
  };
}

export function buildWorkQueue(input: WorkQueueInput, now = Date.now()): WorkQueueResponse {
  const items: WorkQueueItem[] = [];
  const taskKeys = new Set<string>();
  for (const task of input.tasks) {
    const item = itemFromTask(task, input.scope.id, now);
    if (item) {
      items.push(item);
      if (task.task_key) taskKeys.add(task.task_key);
    }
  }
  for (const notification of input.notifications) {
    if (!taskKeys.has(notification.task_key) && notification.state !== "archived" && notification.state !== "muted") items.push(itemFromNotification(notification, input.scope.id));
  }
  for (const connection of input.connections) {
    const item = itemFromConnection(connection, input.scope.id);
    if (item) items.push(item);
  }
  if (input.creativeFlow) {
    const flowKeys = new Set<string>();
    const flowItems = input.creativeFlow.stages.map((stage) => workflowItem(stage, input.creativeFlow!, input.scope.id, input.clientOrigins)).filter((item): item is WorkQueueItem => {
      if (!item) return false;
      const key = [item.scope_id, item.owner, item.object_kind || "", item.source_ref, item.revision].join("|");
      if (flowKeys.has(key)) return false;
      flowKeys.add(key);
      return true;
    });
    items.push(...flowItems);
    if (input.creativeFlow.stages.length === 0 && input.creativeFlow.coverage !== "complete") {
      items.push({
        work_ref: opaqueRef({ kind: "contract_gap", owner: "control-center", ref: `${input.scope.id}:creative-flow` }),
        kind: "contract_gap",
        owner: "control-center",
        project: input.creativeFlow.project_ref,
        scope_id: input.scope.id,
        title: "剧本到分镜流程暂不可读",
        state: "needs_contract",
        native_state: input.creativeFlow.coverage,
        priority: "high",
        attention_reason: "Auctra 或 Scaena 尚未提供当前流程阶段投影",
        observed_at: input.creativeFlow.observed_at,
        freshness: "unknown",
        coverage: "needs_contract",
        revision: "",
        source_ref: input.creativeFlow.project_ref,
        object_kind: "creative_flow",
        flow_ref: opaqueRef({ scope: input.creativeFlow.scope, project: input.creativeFlow.project_ref }),
        lineage_refs: [],
        safe_links: [controlLink("查看工作台", "home")],
        allowed_actions: [],
        preview_state: "needs_contract",
      });
    }
  }

  const sources = new Map<WorkQueueOwner, { state: CoverageState; observed_at: string; reason?: string }>();
  for (const connection of input.connections) {
    const state = connectionCoverage(connection);
    sources.set(connection.owner, { state, observed_at: validTime(connection.observed_at), ...(connection.runtime?.reason ? { reason: connection.runtime.reason } : {}) });
  }
  if (input.creativeFlow) {
    const ownerStates = new Map<WorkQueueOwner, { state: CoverageState; observed_at: string; reason?: string }>();
    for (const stage of input.creativeFlow.stages) {
      const state = stage.coverage === "needs_contract" ? "needs_contract" as const : stage.coverage === "forbidden" ? "forbidden" as const : stage.coverage === "unavailable" ? "unavailable" as const : stage.coverage;
      const current = ownerStates.get(stage.owner);
      if (!current || Date.parse(stage.observed_at) >= Date.parse(current.observed_at)) ownerStates.set(stage.owner, { state, observed_at: stage.observed_at, ...(stage.blockers[0] ? { reason: stage.blockers[0] } : {}) });
    }
    for (const [owner, value] of ownerStates) sources.set(owner, value);
  }
  const sorted = sortWorkQueueItems(items);
  const observedAt = new Date(now).toISOString();
  const sourceValues = [...sources.entries()].map(([owner, value]) => sourceCoverage(owner, value.state, value.observed_at, value.reason));
  const states = sourceValues.map((source) => source.state);
  const coverage: CoverageState = states.length === 0
    ? "unknown"
    : states.every((state) => state === "complete")
      ? "complete"
      : states.some((state) => ["unavailable", "forbidden", "needs_contract"].includes(state))
        ? "partial"
        : "partial";
  return {
    schema_version: "yeisme.work_queue.v1",
    epoch: input.session.epoch,
    scope: input.scope.id,
    observed_at: observedAt,
    coverage: { state: coverage, observed_at: observedAt, sources: sourceValues },
    counts: summarizeWorkQueue(sorted),
    items: sorted,
  };
}

export function filterAndPageWorkQueue(response: WorkQueueResponse, filters: { kind?: string; owner?: string; state?: string; workflow_stage?: string }, offset: number, limit: number) {
  const filtered = response.items.filter((item) => (!filters.kind || item.kind === filters.kind) && (!filters.owner || item.owner === filters.owner) && (!filters.state || item.state === filters.state) && (!filters.workflow_stage || item.workflow_stage === filters.workflow_stage));
  const items = filtered.slice(offset, offset + limit);
  return { ...response, items, counts: summarizeWorkQueue(filtered), ...(offset + limit < filtered.length ? { next_offset: offset + limit } : {}) };
}
