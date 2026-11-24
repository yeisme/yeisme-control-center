import { describe, expect, it } from "vitest";
import * as briefModule from "../src/shared/agent-brief";
import { buildAgentBrief, formatCall, renderBriefText, type AgentBrief } from "../src/shared/agent-brief";
import { buildProductionLine, productionStations, type ProductionLine } from "../src/shared/production-line";
import type { WorkQueueItem } from "../src/shared/work-queue";
import type { TaskSnapshot } from "../src/task-observation";

const now = "2026-11-06T08:00:00.000Z";
const line: ProductionLine = buildProductionLine({
  scope: "fixture-a",
  now,
  range: { kind: "episode", episode_ref: "ep-01", scaena_episode_ref: "episode:01", title: "第 1 集 · 雨停站台" },
  detail: null,
  tasks: [],
  tasksReadable: true,
  connections: [],
});
const shots = [
  { shot_ref: "sc-1-sh1", order: 1, shot_size: "close_up", camera_angle: "eye_level", camera_movement: "push_in", duration_ms: 4000, frame_state: "pending" as const },
  { shot_ref: "sc-1-sh2", order: 2, shot_size: "wide", duration_ms: 3000, frame_state: "ready" as const },
];
const station = (id: (typeof productionStations)[number], extra: Partial<Extract<Parameters<typeof buildAgentBrief>[0], { kind: "station" }>> = {}) =>
  buildAgentBrief({ kind: "station", line, station: id, returnTo: "#/drama?studio=ep-01", shots, ...extra });

const item = (patch: Partial<WorkQueueItem>): WorkQueueItem => ({
  work_ref: "w1", kind: "task_unknown", owner: "scaena", project: "rain-reunion", scope_id: "fixture-a", title: "旧车站 · 重逢镜头视频", state: "unknown", native_state: "unknown",
  priority: "critical", attention_reason: "上传中断", observed_at: now, freshness: "fresh", coverage: "complete", revision: "1", source_ref: "deleg-0412", task_ref: "deleg-0412",
  safe_links: [], allowed_actions: [], preview_state: "not_applicable", ...patch,
});

/** Anything that would let a pasted brief reach a machine or a secret on its own. */
const leaks = /https?:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|localhost|:\d{4,5}\b|Bearer|[A-Za-z_]*TOKEN|\.key\b|yk_live|password/i;

function calls(brief: AgentBrief) {
  return brief.steps.flatMap((step) => step.call ? [step.call] : []);
}

describe("agent brief: stations", () => {
  it("builds a brief for every station with the fixed rules and a way back", () => {
    for (const id of productionStations) {
      const brief = station(id);
      expect(brief.schema_version).toBe("yeisme.agent_brief.v1");
      expect(brief.context).toMatchObject({ scope: "fixture-a", episode_ref: "ep-01", scaena_episode_ref: "episode:01", station: id });
      expect(brief.guardrails.join("\n")).toContain("不要猜");
      expect(brief.guardrails.join("\n")).toContain("只回查原操作");
      expect(brief.return_to).toBe("#/drama?studio=ep-01");
      expect(renderBriefText(brief)).not.toMatch(leaks);
    }
  });

  it("stops every paid step at a dry run or a prepared call, and says a person confirms", () => {
    for (const id of ["look", "frames", "motion", "sound"] as const) {
      const brief = station(id);
      expect(brief.human_confirm_required, id).toBe(true);
      expect(brief.guardrails[0]).toContain("等我确认后再提交");
      for (const call of calls(brief)) {
        if (call.action === "generate") expect(call.args.execution_mode).toBe("dry_run");
        expect(JSON.stringify(call.args)).not.toMatch(/"confirmed":true|"confirm_external_call":true|"confirm_unknown_price":true/);
      }
    }
    for (const id of ["story", "board", "cut"] as const) expect(station(id).human_confirm_required, id).toBe(false);
  });

  it("asks only for shots that have no keyframe yet, described in the page's words", () => {
    const brief = station("frames");
    const text = renderBriefText(brief);
    expect(text).toContain("还没有绑定画面的 1 个镜头");
    expect(text).toContain("镜头 sc-1-sh1：近景 · 平视 · 推 · 4 秒");
    expect(text).not.toContain("sc-1-sh2：");
  });

  it("reuses the read-only owner commands the server built, and never a person's link", () => {
    const links = [
      { kind: "owner" as const, label: "打开 Auctra", target: "auctra" as const, command: "auctra screenplay workspace --project 'rain-reunion' --json" },
      { kind: "owner" as const, label: "打开 MuWeave", target: "muweave" as const },
    ];
    const brief = station("story", { links });
    expect(brief.steps).toEqual([expect.objectContaining({ mode: "read", command: "auctra screenplay workspace --project 'rain-reunion' --json" })]);
    expect(brief.tools).toEqual([]);
    expect(renderBriefText(brief)).toContain("   命令：auctra screenplay workspace --project 'rain-reunion' --json");
  });

  it("writes MCP calls the way the guide recorded them", () => {
    const describe = calls(station("frames")).find((call) => call.action === "actions.describe")!;
    expect(formatCall(describe)).toBe('eikona.execute {"action":"actions.describe","args":{"action":"generate"}}');
    expect(formatCall({ tool: "eikona.search", action: "search", args: { query: "<要找的动作>" } })).toBe('eikona.search {"query":"<要找的动作>"}');
  });

  it("describes a single shot with its scene heading and refs", () => {
    const brief = buildAgentBrief({ kind: "shot", line, shot: { ...shots[0], scene_ref: "sc-1", heading: "站台 · 雨停" }, returnTo: "#/drama?studio=ep-01" });
    expect(brief.context).toMatchObject({ scene_ref: "sc-1", shot_ref: "sc-1-sh1", shot: "站台 · 雨停 · 近景 · 平视 · 推 · 4 秒" });
    expect(brief.context.refs).toEqual(["ep-01", "sc-1", "sc-1-sh1"]);
    expect(brief.title).toContain("sc-1-sh1");
  });
});

describe("agent brief: work items and tasks", () => {
  it("reconciles an unknown outcome without resubmitting and without spending", () => {
    const brief = buildAgentBrief({ kind: "work_item", item: item({}), returnTo: "#/?work_item=w1" });
    expect(brief.steps.map((step) => step.mode)).toEqual(["discover", "reconcile"]);
    expect(brief.human_confirm_required).toBe(false);
    expect(brief.tools).toEqual(["scaena"]);
  });

  it("treats a retry as a person's paid decision and a credential problem as nothing an agent may change", () => {
    expect(buildAgentBrief({ kind: "work_item", item: item({ kind: "task_failure", state: "failed" }), returnTo: "#/" }).human_confirm_required).toBe(true);
    const credential = buildAgentBrief({ kind: "work_item", item: item({ kind: "credential_renewal", owner: "gateway", title: "MCP Gateway · 凭据被拒" }), returnTo: "#/services" });
    expect(credential.tools).toEqual([]);
    expect(credential.goal).toContain("不要签发或修改任何凭据");
  });

  it("uses the control-center scope for a task, not the owner's project", () => {
    const task = { schema_version: "yeisme.task_observation.v1", locator: { owner: "eikona", instance_id: "i", project: "rain-reunion", task_family: "run", task_ref: "run-1" }, title: "站台 · 人群背景", state: "waiting_review", native_state: "", stage: "", revision: "1", created_at: now, updated_at: now, observed_at: now, started_at: null, progress: { kind: "indeterminate", completed: null, total: null, percent: null }, source: "", actor: null, parent_ref: null, results: [], allowed_actions: [], coverage: "complete" } as TaskSnapshot;
    const brief = buildAgentBrief({ kind: "task", task, scope: "fixture-a", returnTo: "#/tasks" });
    expect(brief.context).toMatchObject({ scope: "fixture-a", project_ref: "rain-reunion", task_ref: "run-1" });
    expect(brief.goal).toContain("不要替我采用");
  });
});

describe("agent brief: one text for any agent", () => {
  it("offers only the Chinese text: no command or JSON form is left to copy", () => {
    expect(Object.keys(briefModule).filter((name) => /command|json|shell/i.test(name))).toEqual([]);
  });

  it("ends with where to look, in words, and never an address", () => {
    const frames = renderBriefText(station("frames"));
    expect(frames.trimEnd().split("\n").at(-1)).toBe("结果会出现在 Yeisme Studio：剧集「第 1 集 · 雨停站台」 → 制作线 · 画面");
    expect(frames).not.toContain("#/");
    const shot = buildAgentBrief({ kind: "shot", line, shot: { ...shots[0], scene_ref: "sc-1" }, returnTo: "#/drama?studio=ep-01" });
    expect(shot.return_label).toBe("剧集「第 1 集 · 雨停站台」 → 镜头板 · 镜头 sc-1-sh1");
    expect(buildAgentBrief({ kind: "work_item", item: item({}), returnTo: "#/?work_item=w1" }).return_label).toBe("今天 → 全部待办 · 「旧车站 · 重逢镜头视频」");
    const untitled = buildProductionLine({ scope: "s", now, range: { kind: "episode", episode_ref: "ep-9" }, detail: null, tasks: [], tasksReadable: true, connections: [] });
    expect(buildAgentBrief({ kind: "station", line: untitled, station: "sound", returnTo: "#/drama" }).return_label).toBe("剧集 ep-9 → 制作线 · 声音");
  });

  it("keeps its line breaks and names the MCP tools the steps use", () => {
    const text = renderBriefText(station("frames"));
    expect(text.split("\n").length).toBeGreaterThan(12);
    expect(text).toContain("- 要用到的 MCP 工具：eikona");
    expect(text).not.toMatch(leaks);
  });
});
