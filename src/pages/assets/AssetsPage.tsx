import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Images,
  Info,
  LayoutGrid,
  List,
  LockKeyhole,
  Table2,
} from "../../icons";
import { useTasks } from "../../app/tasks-context";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import {
  Button,
  DataTable,
  Dot,
  EmptyState,
  Facts,
  IconButton,
  InlineNotice,
  KindBadge,
  MetricStrip,
  PageToolbar,
  Panel,
  Pill,
  ReadStateView,
  SearchField,
  Select,
  SkeletonBlock,
  StaleNotice,
  TaskStatePill,
  ToggleGroup,
  Tooltip,
  Unknown,
  cx,
  kindLabel,
  ownerLabel,
  type Column,
  type MediaKind,
  type Metric,
} from "../../components/ui";
import { ResultViewer } from "../../components/ResultViewer";
import { InlineMediaPreview, grantErrorLabel, useMediaPreview, type MediaPreviewController } from "../../components/media-preview";
import { collectResults, resultAction, type ResultEntry } from "../../shared/read-model/tasks";
import { formatRelative } from "../../shared/read-model/format";
import { ProcessTimeline } from "../../components/ProcessTimeline";
import {
  assetSpec,
  assetViewLabel,
  exportStatusLabel,
  parseAssetInspectorMode,
  parseAssetViewMode,
  resultStateLabel,
  reviewStatusLabel,
  type AssetInspectorMode,
  type AssetViewMode,
  type CodeLabel,
} from "./asset-view";
import { InspectorShell } from "../../components/InspectorShell";

type KindFilter = "all" | MediaKind;
type AccessFilter = "all" | "available" | "locked";
type PreviewAction = ReturnType<typeof resultAction>;

const viewPreferenceKey = "yeisme.control.assets.view";
const inspectorPreferenceKey = "yeisme.control.assets.inspector-mode";
const mediaKinds: MediaKind[] = ["image", "video", "audio", "text"];
const kindOptions: { id: KindFilter; label: string }[] = [
  { id: "all", label: "全部" },
  ...mediaKinds.map((id) => ({ id, label: kindLabel(id) })),
];

function ViewLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return <span className="inline-flex items-center gap-1.5">{icon}<span className="max-sm:sr-only">{text}</span></span>;
}

const viewOptions: { id: AssetViewMode; label: ReactNode }[] = [
  { id: "gallery", label: <ViewLabel icon={<LayoutGrid className="size-3.5" />} text={assetViewLabel("gallery")} /> },
  { id: "list", label: <ViewLabel icon={<List className="size-3.5" />} text={assetViewLabel("list")} /> },
  { id: "compact", label: <ViewLabel icon={<Table2 className="size-3.5" />} text={assetViewLabel("compact")} /> },
];

function readPreference<T>(key: string, fallback: T, parse: (value: string | null) => T) {
  if (typeof window === "undefined") return fallback;
  return parse(window.localStorage.getItem(key));
}

export default function AssetsPage() {
  const tasks = useTasks();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kind = (mediaKinds.includes((params.get("kind") || "") as MediaKind) ? params.get("kind") : "all") as KindFilter;
  const owner = params.get("owner") || "";
  const access = (["available", "locked"].includes(params.get("access") || "") ? params.get("access") : "all") as AccessFilter;
  const [query, setQuery] = useState("");
  const [storedView, setStoredView] = useState<AssetViewMode>(() => readPreference(viewPreferenceKey, "gallery", parseAssetViewMode));
  const view = params.get("view") ? parseAssetViewMode(params.get("view")) : storedView;
  const [inspectorMode, setInspectorMode] = useState<AssetInspectorMode>(() => readPreference(inspectorPreferenceKey, "fixed", parseAssetInspectorMode));
  const [maximized, setMaximized] = useState(false);
  const selectedKey = params.get("result");

  const update = useCallback((patch: Record<string, string | null>, history: "push" | "replace" = "replace") => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: history === "replace" });
  }, [params, setParams]);

  const all = useMemo(() => collectResults(tasks.rows), [tasks.rows]);
  const resolvePreview = useCallback((key: string) => all.find((entry) => entry.key === key) || null, [all]);
  const previewKey = params.get("preview");
  const setPreviewKey = useCallback((key: string | null, history: "push" | "replace") => update({ preview: key }, history), [update]);
  const preview = useMediaPreview({ previewKey, resolve: resolvePreview, onPreviewKeyChange: setPreviewKey });
  const visible = useMemo(() => all.filter((entry) => {
    if (kind !== "all" && entry.kind !== kind) return false;
    if (owner && entry.task.locator.owner !== owner) return false;
    const canPreview = resultAction(entry.task, "preview").enabled;
    if (access === "available" && !canPreview) return false;
    if (access === "locked" && canPreview) return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${entry.result.name} ${entry.task.title} ${entry.task.locator.task_ref} ${entry.task.locator.project}`.toLocaleLowerCase().includes(needle);
  }), [access, all, kind, owner, query]);
  const counts = useMemo(() => ({
    all: all.length,
    image: all.filter((entry) => entry.kind === "image").length,
    video: all.filter((entry) => entry.kind === "video").length,
    audio: all.filter((entry) => entry.kind === "audio").length,
    text: all.filter((entry) => entry.kind === "text").length,
  }), [all]);
  const owners = [...new Set(all.map((entry) => entry.task.locator.owner))];
  const previewable = useMemo(() => all.filter((entry) => resultAction(entry.task, "preview").enabled).length, [all]);
  const locked = all.length - previewable;
  const selected = all.find((entry) => entry.key === selectedKey) || null;
  const selectedIndex = selected ? visible.findIndex((entry) => entry.key === selected.key) : -1;

  const setView = (next: AssetViewMode) => {
    setStoredView(next);
    if (typeof window !== "undefined") window.localStorage.setItem(viewPreferenceKey, next);
    update({ view: next === "gallery" ? null : next });
  };

  const openDetails = useCallback((entry: ResultEntry, history: "push" | "replace" = "push") => {
    update({ result: entry.key, preview: null }, history);
  }, [update]);

  const openPreview = useCallback((entry: ResultEntry) => {
    if (!resultAction(entry.task, "preview").enabled) {
      openDetails(entry);
      return;
    }
    update({ result: entry.key }, "push");
    preview.open(entry, { source: "detail-sheet", autoplay: entry.kind === "video", history: "push" });
  }, [openDetails, preview, update]);

  const closeInspector = useCallback(() => {
    update({ result: null, preview: null }, "replace");
    setMaximized(false);
  }, [update]);

  const changeInspectorMode = (mode: AssetInspectorMode) => {
    setInspectorMode(mode);
    if (typeof window !== "undefined") window.localStorage.setItem(inspectorPreferenceKey, mode);
    update({ inspector: mode }, "replace");
  };

  useEffect(() => {
    const requested = params.get("inspector");
    if (requested === "fixed" || requested === "floating") setInspectorMode(requested);
  }, [params]);

  const navigateSelection = (direction: -1 | 1) => {
    if (!visible.length || selectedIndex < 0) return;
    const next = visible[Math.min(visible.length - 1, Math.max(0, selectedIndex + direction))];
    if (next) openDetails(next);
  };

  const loading = tasks.status === "loading";
  const metrics: Metric[] = [
    { label: "全部", value: counts.all },
    ...mediaKinds.filter((item) => counts[item] > 0).map((item) => ({ label: kindLabel(item), value: counts[item] })),
    { label: "可预览", value: previewable },
    { label: "未授权", value: locked, tone: locked > 0 ? "warning" as const : "neutral" as const },
  ];

  return <div className={cx("page-enter space-y-5", selected && inspectorMode === "fixed" && !maximized && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="assets">
    <h1 className="sr-only">资源库</h1>
    <PageToolbar
      summary="浏览 owner 任务产出的结果；选择资源查看来源、权限与生产过程。预览和播放只在点击后才读取内容。"
      metrics={loading ? <SkeletonBlock className="h-[50px] w-80 max-w-full rounded-control" /> : all.length > 0 ? <MetricStrip label="资源概况" items={metrics} /> : undefined}
      meta={!loading && (tasks.observedAt || tasks.truncated) ? <>
        {tasks.observedAt && <span className="inline-flex items-center gap-1.5 text-2xs text-muted"><Clock3 className="size-3.5" />读取于 {formatRelative(tasks.observedAt)}</span>}
        {tasks.truncated && <Pill size="sm" tone="info" title="历史任务按页数上限读取，资源数量只代表已读取的批次。">历史未读全</Pill>}
      </> : undefined}
      actions={<ToggleGroup<AssetViewMode> label="资源视图" value={view} onChange={setView} options={viewOptions} />}
    />
    <StaleNotice status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} onRetry={tasks.refresh} />

    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <ToggleGroup<KindFilter> label="类型" value={kind} onChange={(value) => update({ kind: value })} options={kindOptions} />
        <Select aria-label="来源" value={owner} onChange={(event) => update({ owner: event.target.value || null })} className="w-32">
          <option value="">全部来源</option>
          {owners.map((item) => <option key={item} value={item}>{ownerLabel(item)}</option>)}
        </Select>
        <Select aria-label="内容权限" value={access} onChange={(event) => update({ access: event.target.value })} className="w-36">
          <option value="all">全部权限</option>
          <option value="available">可预览</option>
          <option value="locked">未授权</option>
        </Select>
        <SearchField value={query} onChange={setQuery} placeholder="文件、结果或任务名称" label="搜索资源" className="ml-auto w-full sm:w-64" />
      </div>
      <ReadStateView status={tasks.status === "empty" ? "ready" : tasks.status} error={tasks.error} onRetry={tasks.refresh} skeleton={<AssetSkeleton view={view} />}>
        {visible.length === 0 ? <EmptyState icon={<Images />} title={all.length ? "没有符合条件的资源" : "当前批次没有任务结果"} body={all.length ? "试试切换类型、权限或视图筛选。" : "结果来自 owner 任务投影；没有结果不代表生成失败。"} /> : <>
          <AssetBrowser view={view} entries={visible} selectedKey={selected?.key || null} onDetails={openDetails} onPreview={openPreview} />
          <div className="border-t border-line px-4 py-3 text-2xs text-muted tabular">显示 {visible.length} / {all.length} 个资源</div>
        </>}
      </ReadStateView>
    </Panel>

    {selected && <AssetInspector
      entry={selected}
      preview={preview}
      mode={inspectorMode}
      maximized={maximized}
      onModeChange={changeInspectorMode}
      onMaximize={() => setMaximized((value) => !value)}
      onClose={closeInspector}
      onPrevious={() => navigateSelection(-1)}
      onNext={() => navigateSelection(1)}
      hasPrevious={selectedIndex > 0}
      hasNext={selectedIndex >= 0 && selectedIndex < visible.length - 1}
      onOpenTask={() => navigate(`/tasks?task=${encodeURIComponent(selected.task.task_key || "")}`)}
    />}
  </div>;
}

function AssetBrowser({ view, entries, selectedKey, onDetails, onPreview }: { view: AssetViewMode; entries: ResultEntry[]; selectedKey: string | null; onDetails: (entry: ResultEntry) => void; onPreview: (entry: ResultEntry) => void }) {
  if (view !== "gallery") return <AssetTable compact={view === "compact"} entries={entries} selectedKey={selectedKey} onDetails={onDetails} onPreview={onPreview} />;
  return <ul className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4 p-4" aria-label="资源大图网格">{entries.map((entry, index) => <AssetGalleryCard key={entry.key} entry={entry} index={index} selected={entry.key === selectedKey} onDetails={() => onDetails(entry)} onPreview={() => onPreview(entry)} />)}</ul>;
}

function AccessState({ action }: { action: PreviewAction }) {
  return action.enabled
    ? <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-2xs text-success"><Dot tone="success" />可预览</span>
    : <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-2xs text-warning" title={action.reason || undefined}><LockKeyhole className="size-3" />未授权</span>;
}

function PreviewButton({ entry, action, onPreview, iconOnly = false, variant = "ghost", className, stop = false }: { entry: ResultEntry; action: PreviewAction; onPreview: () => void; iconOnly?: boolean; variant?: "secondary" | "ghost"; className?: string; stop?: boolean }) {
  const verb = entry.kind === "audio" ? "播放" : "预览";
  const label = `${verb} ${entry.result.name || "未命名结果"}`;
  const title = action.reason || "申请短期预览句柄";
  const run = (event: MouseEvent) => {
    if (stop) event.stopPropagation();
    onPreview();
  };
  if (iconOnly) return <IconButton label={label} variant={variant} disabled={!action.enabled} title={title} className={className} onClick={run} icon={<Eye className="size-3.5" />} />;
  return <Button size="sm" variant={variant} disabled={!action.enabled} title={title} aria-label={label} className={className} onClick={run} icon={<Eye className="size-3.5" />}>{verb}</Button>;
}

function DetailsButton({ name, onDetails, variant = "ghost", className, stop = false }: { name: string; onDetails: () => void; variant?: "secondary" | "ghost"; className?: string; stop?: boolean }) {
  return <Tooltip content="打开详情">
    <Button size="icon-sm" variant={variant} aria-label={`打开 ${name} 详情`} className={className} onClick={(event) => {
      if (stop) event.stopPropagation();
      onDetails();
    }} icon={<Info className="size-3.5" />} />
  </Tooltip>;
}

const posterTone: Record<MediaKind, string> = {
  image: "bg-kind-image-soft",
  video: "bg-kind-video-soft",
  audio: "bg-kind-audio-soft",
  text: "bg-kind-text-soft",
};

function AssetPoster({ entry, action }: { entry: ResultEntry; action: PreviewAction }) {
  const spec = assetSpec(entry.result);
  const thumbnail = entry.kind === "image" && action.enabled && entry.result.thumbnail?.state === "ready";
  const chip = [kindLabel(entry.kind), spec.format, entry.kind === "image" ? null : spec.duration].filter(Boolean).join(" · ");
  return <span className={cx("relative block aspect-[16/10] overflow-hidden", posterTone[entry.kind])}>
    {thumbnail
      ? <TaskThumbnail task={entry.task} result={entry.result} size="lg" className="absolute inset-0 border-0! rounded-none! bg-transparent!" />
      : entry.kind === "image"
        ? <><span aria-hidden="true" className="media-checker absolute inset-0 opacity-45" /><span className="absolute inset-0 grid place-items-center"><KindBadge kind="image" size="lg" /></span></>
        : <span className="absolute inset-0 grid place-items-center"><KindBadge kind={entry.kind} size="lg" /></span>}
    <span className="absolute bottom-2.5 left-2.5 max-w-[calc(100%-20px)] truncate rounded-chip bg-panel/90 px-2 py-0.5 text-2xs font-medium text-ink-soft shadow-panel">{chip}</span>
  </span>;
}

function AssetGalleryCard({ entry, index, selected, onDetails, onPreview }: { entry: ResultEntry; index: number; selected: boolean; onDetails: () => void; onPreview: () => void }) {
  const action = resultAction(entry.task, "preview");
  const spec = assetSpec(entry.result);
  const name = entry.result.name || "未命名结果";
  const specLine = [spec.dimensions, spec.size].filter(Boolean).join(" · ");
  return <li className="relative min-w-0 stagger-in" style={{ "--i": index } as CSSProperties}>
    <article className={cx("group relative overflow-hidden rounded-card border bg-panel transition-[border-color,box-shadow] duration-150", selected ? "border-primary shadow-selected" : "border-line hover:border-line-strong hover:shadow-raised")} data-result={entry.key}>
      <button type="button" onClick={onDetails} aria-label={`选择 ${name} 资源`} aria-current={selected || undefined} className="block w-full text-left focus-visible:outline-offset-[-3px]">
        <AssetPoster entry={entry} action={action} />
        <span className="block px-3.5 pb-3 pt-3">
          <span className="block truncate text-body-sm font-semibold text-ink">{name}</span>
          <span className="mt-0.5 block truncate text-meta text-muted">{ownerLabel(entry.task.locator.owner)} · {entry.task.title}</span>
          <span className="mt-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-2xs text-faint tabular">{specLine || "规格未提供"}</span>
            <AccessState action={action} />
          </span>
        </span>
      </button>
      <div className="absolute right-2 top-2 flex items-center gap-1 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <PreviewButton entry={entry} action={action} onPreview={onPreview} variant="secondary" className="shadow-raised" />
        <DetailsButton name={name} onDetails={onDetails} variant="secondary" className="shadow-raised" />
      </div>
    </article>
  </li>;
}

function CodeText({ value }: { value: CodeLabel | null }) {
  return value ? <span title={value.unmapped || undefined}>{value.label}</span> : <Unknown />;
}

function AssetNameCell({ entry, compact }: { entry: ResultEntry; compact: boolean }) {
  const spec = assetSpec(entry.result);
  const specLine = [spec.format, spec.dimensions, spec.duration, spec.size].filter(Boolean).join(" · ") || "规格未提供";
  return <span className="flex min-w-0 items-center gap-3">
    {entry.kind === "image" ? <TaskThumbnail task={entry.task} result={entry.result} size={compact ? "sm" : "md"} /> : <KindBadge kind={entry.kind} size={compact ? "sm" : "lg"} />}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-body-sm font-semibold text-ink">{entry.result.name || "未命名结果"}</span>
      <span className="block truncate text-meta text-muted">{ownerLabel(entry.task.locator.owner)} · {entry.task.title}</span>
      {!compact && <span className="block truncate text-2xs text-faint tabular @2xl:hidden">{kindLabel(entry.kind)} · {specLine}</span>}
    </span>
  </span>;
}

function AssetTable({ compact, entries, selectedKey, onDetails, onPreview }: { compact: boolean; entries: ResultEntry[]; selectedKey: string | null; onDetails: (entry: ResultEntry) => void; onPreview: (entry: ResultEntry) => void }) {
  const detailColumns: Column<ResultEntry>[] = compact ? [] : [
    { id: "project", header: "项目", priority: 3, cell: (entry) => <span className="block min-w-0"><span className="block truncate text-body-sm text-ink-soft">{entry.task.locator.project}</span><span className="block truncate text-2xs text-faint">{entry.task.locator.task_ref}</span></span> },
    { id: "result", header: "结果状态", priority: 3, cell: (entry) => {
      const state = resultStateLabel(entry.result.state);
      return state ? <Pill size="sm" title={state.unmapped || undefined}>{state.label}</Pill> : <Unknown />;
    } },
    { id: "task", header: "任务状态", priority: 3, cell: (entry) => <span className="block min-w-0"><TaskStatePill state={entry.task.state} /><span className="mt-1 block truncate text-2xs text-faint">更新于 {formatRelative(entry.task.updated_at || entry.task.created_at)}</span></span> },
  ];
  const columns: Column<ResultEntry>[] = [
    { id: "name", header: "资源", cell: (entry) => <AssetNameCell entry={entry} compact={compact} /> },
    { id: "kind", header: "类型", priority: 2, cell: (entry) => {
      const spec = assetSpec(entry.result);
      return <span className="block min-w-0">
        <span className="block truncate text-body-sm text-ink-soft">{kindLabel(entry.kind)}{spec.format ? ` · ${spec.format}` : ""}</span>
        {!compact && <span className="block truncate text-2xs text-faint tabular">{[spec.dimensions, spec.duration, spec.size].filter(Boolean).join(" · ") || "规格未提供"}</span>}
      </span>;
    } },
    { id: "access", header: "内容权限", priority: 2, cell: (entry) => <AccessState action={resultAction(entry.task, "preview")} /> },
    ...detailColumns,
    { id: "actions", header: <span className="sr-only">操作</span>, align: "end", cell: (entry) => {
      const name = entry.result.name || "未命名结果";
      return <span className="flex items-center justify-end gap-1">
        <PreviewButton entry={entry} action={resultAction(entry.task, "preview")} onPreview={() => onPreview(entry)} iconOnly={compact} stop />
        <DetailsButton name={name} onDetails={() => onDetails(entry)} stop />
      </span>;
    } },
  ];
  return <DataTable
    label={compact ? "资源紧凑列表" : "资源详情列表"}
    columns={columns}
    rows={entries}
    rowKey={(entry) => entry.key}
    rowAttributes={(entry) => ({ "data-result": entry.key })}
    rowLabel={(entry) => `选择 ${entry.result.name || "未命名结果"} 资源`}
    selectedKey={selectedKey}
    onRowClick={onDetails}
    density={compact ? "compact" : "comfortable"}
    className="rounded-b-card"
  />;
}

function AssetInspector({ entry, preview, mode, maximized, onModeChange, onMaximize, onClose, onPrevious, onNext, hasPrevious, hasNext, onOpenTask }: { entry: ResultEntry; preview: MediaPreviewController; mode: AssetInspectorMode; maximized: boolean; onModeChange: (mode: AssetInspectorMode) => void; onMaximize: () => void; onClose: () => void; onPrevious: () => void; onNext: () => void; hasPrevious: boolean; hasNext: boolean; onOpenTask: () => void }) {
  const previewAction = resultAction(entry.task, "preview");
  const downloadAction = resultAction(entry.task, "download");
  const spec = assetSpec(entry.result);
  const specText = [spec.format, spec.dimensions, spec.duration, spec.size].filter(Boolean).join(" · ");
  const header = <div className="flex items-start gap-3"><KindBadge kind={entry.kind} size="sm" /><div className="min-w-0 flex-1"><p className="text-2xs font-medium text-muted">{ownerLabel(entry.task.locator.owner)} · {kindLabel(entry.kind)}</p><h2 className="mt-0.5 break-words text-title font-semibold text-ink">{entry.result.name || "未命名结果"}</h2><p className="mt-1 truncate text-body-sm text-muted">{entry.task.locator.project} · {entry.task.title}</p></div></div>;
  const meta = <div className="mt-3 flex min-w-0 items-center gap-2 text-2xs text-muted"><span className="min-w-0 flex-1 truncate">{entry.task.locator.task_ref}</span><span className="shrink-0 rounded-chip bg-primary-soft px-2 py-0.5 text-primary">只读观察</span></div>;
  const stepButton = "grid size-8 place-items-center rounded-control text-muted hover:bg-panel-sunken hover:text-ink disabled:opacity-35";
  return <InspectorShell
    open
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={onMaximize}
    onClose={onClose}
    label="资源"
    closeAriaLabel="关闭资源详情"
    ariaLabel="资源详情"
    dataAttribute="data-asset-inspector"
    header={header}
    headerActions={<><button type="button" disabled={!hasPrevious} onClick={onPrevious} aria-label="上一个资源" title="上一个资源" className={stepButton}><ChevronLeft className="size-4" /></button><button type="button" disabled={!hasNext} onClick={onNext} aria-label="下一个资源" title="下一个资源" className={stepButton}><ChevronRight className="size-4" /></button></>}
    meta={meta}
    sections={[{ id: "overview", label: "概览" }, { id: "source", label: "来源与版本" }, { id: "access", label: "权限与审阅" }, { id: "process", label: "生产过程" }]}
    footer={<div className="flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3 shrink-0" />预览、下载和审阅状态均以 owner 授权与回读为准。</div>}
  >
    <section id="asset-overview" data-inspector-section="overview" tabIndex={-1} className="scroll-mt-24 space-y-3"><AssetPreviewStage entry={entry} preview={preview} /><ResultViewer task={entry.task} result={entry.result} kind={entry.kind} preview={preview} showPreview={false} /><Facts columns={2} items={[{ label: "结果状态", value: <CodeText value={resultStateLabel(entry.result.state)} /> }, { label: "任务状态", value: <TaskStatePill state={entry.task.state} /> }, { label: "规格", value: specText || <Unknown />, wide: true }, { label: "更新时间", value: formatRelative(entry.task.updated_at || entry.task.created_at) }]} /></section>
    <section id="asset-source" data-inspector-section="source" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3"><h3 className="text-body-sm font-semibold text-ink">来源与版本</h3><Facts columns={2} items={[{ label: "Owner 项目", value: entry.task.locator.project }, { label: "来源任务", value: entry.task.title, wide: true }, { label: "任务引用", value: entry.task.locator.task_ref }, { label: "修订版本", value: entry.task.revision || <Unknown /> }]} /><Button size="sm" variant="ghost" onClick={onOpenTask} icon={<ArrowUpRight className="size-3.5" />}>查看来源任务</Button></section>
    <section id="asset-access" data-inspector-section="access" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3"><h3 className="text-body-sm font-semibold text-ink">权限与审阅</h3><Facts columns={2} items={[{ label: "内容读取", value: previewAction.enabled ? <Pill tone="success">可申请预览</Pill> : <Pill tone="warning">{previewAction.reason || "未授权"}</Pill> }, { label: "下载", value: downloadAction.enabled ? <Pill tone="success">可下载</Pill> : <Pill tone="neutral">{downloadAction.reason || "未提供"}</Pill> }, { label: "审阅状态", value: <CodeText value={reviewStatusLabel(entry.task.provider_recovery?.review_status)} /> }, { label: "交付状态", value: <CodeText value={exportStatusLabel(entry.task.provider_recovery?.export_status)} /> }]} /><InlineNotice tone="neutral">控制中心只读取 owner 记录，不复制、采用或改写资源。</InlineNotice></section>
    <section id="asset-process" data-inspector-section="process" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3"><h3 className="text-body-sm font-semibold text-ink">生产过程</h3><ProcessTimeline observation={entry.task.process} /></section>
  </InspectorShell>;
}

const stageBase = "asset-preview-stage grid aspect-[16/10] place-items-center rounded-card border border-line bg-panel-sunken";

function AssetPreviewStage({ entry, preview }: { entry: ResultEntry; preview: MediaPreviewController }) {
  const active = preview.target?.key === entry.key;
  const mime = preview.grant?.mime || entry.result.mime;
  const isImage = entry.kind === "image" || mime.startsWith("image/");
  const isVideo = entry.kind === "video" || mime.startsWith("video/");
  const { reportError } = preview;
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);

  useEffect(() => {
    if (!active || preview.status !== "ready" || entry.kind !== "text" || !preview.sourceUrl) {
      setText(null);
      setTextError(false);
      return;
    }
    const controller = new AbortController();
    void fetch(preview.sourceUrl, { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("text_preview_unavailable");
      return response.text();
    }).then((value) => setText(value.slice(0, 16000))).catch((error) => {
      if (!controller.signal.aborted) {
        setTextError(true);
        reportError(error instanceof Error ? error.message : "text_preview_unavailable");
      }
    });
    return () => controller.abort();
  }, [active, entry.kind, preview.sourceUrl, preview.status, reportError]);

  if (!active) return <div className={cx(stageBase, "p-6 text-center")}><div><KindBadge kind={entry.kind} size="lg" className="mx-auto" /><p className="mt-3 text-body-sm font-medium text-ink">选择“预览”后在这里查看内容</p><p className="mt-1 text-2xs text-muted">当前只展示文件级信息，不会自动读取媒体。</p></div></div>;
  if (preview.status === "requesting") return <div className={stageBase}><div className="space-y-2 text-center"><SkeletonBlock className="mx-auto h-10 w-32" /><p className="text-2xs text-muted">正在申请预览句柄</p></div></div>;
  if (preview.status === "blocked" || preview.status === "error") return <div className={cx(stageBase, "p-6 text-center")}><div><KindBadge kind={entry.kind} size="lg" className="mx-auto opacity-70" /><p className="mt-3 text-body-sm font-medium text-ink">内容暂不可预览</p><p className="mt-1 text-2xs text-muted">{preview.error ? grantErrorLabel(preview.error) : "来源未提供可用媒体句柄。"}</p><Button size="sm" variant="ghost" className="mt-3" onClick={preview.retry}>重新申请</Button></div></div>;
  if (preview.status !== "ready" || !preview.sourceUrl) return <div className={stageBase}><KindBadge kind={entry.kind} size="lg" /></div>;
  if (isImage || isVideo || entry.kind === "audio") return <InlineMediaPreview controller={preview} className="asset-preview-stage" />;
  if (entry.kind === "text") return <div className="asset-preview-stage max-h-[420px] overflow-auto rounded-card border border-line bg-panel-sunken p-4 text-meta leading-6 text-ink-soft">{textError ? <p className="text-muted">内容读取失败，仍可查看文件元数据。</p> : text === null ? <p className="text-muted">正在读取文本内容…</p> : <pre className="whitespace-pre-wrap break-words font-sans">{text}</pre>}</div>;
  return <div className={cx(stageBase, "p-6 text-center")}><KindBadge kind={entry.kind} size="lg" /></div>;
}

function AssetSkeleton({ view }: { view: AssetViewMode }) {
  if (view !== "gallery") return <div aria-hidden="true">
    <div className="flex items-center gap-4 border-b border-line bg-panel-soft px-4 py-2.5"><SkeletonBlock className="h-3 w-14" /><SkeletonBlock className="ml-auto h-3 w-20" /></div>
    <div className="divide-y divide-line">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-center gap-3 px-4 py-2.5"><SkeletonBlock className={cx("shrink-0 rounded-control", view === "compact" ? "size-10" : "size-16")} /><div className="min-w-0 flex-1 space-y-2"><SkeletonBlock className="h-3.5 w-2/5" /><SkeletonBlock className="h-3 w-1/4" /></div><SkeletonBlock className="h-8 w-20 rounded-control" /></div>)}</div>
  </div>;
  return <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4 p-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="overflow-hidden rounded-card border border-line bg-panel"><SkeletonBlock className="aspect-[16/10] rounded-none" /><div className="space-y-2 px-3.5 pb-3 pt-3"><SkeletonBlock className="h-3.5 w-3/4" /><SkeletonBlock className="h-3 w-1/2" /><SkeletonBlock className="h-3 w-2/5" /></div></div>)}</div>;
}
