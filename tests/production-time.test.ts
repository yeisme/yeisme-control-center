import { describe, expect, it } from "vitest";
import { dominantCategory, episodeTimeRows, normalizeProcessTiming, rollupTime, slowestRuns, timeExtent } from "../src/shared/production-time";
import { formatSpan } from "../src/shared/read-model/format";
import type { ProcessTiming, TaskOwner, TaskSnapshot } from "../src/task-observation";

const now = "2026-11-12T08:00:00.000Z";
const minute = 60_000;

const timing = (run: string, patch: Partial<ProcessTiming> = {}): ProcessTiming => ({
  run_ref: run,
  phase: "run",
  operation: "video",
  status: "completed",
  started_at: "2026-11-12T07:00:00.000Z",
  ended_at: "2026-11-12T07:10:00.000Z",
  wall_duration_ms: 10 * minute,
  active_duration_ms: 0,
  queue_duration_ms: 0,
  blocked_duration_ms: 0,
  human_wait_duration_ms: 0,
  heartbeat_at: null,
  stall_after_ms: null,
  retry_count: 0,
  ...patch,
});

const task = (owner: TaskOwner, ref: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  schema_version: "yeisme.task_observation.v1",
  locator: { owner, instance_id: "i", project: "p", task_family: "run", task_ref: ref },
  task_key: `${owner}:${ref}`,
  title: ref,
  state: "succeeded",
  native_state: "succeeded",
  stage: "succeeded",
  revision: "1",
  created_at: "2026-11-12T07:00:00.000Z",
  updated_at: "2026-11-12T07:10:00.000Z",
  observed_at: now,
  started_at: null,
  progress: { kind: "indeterminate", completed: null, total: null, percent: null },
  source: "",
  actor: null,
  parent_ref: null,
  results: [],
  allowed_actions: [],
  coverage: "complete",
  ...patch,
});

describe("normalizeProcessTiming", () => {
  const owner = {
    schema_version: "yeisme.process_timing.v1", run_ref: "run-1", parent_run_ref: "run-0", owner: "scaena", project_ref: "p", phase: "run", operation: "video",
    status: "completed", started_at: "2026-11-12T07:00:00Z", ended_at: "2026-11-12T07:10:00Z", wall_duration_ms: 600000, active_duration_ms: 500000, queue_duration_ms: 100000,
    blocked_duration_ms: 0, human_wait_duration_ms: 0, heartbeat_at: "2026-11-12T07:10:00Z", stall_after_ms: 120000, retry_count: 1,
    input_digest: "sha256:abc", evidence_ref: "evidence:run-timing", next_action: "inspect", events: [{ event_id: "e" }],
  };

  it("keeps the owner's times and durations under the owner's names", () => {
    expect(normalizeProcessTiming(owner)).toEqual({
      run_ref: "run-1", parent_run_ref: "run-0", phase: "run", operation: "video", status: "completed", started_at: "2026-11-12T07:00:00Z", ended_at: "2026-11-12T07:10:00Z",
      wall_duration_ms: 600000, active_duration_ms: 500000, queue_duration_ms: 100000, blocked_duration_ms: 0, human_wait_duration_ms: 0,
      heartbeat_at: "2026-11-12T07:10:00Z", stall_after_ms: 120000, retry_count: 1,
    });
  });

  it("never forwards events, digests or evidence refs", () => {
    const kept = normalizeProcessTiming(owner) as unknown as Record<string, unknown>;
    for (const key of ["events", "input_digest", "evidence_ref", "next_action", "owner", "project_ref"]) expect(kept).not.toHaveProperty(key);
  });

  it("drops a record of another schema, an unknown status, or one with no run or start", () => {
    expect(normalizeProcessTiming({ ...owner, schema_version: "yeisme.process_timing.v2" })).toBeUndefined();
    expect(normalizeProcessTiming({ ...owner, status: "done" })).toBeUndefined();
    expect(normalizeProcessTiming({ ...owner, run_ref: "" })).toBeUndefined();
    expect(normalizeProcessTiming({ ...owner, started_at: "yesterday" })).toBeUndefined();
    expect(normalizeProcessTiming(null)).toBeUndefined();
    expect(normalizeProcessTiming("timing")).toBeUndefined();
  });

  it("turns a duration that is not a non-negative integer into null, never zero", () => {
    const kept = normalizeProcessTiming({ ...owner, wall_duration_ms: -1, active_duration_ms: 1.5, queue_duration_ms: "100", blocked_duration_ms: undefined, retry_count: -2 })!;
    expect(kept.wall_duration_ms).toBeNull();
    expect(kept.active_duration_ms).toBeNull();
    expect(kept.queue_duration_ms).toBeNull();
    expect(kept.blocked_duration_ms).toBeNull();
    expect(kept.retry_count).toBeNull();
  });
});

describe("rollupTime", () => {
  it("has no total, not a zero, when no task carries timing", () => {
    const rollup = rollupTime([task("eikona", "a"), task("eikona", "b")], now);
    expect(rollup.wall_ms).toBeNull();
    expect(rollup.timed).toBe(0);
    expect(rollup.total).toBe(2);
    expect(rollupTime([], now).wall_ms).toBeNull();
  });

  it("counts coverage and keeps a finished run's unsplit time apart from its categories", () => {
    const rollup = rollupTime([
      task("scaena", "a", { timing: timing("a") }),
      task("scaena", "b", { timing: timing("b", { wall_duration_ms: 20 * minute, active_duration_ms: 12 * minute, queue_duration_ms: 5 * minute }) }),
      task("eikona", "c"),
    ], now);
    expect(rollup).toMatchObject({ wall_ms: 30 * minute, active_ms: 12 * minute, queue_ms: 5 * minute, blocked_ms: 0, human_wait_ms: 0, unsplit_ms: 13 * minute, timed: 2, total: 3, ticking: 0 });
    expect(rollup.overlap).toBeUndefined();
    expect(timeExtent(rollup)).toBe(30 * minute);
  });

  it("does not add a run that lies inside its parent's span", () => {
    const parent = timing("parent", { wall_duration_ms: 30 * minute, ended_at: "2026-11-12T07:30:00.000Z" });
    const child = timing("child", { parent_run_ref: "parent", started_at: "2026-11-12T07:05:00.000Z", ended_at: "2026-11-12T07:15:00.000Z" });
    const rollup = rollupTime([task("scaena", "parent", { timing: parent }), task("scaena", "child", { timing: child })], now);
    expect(rollup.wall_ms).toBe(30 * minute);
    expect(rollup.retries).toBe(0);
    expect(rollup.timed).toBe(2);
  });

  it("counts a run that follows the attempt it names as its own time and one retry", () => {
    const first = timing("first", { status: "failed" });
    const second = timing("second", { parent_run_ref: "first", started_at: "2026-11-12T07:20:00.000Z", ended_at: "2026-11-12T07:25:00.000Z", wall_duration_ms: 5 * minute });
    const rollup = rollupTime([task("scaena", "first", { timing: first }), task("scaena", "second", { timing: second })], now);
    expect(rollup.wall_ms).toBe(15 * minute);
    expect(rollup.retries).toBe(1);
  });

  it("adds the owner's own retry counts", () => {
    expect(rollupTime([task("scaena", "a", { timing: timing("a", { retry_count: 2 }) })], now).retries).toBe(2);
  });

  it("lets a running run grow to now and puts the growth where its status says", () => {
    const running = timing("r", { status: "running", started_at: "2026-11-12T07:50:00.000Z", ended_at: null, wall_duration_ms: 4 * minute, active_duration_ms: 4 * minute });
    const rollup = rollupTime([task("scaena", "r", { state: "running", timing: running })], now);
    expect(rollup).toMatchObject({ wall_ms: 10 * minute, active_ms: 10 * minute, unsplit_ms: 0, running: 1, ticking: 1 });
  });

  it("freezes a stalled run at what its owner wrote", () => {
    const stalled = timing("s", { status: "stalled", started_at: "2026-11-12T07:00:00.000Z", ended_at: null, wall_duration_ms: 4 * minute, active_duration_ms: 4 * minute });
    const rollup = rollupTime([task("scaena", "s", { state: "running", timing: stalled })], now);
    expect(rollup).toMatchObject({ wall_ms: 4 * minute, stalled: 1, running: 0, ticking: 0 });
  });

  it("counts time waiting for a person as waiting, not as running", () => {
    const waiting = timing("w", { status: "waiting_for_human", started_at: "2026-11-12T07:30:00.000Z", ended_at: null, wall_duration_ms: 10 * minute, active_duration_ms: 10 * minute });
    const rollup = rollupTime([task("scaena", "w", { timing: waiting })], now);
    expect(rollup).toMatchObject({ wall_ms: 30 * minute, active_ms: 10 * minute, human_wait_ms: 20 * minute, waiting_human: 1, running: 0 });
  });

  it("marks overlapping categories and draws against their sum", () => {
    const rollup = rollupTime([task("scaena", "o", { timing: timing("o", { active_duration_ms: 8 * minute, blocked_duration_ms: 6 * minute }) })], now);
    expect(rollup.overlap).toBe(true);
    expect(rollup.unsplit_ms).toBe(0);
    expect(timeExtent(rollup)).toBe(14 * minute);
  });

  it("skips a run whose owner sent no wall but still counts it as timed", () => {
    const rollup = rollupTime([task("scaena", "n", { timing: timing("n", { wall_duration_ms: null }) })], now);
    expect(rollup.wall_ms).toBe(0);
    expect(rollup.timed).toBe(1);
  });

  it("grows live runs to the newest observation when a task was read after the page's now", () => {
    const running = timing("r", { status: "running", started_at: "2026-11-12T07:50:00.000Z", ended_at: null, wall_duration_ms: 0, active_duration_ms: 0 });
    const later = "2026-11-12T08:05:00.000Z";
    const rollup = rollupTime([task("scaena", "r", { state: "running", observed_at: later, timing: running })], now);
    expect(rollup.as_of).toBe(later);
    expect(rollup.wall_ms).toBe(15 * minute);
    // Untimed tasks do not move the instant.
    expect(rollupTime([task("eikona", "u", { observed_at: later })], now).as_of).toBe(now);
  });

  it("names the category most of the time went to, or none when nothing was split", () => {
    expect(dominantCategory(rollupTime([task("scaena", "a", { timing: timing("a") })], now))).toBeNull();
    expect(dominantCategory(rollupTime([task("scaena", "a", { timing: timing("a", { queue_duration_ms: 9 * minute, active_duration_ms: minute }) })], now))).toBe("queue");
  });
});

describe("episodeTimeRows", () => {
  it("groups by the Scaena episode ref only and leaves the rest unattributed", () => {
    const { rows, unattributed } = episodeTimeRows([
      task("scaena", "a", { episode_ref: "episode:01", timing: timing("a") }),
      task("scaena", "b", { episode_ref: "episode:02", timing: timing("b", { wall_duration_ms: 40 * minute }) }),
      task("scaena", "c", { timing: timing("c", { wall_duration_ms: 3 * minute }) }),
      task("sonora", "d", { owner_episode_ref: "sonora://episode/01", timing: timing("d", { wall_duration_ms: 2 * minute }) }),
      task("eikona", "e"),
    ], now);
    expect(rows.map((row) => [row.episode_ref, row.time.wall_ms])).toEqual([["episode:02", 40 * minute], ["episode:01", 10 * minute]]);
    expect(unattributed).toMatchObject({ wall_ms: 5 * minute, timed: 2, total: 3 });
  });
});

describe("slowestRuns", () => {
  it("lists timed runs longest first and leaves untimed tasks out", () => {
    const runs = slowestRuns([
      task("scaena", "a", { timing: timing("a") }),
      task("scaena", "b", { timing: timing("b", { wall_duration_ms: 40 * minute }) }),
      task("eikona", "c"),
    ], now, 5);
    expect(runs.map((run) => run.task_key)).toEqual(["scaena:b", "scaena:a"]);
  });
});

describe("formatSpan", () => {
  it("reads in a person's units", () => {
    expect(formatSpan(null)).toBeNull();
    expect(formatSpan(0)).toBe("0 秒");
    expect(formatSpan(400)).toBe("不到 1 秒");
    expect(formatSpan(42_000)).toBe("42 秒");
    expect(formatSpan(3 * minute + 5_000)).toBe("3 分 5 秒");
    expect(formatSpan(18 * minute + 20_000)).toBe("18 分");
    expect(formatSpan(134 * minute)).toBe("2 小时 14 分");
    expect(formatSpan(120 * minute)).toBe("2 小时");
    expect(formatSpan(76 * 60 * minute)).toBe("3 天 4 小时");
  });
});
