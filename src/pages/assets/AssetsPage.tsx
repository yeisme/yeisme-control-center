import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
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
  EmptyState,
  Facts,
  InlineNotice,
  KindBadge,
  Panel,
  Pill,
  ReadStateView,
  SearchField,
  SegmentedTabs,
  Select,
  SkeletonBlock,
  StaleNotice,
  TaskStatePill,
  Unknown,
  cx,
  ownerLabel,
} from "../../components/ui";
import { kindLabel, type MediaKind } from "../../components/ui/Kind";
import { ResultViewer } from "../../components/ResultViewer";
import { InlineMediaPreview, useMediaPreview, type MediaPreviewController } from "../../components/media-preview";
import { collectResults, resultAction, resultMeta, type ResultEntry } from "../../shared/read-model/tasks";
import { formatRelative } from "../../shared/read-model/format";
import { ProcessTimeline } from "../../components/ProcessTimeline";
import { parseAssetInspectorMode, parseAssetViewMode, type AssetInspectorMode, type AssetViewMode } from "./asset-view";
import { InspectorShell } from "../../components/InspectorShell";

type KindFilter = "all" | MediaKind;
type AccessFilter = "all" | "available" | "locked";

const viewPreferenceKey = "yeisme.control.assets.view";
const inspectorPreferenceKey = "yeisme.control.assets.inspector-mode";

function readPreference<T>(key: string, fallback: T, parse: (value: string | null) => T) {
  if (typeof window === "undefined") return fallback;
  return parse(window.localStorage.getItem(key));
}

export default function AssetsPage() {
  const tasks = useTasks();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kind = (["image", "video", "audio", "text"].includes(params.get("kind") || "") ? params.get("kind") : "all") as KindFilter;
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
  const locked = all.filter((entry) => !resultAction(entry.task, "preview").enabled).length;
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

  return <div className={cx("page-enter space-y-5", selected && inspectorMode === "fixed" && !maximized && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="assets">
    <h1 className="sr-only">资源库</h1>
    <div className="flex flex-wrap items-center justify-end gap-2">
      {tasks.status !== "loading" && <>
        <Pill tone="neutral" icon={<Images />}>{all.length} 个结果</Pill>
        {locked > 0 && <Pill tone="warning" icon={<LockKeyhole />}>{locked} 个内容未授权</Pill>}
      </>}
    </div>
    <StaleNotice status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} onRetry={tasks.refresh} />

    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <SegmentedTabs label="类型" value={kind} onChange={(value) => update({ kind: value })} options={[
          { id: "all", label: "全部", count: counts.all },
          { id: "image", label: "图像", count: counts.image },
          { id: "video", label: "视频", count: counts.video },
          { id: "audio", label: "音频", count: counts.audio },
          { id: "text", label: "其他", count: counts.text },
        ]} />
        <Select aria-label="来源" value={owner} onChange={(event) => update({ owner: event.target.value || null })} className="w-32">
          <option value="">全部来源</option>
          {owners.map((item) => <option key={item} value={item}>{ownerLabel(item)}</option>)}
        </Select>
        <Select aria-label="内容权限" value={access} onChange={(event) => update({ access: event.target.value })} className="w-36">
          <option value="all">全部权限</option>
          <option value="available">可预览</option>
          <option value="locked">未授权</option>
        </Select>
        <div role="group" aria-label="资源视图" className="flex items-center gap-0.5 rounded-[9px] border border-line bg-panel-soft p-0.5">
          <ViewButton active={view === "gallery"} label="大图网格" icon={<LayoutGrid className="size-3.5" />} onClick={() => setView("gallery")} />
          <ViewButton active={view === "list"} label="详情列表" icon={<List className="size-3.5" />} onClick={() => setView("list")} />
          <ViewButton active={view === "compact"} label="紧凑列表" icon={<Table2 className="size-3.5" />} onClick={() => setView("compact")} />
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="文件、结果或任务名称" label="搜索资源" className="ml-auto w-full sm:w-64" />
      </div>
      <ReadStateView status={tasks.status === "empty" ? "ready" : tasks.status} error={tasks.error} onRetry={tasks.refresh} skeleton={<AssetSkeleton view={view} />}>
        {visible.length === 0 ? <EmptyState icon={<Images />} title={all.length ? "没有符合条件的资源" : "当前批次没有任务结果"} body={all.length ? "试试切换类型、权限或视图筛选。" : "结果来自 owner 任务投影；没有结果不代表生成失败。"} /> : <AssetBrowser view={view} entries={visible} selectedKey={selected?.key || null} onDetails={openDetails} onPreview={openPreview} />}
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

function ViewButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-pressed={active} aria-label={label} title={label} onClick={onClick} className={cx("inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-2xs font-medium transition-colors focus-visible:border-focus", active ? "bg-panel text-ink shadow-panel" : "text-muted hover:bg-panel hover:text-ink")}>
    {icon}<span className="hidden sm:inline">{label}</span>
  </button>;
}

function AssetBrowser({ view, entries, selectedKey, onDetails, onPreview }: { view: AssetViewMode; entries: ResultEntry[]; selectedKey: string | null; onDetails: (entry: ResultEntry) => void; onPreview: (entry: ResultEntry) => void }) {
  if (view === "list" || view === "compact") return <ul className="divide-y divide-line" aria-label={view === "list" ? "资源详情列表" : "资源紧凑列表"}>{entries.map((entry, index) => <AssetListRow key={entry.key} entry={entry} index={index} compact={view === "compact"} selected={entry.key === selectedKey} onDetails={() => onDetails(entry)} onPreview={() => onPreview(entry)} />)}</ul>;
  return <ul className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4 p-4" aria-label="资源大图网格">{entries.map((entry, index) => <AssetGalleryCard key={entry.key} entry={entry} index={index} selected={entry.key === selectedKey} onDetails={() => onDetails(entry)} onPreview={() => onPreview(entry)} />)}</ul>;
}

function AssetGalleryCard({ entry, index, selected, onDetails, onPreview }: { entry: ResultEntry; index: number; selected: boolean; onDetails: () => void; onPreview: () => void }) {
  const action = resultAction(entry.task, "preview");
  const meta = resultMeta(entry.result).slice(0, 3).join(" · ");
  return <li className="relative min-w-0 stagger-in" style={{ "--i": index } as React.CSSProperties}>
    <article className={cx("overflow-hidden rounded-[14px] border bg-panel transition-[border-color,box-shadow,transform] duration-200", selected ? "border-primary shadow-panel" : "border-line hover:-translate-y-0.5 hover:border-line-strong hover:shadow-panel")} data-result={entry.key}>
      <button type="button" onClick={onDetails} aria-label={`选择 ${entry.result.name || "未命名结果"} 资源`} className="group block w-full text-left focus-visible:border-focus">
        <AssetVisual entry={entry} large />
        <div className="space-y-1.5 p-4">
          <div className="flex items-start gap-2"><p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{entry.result.name || "未命名结果"}</p><KindBadge kind={entry.kind} size="sm" /></div>
          <p className="truncate text-2xs text-muted">{ownerLabel(entry.task.locator.owner)} · {entry.task.locator.project}</p>
          <p className="truncate text-2xs text-faint tabular">{meta || "规格未提供"}</p>
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-line bg-panel-soft px-3 py-2.5">
        <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-1 text-2xs font-medium", action.enabled ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}><span className="size-1.5 rounded-full bg-current" />{action.enabled ? "可预览" : "未授权"}</span>
        <div className="flex items-center gap-1"><Button size="sm" variant={action.enabled ? "primary" : "ghost"} disabled={!action.enabled} title={action.reason || "申请短期预览句柄"} onClick={onPreview} icon={<Eye className="size-3.5" />}>{entry.kind === "audio" ? "播放" : "预览"}</Button><button type="button" aria-label={`打开 ${entry.result.name || "未命名结果"} 详情`} title="打开详情" onClick={onDetails} className="grid size-7 place-items-center rounded-[7px] border border-line bg-panel text-muted hover:text-ink focus-visible:border-focus"><Info className="size-3.5" /></button></div>
      </div>
    </article>
  </li>;
}

function AssetListRow({ entry, index, compact, selected, onDetails, onPreview }: { entry: ResultEntry; index: number; compact: boolean; selected: boolean; onDetails: () => void; onPreview: () => void }) {
  const action = resultAction(entry.task, "preview");
  const meta = resultMeta(entry.result).join(" · ");
  return <li className={cx("relative", selected && "bg-primary-soft/40")} data-result={entry.key}>
    <div className={cx("grid items-center gap-3 px-4 text-left transition-colors hover:bg-panel-soft", compact ? "min-h-14 grid-cols-[auto_minmax(0,1fr)_auto]" : "min-h-[88px] grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-cols-[auto_minmax(0,1.6fr)_minmax(140px,1fr)_minmax(150px,1fr)_auto]")}>
      <button type="button" onClick={onDetails} aria-label={`选择 ${entry.result.name || "未命名结果"} 资源`} className="contents focus-visible:outline-none">
        {entry.kind === "image" ? <TaskThumbnail task={entry.task} result={entry.result} size={compact ? "sm" : "md"} /> : <KindBadge kind={entry.kind} size={compact ? "sm" : "md"} />}
        <span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-ink">{entry.result.name || "未命名结果"}</span><span className="mt-0.5 block truncate text-2xs text-muted">{ownerLabel(entry.task.locator.owner)} · {entry.task.title}</span>{!compact && <span className="mt-1 block truncate text-2xs text-faint tabular">{meta || "规格未提供"}</span>}</span>
        {!compact && <span className="hidden min-w-0 text-2xs text-muted lg:block"><span className="block truncate">{entry.task.locator.project}</span><span className="mt-1 block truncate text-faint">{entry.task.locator.task_ref}</span></span>}
        {!compact && <span className="hidden min-w-0 text-2xs text-muted lg:block"><span className="block"><TaskStatePill state={entry.task.state} /></span><span className="mt-1 block truncate text-faint">更新于 {formatRelative(entry.task.updated_at || entry.task.created_at)}</span></span>}
      </button>
      <div className="flex items-center justify-end gap-1"><Button size="sm" variant="ghost" disabled={!action.enabled} title={action.reason || "申请短期预览句柄"} onClick={(event) => { event.stopPropagation(); onPreview(); }} icon={<Eye className="size-3.5" />}>{compact ? "" : entry.kind === "audio" ? "播放" : "预览"}</Button><button type="button" aria-label={`打开 ${entry.result.name || "未命名结果"} 详情`} title="打开详情" onClick={onDetails} className="grid size-7 place-items-center rounded-[7px] border border-line bg-panel text-muted hover:text-ink focus-visible:border-focus"><Info className="size-3.5" /></button></div>
    </div>
    {!compact && <div className="hidden border-t border-line bg-panel-soft px-4 py-1.5 text-right text-2xs text-faint lg:block">{kindLabel(entry.kind)} · {entry.result.state || "结果状态未提供"}{!action.enabled && ` · ${action.reason || "内容读取未授权"}`}</div>}
    <span className="sr-only">第 {index + 1} 个资源</span>
  </li>;
}

function AssetVisual({ entry, large = false }: { entry: ResultEntry; large?: boolean }) {
  const preview = resultAction(entry.task, "preview");
  const tone = entry.kind === "image" ? "bg-kind-image-soft" : entry.kind === "video" ? "bg-kind-video-soft" : entry.kind === "audio" ? "bg-kind-audio-soft" : "bg-kind-text-soft";
  return <div className={cx("relative overflow-hidden", large ? "aspect-[16/10]" : "aspect-[4/3]", tone)}>
    {entry.kind === "image" && preview.enabled ? <TaskThumbnail task={entry.task} result={entry.result} size="lg" className="absolute inset-0 border-0 rounded-none" /> : <div className="grid size-full place-items-center"><KindBadge kind={entry.kind} size={large ? "lg" : "md"} /></div>}
    <span className="absolute bottom-3 left-3 rounded-full bg-panel/90 px-2 py-1 text-2xs font-medium text-ink-soft shadow-panel">{kindLabel(entry.kind)}{entry.result.duration_ms ? ` · ${Math.round(entry.result.duration_ms / 1000)}s` : ""}</span>
    {!preview.enabled && <span className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-panel/90 text-warning shadow-panel" title={preview.reason || undefined}><LockKeyhole className="size-3.5" /></span>}
  </div>;
}

function AssetInspector({ entry, preview, mode, maximized, onModeChange, onMaximize, onClose, onPrevious, onNext, hasPrevious, hasNext, onOpenTask }: { entry: ResultEntry; preview: MediaPreviewController; mode: AssetInspectorMode; maximized: boolean; onModeChange: (mode: AssetInspectorMode) => void; onMaximize: () => void; onClose: () => void; onPrevious: () => void; onNext: () => void; hasPrevious: boolean; hasNext: boolean; onOpenTask: () => void }) {
  const header = <div className="flex items-start gap-3"><KindBadge kind={entry.kind} size="sm" /><div className="min-w-0 flex-1"><p className="text-2xs font-medium text-muted">{ownerLabel(entry.task.locator.owner)} · {kindLabel(entry.kind)}</p><h2 className="mt-0.5 break-words text-[17px] font-semibold leading-snug text-ink">{entry.result.name || "未命名结果"}</h2><p className="mt-1 truncate text-[13px] text-muted">{entry.task.locator.project} · {entry.task.title}</p></div></div>;
  const meta = <div className="mt-3 flex min-w-0 items-center gap-2 text-2xs text-muted"><span className="min-w-0 flex-1 truncate">{entry.task.locator.task_ref}</span><span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-primary">只读观察</span></div>;
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
    headerActions={<><button type="button" disabled={!hasPrevious} onClick={onPrevious} aria-label="上一个资源" title="上一个资源" className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-panel-sunken hover:text-ink disabled:opacity-35"><ChevronLeft className="size-4" /></button><button type="button" disabled={!hasNext} onClick={onNext} aria-label="下一个资源" title="下一个资源" className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-panel-sunken hover:text-ink disabled:opacity-35"><ChevronRight className="size-4" /></button></>}
    meta={meta}
    sections={[{ id: "overview", label: "概览" }, { id: "source", label: "来源与版本" }, { id: "access", label: "权限与审阅" }, { id: "process", label: "生产过程" }]}
    footer={<div className="flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3 shrink-0" />预览、下载和审阅状态均以 owner 授权与回读为准。</div>}
  >
    <section id="asset-overview" data-inspector-section="overview" tabIndex={-1} className="scroll-mt-24 space-y-3"><AssetPreviewStage entry={entry} preview={preview} /><ResultViewer task={entry.task} result={entry.result} kind={entry.kind} preview={preview} showPreview={false} /><Facts columns={2} items={[{ label: "结果状态", value: entry.result.state || <Unknown /> }, { label: "任务状态", value: <TaskStatePill state={entry.task.state} /> }, { label: "规格", value: resultMeta(entry.result).join(" · ") || <Unknown />, wide: true }, { label: "更新时间", value: formatRelative(entry.task.updated_at || entry.task.created_at) }]} /></section>
    <section id="asset-source" data-inspector-section="source" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3"><h3 className="text-[13px] font-semibold text-ink">来源与版本</h3><Facts columns={2} items={[{ label: "Owner 项目", value: entry.task.locator.project }, { label: "来源任务", value: entry.task.title, wide: true }, { label: "任务引用", value: entry.task.locator.task_ref }, { label: "修订版本", value: entry.task.revision || <Unknown /> }]} /><Button size="sm" variant="ghost" onClick={onOpenTask} icon={<ArrowUpRight className="size-3.5" />}>查看来源任务</Button></section>
    <section id="asset-access" data-inspector-section="access" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3"><h3 className="text-[13px] font-semibold text-ink">权限与审阅</h3><Facts columns={2} items={[{ label: "内容读取", value: resultAction(entry.task, "preview").enabled ? <Pill tone="success">可申请预览</Pill> : <Pill tone="warning">{resultAction(entry.task, "preview").reason || "未授权"}</Pill> }, { label: "下载", value: resultAction(entry.task, "download").enabled ? <Pill tone="success">可下载</Pill> : <Pill tone="neutral">{resultAction(entry.task, "download").reason || "未提供"}</Pill> }, { label: "审阅状态", value: entry.task.provider_recovery?.review_status || <Unknown /> }, { label: "交付状态", value: entry.task.provider_recovery?.export_status || <Unknown /> }]} /><InlineNotice tone="neutral">控制中心只读取 owner 记录，不复制、采用或改写资源。</InlineNotice></section>
    <section id="asset-process" data-inspector-section="process" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3"><h3 className="text-[13px] font-semibold text-ink">生产过程</h3><ProcessTimeline observation={entry.task.process} /></section>
  </InspectorShell>;
}

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

  if (!active) return <div className="asset-preview-stage grid aspect-[16/10] place-items-center rounded-[14px] border border-line bg-panel-sunken p-6 text-center"><div><KindBadge kind={entry.kind} size="lg" className="mx-auto" /><p className="mt-3 text-[13px] font-medium text-ink">选择“预览”后在这里查看内容</p><p className="mt-1 text-2xs text-muted">当前只展示文件级信息，不会自动读取媒体。</p></div></div>;
  if (preview.status === "requesting") return <div className="asset-preview-stage grid aspect-[16/10] place-items-center rounded-[14px] border border-line bg-panel-sunken"><div className="space-y-2 text-center"><SkeletonBlock className="mx-auto h-10 w-32" /><p className="text-2xs text-muted">正在申请预览句柄</p></div></div>;
  if (preview.status === "blocked" || preview.status === "error") return <div className="asset-preview-stage grid aspect-[16/10] place-items-center rounded-[14px] border border-line bg-panel-sunken p-6 text-center"><div><KindBadge kind={entry.kind} size="lg" className="mx-auto opacity-70" /><p className="mt-3 text-[13px] font-medium text-ink">内容暂不可预览</p><p className="mt-1 text-2xs text-muted">{preview.error || "来源未提供可用媒体句柄。"}</p><Button size="sm" variant="ghost" className="mt-3" onClick={preview.retry}>重新申请</Button></div></div>;
  if (preview.status !== "ready" || !preview.sourceUrl) return <div className="asset-preview-stage grid aspect-[16/10] place-items-center rounded-[14px] border border-line bg-panel-sunken"><KindBadge kind={entry.kind} size="lg" /></div>;
  if (isImage || isVideo || entry.kind === "audio") return <InlineMediaPreview controller={preview} className="asset-preview-stage" />;
  if (entry.kind === "text") return <div className="asset-preview-stage max-h-[420px] overflow-auto rounded-[14px] border border-line bg-panel-sunken p-4 text-[12px] leading-6 text-ink-soft">{textError ? <p className="text-muted">内容读取失败，仍可查看文件元数据。</p> : text === null ? <p className="text-muted">正在读取文本内容…</p> : <pre className="whitespace-pre-wrap break-words font-sans">{text}</pre>}</div>;
  return <div className="asset-preview-stage grid aspect-[16/10] place-items-center rounded-[14px] border border-line bg-panel-sunken p-6 text-center"><KindBadge kind={entry.kind} size="lg" /></div>;
}

function AssetSkeleton({ view }: { view: AssetViewMode }) {
  if (view !== "gallery") return <div className="divide-y divide-line">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-center gap-3 px-4 py-4"><SkeletonBlock className="size-12 rounded-[9px]" /><div className="min-w-0 flex-1 space-y-2"><SkeletonBlock className="h-3 w-1/2" /><SkeletonBlock className="h-3 w-1/3" /></div></div>)}</div>;
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4 p-4">{Array.from({ length: 6 }, (_, index) => <div key={index} className="space-y-3"><SkeletonBlock className="aspect-[16/10] rounded-[14px]" /><SkeletonBlock className="h-4 w-3/4" /><SkeletonBlock className="h-3 w-1/2" /></div>)}</div>;
}
