import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Hourglass } from "../../icons";
import { Facts, MetricStrip, ToggleGroup, cx, type Metric } from "../../components/ui";
import { formatRelative, formatSpan } from "../../shared/read-model/format";
import { stationLabels, stationReason, timeCategoryLabels } from "../../shared/read-model/production";
import { dominantCategory, hasTime, timeExtent, timeSampleFloor, type TimeRollup } from "../../shared/production-time";
import type { EpisodeProductionTiming } from "../../shared/episode-production";
import type { ProductionLine, ProductionStation, ProductionStationId } from "../../shared/production-line";
import type { ProcessTimingStatus } from "../../task-observation";

/**
 * How long production took, drawn from the owners' own timing records only. Every figure says how many of the tasks it
 * looked at carried timing; nothing is inferred from created or updated times, and a range with no timing says so.
 */

type Segment = keyof typeof timeCategoryLabels;
const segmentOrder: Segment[] = ["active", "queue", "blocked", "human_wait", "unsplit"];

const timingStatusLabels: Record<ProcessTimingStatus, string> = {
  created: "已受理", queued: "排队中", running: "执行中", stalled: "停滞", paused: "已暂停", blocked: "受阻", waiting_for_human: "等人确认",
  reconciling: "回查中", completed: "已完成", failed: "失败", timed_out: "超时", cancelled: "已取消", expired: "已过期",
};

const noTimingText = "工具还没有提供计时；这里不从创建/更新时间推断耗时。";

function segmentValues(rollup: TimeRollup): Record<Segment, number> {
  return { active: rollup.active_ms, queue: rollup.queue_ms, blocked: rollup.blocked_ms, human_wait: rollup.human_wait_ms, unsplit: rollup.unsplit_ms };
}

const span = (ms: number | null | undefined) => formatSpan(ms) ?? "未提供";

/** The whole bar in words, for `aria-label` and the table view. */
export function timeSummary(rollup: TimeRollup): string {
  if (!hasTime(rollup)) return `没有计时（${rollup.total} 个任务都没带计时）`;
  const values = segmentValues(rollup);
  const parts = segmentOrder.filter((id) => values[id] > 0).map((id) => `${timeCategoryLabels[id]} ${span(values[id])}`);
  return `累计 ${span(rollup.wall_ms)}${parts.length ? `：${parts.join("，")}` : ""}；${rollup.timed}/${rollup.total} 个任务带计时${rollup.overlap ? "；各类有重叠" : ""}`;
}

const coverageText = (rollup: TimeRollup) => `${rollup.timed}/${rollup.total} 带计时`;

/**
 * Ticks while something is running: at most once a second, never while the tab is hidden. When the tab comes back the
 * caller's `onReturn` refetches, so the number never runs on from a stale read.
 */
export function useTicking(active: boolean, onReturn?: () => void) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const start = () => { if (timer === undefined && !document.hidden) timer = window.setInterval(() => setNow(Date.now()), 1000); };
    const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
    const change = () => {
      if (document.hidden) { stop(); return; }
      setNow(Date.now());
      onReturn?.();
      start();
    };
    start();
    document.addEventListener("visibilitychange", change);
    return () => { stop(); document.removeEventListener("visibilitychange", change); };
  }, [active, onReturn]);
  return now;
}

/** A total that grows by one second per second for each run still going, counted from the instant the rollup was made for. */
export function liveWall(rollup: TimeRollup, now: number): number | null {
  if (!hasTime(rollup)) return null;
  const since = Math.max(0, now - Date.parse(rollup.as_of));
  return rollup.wall_ms + (Number.isFinite(since) ? since * rollup.ticking : 0);
}

export function LiveElapsed({ rollup, onReturn, className }: { rollup: TimeRollup; onReturn?: () => void; className?: string }) {
  const now = useTicking(rollup.ticking > 0, onReturn);
  const value = liveWall(rollup, now);
  return <span className={cx("tabular", className)} data-time-live={rollup.ticking > 0 ? "" : undefined}>{value === null ? "未提供" : span(value)}</span>;
}

/** One stacked bar. `scale` is the longest bar it is compared with, so rows sharing a scale can be compared by length. */
export function TimeSegmentBar({ rollup, scale, label, index = 0, thin = false, className }: { rollup: TimeRollup; scale: number; label: string; index?: number; thin?: boolean; className?: string }) {
  const values = segmentValues(rollup);
  const extent = timeExtent(rollup);
  const width = scale > 0 ? Math.max(extent > 0 ? 1.5 : 0, (extent / scale) * 100) : 0;
  return <div role="img" aria-label={`${label}：${timeSummary(rollup)}`} className={cx("overflow-hidden rounded-full bg-panel-sunken", thin ? "h-1.5" : "h-2.5", className)}>
    {width > 0 && <div className="time-bar-fill flex h-full overflow-hidden rounded-full" style={{ width: `${Math.min(100, width)}%`, "--i": index } as CSSProperties}>
      {segmentOrder.filter((id) => values[id] > 0).map((id) => <span key={id} className="time-seg" data-cat={id} style={{ flex: `${values[id]} 1 0` }} />)}
    </div>}
  </div>;
}

/** The categories in words with their values; colour and texture are only a second channel. */
export function TimeLegend({ rollup, className }: { rollup: TimeRollup; className?: string }) {
  const values = segmentValues(rollup);
  return <ul aria-label="耗时分类" className={cx("flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted", className)}>
    {segmentOrder.filter((id) => id !== "unsplit" || values.unsplit > 0).map((id) => <li key={id} className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="time-seg size-2.5 rounded-[3px]" data-cat={id} />
      {timeCategoryLabels[id]}<span className="tabular text-ink-soft">{span(values[id])}</span>
    </li>)}
  </ul>;
}

/** Where most of the time went, in words. */
export function dominantText(rollup: TimeRollup): string {
  const top = dominantCategory(rollup);
  if (!top) return rollup.unsplit_ms > 0 ? "工具没有细分耗在哪" : "";
  return `主要耗在${timeCategoryLabels[top]}`;
}

function sampleNote(timed: number) {
  return timed < timeSampleFloor ? `观察样本 ${timed}，仅供参考` : `观察样本 ${timed}`;
}

function attentionText(rollup: TimeRollup): string[] {
  const out: string[] = [];
  if (rollup.running) out.push(`${rollup.running} 个在跑`);
  if (rollup.waiting_human) out.push(`${rollup.waiting_human} 个等人确认 · ${span(rollup.human_wait_ms)}`);
  if (rollup.stalled) out.push(`${rollup.stalled} 个停滞`);
  return out;
}

/** The studio hero's one line: the time so far, or that it is not connected. */
export function TimeHeroLine({ line, className }: { line: ProductionLine; className?: string }) {
  const total = line.time?.total;
  if (!total) return null;
  if (!hasTime(total)) return <p className={cx("flex items-center gap-1.5 text-2xs", className)} data-time-hero="none"><Hourglass className="size-3.5" />耗时待接通</p>;
  const extra = attentionText(total);
  return <p className={cx("flex flex-wrap items-center gap-x-1.5 text-2xs", className)} data-time-hero="">
    <Hourglass className="size-3.5" />已计时 <LiveElapsed rollup={total} className="font-medium" />
    {extra.length > 0 && <span>· {extra.join(" · ")}</span>}
  </p>;
}

/** A station card's 6px bar and its figure; a station without timed tasks says why in words. */
export function StationTimeLine({ station, scale }: { station: ProductionStation; scale: number }) {
  const time = station.time;
  if (!time) return null;
  if (time.state === "needs_contract") return <p className="text-2xs text-faint" data-station-time="needs_contract">耗时：{stationReason(time.reason)}</p>;
  if (!hasTime(time.rollup)) return time.rollup.total ? <p className="text-2xs text-faint" data-station-time="none">耗时：{time.rollup.total} 个任务都没带计时</p> : null;
  return <div className="space-y-1" data-station-time="">
    <TimeSegmentBar rollup={time.rollup} scale={scale} label={`${stationLabels[station.station].label}耗时`} thin />
    <p className="tabular text-2xs text-muted"><span className="font-medium text-ink-soft">{span(time.rollup.wall_ms)}</span> · {coverageText(time.rollup)}{time.rollup.stalled ? ` · ${time.rollup.stalled} 个停滞` : ""}</p>
  </div>;
}

/** The longest bar among a line's stations, so every station bar on a page shares one scale. */
export function stationScale(line: ProductionLine) {
  return Math.max(0, ...line.stations.map((station) => station.time?.state === "observed" ? timeExtent(station.time.rollup) : 0));
}

/** The station inspector's 耗时 section. */
export function StationTimeSection({ station, onOpenTask }: { station: ProductionStation; onOpenTask?: (taskKey: string) => void }) {
  const time = station.time;
  if (!time) return <p className="text-body-sm text-muted">任务来源读不到，所以也读不到耗时。</p>;
  if (time.state === "needs_contract") return <p className="text-body-sm text-muted">{stationReason(time.reason)}。</p>;
  const rollup = time.rollup;
  if (!hasTime(rollup)) return <p className="text-body-sm text-muted">{rollup.total ? `这一站的 ${rollup.total} 个任务都没带计时。` : "这一站还没有任务。"}{noTimingText}</p>;
  return <div className="space-y-3" data-station-time-section="">
    <TimeSegmentBar rollup={rollup} scale={timeExtent(rollup)} label={`${stationLabels[station.station].label}耗时`} />
    <TimeLegend rollup={rollup} />
    <Facts columns={3} items={[
      { label: "累计", value: span(rollup.wall_ms) },
      { label: "带计时", value: `${rollup.timed}/${rollup.total}` },
      { label: "重试", value: `${rollup.retries} 次` },
      { label: "在跑", value: `${rollup.running}` },
      { label: "停滞", value: `${rollup.stalled}` },
      { label: "最早开始", value: rollup.first_started_at ? formatRelative(rollup.first_started_at) : "未提供" },
    ]} />
    {rollup.overlap && <p className="text-2xs text-muted">工具的分类有重叠（例如执行中也在等待），各类加起来会超过累计。</p>}
    {time.slowest.length > 0 && <div>
      <p className="mb-1.5 text-2xs font-medium text-muted">最慢的任务</p>
      <ol className="divide-y divide-line overflow-hidden rounded-[10px] border border-line" aria-label="最慢的任务">
        {time.slowest.map((run) => {
          const body = <>
            <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{run.title || run.task_key}</span>
            <span className={cx("shrink-0 text-2xs", run.status === "stalled" || run.status === "blocked" ? "text-warning" : "text-muted")}>{timingStatusLabels[run.status]}</span>
            <span className="tabular w-24 shrink-0 text-right text-body-sm font-medium text-ink">{span(run.wall_ms)}</span>
          </>;
          return <li key={run.task_key}>
            {onOpenTask
              ? <button type="button" onClick={() => onOpenTask(run.task_key)} className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-panel-soft focus-visible:bg-panel-soft focus-visible:outline-none">{body}</button>
              : <div className="flex items-center gap-3 px-3 py-2">{body}</div>}
          </li>;
        })}
      </ol>
    </div>}
    <p className="text-2xs text-faint">{sampleNote(rollup.timed)}。只算已读到的任务，按工具自己的计时。</p>
  </div>;
}

function ViewToggle({ view, onChange }: { view: "bars" | "table"; onChange: (view: "bars" | "table") => void }) {
  return <ToggleGroup label="耗时视图" value={view} onChange={onChange} options={[{ id: "bars", label: "图" }, { id: "table", label: "表" }]} />;
}

interface TimeRow { id: string; label: ReactNode; text: string; rollup: TimeRollup; note?: string; onOpen?: () => void }

function TimeRows({ rows, view, caption }: { rows: TimeRow[]; view: "bars" | "table"; caption: string }) {
  const scale = Math.max(0, ...rows.map((row) => timeExtent(row.rollup)));
  if (view === "table") return <div className="overflow-x-auto">
    <table aria-label={caption} className="w-full text-body-sm">
      <thead><tr className="text-left text-2xs text-muted">
        <th scope="col" className="py-1.5 pr-3 font-medium">项</th>
        <th scope="col" className="px-2 py-1.5 text-right font-medium">累计</th>
        {(["active", "queue", "blocked", "human_wait", "unsplit"] as const).map((id) => <th key={id} scope="col" className="px-2 py-1.5 text-right font-medium">{timeCategoryLabels[id]}</th>)}
        <th scope="col" className="py-1.5 pl-2 text-right font-medium">带计时</th>
      </tr></thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => {
          const values = segmentValues(row.rollup);
          const has = hasTime(row.rollup);
          return <tr key={row.id}>
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink">{row.text}</th>
            <td className="tabular px-2 py-1.5 text-right">{has ? span(row.rollup.wall_ms) : row.note || "未提供"}</td>
            {(["active", "queue", "blocked", "human_wait", "unsplit"] as const).map((id) => <td key={id} className="tabular px-2 py-1.5 text-right text-ink-soft">{has ? span(values[id]) : "—"}</td>)}
            <td className="tabular py-1.5 pl-2 text-right text-muted">{row.rollup.total ? `${row.rollup.timed}/${row.rollup.total}` : "—"}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
  return <ol aria-label={caption} className="space-y-2.5">
    {rows.map((row, index) => {
      const has = hasTime(row.rollup);
      const head = <span className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-body-sm text-ink">{row.label}</span>
        <span className="tabular shrink-0 text-2xs text-muted">
          {has ? <><span className="text-body-sm font-medium text-ink">{span(row.rollup.wall_ms)}</span>{row.rollup.total ? ` · ${coverageText(row.rollup)}` : ""}</> : row.note || (row.rollup.total ? `${row.rollup.total} 个任务都没带计时` : "没有计时")}
        </span>
      </span>;
      const bar = has ? <TimeSegmentBar rollup={row.rollup} scale={scale} label={row.text} index={index} /> : <div aria-hidden="true" className="h-2.5 rounded-full border border-dashed border-line" />;
      return <li key={row.id} data-time-row={row.id}>
        {row.onOpen
          ? <button type="button" onClick={row.onOpen} className="group block w-full space-y-1.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-panel-soft focus-visible:bg-panel-soft focus-visible:outline-none">{head}{bar}</button>
          : <div className="space-y-1.5 px-2 py-1.5">{head}{bar}</div>}
      </li>;
    })}
  </ol>;
}

function ownerTotalText(owner: NonNullable<ProductionLine["time"]>["owner_total"]): { value: string; note: string; observed?: EpisodeProductionTiming } {
  if (!owner) return { value: "待接通", note: "Scaena 按集计时汇总" };
  if (owner.state !== "observed") return { value: owner.state === "unavailable" ? "暂时读不到" : "待接通", note: owner.state === "unavailable" ? stationReason(owner.reason) : "Scaena 按集计时汇总" };
  const timing = owner.timing;
  if (timing.state !== "observed") return { value: "待接通", note: stationReason(timing.reason) || "Scaena 按集计时汇总" };
  if (!timing.timed_run_count) return { value: "没有记录", note: timing.run_count ? `Scaena 的 ${timing.run_count} 项派发都没带计时` : "Scaena 没有这一集的计时记录" };
  return { value: span(timing.wall_duration_ms), note: `Scaena 汇总 · ${timing.timed_run_count}/${timing.run_count} 项派发带计时${timing.truncated ? " · 未数全" : ""}`, observed: timing };
}

/** The studio's 耗时 band: the episode's figures, one bar per station on a shared scale, and what is not counted. */
export function TimeBand({ line, onOpenStation, onReturn }: { line: ProductionLine; onOpenStation?: (id: ProductionStationId) => void; onReturn?: () => void }) {
  const [view, setView] = useState<"bars" | "table">("bars");
  const time = line.time;
  if (!time) return null;
  const total = time.total;
  const owner = ownerTotalText(time.owner_total);
  const metrics: Metric[] = hasTime(total) ? [
    { label: "累计（已读任务范围内）", value: <LiveElapsed rollup={total} onReturn={onReturn} />, hint: coverageText(total) },
    { label: "执行", value: span(total.active_ms) },
    { label: "排队", value: span(total.queue_ms) },
    { label: "受阻", value: span(total.blocked_ms), ...(total.blocked_ms ? { tone: "warning" as const } : {}) },
    { label: "等人", value: span(total.human_wait_ms), ...(total.waiting_human ? { tone: "review" as const, hint: `${total.waiting_human} 个在等` } : {}) },
    { label: "重试", value: `${total.retries} 次` },
  ] : [];
  // Stations with timed tasks get a bar; the rest are named in one line by why they have none, not drawn as empty rows.
  const rows: TimeRow[] = line.stations.flatMap((station) => {
    if (station.time?.state !== "observed" || !hasTime(station.time.rollup)) return [];
    const label = stationLabels[station.station].label;
    return [{ id: station.station, label, text: label, rollup: station.time.rollup, ...(onOpenStation ? { onOpen: () => onOpenStation(station.station) } : {}) }];
  });
  const untimed = new Map<string, string[]>();
  for (const station of line.stations) {
    if (station.time?.state === "observed" && hasTime(station.time.rollup)) continue;
    const why = !station.time ? "任务来源读不到" : station.time.state === "needs_contract" ? "待接通" : station.time.rollup.total ? "任务没带计时" : "还没有任务";
    untimed.set(why, [...(untimed.get(why) || []), stationLabels[station.station].label]);
  }
  return <section aria-labelledby="studio-time" className="space-y-4 rounded-card border border-line/80 bg-panel p-5 shadow-panel" data-time-band="">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-2xs font-medium tracking-[0.12em] text-muted">耗时</p>
        <h2 id="studio-time" className="mt-1 font-display text-[20px] font-semibold text-ink">这一集花了多久</h2>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-right text-2xs text-muted" data-owner-total={owner.observed ? "observed" : "missing"}>
          整集合计 <span className={cx("font-medium", owner.observed ? "text-ink" : "text-review")}>{owner.value}</span><span className="block">{owner.note}</span>
        </p>
        {hasTime(total) && <ViewToggle view={view} onChange={setView} />}
      </div>
    </div>
    {!hasTime(total)
      ? <p className="rounded-[10px] border border-dashed border-line px-4 py-3 text-body-sm text-muted" data-time-empty="">{total.total ? `已读到的 ${total.total} 个任务都没带计时。` : "这一集还没有读到任务。"}{noTimingText}</p>
      : <>
        <MetricStrip label="这一集的耗时" items={metrics} />
        {attentionText(total).length > 0 && <p className="text-2xs text-muted">{attentionText(total).join(" · ")}</p>}
        <TimeRows rows={rows} view={view} caption="各站耗时" />
        {untimed.size > 0 && <p className="text-2xs text-muted" data-time-untimed="">{[...untimed].map(([why, names]) => `${names.join("、")}：${why}`).join("；")}</p>}
        <TimeLegend rollup={total} />
        <p className="text-2xs text-faint">{sampleNote(total.timed)}。按各工具自己的计时相加，只算这一页已读到的任务；故事、设定和分镜站还没有计时，没有算进来。{total.overlap ? "工具的分类有重叠，各类加起来会超过累计。" : ""}{owner.observed && !owner.observed.splits_recorded ? "Scaena 汇总还没有记录受阻和等人的时间。" : ""}</p>
      </>}
  </section>;
}

/** A project's time: the total, each episode (slowest first, linking into its studio), tasks naming no episode, and the slowest stations. */
export function ProductionTimePanel({ line, onOpenEpisode, limit = 8 }: { line: ProductionLine; onOpenEpisode?: (episodeRef: string) => void; limit?: number }) {
  const [view, setView] = useState<"bars" | "table">("bars");
  const time = line.time;
  if (!time) return null;
  const total = time.total;
  const episodes = (time.episodes || []).filter((row) => hasTime(row.time));
  const rows: TimeRow[] = episodes.slice(0, limit).map((row) => {
    const text = row.title || row.episode_ref;
    const ref = row.drama_episode_ref;
    return {
      id: row.episode_ref,
      label: <span className="inline-flex items-center gap-1.5">{text}{ref && onOpenEpisode && <ArrowRight aria-hidden="true" className="size-3.5 text-faint transition-transform duration-150 group-hover:translate-x-0.5" />}</span>,
      text,
      rollup: row.time,
      ...(ref && onOpenEpisode ? { onOpen: () => onOpenEpisode(ref) } : {}),
    };
  });
  if (time.unattributed && time.unattributed.total) rows.push({ id: "unattributed", label: <span className="text-muted">未标注剧集</span>, text: "未标注剧集", rollup: time.unattributed });
  const stations = line.stations
    .flatMap((station) => station.time?.state === "observed" && hasTime(station.time.rollup) ? [{ station, rollup: station.time.rollup }] : [])
    .sort((a, b) => (b.rollup.wall_ms ?? 0) - (a.rollup.wall_ms ?? 0)).slice(0, 3);
  return <section aria-labelledby="project-time" className="space-y-4 rounded-card border border-line/80 bg-panel p-5 shadow-panel" data-time-panel="">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-2xs font-medium tracking-[0.12em] text-muted">耗时</p>
        <h2 id="project-time" className="mt-1 font-display text-[20px] font-semibold text-ink">
          做到现在花了 {hasTime(total) ? <LiveElapsed rollup={total} /> : <span className="text-review">待接通</span>}
        </h2>
        {hasTime(total) && <p className="mt-0.5 text-2xs text-muted">已读任务范围内 · {coverageText(total)}{attentionText(total).length ? ` · ${attentionText(total).join(" · ")}` : ""}</p>}
      </div>
      {hasTime(total) && <ViewToggle view={view} onChange={setView} />}
    </div>
    {!hasTime(total)
      ? <p className="rounded-[10px] border border-dashed border-line px-4 py-3 text-body-sm text-muted" data-time-empty="">{noTimingText}</p>
      : <>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
          <div className="min-w-0">
            <p className="mb-1.5 text-2xs font-medium text-muted">各集</p>
            {rows.length ? <TimeRows rows={rows} view={view} caption="各集耗时" /> : <p className="text-body-sm text-muted">带计时的任务都没有标注属于哪一集。</p>}
            {episodes.length > limit && <p className="mt-1.5 text-2xs text-faint">还有 {episodes.length - limit} 集没有列出。</p>}
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-2xs font-medium text-muted">最慢的站</p>
            <ol className="space-y-2" aria-label="最慢的站">
              {stations.map(({ station, rollup }, index) => <li key={station.station} className="rounded-[10px] border border-line px-3 py-2">
                <p className="flex items-baseline justify-between gap-2"><span className="text-body-sm text-ink">{index + 1}. {stationLabels[station.station].label}</span><span className="tabular text-body-sm font-medium text-ink">{span(rollup.wall_ms)}</span></p>
                <p className="text-2xs text-muted">{dominantText(rollup) || coverageText(rollup)}</p>
              </li>)}
            </ol>
          </div>
        </div>
        <TimeLegend rollup={total} />
        <p className="text-2xs text-faint">{sampleNote(total.timed)}。按各工具自己的计时相加，只算已读到的任务页；整部剧的完整合计要等 Scaena 按集计时汇总接通。只有 Scaena 任务会标注属于哪一集。</p>
      </>}
  </section>;
}
