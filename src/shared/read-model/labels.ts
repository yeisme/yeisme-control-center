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
  owner_cost_cap_undeclared: "owner 的生成动作没有声明费用上限（max_cost_usd），控制中心不会实际提交",
  provider_cost_cap_unsupported: "owner 不接受费用上限，没有提交",
  provider_cost_cap_unverified: "没能读到 owner 的生成动作合同，无法确认费用上限，没有提交",
  open_tool_unauthenticated: "工具不认这个凭据，可能已过期或被吊销；请在工具那边重新签发",
  open_tool_forbidden: "凭据没有读取这项的权限",
  open_tool_route_missing: "工具没有控制中心要读的接口，可能版本太旧",
  open_tool_rate_limited: "工具暂时限流，稍后自动重试",
  open_tool_unavailable: "工具返回错误",
  open_tool_unreachable: "连不上工具，或 5 秒内没有响应",
  open_tool_response_too_large: "工具的响应超过 1 MiB，已丢弃",
  open_tool_invalid_response: "工具的响应不是预期的格式",
  open_tool_credential_unreadable: "控制中心读不到凭据文件，或文件权限不是 0600",
  open_tool_endpoint_denied: "配置里的地址不被接受：要 https，私网 http 需显式允许",
  open_tool_backend_down: "后端健康检查失败",
  open_tool_attention: "有需要处理的后端或运行",
  agent_token_operations_only: "Agent 令牌只能读运行记录，看不到空间容量与文件",
  drivebridge_disabled: "DriveBridge 服务没有启用（启动时未加 --enabled）",
  resume_required: "传输中断，需要续传",
  internal_error: "工具内部错误",
  gateway_workspace_unbound: "令牌没有绑定工作区，读不到后端、运行和用量；签发时要加 --workspace",
  gateway_not_ready: "Gateway 未就绪，有后端没通过健康检查",
  gateway_backend_degraded: "有后端配置不完整或工具目录降级",
  gateway_rest_operations_only: "运行记录只含 REST 调用；MCP 调用只计入用量",
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
