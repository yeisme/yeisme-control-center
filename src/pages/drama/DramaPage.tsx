import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clapperboard, Clock3, RefreshCw } from "../../icons";
import { useTasks } from "../../app/tasks-context";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { FilterBar } from "../../components/FilterBar";
import { Button, CoverageChip, EmptyState, InlineNotice, MetricStrip, NoticeStack, PageToolbar, Panel, Pill, ReadStateView, SkeletonRows, StaleNotice, cx } from "../../components/ui";
import { api, errorCode, isRouteUnavailable } from "../../shared/api/control-center-client";
import type { DramaEpisodeRow, DramaEpisodesResponse } from "../../shared/drama";
import { formatRelative } from "../../shared/read-model/format";
import { blockerLabel, currentStage, dramaMetrics, mergeEpisodeEntries, nextStepText, summarizeTasks, taskEpisodeRefs, tasksForEpisode, type EpisodeEntry } from "../../shared/read-model/drama";
import { EpisodeInspector } from "./EpisodeInspector";
import { StageRail } from "./StageRail";

const modeKey = "yeisme.control.tasks.inspector-mode";
const originLabel = { collection: "收集库", task: "任务", manual: "手动" } as const;
const pageSize = 12;
type ListRead = DramaEpisodesResponse | { route_unavailable: true };

function TaskCell({ entry, tasks }: { entry: EpisodeEntry; tasks: ReturnType<typeof useTasks>["rows"] }) {
  const refs = [entry.episode_ref, entry.row?.flow?.scaena_episode_ref || ""];
  const summary = summarizeTasks(tasksForEpisode(tasks, refs));
  if (!summary.total) return <span className="text-2xs text-faint">无关联任务</span>;
  return <span className="flex flex-wrap items-center gap-1" title="任务状态只表示机器执行，不代表审阅或采用">
    <span className="text-2xs text-muted">{summary.total} 个任务</span>
    {summary.active > 0 && <Pill size="sm" tone="info">{summary.active} 进行中</Pill>}
    {summary.review > 0 && <Pill size="sm" tone="review">{summary.review} 待审阅</Pill>}
    {summary.problem > 0 && <Pill size="sm" tone="warning">{summary.problem} 需回查</Pill>}
  </span>;
}

function RailCell({ entry }: { entry: EpisodeEntry }) {
  const row = entry.row;
  // `failed` means every source was unreadable, so the rail would be five "unavailable" nodes with nothing to tell.
  if (row?.read === "failed") return <Pill size="sm" tone="warning" title={row.read_reason}>读取失败 · {row.read_reason ? blockerLabel(row.read_reason) : "来源不可用"}</Pill>;
  if (row?.flow) return <StageRail rail={row.flow.rail} current={currentStage(row.flow)} />;
  return <span className="text-2xs text-faint">{row ? "尚未读取实时状态" : "打开详情读取"}</span>;
}

function EpisodeRowItem({ entry, selected, tasks, onSelect }: { entry: EpisodeEntry; selected: boolean; tasks: ReturnType<typeof useTasks>["rows"]; onSelect: () => void }) {
  const flow = entry.row?.flow;
  const next = flow ? nextStepText(flow.rail, flow.next_attention) : null;
  // A list inside a button is invalid markup and hides the rail from assistive tech, so only the title is the button.
  // Pointer users can still click anywhere on the row; keyboard users get the same action from the title button.
  return <li
    data-episode={entry.episode_ref}
    data-read={entry.row?.read || "none"}
    onClick={(event) => { if ((event.target as HTMLElement).closest("button")) return; (event.currentTarget.querySelector("button[data-episode-open]") as HTMLElement | null)?.focus(); onSelect(); }}
    className={cx("cursor-pointer border-line hover:bg-panel-soft", selected && "bg-primary-soft/40")}
  >
    <div className="grid gap-x-4 gap-y-2 px-5 py-3.5 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3.2fr)_minmax(0,2fr)]">
      <span className="min-w-0">
        <button type="button" data-episode-open aria-pressed={selected} onClick={onSelect} className="block max-w-full truncate rounded-[6px] text-left text-body-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-focus">{entry.title}</button>
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
    </div>
  </li>;
}

export default function DramaPage() {
  const navigate = useNavigate();
  const { scopeId, scope } = useWorkspace();
  const tasks = useTasks();
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") || "").trim();
  const selected = params.get("episode");
  const scaenaOverride = params.get("scaena_episode") || undefined;
  const [readAllFor, setReadAllFor] = useState("");
  const [more, setMore] = useState<{ rows: DramaEpisodeRow[]; cursor?: string; state: "idle" | "loading" | "error" }>({ rows: [], state: "idle" });
  const [mode, setMode] = useState<"fixed" | "floating">(() => typeof window !== "undefined" && window.localStorage.getItem(modeKey) === "floating" ? "floating" : "fixed");
  const [maximized, setMaximized] = useState(false);

  const readAll = readAllFor === `${scopeId}|${q}`;
  const taskRefs = useMemo(() => taskEpisodeRefs(tasks.rows), [tasks.rows]);
  const readKey = `${q}|${readAll}|${taskRefs.join(",")}`;
  const query = useCallback((cursor?: string) => ({ q, limit: pageSize, read: readAll ? "all" as const : undefined, episode_ref: taskRefs, ...(cursor ? { cursor } : {}) }), [q, readAll, taskRefs]);
  const list = useScopedRead<ListRead>(async (id, signal) => {
    try { return await api.dramaEpisodes(id, query(), signal); } catch (error) {
      if (isRouteUnavailable(error)) return { route_unavailable: true };
      throw error;
    }
  // Wait for the task lanes to settle once: their episode refs are part of the read, and re-reading when they arrive would flash the list.
  }, { key: readKey, enabled: tasks.status !== "loading" });
  const routeMissing = !!list.data && "route_unavailable" in list.data;
  const data = list.data && !routeMissing ? list.data as DramaEpisodesResponse : null;
  const identity = useRef("");
  identity.current = `${scopeId}|${readKey}`;

  useEffect(() => { setMore({ rows: [], cursor: data?.next_cursor, state: "idle" }); }, [data]);

  const loadMore = async () => {
    if (!more.cursor) return;
    const requested = identity.current;
    setMore((value) => ({ ...value, state: "loading" }));
    try {
      const page = await api.dramaEpisodes(scopeId, query(more.cursor));
      if (identity.current !== requested) return;
      setMore((value) => ({ rows: [...value.rows, ...page.rows], cursor: page.next_cursor, state: "idle" }));
    } catch (error) {
      if (identity.current !== requested) return;
      // The cursor is signed and short-lived; once it expires the only honest recovery is a fresh first page.
      if (["cursor_expired", "cursor_invalid"].includes(errorCode(error))) list.reload();
      else setMore((value) => ({ ...value, state: "error" }));
    }
  };

  const entries = useMemo(() => mergeEpisodeEntries([...(data?.rows || []), ...more.rows], taskRefs, selected), [data?.rows, more.rows, taskRefs, selected]);
  const metrics = useMemo(() => dramaMetrics(entries), [entries]);
  const unread = (data?.row_count ?? 0) - (data?.read_count ?? 0);
  const select = (ref: string | null) => {
    const next = new URLSearchParams(params);
    if (ref) next.set("episode", ref); else next.delete("episode");
    next.delete("scaena_episode");
    setParams(next);
  };
  const setScaenaOverride = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("scaena_episode", value); else next.delete("scaena_episode");
    setParams(next, { replace: true });
  };
  const changeMode = (value: "fixed" | "floating") => { setMode(value); window.localStorage.setItem(modeKey, value); };
  const selectedEntry = entries.find((entry) => entry.episode_ref === selected) || null;

  const universe = data?.universe;
  return <div className={cx("page-enter @container space-y-5", selected && mode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="drama">
    <h1 className="sr-only">剧集制作</h1>
    <PageToolbar
      summary="按集查看剧本、导演计划、创意分镜、制作交接和制作拆解走到哪一步。这里只读展示 owner 返回的状态；编辑与审阅在 Auctra、Scaena 或 MuWeave 中完成。"
      actions={<Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={list.reload}>刷新</Button>}
      metrics={list.status !== "loading" && data && <MetricStrip label="剧集概况" items={[
        { label: "剧集", value: data.total, hint: universe?.total ? `收集库 ${universe.total}` : undefined },
        { label: "待审阅", value: metrics.review, tone: metrics.review ? "review" : "neutral" },
        { label: "受阻/过期", value: metrics.blocked, tone: metrics.blocked ? "warning" : "neutral" },
        { label: "可交接", value: metrics.handoff, tone: metrics.handoff ? "success" : "neutral" },
        { label: "已拆解", value: metrics.broken_down },
      ]} />}
      meta={<span className="inline-flex flex-wrap items-center gap-2 text-2xs text-muted">
        {data?.universe && <CoverageChip owner="auctra" state={data.universe.coverage} reason={data.universe.reason} />}
        {list.observedAt && <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />读取于 {formatRelative(list.observedAt)}</span>}
      </span>}
    />
    <NoticeStack notices={[
      routeMissing && <InlineNotice key="route" tone="warning">当前控制中心服务端版本还没有提供剧集制作接口，所以这里不能列出剧集。更新并重启服务端后即可使用；前端不会用演示数据补齐。</InlineNotice>,
      list.status === "stale" && <StaleNotice key="stale" status={list.status} error={list.error} observedAt={list.observedAt} onRetry={list.reload} />,
      universe && !universe.bound && <InlineNotice key="unbound" tone="info">当前范围没有连接 Auctra 收集库，列不出全部剧集。仍会显示任务里带有剧集引用的集；也可以用地址栏 <code>?episode=</code> 直接查看某一集。</InlineNotice>,
      universe?.bound && universe.reason === "collection_not_synced" && <InlineNotice key="unsynced" tone="warning">Auctra 收集库还没有同步，所以没有剧集列表。到「服务与连接」同步后再回来。<Button size="sm" variant="ghost" className="ml-2" onClick={() => navigate("/services")}>前往同步</Button></InlineNotice>,
      universe?.bound && universe.coverage === "expired" && <InlineNotice key="expired" tone="warning">收集快照已超过 5 分钟没有同步，列表可能缺少最新的剧集。</InlineNotice>,
      data && unread > 0 && <InlineNotice key="unread" tone="info">已读取 {data.read_count}/{data.row_count} 集的实时状态，其余未读取以控制对 owner 的请求量。<Button size="sm" variant="ghost" className="ml-2" onClick={() => setReadAllFor(`${scopeId}|${q}`)}>读取本页其余</Button></InlineNotice>,
    ]} />
    <FilterBar placeholder="搜索剧集标题或引用" />
    <Panel title="剧集" actions={<span className="text-meta text-muted">阶段链覆盖到制作拆解；生成、审阅与交付等待 owner 合同，不在此推断</span>} bodyClassName="p-0">
      <ReadStateView status={list.status} error={list.error} onRetry={list.reload} skeleton={<SkeletonRows rows={6} />}>
        {routeMissing
          ? <EmptyState icon={<Clapperboard />} title="服务端版本过旧" body="剧集制作接口不存在。这是版本问题，不代表没有剧集。" />
          : entries.length === 0
          ? <EmptyState icon={<Clapperboard />} title={q ? "没有匹配的剧集" : universe?.bound ? "还没有剧集" : "没有可列出的剧集"} body={q ? "换一个关键词，或清除搜索。" : universe?.bound ? "Auctra 收集库里没有剧本类单元。同步收集或在 Auctra 中创建剧本后会出现在这里。" : "该范围没有连接剧集来源；任务带有剧集引用后会出现在这里。"} />
          : <ul className="divide-y divide-line" aria-label="剧集列表">
            {entries.map((entry) => <EpisodeRowItem key={entry.episode_ref} entry={entry} selected={entry.episode_ref === selected} tasks={tasks.rows} onSelect={() => select(entry.episode_ref)} />)}
          </ul>}
        {more.cursor && <div className="flex items-center justify-center gap-3 border-t border-line px-5 py-3">
          <Button size="sm" onClick={() => void loadMore()} disabled={more.state === "loading"}>{more.state === "loading" ? "加载中…" : "显示更多剧集"}</Button>
          {more.state === "error" && <span className="text-2xs text-warning">加载失败，请重试</span>}
        </div>}
      </ReadStateView>
    </Panel>
    {selected && <EpisodeInspector
      key={`${scopeId}|${selected}`}
      episode={selected}
      title={selectedEntry?.title || selected}
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
    />}
  </div>;
}
