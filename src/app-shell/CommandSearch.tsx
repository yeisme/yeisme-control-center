import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Bell, Clapperboard, Copy, Cpu, ExternalLink, FileText, History, Images, LayoutDashboard, ListTodo, Search, Sparkles, X, Zap } from "../icons";
import { Button, Kbd, KindBadge, ToggleGroup, cx, ownerLabel } from "../components/ui";
import { Highlight } from "../components/Highlight";
import { peekThumbnail } from "../components/TaskThumbnail";
import { appLink, useCopy } from "../app/item-actions";
import { useTasks } from "../app/tasks-context";
import { useNotifications } from "../app/notifications-context";
import { useObservationCache } from "../app/observation-cache";
import { useRecentItems } from "../app/recent";
import { useWorkspace } from "../app/workspace";
import { useTheme } from "./theme";
import { navItems } from "./navigation";
import { api } from "../shared/api/control-center-client";
import type { TaskArtifact, TaskSnapshot } from "../task-observation";
import { toolCatalogCacheKey, type ToolCatalog } from "../shared/tool-catalog";
import { collectResults } from "../shared/read-model/tasks";
import { taskStateLabels } from "../task-observation";
import { defaultRequestQuery } from "../request-visibility";
import { reminderStateLabel } from "../notifications";
import { readScopePrefix, rankSearch, searchScopes, type RankedItem, type SearchGroup, type SearchItem, type SearchScope } from "../shared/search/rank";
import { shortcutText } from "../shared/platform";

/** A result that can show a picture in the preview: the task and result it came from. */
type PaletteItem = SearchItem & { preview?: { task: TaskSnapshot; result?: TaskArtifact }; copyRef?: string };

const groupLabels: Record<SearchGroup, { label: string; icon: ReactNode }> = {
  top: { label: "最佳匹配", icon: <Sparkles className="size-3.5" /> },
  recent: { label: "最近打开", icon: <History className="size-3.5" /> },
  action: { label: "操作", icon: <Zap className="size-3.5" /> },
  page: { label: "页面", icon: <LayoutDashboard className="size-3.5" /> },
  task: { label: "任务", icon: <ListTodo className="size-3.5" /> },
  work: { label: "作品", icon: <Images className="size-3.5" /> },
  episode: { label: "剧集", icon: <Clapperboard className="size-3.5" /> },
  reminder: { label: "提醒", icon: <Bell className="size-3.5" /> },
  request: { label: "请求", icon: <FileText className="size-3.5" /> },
  prompt: { label: "配方", icon: <FileText className="size-3.5" /> },
  catalog: { label: "模型与工具", icon: <Cpu className="size-3.5" /> },
};
const catalogKindLabel = { model: "模型", tool: "工具", action: "动作" } as const;

type RemoteSource = "request" | "episode" | "reminder" | "prompt";
type RemoteState = { items: PaletteItem[]; notes: string[]; loading: boolean };
const remoteCache = new Map<string, { at: number; items: PaletteItem[]; note?: string }>();

/**
 * What the server can find beyond the rows already read: requests of the last seven days, episodes, reminders and, when
 * asked for by scope, recipes. Two characters at least, 300ms after typing stops, cancelled by the next keystroke, and
 * remembered for 15 seconds. A source that cannot be read says so instead of looking empty.
 */
function useRemoteSearch(scopeId: string, text: string, scope: SearchScope): RemoteState {
  const [state, setState] = useState<RemoteState>({ items: [], notes: [], loading: false });
  useEffect(() => {
    const query = text.trim();
    const sources: RemoteSource[] = (["request", "episode", "reminder", "prompt"] as const).filter((source) => scope === source || (scope === "all" && source !== "prompt"));
    if (query.length < 2 || !sources.length || !scopeId) { setState({ items: [], notes: [], loading: false }); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, loading: true }));
      void Promise.all(sources.map(async (source) => {
        const key = `${scopeId}|${source}|${query}`;
        const cached = remoteCache.get(key);
        if (cached && Date.now() - cached.at < 15_000) return cached;
        try {
          const items = await readSource(source, scopeId, query, controller.signal);
          const value = { at: Date.now(), ...items };
          remoteCache.set(key, value);
          return value;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          return { at: Date.now(), items: [] as PaletteItem[], note: `${groupLabels[source].label}暂时读不到` };
        }
      })).then((results) => {
        if (controller.signal.aborted) return;
        setState({ items: results.flatMap((result) => result.items), notes: results.flatMap((result) => result.note ? [result.note] : []), loading: false });
      }).catch(() => undefined);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [scope, scopeId, text]);
  return state;
}

async function readSource(source: RemoteSource, scopeId: string, query: string, signal: AbortSignal): Promise<{ items: PaletteItem[]; note?: string }> {
  if (source === "request") {
    const now = new Date();
    // The server reads at most seven days (a minute short of it, so the window never runs over) and pages of 25, 50 or 100.
    const page = await api.requests(scopeId, { ...defaultRequestQuery(now), from: new Date(+now - 7 * 86_400_000 + 60_000).toISOString(), search: query, limit: 25 }, signal);
    const missing = page.coverage.length > 0 && page.coverage.every((item) => item.reason === "delegation_unavailable" || item.reason === "source_not_configured");
    return {
      items: page.rows.slice(0, 10).map((row) => ({ key: `request:${row.owner}:${row.id}`, group: "request" as const, label: row.title || row.id, meta: `${ownerLabel(row.owner)} · 请求 · ${row.created_at.slice(0, 10)}`, keywords: row.id, target: `/requests?request=${encodeURIComponent(`${row.owner}:${row.id}`)}`, copyRef: row.id })),
      note: missing ? "请求需要组织身份才能读取" : undefined,
    };
  }
  if (source === "episode") {
    const page = await api.dramaEpisodes(scopeId, { q: query, limit: 5 }, signal);
    return { items: page.rows.map((row) => ({ key: `episode:${row.episode_ref}`, group: "episode" as const, label: row.title || row.episode_ref, meta: `剧集 · ${row.episode_ref}`, keywords: row.episode_ref, target: `/drama?studio=${encodeURIComponent(row.episode_ref)}`, copyRef: row.episode_ref })) };
  }
  if (source === "reminder") {
    const page = await api.notifications(scopeId, signal, undefined, query);
    return { items: page.rows.map((row) => ({ key: `reminder:${row.id}`, group: "reminder" as const, label: row.title || row.task_key, meta: `${ownerLabel(row.owner)} · 提醒`, target: `/reminders?focus=${encodeURIComponent(row.id)}` })) };
  }
  const page = await api.prompts(scopeId, { q: query, limit: 5 }, signal);
  return { items: page.rows.map((row) => ({ key: `prompt:${row.id}`, group: "prompt" as const, label: row.title, meta: `${ownerLabel(row.owner)} · 配方`, target: `/prompts?q=${encodeURIComponent(row.title)}` })) };
}

/** The picture of a result only if it is already in this tab: the preview never asks for a new media grant. */
function PeekThumb({ task, result }: { task: TaskSnapshot; result?: TaskArtifact }) {
  const { scopeId, session } = useWorkspace();
  const url = result ? peekThumbnail(scopeId, session?.epoch, task, result) : null;
  if (url) return <img src={url} alt="" className="aspect-[4/3] w-full rounded-[12px] object-cover" />;
  return <span className="grid aspect-[4/3] w-full place-items-center rounded-[12px] bg-panel-sunken"><KindBadge kind={result?.mime?.startsWith("video/") ? "video" : result?.mime?.startsWith("audio/") ? "audio" : result?.mime?.startsWith("image/") ? "image" : "text"} size="md" /></span>;
}

export function CommandSearch({ onClose, onNavigate, onShowShortcuts }: { onClose: () => void; onNavigate: (target: string) => void; onShowShortcuts: () => void }) {
  const tasks = useTasks();
  const reminders = useNotifications();
  const cache = useObservationCache();
  const recent = useRecentItems().items;
  const copy = useCopy();
  const { preference, dark, setPreference } = useTheme();
  const { session, scopeId, setScope, isAdmin } = useWorkspace();
  const [query, setQuery] = useState("");
  const [chosenScope, setChosenScope] = useState<SearchScope>("all");
  const [expanded, setExpanded] = useState<SearchGroup[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const previousFocus = useRef<Element | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement;
    input.current?.focus();
    return () => { if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus(); };
  }, []);
  const prefix = readScopePrefix(query);
  const scope = prefix.scope || chosenScope;
  const text = prefix.rest;
  const remote = useRemoteSearch(scopeId, text, scope);

  const local = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = navItems.map((item) => ({ key: "page:" + item.id, group: "page", label: item.label, meta: item.description, keywords: item.short, target: item.id === "home" ? "/" : `/${item.id}` }));
    const actions: PaletteItem[] = [
      { key: "action:theme", group: "action", label: dark ? "切换到浅色主题" : "切换到深色主题", meta: "外观", boost: 700, run: () => setPreference(dark ? "light" : "dark") },
      ...(preference === "system" ? [] : [{ key: "action:theme-system", group: "action" as const, label: "主题跟随系统", meta: "外观", boost: 700, run: () => setPreference("system") }]),
      ...(session?.scopes || []).filter((item) => item.id !== scopeId).map((item) => ({ key: "action:scope:" + item.id, group: "action" as const, label: `切换到 ${item.label}`, meta: "范围", boost: 700, run: () => setScope(item.id) })),
      { key: "action:shortcuts", group: "action", label: "查看键盘快捷键", meta: "帮助 · 在页面上按 ?", boost: 700, run: onShowShortcuts },
      ...(isAdmin && session?.username ? [{ key: "action:new-account", group: "action" as const, label: "新建账号", meta: "成员与管理 · 给同事或 Agent 一个自己的账号", keywords: "用户 成员 访问 Key", boost: 700, target: "/admin?tab=accounts&new=1" }] : []),
      ...(session?.username && (session.own_key ?? "available") === "available" ? [{ key: "action:rotate-own-key", group: "action" as const, label: "重置我的访问 Key", meta: "我的账号", keywords: "密钥 Key 安全", boost: 700, target: "/team?rotate=1" }] : []),
    ];
    const recentItems: PaletteItem[] = recent.map((item) => ({ key: "recent:" + item.key, group: "recent", label: item.label, meta: item.meta, target: item.target, boost: 150 }));
    const taskItems: PaletteItem[] = tasks.rows.map((task) => ({
      key: "task:" + task.task_key,
      group: "task",
      label: task.title,
      meta: `${ownerLabel(task.locator.owner)} · ${taskStateLabels[task.state] || task.state} · ${task.locator.task_ref}`,
      keywords: [task.locator.task_ref, task.locator.project, task.episode_ref].filter(Boolean).join(" "),
      target: `/tasks?task=${encodeURIComponent(task.task_key || "")}`,
      preview: { task, result: task.results.find((result) => result.thumbnail?.state === "ready") || task.results[0] },
      copyRef: task.locator.task_ref,
    }));
    const workItems: PaletteItem[] = collectResults(tasks.rows).map((entry) => ({
      key: "work:" + entry.key,
      group: "work",
      label: entry.result.name || "未命名结果",
      meta: `${ownerLabel(entry.task.locator.owner)} · ${entry.task.title}`,
      keywords: entry.task.locator.project,
      target: `/assets?result=${encodeURIComponent(entry.key)}`,
      preview: { task: entry.task, result: entry.result },
      copyRef: entry.result.ref,
    }));
    const reminderItems: PaletteItem[] = reminders.rows.map((row) => ({ key: `reminder:${row.id}`, group: "reminder", label: row.title || row.task_key, meta: `${ownerLabel(row.owner)} · ${reminderStateLabel(row, reminders.now)}`, target: `/reminders?focus=${encodeURIComponent(row.id)}` }));
    const catalog = cache.peek<ToolCatalog>(toolCatalogCacheKey)?.data;
    const catalogItems: PaletteItem[] = catalog ? [
      ...catalog.models.filter((model) => model.status !== "historical").map((model) => ({ kind: "model" as const, owner: model.owner, id: model.id, label: model.model_ref, tab: "models" })),
      ...catalog.actions.map((action) => ({ kind: "action" as const, owner: action.owner, id: action.id, label: action.name, tab: "tools" })),
      ...catalog.tools.map((tool) => ({ kind: "tool" as const, owner: tool.owner, id: tool.id, label: tool.name, tab: "tools" })),
    ].map((entry) => ({ key: `catalog:${entry.kind}:${entry.owner}:${entry.id}`, group: "catalog" as const, label: entry.label, meta: `${ownerLabel(entry.owner)} · ${catalogKindLabel[entry.kind]}`, target: `/capabilities?${new URLSearchParams({ tab: entry.tab, entry: `${entry.kind}:${entry.owner}:${entry.id}` })}` })) : [];
    return [...actions, ...recentItems, ...taskItems, ...workItems, ...reminderItems, ...catalogItems, ...pages];
  }, [cache, dark, isAdmin, onShowShortcuts, preference, recent, reminders.now, reminders.rows, scopeId, session?.scopes, session?.username, session?.own_key, setPreference, setScope, tasks.rows]);

  const groups = useMemo(() => rankSearch([...local, ...remote.items], text, { scope, expanded }), [expanded, local, remote.items, scope, text]);
  // The list a keyboard walks: every result, and after a group that holds more, its 「显示全部」.
  const rows = useMemo(() => groups.flatMap((group) => [
    ...group.items.map((item, index) => ({ kind: "item" as const, item: item as RankedItem & PaletteItem, group: group.group, first: index === 0 })),
    ...(group.total > group.items.length ? [{ kind: "more" as const, group: group.group, total: group.total, first: false }] : []),
  ]), [groups]);
  useEffect(() => setActive(0), [query, chosenScope]);
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const current = rows[active];
  const choose = (row: (typeof rows)[number] | undefined, newTab = false) => {
    if (!row) return;
    if (row.kind === "more") { setExpanded((value) => [...value, row.group]); return; }
    const item = row.item;
    if (item.run) { onClose(); item.run(); return; }
    if (!item.target) return;
    if (newTab) { window.open(appLink(item.target), "_blank", "noopener"); return; }
    onNavigate(item.target);
  };
  const optionId = (index: number) => `command-option-${index}`;
  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>("input, button:not([tabindex='-1'])") || [])].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index === focusable.length - 1 ? 0 : index + 1);
    event.preventDefault();
    focusable[next].focus();
  };
  const preview = current?.kind === "item" ? current.item : null;
  return <div className="fixed inset-0 z-palette flex items-start justify-center px-3 pt-[10vh] max-sm:p-0" role="dialog" aria-modal="true" aria-label="搜索" onKeyDown={trapFocus} data-command-search>
    <button aria-label="关闭搜索" tabIndex={-1} className="fade-in absolute inset-0" style={{ background: "var(--scrim)" }} onClick={onClose} />
    <div ref={dialog} className="pop-in relative flex max-h-[76vh] w-full max-w-xl flex-col overflow-hidden rounded-[18px] border border-line bg-panel shadow-float min-[900px]:max-w-3xl max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none max-sm:border-0">
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search className="size-4 text-faint" />
        <input
          ref={input}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={rows[active] ? optionId(active) : undefined}
          aria-autocomplete="list"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); onClose(); }
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, rows.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
            if (event.key === "Enter") { event.preventDefault(); choose(rows[active], event.metaKey || event.ctrlKey); }
          }}
          placeholder="搜索作品、任务、剧集、提醒，或跳到页面、执行操作"
          aria-label="搜索任务或页面"
          className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
        {remote.loading && <span className="text-2xs text-muted" aria-live="polite">正在补查…</span>}
        <Button variant="ghost" size="icon-sm" aria-label="关闭搜索" onClick={onClose}><X className="size-4" /></Button>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-3 py-2 [scrollbar-width:none]">
        <ToggleGroup<SearchScope> label="搜索范围" value={scope} onChange={(value) => { setChosenScope(value); if (prefix.scope) setQuery(prefix.rest); input.current?.focus(); }} options={searchScopes.map((item) => ({ id: item.id, label: item.label }))} />
      </div>
      <div className="flex min-h-0 flex-1">
        {/* The listbox scrolls itself: a combobox's popup is reached through the field, so it needs no tab stop of its own. */}
        <div className="flex min-h-0 flex-1 flex-col">
        {!rows.length && <p className="px-3 py-8 text-center text-body-sm text-muted">{remote.loading ? "正在补查…" : "没有匹配结果"}</p>}
        <ul ref={list} id="command-results" role="listbox" aria-label="搜索结果" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {rows.map((row, index) => {
            const label = groupLabels[row.group];
            const header = row.kind === "item" && row.first;
            return <li key={row.kind === "item" ? `${row.group}:${row.item.key}` : `more:${row.group}`} id={optionId(index)} data-index={index} role="option" aria-selected={index === active} onMouseEnter={() => setActive(index)} onClick={() => choose(row)} className={cx("cursor-pointer", header && index > 0 && "mt-1.5 border-t border-line pt-1.5")} data-search-group={row.group}>
              {header && <span aria-hidden="true" className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-2xs font-medium text-muted">{label.icon}{label.label}</span>}
              {row.kind === "item"
                ? <span className={cx("flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5", index === active && "bg-panel-sunken")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium"><Highlight text={row.item.label} ranges={row.item.labelRanges} /></span>
                    <span className="block truncate text-2xs text-muted"><Highlight text={row.item.meta} ranges={row.item.metaRanges} /></span>
                  </span>
                  {index === active && <ArrowRight className="size-4 shrink-0 text-muted" />}
                </span>
                : <span className={cx("flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-2xs text-ink-soft", index === active && "bg-panel-sunken")}>显示全部 {row.total} 个{label.label}</span>}
            </li>;
          })}
        </ul>
        {remote.notes.length > 0 && <p className="px-4 pb-3 text-2xs text-warning" data-command-notes>这次没读到：{remote.notes.join("；")}。没读到的不算没有。</p>}
        </div>
        {preview && <aside aria-label="预览" className="hidden w-64 shrink-0 flex-col gap-3 border-l border-line bg-panel-soft p-4 min-[900px]:flex" data-command-preview>
          {preview.preview && <PeekThumb task={preview.preview.task} result={preview.preview.result} />}
          <div className="min-w-0">
            <p className="text-2xs text-muted">{groupLabels[preview.group].label}</p>
            <p className="mt-0.5 break-words text-body-sm font-semibold text-ink">{preview.label}</p>
            <p className="mt-1 break-words text-2xs text-muted">{preview.meta}</p>
          </div>
          <div className="mt-auto flex flex-wrap gap-1.5">
            {preview.target && <Button size="sm" variant="secondary" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(appLink(preview.target!), "_blank", "noopener")}>新标签打开</Button>}
            {preview.target && <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => void copy(appLink(preview.target!), "链接")}>复制链接</Button>}
            {preview.copyRef && <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => void copy(preview.copyRef!, "引用")}>复制引用</Button>}
          </div>
        </aside>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-2xs text-muted">
        <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd>选择</span>
        <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd>打开</span>
        <span className="inline-flex items-center gap-1 max-sm:hidden"><Kbd>{shortcutText("↵")}</Kbd>新标签</span>
        <span className="inline-flex items-center gap-1"><Kbd>Esc</Kbd>关闭</span>
        <span className="ml-auto max-sm:hidden">输入「任务:」「作品:」只搜一类</span>
      </div>
    </div>
  </div>;
}
