import { useEffect, useState } from "react";
import { Building2, ChevronDown, LoaderCircle, LockKeyhole, LogOut, ScrollText, ShieldCheck, UserRound, UsersRound } from "../../icons";
import { api, errorCode, type AuditRow, type OrganizationMember } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import {
  Button,
  CoverageChip,
  DataTable,
  EmptyState,
  Facts,
  InlineNotice,
  PageToolbar,
  Panel,
  Pill,
  ReadStateView,
  SkeletonRows,
  TabPanel,
  Tabs,
  Unknown,
  ownerLabel,
  type Column,
} from "../../components/ui";
import { formatFullTime, formatRelative, initials } from "../../shared/read-model/format";

type Tab = "identity" | "members" | "audit";

const humanize = (value: string) => value.replace(/[_.-]+/g, " ");

const auditActionLabels: Record<string, string> = {
  "auth.login": "登录",
  "auth.logout": "退出",
  "admin.user_created": "创建用户",
  "admin.user_revoked": "撤销用户",
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

const memberTypeLabel = (type: OrganizationMember["type"]) => type === "human" ? "成员" : type === "service" ? "服务账号" : "类型未知";

const memberColumns: Column<OrganizationMember>[] = [
  { id: "member", header: "成员", cell: (member) => <span className="flex min-w-0 items-center gap-2.5">
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-panel-sunken text-2xs font-semibold text-muted">{initials(member.name || member.id)}</span>
    <span className="min-w-0">
      <span className="block max-w-[220px] truncate font-medium text-ink">{member.name || <Unknown>未提供名称</Unknown>}</span>
      <span className="block max-w-[220px] truncate text-2xs text-muted">{memberTypeLabel(member.type)}<span className="@2xl:hidden"> · {ownerLabel(member.owner)}{member.role ? ` · ${humanize(member.role)}` : ""}</span></span>
    </span>
  </span> },
  { id: "owner", header: "来源", priority: 2, cell: (member) => <span className="whitespace-nowrap text-ink-soft">{ownerLabel(member.owner)}</span> },
  { id: "role", header: "owner 角色", priority: 2, cell: (member) => member.role ? <Pill size="sm" tone="neutral">{humanize(member.role)}</Pill> : <Unknown /> },
  { id: "team", header: "团队", priority: 3, cell: (member) => member.team ? <span className="whitespace-nowrap text-ink-soft">{member.team}</span> : <Unknown>—</Unknown> },
  { id: "binding", header: "身份绑定", align: "end", cell: (member) => <Pill size="sm" tone={member.binding === "verified" ? "success" : "neutral"}>{member.binding === "verified" ? "已核验" : "未关联"}</Pill> },
];

const auditColumns: Column<AuditRow>[] = [
  { id: "time", header: "时间", cell: (row) => <span className="tabular whitespace-nowrap text-ink-soft" title={formatFullTime(row.occurred_at)}>{formatRelative(row.occurred_at)}</span> },
  { id: "action", header: "动作", cell: (row) => <span className="block min-w-0">
    <span className="whitespace-nowrap font-medium text-ink">{auditActionLabel(row.action)}</span>
    {row.owner && <span className="ml-1.5 text-2xs font-normal text-muted">{ownerLabel(row.owner)}</span>}
    {(row.target_ref || row.purpose) && <span className="mt-0.5 block max-w-[240px] truncate text-2xs text-muted @2xl:hidden">{[row.purpose && auditPurposeLabel(row.purpose), row.target_ref].filter(Boolean).join(" · ")}</span>}
  </span> },
  { id: "actor", header: "执行者", priority: 2, cell: (row) => <span className="block max-w-[180px] truncate font-mono text-2xs text-muted" title={row.actor}>{row.actor}</span> },
  { id: "target", header: "目标 · 用途", priority: 2, cell: (row) => <span className="block max-w-[260px]">
    <span className="block truncate font-mono text-2xs text-ink-soft">{row.target_ref || "—"}</span>
    {row.purpose && <span className="block truncate text-2xs text-muted">{auditPurposeLabel(row.purpose)}</span>}
  </span> },
  { id: "outcome", header: "结果", align: "end", cell: (row) => <span className="inline-flex items-center gap-1.5">
    <Pill size="sm" tone={outcomeTone[row.outcome as keyof typeof outcomeTone] || "neutral"}>{outcomeLabels[row.outcome] || humanize(row.outcome)}</Pill>
    {row.error_code && <span className="font-mono text-2xs text-muted" title="错误码">{row.error_code}</span>}
  </span> },
];

export default function TeamPage() {
  const { isAdmin } = useWorkspace();
  const [tab, setTab] = useState<Tab>("identity");
  return <div className="page-enter space-y-5" data-page="team">
    <h1 className="sr-only">团队与设置</h1>
    <PageToolbar summary="当前登录身份、授权范围，以及各 owner 返回的成员与审计记录。角色和范围由服务端会话决定，浏览器不能自报。" />
    <Tabs<Tab>
      value={tab}
      onChange={setTab}
      label="团队与设置"
      className="space-y-4"
      options={[
        { id: "identity", label: "身份与范围" },
        { id: "members", label: "成员" },
        ...(isAdmin ? [{ id: "audit" as const, label: "审计" }] : []),
      ]}
    >
      <TabPanel value="identity"><IdentityTab /></TabPanel>
      <TabPanel value="members"><MembersTab /></TabPanel>
      {isAdmin && <TabPanel value="audit"><AuditTab /></TabPanel>}
    </Tabs>
  </div>;
}

function IdentityTab() {
  const { session, scopeId, setScope, logout, isAdmin } = useWorkspace();
  const users = useScopedRead((_scope, signal) => api.personalUsers(signal), { enabled: isAdmin && !!session?.username });
  if (!session) return null;
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
    <Panel
      title="当前身份"
      className="self-start"
      actions={<Button size="sm" onClick={() => void logout()} icon={<LogOut className="size-3.5 text-danger" />}><span className="text-danger">退出登录</span></Button>}
    >
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-full bg-primary text-title font-semibold text-primary-ink">{initials(session.name)}</span>
          <div className="min-w-0">
            <p className="truncate text-title-sm font-semibold">{session.name}</p>
            <p className="truncate text-body-sm text-muted">{session.username ? `@${session.username}` : "组织身份"}</p>
          </div>
          <Pill tone={isAdmin ? "info" : "neutral"} className="ml-auto" icon={<ShieldCheck />}>{isAdmin ? "控制中心管理员" : "只读成员"}</Pill>
        </div>
        <Facts columns={2} items={[
          { label: "身份标识", value: session.identity ? <span className="font-mono text-xs">{session.identity}</span> : <Unknown />, wide: true },
          { label: "登录方式", value: session.task_connections ? "个人账号" : "组织身份（OIDC）" },
          { label: "会话 epoch", value: session.epoch ?? <Unknown>服务端未提供</Unknown> },
        ]} />
        <InlineNotice tone="neutral" icon={<LockKeyhole />}>角色由服务端会话派生，浏览器不能自报角色或范围；各 owner 仍按自己的授权判断能否读取。</InlineNotice>
      </div>
    </Panel>
    <div className="space-y-5">
      <Panel title="授权范围" actions={<span className="text-meta text-muted">{session.scopes.length} 个</span>} bodyClassName="p-0">
        <ul className="divide-y divide-line">
          {session.scopes.map((scope) => <li key={scope.id} className="flex items-start gap-3 px-5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-control bg-panel-sunken text-muted"><Building2 className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-medium">{scope.label}</span>
              <span className="block break-words text-2xs text-muted">{[scope.tenant, scope.team, scope.project].filter(Boolean).join(" / ") || scope.id}{scope.connection_ids?.length ? ` · ${scope.connection_ids.length} 个任务连接` : ""}</span>
              {(scope.owners || []).length > 0 && <span className="mt-1.5 flex flex-wrap gap-1">{(scope.owners || []).map((owner) => <Pill key={owner} size="sm" tone="neutral">{ownerLabel(owner)}</Pill>)}</span>}
            </span>
            {scope.id === scopeId ? <Pill tone="success">当前</Pill> : <Button size="sm" variant="ghost" onClick={() => setScope(scope.id)}>切换</Button>}
          </li>)}
        </ul>
      </Panel>
      {isAdmin && session.username && <Panel title="个人账号" actions={<span className="text-meta text-muted">只读 · 增删需走受控配置命令</span>} bodyClassName="p-0">
        <ReadStateView status={users.status} error={users.error} onRetry={users.reload} skeleton={<SkeletonRows rows={2} />}>
          {(users.data?.users || []).length === 0 ? <EmptyState compact icon={<UserRound />} title="没有额外的个人账号" body="当前仅使用配置中的主账号登录。" /> : <ul className="divide-y divide-line">
            {users.data!.users.map((user) => <li key={user.username} className="flex items-center gap-3 px-5 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-panel-sunken text-body-sm font-semibold text-muted">{initials(user.name)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-body-sm font-medium">{user.name}</span><span className="block truncate text-2xs text-muted">@{user.username} · {user.scope_ids.join(", ")}</span></span>
              <Pill tone={user.role === "admin" ? "info" : "neutral"}>{user.role === "admin" ? "管理员" : "只读"}</Pill>
              {!user.enabled && <Pill tone="danger">已撤销</Pill>}
            </li>)}
          </ul>}
        </ReadStateView>
      </Panel>}
    </div>
  </div>;
}

function MembersTab() {
  const read = useScopedRead((scope, signal) => api.organization(scope, signal));
  const sources = read.data?.sources || [];
  const members = sources.flatMap((source) => source.members);
  const allBlocked = sources.length > 0 && sources.every((source) => source.state !== "complete");
  return <div className="space-y-4">
    {sources.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-2xs text-muted">来源覆盖</span>{sources.map((source) => <CoverageChip key={source.owner} owner={source.owner} state={source.state} reason={source.reason} />)}</div>}
    {allBlocked && <InlineNotice tone="info" icon={<LockKeyhole />}>所有成员来源都不可读。成员投影需要 owner 委托（组织身份登录）；个人会话不会改用其他凭据补齐。</InlineNotice>}
    <ReadStateView status={read.status} error={read.error} onRetry={read.reload} skeleton={<Panel><SkeletonRows rows={4} /></Panel>}>
      <Panel title="成员" actions={<span className="text-meta text-muted">按来源列出，不合并身份</span>} bodyClassName="p-0">
        <DataTable
          label="成员"
          columns={memberColumns}
          rows={members}
          rowKey={(member) => `${member.owner}:${member.id}`}
          empty={<EmptyState icon={<UsersRound />} title="没有可显示的成员" body="只显示 owner 返回的成员、角色和绑定状态；没有数据时保持为空。" />}
        />
      </Panel>
    </ReadStateView>
  </div>;
}

function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api.audit(undefined, controller.signal).then((page) => { setRows(page.rows); setNext(page.next_before); setStatus("ready"); }).catch((failure) => { if (!controller.signal.aborted) { setError(errorCode(failure)); setStatus("error"); } });
    return () => controller.abort();
  }, []);
  const more = async () => {
    if (next === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.audit(next);
      setRows((current) => [...current, ...page.rows]);
      setNext(page.next_before);
    } catch (failure) {
      setError(errorCode(failure));
    } finally {
      setLoadingMore(false);
    }
  };
  return <Panel title="审计记录" actions={<span className="text-meta text-muted">只读 · 脱敏 · 不含正文和凭据</span>} bodyClassName="p-0">
    {status === "loading" ? <SkeletonRows rows={5} /> : status === "error" ? <EmptyState icon={<ScrollText />} title="审计记录暂不可读" body={error === "not_found" || error === "operation_not_allowed" ? "当前服务版本尚未提供审计读取接口。" : <>读取失败（错误码 <code className="font-mono">{error}</code>）</>} /> : rows.length === 0 ? <EmptyState icon={<ScrollText />} title="还没有审计记录" /> : <>
      <DataTable label="审计记录" columns={auditColumns} rows={rows} rowKey={(row) => String(row.id)} />
      {next !== null && <div className="border-t border-line px-5 py-3"><Button size="sm" variant="ghost" disabled={loadingMore} onClick={() => void more()} icon={loadingMore ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <ChevronDown className="size-3.5" />}>加载更早记录</Button></div>}
    </>}
  </Panel>;
}
