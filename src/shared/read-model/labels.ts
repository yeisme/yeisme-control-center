import type { ActionAvailability, CatalogCoverageState, CatalogEntryKind, CatalogFreshness, ChannelStatus, ModelSnapshotStatus, RiskTier } from "../tool-catalog";
import type { Tone } from "../../components/ui/Status";

/** One place that turns owner/catalog enums into user-facing Chinese; raw codes are never rendered. */
export const modelStatusLabels: Record<ModelSnapshotStatus, string> = {
  latest_ready: "最新可用",
  latest_unverified: "最新·未验证",
  unavailable: "不可用",
  historical: "历史模型",
  drifted: "已漂移",
  unknown_cost: "成本未知",
  unknown: "状态未声明",
};
export const modelStatusTone: Record<ModelSnapshotStatus, Tone> = {
  latest_ready: "success",
  latest_unverified: "info",
  unavailable: "danger",
  historical: "neutral",
  drifted: "warning",
  unknown_cost: "warning",
  unknown: "neutral",
};

export const riskLabels: Record<RiskTier, string> = {
  read_only: "只读",
  remote_query: "远程查询",
  mutation: "写入",
  paid_external: "付费外部调用",
  human_gate: "人工门",
  unknown: "风险未声明",
};
export const riskTone: Record<RiskTier, Tone> = {
  read_only: "success",
  remote_query: "info",
  mutation: "warning",
  paid_external: "danger",
  human_gate: "review",
  unknown: "neutral",
};

export const availabilityLabels: Record<ActionAvailability, string> = {
  available: "可用",
  blocked: "阻塞",
  unavailable: "不可用",
  planned: "规划中",
  unknown: "未验证",
};
export const availabilityTone: Record<ActionAvailability, Tone> = {
  available: "success",
  blocked: "warning",
  unavailable: "danger",
  planned: "review",
  unknown: "neutral",
};

export const catalogCoverageLabels: Record<CatalogCoverageState, string> = {
  readable: "可读",
  partial: "部分可读",
  forbidden: "无权限",
  needs_contract: "待接入",
  unavailable: "不可用",
  not_configured: "未配置",
};
export const catalogCoverageTone: Record<CatalogCoverageState, Tone> = {
  readable: "success",
  partial: "info",
  forbidden: "danger",
  needs_contract: "review",
  unavailable: "warning",
  not_configured: "neutral",
};

export const freshnessLabels: Record<CatalogFreshness, string> = { fresh: "最新观察", stale: "数据已过期", unknown: "未观察" };
export const channelStatusLabels: Record<ChannelStatus, string> = { ready: "就绪", blocked: "阻塞", unknown: "未观察" };
export const channelStatusTone: Record<ChannelStatus, Tone> = { ready: "success", blocked: "warning", unknown: "neutral" };
export const entryKindLabels: Record<CatalogEntryKind, string> = { server: "服务", tool: "工具", action: "动作", model: "模型", channel: "渠道" };
export const changeLabels = { added: "新增", changed: "已变更", removed: "已移除" } as const;
export const changeTone: Record<keyof typeof changeLabels, Tone> = { added: "success", changed: "info", removed: "neutral" };
export const laneLabels: Record<string, string> = { readonly: "只读通道", mutation: "写入通道", gated: "受控通道", consumer: "消费方", operator: "运营方" };
export const domainLabels: Record<string, string> = { voice: "配音", music: "音乐", "music.yue2": "音乐 · YuE2 自托管", lipsync: "口型同步", tts: "语音合成" };

const reasonLabels: Record<string, string> = {
  operator_session_required: "需要 Aigora operator 会话；控制中心尚无只读委托合同",
  tools_read_scope_required: "需要 MCP Gateway mcp:tools:read 专用令牌",
  runtime_contract_cli_only: "Pi 运行时只提供 CLI 诊断，尚无远程只读合同",
  provider_not_configured: "控制中心尚未配置该 owner 的 Provider 连接",
  owner_execute_tool_missing: "owner 未暴露动作入口工具",
  model_snapshot_unreadable: "模型快照不可读",
  channel_summary_unreadable: "渠道摘要不可读",
  runtime_capabilities_unreadable: "运行时能力不可读",
  guide_unreadable: "视频任务指南不可读",
  discovery_unreadable: "能力发现文档不可读",
  owner_timeout: "owner 响应超时",
  owner_observation_stale: "最近一次发现失败，显示上次成功结果",
  provider_unauthorized: "owner 拒绝了当前凭据",
  provider_unavailable: "owner 暂不可达",
  provider_credential_missing: "控制中心缺少该 Provider 凭据",
  mcp_access_denied: "当前凭据无权读取",
  mcp_resource_unsupported: "owner 当前版本未提供该资源",
  mcp_resource_not_found: "资源不存在",
  mcp_method_not_found: "owner 不支持该方法",
  upstream_unavailable: "上游不可用",
  binding_disabled: "binding 已禁用",
  global_disabled: "全局开关关闭",
};

/** Reason codes may carry a detail suffix (`model_snapshot_unreadable:mcp_access_denied`) and join several with `|`. */
export function reasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const parts = code.split("|").map((part) => {
    const [head, detail] = part.split(":", 2);
    const main = reasonLabels[head] || head.replace(/_/g, " ");
    return detail ? `${main}（${reasonLabels[detail] || detail.replace(/_/g, " ")}）` : main;
  });
  return parts.join("；");
}

export const generationModeLabels: Record<string, string> = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  image_upscale: "图像放大",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  keyframe_video: "关键帧视频",
  text_to_audio: "文生音频",
  text_to_text: "文生文本",
};

/** Binding task modes and channel capabilities owners declare in their own vocabularies. */
export const capabilityLabels: Record<string, string> = {
  ...generationModeLabels,
  text: "文生视频",
  reference: "参考生视频",
  frames: "首尾帧",
  edit: "编辑",
  extend: "续写",
  generate: "生成",
  upscale: "放大",
};

export function labelFrom(map: Record<string, string>, value: string | null | undefined, fallback = "未提供") {
  if (!value) return fallback;
  return map[value] || value;
}
