export type WorkspacePage =
  | "home"
  | "projects"
  | "drama"
  | "guide"
  | "creation"
  | "prompts"
  | "assets"
  | "activity"
  | "tasks"
  | "reminders"
  | "requests"
  | "review"
  | "services"
  | "capabilities"
  | "usage"
  | "team"
  | "admin"
  | "settings"
  | "mcp-gateway"
  | "agents";

/**
 * The places a person goes: five for making things, two for wiring and preferences. Every page belongs to exactly one;
 * the tabs inside an entry are its pages.
 */
export type NavEntryId = "today" | "projects" | "create" | "works" | "activity" | "connect" | "settings";
export type NavGroupId = "make" | "setup";

export interface NavItem {
  id: WorkspacePage;
  /** The page's full name: search results, the top bar and its visually hidden h1. */
  label: string;
  /** The tab inside its entry, in a person's words. */
  short: string;
  group: NavEntryId;
  description: string;
}

export const navItems: NavItem[] = [
  { id: "home", label: "今天", short: "今天", group: "today", description: "继续上次、等你决定的事和今天的产出" },
  { id: "projects", label: "项目", short: "项目", group: "projects", description: "每个项目的资产、产出、制作线和工具连接" },
  { id: "drama", label: "剧集制作", short: "剧集", group: "create", description: "每一集从故事到成片走到哪一站、下一步谁来做" },
  { id: "prompts", label: "提示词库", short: "配方", group: "create", description: "查看、分类和复用图片、视频与音频提示词" },
  { id: "creation", label: "批量生成", short: "批量生成", group: "create", description: "在共享项目里按固定输入成批生成图片" },
  { id: "assets", label: "作品", short: "全部作品", group: "works", description: "图片、视频、声音和文稿，逐个预览" },
  { id: "review", label: "审阅与交付", short: "待你挑选", group: "works", description: "等你挑的结果，以及交付现在能不能做" },
  { id: "activity", label: "动态", short: "时间线", group: "activity", description: "运行、提醒和请求排成一条时间线" },
  { id: "tasks", label: "任务中心", short: "运行", group: "activity", description: "正在跑的、跑完的和要回查的任务" },
  { id: "reminders", label: "提醒中心", short: "提醒", group: "activity", description: "失败提醒、确认、稍后提醒和归档" },
  { id: "requests", label: "请求记录", short: "请求", group: "activity", description: "按来源分批的请求和按需内容" },
  { id: "agents", label: "Agent 监控", short: "Agent", group: "activity", description: "活跃会话、调用链和底层遥测" },
  { id: "services", label: "服务与连接", short: "连接", group: "connect", description: "各个工具能不能读，凭据什么时候到期" },
  { id: "capabilities", label: "模型与工具", short: "模型与工具", group: "connect", description: "能用的模型、工具和提交门" },
  { id: "mcp-gateway", label: "MCP 网关", short: "网关", group: "connect", description: "网关后端、调用、审批和客户端接入" },
  { id: "usage", label: "用量与成本", short: "用量", group: "connect", description: "花了多少、预算还剩多少" },
  { id: "settings", label: "设置", short: "偏好", group: "settings", description: "外观、动效、列表、通知、快捷键和本机数据" },
  { id: "team", label: "我的账号", short: "我的账号", group: "settings", description: "你是谁、能看哪些范围，重置自己的访问 Key" },
  { id: "admin", label: "成员与管理", short: "成员与管理", group: "settings", description: "账号、组织与团队、工具成员和审计" },
  { id: "guide", label: "使用指南", short: "指南", group: "settings", description: "用 CLI、MCP 和 Agent 调用 Yeisme 的创作工具" },
];

export interface NavEntry {
  id: NavEntryId;
  label: string;
  description: string;
  /** Where the entry opens. */
  home: WorkspacePage;
  group: NavGroupId;
}

export const navEntries: NavEntry[] = [
  { id: "today", label: "今天", description: "继续上次，处理等你决定的事", home: "home", group: "make" },
  { id: "projects", label: "项目", description: "项目的资产、产出、制作线和连接", home: "projects", group: "make" },
  { id: "create", label: "剧集", description: "剧集制作线、配方和批量生成", home: "drama", group: "make" },
  { id: "works", label: "作品", description: "全部作品和待你挑选", home: "assets", group: "make" },
  { id: "activity", label: "动态", description: "时间线、运行、提醒、请求和 Agent", home: "activity", group: "make" },
  { id: "connect", label: "连接", description: "服务与连接、模型与工具、MCP 网关和用量", home: "services", group: "setup" },
  { id: "settings", label: "设置", description: "偏好、我的账号、成员与管理和指南", home: "settings", group: "setup" },
];

/** The entries a phone keeps in its capsule; the rest open from 「更多」. */
export const phoneEntries: NavEntryId[] = ["today", "projects", "works", "activity"];

/** The pages shown as tabs inside an entry, in order. */
export const entryPages = (entry: NavEntryId) => navItems.filter((item) => item.group === entry);

const pageIds = new Set<string>(navItems.map((item) => item.id));

const aliases: Record<string, WorkspacePage> = {
  "": "home",
  overview: "home",
  history: "tasks",
  delivery: "review",
  approvals: "review",
  provider_usage: "usage",
  members: "admin",
  accounts: "admin",
  preferences: "settings",
  shortcuts: "settings",
  keys: "settings",
  audit: "admin",
  connections: "services",
  episodes: "drama",
  timeline: "activity",
  series: "drama",
  help: "guide",
  docs: "guide",
  cli: "guide",
  mcp: "guide",
};

export function pageFromPath(pathname: string): WorkspacePage {
  const segment = pathname.replace(/^\/+/, "").split("/")[0] || "";
  if (pageIds.has(segment)) return segment as WorkspacePage;
  return aliases[segment] || "home";
}

export function navItem(page: WorkspacePage) {
  return navItems.find((item) => item.id === page) || navItems[0];
}

export function entryOf(page: WorkspacePage): NavEntry {
  const group = navItem(page).group;
  return navEntries.find((entry) => entry.id === group) || navEntries[0];
}
