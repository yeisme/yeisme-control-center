export type Role = "admin" | "operator" | "viewer";
export type Env = "main" | "staging";
export type OperationState =
  | "queued"
  | "running"
  | "waiting_review"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";
export type Scenario =
  | "normal"
  | "offline"
  | "auth"
  | "permission"
  | "capability"
  | "stale"
  | "partial"
  | "empty"
  | "conflict"
  | "save_error";
export type Page =
  | "overview"
  | "projects"
  | "services"
  | "tasks"
  | "assets"
  | "approvals"
  | "usage"
  | "audit"
  | "settings"
  | "members";
export interface Service {
  id: string;
  name: string;
  description: string;
  group: string;
  kind: "remote" | "local" | "workspace";
  status: "healthy" | "degraded" | "needs_contract" | "local";
  version: string;
  capabilities: string[];
  gap: string;
  owner: string;
  latency: number | null;
  entry?: string;
  env?: Env;
  projectRefs?: string[];
  connectionRef?: string;
  credentialRef?: string;
}
export interface Operation {
  id: string;
  title: string;
  owner: string;
  project: string;
  env: Env;
  state: OperationState;
  native: string;
  time: string;
  reason: string;
  asset?: string;
  attempt: number;
  parent?: string;
  cost: string;
}
export interface Asset {
  id: string;
  name: string;
  owner: string;
  project: string;
  type: string;
  version: string;
  state: string;
  rights: string;
  source: string;
  image?: string;
  operation?: string;
  handoff: string;
}
export interface Approval {
  id: string;
  title: string;
  type: string;
  owner: string;
  project: string;
  detail: string;
  status: "pending" | "approved" | "rejected";
  operation?: string;
}
export const preview = (project: string) =>
  `http://10.10.1.101:7456/api/projects/${project}/raw/index.html`;
export const frameURL = preview("drama-development-center-unified");
export const services: Service[] = [
  {
    id: "scaena",
    name: "Scaena",
    description: "分镜生产、镜头视频与成片交付",
    group: "媒体生产",
    kind: "remote",
    status: "degraded",
    version: "设计实例",
    capabilities: ["生产项目", "视频任务", "原任务对账", "审阅与交付"],
    gap: "服务配置与团队授权管理需补充公开接口",
    owner: "agent/scaena",
    latency: 42,
  },
  {
    id: "eikona",
    name: "Eikona",
    description: "图像生成、候选比较与视觉资产",
    group: "媒体生产",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["图像任务", "视觉资产", "审阅与血缘", "能力发现"],
    gap: "统一配置修订与成员权限投影需补充",
    owner: "cli/eikona",
    latency: 28,
  },
  {
    id: "sonora",
    name: "Sonora",
    description: "配音、音乐、字幕与音频交接",
    group: "媒体生产",
    kind: "remote",
    status: "degraded",
    version: "设计实例",
    capabilities: ["语言计划", "渲染任务", "音频资产", "权利与交接"],
    gap: "远程配置、使用量及角色投影需补充",
    owner: "cli/sonora",
    latency: 36,
  },
  {
    id: "auctra",
    name: "Auctra",
    description: "剧本文稿、修订、审稿与定稿",
    group: "创作与研究",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["作品与修订", "审阅提案", "接受版本", "制作交接"],
    gap: "跨用户管理视图待合同确认",
    owner: "cli/auctra",
    latency: 31,
  },
  {
    id: "anatomia",
    name: "Anatomia",
    description: "原片理解、拉片分析与时序证据",
    group: "创作与研究",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["分析任务", "时序证据", "审阅快照", "来源交接"],
    gap: "服务配置与运行指标待投影",
    owner: "agent/anatomia",
    latency: 51,
  },
  {
    id: "drivebridge",
    name: "DriveBridge",
    description: "文件空间、传输与受控交付",
    group: "文件与知识",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["文件版本", "传输队列", "容量摘要", "受管范围"],
    gap: "统一授权与传输事件消费待接线",
    owner: "cli/drivebridge",
    latency: 24,
    entry: preview("drivebridge-personal-agent-workspace"),
  },
  {
    id: "pinax",
    name: "Pinax",
    description: "Markdown 知识库、索引与写入门",
    group: "文件与知识",
    kind: "local",
    status: "local",
    version: "本地工具",
    capabilities: ["库与索引状态", "笔记引用", "待审写入", "知识关系"],
    gap: "没有确认的远程管理 backing，保留本地消费者入口",
    owner: "cli/pinax",
    latency: null,
  },
  {
    id: "manju",
    name: "Manju",
    description: "主体资料、知识检索与证据包",
    group: "文件与知识",
    kind: "remote",
    status: "needs_contract",
    version: "待核验",
    capabilities: ["项目知识检索", "证据读取", "范围隔离"],
    gap: "主体资产与冻结资料包仍需对应 owner 合同",
    owner: "backend-server/manju",
    latency: null,
  },
  {
    id: "capsa",
    name: "Capsa",
    description: "加密同步、设备与冲突摘要",
    group: "文件与知识",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["同步摘要", "设备状态", "冲突引用"],
    gap: "控制中心只读摘要尚需适配",
    owner: "backend-server/capsa",
    latency: 33,
  },
  {
    id: "aigora",
    name: "Aigora",
    description: "模型与 MCP 网关、路由和访问治理",
    group: "基础服务",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["网关观测", "模型路由", "MCP 注册", "访问治理"],
    gap: "企业身份与团队治理；详细操作进入现有控制台",
    owner: "apigateway/aigora",
    latency: 17,
    entry: preview("aigora-gateway-control-room"),
  },
  {
    id: "credentialctl",
    name: "credentialctl",
    description: "凭据引用、配置状态与就绪检查",
    group: "基础服务",
    kind: "local",
    status: "local",
    version: "本地工具",
    capabilities: ["来源状态", "安全引用", "就绪检查"],
    gap: "不通过控制中心解析或展示秘密",
    owner: "cli/credentialctl",
    latency: null,
  },
  {
    id: "templates",
    name: "Template Registry",
    description: "模板版本、发行与提示资产目录",
    group: "基础服务",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["模板目录", "固定版本", "发行状态", "审计引用"],
    gap: "目录与版本消费待 typed adapter",
    owner: "backend-server/template-registry",
    latency: 22,
  },
  {
    id: "quaestor",
    name: "Quaestor",
    description: "研究论点、证据和实验备忘录",
    group: "创作与研究",
    kind: "local",
    status: "local",
    version: "本地工具",
    capabilities: ["研究项目", "证据状态", "实验记录"],
    gap: "远程管理接口未确认",
    owner: "cli/quaestor",
    latency: null,
  },
  {
    id: "digital-human",
    name: "Digital Human",
    description: "数字人会话、授权与运行预算",
    group: "创作与研究",
    kind: "remote",
    status: "needs_contract",
    version: "待核验",
    capabilities: ["会话状态", "同意状态", "预算摘要"],
    gap: "当前部署与公开管理合同需要 owner 验证",
    owner: "agent/digital-human",
    latency: null,
  },
  {
    id: "runtime",
    name: "Runtime Plane",
    description: "本机受控运行时与固定适配器",
    group: "基础服务",
    kind: "local",
    status: "local",
    version: "实验性",
    capabilities: ["运行时发现", "能力就绪", "受控执行引用"],
    gap: "实验性本机 broker，不作为默认远程执行入口",
    owner: "backend-server/client-runtime",
    latency: null,
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "搜索、抓取与来源获取",
    group: "扩展工具",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["采集任务", "来源引用", "限流摘要"],
    gap: "统一使用量与审计投影待接线",
    owner: "backend-server/firecrawl",
    latency: 56,
  },
  {
    id: "gitea",
    name: "Gitea MCP",
    description: "仓库、Issue 与交付记录",
    group: "扩展工具",
    kind: "remote",
    status: "healthy",
    version: "设计实例",
    capabilities: ["工具发现", "仓库引用", "任务关联"],
    gap: "写操作继续使用原权限与批准合同",
    owner: "mcp/gitea-mcp",
    latency: 44,
  },
  {
    id: "blender",
    name: "Blender MCP",
    description: "三维工具连接与操作回执",
    group: "扩展工具",
    kind: "local",
    status: "local",
    version: "本地工具",
    capabilities: ["连接状态", "能力发现", "场景操作引用"],
    gap: "无远程宿主即不可执行；不创建第二场景真源",
    owner: "mcp/blender-mcp",
    latency: null,
  },
  {
    id: "yeitra",
    name: "Yeitra",
    description: "三维导演、机位与空间预演",
    group: "专业工作台",
    kind: "workspace",
    status: "local",
    version: "设计工作台",
    capabilities: ["导演工作台", "固定场景交接"],
    gap: "正式三维状态归 Yeitra；此入口为原型",
    owner: "client/yeitra",
    latency: null,
    entry: preview("eb8e3406-e3b9-4ef2-bf37-abb624a1dd42"),
  },
  {
    id: "layerlab",
    name: "LayerLab",
    description: "视觉精修与图层工作台",
    group: "专业工作台",
    kind: "workspace",
    status: "local",
    version: "设计工作台",
    capabilities: ["图层工作台", "资产引用"],
    gap: "仅确认设计原型入口",
    owner: "OpenDesign / LayerLab",
    latency: null,
    entry: preview("layerlab-agent-design-studio"),
  },
  {
    id: "solocut",
    name: "SoloCut",
    description: "剪辑与成片工作台",
    group: "专业工作台",
    kind: "workspace",
    status: "local",
    version: "设计工作台",
    capabilities: ["剪辑工作台", "交付引用"],
    gap: "仅确认设计原型入口",
    owner: "OpenDesign / SoloCut",
    latency: null,
    entry: preview("solocut-agent-editor"),
  },
  {
    id: "dist",
    name: "Yeisme Dist",
    description: "发行目录、版本与安装入口",
    group: "扩展工具",
    kind: "local",
    status: "local",
    version: "发行目录",
    capabilities: ["版本目录", "发行证据"],
    gap: "控制中心不触发真实发行",
    owner: "cli/yeisme-dist",
    latency: null,
  },
  {
    id: "hotlist",
    name: "漫剧榜单",
    description: "本地榜单、历史快照与同口径比较",
    group: "扩展工具",
    kind: "local",
    status: "local",
    version: "本地工具",
    capabilities: ["榜单快照", "历史比较", "安全导出"],
    gap: "本地工具；来源持续性状态独立核验",
    owner: "tools/manju-hotlist",
    latency: null,
  },
  {
    id: "gateway-legacy",
    name: "个人 MCP Gateway",
    description: "个人内网工具目录、授权与调用记录",
    group: "基础服务",
    kind: "remote",
    status: "needs_contract",
    version: "未读取",
    capabilities: ["工具目录", "客户端授权", "调用记录"],
    gap: "独立维护的个人网关；控制中心读取合同待接入",
    owner: "mcp/gateway",
    latency: null,
  },
  {
    id: "server-quality",
    name: "Server Quality Assessor",
    description: "服务质量评估与诊断报告",
    group: "扩展工具",
    kind: "local",
    status: "local",
    version: "本地工具",
    capabilities: ["诊断报告", "质量证据"],
    gap: "仅展示已有报告，不发起压力测试",
    owner: "cli/server-quality-assessor",
    latency: null,
  },
];
export const projects = [
  {
    id: "rain",
    name: "雨夜重逢",
    type: "漫剧 · 第 01 集",
    subtitle: "从一场重逢，走向完整成片",
    owners: ["scaena", "eikona", "sonora", "auctra", "anatomia", "drivebridge"],
    image: "rain-street.jpg",
    entry: frameURL + "#/storyboard",
  },
  {
    id: "coast",
    name: "海岸来信",
    type: "声音叙事 · 第 03 期",
    subtitle: "旁白与环境声音的最后一轮审听",
    owners: ["sonora", "auctra", "drivebridge", "pinax"],
    image: "rain-window.jpg",
    entry: frameURL + "#/audio",
  },
  {
    id: "research",
    name: "创作资料库",
    type: "研究与参考 · 持续更新",
    subtitle: "把来源变成可追踪的创作证据",
    owners: ["quaestor", "pinax", "manju", "firecrawl", "templates"],
    image: "night-street.jpg",
  },
];
export const initialOperations: Operation[] = [
  {
    id: "demo:scaena:video-039",
    title: "旧车站 · 重逢镜头视频",
    owner: "scaena",
    project: "rain",
    env: "main",
    state: "unknown",
    native: "unknown_accept",
    time: "14:32",
    reason: "提交后连接中断，服务端可能已接受。先查询原请求。",
    attempt: 1,
    cost: "未知 · 待对账",
  },
  {
    id: "demo:sonora:voice-012",
    title: "林晚 · 第 01 场对白",
    owner: "sonora",
    project: "rain",
    env: "main",
    state: "failed",
    native: "rights_blocked",
    time: "14:28",
    reason: "声音使用许可需要补充，当前不可重试。",
    attempt: 1,
    cost: "未执行",
  },
  {
    id: "demo:eikona:image-086",
    title: "旧车站 · 氛围参考 v3",
    owner: "eikona",
    project: "rain",
    env: "main",
    state: "waiting_review",
    native: "review_pending",
    time: "14:26",
    reason: "两个候选已就绪，等待人工审阅。",
    asset: "demo:eikona:station-v3",
    attempt: 1,
    cost: "已确认 ¥1.28",
  },
  {
    id: "demo:anatomia:analysis-021",
    title: "参考剧集 · 时序证据分析",
    owner: "anatomia",
    project: "rain",
    env: "main",
    state: "running",
    native: "indexing",
    time: "14:21",
    reason: "正在整理镜头与声音证据，尚无可靠百分比。",
    attempt: 1,
    cost: "待结算",
  },
  {
    id: "demo:drivebridge:transfer-014",
    title: "参考素材包 · 回存文件空间",
    owner: "drivebridge",
    project: "rain",
    env: "main",
    state: "succeeded",
    native: "committed",
    time: "14:18",
    reason: "文件版本已保存，交付引用可读取。",
    asset: "demo:drivebridge:reference-pack",
    attempt: 1,
    cost: "无调用费用",
  },
  {
    id: "demo:sonora:music-019",
    title: "海岸来信 · 片尾环境音乐",
    owner: "sonora",
    project: "coast",
    env: "main",
    state: "waiting_review",
    native: "audition_pending",
    time: "14:12",
    reason: "待审听与确认用途。",
    asset: "demo:sonora:coast-audio",
    attempt: 1,
    cost: "估算 $0.12",
  },
  {
    id: "demo:firecrawl:source-008",
    title: "创作资料库 · 来源采集",
    owner: "firecrawl",
    project: "research",
    env: "main",
    state: "failed",
    native: "rate_limited",
    time: "14:09",
    reason: "来源限流。可以批准创建一次新的尝试。",
    attempt: 1,
    cost: "待结算",
  },
  {
    id: "demo:auctra:revision-006",
    title: "雨夜重逢 · 剧本修订接受",
    owner: "auctra",
    project: "rain",
    env: "main",
    state: "succeeded",
    native: "accepted",
    time: "13:58",
    reason: "接受版本已交接制作。",
    asset: "demo:auctra:script-r6",
    attempt: 1,
    cost: "已确认 $0.08",
  },
];
export const assets: Asset[] = [
  {
    id: "demo:eikona:station-v3",
    name: "旧车站 · 氛围参考",
    owner: "eikona",
    project: "rain",
    type: "图像",
    version: "v3",
    state: "待审阅",
    rights: "设计样例 · 不可正式交付",
    source: "既有片场参考摄影",
    image: "rain-street.jpg",
    operation: "demo:eikona:image-086",
    handoff: "等待 Eikona 审阅；Scaena 尚未采用",
  },
  {
    id: "demo:sonora:coast-audio",
    name: "海岸来信 · 环境音乐",
    owner: "sonora",
    project: "coast",
    type: "音频",
    version: "v2",
    state: "待审听",
    rights: "用途确认待补充",
    source: "声音计划演示对象",
    operation: "demo:sonora:music-019",
    handoff: "等待声音权利与审听通过",
  },
  {
    id: "demo:drivebridge:reference-pack",
    name: "雨夜 · 参考素材包",
    owner: "drivebridge",
    project: "rain",
    type: "文件",
    version: "v1",
    state: "可引用",
    rights: "设计样例 · 仅预览",
    source: "参考文件空间",
    image: "night-street.jpg",
    operation: "demo:drivebridge:transfer-014",
    handoff: "文件版本已固定；生产采用待确认",
  },
  {
    id: "demo:auctra:script-r6",
    name: "雨夜重逢 · 第一集剧本",
    owner: "auctra",
    project: "rain",
    type: "文稿",
    version: "r6",
    state: "已接受",
    rights: "演示文稿",
    source: "Auctra accepted revision",
    operation: "demo:auctra:revision-006",
    handoff: "Scaena 制作引用 r6",
  },
];
export const initialApprovals: Approval[] = [
  {
    id: "review-image",
    title: "旧车站 · 氛围参考 v3",
    type: "结果审阅",
    owner: "eikona",
    project: "rain",
    detail: "确认此视觉候选；不等同于 Scaena 生产采用。",
    status: "pending",
    operation: "demo:eikona:image-086",
  },
  {
    id: "rights-voice",
    title: "林晚声音 · 使用许可",
    type: "权利批准",
    owner: "sonora",
    project: "rain",
    detail: "当前缺少许可凭据，请在 Sonora 补充来源与用途。",
    status: "pending",
    operation: "demo:sonora:voice-012",
  },
  {
    id: "review-music",
    title: "海岸来信 · 片尾音乐",
    type: "结果审阅",
    owner: "sonora",
    project: "coast",
    detail: "本原型不提供真实音频，正式批准需要完整审听证据。",
    status: "pending",
    operation: "demo:sonora:music-019",
  },
  {
    id: "budget-research",
    title: "来源采集 · 新尝试预算",
    type: "费用批准",
    owner: "firecrawl",
    project: "research",
    detail: "允许一次新的尝试，演示费用上限 $0.05；原失败任务保留。",
    status: "pending",
    operation: "demo:firecrawl:source-008",
  },
];
export const labels: Record<string, string> = {
  healthy: "可用",
  degraded: "需关注",
  needs_contract: "待接入",
  local: "本地",
  queued: "排队中",
  running: "运行中",
  waiting_review: "待审阅",
  blocked: "已阻塞",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  unknown: "结果未知",
  pending: "待处理",
  approved: "已批准",
  rejected: "已拒绝",
};
export const serviceById = (id: string) => services.find((s) => s.id === id);
export const projectName = (id: string) =>
  projects.find((p) => p.id === id)?.name || "外部项目";
