import { useMemo, useState } from "react";
import { ArrowRight, Bot, Plug } from "../../icons";
import { Button, Facts, KindBadge, cx } from "../../components/ui";
import { InspectorShell, type InspectorMode } from "../../components/InspectorShell";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { OwnerLinkRow } from "../../components/OwnerLinkRow";
import type { ProductionLine, ProductionStation, StationDecision } from "../../shared/production-line";
import { decisionText, factText, gapLabels, linkedByLabels, ownerReviewText, nextText, stationLabels, stationReason, stationSummary, toolNames } from "../../shared/read-model/production";
import type { TaskSnapshot } from "../../task-observation";
import type { WorkQueueLink } from "../../shared/work-queue";
import { StationStatePill, stationRoutes } from "./ProductionLine";
import { StationTimeSection } from "./ProductionTime";
import { AudioQueue, audioTrackFrom, type AudioTrack } from "../../app/audio-player";
import { AudioMiniWave, AudioPlayButton } from "../../components/AudioDock";
import { resultAction } from "../../shared/read-model/tasks";
import { formatPlaybackTime } from "../../shared/audio-playback";

/**
 * One station of the line in the right-hand panel: what it holds, every result (each opens the viewer here), the
 * decisions waiting on a person (each opens its task here), what cannot be read yet, and the tools to open. Previous and
 * next walk the stations in order. Like the page, it only reads; deciding and editing happen in the tools.
 */
export function StationInspector({ line, station, tasks, links, mode, onModeChange, onClose, onStep, onHandOff, onOpenResult, onOpenDecision, onNavigate }: {
  line: ProductionLine;
  station: ProductionStation;
  tasks: TaskSnapshot[];
  links?: WorkQueueLink[];
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
  onClose: () => void;
  /** The station before or after this one; the page steps from the address, so quick presses add up. */
  onStep: (delta: -1 | 1) => void;
  onHandOff: () => void;
  onOpenResult: (key: string) => void;
  onOpenDecision: (decision: StationDecision) => void;
  onNavigate: (to: string) => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const byKey = useMemo(() => new Map(tasks.flatMap((task) => task.task_key ? [[task.task_key, task] as const] : [])), [tasks]);
  const index = line.stations.findIndex((item) => item.station === station.station);
  const previous = line.stations[index - 1];
  const next = line.stations[index + 1];
  const label = stationLabels[station.station];
  const reason = station.state === "observed" ? "" : stationReason(station.reason);
  const route = stationRoutes[station.station];
  // Audio results are listed as rows that play in the global player, the whole list queued; the rest stay tiles.
  const resolved = station.results.map((result) => {
    const key = `${result.task_key}:${result.artifact_ref}`;
    const task = byKey.get(result.task_key);
    const artifact = task?.results.find((item) => item.ref === result.artifact_ref);
    return { result, key, task, artifact };
  });
  const audio = resolved.flatMap((item) => item.result.kind === "audio" && item.task && item.artifact ? [{ ...item, track: audioTrackFrom({ key: item.key, task: item.task, result: item.artifact, kind: "audio" }), playable: resultAction(item.task, "preview").enabled }] : []);
  const audioKeys = new Set(audio.map((item) => item.key));
  const tiles = resolved.filter((item) => !audioKeys.has(item.key));
  const queue: AudioTrack[] = audio.filter((item) => item.playable).map((item) => item.track);
  const sections = [
    { id: "overview", label: "概况" },
    ...(station.time ? [{ id: "time", label: "耗时" }] : []),
    ...(station.results.length ? [{ id: "results", label: `结果 ${station.results.length}` }] : []),
    ...(station.decisions.length ? [{ id: "decisions", label: "等你决定" }] : []),
    ...(station.facts?.length ? [{ id: "facts", label: "Scaena 记录" }] : []),
    ...(station.gaps.length ? [{ id: "gaps", label: "待接通" }] : []),
    ...(links?.length ? [{ id: "tools", label: "在工具里打开" }] : []),
  ];
  return <InspectorShell
    open
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={() => setMaximized((value) => !value)}
    onClose={onClose}
    label="站点"
    ariaLabel="站点详情"
    closeAriaLabel="关闭站点详情"
    dataAttribute="data-station-inspector"
    itemKey={station.station}
    followRow={`article[data-station="${station.station}"]`}
    stepper={{ noun: "站", previous: previous ? () => onStep(-1) : undefined, next: next ? () => onStep(1) : undefined, position: `${index + 1} / ${line.stations.length}` }}
    header={<div className="min-w-0">
      <p className="text-2xs font-medium text-muted">第 {index + 1} 站 · {station.tools.map((tool) => toolNames[tool]).join(" / ")}</p>
      <h2 className="mt-0.5 font-display text-title font-semibold text-ink">{label.label}</h2>
      <p className="mt-1 text-body-sm text-muted">{label.detail}</p>
    </div>}
    meta={<div className="mt-3 flex flex-wrap items-center gap-2"><StationStatePill station={station} /><span className={cx("text-2xs font-medium", station.next?.actor === "human" ? "text-warm" : "text-muted")}>{nextText(station)}</span></div>}
    sections={sections}
    footer={<div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" icon={<Bot className="size-3.5" />} onClick={onHandOff}>这一站交给 Agent</Button>
      {route && <Button size="sm" variant="ghost" onClick={() => onNavigate(route)}>在作品里看<ArrowRight className="size-3.5" /></Button>}
    </div>}
  >
    <section data-inspector-section="overview" tabIndex={-1} className="scroll-mt-24 space-y-3">
      <h3 className="text-body-sm font-semibold text-ink">概况</h3>
      <p className="text-body-sm text-ink-soft">{stationSummary(station)}</p>
      {reason && <p className="text-2xs text-muted">{reason}</p>}
      <Facts columns={2} items={[
        { label: "在跑", value: station.counts.running },
        { label: "等你挑", value: station.counts.waiting_review },
        { label: "有问题", value: station.counts.problem },
        { label: "已完成", value: station.counts.done },
      ]} />
    </section>
    {station.time && <section data-inspector-section="time" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3">
      <h3 className="text-body-sm font-semibold text-ink">耗时</h3>
      <StationTimeSection station={station} onOpenTask={(key) => onNavigate(`/tasks?task=${encodeURIComponent(key)}`)} />
    </section>}
    {station.results.length > 0 && <section data-inspector-section="results" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3">
      <h3 className="text-body-sm font-semibold text-ink">结果</h3>
      {audio.length > 0 && <AudioQueue tracks={queue}><ul className="space-y-1.5" aria-label={`${label.label}的音频`} data-station-audio>
        {audio.map(({ key, result, track, playable }) => <li key={key} className="flex min-w-0 items-center gap-3 rounded-[12px] border border-line bg-panel-soft px-3 py-2" data-station-audio-row={key}>
          <div className="min-w-0 flex-1">
            <button type="button" data-viewer-origin={key} onClick={() => onOpenResult(key)} className="block min-h-6 max-w-full truncate text-left text-body-sm font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus" title={track.title}>{track.title}</button>
            <p className="mt-0.5 truncate text-2xs text-muted">{[result.title, track.durationMs ? formatPlaybackTime(track.durationMs / 1000) : null].filter(Boolean).join(" · ")}</p>
            <AudioMiniWave trackKey={key} className="mt-1.5" />
          </div>
          {playable ? <AudioPlayButton track={track} iconOnly className="max-sm:size-11" /> : <span className="shrink-0 text-2xs text-muted">未授权</span>}
        </li>)}
      </ul></AudioQueue>}
      {tiles.length > 0 && <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={`${label.label}的结果`}>
        {tiles.map(({ result, key, task, artifact }) => {
          return <li key={key} className="min-w-0">
            <button type="button" aria-label={`预览 ${result.title}`} data-viewer-origin={key} onClick={() => onOpenResult(key)} className="block aspect-square w-full overflow-hidden rounded-[12px] border border-line bg-panel-sunken transition-transform duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-focus">
              {task && artifact ? <TaskThumbnail task={task} result={artifact} frameless alt="" fallback={<span className="grid size-full place-items-center"><KindBadge kind={result.kind} size="sm" /></span>} /> : <span className="grid size-full place-items-center"><KindBadge kind={result.kind} size="sm" /></span>}
            </button>
            <p className="mt-1 truncate text-2xs text-muted" title={result.title}>{result.title}</p>
          </li>;
        })}
      </ul>}
    </section>}
    {station.decisions.length > 0 && <section data-inspector-section="decisions" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-2">
      <h3 className="text-body-sm font-semibold text-ink">等你决定</h3>
      <ul className="space-y-1.5">
        {station.decisions.map((decision) => {
          const text = decisionText(decision);
          return <li key={`${decision.kind}:${decision.ref}`}>
            <button type="button" data-decision={decision.kind} onClick={() => onOpenDecision(decision)} className="flex w-full min-w-0 items-baseline gap-2 rounded-[10px] border border-line bg-panel-soft px-3 py-2 text-left text-body-sm transition-colors hover:border-line-strong hover:bg-panel focus-visible:outline-2 focus-visible:outline-focus">
              <span className={cx("shrink-0 text-2xs font-semibold", text.tone === "danger" ? "text-danger" : text.tone === "warning" ? "text-warning" : "text-review")}>{text.verb}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{text.title}</span>
              <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
            </button>
          </li>;
        })}
      </ul>
    </section>}
    {station.facts && station.facts.length > 0 && <section data-inspector-section="facts" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-2">
      <h3 className="text-body-sm font-semibold text-ink">Scaena 记录</h3>
      <ul className="space-y-1.5 text-2xs text-ink-soft">{station.facts.map((fact) => <li key={fact.part}>{factText(fact)}</li>)}</ul>
      <p className="text-2xs text-muted">只是 Scaena 存下的记录和计数；采用、交付仍在工具里决定。</p>
    </section>}
    {station.linked_by && <p className="mt-3 text-2xs text-muted">{linkedByLabels[station.linked_by]}：这些任务按 Scaena 为这一集记录的工具绑定归到这里。</p>}
    {station.owner_review && <p data-owner-review="" className="mt-3 text-2xs text-ink-soft">{ownerReviewText(station.owner_review)}。挑选和决定都在 Eikona 里做，这里只读。</p>}
    {station.gaps.length > 0 && <section data-inspector-section="gaps" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-2">
      <h3 className="text-body-sm font-semibold text-ink">待接通</h3>
      <ul className="space-y-1.5">{station.gaps.map((gap) => <li key={gap.part} className="flex items-start gap-1.5 text-2xs text-ink-soft"><Plug aria-hidden="true" className="mt-px size-3.5 shrink-0 text-review" /><span>{gapLabels[gap.part]}：{stationReason(gap.reason)}</span></li>)}</ul>
      <p className="text-2xs text-muted">工具开放接口之前，这里不推断它们的状态。</p>
    </section>}
    {links && links.length > 0 && <section data-inspector-section="tools" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-2">
      <h3 className="text-body-sm font-semibold text-ink">在工具里打开</h3>
      <div className="space-y-2">{links.map((link) => <OwnerLinkRow key={`${link.target}:${link.label}:${link.command || link.launch?.url || ""}`} link={link} />)}</div>
    </section>}
  </InspectorShell>;
}
