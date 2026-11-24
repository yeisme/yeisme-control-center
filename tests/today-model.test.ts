import { describe, expect, it } from "vitest";
import { countTasks, pickCover, pickDecisions, pickFocus, pickOutputs } from "../src/pages/home/today-model";
import type { DramaEpisodeRow, DramaRailStage } from "../src/shared/drama";
import type { CreativeFlowStage } from "../src/shared/creative-flow";
import type { WorkQueueItem } from "../src/shared/work-queue";
import type { TaskSnapshot } from "../src/task-observation";

const stages: CreativeFlowStage[] = ["screenplay", "director_plan", "creative_storyboard", "production_handoff", "production_breakdown"];
const rail = (states: DramaRailStage["state"][]): DramaRailStage[] => stages.map((stage, index) => ({ stage, owner: stage === "production_breakdown" ? "scaena" : "auctra", state: states[index], coverage: "complete", freshness: "fresh", source_current: true, observed_at: "2026-11-06T00:00:00Z" }));
const row = (ref: string, title: string, states?: DramaRailStage["state"][]): DramaEpisodeRow => ({ episode_ref: ref, title, origin: "collection", read: states ? "read" : "deferred", ...(states ? { flow: { coverage: "complete", observed_at: "2026-11-06T00:00:00Z", rail: rail(states), source_coverage: [] } } : {}) });

const task = (ref: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  schema_version: "yeisme.task_observation.v1", locator: { owner: "eikona", instance_id: "i", project: "p", task_family: "run", task_ref: ref }, task_key: `k-${ref}`,
  title: ref, state: "succeeded", native_state: "", stage: "", revision: "1", created_at: "2026-11-06T01:00:00Z", updated_at: "2026-11-06T02:00:00Z", observed_at: "2026-11-06T02:00:00Z",
  started_at: null, progress: { kind: "indeterminate", completed: null, total: null, percent: null }, source: "", actor: null, parent_ref: null, results: [], allowed_actions: [], coverage: "complete", ...patch,
});
const image = (ref: string, thumbnail: "ready" | "unavailable" = "ready") => ({ ref, name: `${ref}.png`, mime: "image/png", bytes: 1, state: "complete", thumbnail: { state: thumbnail } });

describe("today: focus", () => {
  it("leads with the episode waiting on a person and names the stage in plain words", () => {
    const focus = pickFocus({ scopeLabel: "雨夜重逢", tasks: [], episodes: [row("ep-01", "第 1 集", ["accepted", "accepted", "accepted", "accepted", "accepted"]), row("ep-02", "第 2 集 · 末班车", ["accepted", "accepted", "waiting_review", "missing", "not_started"])] });
    expect(focus).toMatchObject({ kind: "episode", episode_ref: "ep-02", headline: "第 2 集 · 末班车的创意分镜在等你确认。", target: "/drama?studio=ep-02", action: "继续制作" });
  });

  it("never claims progress for an episode it could not read", () => {
    const focus = pickFocus({ scopeLabel: "雨夜重逢", tasks: [], episodes: [row("ep-09", "第 9 集")] });
    expect(focus.kind).toBe("project");
    expect(focus.headline).toBe("今天还没有新的动静。");
    expect(focus.detail).toBe("没有在跑的任务");
  });

  it("falls back to the project's own counts, review first", () => {
    const tasks = [task("a", { state: "running" }), task("b", { state: "waiting_review" }), task("c", { state: "failed" })];
    expect(pickFocus({ scopeLabel: "海岸来信", episodes: [], tasks })).toMatchObject({ kind: "project", headline: "1 个结果在等你挑。", detail: "1 个在跑 · 1 个等你挑 · 1 个要处理", target: "/review", action: "去挑选" });
    expect(countTasks(tasks)).toEqual({ running: 1, review: 1, problem: 1 });
  });
});

describe("today: decisions", () => {
  const item = (kind: WorkQueueItem["kind"], ref: string) => ({ kind, work_ref: ref }) as WorkQueueItem;
  it("keeps the queue's risk order and leaves system problems to their own corner", () => {
    const picked = pickDecisions([item("credential_renewal", "c"), item("task_unknown", "u"), item("service_blocked", "s"), item("task_failure", "f"), item("review_required", "r"), item("handoff_ready", "h")]);
    expect(picked.map((entry) => entry.work_ref)).toEqual(["u", "f", "r"]);
  });
});

describe("today: cover and outputs", () => {
  it("covers an episode only with its own picture", () => {
    const tasks = [task("other", { episode_ref: "ep-02", results: [image("x")], updated_at: "2026-11-06T09:00:00Z" }), task("own", { episode_ref: "ep-01", results: [image("own-1")] })];
    expect(pickCover(tasks, ["ep-01"])?.result.ref).toBe("own-1");
    expect(pickCover(tasks, ["ep-03"])).toBeNull();
    expect(pickCover(tasks)?.result.ref).toBe("x");
    expect(pickCover([task("t", { results: [image("no-thumb", "unavailable")] })])).toBeNull();
  });

  it("labels yesterday's results as recent, not as today's", () => {
    const now = new Date(2026, 10, 6, 20, 0);
    const todays = task("today", { updated_at: new Date(2026, 10, 6, 9).toISOString(), results: [image("t1")] });
    const older = task("older", { updated_at: new Date(2026, 10, 4, 9).toISOString(), results: [image("o1")] });
    expect(pickOutputs([older, todays], now)).toMatchObject({ label: "今天的产出", entries: [expect.objectContaining({ key: "k-today:t1" })] });
    expect(pickOutputs([older], now).label).toBe("最近的产出");
    expect(pickOutputs([task("run", { state: "running", results: [image("r")] })], now).entries).toEqual([]);
  });
});
