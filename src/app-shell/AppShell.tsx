import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Archive, Bell, BellOff, BellRing, BookOpen, Building2, Check, ChevronsUpDown, Clapperboard, ClipboardCheck, Cpu, FolderKanban, Images, LayoutDashboard, ListTodo, LogOut, Menu, Monitor, Moon,
  PanelLeftClose, PanelLeftOpen, RefreshCw, ScrollText, Search, ServerCog, ShieldCheck, Sparkles, Sun, UsersRound, Wallet, X, ArrowRight, History, Zap,
} from "../icons";
import { navItems, navItem, pageFromPath, type WorkspacePage } from "./navigation";
import { useWorkspace } from "../app/workspace";
import { useTasks } from "../app/tasks-context";
import { useNotifications } from "../app/notifications-context";
import { api, errorCode, type TaskNotification } from "../shared/api/control-center-client";
import { ActionsContextMenu, Button, DetailSheet, Dot, Kbd, MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger, PopoverContent, PopoverRoot, PopoverTrigger, TaskStatePill, cx, ownerLabel, type ItemAction } from "../components/ui";
import { linkActions, useCopy } from "../app/item-actions";
import { cjkSpaced, formatRelative, initials } from "../shared/read-model/format";
import { countsAsUnread, isSnoozed, reminderKind, reminderKindLabels, reminderStateLabel } from "../notifications";
import { reopenActions, snoozeActions } from "../app/reminder-actions";
import { useTheme, type ThemePreference } from "./theme";
import { useObservationCache } from "../app/observation-cache";
import { toolCatalogCacheKey, type ToolCatalog } from "../shared/tool-catalog";
import { AudioDock } from "../components/AudioDock";
import { useRecentItems } from "../app/recent";
import { shellShortcut } from "../shared/keyboard";
import { sourceStatus } from "../shared/source-status";
import { connectionTone } from "../shared/read-model/tasks";
import { ShortcutSheet } from "./ShortcutSheet";

const icons: Record<WorkspacePage, typeof LayoutDashboard> = {
  home: LayoutDashboard,
  projects: FolderKanban,
  drama: Clapperboard,
  guide: BookOpen,
  creation: Sparkles,
  assets: Images,
  tasks: ListTodo,
  reminders: BellRing,
  requests: ScrollText,
  review: ClipboardCheck,
  services: ServerCog,
  capabilities: Cpu,
  usage: Wallet,
  team: UsersRound,
};

const collapsedKey = "yeisme.control.sidebar";

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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapsedKey) === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => { localStorage.setItem(collapsedKey, collapsed ? "1" : "0"); }, [collapsed]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typeof event.key !== "string") return;
      // Dialogs and open menus own the keyboard; page shortcuts wait until they close.
      const shortcut = shellShortcut(event, document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null);
      if (shortcut === "search") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (shortcut === "page-search") {
        event.preventDefault();
        const field = [...document.querySelectorAll<HTMLInputElement>("#main [data-page-search]")].find((element) => element.getClientRects().length > 0);
        if (field) { field.focus(); field.select(); } else setSearchOpen(true);
      } else if (shortcut === "shortcuts") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (target: WorkspacePage) => navigate(target === "home" ? "/" : `/${target}`);

  return <div
    className="flex min-h-dvh bg-canvas"
    style={{ "--workspace-left": collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)" } as React.CSSProperties}
  >
    {/* With hash routing `#main` is a route, so the skip link moves focus itself instead of following the href. */}
    <a href="#main" onClick={(event) => { event.preventDefault(); focusMain(); }} className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-control focus:bg-panel focus:px-3 focus:py-2 focus:shadow-float">跳到主要内容</a>
    <Sidebar page={page} collapsed={collapsed} mobileOpen={mobileOpen} onNavigate={go} />
    {mobileOpen && <button aria-label="关闭导航" className="fade-in fixed inset-0 z-30 lg:hidden" style={{ background: "var(--scrim)" }} onClick={() => setMobileOpen(false)} />}
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar
        page={page}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onOpenMobile={() => setMobileOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onNavigate={go}
      />
      <main id="main" className="w-full flex-1 px-[var(--content-gutter)] pb-16 pt-6 outline-none lg:pt-7">
        {children}
      </main>
    </div>
    <AudioDock />
    {searchOpen && <CommandSearch onClose={() => setSearchOpen(false)} onNavigate={(target) => { setSearchOpen(false); navigate(target); }} onShowShortcuts={() => { setSearchOpen(false); setShortcutsOpen(true); }} />}
    <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
  </div>;
}

function Sidebar({ page, collapsed, mobileOpen, onNavigate }: { page: WorkspacePage; collapsed: boolean; mobileOpen: boolean; onNavigate: (page: WorkspacePage) => void }) {
  const groups = [...new Set(navItems.map((item) => item.group))];
  const tasks = useTasks();
  const reminders = useNotifications();
  const copy = useCopy();
  const review = tasks.rows.filter((task) => task.state === "waiting_review").length;
  return <aside
    aria-label="主导航"
    data-sidebar
    className={cx(
      "fixed inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] flex-col bg-sidebar text-sidebar-ink transition-[transform,width] duration-200 ease-out lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
      mobileOpen ? "translate-x-0 shadow-float" : "-translate-x-full",
      collapsed && "lg:w-[var(--sidebar-collapsed)]",
    )}
  >
    <div className={cx("flex h-[var(--topbar-height)] shrink-0 items-center gap-2.5 px-5", collapsed && "lg:justify-center lg:px-0")}>
      <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent text-[15px] font-bold text-accent-ink">Y</span>
      <span className={cx("min-w-0 leading-tight", collapsed && "lg:hidden")}>
        <strong className="block text-[15px] font-semibold tracking-tight text-white dark:text-sidebar-ink">Yeisme</strong>
        <span className="block text-2xs text-sidebar-muted">Control Center</span>
      </span>
    </div>
    <ScopeSwitcher collapsed={collapsed} />
    <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-4">
      {groups.map((group) => <div key={group} className="mt-4 first:mt-1">
        <p className={cx("mb-1 px-3 text-2xs font-medium text-sidebar-muted/80", collapsed && "lg:sr-only")}>{group}</p>
        <ul className="space-y-0.5">
          {navItems.filter((item) => item.group === group).map((item) => {
            const Icon = icons[item.id];
            const active = page === item.id;
            const badge = item.id === "reminders" ? reminders.unread : item.id === "review" ? review : 0;
            return <ActionsContextMenu key={item.id} actions={linkActions(`/${item.id}`, copy)}><li>
              <button
                type="button"
                data-nav={item.id}
                data-badge={badge || undefined}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                onClick={() => onNavigate(item.id)}
                className={cx(
                  "group relative flex h-9 w-full items-center gap-3 rounded-[9px] px-3 text-[13px] font-medium transition-colors duration-150",
                  active ? "bg-sidebar-active text-white dark:text-accent" : "text-sidebar-ink/80 hover:bg-sidebar-hover hover:text-white dark:hover:text-sidebar-ink",
                  collapsed && "lg:justify-center lg:px-0",
                )}
              >
                {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" />}
                <Icon className="size-[17px] shrink-0" strokeWidth={1.8} />
                <span className={cx("truncate", collapsed && "lg:sr-only")}>{item.label}</span>
                {badge > 0 && <span className={cx("ml-auto rounded-full bg-accent px-1.5 text-2xs font-semibold leading-[18px] text-accent-ink tabular", collapsed && "lg:absolute lg:right-1 lg:top-0.5 lg:ml-0 lg:px-1 lg:leading-4")}>{badge > 99 ? "99+" : badge}</span>}
              </button>
            </li></ActionsContextMenu>;
          })}
        </ul>
      </div>)}
    </nav>
    <SidebarFooter collapsed={collapsed} />
  </aside>;
}

function ScopeSwitcher({ collapsed }: { collapsed: boolean }) {
  const { session, scope, scopeId, setScope } = useWorkspace();
  if (!session) return null;
  const label = scope?.label || "未选择范围";
  return <div className={cx("px-3", collapsed && "lg:px-2")}>
    <MenuRoot>
      <MenuTrigger asChild>
        {/* Named by its own text (the scope and its project), so the name always contains what the button shows. */}
        <button type="button" className={cx("flex w-full items-center gap-2.5 rounded-[11px] border border-sidebar-line bg-white/[0.04] p-2 text-left transition-colors hover:bg-sidebar-hover", collapsed && "lg:justify-center lg:p-1.5")}>
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/10 text-[13px] font-semibold text-white dark:text-sidebar-ink">{initials(label.replace(/^Fixture\s*·\s*/, ""))}</span>
          <span className={cx("min-w-0 flex-1", collapsed && "lg:sr-only")}>
            <span className="sr-only">当前授权范围：</span>
            <span className="block truncate text-[13px] font-semibold text-white dark:text-sidebar-ink">{label}</span>
            <span className="block truncate text-2xs text-sidebar-muted">{scope?.project ? `项目 ${scope.project}` : "授权范围"} · 已授权</span>
            <span className="sr-only">，切换范围</span>
          </span>
          <ChevronsUpDown className={cx("size-4 shrink-0 text-sidebar-muted", collapsed && "lg:hidden")} />
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
    </MenuRoot>
  </div>;
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const { preference, setPreference } = useTheme();
  const options: { id: ThemePreference; label: string; icon: ReactNode }[] = [
    { id: "light", label: "浅色", icon: <Sun /> },
    { id: "dark", label: "深色", icon: <Moon /> },
    { id: "system", label: "跟随系统", icon: <Monitor /> },
  ];
  const current = options.find((item) => item.id === preference) || options[2];
  return <div className={cx("border-t border-sidebar-line p-3", collapsed && "lg:px-2")}>
    <MenuRoot>
      <MenuTrigger asChild>
        <button type="button" aria-label={`主题：${current.label}`} className={cx("flex h-9 w-full items-center gap-3 rounded-[9px] px-3 text-[13px] text-sidebar-ink/80 hover:bg-sidebar-hover hover:text-white dark:hover:text-sidebar-ink [&>svg]:size-[17px]", collapsed && "lg:justify-center lg:px-0")}>
          {current.icon}
          <span className={cx(collapsed && "lg:sr-only")}>主题 · {current.label}</span>
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-44">
        {options.map((option) => <MenuItem key={option.id} icon={option.icon} onSelect={() => setPreference(option.id)}>
          <span className="flex-1">{option.label}</span>
          {option.id === preference && <Check className="!text-success" />}
        </MenuItem>)}
      </MenuContent>
    </MenuRoot>
  </div>;
}

function Topbar({ page, collapsed, onToggleCollapsed, onOpenMobile, onOpenSearch, onNavigate }: { page: WorkspacePage; collapsed: boolean; onToggleCollapsed: () => void; onOpenMobile: () => void; onOpenSearch: () => void; onNavigate: (page: WorkspacePage) => void }) {
  const { scope } = useWorkspace();
  return <header className="sticky top-0 z-20 flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-md sm:px-5">
    <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="打开导航" onClick={onOpenMobile}><Menu className="size-[18px]" /></Button>
    <Button variant="ghost" size="icon-sm" className="max-lg:hidden" aria-label={collapsed ? "展开侧栏" : "收起侧栏"} onClick={onToggleCollapsed}>
      {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
    </Button>
    <nav aria-label="位置" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <span className="hidden truncate text-muted sm:inline">{scope?.label || "授权范围"}</span>
      <span className="hidden text-faint sm:inline">/</span>
      <strong className="truncate font-semibold text-ink">{navItem(page).label}</strong>
    </nav>
    <span className="ml-1 hidden items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5 text-2xs font-medium text-muted md:inline-flex">
      <ShieldCheck className="size-3 text-success" />真实连接
    </span>
    <div className="ml-auto flex items-center gap-1.5">
      <button type="button" onClick={onOpenSearch} className="hidden h-9 w-64 items-center gap-2 rounded-control border border-line bg-panel px-3 text-[13px] text-faint transition-colors hover:border-line-strong md:flex">
        <Search className="size-4" />
        <span className="flex-1 text-left">搜索任务或页面</span>
        <Kbd>⌘K</Kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="搜索" onClick={onOpenSearch}><Search className="size-[18px]" /></Button>
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
        }) : <li className="px-4 py-6 text-center text-[13px] text-muted">当前范围没有配置任务连接</li>}
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
    void api.readNotification(item.scope_id, item.id, session.csrf).then(({ notification }) => { reminders.update(notification); setOpen(false); navigate(item.target_path || `/tasks?task=${encodeURIComponent(item.task_key)}`); }).catch((error) => setFailure(errorCode(error)));
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
  if (!session) return null;
  const roleLabel = session.role === "admin" ? "控制中心管理员" : "控制中心成员";
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
      <p className="mx-2.5 mb-1.5 rounded-[8px] bg-panel-sunken px-2.5 py-2 text-2xs leading-4 text-muted">控制中心角色只决定本页面可见范围，不等于各 owner 的业务权限。</p>
      <MenuSeparator />
      <MenuItem icon={<UsersRound />} onSelect={() => onNavigate("team")}>身份、范围与审计</MenuItem>
      <MenuItem icon={<LogOut />} tone="danger" onSelect={() => void logout()}>退出登录</MenuItem>
    </MenuContent>
  </MenuRoot>;
}

type PaletteGroup = "recent" | "task" | "catalog" | "action" | "page";
/** A palette entry either navigates to `target` or runs an action in place. */
interface PaletteResult { key: string; group: PaletteGroup; label: string; meta: string; target?: string; run?: () => void }
const paletteGroups: { id: PaletteGroup; label: string; icon: ReactNode }[] = [
  { id: "recent", label: "最近打开", icon: <History className="size-3.5" /> },
  { id: "task", label: "任务", icon: <ListTodo className="size-3.5" /> },
  { id: "catalog", label: "模型与工具", icon: <Cpu className="size-3.5" /> },
  { id: "action", label: "操作", icon: <Zap className="size-3.5" /> },
  { id: "page", label: "页面", icon: <LayoutDashboard className="size-3.5" /> },
];
const catalogKindLabel = { model: "模型", tool: "工具", action: "动作" } as const;

function CommandSearch({ onClose, onNavigate, onShowShortcuts }: { onClose: () => void; onNavigate: (target: string) => void; onShowShortcuts: () => void }) {
  const tasks = useTasks();
  const cache = useObservationCache();
  const recent = useRecentItems().items;
  const { preference, dark, setPreference } = useTheme();
  const { session, scopeId, setScope } = useWorkspace();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement;
    input.current?.focus();
    return () => { if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus(); };
  }, []);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const pages: PaletteResult[] = navItems
      .filter((item) => !needle || `${item.label} ${item.description}`.toLocaleLowerCase().includes(needle))
      .map((item) => ({ key: "page:" + item.id, group: "page", label: item.label, meta: item.description, target: item.id === "home" ? "/" : `/${item.id}` }));
    const taskResults: PaletteResult[] = needle ? tasks.rows
      .filter((task) => `${task.title} ${task.locator.task_ref} ${task.locator.owner} ${task.locator.project}`.toLocaleLowerCase().includes(needle))
      .slice(0, 5)
      .map((task) => ({ key: "task:" + task.task_key, group: "task", label: task.title, meta: `${ownerLabel(task.locator.owner)} · ${task.locator.task_ref}`, target: `/tasks?task=${encodeURIComponent(task.task_key || "")}` })) : [];
    const catalog = needle ? cache.peek<ToolCatalog>(toolCatalogCacheKey)?.data : null;
    const catalogResults: PaletteResult[] = catalog ? [
      ...catalog.models.filter((model) => model.status !== "historical").map((model) => ({ kind: "model" as const, owner: model.owner, id: model.id, label: model.model_ref, tab: "models" })),
      ...catalog.actions.map((action) => ({ kind: "action" as const, owner: action.owner, id: action.id, label: action.name, tab: "tools" })),
      ...catalog.tools.map((tool) => ({ kind: "tool" as const, owner: tool.owner, id: tool.id, label: tool.name, tab: "tools" })),
    ].filter((entry) => `${entry.label} ${entry.owner}`.toLocaleLowerCase().includes(needle)).slice(0, 5).map((entry) => ({
      key: `catalog:${entry.kind}:${entry.owner}:${entry.id}`,
      group: "catalog",
      label: entry.label,
      meta: `${ownerLabel(entry.owner)} · ${catalogKindLabel[entry.kind]}`,
      target: `/capabilities?${new URLSearchParams({ tab: entry.tab, entry: `${entry.kind}:${entry.owner}:${entry.id}` })}`,
    })) : [];
    const matches = (text: string) => !needle || text.toLocaleLowerCase().includes(needle);
    const recentResults: PaletteResult[] = recent
      .filter((item) => matches(`${item.label} ${item.meta}`) && !taskResults.some((task) => task.key === item.key))
      .slice(0, 5)
      .map((item) => ({ key: "recent:" + item.key, group: "recent", label: item.label, meta: item.meta, target: item.target }));
    const actionList: PaletteResult[] = [
      { key: "action:theme", group: "action", label: dark ? "切换到浅色主题" : "切换到深色主题", meta: "外观", run: () => setPreference(dark ? "light" : "dark") },
      ...(preference === "system" ? [] : [{ key: "action:theme-system", group: "action" as const, label: "主题跟随系统", meta: "外观", run: () => setPreference("system") }]),
      ...(session?.scopes || []).filter((scope) => scope.id !== scopeId).map((scope) => ({ key: "action:scope:" + scope.id, group: "action" as const, label: `切换到 ${scope.label}`, meta: "范围", run: () => setScope(scope.id) })),
      { key: "action:shortcuts", group: "action", label: "查看键盘快捷键", meta: "帮助 · 在页面上按 ?", run: onShowShortcuts },
    ];
    const actions = actionList.filter((action) => matches(`${action.label} ${action.meta}`));
    return (needle ? [...taskResults, ...recentResults, ...catalogResults, ...actions, ...pages] : [...recentResults, ...actions, ...pages]).slice(0, 24);
  }, [cache, dark, onShowShortcuts, preference, query, recent, scopeId, session?.scopes, setPreference, setScope, tasks.rows]);
  const choose = (result: PaletteResult) => {
    if (result.run) { onClose(); result.run(); }
    else if (result.target) onNavigate(result.target);
  };
  useEffect(() => setActive(0), [query]);
  const optionId = (index: number) => `command-option-${index}`;
  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>("input, button:not([tabindex='-1'])") || [])];
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index === focusable.length - 1 ? 0 : index + 1);
    event.preventDefault();
    focusable[next].focus();
  };
  return <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label="搜索" onKeyDown={trapFocus}>
    <button aria-label="关闭搜索" tabIndex={-1} className="fade-in absolute inset-0" style={{ background: "var(--scrim)" }} onClick={onClose} />
    <div ref={dialog} className="pop-in relative w-full max-w-xl overflow-hidden rounded-[16px] border border-line bg-panel shadow-float">
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search className="size-4 text-faint" />
        <input
          ref={input}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={results[active] ? optionId(active) : undefined}
          aria-autocomplete="list"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
            if (event.key === "Enter" && results[active]) choose(results[active]);
          }}
          placeholder="搜索任务、模型与工具，跳转页面或执行操作"
          aria-label="搜索任务或页面"
          className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
        <Button variant="ghost" size="icon-sm" aria-label="关闭搜索" onClick={onClose}><X className="size-4" /></Button>
      </div>
      <ul id="command-results" role="listbox" aria-label="搜索结果" className="max-h-[50vh] overflow-y-auto p-1.5">
        {results.length ? results.map((result, index) => {
          const group = paletteGroups.find((item) => item.id === result.group)!;
          const firstOfGroup = index === 0 || results[index - 1].group !== result.group;
          return <li key={result.key} id={optionId(index)} role="option" aria-selected={index === active} onMouseEnter={() => setActive(index)} onClick={() => choose(result)} className={cx("cursor-pointer", firstOfGroup && index > 0 && "mt-1.5 border-t border-line pt-1.5")}>
            {firstOfGroup && <span aria-hidden="true" className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-2xs font-medium text-muted">{group.icon}{group.label}</span>}
            <span className={cx("flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5", index === active && "bg-panel-sunken")}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-medium">{result.label}</span>
                <span className="block truncate text-2xs text-muted">{result.meta}</span>
              </span>
              {index === active && <ArrowRight className="size-4 text-muted" />}
            </span>
          </li>;
        }) : <li className="px-3 py-8 text-center text-body-sm text-muted">没有匹配结果</li>}
      </ul>
      <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-2xs text-muted"><Kbd>↑</Kbd><Kbd>↓</Kbd>选择<Kbd>↵</Kbd>打开<Kbd>Esc</Kbd>关闭</div>
    </div>
  </div>;
}
