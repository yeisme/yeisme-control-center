import type { CreativeFlowStage } from "../creative-flow";
import { creativeFlowStages } from "../creative-flow";
import { dramaNextStep, isNeutralNode, isProblemNode, neutralBlockers, validDramaRef, type DramaEpisodeRow, type DramaFlowSummary, type DramaRailStage, type DramaRailState } from "../drama";
import type { TaskSnapshot } from "../../task-observation";

export const dramaStageLabels: Record<CreativeFlowStage, string> = {
  screenplay: "剧本",
  director_plan: "导演计划",
  creative_storyboard: "创意分镜",
  production_handoff: "制作交接",
  production_breakdown: "制作拆解",
};

export const dramaOwnerNames = { auctra: "Auctra", scaena: "Scaena", muweave: "MuWeave", "control-center": "控制中心" } as const;

export type RailShape = "check" | "tick" | "eye" | "spin" | "alert" | "clock" | "dashed" | "plug" | "slash" | "lock" | "question";
export type RailTone = "success" | "info" | "warning" | "danger" | "review" | "neutral";

/** Shape is the non-colour channel: every state has its own icon as well as its own label. */
export const railStateInfo: Record<DramaRailState, { label: string; tone: RailTone; shape: RailShape }> = {
  accepted: { label: "已通过", tone: "success", shape: "check" },
  ready: { label: "就绪", tone: "success", shape: "tick" },
  waiting_review: { label: "待审阅", tone: "review", shape: "eye" },
  in_progress: { label: "进行中", tone: "info", shape: "spin" },
  blocked: { label: "受阻", tone: "danger", shape: "alert" },
  stale: { label: "已过期", tone: "warning", shape: "clock" },
  missing: { label: "未开始", tone: "neutral", shape: "dashed" },
  not_started: { label: "未开始", tone: "neutral", shape: "dashed" },
  needs_contract: { label: "待合同", tone: "review", shape: "plug" },
  unavailable: { label: "不可用", tone: "warning", shape: "slash" },
  forbidden: { label: "无权限", tone: "danger", shape: "lock" },
  unknown: { label: "未确认", tone: "neutral", shape: "question" },
};

const blockerLabels: Record<string, string> = {
  source_not_accepted: "待采纳",
  source_not_current: "来源已不是最新",
  source_digest_mismatch: "来源摘要不一致",
  source_superseded: "来源已被取代",
  screenplay_revision_mismatch: "剧本版本已变化",
  director_plan_mismatch: "导演计划与分镜不匹配",
  breakdown_cancelled: "拆解已取消",
  owner_read_failed: "owner 读取失败",
  owner_unavailable: "owner 暂不可用",
  owner_forbidden: "无权读取",
  source_not_configured: "尚未连接该来源",
  scaena_storyboard_binding_missing: "尚未连接 Scaena",
  episode_ref_required: "需要指定剧集",
  needs_contract: "owner 尚未提供该合同",
  delegation_unavailable: "缺少访问委托",
  owner_unreadable: "owner 暂时读不到",
  upstream_not_allowed: "来源地址未获授权",
  response_limit_exceeded: "owner 返回内容过大",
  invalid_response: "owner 返回的格式不符合合同",
  collection_binding_missing: "当前范围没有连接 Auctra 收集库",
  collection_not_synced: "收集库还没有同步",
  episode_not_in_collection: "收集库里没有这一集（这个引用可能是 Scaena 的）",
  episodes_sampled: "只检查了最近更新的几集",
};

/** Shown as red it would read as a fault when it is only waiting on a person to accept the screenplay. */
export function railNodeInfo(node: Pick<DramaRailStage, "state" | "blocker">) {
  if (isNeutralNode(node)) return { label: "待采纳", tone: "neutral", shape: "dashed" } as const;
  return railStateInfo[node.state];
}

/** The stage the next-step sentence is about, so the rail's marker and the sentence can never disagree. */
export const currentStage = (flow: Pick<DramaFlowSummary, "rail" | "next_attention">) => dramaNextStep(flow.rail, flow.next_attention).stage;

export function blockerLabel(code: string | undefined) {
  if (!code) return "";
  return blockerLabels[code] || code.replace(/[_-]+/g, " ");
}

export interface NextStepText { text: string; tone: RailTone }

const attentionVerb: Record<string, string> = { review: "待审阅", repair: "需处理", inspect: "待确认", open_owner: "来源受限", handoff: "可交接" };

/** One sentence naming the stage and the owner, so a producer knows who has to move next. */
export function nextStepText(rail: DramaRailStage[], attention: Parameters<typeof dramaNextStep>[1]): NextStepText {
  const step = dramaNextStep(rail, attention);
  if (step.kind === "done") return { text: "已推进到制作拆解；生成、审阅与交付尚无 owner 合同", tone: "success" };
  const stage = step.stage ? dramaStageLabels[step.stage] : "";
  const owner = step.owner ? dramaOwnerNames[step.owner] : "";
  if (step.kind === "start") return { text: `待开始：${stage}（${owner}）`, tone: "neutral" };
  if (step.kind === "in_progress") return { text: `进行中：${stage}（${owner}）`, tone: "info" };
  if (step.kind === "unreadable") return { text: `暂时读不到：${stage}（${owner}）${step.reason ? ` · ${blockerLabel(step.reason)}` : ""}`, tone: "warning" };
  // Auctra reports an unaccepted screenplay as blocked; that is progress waiting on a person, not a fault.
  if (step.reason && neutralBlockers.has(step.reason)) return { text: `${blockerLabel(step.reason)}：${stage}（${owner}）`, tone: "neutral" };
  // A bare state word ("waiting_review", "stale") is already said by the verb; only a specific blocker adds information.
  const reason = step.reason && !(step.reason in railStateInfo) ? ` · ${blockerLabel(step.reason)}` : "";
  const verb = attentionVerb[step.action || "inspect"] || "待处理";
  const tone: RailTone = step.action === "review" ? "review" : step.action === "repair" ? "danger" : step.action === "handoff" ? "success" : "warning";
  return { text: `${verb}：${stage}（${owner}）${reason}`, tone };
}

export interface EpisodeEntry {
  episode_ref: string;
  title: string;
  origin: "collection" | "task" | "manual";
  row?: DramaEpisodeRow;
}

const collator = new Intl.Collator("en", { numeric: true });

/** Server rows first (already in natural order); episodes only seen on tasks or typed by hand follow, never replacing a known one. */
export function mergeEpisodeEntries(rows: DramaEpisodeRow[], taskRefs: string[], manualRef?: string | null): EpisodeEntry[] {
  const entries: EpisodeEntry[] = rows.map((row) => ({
    episode_ref: row.episode_ref,
    title: row.title,
    origin: row.origin === "collection" ? "collection" : taskRefs.includes(row.episode_ref) ? "task" : "manual",
    row,
  }));
  const seen = new Set(entries.map((entry) => entry.episode_ref));
  for (const ref of [...taskRefs].sort(collator.compare)) if (!seen.has(ref)) { seen.add(ref); entries.push({ episode_ref: ref, title: ref, origin: "task" }); }
  if (manualRef && !seen.has(manualRef)) entries.push({ episode_ref: manualRef, title: manualRef, origin: "manual" });
  return entries;
}

export function taskEpisodeRefs(tasks: TaskSnapshot[], limit = 12) {
  const refs = new Set<string>();
  // Task refs are owner-supplied text; one malformed ref must not stop the board from loading.
  for (const task of tasks) if (task.episode_ref && validDramaRef(task.episode_ref)) refs.add(task.episode_ref);
  return [...refs].sort(collator.compare).slice(0, limit);
}

export interface EpisodeTaskSummary {
  total: number;
  active: number;
  review: number;
  problem: number;
  succeeded: number;
}

const activeTaskStates = new Set(["queued", "pending", "created", "running", "cancel_requested"]);
const problemTaskStates = new Set(["failed", "unknown", "partial_failed", "rejected"]);

export function tasksForEpisode(tasks: TaskSnapshot[], refs: string[]) {
  const wanted = new Set(refs.filter(Boolean));
  return tasks.filter((task) => task.episode_ref && wanted.has(task.episode_ref));
}

/** Task state is machine execution only; it never stands in for review, adoption or delivery. */
export function summarizeTasks(tasks: TaskSnapshot[]): EpisodeTaskSummary {
  return {
    total: tasks.length,
    active: tasks.filter((task) => activeTaskStates.has(task.state)).length,
    review: tasks.filter((task) => task.state === "waiting_review").length,
    problem: tasks.filter((task) => problemTaskStates.has(task.state)).length,
    succeeded: tasks.filter((task) => ["succeeded", "completed"].includes(task.state)).length,
  };
}

export interface DramaMetrics { episodes: number; read: number; review: number; blocked: number; handoff: number; broken_down: number }

export function dramaMetrics(entries: EpisodeEntry[]): DramaMetrics {
  const read = entries.filter((entry) => entry.row?.flow);
  const rails = read.map((entry) => entry.row!.flow!.rail);
  const state = (rail: DramaRailStage[], stage: CreativeFlowStage) => rail.find((node) => node.stage === stage)?.state;
  return {
    episodes: entries.length,
    read: read.length,
    review: rails.filter((rail) => rail.some((node) => node.state === "waiting_review")).length,
    blocked: rails.filter((rail) => rail.some((node) => isProblemNode(node) && node.state !== "waiting_review" && !isNeutralNode(node))).length,
    handoff: rails.filter((rail) => ["accepted", "ready"].includes(state(rail, "production_handoff") || "") && state(rail, "production_breakdown") === "not_started").length,
    broken_down: rails.filter((rail) => state(rail, "production_breakdown") === "accepted").length,
  };
}

const shotSizeLabels: Record<string, string> = { extreme_wide: "大远景", wide: "远景", full: "全景", medium: "中景", medium_close_up: "中近景", close_up: "近景", extreme_close_up: "特写", establishing: "建立镜头" };
const cameraAngleLabels: Record<string, string> = { eye_level: "平视", high: "俯拍", low: "仰拍", over_the_shoulder: "过肩", dutch: "斜角", birds_eye: "鸟瞰", worms_eye: "虫视" };
const cameraMovementLabels: Record<string, string> = { static: "固定", push_in: "推", pull_out: "拉", pan: "摇", tilt: "俯仰", track: "跟", dolly: "移", handheld: "手持", handheld_push: "手持推进", zoom: "变焦", crane: "升降" };

/** Owner vocabulary is snake_case; known tokens read in Chinese, anything new stays visible as readable text instead of vanishing. */
function token(value: string | undefined, labels: Record<string, string>) {
  if (!value) return "—";
  return labels[value] || value.replace(/[_-]+/g, " ");
}
export const shotSizeLabel = (value?: string) => token(value, shotSizeLabels);
export const cameraAngleLabel = (value?: string) => token(value, cameraAngleLabels);
export const cameraMovementLabel = (value?: string) => token(value, cameraMovementLabels);

export function formatShotDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const seconds = ms / 1000;
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

export { creativeFlowStages };
