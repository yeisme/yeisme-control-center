import type { ProductionStation, ProductionStationId, StationAction, StationActor, StationDecision, StationFact, StationGap, StationState, StationTool } from "../production-line";
import { blockerLabel, dramaStageLabels } from "./drama";
import { connectionStateLabel } from "./tasks";

/** Station names a creator would use, with the owner stages each one covers as a sub-line. */
export const stationLabels: Record<ProductionStationId, { label: string; detail: string; verb: string }> = {
  story: { label: "故事", detail: "剧本 · 导演计划", verb: "写故事" },
  look: { label: "设定", detail: "角色 · 场景 · 风格", verb: "定设定" },
  board: { label: "分镜", detail: "创意分镜 · 交接 · 拆解", verb: "画分镜" },
  frames: { label: "画面", detail: "每个镜头的关键帧", verb: "出画面" },
  motion: { label: "动态", detail: "图生视频", verb: "让画面动起来" },
  sound: { label: "声音", detail: "配音 · 配乐 · 音效", verb: "配声音" },
  cut: { label: "成片", detail: "质检 · 剪辑 · 交付", verb: "出成片" },
};

export const toolNames: Record<StationTool, string> = { auctra: "Auctra", eikona: "Eikona", scaena: "Scaena", sonora: "Sonora", anatomia: "Anatomia", drivebridge: "DriveBridge" };

export type StationTone = "success" | "info" | "warning" | "danger" | "review" | "neutral";

/** The same words wherever a station shows its state; a missing contract never reads like a fault, an outage never like empty. */
export const stationStateInfo: Record<StationState, { label: string; tone: StationTone }> = {
  observed: { label: "已读到", tone: "success" },
  partial: { label: "只读到一部分", tone: "warning" },
  empty: { label: "还没有", tone: "neutral" },
  unconnected: { label: "未连接", tone: "neutral" },
  needs_contract: { label: "待接通", tone: "review" },
  unavailable: { label: "读不到", tone: "warning" },
};

export const actorLabels: Record<StationActor, string> = { human: "你来决定", agent: "可以交给 Agent" };

export const actionLabels: Record<StationAction, string> = {
  review: "去审阅",
  repair: "去处理",
  connect: "连接来源",
  pick: "去挑选",
  decide_retry: "决定要不要重试",
  reconcile: "回查结果",
  inspect: "查原因",
  draft: "起草",
  generate_quote: "出候选（先报价）",
  check: "拉片质检",
};

const reasonLabels: Record<string, string> = {
  no_task_connection: "这个范围还没有接上这个工具",
  task_source_unavailable: "任务来源读不到",
  personal_connection_required: "这个会话没有个人任务连接，读不到任务",
  reference_binding_contract_not_configured: "角色、场景和风格参考还没有读取接口",
  edit_contract_missing: "Scaena 尚未提供这一集的剪辑状态",
  review_contract_missing: "审阅状态待接通",
  delivery_contract_missing: "交付状态待接通",
  episode_link_missing: "这个工具的任务还没有标注属于哪一集，对不上这一集",
  episode_production_contract_missing: "Scaena 尚未提供这一集的制作摘要",
  delivery_episode_link_missing: "交付状态待接通：Scaena 的交付记录还没有按集标注",
  production_episode_unbound: "这一集还没有绑定 Scaena 制作集，读不到合成预览",
  assembly_unavailable: "合成预览暂时读不到",
  reference_catalog_unpublished: "Scaena 还没有开放参考库",
  reference_catalog_unavailable: "Scaena 的参考库暂时读不到",
  invalid_owner_response: "工具返回的内容对不上约定，没有采用",
  station_timing_contract_missing: "这一站不是由带计时的任务组成，耗时待接通",
  episode_timing_contract_missing: "待接通（Scaena 按集计时汇总）",
  project_scope: "按整个项目统计，不分集",
};


/** One readable reason for a station that is not fully read; owner blocker codes and connection states read the same as elsewhere. */
export function stationReason(reason: string | undefined) {
  if (!reason) return "";
  if (reasonLabels[reason]) return reasonLabels[reason];
  const connection = connectionStateLabel(reason);
  if (connection !== reason) return connection;
  return blockerLabel(reason);
}

export const gapLabels: Record<StationGap["part"], string> = {
  references: "角色、场景、风格参考",
  edit: "剪辑",
  review_adoption: "审阅采用",
  assembly: "合成预览",
  delivery: "交付",
  lip_sync: "口型同步",
  episode_link: "任务和剧集对上",
};

export const linkedByLabels: Record<NonNullable<ProductionStation["linked_by"]>, string> = {
  scaena_binding: "由 Scaena 记录的派发关联",
};

/** One line for what Eikona's review records say about the frames station; never a decision the control center made. */
export function ownerReviewText(review: NonNullable<ProductionStation["owner_review"]>): string {
  const parts: string[] = [];
  if (review.awaiting) parts.push(`${review.awaiting} 个任务待挑选`);
  if (review.decided) parts.push(`${review.decided} 个已有决定`);
  if (!review.awaiting && !review.decided && !review.unread) parts.push("没有待挑选的候选");
  const read = parts.length ? `Eikona 审阅记录：${parts.join("，")}` : "";
  const unread = review.unread ? `${review.unread} 个任务的审阅状态${review.reason === "review_observation_contract_missing" ? "待接通" : "暂时读不到"}` : "";
  return [read, unread].filter(Boolean).join("；");
}

const assemblyStatus: Record<string, string> = { none: "还没有", completed: "已生成", failed: "失败", running: "生成中", queued: "排队中", pending: "排队中", cancelled: "已取消" };

/** One line for a part Scaena reported: what it counted, in a person's words. Never says the line is finished. */
export function factText(fact: StationFact): string {
  const c = fact.counts;
  switch (fact.part) {
    case "references": {
      const usable = Math.max(0, (c.total ?? 0) - (c.disabled ?? 0));
      return `参考库（整个项目）${usable} 条可用${c.disabled ? `，${c.disabled} 条停用` : ""}${fact.truncated ? "，只数了前 200 条" : ""}`;
    }
    case "edit": return fact.status === "bound" ? `剪辑：已绑定 ${c.sessions ?? 0} 个剪辑会话` : "剪辑：这一集还没有绑定剪辑会话";
    case "review": return fact.status === "reviewed" ? `审阅：记录了 ${c.reviews ?? 0} 次${c.critical_errors ? `，${c.critical_errors} 个严重问题` : "，没有严重问题"}` : "审阅：还没有审阅记录";
    case "assembly": return `合成预览：${c.previews ?? 0} 次，最新一次${assemblyStatus[fact.status || "none"] || "状态未知"}${fact.artifact_ref ? `，最新生产产物：${fact.artifact_ref}` : ""}`;
  }
}

/** A decision in a person's words; stage decisions name the stage, task decisions the task. */
export function decisionText(decision: StationDecision): { verb: string; title: string; tone: StationTone } {
  const stage = decision.stage ? dramaStageLabels[decision.stage] : "";
  switch (decision.kind) {
    case "stage_review": return { verb: "等你确认", title: decision.title === decision.ref && stage ? stage : `${decision.title} · ${stage}`, tone: "review" };
    case "stage_repair": return { verb: "需要处理", title: decision.title === decision.ref && stage ? stage : `${decision.title} · ${stage}`, tone: "danger" };
    case "pick_result": return { verb: "等你挑选", title: decision.title, tone: "review" };
    case "failed_task": return { verb: "没做成", title: decision.title, tone: "danger" };
    case "unknown_task": return { verb: "结果未知，先回查", title: decision.title, tone: "warning" };
  }
}

/** A short line under a station's name: counts when there is something, otherwise why there is nothing. */
export function stationSummary(station: ProductionStation): string {
  const { counts } = station;
  if (station.state === "needs_contract" || station.state === "unconnected" || station.state === "unavailable") {
    return stationReason(station.reason) || stationStateInfo[station.state].label;
  }
  const parts: string[] = [];
  if (station.station === "story" || station.station === "board") {
    if (station.stages?.length) {
      parts.push(station.stages.map((stage) => `${dramaStageLabels[stage.stage]}${stageWord(stage.state)}`).join(" · "));
    } else if (counts.total) {
      parts.push(`${counts.total} 集`);
      if (counts.done) parts.push(`${counts.done} 集已通过`);
      if (counts.waiting_review) parts.push(`${counts.waiting_review} 集等你确认`);
    }
    if (station.shots) parts.push(shotLine(station.shots));
  } else {
    if (counts.total) parts.push(`${counts.total} 个结果${counts.running ? `，${counts.running} 个在跑` : ""}`);
    if (counts.waiting_review) parts.push(`${counts.waiting_review} 个等你挑`);
    if (counts.problem) parts.push(`${counts.problem} 个要处理`);
    if (station.station === "frames" && station.shots?.frames_ready !== undefined) parts.push(`${station.shots.frames_ready}/${station.shots.total} 镜已绑定画面`);
  }
  if (!parts.length) return station.state === "empty" ? "还没有" : stationStateInfo[station.state].label;
  return parts.join("，");
}

function stageWord(state: string) {
  if (state === "accepted" || state === "ready") return "已通过";
  if (state === "waiting_review") return "等你确认";
  if (state === "in_progress") return "进行中";
  if (state === "blocked") return "受阻";
  if (state === "stale") return "已过期";
  if (state === "not_started" || state === "missing") return "未开始";
  if (state === "needs_contract") return "待接通";
  if (state === "unavailable" || state === "forbidden") return "读不到";
  return "未确认";
}

export function shotLine(shots: NonNullable<ProductionStation["shots"]>) {
  const parts = [`${shots.total} 镜`];
  if (shots.generation_ready !== undefined) parts.push(`${shots.generation_ready} 镜可生成`);
  if (shots.frames_ready !== undefined) parts.push(`${shots.frames_ready} 镜已绑定画面`);
  return parts.join(" · ");
}

/** "下一步" in one phrase: who, then what. */
export function nextText(station: ProductionStation) {
  if (!station.next) return station.state === "needs_contract" ? "等工具开放接口" : "暂时没有要做的";
  return `${station.next.actor === "human" ? "你" : "Agent"}：${actionLabels[station.next.action]}`;
}

/** Time categories in words, in the order bars draw them; "unsplit" is wall time the owner did not put in any category. */
export const timeCategoryLabels = { active: "执行", queue: "排队", blocked: "受阻", human_wait: "等人", unsplit: "未细分" } as const;
