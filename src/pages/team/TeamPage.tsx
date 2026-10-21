import { useEffect, useState } from "react";
import { Building2, ChevronDown, LoaderCircle, LockKeyhole, LogOut, ScrollText, ShieldCheck, UserRound, UsersRound } from "../../icons";
import { api, errorCode, type AuditRow } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { Button, CoverageChip, EmptyState, Facts, InlineNotice, Panel, Pill, ReadStateView, SegmentedTabs, SkeletonRows, Unknown, cx, ownerLabel } from "../../components/ui";
import { formatFullTime, formatRelative, initials } from "../../shared/read-model/format";
import { useTheme, type ThemePreference } from "../../app-shell/theme";

type Tab = "identity" | "members" | "audit";

const auditActionLabels: Record<string, string> = {
  "auth.login": "登录",
  "auth.logout": "退出",
  "admin.user_created": "创建用户",
  "admin.user_revoked": "撤销用户",
  "requests.content_read": "读取请求正文",
  "tasks.artifact_access": "申请结果句柄",
  "media.read": "读取媒体",
  "tasks.cancel": "取消任务",
  "provider_runs.create": "提交 Provider 运行",
  "provider_runs.reconcile": "对账 Provider 运行",
};
const outcomeTone = { succeeded: "success", denied: "danger", failed: "danger", unavailable: "warning", initiated: "info" } as const;
const outcomeLabels: Record<string, string> = { succeeded: "成功", denied: "拒绝", failed: "失败", unavailable: "不可用", initiated: "进行中/中断" };

export default function TeamPage() {
  const { isAdmin } = useWorkspace();
  const [tab, setTab] = useState<Tab>("identity");
  return <div className="page-enter space-y-5" data-page="team">
    <h1 className="sr-only">团队与设置</h1>
    <div className="flex justify-end"><SegmentedTabs label="团队与设置" value={tab} onChange={setTab} options={[
      { id: "identity", label: "身份与范围" },
      { id: "members", label: "成员" },
      ...(isAdmin ? [{ id: "audit" as const, label: "审计" }] : []),
    ]} /></div>
    {tab === "identity" && <IdentityTab />}
    {tab === "members" && <MembersTab />}
    {tab === "audit" && isAdmin && <AuditTab />}
  </div>;
}

function IdentityTab() {
  const { session, scopeId, setScope, logout, isAdmin } = useWorkspace();
  const { preference, setPreference } = useTheme();
  const users = useScopedRead((_scope, signal) => api.personalUsers(signal), { enabled: isAdmin && !!session?.username });
  if (!session) return null;
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
    <div className="space-y-5">
      <Panel title="当前身份">
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-ink">{initials(session.name)}</span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{session.name}</p>
              <p className="truncate text-[13px] text-muted">{session.username ? `@${session.username}` : "组织身份"}</p>
            </div>
            <Pill tone={isAdmin ? "info" : "neutral"} className="ml-auto" icon={<ShieldCheck />}>{isAdmin ? "控制中心管理员" : "只读成员"}</Pill>
          </div>
          <Facts columns={2} items={[
            { label: "身份标识", value: session.identity ? <span className="font-mono text-xs">{session.identity}</span> : <Unknown />, wide: true },
            { label: "登录方式", value: session.task_connections ? "个人账号" : "组织身份（OIDC）" },
            { label: "会话 epoch", value: session.epoch ?? <Unknown>服务端未提供</Unknown> },
          ]} />
          <InlineNotice tone="neutral" icon={<LockKeyhole />}>角色由服务端会话派生，浏览器不能自报角色或范围；各 owner 仍按自己的授权判断能否读取。</InlineNotice>
          <Button size="sm" variant="danger" onClick={() => void logout()} icon={<LogOut className="size-3.5" />}>退出登录</Button>
        </div>
      </Panel>
      <Panel title="外观">
        <div className="p-5">
          <SegmentedTabs<ThemePreference> label="主题" value={preference} onChange={setPreference} options={[{ id: "light", label: "浅色" }, { id: "dark", label: "深色" }, { id: "system", label: "跟随系统" }]} />
        </div>
      </Panel>
    </div>
    <div className="space-y-5">
      <Panel title="授权范围" actions={<span className="text-2xs text-muted">{session.scopes.length} 个</span>} bodyClassName="p-0">
        <ul className="divide-y divide-line">
          {session.scopes.map((scope) => <li key={scope.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-panel-sunken text-muted"><Building2 className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{scope.label}</span>
              <span className="block truncate text-2xs text-muted">{[scope.tenant, scope.team, scope.project].filter(Boolean).join(" / ") || scope.id}{scope.connection_ids?.length ? ` · ${scope.connection_ids.length} 个任务连接` : ""}</span>
            </span>
            <span className="flex flex-wrap gap-1">{(scope.owners || []).map((owner) => <Pill key={owner} tone="neutral" className="h-5 px-1.5 text-2xs">{ownerLabel(owner)}</Pill>)}</span>
            {scope.id === scopeId ? <Pill tone="success">当前</Pill> : <Button size="sm" variant="ghost" onClick={() => setScope(scope.id)}>切换</Button>}
          </li>)}
        </ul>
      </Panel>
      {isAdmin && session.username && <Panel title="个人账号" actions={<span className="text-2xs text-muted">只读 · 增删需走受控配置命令</span>} bodyClassName="p-0">
        <ReadStateView status={users.status} error={users.error} onRetry={users.reload} skeleton={<SkeletonRows rows={2} />}>
          {(users.data?.users || []).length === 0 ? <EmptyState compact icon={<UserRound />} title="没有额外的个人账号" body="当前仅使用配置中的主账号登录。" /> : <ul className="divide-y divide-line">
            {users.data!.users.map((user) => <li key={user.username} className="flex items-center gap-3 px-5 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-panel-sunken text-[13px] font-semibold text-muted">{initials(user.name)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{user.name}</span><span className="block truncate text-2xs text-muted">@{user.username} · {user.scope_ids.join(", ")}</span></span>
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
      <Panel title="成员" actions={<span className="text-2xs text-muted">按来源列出，不合并身份</span>} bodyClassName="p-0">
        {members.length === 0 ? <EmptyState icon={<UsersRound />} title="没有可显示的成员" body="只显示 owner 返回的成员、角色和绑定状态；没有数据时保持为空。" /> : <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="border-b border-line bg-panel-soft text-left text-2xs text-muted"><th scope="col" className="px-5 py-2 font-medium">成员</th><th scope="col" className="px-3 py-2 font-medium">来源</th><th scope="col" className="px-3 py-2 font-medium">owner 角色</th><th scope="col" className="px-3 py-2 font-medium">团队</th><th scope="col" className="px-5 py-2 font-medium">身份绑定</th></tr></thead>
            <tbody className="divide-y divide-line">
              {members.map((member) => <tr key={member.id}>
                <td className="px-5 py-2.5"><span className="flex items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-panel-sunken text-2xs font-semibold text-muted">{initials(member.name || member.id)}</span><span className="min-w-0"><span className="block truncate font-medium">{member.name || <Unknown>未提供名称</Unknown>}</span><span className="block truncate text-2xs text-muted">{member.type === "human" ? "成员" : member.type === "service" ? "服务账号" : "类型未知"}</span></span></span></td>
                <td className="px-3 py-2.5">{ownerLabel(member.owner)}</td>
                <td className="px-3 py-2.5">{member.role || <Unknown />}</td>
                <td className="px-3 py-2.5">{member.team || <Unknown>—</Unknown>}</td>
                <td className="px-5 py-2.5"><Pill tone={member.binding === "verified" ? "success" : "neutral"}>{member.binding === "verified" ? "已核验" : "未关联"}</Pill></td>
              </tr>)}
            </tbody>
          </table>
        </div>}
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
  return <Panel title="审计记录" actions={<span className="text-2xs text-muted">只读 · 脱敏 · 不含正文和凭据</span>} bodyClassName="p-0">
    {status === "loading" ? <SkeletonRows rows={5} /> : status === "error" ? <EmptyState icon={<ScrollText />} title="审计记录暂不可读" body={error === "not_found" || error === "operation_not_allowed" ? "当前服务版本尚未提供审计读取接口。" : `读取失败（${error}）`} /> : rows.length === 0 ? <EmptyState icon={<ScrollText />} title="还没有审计记录" /> : <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead><tr className="border-b border-line bg-panel-soft text-left text-2xs text-muted"><th scope="col" className="px-5 py-2 font-medium">时间</th><th scope="col" className="px-3 py-2 font-medium">动作</th><th scope="col" className="px-3 py-2 font-medium">执行者</th><th scope="col" className="px-3 py-2 font-medium">目标 · 用途</th><th scope="col" className="px-5 py-2 font-medium">结果</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => <tr key={row.id}>
              <td className="whitespace-nowrap px-5 py-2.5 text-ink-soft tabular" title={formatFullTime(row.occurred_at)}>{formatRelative(row.occurred_at)}</td>
              <td className="px-3 py-2.5 font-medium">{auditActionLabels[row.action] || row.action}{row.owner && <span className="ml-1.5 text-2xs font-normal text-muted">{ownerLabel(row.owner)}</span>}</td>
              <td className="max-w-[180px] truncate px-3 py-2.5 font-mono text-2xs text-muted" title={row.actor}>{row.actor}</td>
              <td className="max-w-[260px] px-3 py-2.5"><span className="block truncate font-mono text-2xs">{row.target_ref || "—"}</span>{row.purpose && <span className="block truncate text-2xs text-muted">{row.purpose}</span>}</td>
              <td className="px-5 py-2.5"><Pill tone={outcomeTone[row.outcome as keyof typeof outcomeTone] || "neutral"}>{outcomeLabels[row.outcome] || row.outcome}</Pill>{row.error_code && <span className="ml-1.5 font-mono text-2xs text-muted">{row.error_code}</span>}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {next !== null && <div className={cx("border-t border-line px-5 py-3")}><Button size="sm" variant="ghost" disabled={loadingMore} onClick={() => void more()} icon={loadingMore ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <ChevronDown className="size-3.5" />}>加载更早记录</Button></div>}
    </>}
  </Panel>;
}
