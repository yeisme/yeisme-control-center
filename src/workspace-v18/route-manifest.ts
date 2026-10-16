import type { ProjectTab, WorkspacePage } from "./types";

export type WorkspaceRouteManifest = {
  id: WorkspacePage;
  label: string;
  group: string;
  prompt: string;
  agentTask: string;
  readContract: string;
  writeContract: string;
  unknownState: string;
};

export const workspaceRouteManifest: WorkspaceRouteManifest[] = [
  { id: "home", label: "工作台", group: "创作空间", prompt: "早上好，陈序。继续完成今天最重要的制作决策。", agentTask: "聚合项目、运行中任务、待审阅版本和最近资源，并链接到原始对象。", readContract: "项目、任务、审阅、资源投影", writeContract: "无页面级写入", unknownState: "缺少投影时显示未知，不补造数字" },
  { id: "projects", label: "项目", group: "创作空间", prompt: "围绕作品组织制作单元、成员和全部成果。", agentTask: "展示项目目录、负责人、进度、更新时间和项目深链。", readContract: "项目范围与成员投影", writeContract: "项目创建等待 owner 合同", unknownState: "缺少进度显示未记录" },
  { id: "creation", label: "AI 创作", group: "创作空间", prompt: "把想法变成下一版素材。", agentTask: "按 owner manifest 渲染能力、模型、输入、参考资源、参数和预算预检。", readContract: "能力目录、范围、授权资源", writeContract: "仅提交正式 provider-run 合同", unknownState: "未授权能力显示待合同" },
  { id: "assets", label: "资源库", group: "创作空间", prompt: "所有成果，都有来处。", agentTask: "展示资源、版本、来源任务、关联项目和权利状态，预览下载走逐结果授权。", readContract: "任务结果与媒体访问投影", writeContract: "preview/download 逐结果授权", unknownState: "未知媒体显示待核验" },
  { id: "tasks", label: "任务中心", group: "生产协作", prompt: "看见生产进度，也看见不确定性。", agentTask: "展示任务状态、执行阶段、结果完整性和来源引用；unknown 只查询原任务。", readContract: "任务观察与事件流", writeContract: "取消或对账使用原任务幂等合同", unknownState: "unknown 禁止自动重试" },
  { id: "review", label: "审阅与交付", group: "生产协作", prompt: "让团队决定，哪一版可以继续。", agentTask: "分开记录执行完成、团队审阅、正式采用和可交付事实。", readContract: "结果、版本、审阅状态", writeContract: "批准/拒绝/交付等待 owner 合同", unknownState: "缺证据不可批准" },
  { id: "capabilities", label: "模型与工具", group: "资源运营", prompt: "统一查看模型能力、MCP 连接、Tool 目录和当前接入状态。", agentTask: "聚合模型、MCP、Tool 和能力分析，区分登记、授权、可调用和实际观察。", readContract: "capabilities、services、usage", writeContract: "目录写入等待 owner 合同", unknownState: "没有数据显示未知/未记录" },
  { id: "usage", label: "用量与成本", group: "资源运营", prompt: "追踪模型、MCP、Tool 和项目的消费归因。", agentTask: "按 owner + source_ref 去重，区分 confirmed、estimated、pending、unknown。", readContract: "usage projection 与 provider receipts", writeContract: "无收费写入", unknownState: "未知金额不补零" },
  { id: "team", label: "团队与设置", group: "团队与设置", prompt: "让每个人知道自己该推进什么。", agentTask: "展示成员、业务角色、内部预算观察和系统状态，不绕过 owner 授权。", readContract: "组织与授权摘要", writeContract: "成员与配置等待正式合同", unknownState: "角色不等于正式权限" },
];

export const projectTabManifest: Record<ProjectTab, { label: string; prompt: string; agentTask: string }> = {
  overview: { label: "概览", prompt: "统一管理制作单元、资产、任务和团队决策。", agentTask: "汇总项目健康、制作进度、当前单元和待处理事项。" },
  units: { label: "制作单元", prompt: "按镜头推进作品。", agentTask: "展示制作单元、负责人、阶段、进度和当前选择。" },
  assets: { label: "资产", prompt: "这个作品引用的媒体。", agentTask: "展示项目范围内资产及版本，关联资源库而不复制资产状态。" },
  tasks: { label: "任务", prompt: "机器执行进度。", agentTask: "展示项目任务、owner、模型/模态、状态和结果引用。" },
  review: { label: "审阅", prompt: "团队决策摘要。", agentTask: "汇总待审阅、已批准、修改中和已采用版本。" },
  delivery: { label: "交付", prompt: "固定成果，准备交给下一环节。", agentTask: "只纳入明确采用的版本，保留缺失项和权限状态。" },
};

export const providerViewManifest = [
  { id: "models", label: "AI 模型", prompt: "查看模型身份、能力、约束与计量。", agentTask: "展示模型 ID、Provider、版本、模态、约束、计量和授权状态。" },
  { id: "mcp", label: "MCP 服务", prompt: "查看服务连接、协议、工具和诊断。", agentTask: "展示维护方、协议、版本、连接、授权、Tool 数量和诊断时间。" },
  { id: "tools", label: "Tool 目录", prompt: "查看工具用途、输入约束与调用权限。", agentTask: "展示所属 MCP、输入约束、调用权限、最近调用和失败状态。" },
  { id: "analysis", label: "能力分析", prompt: "查看真实调用量、成功率、延迟和失败原因。", agentTask: "只读取真实能力投影，没有数据时显示未知/未记录。" },
] as const;
