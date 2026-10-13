import { initialOperations, type Operation, type Env, type Role } from "./data";

export type Perspective = "platform" | "team" | "personal";
export interface ManagementScope {
  perspective: Perspective;
  tenant: string;
  team: string;
  actor: string;
  env: Env;
  project: string;
  role: Role;
}
export const tenants = [
  { id: "studio", name: "Yeisme Studio", note: "创作与制作空间" },
  { id: "north", name: "北岸工作室", note: "独立租户 · 演示" },
];
export const teams = [
  {
    id: "production",
    tenant: "studio",
    name: "影像制作组",
    owner: "drivebridge",
    quota: 200,
    used: 76,
    unit: "GB",
  },
  {
    id: "research",
    tenant: "studio",
    name: "创作研究组",
    owner: "aigora",
    quota: 1000,
    used: 328,
    unit: "次 / 日",
  },
  {
    id: "north-production",
    tenant: "north",
    name: "影像制作组",
    owner: "yeitra",
    quota: 100,
    used: 0,
    unit: "合同待接入",
  },
];
export const demoNow = Date.parse("2026-10-03T00:00:00Z");
export const ownerNames: Record<string, string> = {
  scaena: "Scaena",
  eikona: "Eikona",
  sonora: "Sonora",
  aigora: "Aigora",
  auctra: "Auctra",
  anatomia: "Anatomia",
  drivebridge: "DriveBridge",
  firecrawl: "Firecrawl",
  yeitra: "Yeitra",
};
export const actorNames: Record<string, string> = {
  yeisme: "Yeisme",
  lin: "林晓",
  chen: "陈屿",
  xu: "许宁",
  agent: "制作 Agent",
  "north-lin": "林晓",
  "north-owner": "周予",
};
export type RequestKind = "gateway" | "generation" | "operation";
export interface RequestFact {
  id: string;
  tenant: string;
  team: string;
  actor: string;
  env: Env;
  project: string;
  projectName: string;
  title: string;
  owner: string;
  kind: RequestKind;
  modality: string;
  model: string;
  state: string;
  native: string;
  createdAt: string;
  duration: number | null;
  attempts: number;
  outputs: number;
  assetRefs: string[];
  parentRef?: string;
  chargeRef: string;
  currency: "CNY" | "USD";
  amount: number | null;
  costState: "confirmed" | "estimated" | "pending" | "unknown";
  upstream: number | null;
  reason: string;
  legacy?: string;
}
export function legacyFacts(operations: Operation[]): RequestFact[] {
  return operations.map((o, i) => ({
    id: o.id,
    legacy: o.id,
    tenant: "studio",
    team: o.project === "research" ? "research" : "production",
    actor: i % 3 === 0 ? "yeisme" : i % 3 === 1 ? "lin" : "chen",
    env: o.env,
    project: o.project,
    projectName:
      { rain: "雨夜重逢", coast: "海岸来信", research: "创作资料库" }[
        o.project
      ] || o.project,
    title: o.title,
    owner: o.owner,
    kind: ["scaena", "eikona", "sonora", "auctra"].includes(o.owner)
      ? "generation"
      : "operation",
    modality:
      { scaena: "视频", eikona: "图像", sonora: "音频", auctra: "文稿" }[
        o.owner
      ] || "业务操作",
    model: "owner 配置",
    state: o.state,
    native: o.native,
    createdAt: `2026-10-02T${o.time}:00+08:00`,
    duration: o.state === "succeeded" ? 120 + i * 13 : null,
    attempts: o.attempt,
    outputs: o.asset ? 1 : 0,
    assetRefs: o.asset ? [o.asset] : [],
    parentRef: o.parent,
    chargeRef: `demo:charge:${o.id}`,
    currency: "CNY",
    amount: null,
    costState: "unknown",
    upstream: null,
    reason: o.reason,
  }));
}
const variants = [
  ["eikona", "generation", "图像", "雨夜车站 · 场景参考", "image-profile"],
  ["scaena", "generation", "视频", "雨夜重逢 · 镜头生成", "video-profile"],
  ["sonora", "generation", "音频", "第 03 场 · 对白制作", "voice-profile"],
  ["aigora", "gateway", "模型调用", "分镜规划 · 模型请求", "text-profile"],
  ["auctra", "generation", "文稿", "海岸来信 · 剧本修订", "text-profile"],
  ["anatomia", "operation", "分析", "参考片 · 时序分析", "analysis-profile"],
  ["drivebridge", "operation", "传输", "镜头素材 · 文件回存", "—"],
  ["aigora", "gateway", "MCP 调用", "资料搜索 · MCP 请求", "mcp.search"],
];
export const requestFixtures: RequestFact[] = Array.from(
  { length: 280 },
  (_, i) => {
    const [owner, kind, modality, title, model] = variants[i % variants.length];
    const north = i % 5 === 0,
      state =
        i % 19 === 0
          ? "unknown"
          : i % 13 === 0
            ? "running"
            : i % 11 === 0
              ? "cancelled"
              : i % 7 === 0
                ? "failed"
                : "succeeded";
    const project = i % 8 === 4 ? "coast" : i % 8 === 5 ? "research" : "rain";
    const costState =
      i % 17 === 0
        ? "unknown"
        : i % 11 === 0
          ? "pending"
          : i % 9 === 0
            ? "estimated"
            : "confirmed";
    const outputs =
      kind === "generation" && state === "succeeded"
        ? owner === "eikona"
          ? 4
          : 1
        : 0;
    return {
      id: `demo:${owner}:request-${String(i + 1).padStart(4, "0")}`,
      tenant: north ? "north" : "studio",
      team: north
        ? "north-production"
        : project === "research"
          ? "research"
          : "production",
      actor: north
        ? i % 2
          ? "north-lin"
          : "north-owner"
        : ["yeisme", "lin", "chen", "xu", "agent"][Math.floor(i / 5) % 5],
      env: i % 23 === 0 ? "staging" : "main",
      project: north ? "north-rain" : project,
      projectName: north
        ? "雨夜重逢"
        : { rain: "雨夜重逢", coast: "海岸来信", research: "创作资料库" }[
            project
          ]!,
      title,
      owner,
      kind: kind as RequestKind,
      modality,
      model,
      state,
      native:
        state === "failed"
          ? "rate_limited"
          : state === "unknown"
            ? "awaiting_provider_result"
            : state,
      createdAt: new Date(demoNow - 3600000 - i * 3600000).toISOString(),
      duration: ["succeeded", "failed"].includes(state)
        ? owner === "scaena"
          ? 140 + (i % 260)
          : owner === "aigora"
            ? 1 + (i % 8)
            : 12 + (i % 81)
        : null,
      attempts: state === "succeeded" && i % 6 === 0 ? 2 : 1,
      outputs,
      assetRefs: Array.from(
        { length: outputs },
        (_, j) => `demo:asset:${i + 1}-${j + 1}`,
      ),
      chargeRef: `demo:${owner}:charge-${i + 1}`,
      currency: i % 3 === 0 ? "USD" : "CNY",
      amount: ["unknown", "pending"].includes(costState)
        ? null
        : Math.round((0.07 + (i % 17) * 0.11) * 100) / 100,
      costState: costState as RequestFact["costState"],
      upstream: null,
      reason:
        state === "failed"
          ? "服务限流；查询原请求后决定是否重新生成"
          : state === "unknown"
            ? "尚未取得终态证据；查询原操作"
            : "owner 演示回执",
    };
  },
);
export function inScope(
  scope: ManagementScope,
  row: {
    tenant: string;
    team: string;
    actor?: string;
    env?: Env;
    project?: string;
  },
) {
  if (row.env && row.env !== scope.env) return false;
  if (scope.tenant !== "all" && row.tenant !== scope.tenant) return false;
  if (scope.perspective !== "platform" && scope.tenant === "all") return false;
  if (scope.team !== "all" && row.team !== scope.team) return false;
  if (scope.perspective === "personal" && row.actor !== scope.actor)
    return false;
  return (
    !row.project || scope.project === "all" || row.project === scope.project
  );
}
export interface HistoryQuery {
  inputType?: string;
  hasAttachments?: string;
  hasOutputs?: string;
  projectRef: string;
  search: string;
  owner: string;
  state: string;
  kind: string;
  actor: string;
  days: string;
  from: string;
  to: string;
}
export const defaultQuery: HistoryQuery = {
  projectRef: "all",
  search: "",
  owner: "all",
  state: "all",
  kind: "all",
  actor: "all",
  days: "7",
  from: "2026-09-26",
  to: "2026-10-03",
};
export function filterFacts(rows: RequestFact[], q: HistoryQuery) {
  const from =
    q.days === "custom"
      ? Date.parse(q.from + "T00:00:00+08:00")
      : demoNow - Number(q.days) * 86400000;
  const to =
    q.days === "custom" ? Date.parse(q.to + "T23:59:59+08:00") : demoNow;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return [];
  return rows.filter(
    (r) =>
      Date.parse(r.createdAt) >= from &&
      Date.parse(r.createdAt) <= to &&
      (q.owner === "all" || r.owner === q.owner) &&
      (q.state === "all" || r.state === q.state) &&
      (q.kind === "all" || q.kind.split(",").includes(r.kind)) &&
      (!q.hasAttachments ||
        q.hasAttachments === "all" ||
        (r.kind === "generation") === (q.hasAttachments === "yes")) &&
      (!q.hasOutputs ||
        q.hasOutputs === "all" ||
        r.assetRefs.length > 0 === (q.hasOutputs === "yes")) &&
      (!q.inputType ||
        q.inputType === "all" ||
        q.inputType === "text" ||
        (r.kind === "generation" &&
          (q.inputType === "image"
            ? r.owner === "eikona"
            : q.inputType === "video"
              ? r.owner === "scaena"
              : false))) &&
      (q.actor === "all" || r.actor === q.actor) &&
      (!q.projectRef || q.projectRef === "all" || r.project === q.projectRef) &&
      `${r.title} ${r.id} ${r.projectName} ${actorNames[r.actor]} ${r.model}`
        .toLowerCase()
        .includes(q.search.toLowerCase()),
  );
}
export function statistics(rows: RequestFact[]) {
  const unique = [
    ...new Map(rows.map((r) => [r.owner + ":" + r.id, r])).values(),
  ];
  const success = unique.filter((r) => r.state === "succeeded").length,
    failed = unique.filter((r) => r.state === "failed").length;
  const costs = [...new Map(unique.map((r) => [r.chargeRef, r])).values()];
  return {
    requests: unique.length,
    gateway: unique.filter((r) => r.kind === "gateway").length,
    generation: unique.filter((r) => r.kind === "generation").length,
    attempts: unique.reduce((s, r) => s + r.attempts, 0),
    outputs: unique.reduce((s, r) => s + r.outputs, 0),
    success,
    failed,
    denominator: success + failed,
    rate: success + failed ? success / (success + failed) : null,
    unknown: unique.filter((r) => r.state === "unknown").length,
    cancelled: unique.filter((r) => r.state === "cancelled").length,
    running: unique.filter((r) => r.state === "running").length,
    CNY: costs
      .filter((r) => r.currency === "CNY" && r.costState === "confirmed")
      .reduce((s, r) => s + (r.amount ?? 0), 0),
    USD: costs
      .filter((r) => r.currency === "USD" && r.costState === "confirmed")
      .reduce((s, r) => s + (r.amount ?? 0), 0),
    unsettled: costs.filter((r) => r.costState !== "confirmed").length,
  };
}
export const durationLabel = (n: number | null) =>
  n === null
    ? "—"
    : n >= 60
      ? `${Math.floor(n / 60)} 分 ${n % 60} 秒`
      : `${n} 秒`;
export const dateLabel = (s: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(s));
export function csv(rows: unknown[][]) {
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v ?? "")
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n")
  );
}
export function exportCSV(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(
    new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface Member {
  id: string;
  tenant: string;
  team: string;
  actor: string;
  name: string;
  type: "human" | "service";
  owner: string;
  role: string;
  status: "active" | "invited" | "suspended" | "removed";
  revision: number;
  mapping: "verified" | "unlinked";
}
export const roleCatalog: Record<
  string,
  { id: string; name: string; permissions: string }[]
> = {
  aigora: [
    {
      id: "tenant_owner",
      name: "租户负责人",
      permissions: "组织、成员、账务与网关管理",
    },
    { id: "tenant_admin", name: "租户管理员", permissions: "成员与网关管理" },
    {
      id: "developer",
      name: "开发成员",
      permissions: "授权项目内的调用与请求查看",
    },
    { id: "viewer", name: "观察成员", permissions: "授权范围内只读" },
    {
      id: "billing_admin",
      name: "账务管理员",
      permissions: "授权范围的预算与账务",
    },
    { id: "project_admin", name: "项目管理员", permissions: "授权项目治理" },
    { id: "auditor", name: "审计成员", permissions: "授权范围的审计读取" },
    { id: "team_admin", name: "团队管理员", permissions: "指定团队管理" },
  ],
  drivebridge: [
    {
      id: "admin",
      name: "团队管理员",
      permissions: "团队成员管理；空间数据负责人单独授权",
    },
    {
      id: "member",
      name: "团队成员",
      permissions: "团队成员关系；文件权限由空间单独授予",
    },
  ],
  yeitra: [
    { id: "admin", name: "项目管理员", permissions: "项目成员与项目管理" },
    { id: "editor", name: "编辑成员", permissions: "项目创作与任务提交" },
    { id: "reviewer", name: "审阅成员", permissions: "项目结果审阅" },
    { id: "viewer", name: "只读成员", permissions: "项目查看" },
  ],
};
export const memberFixtures: Member[] = [
  {
    id: "m-1",
    tenant: "studio",
    team: "research",
    actor: "yeisme",
    name: "Yeisme",
    type: "human",
    owner: "aigora",
    role: "tenant_owner",
    status: "active",
    revision: 1,
    mapping: "verified",
  },
  {
    id: "m-2",
    tenant: "studio",
    team: "production",
    actor: "yeisme",
    name: "Yeisme",
    type: "human",
    owner: "drivebridge",
    role: "admin",
    status: "active",
    revision: 1,
    mapping: "verified",
  },
  {
    id: "m-3",
    tenant: "studio",
    team: "production",
    actor: "lin",
    name: "林晓",
    type: "human",
    owner: "drivebridge",
    role: "member",
    status: "active",
    revision: 3,
    mapping: "verified",
  },
  {
    id: "m-4",
    tenant: "studio",
    team: "research",
    actor: "lin",
    name: "林晓",
    type: "human",
    owner: "aigora",
    role: "developer",
    status: "active",
    revision: 2,
    mapping: "verified",
  },
  {
    id: "m-5",
    tenant: "studio",
    team: "production",
    actor: "chen",
    name: "陈屿",
    type: "human",
    owner: "yeitra",
    role: "editor",
    status: "active",
    revision: 1,
    mapping: "verified",
  },
  {
    id: "m-6",
    tenant: "studio",
    team: "production",
    actor: "xu",
    name: "许宁",
    type: "human",
    owner: "yeitra",
    role: "viewer",
    status: "invited",
    revision: 1,
    mapping: "unlinked",
  },
  {
    id: "m-7",
    tenant: "studio",
    team: "research",
    actor: "agent",
    name: "制作 Agent",
    type: "service",
    owner: "aigora",
    role: "developer",
    status: "active",
    revision: 1,
    mapping: "verified",
  },
  {
    id: "m-8",
    tenant: "studio",
    team: "production",
    actor: "agent",
    name: "制作 Agent",
    type: "service",
    owner: "aigora",
    role: "viewer",
    status: "suspended",
    revision: 1,
    mapping: "unlinked",
  },
  {
    id: "m-9",
    tenant: "north",
    team: "north-production",
    actor: "north-lin",
    name: "林晓",
    type: "human",
    owner: "yeitra",
    role: "editor",
    status: "active",
    revision: 1,
    mapping: "verified",
  },
  {
    id: "m-10",
    tenant: "north",
    team: "north-production",
    actor: "north-owner",
    name: "周予",
    type: "human",
    owner: "yeitra",
    role: "admin",
    status: "active",
    revision: 1,
    mapping: "verified",
  },
  {
    id: "m-11",
    tenant: "studio",
    team: "production",
    actor: "yeisme",
    name: "Yeisme",
    type: "human",
    owner: "yeitra",
    role: "admin",
    status: "active",
    revision: 1,
    mapping: "verified",
  },
];
export function protectedMembership(
  member: Member,
  peers: Member[] = memberFixtures,
) {
  return (
    member.role === "tenant_owner" ||
    (member.role === "admin" &&
      ["drivebridge", "yeitra"].includes(member.owner) &&
      !peers.some(
        (m) =>
          m.id !== member.id &&
          m.owner === member.owner &&
          m.tenant === member.tenant &&
          m.team === member.team &&
          m.role === "admin" &&
          m.status === "active",
      ))
  );
}
export function ownerManagementAllowed(
  scope: ManagementScope,
  members: Member[],
  owner: string,
  team: string,
) {
  if (scope.role !== "admin" || scope.perspective === "personal") return false;
  return members.some(
    (m) =>
      m.actor === scope.actor &&
      m.tenant === scope.tenant &&
      m.owner === owner &&
      m.status === "active" &&
      m.type === "human" &&
      (owner === "aigora"
        ? ["tenant_owner", "tenant_admin", "project_admin"].includes(m.role)
        : m.team === team && m.role === "admin"),
  );
}
export function grantableRoles(
  scope: ManagementScope,
  members: Member[],
  owner: string,
  team: string,
) {
  if (!ownerManagementAllowed(scope, members, owner, team)) return [];
  const actor = members.find(
    (m) =>
      m.actor === scope.actor &&
      m.tenant === scope.tenant &&
      m.owner === owner &&
      m.status === "active" &&
      (owner === "aigora" || m.team === team),
  );
  return (roleCatalog[owner] || []).filter(
    (r) =>
      r.id !== "tenant_owner" &&
      (owner !== "aigora" ||
        actor?.role === "tenant_owner" ||
        (actor?.role === "tenant_admin"
          ? ["project_admin", "developer", "viewer", "auditor"]
          : ["developer", "viewer", "auditor"]
        ).includes(r.id)),
  );
}
export function memberChangeError(
  member: Member,
  action: string,
  role: string,
  currentActor: string,
  peers: Member[] = memberFixtures,
) {
  if (member.actor === currentActor && action !== "transfer")
    return "不能修改自己的成员关系。请由另一位具备权限的管理员处理。";
  if (protectedMembership(member, peers) && action !== "transfer")
    return "负责人受保护，请先通过负责人交接流程完成交接。";
  if (action === "role" && ["owner", "tenant_owner"].includes(role))
    return "负责人角色必须通过交接流程授予。";
  if (
    action === "role" &&
    !roleCatalog[member.owner]?.some((r) => r.id === role)
  )
    return "请选择该项目支持的角色。";
  return "";
}
export const initialFacts = () => [
  ...legacyFacts(initialOperations),
  ...requestFixtures,
];
