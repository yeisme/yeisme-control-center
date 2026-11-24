import type { CreativeFlowStage } from "./creative-flow";
import type { DramaEpisodeDetail, DramaEpisodeRow, DramaRailStage, DramaSource, StoryboardOutline } from "./drama";
import { isNeutralNode, isProblemNode, unconnectedReasons } from "./drama";
import type { TaskConnectionState, TaskOwner, TaskSnapshot } from "../task-observation";
import { kindOf, type MediaKind } from "./media-kind";
import { ownerModality } from "./read-model/tasks";
import { summarizeTasks, tasksForEpisode } from "./read-model/drama";
import { episodeBindingRefs, type EpisodeProductionRead, type EpisodeProductionSection, type EpisodeProductionTiming } from "./episode-production";
import { taskAwaitsPick, type TaskReviewRead } from "./task-review";
import { episodeTimeRows, rollupTime, slowestRuns, type EpisodeTimeRow, type SlowRun, type TimeRollup } from "./production-time";

/**
 * One episode, or one whole project, as the seven stations a motion comic passes through on its way from an image to a
 * finished cut. The page renders it and `GET /production` returns it, so a person and an agent read the same facts.
 *
 * Every station says how far it could be read. A station is `empty` only when its source answered and had nothing;
 * a missing owner contract, an unconnected scope and a failed read each keep their own state and never read as zero.
 */
export const productionLineSchema = "yeisme.production_line.v1" as const;

export const productionStations = ["story", "look", "board", "frames", "motion", "sound", "cut"] as const;
export type ProductionStationId = (typeof productionStations)[number];

export type StationState = "observed" | "partial" | "empty" | "unconnected" | "needs_contract" | "unavailable";
export type StationTool = "auctra" | "eikona" | "scaena" | "sonora" | "anatomia" | "drivebridge";

/** Who moves next: a person decides (pick, pay, lock, deliver); an agent fetches, quotes, drafts and checks. */
export type StationActor = "human" | "agent";
export type StationAction =
  | "review" | "repair" | "connect" | "pick" | "decide_retry" | "reconcile" | "inspect" | "draft" | "generate_quote" | "check";

export interface StationCounts {
  total: number;
  running: number;
  waiting_review: number;
  problem: number;
  done: number;
}

/** A result the page can preview through the usual per-result grant; never a media handle or a body. */
export interface StationResultRef {
  task_key: string;
  owner: TaskOwner;
  task_ref: string;
  artifact_ref: string;
  kind: MediaKind;
  title: string;
  at: string;
}

export interface StationDecision {
  kind: "stage_review" | "stage_repair" | "pick_result" | "failed_task" | "unknown_task";
  ref: string;
  title: string;
  stage?: CreativeFlowStage;
  task_key?: string;
}

/** A part of a station that cannot be read yet, said once instead of being folded into a zero. */
export interface StationGap {
  part: "references" | "edit" | "review_adoption" | "assembly" | "delivery" | "lip_sync" | "episode_link";
  state: "needs_contract" | "unconnected" | "unavailable";
  reason: string;
}

export interface StationStage {
  stage: CreativeFlowStage;
  state: DramaRailStage["state"];
  blocker?: string;
}

export interface ShotSummary {
  total: number;
  /** Shots Scaena marks ready for generation; absent when Scaena did not say. */
  generation_ready?: number;
  /** Shots whose keyframe is bound in the breakdown; absent when the breakdown carried no media. */
  frames_ready?: number;
}

/** A part Scaena reported from its own records for this episode: a status and counts, never a guess. */
export interface StationFact {
  part: "references" | "edit" | "review" | "assembly";
  status?: string;
  counts: Record<string, number>;
  artifact_ref?: string;
  /** References are counted for the whole project, not the episode. */
  project_scope?: boolean;
  truncated?: boolean;
}

/** Tasks whose review Eikona answered for, split by its decision; `unread` were asked about and got no answer. */
export interface OwnerReviewSummary {
  awaiting: number;
  decided: number;
  unread: number;
  /** Why the unread ones could not be read, when they share one reason. */
  reason?: string;
}

/**
 * A station's time from its tasks' owner timing. Story, look and board are not made of timed runs yet, so they say the
 * contract is missing instead of showing an empty total.
 */
export type StationTime =
  | { state: "observed"; rollup: TimeRollup; slowest: SlowRun[] }
  | { state: "needs_contract"; reason: string };

/** One episode's row in a project's time panel, with the drama episode it belongs to when the list names it. */
export interface LineEpisodeTime extends EpisodeTimeRow {
  title?: string;
  /** The drama (Auctra) episode ref to open; absent when no listed episode maps to this Scaena ref. */
  drama_episode_ref?: string;
}

/**
 * Time across the line, from the task pages already read (first page of each lane), so it is a bounded figure and says
 * its coverage. `owner_total` is Scaena's own whole-episode sum when its summary carries one; the two are never added.
 */
export interface ProductionLineTime {
  total: TimeRollup;
  /** Project range: per episode, slowest first. */
  episodes?: LineEpisodeTime[];
  /** Project range: tasks that name no episode. */
  unattributed?: TimeRollup;
  /** Episode range: Scaena's rollup for the whole episode, or why there is none. */
  owner_total?: { state: "observed"; timing: EpisodeProductionTiming } | { state: "needs_contract" | "unavailable"; reason: string };
}

export interface ProductionStation {
  station: ProductionStationId;
  tools: StationTool[];
  state: StationState;
  reason?: string;
  stages?: StationStage[];
  counts: StationCounts;
  results: StationResultRef[];
  decisions: StationDecision[];
  gaps: StationGap[];
  shots?: ShotSummary;
  /** What Scaena's production summary says about this station's parts. */
  facts?: StationFact[];
  /** Tasks counted here because Scaena recorded the owner binding they ran under for this episode. */
  linked_by?: "scaena_binding";
  /** Frames: what Eikona's own review records say about this station's tasks that were asked about. */
  owner_review?: OwnerReviewSummary;
  /** Absent when the task source could not be read: unread is not "no time". */
  time?: StationTime;
  next: { actor: StationActor; action: StationAction } | null;
}

export type ProductionRange =
  | { kind: "episode"; episode_ref: string; scaena_episode_ref?: string; title?: string }
  | { kind: "project"; project_ref?: string; title?: string };

export interface ProductionLine {
  schema_version: typeof productionLineSchema;
  scope: string;
  range: ProductionRange;
  observed_at: string;
  stations: ProductionStation[];
  /** The station a person should look at first; null when nothing waits on anyone. */
  current: ProductionStationId | null;
  /** Episode range only: results in this scope that name no episode, so they cannot be counted here. */
  unassigned_tasks?: number;
  /** Absent when the task source could not be read. */
  time?: ProductionLineTime;
}

/** What the builder needs; every field is something the page or the server already read. */
export interface ProductionInput {
  scope: string;
  now: string;
  range: ProductionRange;
  /** Episode range: the episode detail, `null` when the read failed. */
  detail?: Omit<DramaEpisodeDetail, "epoch"> | null;
  /** Project range: the episode rows already read (with their rails), and which owners are connected at all. */
  episodes?: DramaEpisodeRow[];
  sources?: DramaSource[];
  /** `null` when the episode list itself could not be read. */
  episodesReadable?: boolean;
  tasks: TaskSnapshot[];
  /** Whether the task source answered at all; a source that failed must not look like an empty station. */
  tasksReadable: boolean;
  /** Why it did not answer, when known (for example a session without a personal task connection). */
  tasksReason?: string;
  connections: TaskConnectionState[];
  /** Character, scene and style references; the server answers `needs_contract` until an owner publishes the contract. */
  references?: { state: "observed" | "needs_contract" | "unavailable"; reason?: string; count?: number };
  /** Episode range: Scaena's production summary for this episode, when it was asked for. */
  production?: EpisodeProductionRead;
  /** Eikona's review fact per task key, for the tasks that were asked about; the others keep their task state. */
  reviews?: Record<string, TaskReviewRead>;
}

export const stationTools: Record<ProductionStationId, StationTool[]> = {
  story: ["auctra"],
  look: ["eikona", "scaena"],
  board: ["auctra", "scaena"],
  frames: ["eikona"],
  motion: ["scaena"],
  sound: ["sonora"],
  cut: ["anatomia", "scaena", "drivebridge"],
};

const stationStages: Partial<Record<ProductionStationId, CreativeFlowStage[]>> = {
  story: ["screenplay", "director_plan"],
  board: ["creative_storyboard", "production_handoff", "production_breakdown"],
};

/** The owner whose tasks make up a task station. Anatomia's frames are still a check of the cut, not new footage. */
const stationOwner: Partial<Record<ProductionStationId, TaskOwner>> = { frames: "eikona", motion: "scaena", sound: "sonora", cut: "anatomia" };

/**
 * Owners whose task observations name the episode in the Auctra/Scaena sense. The server keeps `episode_ref` from Scaena
 * only (server/task-connections.ts): Eikona does not send one and Sonora uses its own `sonora://` namespace. For the other
 * owners an episode cannot be told apart from "nothing made yet", so the station says the link is missing instead.
 */
export const episodeLinkedOwners: ReadonlySet<TaskOwner> = new Set<TaskOwner>(["scaena"]);

const resultLimit = 6;
const decisionLimit = 3;

const emptyCounts = (): StationCounts => ({ total: 0, running: 0, waiting_review: 0, problem: 0, done: 0 });

type NodeClass = "readable" | "unconnected" | "needs_contract" | "unavailable";

/** How far one stage could be read. An `unknown` nobody answered for is unreadable; one an owner returned is a fact. */
function nodeClass(node: DramaRailStage): NodeClass {
  if (node.state === "needs_contract") return node.blocker && unconnectedReasons.has(node.blocker) ? "unconnected" : "needs_contract";
  if (node.state === "unavailable" || node.state === "forbidden") return "unavailable";
  if (node.state === "unknown" && !node.observed_at) return "unavailable";
  return "readable";
}

const nodeDone = (node: DramaRailStage) => (node.state === "accepted" || node.state === "ready") && node.source_current;
const nodeWaiting = (node: DramaRailStage) => node.state === "waiting_review";
const nodeProblem = (node: DramaRailStage) => isProblemNode(node) && node.state !== "waiting_review" && !isNeutralNode(node);
const nodePending = (node: DramaRailStage) => node.state === "not_started" || node.state === "missing" || isNeutralNode(node);

/** All readable is observed; some readable is partial; otherwise the first stage's own reason stands for the station. */
function stateFromClasses(classes: NodeClass[]): StationState {
  if (!classes.length) return "unavailable";
  if (classes.every((item) => item === "readable")) return "observed";
  if (classes.some((item) => item === "readable")) return "partial";
  return classes[0] as Exclude<NodeClass, "readable">;
}

function stageNext(nodes: DramaRailStage[], state: StationState): ProductionStation["next"] {
  if (nodes.some(nodeWaiting)) return { actor: "human", action: "review" };
  if (nodes.some(nodeProblem)) return { actor: "human", action: "repair" };
  if (state === "unconnected") return { actor: "human", action: "connect" };
  if (state === "unavailable") return { actor: "agent", action: "inspect" };
  if (nodes.some((node) => node.state === "in_progress")) return null;
  if (nodes.some((node) => nodeClass(node) === "readable" && nodePending(node))) return { actor: "agent", action: "draft" };
  return null;
}

function episodeStageStation(id: "story" | "board", rail: DramaRailStage[], outline?: StoryboardOutline): ProductionStation {
  const wanted = stationStages[id]!;
  const nodes = wanted.map((stage) => rail.find((node) => node.stage === stage)).filter((node): node is DramaRailStage => !!node);
  const classes = nodes.map(nodeClass);
  const state = stateFromClasses(classes);
  const counts: StationCounts = {
    total: nodes.length,
    running: nodes.filter((node) => node.state === "in_progress").length,
    waiting_review: nodes.filter(nodeWaiting).length,
    problem: nodes.filter(nodeProblem).length,
    done: nodes.filter(nodeDone).length,
  };
  const decisions: StationDecision[] = nodes.flatMap((node): StationDecision[] => nodeWaiting(node)
    ? [{ kind: "stage_review", ref: node.stage, title: node.stage, stage: node.stage }]
    : nodeProblem(node) ? [{ kind: "stage_repair", ref: node.stage, title: node.stage, stage: node.stage }] : []);
  const blocked = nodes.find((_node, index) => classes[index] !== "readable");
  return {
    station: id,
    tools: stationTools[id],
    state,
    ...(state !== "observed" && blocked?.blocker ? { reason: blocked.blocker } : state !== "observed" && blocked ? { reason: blocked.state } : {}),
    stages: nodes.map((node) => ({ stage: node.stage, state: node.state, ...(node.blocker ? { blocker: node.blocker } : {}) })),
    counts,
    results: [],
    decisions: decisions.slice(0, decisionLimit),
    gaps: [],
    ...(id === "board" && outline ? { shots: shotSummary(outline) } : {}),
    next: stageNext(nodes, state),
  };
}

const sourceReasons: Record<DramaSource["owner"], Record<Exclude<DramaSource["state"], "connected">, string>> = {
  auctra: { target_missing: "collection_target_missing", binding_missing: "collection_binding_missing", no_credential: "delegation_unavailable" },
  scaena: { target_missing: "source_not_configured", binding_missing: "scaena_storyboard_binding_missing", no_credential: "delegation_unavailable" },
};

/** A project's story or board station: every episode already read, counted once per episode rather than per stage. */
function projectStageStation(id: "story" | "board", input: ProductionInput): ProductionStation {
  const wanted = stationStages[id]!;
  const owners: DramaSource["owner"][] = id === "story" ? ["auctra"] : ["auctra", "scaena"];
  const unconnected = owners.map((owner) => input.sources?.find((source) => source.owner === owner)).find((source) => source && source.state !== "connected");
  const base: Pick<ProductionStation, "station" | "tools" | "results" | "gaps"> = { station: id, tools: stationTools[id], results: [], gaps: [] };
  const rows = (input.episodes || []).filter((row) => row.flow);
  // Episodes already read still count when the source has since lost its connection; that only makes the station partial.
  if (!rows.length && unconnected && owners.every((owner) => input.sources?.find((source) => source.owner === owner)?.state !== "connected")) {
    return { ...base, state: "unconnected", reason: sourceReasons[unconnected.owner][unconnected.state as Exclude<DramaSource["state"], "connected">], counts: emptyCounts(), decisions: [], next: { actor: "human", action: "connect" } };
  }
  if (input.episodesReadable === false) return { ...base, state: "unavailable", reason: "owner_unavailable", counts: emptyCounts(), decisions: [], next: { actor: "agent", action: "inspect" } };
  const failed = (input.episodes || []).some((row) => row.read === "failed");
  if (!rows.length) {
    return { ...base, state: failed ? "unavailable" : "empty", ...(failed ? { reason: "owner_unavailable" } : {}), counts: emptyCounts(), decisions: [], next: failed ? { actor: "agent", action: "inspect" } : { actor: "agent", action: "draft" } };
  }
  const perEpisode = rows.map((row) => ({ row, nodes: wanted.map((stage) => row.flow!.rail.find((node) => node.stage === stage)).filter((node): node is DramaRailStage => !!node) }));
  const counts: StationCounts = {
    total: perEpisode.length,
    running: perEpisode.filter(({ nodes }) => nodes.some((node) => node.state === "in_progress")).length,
    waiting_review: perEpisode.filter(({ nodes }) => nodes.some(nodeWaiting)).length,
    problem: perEpisode.filter(({ nodes }) => nodes.some(nodeProblem)).length,
    done: perEpisode.filter(({ nodes }) => nodes.length > 0 && nodes.every(nodeDone)).length,
  };
  const decisions: StationDecision[] = perEpisode.flatMap(({ row, nodes }): StationDecision[] => {
    const waiting = nodes.find(nodeWaiting);
    if (waiting) return [{ kind: "stage_review", ref: row.episode_ref, title: row.title, stage: waiting.stage }];
    const problem = nodes.find(nodeProblem);
    return problem ? [{ kind: "stage_repair", ref: row.episode_ref, title: row.title, stage: problem.stage }] : [];
  });
  const all = perEpisode.flatMap(({ nodes }) => nodes);
  const unreadable = all.filter((node) => nodeClass(node) !== "readable").length;
  const state: StationState = unconnected || failed || (unreadable > 0 && unreadable < all.length) ? "partial" : unreadable === all.length ? stateFromClasses(all.map(nodeClass)) : "observed";
  return { ...base, state, ...(unconnected ? { reason: sourceReasons[unconnected.owner][unconnected.state as Exclude<DramaSource["state"], "connected">] } : {}), counts, decisions: decisions.slice(0, decisionLimit), next: stageNext(all, state) };
}

function shotSummary(outline: StoryboardOutline): ShotSummary {
  const shots = outline.scenes.flatMap((scene) => scene.shots);
  const summary: ShotSummary = { total: outline.shot_count || shots.length };
  if (shots.some((shot) => typeof shot.generation_ready === "boolean")) summary.generation_ready = shots.filter((shot) => shot.generation_ready === true).length;
  if (shots.some((shot) => shot.frame_state)) summary.frames_ready = shots.filter((shot) => shot.frame_state === "ready").length;
  return summary;
}

const taskSourceDown = new Set(["forbidden", "unavailable", "unknown", "needs_contract", "login_required"]);

/**
 * Whether a task observation answered. Rows or per-connection coverage mean it did, and each owner's own connection
 * state then decides its station; only a read that returned neither, in a failed status, makes every task station
 * unreadable. The page and `GET /production` use the same rule.
 */
export function taskSourceAnswered(observation: { rows: readonly unknown[]; connections: readonly unknown[]; status: string }) {
  return observation.rows.length > 0 || observation.connections.length > 0 || !taskSourceDown.has(observation.status);
}

export const taskKeyOf = (task: TaskSnapshot) => task.task_key || `${task.locator.owner}:${task.locator.instance_id}:${task.locator.task_ref}`;
const taskAt = (task: TaskSnapshot) => task.updated_at || task.created_at || task.observed_at || "";

/** Newest first, so the strip shows what changed last; a result with no reference is not previewable and is skipped. */
function resultRefs(tasks: TaskSnapshot[]): StationResultRef[] {
  return [...tasks]
    .sort((a, b) => taskAt(b).localeCompare(taskAt(a)))
    .flatMap((task) => task.results.filter((result) => result.ref).map((result) => ({
      task_key: taskKeyOf(task),
      owner: task.locator.owner,
      task_ref: task.locator.task_ref,
      artifact_ref: result.ref,
      kind: kindOf(result.mime, ownerModality[task.locator.owner]),
      title: task.title,
      at: taskAt(task),
    })))
    .slice(0, resultLimit);
}

/** Risk first, like the work queue: an unknown outcome, then a failure, then something waiting to be picked. */
function taskDecisions(tasks: TaskSnapshot[], awaitsPick: (task: TaskSnapshot) => boolean): StationDecision[] {
  const sorted = [...tasks].sort((a, b) => taskAt(b).localeCompare(taskAt(a)));
  const unknown = sorted.filter((task) => task.state === "unknown").map((task): StationDecision => ({ kind: "unknown_task", ref: task.locator.task_ref, title: task.title, task_key: taskKeyOf(task) }));
  const failed = sorted.filter((task) => ["failed", "partial_failed", "rejected"].includes(task.state)).map((task): StationDecision => ({ kind: "failed_task", ref: task.locator.task_ref, title: task.title, task_key: taskKeyOf(task) }));
  const review = sorted.filter(awaitsPick).map((task): StationDecision => ({ kind: "pick_result", ref: task.locator.task_ref, title: task.title, task_key: taskKeyOf(task) }));
  return [...unknown, ...failed, ...review].slice(0, decisionLimit);
}

type TaskStationId = "frames" | "motion" | "sound" | "cut";
const taskStationIds: TaskStationId[] = ["frames", "motion", "sound", "cut"];

/** The tasks a task station counts: its owner's, and in an episode only those that name it or run under a binding Scaena recorded. */
function stationTasks(id: TaskStationId, input: ProductionInput) {
  const owner = stationOwner[id]!;
  const range = input.range;
  const owned = input.tasks.filter((task) => task.locator.owner === owner);
  const bound = range.kind === "episode" ? episodeBindingRefs(input.production, owner) : new Set<string>();
  const named = range.kind === "episode" ? tasksForEpisode(owned, [range.episode_ref, range.scaena_episode_ref || ""]) : owned;
  const viaBinding = bound.size ? owned.filter((task) => !named.includes(task) && boundTo(task, bound)) : [];
  return { owner, bound, viaBinding, tasks: [...named, ...viaBinding] };
}

const stageTime: StationTime = { state: "needs_contract", reason: "station_timing_contract_missing" };

function taskStation(id: TaskStationId, input: ProductionInput, outline?: StoryboardOutline): ProductionStation {
  const range = input.range;
  const { owner, bound, viaBinding, tasks } = stationTasks(id, input);
  const connections = input.connections.filter((connection) => connection.owner === owner);
  const ready = connections.filter((connection) => connection.state === "ready");
  const shots = id === "frames" && outline ? shotSummary(outline) : undefined;
  const cut = id === "cut" ? cutParts(input.production) : undefined;
  const gaps: StationGap[] = cut ? cut.gaps : [];
  const base = { station: id, tools: stationTools[id], gaps, ...(shots ? { shots } : {}), ...(cut?.facts.length ? { facts: cut.facts } : {}), ...(viaBinding.length ? { linked_by: "scaena_binding" as const } : {}) };

  // In an episode, tasks of an owner that never names episodes cannot be counted here, whatever it has made, unless
  // Scaena recorded which binding of that owner the episode uses.
  const unlinked = range.kind === "episode" && !episodeLinkedOwners.has(owner) && !bound.size && !tasks.length;
  if (unlinked) gaps.unshift({ part: "episode_link", state: "needs_contract", reason: "episode_link_missing" });

  let state: StationState;
  let reason: string | undefined;
  if (!input.tasksReadable) { state = "unavailable"; reason = input.tasksReason || "task_source_unavailable"; }
  else if (!connections.length) { state = "unconnected"; reason = "no_task_connection"; }
  else if (!ready.length) { state = "unavailable"; reason = connections[0].state || "source_unavailable"; }
  else if (!tasks.length && shots?.frames_ready === undefined) {
    if (unlinked) { state = "needs_contract"; reason = "episode_link_missing"; }
    else state = ready.length < connections.length ? "partial" : "empty";
  } else { state = ready.length < connections.length ? "partial" : "observed"; }
  // The cut station is never whole while one of its parts still has no contract or could not be read.
  if (id === "cut" && gaps.length && (state === "observed" || state === "empty")) state = "partial";

  const summary = summarizeTasks(tasks);
  // Frames: a person picks when Eikona's records say so; tasks it did not answer for keep their own state.
  const reviews = id === "frames" ? input.reviews : undefined;
  const awaitsPick = (task: TaskSnapshot) => taskAwaitsPick(task, reviews?.[taskKeyOf(task)]);
  const ownerReview = reviews ? ownerReviewSummary(tasks, reviews) : undefined;
  const counts: StationCounts = { total: summary.total, running: summary.active, waiting_review: tasks.filter(awaitsPick).length, problem: summary.problem, done: summary.succeeded };
  const decisions = taskDecisions(tasks, awaitsPick);
  let next: ProductionStation["next"] = null;
  if (counts.waiting_review) next = { actor: "human", action: "pick" };
  else if (tasks.some((task) => task.state === "unknown")) next = { actor: "agent", action: "reconcile" };
  else if (counts.problem) next = { actor: "human", action: "decide_retry" };
  else if (state === "unconnected") next = { actor: "human", action: "connect" };
  else if (state === "unavailable") next = { actor: "agent", action: "inspect" };
  else if (shots?.frames_ready !== undefined && shots.total > 0 && shots.frames_ready >= shots.total) next = null;
  else if (!counts.total && !counts.running) next = { actor: "agent", action: id === "cut" ? "check" : "generate_quote" };
  const time: StationTime | undefined = input.tasksReadable ? { state: "observed", rollup: rollupTime(tasks, input.now), slowest: slowestRuns(tasks, input.now) } : undefined;
  return { ...base, state, ...(reason ? { reason } : {}), counts, results: resultRefs(tasks), decisions, ...(ownerReview ? { owner_review: ownerReview } : {}), ...(time ? { time } : {}), next };
}

/** The line's time: an episode adds up its stations' tasks, a project every task and says which episode each names. */
function lineTime(input: ProductionInput): ProductionLineTime | undefined {
  if (!input.tasksReadable) return undefined;
  if (input.range.kind === "episode") {
    const tasks = [...new Set(taskStationIds.flatMap((id) => stationTasks(id, input).tasks))];
    const read = input.production;
    const owner_total: ProductionLineTime["owner_total"] = read?.state === "observed"
      ? read.row.timing ? { state: "observed", timing: read.row.timing } : { state: "needs_contract", reason: "episode_timing_contract_missing" }
      : read?.state === "unavailable" ? { state: "unavailable", reason: read.reason }
      : { state: "needs_contract", reason: "episode_timing_contract_missing" };
    return { total: rollupTime(tasks, input.now), owner_total };
  }
  const { rows, unattributed } = episodeTimeRows(input.tasks, input.now);
  const episodes = rows.map((row): LineEpisodeTime => {
    const listed = (input.episodes || []).find((episode) => episode.flow?.scaena_episode_ref === row.episode_ref || episode.episode_ref === row.episode_ref);
    return { ...row, ...(listed ? { title: listed.title, drama_episode_ref: listed.episode_ref } : {}) };
  });
  return { total: rollupTime(input.tasks, input.now), episodes, unattributed };
}

function ownerReviewSummary(tasks: TaskSnapshot[], reviews: Record<string, TaskReviewRead>): OwnerReviewSummary | undefined {
  const asked = tasks.map((task) => reviews[taskKeyOf(task)]).filter((read): read is TaskReviewRead => !!read);
  if (!asked.length) return undefined;
  const observed = asked.flatMap((read) => read.state === "observed" ? [read.review] : []);
  const reasons = [...new Set(asked.flatMap((read) => read.state === "observed" ? [] : [read.reason]))];
  return {
    awaiting: observed.filter((review) => review.owner_decision === "pending" && review.pending_count > 0).length,
    decided: observed.filter((review) => review.owner_decision !== "pending").length,
    unread: asked.length - observed.length,
    ...(reasons.length === 1 ? { reason: reasons[0] } : {}),
  };
}

function lookStation(input: ProductionInput): ProductionStation {
  const summary = input.production?.state === "observed" ? input.production.row.sections.references : undefined;
  if (summary?.state === "observed") {
    // Project-wide: Scaena's reference catalog has no episode field, so the count is the project's usable references.
    const count = Math.max(0, (summary.counts.total ?? 0) - (summary.counts.disabled ?? 0));
    const fact: StationFact = { part: "references", ...(summary.status ? { status: summary.status } : {}), counts: summary.counts, project_scope: true, ...(summary.truncated ? { truncated: true } : {}) };
    return { station: "look", tools: stationTools.look, state: count ? "observed" : "empty", reason: "project_scope", counts: { ...emptyCounts(), total: count, done: count }, results: [], decisions: [], gaps: [], facts: [fact], next: count ? null : { actor: "agent", action: "generate_quote" } };
  }
  const references = input.references || (summary ? { state: summary.state, reason: summary.reason } : { state: "needs_contract" as const, reason: "reference_binding_contract_not_configured" });
  if (references.state === "observed") {
    const count = references.count ?? 0;
    return { station: "look", tools: stationTools.look, state: count ? "observed" : "empty", counts: { ...emptyCounts(), total: count, done: count }, results: [], decisions: [], gaps: [], next: count ? null : { actor: "agent", action: "generate_quote" } };
  }
  const reason = references.reason || (references.state === "needs_contract" ? "reference_binding_contract_not_configured" : "owner_unavailable");
  return {
    station: "look",
    tools: stationTools.look,
    state: references.state,
    reason,
    counts: emptyCounts(),
    results: [],
    decisions: [],
    gaps: [{ part: "references", state: references.state, reason }],
    next: null,
  };
}

const boundTo = (task: TaskSnapshot, refs: Set<string>) => (!!task.owner_episode_ref && refs.has(task.owner_episode_ref)) || refs.has(task.locator.task_ref);

const cutDefaults: Record<"edit" | "review" | "delivery", { part: StationGap["part"]; reason: string }> = {
  edit: { part: "edit", reason: "edit_contract_missing" },
  review: { part: "review_adoption", reason: "review_contract_missing" },
  delivery: { part: "delivery", reason: "delivery_contract_missing" },
};

/**
 * The cut station's parts. Without Scaena's summary each part keeps its own gap; with it, a part Scaena observed becomes
 * a fact and a part it could not answer stays a gap with Scaena's reason. Assembly is a gap only when Scaena says so.
 */
function cutParts(read: EpisodeProductionRead | undefined): { gaps: StationGap[]; facts: StationFact[] } {
  const sections = read?.state === "observed" ? read.row.sections : undefined;
  const gaps: StationGap[] = [];
  const facts: StationFact[] = [];
  const gap = (part: StationGap["part"], section: EpisodeProductionSection | undefined, fallback: string) =>
    gaps.push({ part, state: section?.state === "unavailable" ? "unavailable" : "needs_contract", reason: section?.reason || fallback });
  for (const key of ["edit", "review", "delivery"] as const) {
    const section = sections?.[key];
    if (section?.state === "observed" && key !== "delivery") facts.push({ part: key, ...(section.status ? { status: section.status } : {}), counts: section.counts });
    else gap(cutDefaults[key].part, section, cutDefaults[key].reason);
  }
  const assembly = sections?.assembly;
  if (assembly?.state === "observed") facts.push({ part: "assembly", ...(assembly.status ? { status: assembly.status } : {}), ...(assembly.artifact_ref ? { artifact_ref: assembly.artifact_ref } : {}), counts: assembly.counts });
  else if (assembly) gap("assembly", assembly, "assembly_unavailable");
  return { gaps, facts };
}

/** A failed episode read must leave story and board unreadable, never at "not started". */
function unreadStageStation(id: "story" | "board"): ProductionStation {
  return { station: id, tools: stationTools[id], state: "unavailable", reason: "owner_unavailable", counts: emptyCounts(), results: [], decisions: [], gaps: [], next: { actor: "agent", action: "inspect" } };
}

export function buildProductionLine(input: ProductionInput): ProductionLine {
  const outline = input.range.kind === "episode" ? input.detail?.outline : undefined;
  const story = input.range.kind === "episode"
    ? input.detail ? episodeStageStation("story", input.detail.rail) : unreadStageStation("story")
    : projectStageStation("story", input);
  const board = input.range.kind === "episode"
    ? input.detail ? episodeStageStation("board", input.detail.rail, outline) : unreadStageStation("board")
    : projectStageStation("board", input);
  const stations: ProductionStation[] = [
    { ...story, time: stageTime },
    { ...lookStation(input), time: stageTime },
    { ...board, time: stageTime },
    taskStation("frames", input, outline),
    taskStation("motion", input),
    taskStation("sound", input),
    taskStation("cut", input),
  ];
  const current = stations.find((station) => station.next?.actor === "human")?.station
    ?? stations.find((station) => station.next?.actor === "agent" && station.state !== "unavailable")?.station
    ?? null;
  const line: ProductionLine = {
    schema_version: productionLineSchema,
    scope: input.scope,
    range: input.range,
    observed_at: input.now,
    stations,
    current,
  };
  const time = lineTime(input);
  if (time) line.time = time;
  // Unread tasks are not "none unassigned".
  if (input.range.kind === "episode" && input.tasksReadable) {
    const owners = new Set<TaskOwner>(["eikona", "scaena", "sonora", "anatomia"]);
    line.unassigned_tasks = input.tasks.filter((task) => owners.has(task.locator.owner) && !task.episode_ref && !boundTo(task, episodeBindingRefs(input.production, task.locator.owner))).length;
  }
  return line;
}

/** The station a card or a brief is about. */
export const stationOf = (line: Pick<ProductionLine, "stations">, id: ProductionStationId) => line.stations.find((station) => station.station === id);

/** Stations that already have something to show, in order; used to draw the progress segments of an episode card. */
export function stationProgress(line: Pick<ProductionLine, "stations">) {
  return line.stations.map((station) => ({
    station: station.station,
    state: station.state,
    active: station.counts.total > 0 || station.counts.done > 0 || (station.shots?.frames_ready ?? 0) > 0,
    attention: station.next?.actor === "human",
  }));
}
