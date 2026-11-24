import { describe, expect, it } from "vitest";
import { compileTaskFilters, createdRange, extractTaskQuery, normalizeWindow, parseTaskQuery, rankByQuery, windowBounds, windowLabel, type QueryVocabulary } from "../src/shared/task-query";
import { filterTasks, type TaskFilters, type TaskOwner, type TaskSnapshot } from "../src/task-observation";

const now = Date.parse("2026-11-06T15:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

const task = (owner: TaskOwner, ref: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  schema_version: "yeisme.task_observation.v1",
  locator: { owner, instance_id: "i", project: "rain-reunion", task_family: "run", task_ref: ref },
  task_key: `${owner}:${ref}`,
  connection_id: `${owner}-main`,
  title: ref,
  state: "succeeded",
  native_state: "succeeded",
  stage: "succeeded",
  revision: "1",
  created_at: hoursAgo(2),
  updated_at: hoursAgo(1),
  observed_at: hoursAgo(1),
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

const vocabulary: QueryVocabulary = {
  owners: [{ value: "eikona", label: "Eikona" }, { value: "sonora", label: "Sonora" }],
  connections: [{ value: "eikona-main", label: "Eikona · 图像生产" }],
  families: [{ value: "run", label: "生成运行" }, { value: "render", label: "配音合成" }],
};

const filters = (patch: Partial<TaskFilters> = {}): TaskFilters => ({ text: "", connection: "", owner: "", project: "", state: "", family: "", modality: "", results: "", prompt: "", from: "", through: "", ...patch });

const rows = [
  task("eikona", "雨夜街景 · 广角", { state: "failed" }),
  task("eikona", "站台 · 雨停", { state: "failed", episode_ref: "ep-01" }),
  task("eikona", "海报 · 草图", { state: "running", results: [{ ref: "r1", name: "a.png", mime: "image/png", bytes: 1, state: "ready" }] as TaskSnapshot["results"] }),
  task("sonora", "第 03 场 · 对白", { state: "failed", updated_at: hoursAgo(24 * 9) }),
  task("sonora", "配乐 · 片尾", { state: "waiting_review", locator: { owner: "sonora", instance_id: "i", project: "rain-reunion", task_family: "render", task_ref: "配乐 · 片尾" } }),
];

describe("task query: parsing", () => {
  it("reads clauses, phrases, exclusions and negated clauses, in Chinese or English keys, with full-width colons", () => {
    const parsed = parseTaskQuery('状态:失败 tool：eikona -雨 "雨夜 街口" -状态:完成 有结果 random');
    expect(parsed.clauses.map((clause) => [clause.key, clause.values, clause.negated])).toEqual([["state", ["失败"], false], ["owner", ["eikona"], false], ["state", ["完成"], true], ["results", ["有"], false]]);
    expect(parsed.terms).toEqual(["雨夜 街口", "random"]);
    expect(parsed.excluded).toEqual(["雨"]);
    // A clause still being typed is not a word to search for.
    expect(parseTaskQuery("-雨 更新:")).toEqual({ clauses: [], terms: [], excluded: ["雨"] });
  });

  it("moves readable clauses into the filter parameters and leaves the rest in the box", () => {
    const current = new URLSearchParams("state=running");
    const out = extractTaskQuery("状态:失败 工具:Eikona 类型:图片 -雨 集:ep-01 更新:7天 排序:最新 状态:飞走了", current, vocabulary, now);
    expect(out.params).toEqual({ state: "running,failed", owner: "eikona", kind: "image", episode: "ep-01", upd: "7d", sort: "updated:desc" });
    expect(out.rest).toBe("-雨 状态:飞走了");
  });

  it("reads 完成 as both owner spellings and 类型 as a family when it is not a media kind", () => {
    expect(extractTaskQuery("状态:完成 类型:配音合成", new URLSearchParams(), vocabulary, now).params).toEqual({ state: "succeeded,completed", family: "render" });
  });

  it("spells windows one way and labels them in words", () => {
    expect(["24h", "7天", "48小时", "today", "本周", "2026-11-01..2026-11-05", "2026-11-01..", "x", "2026-11-05..2026-11-01"].map(normalizeWindow)).toEqual(["24h", "7d", "48h", "今天", "本周", "2026-11-01..2026-11-05", "2026-11-01..", null, null]);
    expect(windowLabel("7d")).toBe("近 7 天");
    expect(windowLabel("2026-11-01..2026-11-05")).toBe("2026-11-01 至 2026-11-05");
    expect(windowBounds("24h", now)).toEqual({ from: now - 86_400_000, to: null });
    expect(windowBounds("2026-11-01..2026-11-02", now)).toEqual({ from: Date.parse("2026-11-01T00:00:00Z"), to: Date.parse("2026-11-03T00:00:00Z") });
  });

  it("turns 创建 into the date filter's from and to", () => {
    expect(createdRange("2026-11-01..2026-11-05", now)).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(createdRange("2026-11-03", now)).toEqual({ from: "2026-11-03", to: "2026-11-03" });
    expect(createdRange("today", now)?.from).toMatch(/^2026-11-0[56]$/);
    expect(extractTaskQuery("创建:2026-11-01..2026-11-05", new URLSearchParams(), vocabulary, now).params).toEqual({ from: "2026-11-01", to: "2026-11-05" });
  });
});

describe("task query: filtering", () => {
  it("keeps the old filters working for callers that pass none of the new fields", () => {
    expect(filterTasks(rows, filters({ owner: "sonora" })).map((row) => row.title)).toEqual(["第 03 场 · 对白", "配乐 · 片尾"]);
    expect(filterTasks(rows, filters({ text: "站台" })).map((row) => row.title)).toEqual(["站台 · 雨停"]);
  });

  it("excludes words and negated clauses, and filters by episode, kind and updated window", () => {
    const compiled = (patch: Partial<TaskFilters>) => rows.filter((row) => compileTaskFilters(filters(patch), { vocabulary, now }).matches(row)).map((row) => row.title);
    expect(compiled({ state: "failed", owner: "eikona", text: "-雨" })).toEqual([]);
    expect(compiled({ state: "failed", owner: "eikona", text: "-街景" })).toEqual(["站台 · 雨停"]);
    expect(compiled({ text: "-状态:失败" })).toEqual(["海报 · 草图", "配乐 · 片尾"]);
    expect(compiled({ episode: "ep-01" })).toEqual(["站台 · 雨停"]);
    expect(compiled({ modality: "image", results: "yes" })).toEqual(["海报 · 草图"]);
    expect(compiled({ updated: "7d", state: "failed" })).toEqual(["雨夜街景 · 广角", "站台 · 雨停"]);
    expect(compiled({ text: '"街景 · 广"' })).toEqual(["雨夜街景 · 广角"]);
  });

  it("never matches letters scattered apart in a list filter", () => {
    expect(filterTasks(rows, filters({ text: "雨角" }))).toEqual([]);
  });

  it("can leave one filter out, for the counts beside that filter", () => {
    const compiled = compileTaskFilters(filters({ state: "failed", owner: "eikona" }), { vocabulary, now });
    expect(rows.filter((row) => compiled.matches(row, "state")).length).toBe(3);
    expect(rows.filter((row) => compiled.matches(row, "owner")).length).toBe(3);
  });

  it("ranks the best match first when words are typed: the full title wins", () => {
    const list = [task("eikona", "站台 · 雨停 · 远景"), task("eikona", "雨停"), task("eikona", "夜里 · 雨停了")];
    const compiled = compileTaskFilters(filters({ text: "雨停" }), { vocabulary, now });
    expect(rankByQuery(list.filter((row) => compiled.matches(row)), compiled).map((row) => row.title)).toEqual(["雨停", "站台 · 雨停 · 远景", "夜里 · 雨停了"]);
  });
});
