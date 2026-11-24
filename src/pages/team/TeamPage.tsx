import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Dialog } from "radix-ui";
import { ArrowRight, Building2, CircleAlert, KeyRound, LockKeyhole, LogOut, ShieldCheck, UsersRound } from "../../icons";
import { api, errorCode } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { Button, Facts, InlineNotice, Input, PageToolbar, Panel, Pill, Unknown, ownerLabel } from "../../components/ui";
import { initials } from "../../shared/read-model/format";
import { accountError } from "../../shared/account-errors";
import { useKeyReveal } from "../../app/key-reveal";

/** The old team page's tabs live on the members and administration page now. */
const movedTabs: Record<string, string> = { collaboration: "organizations", members: "members", audit: "audit" };

/** My account: who I am, the scopes I can see, and my own access key. Accounts of other people are managed under 成员与管理. */
export default function TeamPage() {
  const [params] = useSearchParams();
  const moved = movedTabs[params.get("tab") || ""];
  if (moved) {
    const next = new URLSearchParams(params);
    next.set("tab", moved);
    return <Navigate to={`/admin?${next}`} replace />;
  }
  return <div className="page-enter space-y-5" data-page="team">
    <h1 className="sr-only">我的账号</h1>
    <PageToolbar lead="你是谁，能看到哪些范围。" summary="当前登录的身份和能看的范围。角色和范围由服务端决定，浏览器不能自己声明。" />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="space-y-5 self-start">
        <IdentityPanel />
        <AccessKeyPanel />
      </div>
      <div className="space-y-5">
        <ScopesPanel />
        <MembersLink />
      </div>
    </div>
  </div>;
}

function IdentityPanel() {
  const { session, logout, isAdmin } = useWorkspace();
  if (!session) return null;
  return <Panel
    title="当前身份"
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
      <InlineNotice tone="neutral" icon={<LockKeyhole />}>角色由服务端会话派生，浏览器不能自报角色或范围；各个工具仍按自己的授权判断能否读取。</InlineNotice>
    </div>
  </Panel>;
}

/** The person's own key. An organization sign-in has none here: the organization manages that credential. */
function AccessKeyPanel() {
  const { session } = useWorkspace();
  const [asking, setAsking] = useState(false);
  const reveal = useKeyReveal();
  const [params, setParams] = useSearchParams();
  const state = session?.own_key ?? "available";
  const available = state === "available";
  const asked = params.get("rotate") === "1";
  useEffect(() => {
    if (!asked) return;
    if (available) setAsking(true);
    setParams((current) => { const next = new URLSearchParams(current); next.delete("rotate"); return next; }, { replace: true });
  }, [asked, available, setParams]);
  if (!session?.username) return null;
  const username = session.username;
  return <Panel title="访问 Key" actions={<KeyRound className="size-4 text-muted" aria-hidden="true" />}>
    <div className="space-y-3 p-5" data-own-key>
      <p className="text-body-sm text-ink-soft">你用用户名 <span className="font-mono text-ink">@{username}</span> 和访问 Key 登录，没有密码。Key 可能泄露了，或者只是想换一个：在这里重置，旧 Key 马上失效，你在别处的登录都会退出。</p>
      {!available && <InlineNotice tone="neutral" icon={<LockKeyhole />}>{accountError(state)}</InlineNotice>}
      <Button icon={<KeyRound className="size-3.5" />} disabled={!available} disabledReason={available ? undefined : accountError(state)} onClick={() => setAsking(true)}>重置我的访问 Key</Button>
    </div>
    {asking && <RotateOwnKeyDialog onCancel={() => setAsking(false)} onRotated={(key) => {
      setAsking(false);
      reveal({ username, key, title: "你的新访问 Key", after: "你在别处的登录已经退出。点「完成」后这里也会退出，用新 Key 重新登录一次，确认它能用。", signOutAfter: true });
    }} />}
  </Panel>;
}

/** Asks for the key in use before a new one is made, so an unattended signed-in page cannot hand out a key. */
function RotateOwnKeyDialog({ onCancel, onRotated }: { onCancel: () => void; onRotated: (key: string) => void }) {
  const { session } = useWorkspace();
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || busy || !current) return;
    setBusy(true);
    setError(null);
    try {
      const rotated = await api.rotateOwnKey(current, session.csrf);
      setCurrent("");
      onRotated(rotated.access_key);
    } catch (failure) {
      setError(accountError(errorCode(failure)));
    } finally {
      setBusy(false);
    }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fade-in fixed inset-0 z-critical-scrim backdrop-blur-[1px]" style={{ background: "var(--scrim)" }} />
      <Dialog.Content data-own-key-dialog className="pop-in fixed left-1/2 top-1/2 z-critical w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[18px] border border-line bg-panel p-6 text-ink shadow-float outline-none">
        <form onSubmit={(event) => void submit(event)}>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-warning-soft text-warning"><KeyRound className="size-5" /></span>
            <div className="min-w-0">
              <Dialog.Title className="text-title-sm font-semibold">重置你的访问 Key</Dialog.Title>
              <Dialog.Description className="mt-1 text-body-sm text-muted">先填你现在用的 Key，确认是你本人。新 Key 只显示一次。</Dialog.Description>
            </div>
          </div>
          <label className="mt-5 block space-y-1.5">
            <span className="text-[13px] font-medium text-ink-soft">现在的访问 Key</span>
            <Input type="password" autoComplete="current-password" autoFocus value={current} onChange={(event) => setCurrent(event.target.value)} aria-label="现在的访问 Key" spellCheck={false} />
          </label>
          {error && <p role="alert" className="mt-3 flex items-start gap-2 rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild><Button variant="ghost" disabled={busy}>取消</Button></Dialog.Close>
            <Button type="submit" variant="primary" disabled={busy || !current}>{busy ? "正在重置…" : "重置并显示新 Key"}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function ScopesPanel() {
  const { session, scopeId, setScope } = useWorkspace();
  if (!session) return null;
  return <Panel title="授权范围" actions={<span className="text-meta text-muted">{session.scopes.length} 个</span>} bodyClassName="p-0">
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
  </Panel>;
}

function MembersLink() {
  const { isAdmin } = useWorkspace();
  const navigate = useNavigate();
  return <Panel title={isAdmin ? "账号、组织与审计" : "组织与团队"} bodyClassName="p-0">
    <button type="button" onClick={() => navigate(isAdmin ? "/admin?tab=accounts" : "/admin?tab=organizations")} className="group flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-150 hover:bg-panel-soft focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus/20">
      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-panel-sunken text-muted"><UsersRound className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-ink">成员与管理</span>
        <span className="block text-2xs text-muted">{isAdmin ? "新建账号、重置别人的 Key、停用和启用，组织与团队，以及审计记录" : "你所在的组织和团队，以及各个工具里的成员"}</span>
      </span>
      <ArrowRight className="size-4 text-muted transition-transform duration-150 group-hover:translate-x-0.5" />
    </button>
  </Panel>;
}
