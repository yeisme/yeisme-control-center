import type { DramaEpisodeRow } from "../../shared/drama";
import { dramaNextStep } from "../../shared/drama";
import type { WorkQueueItem, WorkQueueKind } from "../../shared/work-queue";
import type { TaskArtifact, TaskSnapshot } from "../../task-observation";
import { taskIsActive } from "../../task-observation";
import { dramaStageLabels } from "../../shared/read-model/drama";
import { collectResults, taskInProgress, type ResultEntry } from "../../shared/read-model/tasks";
import { taskNeedsReview } from "../../shared/read-model/review";

/**
 * What "今天" leads with. Every sentence comes from a stage state or a task count that was actually read; when nothing was
 * read the page says so instead of inventing progress.
 */

/** Decisions a person makes. Connection, credential and contract problems are the system's, shown in its own corner. */
export const decisionKinds: readonly WorkQueueKind[] = ["review_required", "task_unknown", "task_failure", "operation_failure", "handoff_ready"];

/** The queue already arrives risk first (unknown before failure before review), so the first few are the ones to show. */
export function pickDecisions(items: WorkQueueItem[], limit = 3) {
  return items.filter((item) => decisionKinds.includes(item.kind)).slice(0, limit);
}

export interface TaskCounts { running: number; review: number; problem: number }

export function countTasks(tasks: TaskSnapshot[]): TaskCounts {
  return {
    running: tasks.filter(taskInProgress).length,
    review: tasks.filter(taskNeedsReview).length,
    problem: tasks.filter((task) => ["failed", "unknown", "partial_failed", "rejected"].includes(task.state)).length,
  };
}

export interface TodayFocus {
  kind: "episode" | "project";
  title: string;
  episode_ref?: string;
  scaena_episode_ref?: string;
  eyebrow: string;
  headline: string;
  detail: string;
  target: string;
  action: string;
}

const at = (task: TaskSnapshot) => task.updated_at || task.created_at || task.observed_at || "";

/** The episode a person most likely wants to continue: one waiting on them, then one ready to start or running, then any read one. */
function focusEpisode(episodes: DramaEpisodeRow[]) {
  const read = episodes.filter((row) => row.flow);
  const step = (row: DramaEpisodeRow) => dramaNextStep(row.flow!.rail, row.flow!.next_attention);
  return read.find((row) => step(row).kind === "attention") || read.find((row) => ["start", "in_progress"].includes(step(row).kind)) || read[0] || null;
}

function countLine(counts: TaskCounts) {
  const parts = [counts.running && `${counts.running} 个在跑`, counts.review && `${counts.review} 个等你挑`, counts.problem && `${counts.problem} 个要处理`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "没有在跑的任务";
}

export function pickFocus(input: { scopeLabel: string; episodes: DramaEpisodeRow[]; tasks: TaskSnapshot[] }): TodayFocus {
  const counts = countTasks(input.tasks);
  const episode = focusEpisode(input.episodes);
  if (episode?.flow) {
    const step = dramaNextStep(episode.flow.rail, episode.flow.next_attention);
    const stage = step.stage ? dramaStageLabels[step.stage] : "";
    const title = episode.title || episode.episode_ref;
    const headline = step.kind === "attention"
      ? step.action === "review" ? `${title}的${stage}在等你确认。` : step.action === "repair" ? `${title}的${stage}需要你处理。` : `${title}的${stage}还没确认结果。`
      : step.kind === "start" ? `${title}可以开始${stage}了。`
        : step.kind === "in_progress" ? `${title}的${stage}正在进行。`
          : step.kind === "unreadable" ? `${title}暂时读不到进度。`
            : `${title}的分镜已经拆好，可以出画面了。`;
    return {
      kind: "episode",
      title,
      episode_ref: episode.episode_ref,
      ...(episode.flow.scaena_episode_ref ? { scaena_episode_ref: episode.flow.scaena_episode_ref } : {}),
      eyebrow: stage ? `${title} · ${stage}` : title,
      headline,
      detail: countLine(counts),
      target: `/drama?studio=${encodeURIComponent(episode.episode_ref)}`,
      action: "继续制作",
    };
  }
  const headline = counts.review ? `${counts.review} 个结果在等你挑。`
    : counts.running ? `${counts.running} 个任务正在跑，它们会自己跑完。`
      : counts.problem ? `${counts.problem} 个任务要你看一下。`
        : "今天还没有新的动静。";
  return {
    kind: "project",
    title: input.scopeLabel,
    eyebrow: input.scopeLabel,
    headline,
    detail: countLine(counts),
    target: counts.review ? "/review" : "/drama",
    action: counts.review ? "去挑选" : "看制作线",
  };
}

export interface Cover { task: TaskSnapshot; result: TaskArtifact }

/**
 * The newest picture with a ready thumbnail. For an episode only that episode's own results count: a picture from
 * another episode would claim progress this one has not made, so the page falls back to a typographic cover.
 */
export function pickCover(tasks: TaskSnapshot[], episodeRefs?: string[]): Cover | null {
  const wanted = new Set((episodeRefs || []).filter(Boolean));
  const pool = [...tasks].filter((task) => !episodeRefs || (task.episode_ref && wanted.has(task.episode_ref))).sort((a, b) => at(b).localeCompare(at(a)));
  for (const task of pool) {
    // A video's thumbnail is a still too, and video is what an episode's tasks can be matched by.
    const result = task.results.find((item) => (item.mime?.startsWith("image/") || item.mime?.startsWith("video/")) && item.thumbnail?.state === "ready");
    if (result && task.task_key) return { task, result };
  }
  return null;
}

const sameDay = (iso: string, now: Date) => {
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
};

/** Finished results from today; on a quiet day the newest ones, labelled as recent rather than passed off as today's. */
export function pickOutputs(tasks: TaskSnapshot[], now: Date, limit = 8): { label: "今天的产出" | "最近的产出"; entries: ResultEntry[] } {
  const finished = [...tasks].filter((task) => !taskIsActive(task)).sort((a, b) => at(b).localeCompare(at(a)));
  const today = collectResults(finished.filter((task) => sameDay(at(task), now)));
  if (today.length) return { label: "今天的产出", entries: today.slice(0, limit) };
  return { label: "最近的产出", entries: collectResults(finished).slice(0, limit) };
}

export function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
}
