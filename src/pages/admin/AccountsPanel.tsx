import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Dialog } from "radix-ui";
import { Ban, KeyRound, Link2, Pencil, RotateCcw, ShieldCheck, UserCheck, UserPlus, UserRound, UserX } from "../../icons";
import { useWorkspace, useScopedRead } from "../../app/workspace";
import { useListPreferences } from "../../app/preferences";
import { usePagedRows } from "../../app/use-paged-rows";
import { liveQuery } from "../../app/overlay-history";
import { api, errorCode, type PersonalInviteView, type PersonalUserView } from "../../shared/api/control-center-client";
import { ActionsMenu, Button, DataTable, EmptyState, InlineNotice, Pager, Panel, Pill, ReadStateView, SearchField, SkeletonRows, ToggleGroup, useToast, type Column, type ItemAction } from "../../components/ui";
import { formatFullTime, formatRelative, initials } from "../../shared/read-model/format";
import { pageSizes } from "../../shared/pager";
import { AccountForm } from "./AccountForm";
import { accountPatch, accountStatus, accountStatusCounts, roleLabels, statusWords, takenUsernames, visibleAccounts, type AccountDraft, type AccountStatus } from "../../shared/accounts";
import { useKeyReveal } from "../../app/key-reveal";
import { accountError } from "../../shared/account-errors";

type Status = AccountStatus | "all";
const statusTone = { active: "success", disabled: "neutral", duplicate: "warning" } as const;

/** Every personal account, managed from here: new, a new key shown once, disable and enable, name, role and scopes. */
export function AccountsPanel() {
  const { session, isAdmin } = useWorkspace();
  const notify = useToast();
  const read = useScopedRead((_scope, signal) => api.personalUsers(signal), { enabled: isAdmin && !!session?.username, key: "personal-users" });
  const invitesRead = useScopedRead((_scope, signal) => api.personalInvites(undefined, signal), { enabled: isAdmin && !!session?.username, key: "personal-invites" });
  const [params, setParams] = useSearchParams();
  const status = (["active", "disabled", "duplicate"] as const).find((value) => value === params.get("accounts-status")) || "all";
  const search = params.get("accounts-q") || "";
  const setFilter = (key: "accounts-status" | "accounts-q", value: string) => setParams((current) => {
    const next = new URLSearchParams(liveQuery(current));
    if (value && !(key === "accounts-status" && value === "all")) next.set(key, value); else next.delete(key);
    next.delete("accounts-page");
    return next;
  }, { replace: true });
  const setStatus = (value: Status) => setFilter("accounts-status", value);
  const setSearch = (value: string) => setFilter("accounts-q", value);
  const [form, setForm] = useState<{ user: PersonalUserView | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const setReveal = useKeyReveal();
  const [confirm, setConfirm] = useState<{ user: PersonalUserView; action: "rotate" | "revoke" } | null>(null);
  const { pageSize, setPageSize } = useListPreferences();
  // Every account change moves the session's epoch and the read starts over; the list keeps what it showed meanwhile, so
  // an open row menu or a form is not pulled away. Another scope never inherits it.
  const { scopeId } = useWorkspace();
  const shown = useRef<{ scope: string; data: NonNullable<typeof read.data> } | null>(null);
  if (read.data) shown.current = { scope: scopeId, data: read.data };
  const data = read.data || (shown.current?.scope === scopeId ? shown.current.data : null);
  const listStatus = data && read.status === "loading" ? "ready" : read.status;
  const users = useMemo(() => data?.users || [], [data]);
  const management = data?.management;
  const canManage = management?.enabled !== false;
  const canCreate = canManage && !management?.needs_owner_username;
  const counts = useMemo(() => accountStatusCounts(users), [users]);
  const visible = useMemo(() => visibleAccounts(users, status, search), [search, status, users]);
  const paged = usePagedRows(visible, pageSize, [], { prefix: "accounts-" });
  // A refused edit (`user_changed`) reads the list again; the open form then starts over from what is stored now.
  useEffect(() => {
    const editing = form?.user;
    if (!editing) return;
    const fresh = users.find((user) => user.username === editing.username);
    if (fresh && fresh.version !== editing.version) setForm({ user: fresh });
  }, [form?.user, users]);
  // 「新建账号」 from the command palette lands here with `new=1`: the form opens once and the address forgets it.
  const asked = params.get("new") === "1";
  useEffect(() => {
    if (!asked) return;
    if (canCreate && isAdmin) { setFormError(null); setForm({ user: null }); }
    setParams((current) => { const next = new URLSearchParams(current); next.delete("new"); return next; }, { replace: true });
  }, [asked, canCreate, isAdmin, setParams]);

  const run = async <T,>(work: () => Promise<T>, done: (value: T) => void) => {
    if (!session) return;
    setBusy(true);
    setFormError(null);
    try {
      done(await work());
      read.reload();
      invitesRead.reload();
    } catch (error) {
      const code = errorCode(error);
      if (form) setFormError(accountError(code)); else notify(accountError(code), "warning");
      if (code === "user_changed") read.reload();
    } finally {
      setBusy(false);
    }
  };
  const submit = (draft: AccountDraft) => {
    if (!session) return;
    const editing = form?.user;
    if (!editing) {
      void run(() => api.createPersonalUser(draft, session.csrf), (created) => {
        setForm(null);
        setReveal({
          username: created.user.username,
          key: created.access_key,
          inviteToken: created.invite_token,
          inviteExpiresAt: created.invite?.expires_at,
          title: `账号 @${created.user.username} 已创建`,
          after: "可直接复制免密直连链接发给对方一键进入；访问 Key 作为长期备用凭据。",
        });
      });
      return;
    }
    const patch = accountPatch(draft, editing);
    if (!Object.keys(patch).length) { setForm(null); return; }
    void run(() => api.updatePersonalUser(editing.username, { ...patch, if_match: editing.version || "" }, session.csrf), () => { setForm(null); notify(`已保存 @${editing.username} 的修改`, "success"); });
  };
  const act = (user: PersonalUserView, action: "rotate" | "revoke" | "enable") => {
    if (!session) return;
    if (action === "enable") { void run(() => api.enablePersonalUser(user.username, session.csrf), () => notify(`已启用 @${user.username}`, "success")); return; }
    setConfirm({ user, action });
  };
  const confirmAction = () => {
    if (!confirm || !session) return;
    const { user, action } = confirm;
    setConfirm(null);
    if (action === "rotate") void run(() => api.rotatePersonalUser(user.username, session.csrf), (rotated) => setReveal({ username: user.username, key: rotated.access_key, title: `@${user.username} 的新 Key`, after: "旧 Key 已经不能用了，这个账号已登录的地方都会退出。" }));
    else void run(() => api.revokePersonalUser(user.username, session.csrf), () => notify(`已停用 @${user.username}，它已登录的地方都会退出`, "success"));
  };

  const issueInviteFor = (username: string) => {
    if (!session) return;
    void run(
      () => api.createPersonalInvite({ username, label: "管理台签发邀请", ttl_hours: 168 }, session.csrf),
      (created) =>
        setReveal({
          username,
          inviteToken: created.invite_token,
          inviteExpiresAt: created.invite.expires_at,
          title: `@${username} 的一次性免密邀请链接`,
          after: "链接 7 天内单次打开有效，不影响该账号原有的长期访问 Key。",
        }),
    );
  };
  const revokeInvite = (invite: PersonalInviteView) => {
    if (!session) return;
    void run(
      () => api.revokePersonalInvite(invite.id, session.csrf),
      () => notify(`已撤回 @${invite.username} 的邀请链接，由该链接建立的会话已同步退出`, "success"),
    );
  };
  const self = session?.username;
  const actionsFor = (user: PersonalUserView): ItemAction[] => !canManage ? [] : [
    { id: "invite", label: "生成一次性免密邀请链接", icon: <Link2 />, group: "key", disabled: !user.enabled, disabledReason: !user.enabled ? "账号当前已停用" : undefined, run: () => issueInviteFor(user.username) },
    { id: "edit", label: "编辑名字、角色和范围", icon: <Pencil />, group: "edit", run: () => { setFormError(null); setForm({ user }); } },
    { id: "rotate", label: "重置访问 Key", icon: <KeyRound />, group: "key", run: () => act(user, "rotate") },
    user.enabled
      ? { id: "revoke", label: "停用账号", icon: <UserX />, tone: "danger", group: "state", disabled: user.username === self, disabledReason: user.username === self ? "不能停用自己" : undefined, run: () => act(user, "revoke") }
      : { id: "enable", label: "启用账号", icon: <UserCheck />, group: "state", disabled: !!user.duplicate, disabledReason: user.duplicate ? "重名，先用命令行修正" : undefined, run: () => act(user, "enable") },
  ];
  const columns: Column<PersonalUserView>[] = [
    { id: "user", header: "账号", label: "账号", cell: (user) => <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-panel-sunken text-2xs font-semibold text-muted">{initials(user.name)}</span>
      <span className="min-w-0"><span className="block truncate font-medium text-ink">{user.name}{user.username === self && <span className="ml-1.5 text-2xs font-normal text-muted">（你）</span>}</span><span className="block truncate font-mono text-2xs text-muted">@{user.username}</span></span>
    </span> },
    { id: "role", header: "角色", label: "角色", cell: (user) => <Pill size="sm" tone={user.role === "admin" ? "info" : "neutral"} icon={user.role === "admin" ? <ShieldCheck /> : <UserRound />}>{roleLabels[user.role]}</Pill> },
    { id: "status", header: "状态", label: "状态", cell: (user) => <Pill size="sm" tone={statusTone[accountStatus(user)]}>{statusWords[accountStatus(user)]}</Pill> },
    { id: "scopes", header: "范围", label: "范围", priority: 2, cell: (user) => <span className="block max-w-[240px] truncate text-2xs text-ink-soft" title={user.scope_ids.join("、")}>{user.scope_ids.join("、")}</span> },
    { id: "key", header: "Key 上次重置", label: "Key 上次重置", priority: 3, cell: (user) => <span className="tabular whitespace-nowrap text-2xs text-muted" title={user.key_rotated_at ? formatFullTime(user.key_rotated_at) : undefined}>{user.key_rotated_at ? formatRelative(user.key_rotated_at) : user.created_at ? `创建于 ${formatRelative(user.created_at)}` : "未记录"}</span> },
    { id: "actions", header: <span className="sr-only">操作</span>, label: "操作", align: "end", cell: (user) => <ActionsMenu actions={actionsFor(user)} label={`账号 @${user.username} 的操作`} /> },
  ];

  if (!isAdmin) return <EmptyState icon={<Ban />} title="只有管理员能管账号" />;
  return <div className="space-y-4" data-accounts>
    {management && !management.enabled && <InlineNotice tone="info">{accountError(management.reason || "user_management_unavailable")} 下面的列表仍然可以看。</InlineNotice>}
    {management?.enabled && management.needs_owner_username && <InlineNotice tone="warning">{accountError("owner_username_required")}</InlineNotice>}
    <Panel
      title="账号"
      actions={<Button size="sm" variant="primary" icon={<UserPlus className="size-3.5" />} disabled={!canCreate} disabledReason={canCreate ? undefined : canManage ? "主账号还没有用户名" : "账号管理已关闭"} onClick={() => { setFormError(null); setForm({ user: null }); }}>新建账号</Button>}
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <ToggleGroup<Status> label="账号状态" value={status} onChange={setStatus} options={[{ id: "all", label: "全部", count: counts.all }, { id: "active", label: "有效", count: counts.active }, { id: "disabled", label: "已停用", count: counts.disabled }, ...(counts.duplicate ? [{ id: "duplicate" as const, label: "重名", count: counts.duplicate }] : [])]} />
        <SearchField value={search} onChange={setSearch} placeholder="用户名、显示名或范围" label="搜索账号" className="ml-auto w-full sm:w-64" />
      </div>
      <ReadStateView status={listStatus} error={read.error} onRetry={read.reload} skeleton={<SkeletonRows rows={3} />}>
        {management?.legacy_owner && <div className="flex items-center gap-3 border-b border-line bg-panel-soft/60 px-4 py-3" data-legacy-owner>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-panel-sunken text-2xs font-semibold text-muted">{initials(management.legacy_owner.name)}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-body-sm font-medium text-ink">{management.legacy_owner.name}</span><span className="block truncate text-2xs text-muted">@{management.legacy_owner.username} · 配置文件里的主账号 · {roleLabels[management.legacy_owner.role]}</span></span>
          {canManage && !management.needs_owner_username && (
            <Button size="sm" variant="ghost" icon={<Link2 className="size-3.5" />} onClick={() => issueInviteFor(management.legacy_owner!.username)}>
              生成本机免密链接
            </Button>
          )}
          <Pill size="sm" tone="neutral">用命令行管理</Pill>
        </div>}
        <DataTable
          label="账号列表"
          columns={columns}
          rows={paged.rows}
          rowKey={(user) => user.username}
          rowAttributes={(user) => ({ "data-account": user.username })}
          rowActions={actionsFor}
          empty={<EmptyState compact icon={<UserRound />} title={users.length ? "没有符合条件的账号" : "还没有其他账号"} body={users.length ? "换个状态或搜索词。" : "点「新建账号」，给同事或 Agent 建一个自己的账号。"} />}
        />
        {visible.length > 0 && <Pager window={paged} onPage={paged.setPage} noun="个账号" pageSize={pageSize} pageSizes={pageSizes} onPageSize={(value) => { setPageSize(value as typeof pageSize); paged.setPage(1); }} />}
      </ReadStateView>
    </Panel>
    {invitesRead.data && invitesRead.data.invites.length > 0 && (
      <Panel
        title="一次性免密邀请记录"
        actions={<span className="text-meta text-muted">{invitesRead.data.invites.length} 条</span>}
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-line" data-invite-list>
          {invitesRead.data.invites.slice(0, 12).map((inv) => {
            const stateMap = {
              pending: { text: "待打开", tone: "info" as const },
              consumed: { text: "已单次使用", tone: "success" as const },
              expired: { text: "已过期", tone: "neutral" as const },
              revoked: { text: "已撤回", tone: "warning" as const },
            }[inv.state];
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-invite={inv.id}>
                <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-panel-sunken text-muted">
                  <Link2 className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-ink">
                    <span className="font-mono">@{inv.username}</span>
                    {inv.label && <span className="text-2xs font-normal text-muted">· {inv.label}</span>}
                  </span>
                  <span className="block text-2xs text-muted tabular">
                    有效期至 {formatFullTime(inv.expires_at)}
                    {inv.consumed_at ? ` · 使用于 ${formatRelative(inv.consumed_at)}` : ""}
                  </span>
                </span>
                <Pill size="sm" tone={stateMap.tone}>{stateMap.text}</Pill>
                {canManage && inv.state !== "revoked" && inv.state !== "expired" && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => revokeInvite(inv)}>
                    {inv.state === "consumed" ? "撤回并踢下线" : "撤回链接"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    )}
    {form && session && <AccountForm key={form.user ? `${form.user.username}:${form.user.version || ""}` : "new"} open initial={form.user} scopes={data?.scopes || session.scopes} taken={takenUsernames(users, management)} busy={busy} error={formError} onCancel={() => setForm(null)} onSubmit={submit} />}
    {confirm && <ConfirmAccountAction confirm={confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={confirmAction} />}
  </div>;
}

function ConfirmAccountAction({ confirm, busy, onCancel, onConfirm }: { confirm: { user: PersonalUserView; action: "rotate" | "revoke" }; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const rotate = confirm.action === "rotate";
  return <InlineConfirm
    title={rotate ? `重置 @${confirm.user.username} 的访问 Key？` : `停用 @${confirm.user.username}？`}
    body={rotate ? "旧 Key 马上失效，这个账号已登录的地方都会退出。新 Key 只显示一次。" : "这个账号马上不能登录，已登录的地方都会退出。以后可以再启用。"}
    confirmLabel={rotate ? "重置并显示新 Key" : "停用账号"}
    danger={!rotate}
    busy={busy}
    icon={rotate ? <RotateCcw className="size-5" /> : <UserX className="size-5" />}
    onCancel={onCancel}
    onConfirm={onConfirm}
  />;
}

/** A small confirm dialog on the critical layer, for actions that end sessions or change who can sign in. */
export function InlineConfirm({ title, body, confirmLabel, danger, busy, icon, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; danger?: boolean; busy?: boolean; icon?: ReactNode; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fade-in fixed inset-0 z-critical-scrim backdrop-blur-[1px]" style={{ background: "var(--scrim)" }} />
      <Dialog.Content data-account-confirm className="pop-in fixed left-1/2 top-1/2 z-critical w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[18px] border border-line bg-panel p-6 text-ink shadow-float outline-none">
        <div className="flex items-start gap-3">
          {icon && <span className={danger ? "grid size-10 shrink-0 place-items-center rounded-[12px] bg-danger-soft text-danger" : "grid size-10 shrink-0 place-items-center rounded-[12px] bg-warning-soft text-warning"}>{icon}</span>}
          <div className="min-w-0">
            <Dialog.Title className="text-title-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-body-sm text-muted">{body}</Dialog.Description>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Dialog.Close asChild><Button variant="ghost">取消</Button></Dialog.Close>
          <Button variant={danger ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>{busy ? "正在处理…" : confirmLabel}</Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
