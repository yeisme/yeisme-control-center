import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInspectorMode } from "../../app/preferences";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clock3, Copy, Eye, FolderKanban, LoaderCircle, PanelRightOpen, Play, RefreshCw } from "../../icons";
import { linkActions, useCopy } from "../../app/item-actions";
import { api, errorCode, type TaskConnectionState, type TaskSnapshot } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { recentTarget, useRememberRecent } from "../../app/recent";
import { taskTime, useTasks } from "../../app/tasks-context";
import { useMediaPreview } from "../../components/media-preview";
import { SourceStatusLine } from "../../components/SourceStatusLine";
import { liveQuery, useOverlayParams } from "../../app/overlay-history";
import { Button, DataTable, fillMainColumn, Dot, EmptyState, InlineNotice, NoticeAction, NoticeStack, PageToolbar, Pager, Panel, Progress, ReadStateView, SkeletonRows, TaskStatePill, ToggleGroup, cx, ownerLabel, sortByColumn, useToast, type Column, type ItemAction } from "../../components/ui";
import { formatFullTime, formatRelative } from "../../shared/read-model/format";
import { collectResults, connectionStateLabel, connectionTone, inView, resultAction, stageLabel, taskInProgress, ownerModality, type TaskView } from "../../shared/read-model/tasks";
import { progressLabel, promptCaptureForTask, taskIsActive, taskNeedsAttention, taskStateLabels, type TaskFilters } from "../../task-observation";
import { compileTaskFilters, extractTaskQuery, rankByQuery, windowLabel, type QueryKey, type QueryVocabulary } from "../../shared/task-query";
import { facetCounts } from "../../shared/facets";
import { SavedViews } from "../../components/SavedViews";
import { QueryScope } from "../../components/QueryScope";
import type { QuerySuggestion, QuerySupport } from "../../components/QueryInput";
import { kindLabel } from "../../components/ui/Kind";
import { taskTarget } from "../../task-links";
import { TaskDetail, taskFamilyLabel } from "./TaskDetail";
import { kindOf } from "../../components/ui/Kind";
import { PromptCaptureSummary, promptFromTask, promptStateLabel } from "../../components/PromptCaptureSummary";
import { FilterBar } from "../../components/FilterBar";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { useListPreferences } from "../../app/preferences";
import { usePagedRows } from "../../app/use-paged-rows";
import { pageSizes, stepWithin, type PageSize } from "../../shared/pager";
import { formatSort, parseSort, type SortState } from "../../shared/list-sort";
import { readErrorMessage } from "../../shared/read-model/read-state";
import { AudioQueue, audioTrackFrom, useAudioPlayer } from "../../app/audio-player";
import { AudioPlayButton } from "../../components/AudioDock";
import { MediaViewer, viewerSlide, visualSlides } from "../../components/MediaViewer";
import { usePageEnter } from "../../app/use-page-enter";
import { projectTaskFreshness, taskFreshnessLabel } from "../../shared/task-freshness";

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
const taskOverlays = ["task", "preview"] as const;

export default function TasksPage() {
  const tasks = useTasks();
  const { scopeId } = useWorkspace();
  const navigate = useNavigate();
  const notify = useToast();
  const { pageSize, density, setPageSize, setDensity } = useListPreferences();
  const [params, setParams] = useSearchParams();
  const [, writeOverlay] = useOverlayParams(taskOverlays);
  const view = (views.some((item) => item.id === params.get("view")) ? params.get("view") : "all") as TaskView;
  const selectedKey = params.get("task");
  const [resolved, setResolved] = useState<TaskSnapshot | null>(null);
  const [resolving, setResolving] = useState(false);
  const resolvedKey = useRef<string | null>(null);
  const [resolveRetry, setResolveRetry] = useState(0);
  const [inspectorMode, setInspectorMode] = useInspectorMode();

  const filters: TaskFilters = {
    text: params.get("q") || "",
    connection: params.get("connection") || "",
    owner: params.get("owner") || "",
    project: params.get("project") || "",
    state: params.get("state") || "",
    family: params.get("family") || "",
    modality: params.get("kind") || "",
    results: params.get("results") || "",
    prompt: params.get("prompt") || "",
    from: params.get("from") || "",
    through: params.get("to") || "",
    episode: params.get("episode") || "",
    updated: params.get("upd") || "",
  };

  const update = useCallback((patch: Record<string, string | null>, history: "push" | "replace" = "replace", resetPagination = false) => {
    // From the address as it is now: two quick changes (a held ] key) build on each other, not on the last render.
    const next = new URLSearchParams(liveQuery(params));
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPagination) next.delete("page");
    writeOverlay(next, history);
  }, [params, writeOverlay]);

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

  // Notification links carry the signed task key directly. If that task is outside the first observed page,
  // read the original task once so the Inspector opens instead of leaving the person to search manually.
  useEffect(() => {
    if (!selectedKey || legacy || tasks.status === "loading") {
      if (!selectedKey) { resolvedKey.current = null; setResolved(null); }
      return;
    }
    if (tasks.rows.some((task) => task.task_key === selectedKey) || resolvedKey.current === selectedKey) return;
    const controller = new AbortController();
    resolvedKey.current = selectedKey;
    setResolving(true);
    api.task(scopeId, selectedKey, controller.signal)
      .then((task) => setResolved(task))
      .catch((error) => { if (!controller.signal.aborted) { resolvedKey.current = null; notify(`无法定位原任务（${errorCode(error)}），可重新读取或返回任务中心。`, "warning"); } })
      .finally(() => { if (!controller.signal.aborted) setResolving(false); });
    return () => controller.abort();
  }, [legacy, notify, resolveRetry, scopeId, selectedKey, tasks.rows, tasks.status]);

  // The words `工具:` and `连接:` may be typed as labels; the query reads them through what this list knows.
  const vocabulary = useMemo<QueryVocabulary>(() => ({
    owners: [...new Set(tasks.connections.map((connection) => connection.owner))].map((owner) => ({ value: owner, label: ownerLabel(owner) })),
    connections: tasks.connections.map((connection) => ({ value: connection.id, label: connection.label })),
    families: [...new Set(tasks.rows.map((task) => task.locator.task_family).filter(Boolean))].map((family) => ({ value: family, label: taskFamilyLabel(family) })),
  }), [tasks.connections, tasks.rows]);
  const now = useMemo(() => Date.now(), [tasks.observedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const filterKey = JSON.stringify(filters);
  const compiled = useMemo(() => compileTaskFilters(filters, { vocabulary, now }), [filterKey, vocabulary, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => tasks.rows.filter((task) => inView(task, view) && compiled.matches(task)), [tasks.rows, view, compiled]);
  // Beside each option, how many rows it would leave given every other filter.
  const facetValues = useMemo(() => facetCounts(tasks.rows, ["owner", "state", "connection", "project", "family", "results", "prompt"], (task, key) => {
    if (key === "owner") return task.locator.owner;
    if (key === "state") return task.state;
    if (key === "connection") return task.connection_id;
    if (key === "project") return task.locator.project;
    if (key === "family") return task.locator.task_family;
    if (key === "results") return task.results.length ? "yes" : "no";
    return promptCaptureForTask(task)?.state;
  }, (task, except) => inView(task, view) && compiled.matches(task, except)), [compiled, tasks.rows, view]);
  const countOf = (key: string, value: string) => facetValues[key]?.[value] || 0;
  const counts = useMemo(() => ({
    all: tasks.rows.length,
    active: tasks.rows.filter(taskInProgress).length,
    attention: tasks.rows.filter(taskNeedsAttention).length,
    history: tasks.rows.filter((task) => !taskIsActive(task)).length,
  }), [tasks.rows]);
  const selected = tasks.rows.find((task) => task.task_key === selectedKey) || (resolved?.task_key === selectedKey ? resolved : null);
  useRememberRecent(selected?.task_key ? { key: `task:${selected.task_key}`, kind: "task", label: selected.title, meta: `${ownerLabel(selected.locator.owner)} · 任务`, target: recentTarget("/tasks", params) } : null);
  const previewEntries = useMemo(() => {
    const entries = collectResults(resolved ? [...tasks.rows, resolved] : tasks.rows);
    return [...new Map(entries.map((entry) => [entry.key, entry])).values()];
  }, [resolved, tasks.rows]);
  const resolvePreview = useCallback((key: string) => previewEntries.find((entry) => entry.key === key) || null, [previewEntries]);
  // Audio plays in the global player, never in the task Inspector, so an audio preview key is ignored here.
  const requestedPreview = params.get("preview");
  const previewKey = requestedPreview && resolvePreview(requestedPreview)?.kind === "audio" ? null : requestedPreview;
  const setPreviewKey = useCallback((key: string | null, history: "push" | "replace") => update({ preview: key }, history), [update]);
  const preview = useMediaPreview({ previewKey, resolve: resolvePreview, onPreviewKeyChange: setPreviewKey, urlParam: "preview" });
  const player = useAudioPlayer();
  useEffect(() => {
    if (!requestedPreview) return;
    const entry = resolvePreview(requestedPreview);
    if (!entry || entry.kind !== "audio") return;
    player.play(audioTrackFrom(entry, `/tasks?task=${encodeURIComponent(entry.task.task_key || "")}`));
    update({ preview: null }, "replace");
  }, [player, requestedPreview, resolvePreview, update]);
  const owners = [...new Set(tasks.rows.map((task) => task.locator.owner))];
  const states = [...new Set(tasks.rows.map((task) => task.state))].sort();
  const projects = [...new Set(tasks.rows.map((task) => task.locator.project).filter(Boolean))].sort();
  const families = [...new Set(tasks.rows.map((task) => task.locator.task_family).filter(Boolean))].sort();

  const changeInspectorMode = useCallback((mode: InspectorMode) => {
    setInspectorMode(mode);
  }, []);

  const selectedLane = view === "active" ? tasks.lanes.active : view === "history" ? tasks.lanes.history : null;
  const selectedLaneLabel = view === "history" ? "历史任务" : "进行中任务";
  const emptyExplainsLane = filtered.length === 0 && !!selectedLane && laneHasGap(selectedLane);
  const laneRecovery = (lane: TaskLane) => lane.status === "needs_contract" || lane.status === "forbidden"
    ? <Button size="sm" variant="ghost" onClick={() => navigate("/services")}>查看服务与连接</Button>
    : <Button size="sm" variant="ghost" onClick={tasks.refresh}>重新读取</Button>;
  const notices = [
    selectedKey && !selected && tasks.status !== "loading" && !resolving && <MissingSelection key="missing" onClear={() => update({ task: null })} onTasks={() => navigate("/tasks")} onRetry={() => setResolveRetry((value) => value + 1)} />,
    // An empty view whose lane failed explains itself below; otherwise one line names the connections the list lacks.
    !emptyExplainsLane && <SourceStatusLine key="source" noun="任务列表" />,
  ];

  const quickPreview = useCallback((task: TaskSnapshot, result: TaskSnapshot["results"][number]) => {
    const kind = kindOf(result.mime, ownerModality[task.locator.owner]);
    const key = `${task.task_key || task.locator.task_ref}:${result.ref}`;
    // The row preview opens the viewer only; its 查看详情 action opens the task Inspector when wanted.
    const next = new URLSearchParams(params);
    next.set("preview", key);
    writeOverlay(next, "push");
    preview.open({ key, task, result, kind }, { source: "task-row", autoplay: true, syncQuery: false });
  }, [params, preview, writeOverlay]);
  // Playing from the task list queues every playable audio result of the listed tasks, in list order.
  const audioQueue = useMemo(() => collectResults(filtered).filter((entry) => entry.kind === "audio" && resultAction(entry.task, "preview").enabled).map((entry) => audioTrackFrom(entry, `/tasks?task=${encodeURIComponent(entry.task.task_key || "")}`)), [filtered]);
  const viewerSlides = useMemo(() => {
    const slides = visualSlides(collectResults(filtered));
    const current = previewKey ? resolvePreview(previewKey) : null;
    return current && !slides.some((slide) => slide.key === current.key) ? [viewerSlide(current), ...slides] : slides;
  }, [filtered, previewKey, resolvePreview]);
  const navigateViewer = useCallback((key: string) => {
    const entry = resolvePreview(key);
    if (!entry) return;
    preview.open(entry, { source: "task-row", autoplay: true, syncQuery: false });
    update({ preview: key, ...(selectedKey ? { task: entry.task.task_key || null } : {}) }, "replace");
  }, [preview, resolvePreview, selectedKey, update]);
  const showViewerDetails = useCallback((key: string) => {
    const entry = resolvePreview(key);
    if (entry) update({ task: entry.task.task_key || null, preview: null }, "replace");
  }, [resolvePreview, update]);
  const columns = taskColumns(tasks.connections, quickPreview);
  const sort = parseSort(params.get("sort"), sortableTaskColumns);
  // A chosen sort wins; with words typed and no sort, the best match comes first.
  const sorted = useMemo(() => sort ? sortByColumn(filtered, columns, sort) : rankByQuery(filtered, compiled), [filtered, sort?.id, sort?.dir, compiled]); // eslint-disable-line react-hooks/exhaustive-deps
  const querySupport = useMemo<QuerySupport>(() => ({
    extract: (text, current) => extractTaskQuery(text, current, vocabulary, Date.now()),
    suggest: (key) => taskQuerySuggestions(key, tasks.rows, vocabulary, facetValues),
    chips: {
      episode: { label: "集" },
      upd: { label: "更新", format: windowLabel },
      kind: { label: "类型", format: (value) => value.split(",").map((item) => kindLabel(item as Parameters<typeof kindLabel>[0])).join("、") },
      sort: { label: "排序", format: (value) => sortWords[value] || value },
    },
  }), [facetValues, tasks.rows, vocabulary]);
  const paged = usePagedRows(sorted, pageSize, taskOverlays);
  // Previous and next walk the whole filtered, sorted list; the list turns to the page the task is on. The step starts
  // from the task in the address, which a quick second press may already have changed before this page rendered again.
  const taskKeys = useMemo(() => sorted.map((task) => task.task_key || ""), [sorted]);
  const latestKeys = useRef(taskKeys);
  latestKeys.current = taskKeys;
  const selectedIndex = selectedKey ? taskKeys.indexOf(selectedKey) : -1;
  const stepTask = useCallback((delta: -1 | 1) => {
    const target = stepWithin(latestKeys.current, new URLSearchParams(liveQuery(params)).get("task"), delta, pageSize);
    if (target?.key) update({ task: target.key, page: target.page > 1 ? String(target.page) : null }, "replace");
  }, [pageSize, params, update]);
  const stepper = selectedIndex >= 0 ? {
    noun: "任务",
    previous: selectedIndex > 0 ? () => stepTask(-1) : undefined,
    next: selectedIndex < taskKeys.length - 1 ? () => stepTask(1) : undefined,
    position: `${selectedIndex + 1} / ${taskKeys.length}`,
  } : undefined;
  const changeSort = (next: SortState | null) => update({ sort: formatSort(next) }, "replace", true);
  const copy = useCopy();
  // The row's context menu: what its row button, its quick action and the inspector header offer, in one place.
  const taskActions = useCallback((task: TaskSnapshot): ItemAction[] => {
    const key = task.task_key || "";
    const result = task.results.length === 1 && resultAction(task, "preview").enabled ? task.results[0] : null;
    const kind = result ? kindOf(result.mime, ownerModality[task.locator.owner]) : null;
    const route = `/tasks?task=${encodeURIComponent(key)}`;
    return [
      { id: "open", label: "打开详情", icon: <PanelRightOpen />, group: "open", disabled: !key, run: () => update({ task: key || null }, "push") },
      ...(result && kind !== "audio" ? [{ id: "preview", label: "预览结果", icon: <Eye />, group: "open", run: () => quickPreview(task, result) }] : []),
      ...(result && kind === "audio" ? [{ id: "play", label: "播放结果", icon: <Play />, group: "open", run: () => player.play(audioTrackFrom({ key: `${key || task.locator.task_ref}:${result.ref}`, task, result, kind: "audio" }, route)) }] : []),
      { id: "project", label: "查看所属项目", icon: <FolderKanban />, group: "open", run: () => navigate(`/projects?catalog=owner&project=${encodeURIComponent(`${task.locator.owner}:${task.locator.project}`)}`) },
      ...(key ? linkActions(route, copy) : []),
      { id: "copy-ref", label: "复制任务引用", icon: <Copy />, group: "link", run: () => void copy(task.locator.task_ref, "任务引用") },
    ];
  }, [copy, navigate, player, quickPreview, update]);

  const enter = usePageEnter(!selected);
  return <AudioQueue tracks={audioQueue}><div className={cx(!selected && enter.className, "flex min-h-0 flex-col gap-5", selected && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} onAnimationEnd={enter.onAnimationEnd} data-page="tasks">
    <div className={cx("flex min-h-0 flex-1 gap-4", selected && inspectorMode === "fixed" ? "items-stretch" : "") }>
      <div className="min-w-0 flex-1 space-y-5">
    <h1 className="sr-only">任务中心</h1>
    <PageToolbar
      summary="各个工具里任务的进度、结果和提示词采集。这里只看，不会替你重新提交。"
      actions={<Button size="sm" onClick={tasks.refresh} disabled={tasks.refreshing} icon={<RefreshCw className={cx("size-3.5", tasks.refreshing && "motion-safe:animate-spin")} />}>重新观察</Button>}
      metrics={<ToggleGroup label="任务视图" value={view} onChange={(value) => update({ view: value === "all" ? null : value }, "replace", true)} options={views.map((item) => ({ ...item, count: tasks.status === "loading" ? null : counts[item.id] }))} />}
      meta={tasks.observedAt ? <span className="inline-flex items-center gap-1.5 text-2xs text-muted" title={formatFullTime(tasks.observedAt)}><Clock3 className="size-3.5" />观察于 {formatRelative(tasks.observedAt)}</span> : undefined}
    >
      <LaneStrip onFilter={(connection) => update({ connection: filters.connection === connection ? null : connection }, "replace", true)} activeConnection={filters.connection} />
    </PageToolbar>

    <NoticeStack notices={notices} />

    <Panel bodyClassName="p-0">
      <div className="space-y-2.5 border-b border-line px-4 py-3">
        {/* On a phone the views move into the conditions drawer, so the first task stays on the first screen. */}
        <SavedViews className="max-sm:hidden" />
        <FilterBar placeholder="搜索任务，或输入 状态:失败 这样的条件" dates query={querySupport} drawerTop={<fieldset className="min-w-0"><legend className="mb-1.5 text-[13px] font-medium text-ink-soft">视图</legend><SavedViews className="flex-wrap" /></fieldset>} facets={[
          { key: "owner", label: "来源", options: [...new Set(tasks.connections.map((c) => c.owner))].map((v) => ({ value: v, label: ownerLabel(v), count: countOf("owner", v) })) },
          { key: "state", label: "状态", options: states.map((v) => ({ value: v, label: readableState(v), count: countOf("state", v) })) },
          { key: "connection", label: "连接", options: tasks.connections.map((c) => ({ value: c.id, label: c.label, count: countOf("connection", c.id) })) },
          { key: "project", label: "项目", options: projects.map((v) => ({ value: v, label: v, count: countOf("project", v) })) },
          { key: "family", label: "类型", options: families.map((v) => ({ value: v, label: taskFamilyLabel(v), count: countOf("family", v) })) },
          { key: "results", label: "成果", options: [{ value: "yes", label: "有成果", count: countOf("results", "yes") }, { value: "no", label: "无成果", count: countOf("results", "no") }] },
          { key: "prompt", label: "提示词", options: ["captured", "redacted", "queued", "capturing", "not_recorded", "blocked", "failed", "expired"].map((v) => ({ value: v, label: promptStateLabel(v as Parameters<typeof promptStateLabel>[0]), count: countOf("prompt", v) })) },
        ]} />
        <QueryScope matched={filtered.length} />
      </div>

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
            rows={paged.rows}
            rowKey={(task) => task.task_key || `${task.connection_id}:${task.locator.task_ref}`}
            rowLabel={(task) => `打开任务 ${task.title}，${ownerLabel(task.locator.owner)}，${taskStateLabels[task.state] || "结果未知"}`}
            rowAttributes={(task) => ({ "data-task": task.locator.task_ref })}
            selectedKey={selectedKey}
            density={density}
            onRowClick={(task) => update({ task: task.task_key || null })}
            rowActions={taskActions}
            sort={sort}
            onSort={changeSort}
          />
          <Pager
            window={paged}
            onPage={paged.setPage}
            noun="条已加载任务"
            pageSize={pageSize}
            pageSizes={pageSizes}
            onPageSize={(value) => { setPageSize(value as PageSize); update({}, "replace", true); }}
            density={density}
            onDensity={setDensity}
          />
        </>}
      </ReadStateView>
    </Panel>

      </div>
    {selected && inspectorMode === "fixed" && <TaskDetail task={selected} open mode={inspectorMode} onModeChange={changeInspectorMode} preview={preview} stepper={stepper} onOpenChange={(open) => { if (!open) update({ task: null, preview: null }); }} />}
    </div>
    {selected && inspectorMode === "floating" && <TaskDetail task={selected} open mode={inspectorMode} onModeChange={changeInspectorMode} preview={preview} stepper={stepper} onOpenChange={(open) => { if (!open) update({ task: null, preview: null }); }} />}
    <MediaViewer controller={preview} slides={viewerSlides} onNavigate={navigateViewer} onDetails={showViewerDetails} detailsLabel="查看任务" />
  </div></AudioQueue>;
}

const sortableTaskColumns = ["task", "state", "updated"] as const;
const sortWords: Record<string, string> = { "updated:desc": "最新在前", "updated:asc": "最早在前", "task:asc": "标题 A→Z", "task:desc": "标题 Z→A", "state:asc": "先看要处理的", "state:desc": "先看已结束的" };
const stateWords: Record<string, string> = { failed: "失败", partial_failed: "部分失败", rejected: "未通过", running: "执行中", queued: "排队中", pending: "等待执行", waiting_review: "等你确认", unknown: "结果未知", succeeded: "已完成", completed: "已完成", cancelled: "已取消", canceled: "已取消", blocked: "受阻" };
const promptWords: Record<string, string> = { captured: "已采集", redacted: "已脱敏", queued: "排队", capturing: "采集中", not_recorded: "未记录", blocked: "受阻", failed: "失败", expired: "过期" };

/** What `键:` offers, in words the query reads back, with how many rows each would leave. */
function taskQuerySuggestions(key: QueryKey, rows: TaskSnapshot[], vocabulary: QueryVocabulary, counts: Record<string, Record<string, number>>): QuerySuggestion[] {
  const distinct = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => !!value))].sort();
  switch (key) {
    case "state": return distinct(rows.map((task) => task.state)).map((state) => ({ value: stateWords[state] || state, label: stateWords[state] || state, count: counts.state?.[state] }));
    case "owner": return vocabulary.owners.map((owner) => ({ value: owner.value, label: owner.label, count: counts.owner?.[owner.value] }));
    case "connection": return vocabulary.connections.map((connection) => ({ value: connection.label, label: connection.label, count: counts.connection?.[connection.value] }));
    case "project": return distinct(rows.map((task) => task.locator.project)).map((project) => ({ value: project, label: project, count: counts.project?.[project] }));
    case "family": return [...["图片", "视频", "声音"].map((word) => ({ value: word, label: `${word}（结果类型）` })), ...vocabulary.families.map((family) => ({ value: family.label, label: family.label, count: counts.family?.[family.value] }))];
    case "episode": return distinct(rows.map((task) => task.episode_ref)).map((episode) => ({ value: episode, label: episode }));
    case "upd":
    case "created": return ["24h", "7d", "30d", "今天", "本周"].map((value) => ({ value, label: windowLabel(value) }));
    case "results": return [{ value: "有", label: "有结果", count: counts.results?.yes }, { value: "无", label: "没有结果", count: counts.results?.no }];
    case "prompt": return Object.entries(promptWords).map(([state, word]) => ({ value: word, label: word, count: counts.prompt?.[state] }));
    case "sort": return [{ value: "最新", label: "最新在前" }, { value: "最早", label: "最早在前" }, { value: "标题", label: "按标题" }, { value: "状态", label: "先看要处理的" }];
    default: return [];
  }
}
/** Sorting by state puts what needs a person first, then what is moving, then what is done. */
const stateRank: Record<string, number> = { unknown: 0, failed: 1, partial_failed: 2, rejected: 3, waiting_review: 4, blocked: 5, cancel_requested: 6, running: 7, queued: 8, pending: 9, created: 10, partial: 11, handoff_ready: 12, dry_run: 13, succeeded: 14, completed: 14, cancelled: 15, canceled: 15 };

function StateCell({ task }: { task: TaskSnapshot }) {
  const percent = taskInProgress(task) ? percentOf(task) : null;
  const freshness = task.control_center_freshness ? { control_center_freshness: task.control_center_freshness } : projectTaskFreshness(task);
  return <span className="flex min-w-[5.5rem] flex-col items-start gap-1.5">
    <TaskStatePill state={task.state} />
    {freshness.control_center_freshness !== "fresh" && <span className={cx("text-2xs", freshness.control_center_freshness === "expired" ? "text-danger" : "text-warning")}>{taskFreshnessLabel(freshness.control_center_freshness)}</span>}
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
      sort: { value: (task) => task.title },
      className: `${fillMainColumn} overflow-hidden`,
      cell: (task) => <span className="flex min-w-0 items-center gap-3">
        <TaskThumbnail task={task} result={task.results[0]} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-body-sm font-medium text-ink @2xl:line-clamp-1">{task.title}</span>
          <span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} · {taskFamilyLabel(task.locator.task_family)} · <span className="font-mono">{task.locator.task_ref}</span></span>
          <PromptCaptureSummary prompt={promptFromTask(task)} compact className="mt-1" />
        </span>
      </span>,
    },
    { id: "state", header: "状态", sort: { value: (task) => stateRank[task.state] ?? 50 }, cell: (task) => <StateCell task={task} /> },
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
      sort: { value: (task) => taskTime(task) || null, first: "desc" },
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
        const kind = kindOf(result.mime, ownerModality[task.locator.owner]);
        if (kind === "audio") return <AudioPlayButton track={audioTrackFrom({ key: `${task.task_key || task.locator.task_ref}:${result.ref}`, task, result, kind }, `/tasks?task=${encodeURIComponent(task.task_key || "")}`)} variant="secondary" stop />;
        return <Button size="sm" variant="secondary" aria-label={`预览 ${result.name || task.title}`} onClick={(event) => { event.stopPropagation(); onQuickPreview(task, result); }}>预览</Button>;
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

function MissingSelection({ onClear, onTasks, onRetry }: { onClear: () => void; onTasks: () => void; onRetry: () => void }) {
  return <InlineNotice tone="warning" actions={<><NoticeAction onClick={onRetry}>重新读取</NoticeAction><NoticeAction onClick={onClear}>关闭</NoticeAction><NoticeAction onClick={onTasks}>返回任务中心</NoticeAction></>}>
    链接中的任务不在当前观察批次中，可能已超出时间窗或属于其他范围。
  </InlineNotice>;
}
