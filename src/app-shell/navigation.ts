export type WorkspacePage =
  | "home"
  | "projects"
  | "creation"
  | "assets"
  | "tasks"
  | "reminders"
  | "requests"
  | "review"
  | "services"
  | "capabilities"
  | "usage"
  | "team";

export interface NavItem {
  id: WorkspacePage;
  label: string;
  group: "创作空间" | "生产协作" | "资源运营" | "团队";
  description: string;
}

export const navItems: NavItem[] = [
  { id: "home", label: "工作台", group: "创作空间", description: "需要处理的事项、服务状态和最近结果" },
  { id: "projects", label: "项目", group: "创作空间", description: "授权范围与 owner 项目连接" },
  { id: "creation", label: "AI 创作", group: "创作空间", description: "能力、参数合同与预算预检" },
  { id: "assets", label: "资源库", group: "创作空间", description: "任务结果、内容权限和逐结果预览" },
  { id: "tasks", label: "任务中心", group: "生产协作", description: "机器执行状态、事件和原任务恢复" },
  { id: "reminders", label: "提醒中心", group: "生产协作", description: "失败提醒、确认、免提醒和本地归档" },
  { id: "requests", label: "请求记录", group: "生产协作", description: "按来源分批的请求、汇总和按需内容" },
  { id: "review", label: "审阅与交付", group: "生产协作", description: "待审阅结果与交付合同状态" },
  { id: "services", label: "服务与连接", group: "资源运营", description: "服务目录、连接五维状态和观测新鲜度" },
  { id: "capabilities", label: "模型与工具", group: "资源运营", description: "Provider 能力、binding 与提交门" },
  { id: "usage", label: "用量与成本", group: "资源运营", description: "回执用量、成本状态与内部预算观察" },
  { id: "team", label: "团队与设置", group: "团队", description: "身份、授权范围、成员与审计" },
];

const pageIds = new Set<string>(navItems.map((item) => item.id));

const aliases: Record<string, WorkspacePage> = {
  "": "home",
  overview: "home",
  history: "tasks",
  delivery: "review",
  approvals: "review",
  provider_usage: "usage",
  members: "team",
  settings: "team",
  audit: "team",
  connections: "services",
};

export function pageFromPath(pathname: string): WorkspacePage {
  const segment = pathname.replace(/^\/+/, "").split("/")[0] || "";
  if (pageIds.has(segment)) return segment as WorkspacePage;
  return aliases[segment] || "home";
}

export function navItem(page: WorkspacePage) {
  return navItems.find((item) => item.id === page) || navItems[0];
}
