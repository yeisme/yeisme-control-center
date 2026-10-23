import { useRef, useState } from "react";
import { ArrowRight, Clapperboard, Columns3, Copy, RefreshCw } from "../../icons";
import { useScopedRead } from "../../app/workspace";
import { InspectorShell } from "../../components/InspectorShell";
import { OwnerLinkRow } from "../../components/OwnerLinkRow";
import { Button, CopyRef, CoverageChip, EmptyState, Facts, InlineNotice, Input, Pill, ReadStateView, SkeletonRows, ownerLabel } from "../../components/ui";
import { api, isRouteUnavailable } from "../../shared/api/control-center-client";
import type { DramaEpisodeDetail } from "../../shared/drama";
import { formatFullTime, formatRelative } from "../../shared/read-model/format";
import { blockerLabel, currentStage, dramaOwnerNames, dramaStageLabels, nextStepText, railNodeInfo, tasksForEpisode } from "../../shared/read-model/drama";
import type { TaskSnapshot } from "../../task-observation";
import { OutlineSection, TaskSection } from "./OutlineSection";
import { StageRail, railShapeIcons } from "./StageRail";

type DetailRead = DramaEpisodeDetail | { route_unavailable: true };
const sections = [{ id: "overview", label: "概况" }, { id: "chain", label: "阶段链" }, { id: "outline", label: "分镜结构" }, { id: "tasks", label: "生产任务" }, { id: "handoff", label: "交接" }];
const cacheLabels = { hit: "缓存（最多 45 秒）", miss: "刚读取", refresh_limited: "10 秒内已刷新，沿用结果" } as const;
const originLabels = { collection: "Auctra 收集库", task: "任务里的剧集引用", manual: "手动指定" } as const;
const pending = ["生成", "审阅", "交付"];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={`drama-inspector-${id}`} data-inspector-section={id} tabIndex={-1} className="scroll-mt-24 space-y-2">
    <h3 className="text-body-sm font-semibold text-ink">{title}</h3>
    {children}
  </section>;
}

export function EpisodeInspector({ episode, title, origin, scaenaOverride, onScaenaOverride, tasks, mode, maximized, onModeChange, onMaximize, onClose, onNavigate }: {
  episode: string;
  title: string;
  origin: "collection" | "task" | "manual";
  scaenaOverride?: string;
  onScaenaOverride: (value: string) => void;
  scopeLabel: string;
  tasks: TaskSnapshot[];
  mode: "fixed" | "floating";
  maximized: boolean;
  onModeChange: (mode: "fixed" | "floating") => void;
  onMaximize: () => void;
  onClose: () => void;
  onNavigate: (to: string) => void;
}) {
  const [nonce, setNonce] = useState(0);
  const [draft, setDraft] = useState(scaenaOverride || "");
  const refresh = useRef(false);
  const read = useScopedRead<DetailRead>(async (scope, signal) => {
    const force = refresh.current;
    refresh.current = false;
    try { return await api.dramaEpisode(scope, episode, { scaena_episode_ref: scaenaOverride, refresh: force }, signal); } catch (error) {
      if (isRouteUnavailable(error)) return { route_unavailable: true };
      throw error;
    }
  }, { key: `${episode}|${scaenaOverride || ""}|${nonce}` });
  const missing = !!read.data && "route_unavailable" in read.data;
  const detail = read.data && !missing ? read.data as DramaEpisodeDetail : null;
  const flow = detail?.flow;
  const next = detail ? nextStepText(detail.rail, flow?.next_attention) : null;
  const related = detail ? tasksForEpisode(tasks, [episode, detail.scaena_episode_ref]) : tasksForEpisode(tasks, [episode]);
  const scaenaStage = detail?.rail.find((node) => node.stage === "production_breakdown");
  // Only suspect a mismatched ref once the episode has reached the point where Scaena should already hold a breakdown.
  const handoffState = detail?.rail.find((node) => node.stage === "production_handoff")?.state;
  const joinHint = !!detail && scaenaStage?.state === "not_started" && !detail.outline && ["accepted", "ready", "stale"].includes(handoffState || "");
  const coverage = (owner: "auctra" | "scaena") => flow?.source_coverage.find((item) => item.owner === owner);

  const header = <div className="flex items-start gap-3">
    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control bg-panel-soft text-info"><Clapperboard className="size-4" /></span>
    <div className="min-w-0 flex-1">
      <p className="text-2xs font-medium text-muted">剧集制作</p>
      <h2 className="mt-0.5 break-words text-title font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <div className="mt-1 text-body-sm text-muted">{next ? next.text : read.status === "loading" ? "正在读取…" : "状态未读取"}</div>
    </div>
  </div>;
  const meta = <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-muted">
    <span className="flex min-w-0 items-center gap-1.5"><Columns3 className="size-3.5 shrink-0 text-faint" />{originLabels[origin]}</span>
    <span className="flex min-w-0 items-center gap-2"><span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel-soft px-2 py-0.5"><Copy className="size-3" />引用</span><CopyRef value={episode} label="剧集引用" /></span>
  </div>;
  const footer = <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
    <Button size="sm" className="ml-auto" disabled={read.status === "loading"} icon={<RefreshCw className="size-3.5" />} onClick={() => { refresh.current = true; setNonce((value) => value + 1); }}>重新读取</Button>
  </div>;

  return <InspectorShell
    open
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={onMaximize}
    onClose={onClose}
    label="剧集"
    ariaLabel="剧集详情"
    dataAttribute="data-drama-inspector"
    header={header}
    meta={meta}
    sections={sections}
    footer={footer}
  >
    <ReadStateView status={missing ? "ready" : read.status} error={read.error} onRetry={read.reload} skeleton={<SkeletonRows rows={6} />}>
      {missing && <EmptyState title="服务端版本过旧" body="剧集详情接口不存在，请更新并重启控制中心服务端。" />}
      {detail && flow && <div className="space-y-5">
        <Section id="overview" title="概况">
          <Facts columns={2} items={[
            { label: "Auctra 剧集引用", value: <CopyRef value={detail.episode_ref} label="Auctra 剧集引用" /> },
            { label: "Scaena 剧集引用", value: <span className="inline-flex items-center gap-2"><CopyRef value={detail.scaena_episode_ref} label="Scaena 剧集引用" />{detail.scaena_episode_overridden && <Pill size="sm" tone="info">已指定</Pill>}</span> },
            { label: "读取方式", value: cacheLabels[detail.cache] },
            { label: "观察时间", value: <span title={formatFullTime(detail.observed_at)}>{formatRelative(detail.observed_at)}</span> },
            { label: "Auctra 读取", value: <CoverageChip state={coverage("auctra")?.state || "unknown"} reason={coverage("auctra")?.reason && blockerLabel(coverage("auctra")?.reason)} /> },
            { label: "Scaena 读取", value: <CoverageChip state={coverage("scaena")?.state || "unknown"} reason={coverage("scaena")?.reason && blockerLabel(coverage("scaena")?.reason)} /> },
          ]} />
          {joinHint && <InlineNotice tone="info">Scaena 中没有引用为「{detail.scaena_episode_ref}」的拆解。Scaena 可能用不同的集引用保存这一集（例如 <code>episode:03</code>）；在下面指定后重新读取。这只改变读取，不会写入任何 owner。</InlineNotice>}
          <form className="space-y-1" onSubmit={(event) => { event.preventDefault(); onScaenaOverride(draft.trim()); }}>
            <label htmlFor="drama-scaena-ref" className="block text-2xs text-muted">Scaena 用不同的集引用保存这一集？在此指定（可选，只改变读取）</label>
            <div className="flex items-center gap-2">
              <Input id="drama-scaena-ref" aria-label="指定 Scaena 使用的剧集引用" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="例如 episode:03" className="min-w-0 flex-1" />
              <Button size="sm" type="submit">应用</Button>
              {scaenaOverride && <Button size="sm" variant="ghost" onClick={() => { setDraft(""); onScaenaOverride(""); }}>清除</Button>}
            </div>
          </form>
        </Section>

        <Section id="chain" title="阶段链">
          <StageRail rail={detail.rail} current={currentStage({ rail: detail.rail, next_attention: flow.next_attention })} showState />
          <ol className="space-y-2">
            {detail.rail.map((node) => {
              const stage = flow.stages.find((item) => item.stage === node.stage);
              const info = railNodeInfo(node);
              return <li key={node.stage} data-stage={node.stage} data-state={node.state} className="rounded-control border border-line bg-panel-soft p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={info.tone} icon={railShapeIcons[info.shape]}>{info.label}</Pill>
                  <span className="text-body-sm font-medium text-ink">{dramaStageLabels[node.stage]}</span>
                  <span className="text-2xs text-muted">{dramaOwnerNames[node.owner]}</span>
                  {node.coverage !== "complete" && <CoverageChip state={node.coverage} />}
                </div>
                {node.blocker && <p className="mt-1.5 text-2xs text-muted">{blockerLabel(node.blocker)}</p>}
                {stage && <Facts columns={2} className="mt-2" items={[
                  { label: "版本", value: stage.revision ? <span className="font-mono text-xs">{stage.revision}</span> : "未提供" },
                  { label: "摘要", value: stage.digest ? <CopyRef value={stage.digest} label="摘要" /> : "未提供" },
                  { label: "观察", value: <span title={formatFullTime(stage.observed_at)}>{formatRelative(stage.observed_at)}</span> },
                  { label: "owner 状态", value: <span className="font-mono text-xs">{stage.native_state}</span> },
                  ...(stage.safe_refs.length ? [{ label: "引用", wide: true, value: <span className="flex flex-wrap gap-1.5">{[...new Set(stage.safe_refs)].slice(0, 4).map((ref) => <CopyRef key={ref} value={ref} label="引用" />)}</span> }] : []),
                ]} />}
              </li>;
            })}
            {pending.map((name) => <li key={name} className="flex items-center gap-2 rounded-control border border-dashed border-line px-3 py-2">
              <Pill tone="review" size="sm" icon={railShapeIcons.plug}>待合同</Pill>
              <span className="text-body-sm text-muted">{name}</span>
              <span className="ml-auto text-2xs text-faint">owner 尚未提供读取合同，不在此推断</span>
            </li>)}
          </ol>
        </Section>

        <Section id="outline" title="分镜结构">
          <OutlineSection outline={detail.outline} emptyReason={coverage("scaena")?.state === "complete" ? `Scaena 里还没有引用为「${detail.scaena_episode_ref}」的拆解。` : `Scaena 来源${blockerLabel(coverage("scaena")?.reason) ? "：" + blockerLabel(coverage("scaena")?.reason) : "暂不可读"}。`} />
        </Section>

        <Section id="tasks" title="生产任务">
          <TaskSection tasks={related} onOpen={(task) => onNavigate(`/tasks?task=${encodeURIComponent(task.task_key || "")}`)} />
          <Button size="sm" variant="ghost" icon={<ArrowRight className="size-3.5" />} onClick={() => onNavigate(`/tasks?q=${encodeURIComponent(episode)}`)}>在任务中心按该集筛选</Button>
        </Section>

        <Section id="handoff" title="交接">
          {detail.handoff.length === 0 ? <p className="text-body-sm text-muted">还没有可交接的阶段。</p> : detail.handoff.map((group) => <div key={group.stage} className="space-y-2">
            <p className="text-2xs font-medium text-muted">{dramaStageLabels[group.stage]} · {ownerLabel(group.owner)}</p>
            {group.links.filter((link) => link.kind === "owner").map((link) => <OwnerLinkRow key={`${group.stage}:${link.target}`} link={link} />)}
          </div>)}
          <Button size="sm" variant="ghost" icon={<ArrowRight className="size-3.5" />} onClick={() => onNavigate("/review")}>前往审阅与交付</Button>
        </Section>
      </div>}
    </ReadStateView>
  </InspectorShell>;
}
