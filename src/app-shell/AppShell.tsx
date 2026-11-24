import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Archive, Bell, BellOff, BellRing, Building2, Check, ChevronsUpDown, LogOut,
  RefreshCw, Search, UserRound, ArrowRight,
} from "../icons";
import { entryOf, entryPages, navItem, pageFromPath, type WorkspacePage } from "./navigation";
import { useWorkspace } from "../app/workspace";
import { useTasks } from "../app/tasks-context";
import { useNotifications } from "../app/notifications-context";
import { api, errorCode, type TaskNotification } from "../shared/api/control-center-client";
import { ActionsContextMenu, Button, DetailSheet, Dot, Kbd, MenuChoiceRow, MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger, PopoverContent, PopoverRoot, PopoverTrigger, cx, ownerLabel, type ItemAction } from "../components/ui";
import { linkActions, useCopy } from "../app/item-actions";
import { cjkSpaced, formatRelative, initials } from "../shared/read-model/format";
import { countsAsUnread, isSnoozed, reminderKind, reminderKindLabels, reminderStateLabel } from "../notifications";
import { reopenActions, snoozeActions } from "../app/reminder-actions";
import { useTheme } from "./theme";
import { CommandSearch } from "./CommandSearch";
import { modKeyLabel } from "../shared/platform";
import { AudioDock } from "../components/AudioDock";
import { LeaderHint, useKeymap, useKeymapDispatcher } from "../app/keymap";
import { chordTokens } from "../shared/keymap";
import { sourceStatus } from "../shared/source-status";
import { connectionTone } from "../shared/read-model/tasks";
import { ShortcutSheet } from "./ShortcutSheet";
import { MainNav, themeOptions, usePageBadges } from "./MainNav";
import { useSlidingIndicator } from "../app/use-sliding-indicator";

/** Focus <main> for the skip link. It is focusable only while focused: a permanent tabindex would make every click on page text focus it. */
function focusMain() {
  const main = document.getElementById("main");
  if (!main) return;
  main.tabIndex = -1;
  main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
  main.focus();
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageFromPath(location.pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Dialogs and open menus own the keyboard; page shortcuts wait until they close (see the keymap dispatcher).
  const keys = useKeymapDispatcher({ search: () => setSearchOpen(true), shortcuts: () => setShortcutsOpen(true) });

  const go = (target: WorkspacePage) => navigate(target === "home" ? "/" : `/${target}`);

  return <div
    className="flex min-h-dvh bg-canvas"
    style={{ "--workspace-left": "var(--rail-width)" } as React.CSSProperties}
  >
    {/* With hash routing `#main` is a route, so the skip link moves focus itself instead of following the href. */}
    <a href="#main" onClick={(event) => { event.preventDefault(); focusMain(); }} className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-skip focus:rounded-control focus:bg-panel focus:px-3 focus:py-2 focus:shadow-float">跳到主要内容</a>
    <MainNav page={page} onNavigate={go} />
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar page={page} onOpenSearch={() => setSearchOpen(true)} onNavigate={go} />
      <main id="main" className="min-w-0 w-full flex-1 px-[var(--content-gutter)] pb-[calc(4rem+var(--workspace-bottom,0px))] pt-5 outline-none lg:pt-7">
        {children}
      </main>
    </div>
    <AudioDock />
    {searchOpen && <CommandSearch onClose={() => setSearchOpen(false)} onNavigate={(target) => { setSearchOpen(false); navigate(target); }} onShowShortcuts={() => { setSearchOpen(false); setShortcutsOpen(true); }} />}
    <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    <LeaderHint leader={keys.leader} hints={keys.hints} />
  </div>;
}

/** The pages inside the current entry, in the top bar so they never push a page's first result down. */
function SectionTabs({ page, onNavigate }: { page: WorkspacePage; onNavigate: (page: WorkspacePage) => void }) {
  const entry = entryOf(page);
  const pages = entryPages(entry.id);
  const badgeOf = usePageBadges();
  const copy = useCopy();
  const { ref, ready, indicator } = useSlidingIndicator<HTMLUListElement>('[data-nav][aria-current="page"]', page, "rounded-full bg-panel shadow-[0_1px_2px_rgb(0_0_0/10%)]");
  if (pages.length < 2) return <p className="min-w-0 truncate font-display text-[17px] font-semibold text-ink">{navItem(page).short}</p>;
  return <nav aria-label={`${entry.label}分区`} className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <ul ref={ref} data-indicator-ready={ready ? "" : undefined} className="relative flex items-center gap-0.5 rounded-full bg-panel-sunken/70 p-0.5">
      {indicator}
      {pages.map((item) => {
        const active = item.id === page;
        const badge = badgeOf(item.id);
        return <ActionsContextMenu key={item.id} actions={linkActions(`/${item.id}`, copy)}><li className="shrink-0">
          <button
            type="button"
            data-nav={item.id}
            data-badge={badge || undefined}
            aria-current={active ? "page" : undefined}
            title={item.description}
            onClick={() => onNavigate(item.id)}
            className={cx(
              "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
              active ? cx("text-ink", !ready && "bg-panel shadow-[0_1px_2px_rgb(0_0_0/10%)]") : "text-muted hover:text-ink",
            )}
          >
            {item.short}
            {badge > 0 && <span className="rounded-full bg-accent px-1.5 text-2xs font-semibold leading-[18px] text-accent-ink tabular">{badge > 99 ? "99+" : badge}</span>}
          </button>
        </li></ActionsContextMenu>;
      })}
    </ul>
  </nav>;
}

/** A shared project's scope repeats its id as its project; the id stays in the tooltip and the project's 连接 tab. */
export function scopeSubtitle(scope?: { id: string; project?: string } | null) {
  if (!scope) return "授权范围";
  if (scope.id.startsWith("project_")) return "共享项目";
  return scope.project ? `项目 ${scope.project}` : "授权范围";
}

function ScopeSwitcher() {
  const { session, scope, scopeId, setScope } = useWorkspace();
  if (!session) return null;
  const label = scope?.label || "未选择范围";
  return <MenuRoot>
    <MenuTrigger asChild>
      {/* Named by its own text (the scope and its project), so the name always contains what the button shows. */}
      <button type="button" className="flex h-10 min-w-0 shrink items-center gap-2 rounded-full border border-line bg-panel py-1 pl-1 pr-2 text-left shadow-[0_1px_0_rgb(255_255_255/4%)_inset] transition-colors hover:border-line-strong md:pr-3">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-semibold text-primary-ink">{initials(label.replace(/^Fixture\s*·\s*/, ""))}</span>
        <span className="hidden min-w-0 max-w-[13rem] md:block">
          <span className="sr-only">当前授权范围：</span>
          <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{label}</span>
          <span className="block truncate text-2xs leading-tight text-muted" title={scope?.id}>{scopeSubtitle(scope)}</span>
          <span className="sr-only">，切换范围</span>
        </span>
        <span className="sr-only md:hidden">当前授权范围：{label}，切换范围</span>
        <ChevronsUpDown className="hidden size-4 shrink-0 text-faint md:block" />
      </button>
    </MenuTrigger>
    <MenuContent align="start" className="w-64">
      <MenuLabel>授权范围（由服务端会话提供）</MenuLabel>
      {session.scopes.map((item) => <MenuItem key={item.id} onSelect={() => item.id !== scopeId && setScope(item.id)} icon={<Building2 />}>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.label}</span>
          <span className="block truncate text-2xs text-muted">{[item.tenant, item.project].filter(Boolean).join(" / ") || item.id}</span>
        </span>
        {item.id === scopeId && <Check className="!text-success" />}
      </MenuItem>)}
    </MenuContent>
  </MenuRoot>;
}


/** The search binding as the top bar shows it: ⌘K on Apple, Ctrl K elsewhere, or whatever it was changed to. */
function searchKeyLabel(keymap: ReturnType<typeof useKeymap>) {
  const modifier = modKeyLabel();
  const tokens = chordTokens(keymap.search?.[0] || "Mod+K", modifier);
  return modifier === "⌘" ? tokens.join("") : tokens.join(" ");
}

function Topbar({ page, onOpenSearch, onNavigate }: { page: WorkspacePage; onOpenSearch: () => void; onNavigate: (page: WorkspacePage) => void }) {
  const keymap = useKeymap();
  return <header className="sticky top-0 z-sticky flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-line/70 bg-canvas/85 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
    <ScopeSwitcher />
    <SectionTabs page={page} onNavigate={onNavigate} />
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <button type="button" onClick={onOpenSearch} className="hidden h-10 w-60 items-center gap-2 rounded-full border border-line bg-panel px-3.5 text-[13px] text-faint transition-colors hover:border-line-strong xl:flex">
        <Search className="size-4" />
        <span className="flex-1 text-left">搜索作品、任务或页面</span>
        <Kbd>{searchKeyLabel(keymap)}</Kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="xl:hidden" aria-label="搜索" onClick={onOpenSearch}><Search className="size-[18px]" /></Button>
      <SourceHealth onNavigate={onNavigate} />
      <AttentionPopover onNavigate={onNavigate} />
      <IdentityMenu onNavigate={onNavigate} />
    </div>
  </header>;
}

/** The scope's task source status: one place for every page, on every width. Pages add at most one line about what they lack. */
function SourceHealth({ onNavigate }: { onNavigate: (page: WorkspacePage) => void }) {
  const tasks = useTasks();
  const { refresh } = useWorkspace();
  const [open, setOpen] = useState(false);
  const status = sourceStatus(tasks);
  const reasons = new Map(status.gaps.map((gap) => [gap.id, gap.reason]));
  return <PopoverRoot open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`来源状态：${status.label}`} className="flex h-9 items-center gap-2 rounded-control px-2.5 text-[13px] text-ink-soft hover:bg-panel-sunken" data-source-status={status.kind}>
        <Dot tone={status.tone} />
        <span className="hidden tabular xl:inline">{status.label}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent label="来源状态" className="w-80 p-0">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="text-[13px] font-semibold">任务连接</p>
          <p className="text-2xs text-muted">{status.kind === "stale" ? `最近一次读取失败，显示的是${cjkSpaced(tasks.observedAt ? formatRelative(tasks.observedAt) : "较早")}的结果` : tasks.observedAt ? `观察于 ${formatRelative(tasks.observedAt)}` : "尚未完成观察"}</p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="重新观察" onClick={() => { tasks.refresh(); refresh(); }}><RefreshCw className={cx("size-4", tasks.refreshing && "motion-safe:animate-spin")} /></Button>
      </div>
      {/* Scrolls once a scope reads more than a handful of connections; focusable so keyboards can scroll it too. */}
      <ul tabIndex={0} aria-label="任务连接列表" className="max-h-72 divide-y divide-line overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
        {tasks.connections.length ? tasks.connections.map((connection) => {
          const reason = reasons.get(connection.id);
          return <li key={connection.id} className="flex items-center gap-3 px-4 py-2.5">
            <Dot tone={reason ? connectionTone(connection.state) : "success"} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{connection.label}</span>
              <span className="block truncate text-2xs text-muted">{ownerLabel(connection.owner)} · {connection.environment} · {connection.project}</span>
            </span>
            <span className={cx("shrink-0 text-2xs", reason ? "text-warning" : "text-success")}>{reason || "可读"}</span>
          </li>;
        }) : <li className="px-4 py-6 text-center text-[13px] text-muted">这个范围还没有读到任务连接。项目关联工具后，下一轮观察就会出现在这里。</li>}
      </ul>
      <div className="border-t border-line p-2">
        <Button variant="ghost" size="sm" className="w-full justify-between" onClick={() => { setOpen(false); onNavigate("services"); }}>查看服务与连接<ArrowRight className="size-4" /></Button>
      </div>
    </PopoverContent>
  </PopoverRoot>;
}

function AttentionPopover({ onNavigate }: { onNavigate: (page: WorkspacePage) => void }) {
  const reminders = useNotifications();
  const { session } = useWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [limit, setLimit] = useState(10);
  const [failure, setFailure] = useState("");
  const [mobile, setMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => { const query = matchMedia("(max-width: 639px)"); const update = () => setMobile(query.matches); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  const filtered = reminders.rows.filter((item) => all || countsAsUnread(item));
  const openItem = (item: TaskNotification) => {
    if (!session) return;
    void api.readNotification(item.scope_id, item.id, session.csrf).then(({ notification }) => { reminders.update(notification); setOpen(false); navigate(notification.target_path || `/tasks?task=${encodeURIComponent(notification.task_key)}`); }).catch((error) => setFailure(errorCode(error)));
  };
  // The same handling as on the reminders page, without leaving the popover.
  const handle = (item: TaskNotification, action: "acknowledge" | "mute" | "archive" | "reopen" | "snooze", until = "") => {
    if (!session) return;
    setFailure("");
    // A re-read that began before this action may carry the state from before it: from here on it is dropped.
    reminders.beginChange();
    const update = ({ notification }: { notification: TaskNotification }) => reminders.update(notification);
    const done = action === "acknowledge" ? api.acknowledgeNotification(item.scope_id, item.id, session.csrf).then(update)
      : action === "archive" ? api.archiveNotification(item.scope_id, item.id, session.csrf).then(update)
        : action === "reopen" ? api.reopenNotification(item.scope_id, item.id, session.csrf).then(update)
          : action === "snooze" ? api.snoozeNotification(item.scope_id, item.id, until, session.csrf).then(update)
            : api.muteNotification(item.scope_id, item.id, session.csrf, "fingerprint").then(() => reminders.refresh());
    void done.catch((error) => setFailure(errorCode(error)));
  };
  const openLabels = { failure: "打开任务", operation: "查看服务", credential: "查看凭据状态", collaboration: "打开" } as const;
  const itemActions = (item: TaskNotification): ItemAction[] => {
    const kind = reminderKind(item);
    return [
      { id: "open", label: openLabels[kind], icon: <ArrowRight />, group: "open", run: () => openItem(item) },
      // Collaboration reminders (a batch finished, a project was shared) have nothing to confirm or mute, only to open.
      ...(kind !== "collaboration" ? [{ id: "acknowledge", label: "确认", icon: <Check />, group: "resolve", disabled: item.state === "acknowledged", run: () => handle(item, "acknowledge") }] : []),
      ...(kind === "failure" ? [{ id: "mute", label: "仅对这次失败免提醒", icon: <BellOff />, group: "resolve", disabled: item.state === "muted", run: () => handle(item, "mute") }] : []),
      ...(kind !== "collaboration" ? [{ id: "archive", label: "归档", icon: <Archive />, group: "resolve", disabled: item.state === "archived", run: () => handle(item, "archive") }] : []),
      ...reopenActions(item, () => handle(item, "reopen")),
      ...snoozeActions(item, (until) => handle(item, "snooze", until)),
      { id: "reminders", label: "在提醒中心查看", icon: <BellRing />, group: "more", run: () => { setOpen(false); navigate(`/reminders?focus=${encodeURIComponent(item.id)}`); } },
    ];
  };
  /** Where a reminder comes from, in the line under its title. */
  const sourceLine = (item: TaskNotification) => {
    const kind = reminderKind(item);
    return kind === "failure" ? `${ownerLabel(item.owner)} · ${reminderStateLabel(item)}` : kind === "collaboration" ? "项目协作" : `${ownerLabel(item.owner)} · ${reminderKindLabels[kind]}`;
  };
  const content = <div className="min-w-0">
    <div className="border-b border-line px-4 py-3"><p className="text-[13px] font-semibold">通知 · {reminders.unread} 条未读</p><p className="text-2xs text-muted">{reminders.error ? "部分来源暂不可用" : reminders.syncing ? "正在核验来源" : "阅读通知不会确认处理提醒"}</p></div>
    <div className="flex gap-2 p-2"><Button size="sm" variant={!all ? "secondary" : "ghost"} onClick={() => { setAll(false); setLimit(10); }}>未读</Button><Button size="sm" variant={all ? "secondary" : "ghost"} onClick={() => { setAll(true); setLimit(10); }}>全部</Button></div>
    {failure && <p role="alert" className="px-4 text-xs text-danger">{failure}</p>}
    {filtered.length ? <ul className="max-h-[60dvh] divide-y divide-line overflow-y-auto">{filtered.slice(0, limit).map((item) => <ActionsContextMenu key={item.id} actions={itemActions(item)}><li data-notification={item.id}><button className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left hover:bg-panel-soft" onClick={() => openItem(item)}><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{item.title || item.task_key}</span><span className="block text-2xs text-muted">{sourceLine(item)} · {countsAsUnread(item) ? "未读" : isSnoozed(item) ? "稍后提醒" : item.recovered_at ? "已恢复" : "已读"}</span></span>{countsAsUnread(item) && <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent" />}</button></li></ActionsContextMenu>)}</ul> : <p className="p-8 text-center text-sm text-muted">{all ? "暂无通知" : "没有未读通知"}</p>}
    {(filtered.length > limit || reminders.hasMore) && <Button size="sm" variant="ghost" className="w-full" onClick={() => { setLimit((n) => n + 10); if (filtered.length <= limit) reminders.loadMore(); }}>加载更多</Button>}
    <div className="border-t border-line p-2"><Button variant="ghost" size="sm" className="w-full justify-between" onClick={() => { setOpen(false); onNavigate("reminders"); }}>打开提醒中心<ArrowRight className="size-4" /></Button></div>
  </div>;
  const trigger = <Button variant="ghost" size="icon-sm" aria-label={reminders.unread ? `需要关注 ${reminders.unread} 项` : "需要关注"} className="relative" data-attention-count={reminders.unread} onClick={() => setOpen(true)}><Bell className="size-[18px]" />{reminders.unread > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-danger ring-2 ring-canvas" />}</Button>;
  return mobile ? <>{trigger}<DetailSheet open={open} onOpenChange={setOpen} title="通知">{content}</DetailSheet></> : <PopoverRoot open={open} onOpenChange={setOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger><PopoverContent label="通知" className="w-[min(360px,calc(100vw-24px))] p-0">{content}</PopoverContent></PopoverRoot>;
}

function IdentityMenu({ onNavigate }: { onNavigate: (page: WorkspacePage) => void }) {
  const { session, logout } = useWorkspace();
  const { preference, setPreference } = useTheme();
  if (!session) return null;
  const roleLabel = session.role === "admin" ? "管理员" : "成员";
  return <MenuRoot>
    <MenuTrigger asChild>
      <button type="button" aria-label={`当前身份：${session.name}`} className="ml-1 grid size-8 place-items-center rounded-full bg-primary text-[13px] font-semibold text-primary-ink ring-2 ring-transparent transition-shadow hover:ring-line-strong">{initials(session.name)}</button>
    </MenuTrigger>
    <MenuContent className="w-72">
      <div className="flex items-center gap-3 px-2.5 py-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-ink">{initials(session.name)}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{session.name}</span>
          <span className="block truncate text-2xs text-muted">{session.username ? `@${session.username} · ` : ""}{roleLabel}</span>
        </span>
      </div>
      <p className="mx-2.5 mb-1.5 rounded-[10px] bg-panel-sunken px-2.5 py-2 text-2xs leading-4 text-muted">这里的角色只决定你在 Studio 里能看到和确认什么，不等于各个工具里的权限。</p>
      <MenuSeparator />
      {/* Theme as one row; the full appearance settings live in 设置 → 外观. */}
      <MenuChoiceRow label="主题" value={preference} options={themeOptions} onChange={setPreference} />
      <MenuSeparator />
      <MenuItem icon={<UserRound />} onSelect={() => onNavigate("team")}>我的账号</MenuItem>
      <MenuItem icon={<LogOut />} tone="danger" onSelect={() => void logout()}>退出登录</MenuItem>
    </MenuContent>
  </MenuRoot>;
}
