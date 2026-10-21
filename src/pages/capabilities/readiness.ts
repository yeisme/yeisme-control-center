import type { ProviderReadiness } from "../../shared/api/control-center-client";
import type { Tone } from "../../components/ui";

export const readinessMeta: Record<ProviderReadiness, { label: string; tone: Tone; body: string }> = {
  observed: { label: "已观察", tone: "success", body: "近期观察到真实调用结果。" },
  configured: { label: "能力已发现", tone: "success", body: "owner 能力目录可读；提交仍受独立提交门控制。" },
  needs_configuration: { label: "凭据或下游未就绪", tone: "warning", body: "已登记，但凭据、binding 或下游能力尚未就绪。" },
  needs_contract: { label: "待合同", tone: "review", body: "只有目录信息，缺少能力合同，不显示为可调用。" },
  forbidden: { label: "无权限", tone: "danger", body: "当前身份不能读取该能力。" },
  unavailable: { label: "不可用", tone: "danger", body: "发现过程失败或超时。" },
  stale: { label: "数据过期", tone: "warning", body: "最近一次发现失败，显示的是上次成功的结果。" },
};
