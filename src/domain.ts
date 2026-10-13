import type { Env, Operation, Role, Scenario, Page } from "./data";
export const pages: Page[] = [
  "overview",
  "projects",
  "services",
  "tasks",
  "assets",
  "approvals",
  "usage",
  "audit",
  "settings",
  "members",
];
export function canWrite(role: Role, scenario: Scenario, admin = false) {
  return (
    scenario !== "permission" &&
    scenario !== "offline" &&
    scenario !== "auth" &&
    role !== "viewer" &&
    (!admin || role === "admin")
  );
}
export function scopedOperations(
  operations: Operation[],
  env: Env,
  project: string,
  scenario: Scenario,
) {
  return scenario === "empty"
    ? []
    : operations.filter(
        (o) => o.env === env && (project === "all" || o.project === project),
      );
}
export function actionFor(
  op: Operation,
): "reconcile" | "retry" | "cancel" | null {
  if (op.state === "unknown") return "reconcile";
  if (op.state === "failed" && op.native === "rate_limited") return "retry";
  if (op.state === "running" || op.state === "queued") return "cancel";
  return null;
}
export function mutateOperation(op: Operation, action: string): Operation {
  if (action === "reconcile" && op.state === "unknown")
    return {
      ...op,
      state: "waiting_review",
      native: "result_recovered",
      reason: "已恢复原请求结果；任务身份未变，等待人工审阅。",
      cost: "待结算",
    };
  if (action === "cancel" && ["queued", "running"].includes(op.state))
    return {
      ...op,
      state: "cancelled",
      native: "cancelled",
      reason: "演示取消已确认；已经发生的费用不因此撤销。",
    };
  return op;
}
export function validateConnection(ref: string, credential: string) {
  if (!/^connection:\/\/[a-z0-9][a-z0-9/_-]{2,100}$/i.test(ref))
    return "使用 connection:// 开头的连接引用，不输入网址或密钥。";
  if (!/^credentialctl:\/\/[a-z0-9][a-z0-9/_-]{2,100}$/i.test(credential))
    return "使用 credentialctl:// 开头的安全引用，不输入凭据内容。";
  return "";
}
export function launchContext(hash: string) {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?"),
    q = new URLSearchParams(query);
  const field = (name: string) => {
    const v = q.get(name) || "";
    return /^[\p{L}\p{N}:_./-]{1,160}$/u.test(v) ? v : "";
  };
  const source = q.get("source") === "frame" ? "frame" : "";
  return {
    page: pages.includes(path as Page) ? (path as Page) : "overview",
    env: q.get("env") === "staging" ? ("staging" as Env) : ("main" as Env),
    project: ["rain", "coast", "research"].includes(q.get("project") || "")
      ? q.get("project")!
      : "all",
    source,
    sourceProject: field("source_project"),
    sourceTask: field("source_task"),
    sourceShot: field("source_shot"),
    service: field("service"),
    returnPage: [
      "home",
      "projects",
      "script",
      "canvas",
      "storyboard",
      "audio",
      "assets",
      "tasks",
      "reviews",
    ].includes(q.get("return_page") || "")
      ? q.get("return_page")!
      : "tasks",
  };
}
export interface Charge {
  ref: string;
  currency: "CNY" | "USD";
  amount: number;
  state: "confirmed" | "estimated" | "pending" | "unknown";
  project: string;
  owner: string;
}
export const charges: Charge[] = [
  {
    ref: "demo:eikona:bill-86",
    currency: "CNY",
    amount: 1.28,
    state: "confirmed",
    project: "rain",
    owner: "eikona",
  },
  {
    ref: "demo:eikona:bill-86",
    currency: "CNY",
    amount: 1.28,
    state: "confirmed",
    project: "rain",
    owner: "scaena",
  },
  {
    ref: "demo:auctra:bill-6",
    currency: "USD",
    amount: 0.08,
    state: "confirmed",
    project: "rain",
    owner: "auctra",
  },
  {
    ref: "demo:sonora:estimate-19",
    currency: "USD",
    amount: 0.12,
    state: "estimated",
    project: "coast",
    owner: "sonora",
  },
  {
    ref: "demo:scaena:bill-39",
    currency: "CNY",
    amount: 0,
    state: "unknown",
    project: "rain",
    owner: "scaena",
  },
  {
    ref: "demo:anatomia:bill-21",
    currency: "CNY",
    amount: 0,
    state: "pending",
    project: "rain",
    owner: "anatomia",
  },
];
export function uniqueCharges(rows: Charge[]) {
  const map = new Map<string, Charge>();
  for (const row of rows) if (!map.has(row.ref)) map.set(row.ref, row);
  return [...map.values()];
}
export function confirmedTotals(rows: Charge[]) {
  const out = { CNY: 0, USD: 0 };
  for (const r of uniqueCharges(rows))
    if (r.state === "confirmed") out[r.currency] += r.amount;
  return out;
}
