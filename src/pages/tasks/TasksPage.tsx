import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, SlidersHorizontal } from "../../icons";
import { api, errorCode, type TaskSnapshot } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { taskTime, useTasks } from "../../app/tasks-context";
import { useMediaPreview } from "../../components/media-preview";
import { Button, Dot, EmptyState, InlineNotice, Panel, ReadStateView, SearchField, SegmentedTabs, Select, SkeletonRows, StaleNotice, TaskStatePill, cx, ownerLabel, useToast } from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";
import { collectResults, connectionStateLabel, connectionTone, inView, resultAction, stageLabel, taskInProgress, ownerModality, type TaskView } from "../../shared/read-model/tasks";
import { filterTasks, progressLabel, taskIsActive, taskNeedsAttention, taskStateLabels, type TaskFilters } from "../../task-observation";
import { taskTarget } from "../../task-links";
import { TaskDetail } from "./TaskDetail";
import { kindOf } from "../../components/ui/Kind";
import { PromptCaptureSummary, promptFromTask, promptStateLabel } from "../../components/PromptCaptureSummary";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { densityClass, pageSizes, useListPreferences, type ListDensity, type PageSize } from "../../app/list-preferences";
import { readErrorMessage } from "../../shared/read-model/read-state";

const views: { id: TaskView; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "active", label: "进行中" },
  { id: "attention", label: "需要关注" },
  { id: "history", label: "已结束" },
];

type InspectorMode = "fixed" | "floating";
const inspectorPreferenceKey = "yeisme.control.tasks.inspector-mode";

export default function TasksPage() {
  const tasks = useTasks();
  const { scopeId } = useWorkspace();
  const navigate = useNavigate();
  const notify = useToast();
  const { pageSize, density, page: listPage, setPage, setPageSize, setDensity, resetPage } = useListPreferences();
  const listKey = "tasks";
  const [params, setParams] = useSearchParams();
  const view = (views.some((item) => item.id === params.get("view")) ? params.get("view") : "all") as TaskView;
  const selectedKey = params.get("task");
  const [showFilters, setShowFilters] = useState(() => ["owner", "connection", "state", "results", "prompt"].some((key) => params.get(key)));
  const [resolved, setResolved] = useState<TaskSnapshot | null>(null);
  const [resolving, setResolving] = useState(false);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>(() => typeof window !== "undefined" && window.localStorage.getItem(inspectorPreferenceKey) === "floating" ? "floating" : "fixed");

  const filters: TaskFilters = {
    text: params.get("q") || "",
    connection: params.get("connection") || "",
    owner: params.get("owner") || "",
    project: params.get("project") || "",
    state: params.get("state") || "",
    family: params.get("family") || "",
    modality: "",
    results: params.get("results") || "",
    prompt: params.get("prompt") || "",
    from: "",
    through: "",
  };

  const update = useCallback((patch: Record<string, string | null>, history: "push" | "replace" = "replace", resetPagination = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: history === "replace" });
    if (resetPagination) resetPage(listKey);
  }, [listKey, params, resetPage, setParams]);

  // Legacy owner deep link `#/tasks?connection&project&family&ref` resolves the original task once.
  const legacy = useMemo(() => taskTarget("#/tasks?" + params.toString()), [params]);
  useEffect(() => {
    if (!legacy) return;
    const controller = new AbortController();
    setResolving(true);
    api.resolveTask(scopeId, legacy, controller.signal)
      .then((task) => {
        setResolved(task);
        const next = new URLSearchParams();
        if (task.task_key) next.set("task", task.task_key);
        setParams(next, { replace: true });
      })
      .catch((error) => { if (!controller.signal.aborted) notify(`无法定位原任务（${errorCode(error)}）`, "warning"); })
      .finally(() => { if (!controller.signal.aborted) setResolving(false); });
    return () => controller.abort();
  }, [legacy, scopeId, setParams, notify]);

  const filtered = useMemo(() => filterTasks(tasks.rows, filters).filter((task) => inView(task, view)), [tasks.rows, view, filters.text, filters.connection, filters.owner, filters.project, filters.state, filters.family, filters.results, filters.prompt]);
  const counts = useMemo(() => ({
    all: tasks.rows.length,
    active: tasks.rows.filter(taskInProgress).length,
    attention: tasks.rows.filter(taskNeedsAttention).length,
    history: tasks.rows.filter((task) => !taskIsActive(task)).length,
  }), [tasks.rows]);
  const selected = tasks.rows.find((task) => task.task_key === selectedKey) || (resolved?.task_key === selectedKey ? resolved : null);
  const previewEntries = useMemo(() => {
    const entries = collectResults(resolved ? [...tasks.rows, resolved] : tasks.rows);
    return [...new Map(entries.map((entry) => [entry.key, entry])).values()];
  }, [resolved, tasks.rows]);
  const resolvePreview = useCallback((key: string) => previewEntries.find((entry) => entry.key === key) || null, [previewEntries]);
  const previewKey = params.get("preview");
  const setPreviewKey = useCallback((key: string | null, history: "push" | "replace") => update({ preview: key }, history), [update]);
  const preview = useMediaPreview({ previewKey, resolve: resolvePreview, onPreviewKeyChange: setPreviewKey });
  const owners = [...new Set(tasks.rows.map((task) => task.locator.owner))];
  const states = [...new Set(tasks.rows.map((task) => task.state))].sort();
  const activeFilters = ["owner", "connection", "state", "results", "prompt", "family", "project"].filter((key) => params.get(key)).length;
  const storedPage = listPage(listKey);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(storedPage, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = filtered.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    if (storedPage > pageCount) setPage(listKey, pageCount);
  }, [listKey, pageCount, setPage, storedPage]);

  const changeInspectorMode = useCallback((mode: InspectorMode) => {
    setInspectorMode(mode);
    window.localStorage.setItem(inspectorPreferenceKey, mode);
  }, []);

  const selectedLane = view === "active" ? tasks.lanes.active : view === "history" ? tasks.lanes.history : null;
  const historyGap = tasks.lanes.history.status !== "ready" && tasks.lanes.history.status !== "empty" && tasks.lanes.history.status !== "loading";
  const laneRecovery = (lane: typeof tasks.lanes.active) => lane.status === "needs_contract" || lane.status === "forbidden"
    ? <Button size="sm" variant="ghost" onClick={() => navigate("/services")}>查看服务与连接</Button>
    : <Button size="sm" variant="ghost" onClick={tasks.refresh}>重新读取</Button>;
  const laneMessage = (label: string, lane: typeof tasks.lanes.active) => lane.status === "needs_contract"
    ? `${label}读取合同尚未提供；当前只展示已读取的其他任务。`
    : lane.status === "forbidden"
      ? `${label}读取未获当前范围授权；请检查 owner 连接权限。`
      : `${label}${readErrorMessage(lane.error)}`;

  const quickPreview = useCallback((task: TaskSnapshot, result: TaskSnapshot["results"][number]) => {
    const kind = kindOf(result.mime, ownerModality[task.locator.owner]);
    const key = `${task.task_key || task.locator.task_ref}:${result.ref}`;
    const next = new URLSearchParams(params);
    next.set("task", task.task_key || "");
    next.set("preview", key);
    setParams(next, { replace: false });
    preview.open({ key, task, result, kind }, { source: "task-row", autoplay: kind !== "audio", syncQuery: false });
  }, [params, preview, setParams]);

  return <div className={cx(!selected && "page-enter", "flex min-h-0 flex-col gap-5", selected && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="tasks">
    <div className={cx("flex min-h-0 flex-1 gap-4", selected && inspectorMode === "fixed" ? "items-stretch" : "") }>
      <div className="min-w-0 flex-1 space-y-5">
    <h1 className="sr-only">任务中心</h1>
    <div className="flex justify-end"><Button size="sm" onClick={tasks.refresh} disabled={tasks.refreshing} icon={<RefreshCw className={cx("size-3.5", tasks.refreshing && "motion-safe:animate-spin")} />}>重新观察</Button></div>

    <LaneStrip onFilter={(connection) => update({ connection: filters.connection === connection ? null : connection }, "replace", true)} activeConnection={filters.connection} />

    <StaleNotice status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} onRetry={tasks.refresh} />
    {tasks.truncated && <InlineNotice tone="info">任务较多，本页只展示当前观察批次（已达分页上限）；筛选与计数仅针对已读取的批次。</InlineNotice>}

    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <SegmentedTabs label="任务视图" value={view} onChange={(value) => update({ view: value === "all" ? null : value }, "replace", true)} options={views.map((item) => ({ ...item, count: tasks.status === "loading" ? null : counts[item.id] }))} />
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <SearchField value={filters.text} onChange={(value) => update({ q: value || null }, "replace", true)} placeholder="标题、引用、项目" label="搜索任务" className="flex-1 sm:w-60 sm:flex-none" />
          <Button size="sm" variant={showFilters || activeFilters ? "secondary" : "ghost"} aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)} icon={<SlidersHorizontal className="size-3.5" />}>
            筛选{activeFilters > 0 && <span className="tabular rounded bg-primary px-1 text-2xs text-primary-ink">{activeFilters}</span>}
          </Button>
        </div>
      </div>
      {showFilters && <div className="fade-in grid grid-cols-2 gap-2 border-b border-line bg-panel-soft px-4 py-3 sm:grid-cols-4">
        <Select aria-label="按 owner 筛选" value={filters.owner} onChange={(event) => update({ owner: event.target.value || null }, "replace", true)}>
          <option value="">全部 owner</option>
          {owners.map((owner) => <option key={owner} value={owner}>{ownerLabel(owner)}</option>)}
        </Select>
        <Select aria-label="按连接筛选" value={filters.connection} onChange={(event) => update({ connection: event.target.value || null }, "replace", true)}>
          <option value="">全部连接</option>
          {tasks.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
        </Select>
        <Select aria-label="按状态筛选" value={filters.state} onChange={(event) => update({ state: event.target.value || null }, "replace", true)}>
          <option value="">全部状态</option>
          {states.map((state) => <option key={state} value={state}>{taskStateLabels[state] || state}</option>)}
        </Select>
        <Select aria-label="按结果筛选" value={filters.results} onChange={(event) => update({ results: event.target.value || null }, "replace", true)}>
          <option value="">有无结果均可</option>
          <option value="yes">有结果</option>
          <option value="no">无结果</option>
        </Select>
        <Select aria-label="按提示词状态筛选" value={filters.prompt} onChange={(event) => update({ prompt: event.target.value || null }, "replace", true)}>
          <option value="">全部提示词状态</option>
          {["captured", "redacted", "queued", "capturing", "not_recorded", "blocked", "failed", "expired"].map((state) => <option key={state} value={state}>{promptStateLabel(state as Parameters<typeof promptStateLabel>[0])}</option>)}
        </Select>
        {activeFilters > 0 && <button type="button" className="col-span-full justify-self-start text-[13px] font-medium text-info hover:underline" onClick={() => update({ owner: null, connection: null, state: null, results: null, prompt: null, family: null, project: null }, "replace", true)}>清除筛选</button>}
      </div>}

      {resolving && <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] text-muted"><LoaderCircle className="size-4 motion-safe:animate-spin" />正在按深链定位原任务…</p>}

      {historyGap && view !== "history" && <InlineNotice tone="warning" className="mx-4 mt-4">历史任务：{laneMessage("历史任务", tasks.lanes.history)}{laneRecovery(tasks.lanes.history)}</InlineNotice>}

      <ReadStateView
        status={tasks.status === "empty" ? "ready" : tasks.status}
        error={tasks.error}
        onRetry={tasks.refresh}
        skeleton={<SkeletonRows rows={7} />}
      >
        {filtered.length === 0 ? <EmptyState
          title={selectedLane && selectedLane.status !== "ready" && selectedLane.status !== "empty" ? `${view === "history" ? "历史任务" : "进行中任务"}暂不可用` : tasks.rows.length ? "没有符合条件的任务" : "当前范围没有任务记录"}
          body={selectedLane && selectedLane.status !== "ready" && selectedLane.status !== "empty" ? laneMessage(view === "history" ? "历史任务" : "进行中任务", selectedLane) : tasks.rows.length ? "试试切换视图或清除筛选。" : "owner 返回了空的任务列表；这不代表连接故障，连接状态见上方。"}
          action={selectedLane && selectedLane.status !== "ready" && selectedLane.status !== "empty" ? laneRecovery(selectedLane) : tasks.rows.length ? <Button size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>清除视图与筛选</Button> : undefined}
        /> : <>
          <div role="table" aria-label="任务列表" className="min-w-0">
            <div role="row" className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_120px_minmax(0,1fr)_104px] items-center gap-4 border-b border-line bg-panel-soft px-4 py-2 text-2xs font-medium text-muted lg:grid">
              <span role="columnheader">任务</span><span role="columnheader">阶段 · 进度</span><span role="columnheader">状态</span><span role="columnheader">连接</span><span role="columnheader" className="text-right">更新</span>
            </div>
            <ul className="divide-y divide-line">
              {pageRows.map((task, index) => <TaskRow key={task.task_key} task={task} index={index} density={density} connectionLabel={tasks.connections.find((connection) => connection.id === task.connection_id)?.label} onOpen={() => update({ task: task.task_key || null })} onQuickPreview={task.results.length === 1 && resultAction(task, "preview").enabled ? () => quickPreview(task, task.results[0]) : undefined} />)}
            </ul>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-2xs text-muted">
            <span className="tabular">显示 {filtered.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageSize, filtered.length)} / {filtered.length} 条 · 第 {currentPage} / {pageCount} 页{tasks.observedAt ? ` · 观察于 ${formatRelative(tasks.observedAt)}` : ""}</span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5">每页 <Select aria-label="每页数量" className="w-24" value={String(pageSize)} onChange={(event) => { setPageSize(Number(event.target.value) as PageSize); resetPage(listKey); }}>
                {pageSizes.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select></label>
              <label className="flex items-center gap-1.5">密度 <Select aria-label="列表密度" className="w-24" value={density} onChange={(event) => setDensity(event.target.value as ListDensity)}>
                <option value="compact">紧凑</option><option value="comfortable">标准</option><option value="spacious">宽松</option>
              </Select></label>
              <Button size="sm" variant="ghost" disabled={currentPage <= 1} onClick={() => setPage(listKey, currentPage - 1)} icon={<ChevronLeft className="size-3.5" />}>上一页</Button>
              <Button size="sm" variant="ghost" disabled={currentPage >= pageCount} onClick={() => setPage(listKey, currentPage + 1)} icon={<ChevronRight className="size-3.5" />}>下一页</Button>
            </div>
          </div>
        </>}
      </ReadStateView>
    </Panel>

      </div>
    {selected && inspectorMode === "fixed" && <TaskDetail task={selected} open mode={inspectorMode} onModeChange={changeInspectorMode} preview={preview} onOpenChange={(open) => { if (!open) update({ task: null, preview: null }); }} />}
    </div>
    {selected && inspectorMode === "floating" && <TaskDetail task={selected} open mode={inspectorMode} onModeChange={changeInspectorMode} preview={preview} onOpenChange={(open) => { if (!open) update({ task: null, preview: null }); }} />}
    {selectedKey && !selected && tasks.status !== "loading" && !resolving && <MissingSelection onClear={() => update({ task: null })} onTasks={() => navigate("/tasks")} />}
  </div>;
}

function TaskRow({ task, index, density, connectionLabel, onOpen, onQuickPreview }: { task: TaskSnapshot; index: number; density: "compact" | "comfortable" | "spacious"; connectionLabel?: string; onOpen: () => void; onQuickPreview?: () => void }) {
  const progress = progressLabel(task.progress);
  const quickKind = task.results.length === 1 ? kindOf(task.results[0].mime, ownerModality[task.locator.owner]) : null;
  return <li data-task={task.locator.task_ref} className="relative stagger-in" style={{ "--i": index } as React.CSSProperties}>
    <button type="button" onClick={onOpen} className={cx("group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 text-left transition-colors hover:bg-panel-soft focus-visible:bg-panel-soft lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_120px_minmax(0,1fr)_104px]", densityClass(density))}>
      <span className="flex min-w-0 items-center gap-3">
        <TaskThumbnail task={task} result={task.results[0]} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-ink group-hover:text-primary dark:group-hover:text-accent">{task.title}</span>
          <span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} · {task.locator.task_family || "未提供 family"} · <span className="font-mono">{task.locator.task_ref}</span></span>
          <PromptCaptureSummary prompt={promptFromTask(task)} compact className="mt-1" />
        </span>
      </span>
      <span className="hidden min-w-0 text-[13px] text-ink-soft lg:block">
        <span className="block truncate">{stageLabel(task.stage)}</span>
        <span className="block truncate text-2xs text-muted tabular">{taskInProgress(task) ? progress : task.results.length ? `${task.results.length} 个结果` : "无结果"}</span>
      </span>
      <span className="justify-self-end lg:justify-self-start"><TaskStatePill state={task.state} /></span>
      <span className="col-span-2 flex min-w-0 items-center gap-2 text-2xs text-muted lg:col-span-1 lg:text-[13px]">
        <span className="truncate">{connectionLabel || task.connection_id}</span>
        <span className="lg:hidden">· {stageLabel(task.stage)} · {formatRelative(task.updated_at || task.created_at)}</span>
      </span>
      <span className="hidden items-center justify-end gap-2 text-2xs text-muted tabular lg:flex">{taskTime(task) ? formatRelative(task.updated_at || task.started_at || task.created_at) : "未提供"}<ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></span>
    </button>
    {onQuickPreview && quickKind && <button type="button" className="absolute right-3 top-1/2 z-10 inline-flex -translate-y-1/2 rounded-[7px] border border-line bg-panel px-2 py-1 text-2xs font-medium text-ink shadow-panel hover:border-primary hover:text-primary focus-visible:border-focus" onClick={(event) => { event.stopPropagation(); onQuickPreview(); }} aria-label={`${quickKind === "audio" ? "播放" : "预览"} ${task.results[0].name || task.title}`}>
      {quickKind === "audio" ? "播放" : "预览"}
    </button>}
  </li>;
}

function LaneStrip({ activeConnection, onFilter }: { activeConnection: string; onFilter: (connection: string) => void }) {
  const tasks = useTasks();
  if (tasks.status === "loading" && !tasks.connections.length) return <div className="flex gap-2 overflow-hidden">{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton h-14 w-52 shrink-0 rounded-[12px]" />)}</div>;
  if (!tasks.connections.length) return null;
  return <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="list" aria-label="任务连接">
    {tasks.connections.map((connection) => {
      const count = tasks.rows.filter((task) => task.connection_id === connection.id).length;
      const active = activeConnection === connection.id;
      return <button key={connection.id} type="button" role="listitem" aria-pressed={active} onClick={() => onFilter(connection.id)} className={cx(
        "flex min-w-48 shrink-0 items-center gap-3 rounded-[12px] border bg-panel px-3 py-2.5 text-left transition-[border-color,box-shadow] duration-150",
        active ? "border-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_14%,transparent)]" : "border-line hover:border-line-strong",
      )}>
        <Dot tone={connectionTone(connection.state)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{connection.label}</span>
          <span className="block truncate text-2xs text-muted" title={connection.project}>{connectionStateLabel(connection.state)} · {connection.project}</span>
        </span>
        <span className="tabular text-sm font-semibold text-ink-soft">{connection.state === "ready" ? count : "—"}</span>
      </button>;
    })}
  </div>;
}

function MissingSelection({ onClear, onTasks }: { onClear: () => void; onTasks: () => void }) {
  return <InlineNotice tone="warning" className="items-center">
    <span>链接中的任务不在当前观察批次中，可能已超出时间窗或属于其他范围。</span>
    <span className="mt-2 flex gap-2"><Button size="sm" onClick={onClear}>关闭</Button><Button size="sm" variant="ghost" onClick={onTasks}>返回任务中心</Button></span>
  </InlineNotice>;
}
