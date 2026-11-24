import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, Bot, Check, CircleAlert, CircleDashed, CircleSlash, LoaderCircle, PanelRightOpen, Plug, ShieldQuestion } from "../../icons";
import { Button, KindBadge, Pill, cx, type Tone } from "../../components/ui";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { OwnerLinkRow } from "../../components/OwnerLinkRow";
import type { ProductionLine, ProductionStation, ProductionStationId, StationState } from "../../shared/production-line";
import { decisionText, factText, gapLabels, linkedByLabels, nextText, ownerReviewText, stationLabels, stationReason, stationStateInfo, stationSummary, toolNames } from "../../shared/read-model/production";
import type { TaskSnapshot } from "../../task-observation";
import type { WorkQueueLink } from "../../shared/work-queue";
import { StationTimeLine, stationScale } from "./ProductionTime";

const stateIcons: Record<StationState, ReactNode> = {
  observed: <Check />,
  partial: <CircleAlert />,
  empty: <CircleDashed />,
  unconnected: <Plug />,
  needs_contract: <Plug />,
  unavailable: <CircleSlash />,
};

/** Where each station's results live elsewhere in Studio. */
export const stationRoutes: Partial<Record<ProductionStationId, string>> = {
  frames: "/assets?kind=image&owner=eikona",
  motion: "/assets?kind=video&owner=scaena",
  sound: "/assets?kind=audio&owner=sonora",
  cut: "/tasks?owner=anatomia",
};

export function StationStatePill({ station }: { station: Pick<ProductionStation, "state" | "next" | "counts"> }) {
  const info = stationStateInfo[station.state];
  const busy = station.counts.running > 0;
  return <Pill size="sm" tone={info.tone as Tone} icon={busy ? <LoaderCircle className="motion-safe:animate-spin [animation-duration:2.4s]" /> : stateIcons[station.state]}>{busy ? `${station.counts.running} 个在跑` : info.label}</Pill>;
}

/** ← and → move along the rail's buttons, Home and End go to either end; one of them is the rail's single tab stop. */
function moveAlongRail(event: KeyboardEvent<HTMLOListElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-station-pick]")];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
  if (next < 0 || next >= buttons.length) return;
  event.preventDefault();
  buttons[next]!.focus();
}

/**
 * Seven segments in pipeline order; the one a person should look at first carries the warm marker. Given `onPick`, each
 * segment is a button that opens its station; the open one is marked.
 */
export function StationRail({ line, className, onPick, open }: { line: ProductionLine; className?: string; onPick?: (station: ProductionStationId) => void; open?: ProductionStationId | null }) {
  const focusable = open ?? line.current ?? line.stations[0]?.station;
  return <ol aria-label="制作线" className={cx("grid grid-cols-7 gap-1.5", className)} onKeyDown={onPick ? moveAlongRail : undefined}>
    {line.stations.map((station, index) => {
      const info = stationStateInfo[station.state];
      const filled = station.state === "observed" || station.state === "partial";
      const current = line.current === station.station;
      const segment = <>
        <span aria-hidden="true" className={cx("block h-1.5 rounded-full transition-transform duration-150", current ? "bg-warm" : filled ? "bg-primary" : station.state === "empty" ? "bg-line-strong" : "bg-line", onPick && "group-hover:scale-y-[1.6]")} />
        <span className={cx("mt-1.5 block truncate text-2xs font-medium", current || open === station.station ? "text-ink" : "text-muted")}>
          <span className="tabular text-faint">{String(index + 1).padStart(2, "0")} </span>{stationLabels[station.station].label}
        </span>
        <span className="sr-only">：{info.label}{current ? "，现在先看这一站" : ""}</span>
      </>;
      return <li key={station.station} data-station={station.station} data-state={station.state} aria-current={current ? "step" : undefined} className="min-w-0">
        {onPick
          ? <button type="button" data-station-pick={station.station} tabIndex={station.station === focusable ? 0 : -1} aria-pressed={open === station.station} onClick={() => onPick(station.station)} className={cx("group block w-full rounded-[8px] px-0.5 pb-1 pt-1.5 text-left transition-colors hover:bg-panel-sunken focus-visible:outline-2 focus-visible:outline-focus", open === station.station && "bg-panel-sunken")}>{segment}</button>
          : segment}
      </li>;
    })}
  </ol>;
}

export function StationCard({ station, index, current, tasks, links, onHandOff, onOpenResult, onNavigate, onOpen, compact = false, timeScale = 0 }: {
  station: ProductionStation;
  /** The longest station time on the line, so every card's bar is drawn to one scale. */
  timeScale?: number;
  index: number;
  current: boolean;
  tasks: Map<string, TaskSnapshot>;
  links?: WorkQueueLink[];
  onHandOff: () => void;
  onOpenResult: (key: string) => void;
  onNavigate: (to: string) => void;
  /** Opens the station in the right-hand panel. */
  onOpen?: () => void;
  compact?: boolean;
}) {
  const label = stationLabels[station.station];
  const reason = station.state === "observed" ? "" : stationReason(station.reason);
  const route = stationRoutes[station.station];
  return <article id={`station-card-${station.station}`} data-station={station.station} data-state={station.state} aria-labelledby={`station-${station.station}`} className={cx("station-card relative flex min-w-0 scroll-mt-24 flex-col gap-3 rounded-tile border bg-panel p-5 shadow-card", current ? "border-warm/60" : "border-line")}>
    <header className="flex items-start gap-3">
      <span aria-hidden="true" className={cx("grid size-9 shrink-0 place-items-center rounded-full font-display text-[15px] font-semibold tabular", current ? "bg-warm-soft text-warm" : "bg-panel-sunken text-ink-soft")}>{index + 1}</span>
      <span className="min-w-0 flex-1">
        <h3 id={`station-${station.station}`} className="font-display text-[19px] font-semibold leading-tight text-ink">{label.label}</h3>
        <span className="mt-0.5 block truncate text-2xs text-muted">{label.detail} · {station.tools.map((tool) => toolNames[tool]).join(" / ")}</span>
      </span>
      <StationStatePill station={station} />
      {onOpen && <button type="button" onClick={onOpen} aria-label={`打开「${label.label}」这一站的详情`} title="打开这一站的详情" className="-mr-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-panel-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"><PanelRightOpen className="size-4" /></button>}
    </header>
    <p className="text-body-sm text-ink-soft">{stationSummary(station)}</p>
    <StationTimeLine station={station} scale={timeScale} />
    {reason && station.state !== "needs_contract" && station.state !== "unconnected" && station.state !== "unavailable" && <p className="text-2xs text-muted">{reason}</p>}
    {!compact && station.results.length > 0 && <ul aria-label={`${label.label}的结果`} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
      {station.results.map((result) => {
        const task = tasks.get(result.task_key);
        const artifact = task?.results.find((item) => item.ref === result.artifact_ref);
        return <li key={`${result.task_key}:${result.artifact_ref}`} className="shrink-0">
          <button type="button" aria-label={`预览 ${result.title}`} data-viewer-origin={`${result.task_key}:${result.artifact_ref}`} onClick={() => onOpenResult(`${result.task_key}:${result.artifact_ref}`)} className="block size-16 overflow-hidden rounded-[12px] border border-line bg-panel-sunken transition-transform hover:-translate-y-px">
            {task && artifact ? <TaskThumbnail task={task} result={artifact} frameless alt="" fallback={<span className="grid size-full place-items-center"><KindBadge kind={result.kind} size="sm" /></span>} /> : <span className="grid size-full place-items-center"><KindBadge kind={result.kind} size="sm" /></span>}
          </button>
        </li>;
      })}
    </ul>}
    {station.decisions.length > 0 && <ul aria-label={`${label.label}等你决定的事`} className="space-y-1.5">
      {station.decisions.map((decision) => {
        const text = decisionText(decision);
        return <li key={`${decision.kind}:${decision.ref}`} data-decision={decision.kind} className="flex min-w-0 items-baseline gap-2 text-body-sm">
          <span className={cx("shrink-0 text-2xs font-semibold", text.tone === "danger" ? "text-danger" : text.tone === "warning" ? "text-warning" : "text-review")}>{text.verb}</span>
          <span className="min-w-0 truncate text-ink">{text.title}</span>
        </li>;
      })}
    </ul>}
    {station.facts && station.facts.length > 0 && <ul aria-label={`Scaena 记录的${label.label}情况`} data-station-facts="" className="space-y-1 text-2xs text-ink-soft">{station.facts.map((fact) => <li key={fact.part} data-fact={fact.part}>{factText(fact)}</li>)}</ul>}
    {station.linked_by && <p data-linked-by={station.linked_by} className="text-2xs text-muted">{linkedByLabels[station.linked_by]}</p>}
    {station.owner_review && <p data-owner-review="" className="text-2xs text-ink-soft">{ownerReviewText(station.owner_review)}</p>}
    {station.gaps.length > 0 && <p className="flex items-start gap-1.5 rounded-[12px] bg-review-soft/60 px-3 py-2 text-2xs text-ink-soft"><Plug aria-hidden="true" className="mt-px size-3.5 shrink-0 text-review" /><span>待接通：{station.gaps.map((gap) => gapLabels[gap.part]).join("、")}。工具开放接口之前，这里不推断它们的状态。</span></p>}
    {!compact && links && links.length > 0 && <details className="group rounded-[12px] border border-line">
      <summary className="cursor-pointer select-none px-3 py-2 text-2xs font-medium text-ink-soft hover:text-ink">在工具里打开（{links.length}）</summary>
      <div className="space-y-2 border-t border-line p-2">{links.map((link) => <OwnerLinkRow key={`${link.target}:${link.label}:${link.command || link.launch?.url || ""}`} link={link} />)}</div>
    </details>}
    <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <span className={cx("mr-auto text-2xs font-medium", station.next?.actor === "human" ? "text-warm" : "text-muted")}>{nextText(station)}</span>
      {route && <Button size="sm" variant="ghost" onClick={() => onNavigate(route)}>去看<ArrowRight className="size-3.5" /></Button>}
      <Button size="sm" variant="secondary" icon={<Bot className="size-3.5" />} onClick={onHandOff}>交给 Agent</Button>
    </footer>
  </article>;
}

export function ProductionLineView({ line, tasks, links, compact, onHandOff, onOpenResult, onNavigate, onOpenStation, openStation }: {
  line: ProductionLine;
  tasks: TaskSnapshot[];
  links?: Partial<Record<ProductionStationId, WorkQueueLink[]>>;
  compact?: boolean;
  onHandOff: (station: ProductionStationId) => void;
  onOpenResult: (key: string) => void;
  onNavigate: (to: string) => void;
  /** With this, the rail's segments and each card's header open a station in the right-hand panel. */
  onOpenStation?: (station: ProductionStationId) => void;
  openStation?: ProductionStationId | null;
}) {
  const byKey = useMemo(() => new Map(tasks.flatMap((task) => task.task_key ? [[task.task_key, task] as const] : [])), [tasks]);
  const timeScale = useMemo(() => stationScale(line), [line]);
  return <div className="@container space-y-5" data-production-line={line.range.kind}>
    <StationRail line={line} onPick={onOpenStation} open={openStation} />
    <div className="grid gap-4 @2xl:grid-cols-2 @6xl:grid-cols-3">
      {line.stations.map((station, index) => <StationCard key={station.station} station={station} index={index} current={line.current === station.station} tasks={byKey} links={links?.[station.station]} compact={compact} timeScale={timeScale} onHandOff={() => onHandOff(station.station)} onOpenResult={onOpenResult} onNavigate={onNavigate} onOpen={onOpenStation ? () => onOpenStation(station.station) : undefined} />)}
    </div>
    {line.range.kind === "episode" && (line.unassigned_tasks ?? 0) > 0 && <p className="flex items-start gap-1.5 text-2xs text-muted"><ShieldQuestion aria-hidden="true" className="mt-px size-3.5 shrink-0" />这个范围里还有 {line.unassigned_tasks} 个任务没有标注属于哪一集，没有算进这一集。它们在「项目制作线」和「作品」里都能看到。</p>}
  </div>;
}
