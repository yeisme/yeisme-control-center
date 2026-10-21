import type { ConnectionObservation } from "./task-observation";
// Product metadata only. Registration is not proof of deployment or authorization.
export type ServiceKind = "service" | "local_tool" | "workspace" | "design";
export interface ServiceDefinition {
  id: string;
  name: string;
  kind: ServiceKind;
  owner_path: string;
  purpose: string;
  integration: "task_observation" | "request_projection" | "collection_projection" | "not_integrated";
  gap: string;
}
export interface ServiceConnectionProjection {
  id: string;
  instance_id: string;
  label: string;
  environment: string;
  project: string;
  enabled: boolean;
  configuration: "configured" | "disabled";
  content_requested: boolean;
  cancellation_requested: boolean;
  runtime?: ConnectionObservation;
}
export interface ServiceDirectoryEntry extends ServiceDefinition {
  connections: ServiceConnectionProjection[];
  configuration: "configured" | "not_configured" | "needs_contract";
  /** Fixed literal kept for compatibility; freshness now uses coverage. */
  observation: "not_checked";
  /** Freshness: latest observation time propagated from connections/owners. */
  observed_at?: string;
  /** Aggregated read coverage for this service entry. */
  coverage?: {
    state: "complete" | "partial" | "needs_contract" | "not_recorded" | "unavailable" | "forbidden" | "stale";
    observed_at?: string;
  };
}
export interface ServiceDirectory {
  schema_version: "yeisme.service_directory.v1";
  services: ServiceDirectoryEntry[];
}
export type ControlCenterRole = "admin" | "viewer";
export interface ControlCenterSession {
  name: string;
  username?: string;
  role: ControlCenterRole;
  identity: string;
  csrf: string;
  scopes: {
    id: string;
    tenant: string;
    team: string;
    project: string;
    label: string;
    owners: string[];
    environment?: string;
  }[];
  task_connections?: boolean;
}
export const serviceDefinitions: readonly ServiceDefinition[] = [
  { id: "scaena", name: "Scaena", kind: "service", owner_path: "agent/scaena", purpose: "视频与制作任务、结果和交接", integration: "task_observation", gap: "需独立项目观测授权；媒体与有限取消另外授权。" },
  { id: "eikona", name: "Eikona", kind: "service", owner_path: "cli/eikona", purpose: "图像任务、视觉结果与审阅引用", integration: "task_observation", gap: "需独立项目观测授权；媒体与有限取消另外授权。" },
  { id: "sonora", name: "Sonora", kind: "service", owner_path: "cli/sonora", purpose: "声音任务、音频结果与权利引用", integration: "task_observation", gap: "需独立项目观测授权；媒体与有限取消另外授权。" },
  { id: "gateway", name: "个人 MCP Gateway", kind: "service", owner_path: "mcp/gateway", purpose: "个人工具目录、连接与调用事实", integration: "not_integrated", gap: "尚无控制中心适配；不复用 Agent 管理凭据。" },
  { id: "aigora", name: "Aigora", kind: "service", owner_path: "apigateway/aigora", purpose: "企业网关请求、调查与用量引用", integration: "request_projection", gap: "需独立 OIDC 用户委托；不与个人网关合并权限。" },
  { id: "drivebridge", name: "DriveBridge", kind: "service", owner_path: "cli/drivebridge", purpose: "文件空间、传输与交付引用", integration: "not_integrated", gap: "控制中心传输、容量和授权投影尚未接入。" },
  { id: "auctra", name: "Auctra", kind: "service", owner_path: "cli/auctra", purpose: "文本创作记录、候选、审阅、版本与运行证据收集", integration: "collection_projection", gap: "需要服务端 collection binding；只收集 refs、状态、摘要和时间，不保存正文。" },
  { id: "anatomia", name: "Anatomia", kind: "service", owner_path: "agent/anatomia", purpose: "拉片进度、证据覆盖与快照", integration: "not_integrated", gap: "任务和诊断投影尚未接入。" },
  { id: "pinax", name: "Pinax", kind: "local_tool", owner_path: "cli/pinax", purpose: "笔记库、索引状态与知识引用", integration: "not_integrated", gap: "远程管理 backing 未确认；不读取私有 vault。" },
  { id: "capsa", name: "Capsa", kind: "service", owner_path: "backend-server/capsa", purpose: "设备、同步积压与冲突摘要", integration: "not_integrated", gap: "只读摘要待适配；不解密用户内容。" },
  { id: "manju", name: "Manju", kind: "service", owner_path: "backend-server/manju", purpose: "项目知识与证据检索", integration: "not_integrated", gap: "当前部署及公开观测合同待核验。" },
  { id: "template-registry", name: "Template Registry", kind: "service", owner_path: "backend-server/template-registry", purpose: "模板版本、依赖与安装事实", integration: "not_integrated", gap: "版本目录投影待 typed adapter。" },
  { id: "quaestor", name: "Quaestor", kind: "local_tool", owner_path: "cli/quaestor", purpose: "研究项目、论点与实验记录", integration: "not_integrated", gap: "远程管理合同未确认。" },
  { id: "digital-human", name: "Digital Human / OpenTalking", kind: "service", owner_path: "agent/digital-human", purpose: "数字人会话、声音与运行时", integration: "not_integrated", gap: "现行 OpenTalking 与旧目录描述不同；须按当前公开合同接入。" },
  { id: "opendesign", name: "Open Design", kind: "service", owner_path: "OpenDesign MCP", purpose: "设计项目、运行与产物交接", integration: "not_integrated", gap: "设计读取已用于本次交接，浏览器用户接入未配置。" },
  { id: "solocut", name: "SoloCut", kind: "design", owner_path: "OpenDesign / solocut-agent-editor", purpose: "剪辑工作台设计", integration: "not_integrated", gap: "当前仅确认设计原型，不是已部署业务应用。" },
  { id: "layerlab", name: "LayerLab", kind: "design", owner_path: "OpenDesign / layerlab-agent-design-studio", purpose: "图层工作台设计", integration: "not_integrated", gap: "当前仅确认设计原型，不是已部署业务应用。" },
  { id: "firecrawl", name: "Firecrawl", kind: "service", owner_path: "backend-server/firecrawl", purpose: "采集任务与来源引用", integration: "not_integrated", gap: "任务、限流与审计投影尚未接入。" },
  { id: "gitea", name: "Gitea MCP", kind: "service", owner_path: "mcp/gitea-mcp", purpose: "仓库、Issue、CI 和发行事实", integration: "not_integrated", gap: "仅作工程关联；写操作保留原批准合同。" },
  { id: "blender", name: "Blender MCP", kind: "local_tool", owner_path: "mcp/blender-mcp", purpose: "连接、场景工具与任务回执", integration: "not_integrated", gap: "宿主与观测合同未接入，不建立远程 Shell。" },
  { id: "credentialctl", name: "credentialctl", kind: "local_tool", owner_path: "cli/credentialctl", purpose: "秘密来源、安全引用与就绪状态", integration: "not_integrated", gap: "只展示安全状态，不展示或复制秘密。" },
  { id: "runtime-plane", name: "Runtime Plane", kind: "local_tool", owner_path: "backend-server/client-runtime", purpose: "实验性本机 broker 状态", integration: "not_integrated", gap: "实验性工具，不作为默认远程执行入口。" },
  { id: "manju-hotlist", name: "漫剧榜单", kind: "local_tool", owner_path: "tools/manju-hotlist", purpose: "榜单快照、历史与安全导出", integration: "not_integrated", gap: "本地工具，不新增常驻服务、不恢复 Radar。" },
  { id: "server-quality-assessor", name: "Server Quality Assessor", kind: "local_tool", owner_path: "cli/server-quality-assessor", purpose: "已有质量报告与诊断证据", integration: "not_integrated", gap: "报告读取尚未适配，不自动发起压力测试。" },
  { id: "yeisme-dist", name: "Yeisme Dist", kind: "local_tool", owner_path: "cli/yeisme-dist", purpose: "发行版本与安装来源", integration: "not_integrated", gap: "版本目录待适配，不触发真实发布或升级。" },
];
