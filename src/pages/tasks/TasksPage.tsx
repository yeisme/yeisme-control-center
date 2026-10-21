import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Clock3, LoaderCircle, RefreshCw, SlidersHorizontal } from "../../icons";
import { api, errorCode, type TaskConnectionState, type TaskSnapshot } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { taskTime, useTasks } from "../../app/tasks-context";
import { useMediaPreview } from "../../components/media-preview";
import { Button, DataTable, Dot, EmptyState, InlineNotice, NoticeStack, PageToolbar, Panel, Progress, ReadStateView, SearchField, Select, SkeletonRows, StaleNotice, TaskStatePill, ToggleGroup, cx, ownerLabel, useToast, type Column } from "../../components/ui";
import { formatFullTime, formatRelative } from "../../shared/read-model/format";
import { collectResults, connectionStateLabel, connectionTone, inView, resultAction, stageLabel, taskInProgress, ownerModality, type TaskView } from "../../shared/read-model/tasks";
import { filterTasks, progressLabel, taskIsActive, taskNeedsAttention, taskStateLabels, type TaskFilters } from "../../task-observation";
import { taskTarget } from "../../task-links";
import { TaskDetail, taskFamilyLabel } from "./TaskDetail";
import { kindOf } from "../../components/ui/Kind";
import { PromptCaptureSummary, promptFromTask, promptStateLabel } from "../../components/PromptCaptureSummary";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { pageSizes, useListPreferences, type ListDensity, type PageSize } from "../../app/list-preferences";
import { readErrorMessage } from "../../shared/read-model/read-state";

const views: { id: TaskView; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "active", label: "进行中" },
  { id: "attention", label: "需要关注" },
  { id: "history", label: "已结束" },
];

const readableState = (state: string) => taskStateLabels[state] || state.replace(/_/g, " ");
const percentOf = (task: TaskSnapshot) => {
  const { kind, percent, completed, total } = task.progress;
  if (kind === "percent" && percent !== null && percent >= 0 && percent <= 100) return percent;
  if (kind === "count" && total !== null && total > 0 && completed !== null) return Math.min(100, Math.round((completed / total) * 100));
  return null;
};
type TaskLane = ReturnType<typeof useTasks>["lanes"]["active"];
const laneHasGap = (lane: TaskLane) => !["ready", "empty", "loading"].includes(lane.status);
const laneMessage = (label: string, lane: TaskLane) => lane.status === "needs_contract"
  ? `${label}读取合同尚未提供；当前只展示已读取的其他任务。`
  : lane.status === "forbidden"
    ? `${label}读取未获当前范围授权；请检查 owner 连接权限。`
    : `${label}：${readErrorMessage(lane.error)}`;

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
  const selectedLaneLabel = view === "history" ? "历史任务" : "进行中任务";
  const emptyExplainsLane = filtered.length === 0 && !!selectedLane && laneHasGap(selectedLane);
  const laneRecovery = (lane: TaskLane) => lane.status === "needs_contract" || lane.status === "forbidden"
    ? <Button size="sm" variant="ghost" onClick={() => navigate("/services")}>查看服务与连接</Button>
    : <Button size="sm" variant="ghost" onClick={tasks.refresh}>重新读取</Button>;
  const laneGroups = new Map<string, { labels: string[]; lane: TaskLane }>();
  for (const [label, lane] of [["进行中任务", tasks.lanes.active], ["历史任务", tasks.lanes.history]] as const) {
    if (!laneHasGap(lane) || (emptyExplainsLane && lane === selectedLane)) continue;
    const group = laneGroups.get(`${lane.status}|${lane.error}`);
    if (group) group.labels.push(label);
    else laneGroups.set(`${lane.status}|${lane.error}`, { labels: [label], lane });
  }
  const laneNotices = [...laneGroups.entries()].map(([id, { labels, lane }]) => <InlineNotice key={id} tone="warning" className="items-center"><span className="flex flex-wrap items-center gap-x-2">{laneMessage(labels.join("、"), lane)}{laneRecovery(lane)}</span></InlineNotice>);
  const notices = [
    selectedKey && !selected && tasks.status !== "loading" && !resolving && <MissingSelection key="missing" onClear={() => update({ task: null })} onTasks={() => navigate("/tasks")} />,
    ...laneNotices,
    tasks.status === "stale" && laneNotices.length === 0 && <StaleNotice key="stale" status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} />,
    tasks.truncated && <InlineNotice key="truncated" tone="info">任务较多，本页只展示当前观察批次（已达分页上限）；筛选与计数仅针对已读取的批次。</InlineNotice>,
  ];

  const quickPreview = useCallback((task: TaskSnapshot, result: TaskSnapshot["results"][number]) => {
    const kind = kindOf(result.mime, ownerModality[task.locator.owner]);
    const key = `${task.task_key || task.locator.task_ref}:${result.ref}`;
    const next = new URLSearchParams(params);
    next.set("task", task.task_key || "");
    next.set("preview", key);
    setParams(next, { replace: false });
    preview.open({ key, task, result, kind }, { source: "task-row", autoplay: kind !== "audio", syncQuery: false });
  }, [params, preview, setParams]);
  const columns = taskColumns(tasks.connections, quickPreview);

  return <div className={cx(!selected && "page-enter", "flex min-h-0 flex-col gap-5", selected && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="tasks">
    <div className={cx("flex min-h-0 flex-1 gap-4", selected && inspectorMode === "fixed" ? "items-stretch" : "") }>
      <div className="min-w-0 flex-1 space-y-5">
    <h1 className="sr-only">任务中心</h1>
    <PageToolbar
      summary="各 owner 任务的进度、结果与提示词采集；只读观察，不会重新提交。"
      actions={<Button size="sm" onClick={tasks.refresh} disabled={tasks.refreshing} icon={<RefreshCw className={cx("size-3.5", tasks.refreshing && "motion-safe:animate-spin")} />}>重新观察</Button>}
      metrics={<ToggleGroup label="任务视图" value={view} onChange={(value) => update({ view: value === "all" ? null : value }, "replace", true)} options={views.map((item) => ({ ...item, count: tasks.status === "loading" ? null : counts[item.id] }))} />}
      meta={tasks.observedAt ? <span className="inline-flex items-center gap-1.5 text-2xs text-muted" title={formatFullTime(tasks.observedAt)}><Clock3 className="size-3.5" />观察于 {formatRelative(tasks.observedAt)}</span> : undefined}
    >
      <LaneStrip onFilter={(connection) => update({ connection: filters.connection === connection ? null : connection }, "replace", true)} activeConnection={filters.connection} />
    </PageToolbar>

    <NoticeStack notices={notices} />

    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <SearchField value={filters.text} onChange={(value) => update({ q: value || null }, "replace", true)} placeholder="标题、引用、项目" label="搜索任务" className="min-w-0 flex-1 sm:max-w-sm" />
        <Button size="sm" variant={showFilters || activeFilters ? "secondary" : "ghost"} aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)} icon={<SlidersHorizontal className="size-3.5" />}>
          筛选{activeFilters > 0 && <span className="tabular rounded-chip bg-primary px-1 text-2xs text-primary-ink">{activeFilters}</span>}
        </Button>
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
          {states.map((state) => <option key={state} value={state}>{readableState(state)}</option>)}
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
        {activeFilters > 0 && <button type="button" className="col-span-full justify-self-start text-body-sm font-medium text-info hover:underline" onClick={() => update({ owner: null, connection: null, state: null, results: null, prompt: null, family: null, project: null }, "replace", true)}>清除筛选</button>}
      </div>}

      {resolving && <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-body-sm text-muted"><LoaderCircle className="size-4 motion-safe:animate-spin" />正在按深链定位原任务…</p>}

      <ReadStateView
        status={tasks.status === "empty" ? "ready" : tasks.status}
        error={tasks.error}
        onRetry={tasks.refresh}
        skeleton={<SkeletonRows rows={7} />}
      >
        {filtered.length === 0 ? <EmptyState
          title={emptyExplainsLane ? `${selectedLaneLabel}暂不可用` : tasks.rows.length ? "没有符合条件的任务" : "当前范围没有任务记录"}
          body={emptyExplainsLane && selectedLane ? laneMessage(selectedLaneLabel, selectedLane) : tasks.rows.length ? "试试切换视图或清除筛选。" : "owner 返回了空的任务列表；这不代表连接故障，连接状态见上方。"}
          action={emptyExplainsLane && selectedLane ? laneRecovery(selectedLane) : tasks.rows.length ? <Button size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>清除视图与筛选</Button> : undefined}
        /> : <>
          <DataTable
            label="任务列表"
            columns={columns}
            rows={pageRows}
            rowKey={(task) => task.task_key || `${task.connection_id}:${task.locator.task_ref}`}
            rowLabel={(task) => `打开任务 ${task.title}，${ownerLabel(task.locator.owner)}，${taskStateLabels[task.state] || "结果未知"}`}
            rowAttributes={(task) => ({ "data-task": task.locator.task_ref })}
            selectedKey={selectedKey}
            density={density}
            onRowClick={(task) => update({ task: task.task_key || null })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-2xs text-muted">
            <span className="tabular">显示 {filtered.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageSize, filtered.length)} / {filtered.length} 条 · 第 {currentPage} / {pageCount} 页</span>
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
  </div>;
}

function StateCell({ task }: { task: TaskSnapshot }) {
  const percent = taskInProgress(task) ? percentOf(task) : null;
  return <span className="flex min-w-[5.5rem] flex-col items-start gap-1.5">
    <TaskStatePill state={task.state} />
    {percent !== null && <span className="flex w-full items-center gap-1.5">
      <Progress value={percent} label="进度" tone="info" className="min-w-0 flex-1" />
      <span className="tabular whitespace-nowrap text-2xs text-muted">{progressLabel(task.progress)}</span>
    </span>}
  </span>;
}

function taskColumns(connections: TaskConnectionState[], onQuickPreview: (task: TaskSnapshot, result: TaskSnapshot["results"][number]) => void): Column<TaskSnapshot>[] {
  return [
    {
      id: "task",
      header: "任务",
      className: "w-full max-w-0 overflow-hidden",
      cell: (task) => <span className="flex min-w-0 items-center gap-3">
        <TaskThumbnail task={task} result={task.results[0]} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-body-sm font-medium text-ink @2xl:line-clamp-1">{task.title}</span>
          <span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} · {taskFamilyLabel(task.locator.task_family)} · <span className="font-mono">{task.locator.task_ref}</span></span>
          <PromptCaptureSummary prompt={promptFromTask(task)} compact className="mt-1" />
        </span>
      </span>,
    },
    { id: "state", header: "状态", cell: (task) => <StateCell task={task} /> },
    {
      id: "stage",
      header: "阶段",
      priority: 2,
      cell: (task) => {
        const percent = taskInProgress(task) ? percentOf(task) : null;
        const detail = taskInProgress(task) ? (percent === null ? progressLabel(task.progress) : null) : task.results.length ? `${task.results.length} 个结果` : "无结果";
        return <span className="block min-w-20 text-body-sm text-ink-soft">
          <span className="block whitespace-nowrap">{stageLabel(task.stage)}</span>
          {detail && <span className="tabular block whitespace-nowrap text-2xs text-muted">{detail}</span>}
        </span>;
      },
    },
    {
      id: "connection",
      header: "连接",
      priority: 3,
      cell: (task) => {
        const label = connections.find((connection) => connection.id === task.connection_id)?.label || task.connection_id || "连接未提供";
        return <span className="block max-w-44 truncate text-body-sm text-ink-soft" title={label}>{label}</span>;
      },
    },
    {
      id: "updated",
      header: "更新",
      priority: 2,
      align: "end",
      cell: (task) => <span className="tabular whitespace-nowrap text-2xs text-muted" title={formatFullTime(task.updated_at || task.started_at || task.created_at)}>{taskTime(task) ? formatRelative(task.updated_at || task.started_at || task.created_at) : "未提供"}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">快捷操作</span>,
      align: "end",
      className: "pl-0",
      cell: (task) => {
        if (task.results.length !== 1 || !resultAction(task, "preview").enabled) return null;
        const result = task.results[0];
        const verb = kindOf(result.mime, ownerModality[task.locator.owner]) === "audio" ? "播放" : "预览";
        return <Button size="sm" variant="secondary" aria-label={`${verb} ${result.name || task.title}`} onClick={(event) => { event.stopPropagation(); onQuickPreview(task, result); }}>{verb}</Button>;
      },
    },
  ];
}

function LaneStrip({ activeConnection, onFilter }: { activeConnection: string; onFilter: (connection: string) => void }) {
  const tasks = useTasks();
  if (tasks.status === "loading" && !tasks.connections.length) return <div className="flex gap-2 overflow-hidden">{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton h-14 w-52 shrink-0 rounded-card" />)}</div>;
  if (!tasks.connections.length) return null;
  return <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="任务连接">
    {tasks.connections.map((connection) => {
      const count = tasks.rows.filter((task) => task.connection_id === connection.id).length;
      const active = activeConnection === connection.id;
      return <li key={connection.id} className="shrink-0"><button type="button" aria-pressed={active} onClick={() => onFilter(connection.id)} className={cx(
        "flex min-w-48 items-center gap-3 rounded-card border bg-panel px-3 py-2.5 text-left shadow-panel transition-[border-color,box-shadow] duration-150",
        active ? "border-primary shadow-selected" : "border-line hover:border-line-strong",
      )}>
        <Dot tone={connectionTone(connection.state)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-medium text-ink">{connection.label}</span>
          <span className="block truncate text-2xs text-muted" title={connection.project}>{connectionStateLabel(connection.state)} · {connection.project}</span>
        </span>
        <span className="tabular text-sm font-semibold text-ink-soft">{connection.state === "ready" ? count : "—"}</span>
      </button></li>;
    })}
  </ul>;
}

function MissingSelection({ onClear, onTasks }: { onClear: () => void; onTasks: () => void }) {
  return <InlineNotice tone="warning" className="items-center">
    <span>链接中的任务不在当前观察批次中，可能已超出时间窗或属于其他范围。</span>
    <span className="mt-2 flex gap-2"><Button size="sm" onClick={onClear}>关闭</Button><Button size="sm" variant="ghost" onClick={onTasks}>返回任务中心</Button></span>
  </InlineNotice>;
}
