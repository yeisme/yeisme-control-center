import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInspectorMode } from "../../app/preferences";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useOverlayParams } from "../../app/overlay-history";
import { usePagedRows } from "../../app/use-paged-rows";
import { ArrowRight, Clapperboard, Clock3, Copy, ListTodo, PanelRightOpen, Plug, RefreshCw, Workflow } from "../../icons";
import { linkActions, useCopy } from "../../app/item-actions";
import { useRecentItems, useRememberRecent } from "../../app/recent";
import { useTasks } from "../../app/tasks-context";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { FilterBar } from "../../components/FilterBar";
import { ActionsContextMenu, Button, CoverageChip, EmptyState, InlineNotice, MetricStrip, NoticeAction, NoticeStack, PageToolbar, Pager, Panel, Pill, ReadStateView, SkeletonRows, StaleNotice, cx, useToast, type ItemAction } from "../../components/ui";
import { api, errorCode, isRouteUnavailable } from "../../shared/api/control-center-client";
import { unconnectedReasons, validDramaRef, type DramaEpisodeRow, type DramaEpisodesResponse } from "../../shared/drama";
import { formatRelative } from "../../shared/read-model/format";
import { blockerLabel, collectionSyncMessage, currentStage, dramaMetrics, mergeEpisodeEntries, nextStepText, recentEpisodeKey, recentEpisodes, requestedEpisodeRefs, sourceText, summarizeTasks, taskEpisodeRefs, tasksForEpisode, universeGapText, type EpisodeEntry } from "../../shared/read-model/drama";
import { EpisodeInspector } from "./EpisodeInspector";
import { StageRail } from "./StageRail";
import { EpisodeStudio } from "./EpisodeStudio";
import { ProductionLineView } from "./ProductionLine";
import { LiveElapsed, ProductionTimePanel } from "./ProductionTime";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { HandoffSheet } from "../../components/HandoffSheet";
import { buildProductionLine, taskSourceAnswered, type ProductionStationId } from "../../shared/production-line";
import { buildAgentBrief, type AgentBrief } from "../../shared/agent-brief";
import { pickCover } from "../home/today-model";

const episodeOverlays = ["episode"] as const;
const originLabel = { collection: "收集库", task: "任务", recent: "最近打开", manual: "手动" } as const;
const pageSize = 12;
type ListRead = DramaEpisodesResponse | { route_unavailable: true };

function TaskCell({ entry, tasks }: { entry: EpisodeEntry; tasks: ReturnType<typeof useTasks>["rows"] }) {
  const refs = [entry.episode_ref, entry.row?.flow?.scaena_episode_ref || ""];
  const matched = tasksForEpisode(tasks, refs);
  const summary = summarizeTasks(matched);
  if (!summary.total) return <span className="text-2xs text-faint">还没有画面、动态或声音任务</span>;
  const made = (owner: string) => matched.filter((task) => task.locator.owner === owner).length;
  return <span className="flex flex-wrap items-center gap-1" title="任务状态只表示机器执行，不代表审阅或采用">
    <span className="text-2xs text-muted">制作：画面 {made("eikona")} · 动态 {made("scaena")} · 声音 {made("sonora")}</span>
    {summary.active > 0 && <Pill size="sm" tone="info">{summary.active} 进行中</Pill>}
    {summary.review > 0 && <Pill size="sm" tone="review">{summary.review} 待审阅</Pill>}
    {summary.problem > 0 && <Pill size="sm" tone="warning">{summary.problem} 需回查</Pill>}
  </span>;
}

function UnconnectedChip({ owner, reason }: { owner: string; reason: string }) {
  return <Pill tone="neutral" icon={<Plug />} title={reason}><span className="font-semibold">{owner}</span><span className="font-normal"> · 未连接</span></Pill>;
}

function RailCell({ entry }: { entry: EpisodeEntry }) {
  const row = entry.row;
  // `failed` means every source was unreadable, so the rail would be five "unavailable" nodes with nothing to tell.
  // When nobody connected the owners that is configuration still to do, not a read that went wrong.
  if (row?.read === "failed" && row.read_reason && (row.read_reason === "sources_not_connected" || unconnectedReasons.has(row.read_reason))) return <Pill size="sm" tone="neutral" title={blockerLabel(row.read_reason)}>未连接来源</Pill>;
  if (row?.read === "failed") return <Pill size="sm" tone="warning" title={row.read_reason}>读取失败 · {row.read_reason ? blockerLabel(row.read_reason) : "来源不可用"}</Pill>;
  if (row?.flow) return <StageRail rail={row.flow.rail} current={currentStage(row.flow)} />;
  return <span className="text-2xs text-faint">{row ? "尚未读取实时状态" : "打开详情读取"}</span>;
}

function EpisodeRowItem({ entry, selected, tasks, onSelect, onStudio, actions }: { entry: EpisodeEntry; selected: boolean; tasks: ReturnType<typeof useTasks>["rows"]; onSelect: () => void; onStudio: () => void; actions: ItemAction[] }) {
  const flow = entry.row?.flow;
  const cover = pickCover(tasks, [entry.episode_ref, flow?.scaena_episode_ref || ""]);
  const next = flow ? nextStepText(flow.rail, flow.next_attention) : null;
  // A list inside a button is invalid markup and hides the rail from assistive tech, so only the title is the button.
  // Pointer users can still click anywhere on the row; keyboard users get the same action from the title button.
  return <ActionsContextMenu actions={actions}><li
    data-episode={entry.episode_ref}
    data-read={entry.row?.read || "none"}
    onClick={(event) => { if ((event.target as HTMLElement).closest("button")) return; (event.currentTarget.querySelector("button[data-episode-open]") as HTMLElement | null)?.focus(); onSelect(); }}
    className={cx("cursor-pointer rounded-tile border bg-panel shadow-card transition-colors hover:border-line-strong", selected ? "border-primary/50 bg-primary-soft/30" : "border-line")}
  >
    <div className="grid items-center gap-x-5 gap-y-3 p-4 @3xl:grid-cols-[132px_minmax(0,1.5fr)_minmax(0,3fr)_minmax(0,2fr)_auto]">
      <span aria-hidden="true" className="relative hidden aspect-[16/10] overflow-hidden rounded-[14px] border border-line bg-panel-sunken @3xl:block">
        {cover ? <TaskThumbnail task={cover.task} result={cover.result} frameless alt="" fallback={<span className="cover-type size-full" />} /> : <span className="cover-type block size-full" />}
        <span className="absolute bottom-1.5 left-2 font-mono text-[10px] tracking-wider text-white/80">{entry.episode_ref.slice(0, 14)}</span>
      </span>
      <span className="min-w-0">
        <button type="button" data-episode-open aria-pressed={selected} onClick={onSelect} className="block max-w-full truncate rounded-[6px] text-left font-display text-[17px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus">{entry.title}</button>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-muted">
          <span className="truncate font-mono">{entry.episode_ref}</span>
          <Pill size="sm" tone="neutral">{originLabel[entry.origin]}</Pill>
        </span>
      </span>
      <span className="min-w-0 self-center"><RailCell entry={entry} /></span>
      <span className="min-w-0 space-y-1 self-center">
        {next ? <span className={cx("block text-body-sm", next.tone === "neutral" ? "text-muted" : "text-ink")}>{next.text}</span> : <span className="block text-body-sm text-faint">—</span>}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <TaskCell entry={entry} tasks={tasks} />
          {flow && <span className="inline-flex items-center gap-1 text-2xs text-muted"><Clock3 className="size-3" />{formatRelative(flow.observed_at)}</span>}
        </span>
      </span>
      <Button size="sm" variant={selected ? "primary" : "secondary"} icon={<Workflow className="size-3.5" />} onClick={onStudio} className="justify-self-start">进入制作线</Button>
    </div>
  </li></ActionsContextMenu>;
}

export default function DramaPage() {
  const [params] = useSearchParams();
  const { session, scopeId, setScope } = useWorkspace();
  const requested = params.get("sharedProject");
  const permitted = !!requested && session?.scopes.some((scope) => scope.id === requested && requested.startsWith("project_"));
  useEffect(() => { if (permitted && requested !== scopeId) setScope(requested!); }, [permitted, requested, scopeId, setScope]);
  if (requested && !permitted) return <div data-page="drama" data-shared-project-denied="true"><h1 className="sr-only">剧集</h1><InlineNotice tone="warning">无法访问链接指定的共享项目；未读取其他范围的数据。</InlineNotice></div>;
  if (requested && scopeId !== requested) return <div data-page="drama"><h1 className="sr-only">剧集</h1><p className="p-4 text-muted">正在恢复共享项目上下文…</p></div>;
  return <DramaWorkspace key={scopeId} />;
}

function DramaWorkspace() {
  const navigate = useNavigate();
  const notify = useToast();
  const copy = useCopy();
  const { scopeId, scope, session, isAdmin } = useWorkspace();
  const tasks = useTasks();
  const recent = useRecentItems();
  const [params, setParams] = useSearchParams();
  const [, writeOverlay] = useOverlayParams(episodeOverlays);
  const q = (params.get("q") || "").trim();
  const selected = params.get("episode");
  const studioParam = params.get("studio");
  const studio = studioParam && validDramaRef(studioParam) ? studioParam : null;
  const scaenaOverride = params.get("scaena_episode") || undefined;
  const [brief, setBrief] = useState<AgentBrief | null>(null);
  const [readAllFor, setReadAllFor] = useState("");
  const [more, setMore] = useState<{ rows: DramaEpisodeRow[]; cursor?: string; state: "idle" | "loading" | "error" }>({ rows: [], state: "idle" });
  const [mode, setMode] = useInspectorMode();
  const [maximized, setMaximized] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const readAll = readAllFor === `${scopeId}|${q}`;
  const taskRefs = useMemo(() => taskEpisodeRefs(tasks.rows), [tasks.rows]);
  // The recent list lags one commit behind a scope switch; until it catches up it still belongs to the previous scope.
  const recentReady = recent.scope === scopeId;
  const opened = useMemo(() => recentReady ? recentEpisodes(recent.items) : [], [recentReady, recent.items]);
  // Asked of the server once per scope: re-reading the list every time an episode is opened would flash it.
  const [askedRecent, setAskedRecent] = useState<{ scope: string; refs: string[] }>({ scope: "", refs: [] });
  if (recentReady && askedRecent.scope !== scopeId) setAskedRecent({ scope: scopeId, refs: opened.map((item) => item.episode_ref) });
  const asked = askedRecent.scope === scopeId;
  const requested = useMemo(() => requestedEpisodeRefs(taskRefs.refs, asked ? askedRecent.refs.map((ref) => ({ episode_ref: ref, title: ref })) : []), [taskRefs.refs, asked, askedRecent.refs]);
  const readKey = `${q}|${readAll}|${requested.join(",")}`;
  const query = useCallback((cursor?: string) => ({ q, limit: pageSize, read: readAll ? "all" as const : undefined, episode_ref: requested, ...(cursor ? { cursor } : {}) }), [q, readAll, requested]);
  const list = useScopedRead<ListRead>(async (id, signal) => {
    try { return await api.dramaEpisodes(id, query(), signal); } catch (error) {
      if (isRouteUnavailable(error)) return { route_unavailable: true };
      throw error;
    }
  // Wait for the task lanes to settle once: their episode refs are part of the read, and re-reading when they arrive would flash the list.
  }, { key: readKey, enabled: tasks.status !== "loading" && asked && !studio });
  const routeMissing = !!list.data && "route_unavailable" in list.data;
  const data = list.data && !routeMissing ? list.data as DramaEpisodesResponse : null;
  const identity = useRef("");
  identity.current = `${scopeId}|${readKey}`;

  useEffect(() => { setMore({ rows: [], cursor: data?.next_cursor, state: "idle" }); }, [data]);

  const loadMore = async () => {
    if (!more.cursor) return;
    const asking = identity.current;
    setMore((value) => ({ ...value, state: "loading" }));
    try {
      const page = await api.dramaEpisodes(scopeId, query(more.cursor));
      if (identity.current !== asking) return;
      setMore((value) => ({ rows: [...value.rows, ...page.rows], cursor: page.next_cursor, state: "idle" }));
    } catch (error) {
      if (identity.current !== asking) return;
      // The cursor is signed and short-lived; once it expires the only honest recovery is a fresh first page.
      if (["cursor_expired", "cursor_invalid"].includes(errorCode(error))) list.reload();
      else setMore((value) => ({ ...value, state: "error" }));
    }
  };

  /** Explicit, audited, and a read of Auctra plus a write to the local index only; the receipt says what it stored. */
  const syncCollection = async () => {
    if (!session?.csrf || syncing) return;
    const asking = identity.current;
    setSyncing(true);
    try {
      const receipt = await api.syncAuctraCollection(scopeId, {}, session.csrf);
      const { message, tone } = collectionSyncMessage(receipt);
      notify(message, tone);
      if (identity.current === asking) list.reload();
    } catch (error) {
      notify(`同步没有完成：${blockerLabel(errorCode(error))}。列表保持上次同步的结果。`, "warning");
    } finally {
      setSyncing(false);
    }
  };

  // The episode just opened by ref reads as "opened by ref" while it is open; ones opened on an earlier visit stay "recent".
  const recentRows = useMemo(() => opened.filter((item) => item.episode_ref !== selected || askedRecent.refs.includes(item.episode_ref)), [opened, selected, askedRecent.refs]);
  const entries = useMemo(() => mergeEpisodeEntries([...(data?.rows || []), ...more.rows], { task: taskRefs.refs, recent: recentRows, manual: selected, q }), [data?.rows, more.rows, taskRefs.refs, recentRows, selected, q]);
  // Episode cards are tall: a page holds 12, and the source's next batch arrives through the pager's 「读取更多剧集」.
  const paged = usePagedRows(entries, pageSize, episodeOverlays, { focusIndex: selected ? entries.findIndex((entry) => entry.episode_ref === selected) : undefined });
  const metrics = useMemo(() => dramaMetrics(entries), [entries]);
  // Rows only this page knows about (opened during this visit, or typed in); the server's total already counts requested refs.
  const localOnly = entries.filter((entry) => !entry.row && !requested.includes(entry.episode_ref)).length;
  const unread = (data?.row_count ?? 0) - (data?.read_count ?? 0);
  const select = (ref: string | null) => {
    const next = new URLSearchParams(params);
    if (ref) next.set("episode", ref); else next.delete("episode");
    next.delete("scaena_episode");
    next.delete("section");
    writeOverlay(next);
  };
  const setScaenaOverride = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("scaena_episode", value); else next.delete("scaena_episode");
    setParams(next, { replace: true });
  };
  const changeMode = setMode;
  const selectedEntry = entries.find((entry) => entry.episode_ref === selected) || null;
  const selectedTitle = selectedEntry?.title || selected || "";
  useRememberRecent(selected && validDramaRef(selected) ? { key: recentEpisodeKey(selected), kind: "episode", label: selectedTitle, meta: selectedTitle === selected ? "剧集" : `${selected} · 剧集`, target: `/drama?${new URLSearchParams({ episode: selected })}` } : null);
  // A ref typed into the search opens directly, so a scope without a full episode list never needs the address bar.
  const openable = q && validDramaRef(q) && !entries.some((entry) => entry.episode_ref === q) ? q : "";

  const universe = data?.universe;
  const unconnected = data?.sources?.filter((source) => source.state !== "connected") || [];
  const tasksReadable = taskSourceAnswered(tasks);
  // The whole project as one line: every task in scope, and every episode already read, so it works before any episode is bound.
  const projectLine = useMemo(() => buildProductionLine({
    scope: scopeId,
    now: list.observedAt || new Date().toISOString(),
    range: { kind: "project", ...(scope?.project ? { project_ref: scope.project } : {}), title: scope?.label || "这个项目" },
    episodes: [...(data?.rows || []), ...more.rows],
    sources: data?.sources,
    episodesReadable: !(list.status === "unavailable" || list.status === "forbidden" || list.status === "unknown") || !!data,
    tasks: tasks.rows,
    tasksReadable,
    ...(tasksReadable || !tasks.error ? {} : { tasksReason: tasks.error }),
    connections: tasks.connections,
  }), [data, list.observedAt, list.status, more.rows, scope?.label, scope?.project, scopeId, tasks.connections, tasks.error, tasks.rows, tasksReadable]);
  const openStudio = (ref: string | null) => {
    const next = new URLSearchParams(params);
    if (ref) next.set("studio", ref); else next.delete("studio");
    next.delete("episode");
    setParams(next);
  };
  const handOffProject = (station: ProductionStationId) => setBrief(buildAgentBrief({ kind: "station", line: projectLine, station, returnTo: "#/drama" }));
  const gap = universe && !universe.bound ? universeGapText(universe.reason) : "";
  const sources = taskRefs.total > taskRefs.refs.length ? `最近任务里提到的 ${taskRefs.refs.length} 集（共 ${taskRefs.total} 集）` : "任务里提到的集";
  const inspector = selected && <EpisodeInspector
    key={`${scopeId}|${selected}`}
    episode={selected}
    title={selectedTitle}
    origin={selectedEntry?.origin || "manual"}
    scaenaOverride={scaenaOverride}
    onScaenaOverride={setScaenaOverride}
    scopeLabel={scope?.label || ""}
    tasks={tasks.rows}
    mode={mode}
    maximized={maximized}
    onModeChange={changeMode}
    onMaximize={() => setMaximized((value) => !value)}
    onClose={() => { setMaximized(false); select(null); }}
    onNavigate={navigate}
    onStudio={() => openStudio(selected)}
    initialSection={params.get("section")}
  />;
  if (studio) {
    return <div className={cx("page-enter @container", selected && mode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="drama">
      <h1 className="sr-only">剧集制作</h1>
      <EpisodeStudio
        key={`${scopeId}|${studio}`}
        episode={studio}
        title={entries.find((entry) => entry.episode_ref === studio)?.title || (recentRows.find((item) => item.episode_ref === studio)?.title ?? studio)}
        scaenaOverride={scaenaOverride}
        onBack={() => openStudio(null)}
        onNavigate={navigate}
      />
      {inspector}
    </div>;
  }
  return <div className={cx("page-enter @container space-y-6", selected && mode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="drama">
    <h1 className="sr-only">剧集制作</h1>
    <PageToolbar
      foldMetrics
      lead="一集漫剧从故事到成片走七站。这里看每一集走到哪、下一步谁来做。"
      summary="剧本、导演计划和分镜来自 Auctra 与 Scaena，画面、动态、声音和拉片来自各自的工具。这里只读、决定和交接；编辑与审阅在各个工具里完成。"
      actions={<Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={list.reload}>刷新</Button>}
      metrics={list.status !== "loading" && data && <MetricStrip label="剧集概况" items={[
        { label: "剧集", value: data.total + localOnly, hint: universe?.total ? `收集库 ${universe.total}` : undefined },
        { label: "待审阅", value: metrics.review, tone: metrics.review ? "review" : "neutral" },
        { label: "受阻/过期", value: metrics.blocked, tone: metrics.blocked ? "warning" : "neutral" },
        { label: "可交接", value: metrics.handoff, tone: metrics.handoff ? "success" : "neutral" },
        { label: "已拆解", value: metrics.broken_down },
        ...(projectLine.time ? [{ label: "已计时", value: projectLine.time.total.wall_ms === null ? <span className="text-review">待接通</span> : <LiveElapsed rollup={projectLine.time.total} />, hint: projectLine.time.total.wall_ms === null ? undefined : "已读任务范围内" }] : []),
      ]} />}
      meta={<span className="inline-flex flex-wrap items-center gap-2 text-2xs text-muted">
        {/* "Not connected" is configuration still to do; the generic coverage words would read as a missing owner contract. */}
        {universe && (universe.bound ? <CoverageChip owner="auctra" state={universe.coverage} reason={universe.reason ? blockerLabel(universe.reason) : undefined} /> : <UnconnectedChip owner="Auctra" reason={gap} />)}
        {/* The breakdown stage comes from Scaena; a Scaena task connection alone does not let the board read it. */}
        {unconnected.filter((source) => source.owner === "scaena").map((source) => <UnconnectedChip key="scaena" owner="Scaena 拆解" reason={sourceText(source)} />)}
        {list.observedAt && <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />读取于 {formatRelative(list.observedAt)}</span>}
      </span>}
    />
    <NoticeStack notices={[
      routeMissing && <InlineNotice key="route" tone="warning">当前控制中心服务端版本还没有提供剧集制作接口，所以这里不能列出剧集。更新并重启服务端后即可使用；前端不会用演示数据补齐。</InlineNotice>,
      list.status === "stale" && <StaleNotice key="stale" status={list.status} error={list.error} observedAt={list.observedAt} onRetry={list.reload} />,
      universe && !universe.bound && <InlineNotice key="unbound" tone="info" actions={isAdmin ? <NoticeAction onClick={() => navigate("/services?focus=auctra")}>查看连接方法</NoticeAction> : undefined}>列不出全部剧集：{gap}。现在只列出{sources}和你最近打开过的集；在搜索框输入剧集引用可以直接打开其他集。{!isAdmin && "连接 Auctra 需要管理员操作。"}</InlineNotice>,
      universe?.bound && universe.coverage === "unknown" && <InlineNotice key="unsynced" tone="warning" actions={universe.can_sync !== false ? <NoticeAction onClick={() => void syncCollection()}>{syncing ? "同步中…" : "立即同步"}</NoticeAction> : isAdmin ? <NoticeAction onClick={() => navigate("/services?focus=auctra")}>查看连接方法</NoticeAction> : undefined}>{universe.can_sync !== false ? "Auctra 收集库还没有同步，所以还没有剧集列表。" : `还不能同步 Auctra 收集库：${universeGapText(universe.reason)}。`}</InlineNotice>,
      universe?.bound && universe.coverage === "expired" && <InlineNotice key="expired" tone="warning" actions={universe.can_sync !== false ? <NoticeAction onClick={() => void syncCollection()}>{syncing ? "同步中…" : "立即同步"}</NoticeAction> : undefined}>收集快照已超过 5 分钟没有同步，列表可能缺少最新的剧集。</InlineNotice>,
      universe?.bound && universe.coverage === "partial" && <InlineNotice key="partial" tone="warning" actions={universe.can_sync !== false ? <NoticeAction onClick={() => void syncCollection()}>{syncing ? "同步中…" : "再同步一次"}</NoticeAction> : undefined}>上次同步没有读完 Auctra 的全部记录，列表可能缺少一些剧集。</InlineNotice>,
      data && unread > 0 && <InlineNotice key="unread" tone="info" actions={<NoticeAction onClick={() => setReadAllFor(`${scopeId}|${q}`)}>读取本页其余</NoticeAction>}>已读取 {data.read_count}/{data.row_count} 集的实时状态，其余未读取以控制对 owner 的请求量。</InlineNotice>,
    ]} />
    <section aria-labelledby="project-line" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-2xs font-medium tracking-[0.12em] text-muted">项目制作线</p>
          <h2 id="project-line" className="mt-1 font-display text-[22px] font-semibold text-ink">{projectLine.range.title} · 整体走到哪了</h2>
        </div>
        <p className="max-w-md text-2xs text-muted">包括所有任务，也包括没有标注属于哪一集的。进入某一集看它自己的制作线和镜头板。</p>
      </div>
      <ProductionLineView line={projectLine} tasks={tasks.rows} compact onHandOff={handOffProject} onOpenResult={(key) => navigate(`/assets?result=${encodeURIComponent(key)}`)} onNavigate={navigate} />
      <ProductionTimePanel line={projectLine} onOpenEpisode={openStudio} />
    </section>
    <FilterBar placeholder="搜索标题，或输入剧集引用直接打开" />
    <Panel title="剧集" actions={<span className="text-meta text-muted">点标题快速查看，「进入制作线」看这一集的七站与镜头板</span>} bodyClassName="p-3">
      <ReadStateView status={list.status} error={list.error} onRetry={list.reload} skeleton={<SkeletonRows rows={6} />}>
        {routeMissing
          ? <EmptyState icon={<Clapperboard />} title="服务端版本过旧" body="剧集制作接口不存在。这是版本问题，不代表没有剧集。" />
          : entries.length === 0
          ? <EmptyState
            icon={<Clapperboard />}
            title={q ? "没有匹配的剧集" : universe?.bound ? "还没有剧集" : "没有可列出的剧集"}
            body={q ? (openable ? "列表里没有这个引用，可以直接按引用打开这一集。" : "换一个关键词，或清除搜索。") : universe?.bound ? "Auctra 收集库里没有剧本类单元。同步收集或在 Auctra 中创建剧本后会出现在这里。" : "任务里提到的剧集、在搜索框按引用打开过的剧集，会出现在这里。"}
            action={openable ? <Button size="sm" icon={<ArrowRight className="size-3.5" />} onClick={() => select(openable)}>打开「{openable}」</Button> : undefined}
          />
          : <ul className="space-y-3" aria-label="剧集列表">
            {paged.rows.map((entry) => <EpisodeRowItem key={entry.episode_ref} entry={entry} selected={entry.episode_ref === selected} tasks={tasks.rows} onSelect={() => select(entry.episode_ref)} onStudio={() => openStudio(entry.episode_ref)} actions={[
              { id: "studio", label: "进入制作线", icon: <Workflow />, group: "open", run: () => openStudio(entry.episode_ref) },
              { id: "open", label: "打开详情", icon: <PanelRightOpen />, group: "open", run: () => select(entry.episode_ref) },
              { id: "tasks", label: "查看相关任务", icon: <ListTodo />, group: "open", run: () => navigate(`/tasks?q=${encodeURIComponent(entry.episode_ref)}`) },
              ...linkActions(`/drama?episode=${encodeURIComponent(entry.episode_ref)}`, copy),
              { id: "copy-ref", label: "复制集引用", icon: <Copy />, group: "link", run: () => void copy(entry.episode_ref, "集引用") },
            ]} />)}
          </ul>}
        {openable && entries.length > 0 && <div className="border-t border-line px-5 py-3">
          <Button size="sm" variant="ghost" icon={<ArrowRight className="size-3.5" />} onClick={() => select(openable)}>按引用打开「{openable}」</Button>
        </div>}
        {entries.length > 0 && <Pager
          className="-mx-3 -mb-3 mt-3"
          window={paged}
          onPage={paged.setPage}
          noun="集"
          more={more.cursor ? { label: more.state === "error" ? "读取失败，再试一次" : "读取更多剧集", loading: more.state === "loading", onMore: loadMore } : null}
        />}
      </ReadStateView>
    </Panel>
    {inspector}
    <HandoffSheet brief={brief} open={!!brief} onOpenChange={(open) => { if (!open) setBrief(null); }} />
  </div>;
}
