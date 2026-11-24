import { useEffect, useMemo, useState } from "react";
import { ScrollText } from "../../icons";
import { api, errorCode, type AuditPage, type AuditRow } from "../../shared/api/control-center-client";
import { DataTable, EmptyState, Input, Pager, Panel, Pill, Select, SkeletonRows, ownerLabel, type Column } from "../../components/ui";
import { useListPreferences } from "../../app/preferences";
import { useWorkspace } from "../../app/workspace";
import { usePagedRows } from "../../app/use-paged-rows";
import { liveQuery } from "../../app/overlay-history";
import { formatFullTime, formatRelative } from "../../shared/read-model/format";
import { pageSizes } from "../../shared/pager";
import { useSearchParams } from "react-router-dom";

const humanize = (value: string) => value.replace(/[_.-]+/g, " ");
export const auditActionLabels: Record<string, string> = {
  "auth.login": "登录",
  "auth.invite_redeemed": "使用一次性邀请登录",
  "auth.logout": "退出",
  "admin.user_created": "新建账号",
  "admin.user_revoked": "停用账号",
  "admin.user_rotated": "重置账号 Key",
  "admin.user_enabled": "启用账号",
  "admin.user_updated": "修改账号",
  "admin.invite_created": "生成一次性邀请链接",
  "admin.invite_revoked": "撤回一次性邀请链接",
  "account.key_rotated": "重置自己的 Key",
  "requests.content_read": "读取请求正文",
  "requests.attachment_read": "读取请求附件",
  "tasks.artifact_access": "申请结果句柄",
  "media.read": "读取媒体",
  "tasks.cancel": "取消任务",
  "provider_runs.create": "提交 Provider 运行",
  "provider_runs.reconcile": "对账 Provider 运行",
  "actions.preview": "预览动作",
  "actions.confirm": "确认动作",
  "actions.receipt_read": "读取动作回执",
  "auctra.collection.sync": "同步 Auctra 收集记录",
};
const auditPurposeLabels: Record<string, string> = { preview: "预览", download: "下载", metadata_collection: "元数据收集" };
const auditActionLabel = (action: string) => auditActionLabels[action] || humanize(action);
const auditPurposeLabel = (purpose: string) => auditPurposeLabels[purpose] || humanize(purpose);
const outcomeTone = { succeeded: "success", denied: "danger", failed: "danger", unavailable: "warning", initiated: "info" } as const;
const outcomeLabels: Record<string, string> = { succeeded: "成功", denied: "拒绝", failed: "失败", unavailable: "不可用", initiated: "进行中/中断" };

const auditColumns: Column<AuditRow>[] = [
  { id: "time", header: "时间", label: "时间", cell: (row) => <span className="tabular whitespace-nowrap text-ink-soft" title={formatFullTime(row.occurred_at)}>{formatRelative(row.occurred_at)}</span> },
  { id: "action", header: "动作", label: "动作", cell: (row) => <span className="block min-w-0">
    <span className="whitespace-nowrap font-medium text-ink">{auditActionLabel(row.action)}</span>
    {row.owner && <span className="ml-1.5 text-2xs font-normal text-muted">{ownerLabel(row.owner)}</span>}
    {(row.target_ref || row.purpose) && <span className="mt-0.5 block max-w-[240px] truncate text-2xs text-muted @2xl:hidden">{[row.purpose && auditPurposeLabel(row.purpose), row.target_ref].filter(Boolean).join(" · ")}</span>}
  </span> },
  { id: "actor", header: "执行者", label: "执行者", priority: 2, cell: (row) => <span className="block max-w-[180px] truncate font-mono text-2xs text-muted" title={row.actor}>{row.actor}</span> },
  { id: "target", header: "目标 · 用途", label: "目标", priority: 2, cell: (row) => <span className="block max-w-[260px]">
    <span className="block truncate font-mono text-2xs text-ink-soft">{row.target_ref || "—"}</span>
    {row.purpose && <span className="block truncate text-2xs text-muted">{auditPurposeLabel(row.purpose)}</span>}
  </span> },
  { id: "outcome", header: "结果", label: "结果", align: "end", cell: (row) => <span className="inline-flex items-center gap-1.5">
    <Pill size="sm" tone={outcomeTone[row.outcome as keyof typeof outcomeTone] || "neutral"}>{outcomeLabels[row.outcome] || humanize(row.outcome)}</Pill>
    {row.error_code && <span className="font-mono text-2xs text-muted" title="错误码">{row.error_code}</span>}
  </span> },
];

const filterKeys = ["action", "outcome", "actor", "from", "to"] as const;

/**
 * The audit log, newest first, filtered on the server by action, outcome, who did it and the day. Pages go back with
 * the `before` cursor; what was read pages locally like any other list. Bodies and credentials never appear here.
 */
export function AuditPanel() {
  const [params, setParams] = useSearchParams();
  const filter = Object.fromEntries(filterKeys.map((key) => [key, params.get(`audit-${key}`) || ""])) as Record<(typeof filterKeys)[number], string>;
  const filterKey = filterKeys.map((key) => filter[key]).join("|");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { pageSize, setPageSize } = useListPreferences();
  // The page is not remounted when the session's epoch moves (see App), so the log is read again here instead.
  const { generation } = useWorkspace();
  const query = useMemo(() => Object.fromEntries(filterKeys.flatMap((key) => filter[key] ? [[key, filter[key]]] : [])), [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    api.auditPage(query, controller.signal).then((page: AuditPage) => { setRows(page.rows); setNext(page.next_before); setStatus("ready"); }).catch((failure) => { if (!controller.signal.aborted) { setError(errorCode(failure)); setStatus("error"); } });
    return () => controller.abort();
  }, [query, generation]);
  const more = async () => {
    if (next === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.auditPage({ ...query, before: next });
      setRows((current) => [...current, ...page.rows]);
      setNext(page.next_before);
    } catch (failure) {
      setError(errorCode(failure));
    } finally {
      setLoadingMore(false);
    }
  };
  const paged = usePagedRows(rows, pageSize, [], { prefix: "audit-" });
  const set = (key: (typeof filterKeys)[number], value: string) => setParams((current) => {
    const next = new URLSearchParams(liveQuery(current));
    if (value) next.set(`audit-${key}`, value); else next.delete(`audit-${key}`);
    next.delete("audit-page");
    return next;
  }, { replace: true });
  return <Panel title="审计记录" actions={<span className="text-meta text-muted">只读 · 脱敏 · 不含正文和凭据</span>} bodyClassName="p-0">
    <div className="grid gap-2 border-b border-line px-4 py-3 sm:grid-cols-2 lg:grid-cols-5" data-audit-filters>
      <Select aria-label="动作" value={filter.action} onChange={(event) => set("action", event.target.value)}>
        <option value="">全部动作</option>
        {Object.entries(auditActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <Select aria-label="结果" value={filter.outcome} onChange={(event) => set("outcome", event.target.value)}>
        <option value="">全部结果</option>
        {Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <Input aria-label="执行者" placeholder="执行者（完整标识）" value={filter.actor} onChange={(event) => set("actor", event.target.value.trim())} />
      <Input aria-label="开始日期" type="date" value={filter.from} onChange={(event) => set("from", event.target.value)} />
      <Input aria-label="结束日期" type="date" min={filter.from || undefined} value={filter.to} onChange={(event) => set("to", event.target.value)} />
    </div>
    {status === "loading" ? <SkeletonRows rows={5} /> : status === "error" ? <EmptyState icon={<ScrollText />} title="审计记录暂不可读" body={error === "not_found" || error === "operation_not_allowed" ? "当前服务版本尚未提供审计读取接口。" : error === "invalid_query" ? "筛选条件不对，换一个试试。" : <>读取失败（错误码 <code className="font-mono">{error}</code>）</>} /> : rows.length === 0 ? <EmptyState icon={<ScrollText />} title={filterKeys.some((key) => filter[key]) ? "没有符合条件的审计记录" : "还没有审计记录"} /> : <>
      <DataTable label="审计记录" columns={auditColumns} rows={paged.rows} rowKey={(row) => String(row.id)} />
      <Pager window={paged} onPage={paged.setPage} noun="条已读取的审计记录" pageSize={pageSize} pageSizes={pageSizes} onPageSize={(value) => { setPageSize(value as typeof pageSize); paged.setPage(1); }} more={next !== null ? { label: "读取更早的记录", loading: loadingMore, onMore: more } : null} />
    </>}
  </Panel>;
}
