import { processTimingStatuses, type ProcessTiming, type ProcessTimingStatus, type TaskSnapshot } from "../task-observation";

/**
 * How long production took, added up from the owners' own `yeisme.process_timing.v1` records at read time. Nothing here
 * is stored and nothing is derived from a task's created or updated time: a task whose owner sent no timing counts toward
 * `total` only, and a range with no timed task has `wall_ms: null`, never zero.
 */
export const processTimingSchema = "yeisme.process_timing.v1" as const;

export const timeCategories = ["active", "queue", "blocked", "human_wait"] as const;
export type TimeCategory = (typeof timeCategories)[number];

export interface TimeRollup {
  /** Total elapsed time of the timed runs; `null` when none of the tasks carried timing. */
  wall_ms: number | null;
  active_ms: number;
  queue_ms: number;
  blocked_ms: number;
  human_wait_ms: number;
  /** The part of `wall_ms` the owners did not split into a category. */
  unsplit_ms: number;
  /** The owners' categories may overlap; set when they add up to more than `wall_ms`. */
  overlap?: true;
  retries: number;
  running: number;
  stalled: number;
  waiting_human: number;
  /** Runs whose elapsed time is still growing; the page may tick the total by this many seconds per second. */
  ticking: number;
  /** Tasks that carried timing, out of the tasks looked at. */
  timed: number;
  total: number;
  first_started_at: string | null;
  last_ended_at: string | null;
  /** The instant live runs were grown to: the later of `now` and the newest observation of a timed task. */
  as_of: string;
}

export interface EpisodeTimeRow {
  /** The Scaena episode ref the tasks named. */
  episode_ref: string;
  time: TimeRollup;
}

export interface SlowRun {
  task_key: string;
  title: string;
  status: ProcessTimingStatus;
  wall_ms: number;
}

const statusSet = new Set<string>(processTimingStatuses);
const liveStatuses = new Set<ProcessTimingStatus>(["created", "queued", "running", "paused", "blocked", "waiting_for_human", "reconciling"]);
/** Where a live run's time since the owner last wrote goes; statuses not listed here stay unsplit. */
const liveCategory: Partial<Record<ProcessTimingStatus, TimeCategory>> = { running: "active", queued: "queue", created: "queue", blocked: "blocked", waiting_for_human: "human_wait" };

const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
const time = (value: unknown): string | null => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null;
const duration = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** An owner's timing record as the control center keeps it; anything that is not a v1 record with a run and a start is dropped. */
export function normalizeProcessTiming(value: unknown): ProcessTiming | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const run = text(raw.run_ref, 512);
  const started = time(raw.started_at);
  if (raw.schema_version !== processTimingSchema || !run || !started || typeof raw.status !== "string" || !statusSet.has(raw.status)) return undefined;
  const parent = text(raw.parent_run_ref, 512);
  return {
    run_ref: run,
    ...(parent ? { parent_run_ref: parent } : {}),
    phase: text(raw.phase, 80),
    operation: text(raw.operation, 120),
    status: raw.status as ProcessTimingStatus,
    started_at: started,
    ended_at: time(raw.ended_at),
    wall_duration_ms: duration(raw.wall_duration_ms),
    active_duration_ms: duration(raw.active_duration_ms),
    queue_duration_ms: duration(raw.queue_duration_ms),
    blocked_duration_ms: duration(raw.blocked_duration_ms),
    human_wait_duration_ms: duration(raw.human_wait_duration_ms),
    heartbeat_at: time(raw.heartbeat_at),
    stall_after_ms: duration(raw.stall_after_ms),
    retry_count: duration(raw.retry_count),
  };
}

const keyOf = (task: TaskSnapshot) => task.task_key || `${task.locator.owner}:${task.locator.instance_id}:${task.locator.task_ref}`;

/** A live run's elapsed time up to `now`; a stalled or finished run keeps what its owner wrote. */
function wallOf(timing: ProcessTiming, now: number): number | null {
  const owner = timing.wall_duration_ms;
  if (!liveStatuses.has(timing.status)) return owner;
  const live = now - Date.parse(timing.started_at);
  return Number.isFinite(live) && live > (owner ?? 0) ? live : owner;
}

const endOf = (timing: ProcessTiming, wall: number | null) => timing.ended_at ? Date.parse(timing.ended_at) : wall === null ? null : Date.parse(timing.started_at) + wall;

/**
 * Adds up the timed tasks. A run whose parent is in the same set and whose whole span lies inside the parent's is the
 * parent's own time and is not added again; a run that only names an earlier attempt (Scaena's retries) counts as its
 * own time and as one retry.
 */
export function rollupTime(tasks: readonly TaskSnapshot[], now: string): TimeRollup {
  // A task read after the page's `now` (a later poll) would otherwise grow from before it started; grow to the newest read.
  const at = tasks.reduce((latest, task) => task.timing ? Math.max(latest, Date.parse(task.observed_at) || 0) : latest, Date.parse(now) || 0);
  const timed = tasks.flatMap((task) => task.timing ? [task.timing] : []);
  const byRun = new Map(timed.map((timing) => [timing.run_ref, timing] as const));
  const rollup: TimeRollup = {
    wall_ms: timed.length ? 0 : null, active_ms: 0, queue_ms: 0, blocked_ms: 0, human_wait_ms: 0, unsplit_ms: 0,
    retries: 0, running: 0, stalled: 0, waiting_human: 0, ticking: 0, timed: timed.length, total: tasks.length, first_started_at: null, last_ended_at: null, as_of: new Date(at).toISOString(),
  };
  let categories = 0;
  for (const timing of timed) {
    const wall = wallOf(timing, at);
    const parent = timing.parent_run_ref ? byRun.get(timing.parent_run_ref) : undefined;
    rollup.retries += timing.retry_count ?? 0;
    if (timing.status === "running" || timing.status === "reconciling") rollup.running += 1;
    if (timing.status === "stalled") rollup.stalled += 1;
    if (timing.status === "waiting_for_human") rollup.waiting_human += 1;
    if (!rollup.first_started_at || timing.started_at < rollup.first_started_at) rollup.first_started_at = timing.started_at;
    if (timing.ended_at && (!rollup.last_ended_at || timing.ended_at > rollup.last_ended_at)) rollup.last_ended_at = timing.ended_at;
    if (parent) {
      const parentEnd = endOf(parent, wallOf(parent, at));
      const end = endOf(timing, wall);
      const inside = parentEnd !== null && end !== null && Date.parse(timing.started_at) >= Date.parse(parent.started_at) && end <= parentEnd;
      if (inside) continue;
      rollup.retries += 1;
    }
    if (wall === null) continue;
    const split: Record<TimeCategory, number> = {
      active: timing.active_duration_ms ?? 0,
      queue: timing.queue_duration_ms ?? 0,
      blocked: timing.blocked_duration_ms ?? 0,
      human_wait: timing.human_wait_duration_ms ?? 0,
    };
    const live = liveCategory[timing.status];
    if (live) split[live] += Math.max(0, wall - (timing.wall_duration_ms ?? 0));
    if (liveStatuses.has(timing.status)) rollup.ticking += 1;
    const sum = split.active + split.queue + split.blocked + split.human_wait;
    rollup.wall_ms = (rollup.wall_ms ?? 0) + wall;
    rollup.active_ms += split.active;
    rollup.queue_ms += split.queue;
    rollup.blocked_ms += split.blocked;
    rollup.human_wait_ms += split.human_wait;
    rollup.unsplit_ms += Math.max(0, wall - sum);
    categories += sum;
  }
  if (rollup.wall_ms !== null && categories > rollup.wall_ms) rollup.overlap = true;
  return rollup;
}

/** Whether a rollup has anything to draw. */
export const hasTime = (rollup: TimeRollup | undefined): rollup is TimeRollup & { wall_ms: number } => !!rollup && rollup.wall_ms !== null;

/** The length a bar is drawn against: the wall, or the categories when they overlap past it. */
export const timeExtent = (rollup: TimeRollup) => Math.max(rollup.wall_ms ?? 0, rollup.active_ms + rollup.queue_ms + rollup.blocked_ms + rollup.human_wait_ms);

/** The category most of the time went to; `null` when nothing was split. */
export function dominantCategory(rollup: TimeRollup): TimeCategory | null {
  const values: [TimeCategory, number][] = [["active", rollup.active_ms], ["queue", rollup.queue_ms], ["blocked", rollup.blocked_ms], ["human_wait", rollup.human_wait_ms]];
  const top = values.reduce((best, item) => item[1] > best[1] ? item : best);
  return top[1] > 0 && top[1] >= rollup.unsplit_ms ? top[0] : null;
}

/**
 * Tasks grouped by the episode they name. Only Scaena's `episode_ref` names an episode (the server keeps no other), so
 * every other task lands in `unattributed`; `owner_episode_ref` is another namespace and is never matched here.
 */
export function episodeTimeRows(tasks: readonly TaskSnapshot[], now: string): { rows: EpisodeTimeRow[]; unattributed: TimeRollup } {
  const groups = new Map<string, TaskSnapshot[]>();
  const rest: TaskSnapshot[] = [];
  for (const task of tasks) {
    if (!task.episode_ref) { rest.push(task); continue; }
    const group = groups.get(task.episode_ref);
    if (group) group.push(task); else groups.set(task.episode_ref, [task]);
  }
  const rows = [...groups].map(([episode_ref, group]) => ({ episode_ref, time: rollupTime(group, now) }))
    .sort((a, b) => (b.time.wall_ms ?? -1) - (a.time.wall_ms ?? -1) || a.episode_ref.localeCompare(b.episode_ref));
  return { rows, unattributed: rollupTime(rest, now) };
}

/** The longest timed runs first. */
export function slowestRuns(tasks: readonly TaskSnapshot[], now: string, limit = 5): SlowRun[] {
  const at = Date.parse(now);
  return tasks.flatMap((task): SlowRun[] => {
    const wall = task.timing ? wallOf(task.timing, at) : null;
    return task.timing && wall !== null ? [{ task_key: keyOf(task), title: task.title, status: task.timing.status, wall_ms: wall }] : [];
  }).sort((a, b) => b.wall_ms - a.wall_ms).slice(0, limit);
}

/** Percentiles are only said from this many samples up (the timing contract's small-sample rule). */
export const timeSampleFloor = 30;
