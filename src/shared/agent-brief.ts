import type { ProductionLine, ProductionStation, ProductionStationId } from "./production-line";
import type { StoryboardOutlineShot } from "./drama";
import type { WorkQueueItem, WorkQueueLink } from "./work-queue";
import type { TaskSnapshot } from "../task-observation";
import { cameraAngleLabel, cameraMovementLabel, formatShotDuration, shotSizeLabel } from "./read-model/drama";
import { stationLabels } from "./read-model/production";

/**
 * A hand-off a person copies, as one piece of Chinese text, into whatever agent they use. It only describes work: the
 * control center never runs a step.
 *
 * What it may contain is narrow on purpose: refs the page already shows, read-only commands the server built
 * (`stageOwnerLinks`), and MCP calls recorded in the guide. Anything that costs money is a dry run, or a call prepared
 * for a person to confirm. Hosts, ports, tokens and key paths never appear; values a person must choose read `<…>`.
 */
export const agentBriefSchema = "yeisme.agent_brief.v1" as const;

export type BriefTool = "auctra" | "eikona" | "scaena" | "sonora" | "anatomia";
export type BriefMode = "discover" | "read" | "dry_run" | "prepare" | "reconcile" | "report";

export interface AgentBriefStep {
  tool: BriefTool | "control-center";
  mode: BriefMode;
  say: string;
  /** An MCP call in the form the guide recorded: `<tool>.execute` with an action and its arguments. */
  call?: { tool: string; action: string; args: Record<string, unknown> };
  /** A read-only command the server built for this object; never one that writes. */
  command?: string;
}

export interface AgentBriefContext {
  scope: string;
  project_ref?: string;
  episode_ref?: string;
  scaena_episode_ref?: string;
  scene_ref?: string;
  shot_ref?: string;
  station?: ProductionStationId;
  owner?: string;
  task_ref?: string;
  /** What the shot is, in words already on the page: size, angle, movement and length. */
  shot?: string;
  /** Short safe refs the agent may look up; at most twelve, like a launch context. */
  refs: string[];
}

export interface AgentBrief {
  schema_version: typeof agentBriefSchema;
  title: string;
  goal: string;
  context: AgentBriefContext;
  /** MCP servers the agent needs. */
  tools: BriefTool[];
  steps: AgentBriefStep[];
  guardrails: string[];
  /** True when any step would cost money once confirmed; the agent stops at a quote. */
  human_confirm_required: boolean;
  acceptance: string[];
  /** Where a person looks at the outcome in Yeisme Studio (a hash route); the page links to it. */
  return_to: string;
  /** The same place in words, for the pasted text: no address ever goes to the agent. */
  return_label: string;
}

export type BriefTarget =
  | { kind: "station"; line: ProductionLine; station: ProductionStationId; links?: WorkQueueLink[]; shots?: StoryboardOutlineShot[]; returnTo: string }
  | { kind: "shot"; line: ProductionLine; shot: StoryboardOutlineShot & { scene_ref: string; heading?: string }; returnTo: string }
  | { kind: "work_item"; item: WorkQueueItem; returnTo: string }
  | { kind: "task"; task: TaskSnapshot; scope: string; returnTo: string };

const baseGuardrails = [
  "动作名和参数先用 tools/list、<工具>.search 或 actions.describe 查到再用，不要猜。",
  "不要读取、打印或保存任何密钥、令牌、凭据文件或服务地址。",
  "结果未知的操作只回查原操作，不要重新提交。",
  "只处理下面写到的项目、剧集和镜头，不要改别的。",
  "做完告诉我产物的引用（不是正文）和你建议的下一步。",
];
const paidGuardrail = "会花钱的调用只做 dry_run 或只准备参数：把报价和参数发给我，等我确认后再提交。";
/** Every rule a brief can carry, for the guide to show; a brief with no paid step leaves the last one out. */
export const briefGuardrails: readonly string[] = [...baseGuardrails, paidGuardrail];

const discover = (tool: BriefTool, say: string): AgentBriefStep => ({ tool, mode: "discover", say, call: { tool: `${tool}.search`, action: "search", args: { query: "<要找的动作>" } } });
const describe = (tool: BriefTool, action: string): AgentBriefStep => ({ tool, mode: "discover", say: `查 ${action} 的参数结构`, call: { tool: `${tool}.execute`, action: "actions.describe", args: { action } } });

/** Read-only owner commands the server already built; a URL link (MuWeave) is for a person and is not copied here. */
function commandSteps(links: WorkQueueLink[] | undefined, say: string): AgentBriefStep[] {
  return (links || []).filter((link) => link.command).slice(0, 4).map((link) => ({
    tool: (link.target === "scaena" ? "scaena" : "auctra") as BriefTool,
    mode: "read" as const,
    say,
    command: link.command,
  }));
}

export function shotWords(shot: StoryboardOutlineShot) {
  return [shotSizeLabel(shot.shot_size), cameraAngleLabel(shot.camera_angle), cameraMovementLabel(shot.camera_movement), formatShotDuration(shot.duration_ms)].filter((part) => part && part !== "—").join(" · ");
}

function rangeContext(line: ProductionLine): Omit<AgentBriefContext, "refs"> {
  return line.range.kind === "episode"
    ? { scope: line.scope, episode_ref: line.range.episode_ref, ...(line.range.scaena_episode_ref && line.range.scaena_episode_ref !== line.range.episode_ref ? { scaena_episode_ref: line.range.scaena_episode_ref } : {}) }
    : { scope: line.scope, ...(line.range.project_ref ? { project_ref: line.range.project_ref } : {}) };
}

const rangeName = (line: ProductionLine) => line.range.title ? `《${line.range.title}》` : line.range.kind === "episode" ? `剧集 ${line.range.episode_ref}` : "这个项目";

function safeRefs(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => !!value && value.length <= 200))].slice(0, 12);
}

interface StationPlan { goal: string; steps: AgentBriefStep[]; acceptance: string[]; paid: boolean; tools: BriefTool[] }

function stationPlan(station: ProductionStation, line: ProductionLine, links: WorkQueueLink[] | undefined, shots: StoryboardOutlineShot[] | undefined): StationPlan {
  const name = rangeName(line);
  switch (station.station) {
    case "story": {
      const reads = commandSteps(links, "读剧本和导演计划的当前版本与状态");
      return {
        goal: `看一下${name}的剧本和导演计划，列出需要我拍板的问题。只读，不改稿。`,
        steps: reads.length ? reads : [discover("auctra", "找到读取剧本工作区和导演计划的动作"), { tool: "auctra", mode: "read", say: "读剧本和导演计划的状态（不要导出正文）" }],
        acceptance: ["列出每个阶段的状态和版本", "列出需要我决定的问题，每条一句话"],
        paid: false,
        tools: reads.length ? [] : ["auctra"],
      };
    }
    case "look":
      return {
        goal: `为${name}整理角色、场景和风格参考：先列出已有的，再为缺的角色出定妆候选。控制中心还读不到参考，结果会作为 Eikona 的任务出现。`,
        steps: [
          describe("eikona", "generate"),
          { tool: "eikona", mode: "dry_run", say: "为每个缺参考的角色做一次 dry run，记下报价", call: { tool: "eikona.execute", action: "generate", args: { prompt: "<角色或场景的描述>", aspect: "<比例，如 3:4>", execution_mode: "dry_run" } } },
          { tool: "control-center", mode: "report", say: "把报价和你打算用的描述发给我，等我确认" },
        ],
        acceptance: ["每个角色或场景一条 dry run 报价", "没有任何真实提交"],
        paid: true,
        tools: ["eikona"],
      };
    case "board": {
      const reads = commandSteps(links, "读分镜、交接与拆解的当前版本");
      return {
        goal: `核对${name}的分镜和制作拆解：拆解是不是基于最新的剧本，有没有缺镜头或时长不对的地方。只读。`,
        steps: reads.length ? reads : [{ tool: "scaena", mode: "read", say: "读拆解状态", call: { tool: "scaena.storyboard.breakdown_status", action: "breakdown_status", args: { project: "<项目>", episode: line.range.kind === "episode" ? line.range.scaena_episode_ref || line.range.episode_ref : "<剧集>" } } }],
        acceptance: ["说明拆解对应的剧本版本是否最新", "列出有问题的镜头引用"],
        paid: false,
        tools: reads.length ? [] : ["scaena"],
      };
    }
    case "frames": {
      const missing = (shots || []).filter((shot) => shot.frame_state !== "ready").slice(0, 8);
      const review = station.counts.waiting_review > 0;
      return {
        goal: review
          ? `${name}有 ${station.counts.waiting_review} 个画面候选在等我挑：把它们按镜头整理成对比清单。`
          : `为${name}${missing.length ? `还没有绑定画面的 ${missing.length} 个镜头` : "的镜头"}出关键帧候选。先 dry run 报价，等我确认再生成。`,
        steps: review
          ? [{ tool: "eikona", mode: "read", say: "读这些候选的引用、尺寸和所属镜头（不要读正文）" }, { tool: "control-center", mode: "report", say: "按镜头分组列出候选引用，标出你觉得最合适的一张和理由" }]
          : [
            describe("eikona", "generate"),
            ...missing.slice(0, 3).map((shot): AgentBriefStep => ({ tool: "eikona", mode: "dry_run", say: `镜头 ${shot.shot_ref}：${shotWords(shot) || "按分镜描述"}`, call: { tool: "eikona.execute", action: "generate", args: { prompt: "<这个镜头的画面描述>", aspect: "<16:9>", execution_mode: "dry_run" } } })),
            ...(missing.length ? [] : [{ tool: "eikona" as const, mode: "dry_run" as const, say: "按分镜为每个镜头做一次 dry run", call: { tool: "eikona.execute", action: "generate", args: { prompt: "<镜头的画面描述>", aspect: "<16:9>", execution_mode: "dry_run" } } }]),
            { tool: "control-center", mode: "report", say: "把每个镜头的报价汇总发给我，等我确认" },
          ],
        acceptance: review ? ["每个镜头一组候选引用", "没有任何新的生成"] : ["每个镜头一条 dry run 报价", "没有任何真实提交"],
        paid: !review,
        tools: ["eikona"],
      };
    }
    case "motion":
      return {
        goal: `把${name}已经选好画面的镜头做成 4–5 秒动态预览。先准备参数和报价，等我确认再提交。`,
        steps: [
          discover("scaena", "找到图生视频预览的动作（录制里用的是 createVideoProviderTask）"),
          describe("scaena", "createVideoProviderTask"),
          { tool: "scaena", mode: "prepare", say: "用已选画面做首帧，准备参数，但不要带 confirmed 提交", call: { tool: "scaena.execute", action: "createVideoProviderTask", args: { path: { project_id: "<项目>" }, body: { duration_seconds: 5, resolution: "<720p>", ratio: "<16:9>", production_scope: "experiment", reference_upload_ref: "<已选画面>", max_cost_micro_usd: "<上限>", prompt: "<运动描述>" } } } },
          { tool: "control-center", mode: "report", say: "把参数和预计费用发给我，等我确认" },
        ],
        acceptance: ["每个镜头一份准备好的参数和预计费用", "没有任何真实提交"],
        paid: true,
        tools: ["scaena"],
      };
    case "sound":
      return {
        goal: `为${name}的台词试听配音、配乐。先查参数和报价，等我确认再渲染。`,
        steps: [
          discover("sonora", "找到试听配音和配乐的动作"),
          describe("sonora", "voice.audition"),
          { tool: "sonora", mode: "prepare", say: "准备试听参数，但不要带 confirm_external_call 提交", call: { tool: "sonora.execute", action: "voice.audition", args: { provider_id: "<提供方>", voice_model_ref: "<音色引用>", max_cost_usd: "<上限>", text: "<一句台词>" } } },
          { tool: "control-center", mode: "report", say: "把参数和预计费用发给我，等我确认" },
        ],
        acceptance: ["每句台词一份准备好的参数和预计费用", "没有任何真实提交"],
        paid: true,
        tools: ["sonora"],
      };
    case "cut":
      return {
        goal: `对${name}的粗剪做一次拉片质检：镜头切分、时长和明显的问题。剪辑、审阅采用和交付还没有接口，不在这里做。`,
        steps: [
          { tool: "anatomia", mode: "discover", say: "用 tools/list 找到拉片分析和视频问答的工具" },
          { tool: "anatomia", mode: "read", say: "对粗剪排一次拉片分析，只排队，结果由 Anatomia 的 worker 产出" },
          { tool: "control-center", mode: "report", say: "列出有问题的时间点和镜头引用" },
        ],
        acceptance: ["一份拉片分析的引用", "有问题的时间点清单"],
        paid: false,
        tools: ["anatomia"],
      };
  }
}

const ownerTools = new Set<string>(["auctra", "eikona", "scaena", "sonora", "anatomia"]);
const toolOf = (owner: string): BriefTool | null => ownerTools.has(owner) ? owner as BriefTool : null;

function finish(input: { title: string; goal: string; context: AgentBriefContext; steps: AgentBriefStep[]; acceptance: string[]; paid: boolean; tools: BriefTool[]; returnTo: string; returnLabel: string }): AgentBrief {
  return {
    schema_version: agentBriefSchema,
    title: input.title,
    goal: input.goal,
    context: input.context,
    tools: [...new Set(input.tools)],
    steps: input.steps,
    guardrails: input.paid ? [paidGuardrail, ...baseGuardrails] : baseGuardrails,
    human_confirm_required: input.paid,
    acceptance: input.acceptance,
    return_to: input.returnTo,
    return_label: input.returnLabel,
  };
}

/** Where the work lives, the way the page names it: 剧集「…」 or the project's own name. */
function placeName(line: ProductionLine) {
  if (line.range.kind === "episode") return line.range.title ? `剧集「${line.range.title}」` : `剧集 ${line.range.episode_ref}`;
  return line.range.title ? `项目「${line.range.title}」` : "剧集制作 · 整个项目";
}

function itemPlan(item: WorkQueueItem): Pick<StationPlan, "goal" | "steps" | "acceptance" | "paid"> {
  const tool = toolOf(item.owner);
  const reads = commandSteps(item.safe_links, "读这一项在来源里的当前状态");
  const name = `「${item.title}」`;
  switch (item.kind) {
    case "task_unknown":
      return { goal: `${name}的结果未知。回查原操作，告诉我它到底成功了没有。不要重新提交。`, steps: [...(tool ? [discover(tool, "找到按引用查询原操作的动作")] : []), { tool: tool || "control-center", mode: "reconcile", say: `按引用 ${item.task_ref || item.source_ref} 查询原操作的状态和产物` }], acceptance: ["原操作的最终状态", "如果有产物，给出产物引用"], paid: false };
    case "task_failure":
    case "operation_failure":
      return { goal: `${name}没做成。查清原因，给出重试建议和预计费用，等我决定，不要直接重试。`, steps: [...(tool ? [discover(tool, "找到查询失败原因的动作")] : []), { tool: tool || "control-center", mode: "read", say: `读 ${item.task_ref || item.source_ref} 的错误码和阶段` }, { tool: "control-center", mode: "report", say: "一句话说明原因，附重试要改什么和预计费用" }], acceptance: ["失败原因", "重试建议与预计费用"], paid: true };
    case "review_required":
      return { goal: `${name}在等我挑。把候选整理成对比清单，标出你的推荐和理由。不要替我采用。`, steps: [{ tool: tool || "control-center", mode: "read", say: "读候选的引用、尺寸和版本" }, { tool: "control-center", mode: "report", say: "列出候选引用和你的推荐" }], acceptance: ["候选清单", "推荐与理由"], paid: false };
    case "handoff_ready":
      return { goal: `${name}可以交给下一站了。读一下交接内容，确认没有缺项。只读。`, steps: reads.length ? reads : [{ tool: tool || "control-center", mode: "read", say: "读交接的版本与引用" }], acceptance: ["交接是否完整", "缺项清单"], paid: false };
    default:
      return { goal: `${name}：${item.attention_reason || "需要看一下"}。查清是哪里没接上，告诉我需要谁做什么。不要签发或修改任何凭据。`, steps: [{ tool: "control-center", mode: "read", say: "读这个连接或工具的状态" }, { tool: "control-center", mode: "report", say: "说明原因和需要谁来处理" }], acceptance: ["原因", "需要谁做什么"], paid: false };
  }
}

function taskPlan(task: TaskSnapshot): Pick<StationPlan, "goal" | "steps" | "acceptance" | "paid"> {
  const tool = toolOf(task.locator.owner);
  const name = `「${task.title}」`;
  if (task.state === "unknown") return { goal: `${name}的结果未知。回查原操作，不要重新提交。`, steps: [...(tool ? [discover(tool, "找到按引用查询原操作的动作")] : []), { tool: tool || "control-center", mode: "reconcile", say: `按引用 ${task.locator.task_ref} 查询原操作` }], acceptance: ["原操作的最终状态"], paid: false };
  if (["failed", "partial_failed", "rejected"].includes(task.state)) return { goal: `${name}没做成。查原因并给出重试建议和报价，等我决定。`, steps: [...(tool ? [discover(tool, "找到查询失败原因的动作")] : []), { tool: "control-center", mode: "report", say: "原因、重试要改什么、预计费用" }], acceptance: ["失败原因", "重试建议与预计费用"], paid: true };
  if (task.state === "waiting_review") return { goal: `${name}在等我挑。整理候选和你的推荐，不要替我采用。`, steps: [{ tool: tool || "control-center", mode: "read", say: "读候选引用与尺寸" }, { tool: "control-center", mode: "report", say: "候选清单与推荐" }], acceptance: ["候选清单", "推荐与理由"], paid: false };
  return { goal: `看一下${name}现在到哪了，有产物就列出引用。只读。`, steps: [{ tool: tool || "control-center", mode: "read", say: `读 ${task.locator.task_ref} 的状态与产物引用` }], acceptance: ["当前状态", "产物引用"], paid: false };
}

export function buildAgentBrief(target: BriefTarget): AgentBrief {
  if (target.kind === "station" || target.kind === "shot") {
    const line = target.line;
    const stationId: ProductionStationId = target.kind === "station" ? target.station : "frames";
    const station = line.stations.find((item) => item.station === stationId);
    if (!station) throw new Error(`unknown station ${stationId}`);
    const shots = target.kind === "shot" ? [target.shot] : target.shots;
    const plan = stationPlan(station, line, target.kind === "station" ? target.links : undefined, shots);
    const shot = target.kind === "shot" ? target.shot : undefined;
    const context: AgentBriefContext = {
      ...rangeContext(line),
      station: stationId,
      ...(shot ? { scene_ref: shot.scene_ref, shot_ref: shot.shot_ref, ...(shotWords(shot) ? { shot: [shot.heading, shotWords(shot)].filter(Boolean).join(" · ") } : {}) } : {}),
      refs: safeRefs([line.range.kind === "episode" ? line.range.episode_ref : line.range.project_ref, shot?.scene_ref, shot?.shot_ref, ...station.results.map((result) => result.artifact_ref)]),
    };
    const title = shot ? `镜头 ${shot.shot_ref} · ${stationLabels.frames.verb}` : `${stationLabels[stationId].label} · ${stationLabels[stationId].verb}`;
    const returnLabel = shot ? `${placeName(line)} → 镜头板 · 镜头 ${shot.shot_ref}` : `${placeName(line)} → 制作线 · ${stationLabels[stationId].label}`;
    return finish({ title, ...plan, context, returnTo: target.returnTo, returnLabel });
  }
  if (target.kind === "work_item") {
    const item = target.item;
    const plan = itemPlan(item);
    const tool = toolOf(item.owner);
    const context: AgentBriefContext = { scope: item.scope_id, project_ref: item.project, owner: item.owner, ...(item.task_ref ? { task_ref: item.task_ref } : {}), refs: safeRefs([item.source_ref, item.task_ref, item.operation_ref, ...(item.lineage_refs || [])]) };
    return finish({ title: item.title, ...plan, context, tools: tool ? [tool] : [], returnTo: target.returnTo, returnLabel: `今天 → 全部待办 · 「${item.title}」` });
  }
  const task = target.task;
  const plan = taskPlan(task);
  const tool = toolOf(task.locator.owner);
  const context: AgentBriefContext = { scope: target.scope, project_ref: task.locator.project, owner: task.locator.owner, task_ref: task.locator.task_ref, ...(task.episode_ref ? { episode_ref: task.episode_ref } : {}), refs: safeRefs([task.locator.task_ref, task.parent_ref || undefined, ...task.results.map((result) => result.ref)]) };
  return finish({ title: task.title, ...plan, context, tools: tool ? [tool] : [], returnTo: target.returnTo, returnLabel: `动态 → 运行 · 「${task.title}」` });
}

const contextLines: Array<[keyof AgentBriefContext, string]> = [
  ["scope", "范围"],
  ["project_ref", "项目"],
  ["episode_ref", "剧集"],
  ["scaena_episode_ref", "Scaena 里的剧集"],
  ["scene_ref", "场"],
  ["shot_ref", "镜头"],
  ["shot", "镜头内容"],
  ["owner", "工具"],
  ["task_ref", "任务"],
];
const modeWords: Record<BriefMode, string> = { discover: "先查", read: "只读", dry_run: "只试算", prepare: "只准备不提交", reconcile: "只回查", report: "汇报给我" };

/** The guide writes MCP calls as `<tool> <json>`; `.execute` takes `{action, args}`, every other tool its arguments. */
export function formatCall(call: NonNullable<AgentBriefStep["call"]>) {
  return call.tool.endsWith(".execute") ? `${call.tool} ${JSON.stringify({ action: call.action, args: call.args })}` : `${call.tool} ${JSON.stringify(call.args)}`;
}

/** The brief as a prompt a person pastes into an agent. */
export function renderBriefText(brief: AgentBrief): string {
  const lines = [`你在帮我做 Yeisme 的漫剧。${brief.goal}`, "", "上下文（都是引用，不是正文）："];
  for (const [key, label] of contextLines) {
    const value = brief.context[key];
    if (typeof value === "string" && value) lines.push(`- ${label}：${value}`);
  }
  if (brief.context.refs.length) lines.push(`- 可查的引用：${brief.context.refs.join("、")}`);
  if (brief.tools.length) lines.push(`- 要用到的 MCP 工具：${brief.tools.join("、")}`);
  lines.push("", "步骤：");
  brief.steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.say}（${step.tool === "control-center" ? "不用工具" : step.tool} · ${modeWords[step.mode]}）`);
    if (step.call) lines.push(`   调用：${formatCall(step.call)}`);
    if (step.command) lines.push(`   命令：${step.command}`);
  });
  lines.push("", "规则：", ...brief.guardrails.map((rule) => `- ${rule}`));
  lines.push("", "做完的标准：", ...brief.acceptance.map((item) => `- ${item}`));
  lines.push("", `结果会出现在 Yeisme Studio：${brief.return_label}`);
  return lines.join("\n");
}
