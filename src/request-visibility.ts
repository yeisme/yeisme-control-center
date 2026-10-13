export const owners = ["aigora", "scaena", "eikona", "sonora"] as const;
export type Owner = (typeof owners)[number];
export type CoverageState =
  | "complete"
  | "partial"
  | "pending"
  | "unknown"
  | "not_recorded"
  | "forbidden"
  | "unavailable"
  | "expired"
  | "integrity_failed"
  | "needs_contract";
export const coverageLabels: Record<CoverageState, string> = {
  complete: "已提供",
  partial: "部分提供",
  pending: "处理中",
  unknown: "尚未确认",
  not_recorded: "未采集",
  forbidden: "无读取权限",
  unavailable: "来源不可用",
  expired: "已过期",
  integrity_failed: "完整性校验失败",
  needs_contract: "待补齐接口",
};
export interface Coverage {
  owner: Owner;
  state: CoverageState;
  observed_at: string;
  reason?: string;
}
export interface RequestAttachment {
  ref: string;
  name: string;
  mime: string;
  bytes: number | null;
  source: "upload" | "reference" | "generated";
  state: CoverageState;
  upload_ref?: string;
  sha256?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  downloadable: boolean;
}
export interface RequestProjection {
  id: string;
  owner: Owner;
  tenant: string;
  project: string;
  title: string;
  kind: "gateway" | "generation" | "operation";
  state: string;
  native_state: string;
  actor: string;
  actor_type: "human" | "service" | "unknown";
  created_at: string;
  duration_ms: number | null;
  model: string | null;
  parent_ref: string | null;
  attempts: {
    ref: string;
    state: string;
    started_at?: string;
    completed_at?: string;
  }[];
  output_refs: string[];
  attachments: RequestAttachment[];
  input: CoverageState;
  output: CoverageState;
  submitted: Record<string, string | number | boolean | null>;
  effective: Record<string, string | number | boolean | null>;
  coverage: Coverage;
  finance?: {
    currency: string;
    amount: number | null;
    state: string;
    charge_ref: string;
  };
}
export interface RequestQuery {
  from: string;
  to: string;
  search: string;
  owner: string;
  state: string;
  input_type: string;
  attachments: string;
  outputs: string;
  completeness: string;
  limit: number;
  cursor?: string;
}
export interface ContentRead {
  state: CoverageState;
  text?: string;
  truncated?: boolean;
  receipt_ref?: string;
  bytes?: number;
}
export interface RequestMetric {
  value: number | null;
  state: CoverageState;
}
export interface RequestSummary {
  gateway: RequestMetric;
  generation: RequestMetric;
  operation: RequestMetric;
  attempts: RequestMetric;
  outputs: RequestMetric;
  succeeded: RequestMetric;
  failed: RequestMetric;
  uploaded_files: RequestMetric;
  uploaded_bytes: RequestMetric;
  referenced_assets: RequestMetric;
  coverage: Coverage[];
  from: string;
  to: string;
}
export function defaultRequestQuery(now = new Date()): RequestQuery {
  return {
    from: new Date(+now - 86400000).toISOString(),
    to: now.toISOString(),
    search: "",
    owner: "all",
    state: "all",
    input_type: "all",
    attachments: "all",
    outputs: "all",
    completeness: "all",
    limit: 25,
  };
}
export function matchesRequest(r: RequestProjection, q: RequestQuery) {
  const time = Date.parse(r.created_at);
  return (
    Number.isFinite(time) &&
    time >= Date.parse(q.from) &&
    time <= Date.parse(q.to) &&
    (q.owner === "all" || r.owner === q.owner) &&
    (q.state === "all" || r.state === q.state) &&
    (!q.search ||
      [r.id, r.title, r.actor, r.project].some((v) =>
        v.toLowerCase().includes(q.search.toLowerCase()),
      )) &&
    (q.attachments === "all" ||
      r.attachments.length > 0 === (q.attachments === "yes")) &&
    (q.outputs === "all" ||
      r.output_refs.length > 0 === (q.outputs === "yes")) &&
    (q.completeness === "all" || r.coverage.state === q.completeness) &&
    (q.input_type === "all" ||
      (q.input_type === "text"
        ? r.input === "complete"
        : r.attachments.some(
            (a) =>
              a.source !== "generated" && a.mime.startsWith(q.input_type + "/"),
          )))
  );
}
// Only a complete, owner-authorized result set may use this function. A page is not a summary.
export function summarizeRequests(
  rows: RequestProjection[],
  from: string,
  to: string,
  coverage: Coverage[],
): RequestSummary {
  const unique = [
    ...new Map(rows.map((r) => [r.owner + ":" + r.id, r])).values(),
  ];
  const complete =
    coverage.length > 0 && coverage.every((c) => c.state === "complete");
  const metric = (value: number | null): RequestMetric => ({
    value,
    state: value === null ? "unknown" : complete ? "complete" : "partial",
  });
  const uploads = new Map<string, RequestAttachment>(),
    references = new Set<string>(),
    attempts = new Set<string>(),
    outputs = new Set<string>();
  for (const r of unique) {
    r.attempts.forEach((a) => attempts.add(r.owner + ":" + a.ref));
    r.output_refs.forEach((a) => outputs.add(r.owner + ":" + a));
    r.attachments.forEach((a) => {
      if (a.source === "upload" && a.upload_ref)
        uploads.set(r.owner + ":" + a.upload_ref, a);
      if (a.source === "reference") references.add(r.owner + ":" + a.ref);
    });
  }
  return {
    gateway: metric(unique.filter((r) => r.kind === "gateway").length),
    generation: metric(unique.filter((r) => r.kind === "generation").length),
    operation: metric(unique.filter((r) => r.kind === "operation").length),
    attempts: metric(attempts.size),
    outputs: metric(outputs.size),
    succeeded: metric(unique.filter((r) => r.state === "succeeded").length),
    failed: metric(unique.filter((r) => r.state === "failed").length),
    uploaded_files: metric(uploads.size),
    uploaded_bytes: metric(
      [...uploads.values()].some((a) => a.bytes === null)
        ? null
        : [...uploads.values()].reduce((n, a) => n + (a.bytes || 0), 0),
    ),
    referenced_assets: metric(references.size),
    coverage,
    from,
    to,
  };
}
export function bytesLabel(n: number | null) {
  return n === null
    ? "未知"
    : n >= 1048576
      ? (n / 1048576).toFixed(1) + " MB"
      : n >= 1024
        ? (n / 1024).toFixed(1) + " KB"
        : n + " B";
}
