import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Bot, Braces, PanelRightOpen, RefreshCw } from "../../icons";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { linkActions, useCopy } from "../../app/item-actions";
import { liveQuery, useOverlayParams } from "../../app/overlay-history";
import { useInspectorMode } from "../../app/preferences";
import { audioTrackFrom, useAudioPlayer } from "../../app/audio-player";
import { ActionsMenu, Button, InlineNotice, NoticeStack, ReadStateView, SkeletonBlock, cx, type ItemAction } from "../../components/ui";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { HandoffSheet } from "../../components/HandoffSheet";
import { useMediaPreview } from "../../components/media-preview";
import { MediaViewer, visualSlides } from "../../components/MediaViewer";
import { api, isRouteUnavailable } from "../../shared/api/control-center-client";
import type { CreativeFlowStage } from "../../shared/creative-flow";
import { dramaNextStep, type DramaEpisodeDetail } from "../../shared/drama";
import { buildProductionLine, productionStations, taskSourceAnswered, type ProductionInput, type ProductionStationId, type StationDecision } from "../../shared/production-line";
import { buildAgentBrief, type AgentBrief } from "../../shared/agent-brief";
import type { EpisodeProductionRead } from "../../shared/episode-production";
import { stationReviewKeys, type TaskReviewRead } from "../../shared/task-review";
import { decisionText, nextText, stationLabels } from "../../shared/read-model/production";
import { formatRelative } from "../../shared/read-model/format";
import { nextStepText } from "../../shared/read-model/drama";
import { collectResults, type ResultEntry } from "../../shared/read-model/tasks";
import type { WorkQueueLink } from "../../shared/work-queue";
import { pickCover } from "../home/today-model";
import { TaskDetail } from "../tasks/TaskDetail";
import { ProductionLineView } from "./ProductionLine";
import { ShotBoard, type BoardShot } from "./ShotBoard";
import { StationInspector } from "./StationInspector";
import { TimeBand, TimeHeroLine } from "./ProductionTime";
import { ShotInspector } from "./ShotInspector";
import { scrollBehavior } from "../../shared/motion/reduced";

type DetailRead = DramaEpisodeDetail | { route_unavailable: true };
const stationOfStage: Record<CreativeFlowStage, ProductionStationId> = { screenplay: "story", director_plan: "story", creative_storyboard: "board", production_handoff: "board", production_breakdown: "board" };
/**
 * The layers this page opens over itself, all in the address: the episode's stage details, a station, a shot, a task
 * (opened from a decision, over the station it came from) and the viewer. Back closes the top one.
 */
const studioOverlays = ["episode", "station", "shot", "task", "preview"] as const;

/** The card of a station scrolls into view and rings once, so a click on the rail shows where it landed. */
function ringStation(station: ProductionStationId) {
  const card = document.getElementById(`station-card-${station}`);
  if (!card) return;
  card.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  card.removeAttribute("data-flash");
  void card.offsetWidth;
  card.setAttribute("data-flash", "");
  window.setTimeout(() => card.removeAttribute("data-flash"), 1000);
}

/**
 * One episode from story to cut, for a person and for an agent: seven stations read from the owners, the shot board, and
 * a brief for each step. Everything opens where it is clicked: a station or a shot in the right-hand panel, a result in
 * the viewer, a decision's task over its station. Editing stays in Auctra, Scaena and the other tools; this page only
 * reads, decides and hands off.
 */
export function EpisodeStudio({ episode, title, scaenaOverride, onBack, onNavigate }: {
  episode: string;
  title: string;
  scaenaOverride?: string;
  onBack: () => void;
  onNavigate: (to: string) => void;
}) {
  const { scopeId } = useWorkspace();
  const tasks = useTasks();
  const copy = useCopy();
  const player = useAudioPlayer();
  const [params, writeOverlay] = useOverlayParams(studioOverlays);
  const [inspectorMode, setInspectorMode] = useInspectorMode();
  const [nonce, setNonce] = useState(0);
  const [brief, setBrief] = useState<AgentBrief | null>(null);
  const read = useScopedRead<DetailRead>(async (scope, signal) => {
    try { return await api.dramaEpisode(scope, episode, { scaena_episode_ref: scaenaOverride, refresh: nonce > 0 }, signal); } catch (error) {
      if (isRouteUnavailable(error)) return { route_unavailable: true };
      throw error;
    }
  }, { key: `studio|${episode}|${scaenaOverride || ""}|${nonce}` });
  const detail = read.data && !("route_unavailable" in read.data) ? read.data : null;
  // Scaena's stored summary for this episode; asked once the episode says which Scaena episode it is.
  const scaenaRef = detail?.scaena_episode_ref || scaenaOverride || "";
  const summary = useScopedRead<EpisodeProductionRead>(async (scope, signal) => {
    try { return await api.episodeProduction(scope, episode, { scaena_episode_ref: scaenaRef || undefined }, signal); } catch (error) {
      if (isRouteUnavailable(error)) return { state: "needs_contract", reason: "episode_production_contract_missing" };
      throw error;
    }
  }, { key: `studio-production|${episode}|${scaenaRef}|${nonce}`, enabled: read.status !== "loading" });
  const failed = read.status !== "loading" && !detail;
  const tasksReadable = taskSourceAnswered(tasks);
  const name = title || episode;
  const input = useMemo((): ProductionInput => ({
    scope: scopeId,
    now: detail?.observed_at || new Date().toISOString(),
    range: { kind: "episode", episode_ref: episode, ...(detail?.scaena_episode_ref ? { scaena_episode_ref: detail.scaena_episode_ref } : {}), title: name },
    detail: failed ? null : detail,
    tasks: tasks.rows,
    tasksReadable,
    ...(tasksReadable || !tasks.error ? {} : { tasksReason: tasks.error }),
    connections: tasks.connections,
    ...(summary.data ? { production: summary.data } : {}),
  }), [detail, episode, failed, name, scopeId, summary.data, tasks.connections, tasks.error, tasks.rows, tasksReadable]);
  // Eikona's own review records decide which frames wait to be picked; asked only for the tasks the frames card shows.
  const reviewKeys = useMemo(() => stationReviewKeys(buildProductionLine(input).stations.find((station) => station.station === "frames")), [input]);
  const reviews = useScopedRead<Record<string, TaskReviewRead>>(async (scope, signal) => {
    try { return (await api.taskReviews(scope, reviewKeys, signal)).reviews; } catch (error) {
      if (isRouteUnavailable(error)) return Object.fromEntries(reviewKeys.map((key) => [key, { state: "needs_contract", reason: "review_observation_contract_missing" } as TaskReviewRead]));
      throw error;
    }
  }, { key: `studio-reviews|${reviewKeys.join(",")}|${nonce}`, enabled: reviewKeys.length > 0 });
  // A failed review read says so on the card; the tasks keep their own state rather than reading as decided.
  const reviewRead = useMemo(() => reviews.data || (reviews.error ? Object.fromEntries(reviewKeys.map((key) => [key, { state: "unavailable", reason: "source_unavailable" } as TaskReviewRead])) : null), [reviewKeys, reviews.data, reviews.error]);
  const line = useMemo(() => buildProductionLine({ ...input, ...(reviewKeys.length && reviewRead ? { reviews: reviewRead } : {}) }), [input, reviewKeys.length, reviewRead]);
  const links = useMemo(() => {
    const byStation: Partial<Record<ProductionStationId, WorkQueueLink[]>> = {};
    for (const handoff of detail?.handoff || []) (byStation[stationOfStage[handoff.stage]] ||= []).push(...handoff.links);
    return byStation;
  }, [detail]);
  const shots = useMemo(() => detail?.outline?.scenes.flatMap((scene) => scene.shots.map((shot) => ({ ...shot, scene_ref: scene.scene_ref, heading: scene.heading }))) || [], [detail]);
  const sceneOrders = useMemo(() => new Map(detail?.outline?.scenes.map((scene) => [scene.scene_ref, scene.order]) || []), [detail]);
  const cover = useMemo(() => pickCover(tasks.rows, [episode, detail?.scaena_episode_ref || ""]), [detail?.scaena_episode_ref, episode, tasks.rows]);
  const next = detail ? nextStepText(detail.rail, detail.flow.next_attention) : null;
  const preDone = !!detail && dramaNextStep(detail.rail, detail.flow.next_attention).kind === "done";
  const currentStation = line.current ? line.stations.find((station) => station.station === line.current) : undefined;
  const lead = read.status === "loading" ? "正在读取这一集…"
    : failed ? "这一集的阶段暂时读不到。画面、动态、声音和成片仍按任务显示。"
      : preDone && currentStation ? `前期走完了。现在先看「${stationLabels[currentStation.station].label}」——${nextText(currentStation)}。`
        : next?.text;
  const notices = line.stations.flatMap((station) => station.decisions.map((decision) => ({ station: station.station, decision }))).slice(0, 3);
  const returnTo = `#/drama?studio=${encodeURIComponent(episode)}`;
  const handOffStation = (station: ProductionStationId) => setBrief(buildAgentBrief({ kind: "station", line, station, links: links[station], shots, returnTo }));
  const handOffShot = (shot: BoardShot) => setBrief(buildAgentBrief({ kind: "shot", line, shot, returnTo }));

  // Every layer is a parameter of the address, written from the address as it is now so quick clicks add up.
  const setOverlay = useCallback((patch: Record<string, string | null>, history: "push" | "replace" = "push") => {
    const next = new URLSearchParams(liveQuery(params));
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    writeOverlay(next, history);
  }, [params, writeOverlay]);
  const stationParam = params.get("station");
  const openStationId = (productionStations as readonly string[]).includes(stationParam || "") ? stationParam as ProductionStationId : null;
  const shownStation = openStationId ? line.stations.find((station) => station.station === openStationId) : undefined;
  const shownShot = shots.find((shot) => shot.shot_ref === params.get("shot"));
  const shownTask = tasks.rows.find((task) => !!task.task_key && task.task_key === params.get("task"));
  // One right-hand panel at a time: a task opened from a decision lies over its station; the station returns on Back.
  const panel = shownTask ? "task" : shownShot ? "shot" : shownStation ? "station" : null;

  const openStation = useCallback((station: ProductionStationId) => {
    setOverlay({ station, shot: null, task: null, episode: null });
    requestAnimationFrame(() => ringStation(station));
  }, [setOverlay]);
  const stepStation = (delta: -1 | 1) => {
    const index = productionStations.indexOf(new URLSearchParams(liveQuery(params)).get("station") as ProductionStationId);
    const target = productionStations[index + delta];
    if (index < 0 || !target) return;
    setOverlay({ station: target }, "replace");
    requestAnimationFrame(() => ringStation(target));
  };
  const openShot = (shot: string) => setOverlay({ shot, station: null, task: null, episode: null });
  const stepShot = (delta: -1 | 1) => {
    const index = shots.findIndex((shot) => shot.shot_ref === new URLSearchParams(liveQuery(params)).get("shot"));
    const target = shots[index + delta];
    if (index >= 0 && target) setOverlay({ shot: target.shot_ref }, "replace");
  };
  // The episode's stage details; a stage decision opens them at the stage chain.
  const openDetail = (section?: string) => setOverlay({ episode, section: section || null, station: null, shot: null, task: null });
  const openDecision = (decision: StationDecision) => {
    if (decision.task_key && tasks.rows.some((task) => task.task_key === decision.task_key)) setOverlay({ task: decision.task_key });
    else if (decision.kind === "stage_review" || decision.kind === "stage_repair") openDetail("chain");
    else if (decision.task_key) onNavigate(`/tasks?task=${encodeURIComponent(decision.task_key)}`);
  };

  // Results open in the viewer right here, stepping through the line's results in station order.
  const entries = useMemo(() => new Map(collectResults(tasks.rows).map((entry) => [entry.key, entry])), [tasks.rows]);
  const resolvePreview = useCallback((key: string) => entries.get(key) || null, [entries]);
  const setPreviewKey = useCallback((key: string | null, history: "push" | "replace") => setOverlay({ preview: key }, history), [setOverlay]);
  const preview = useMediaPreview({ previewKey: params.get("preview"), resolve: resolvePreview, onPreviewKeyChange: setPreviewKey, urlParam: "preview" });
  const slides = useMemo(() => visualSlides(line.stations.flatMap((station) => station.results.map((result) => entries.get(`${result.task_key}:${result.artifact_ref}`))).filter((entry): entry is ResultEntry => !!entry)), [entries, line]);
  const openResult = useCallback((key: string) => {
    const entry = entries.get(key);
    if (!entry) { onNavigate(`/assets?result=${encodeURIComponent(key)}`); return; }
    if (entry.kind === "audio") { player.play(audioTrackFrom(entry, `/drama?studio=${encodeURIComponent(episode)}`)); return; }
    setOverlay({ preview: key });
    preview.open(entry, { source: "asset-card", autoplay: true, syncQuery: false });
  }, [entries, episode, onNavigate, player, preview, setOverlay]);
  const navigateViewer = useCallback((key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    preview.open(entry, { source: "asset-card", autoplay: true, syncQuery: false });
    setOverlay({ preview: key }, "replace");
  }, [entries, preview, setOverlay]);

  // The same structure an agent reads from GET /production, for a person's own scripts; tucked away, not a main action.
  const moreActions: ItemAction[] = [
    { id: "copy-line", label: "复制制作线数据", icon: <Braces />, group: "data", run: () => void copy(JSON.stringify(line, null, 2), "制作线数据") },
    ...linkActions(`/drama?studio=${encodeURIComponent(episode)}`, copy),
  ];

  return <div className={cx("space-y-8", panel && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-episode-studio={episode}>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={onBack}>全部剧集</Button>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<PanelRightOpen className="size-3.5" />} onClick={() => openDetail()}>阶段与交接详情</Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => setNonce((value) => value + 1)}>刷新</Button>
        <ActionsMenu label="更多：这一集" actions={moreActions} />
      </span>
    </div>

    <section aria-labelledby="studio-title" className="relative isolate overflow-hidden rounded-hero bg-surface-hero text-hero-ink shadow-hero rise">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        {cover ? <TaskThumbnail task={cover.task} result={cover.result} frameless alt="" className="ken-burns" fallback={<span className="cover-type size-full" />} /> : <span className="cover-type block size-full" />}
        <span className="hero-scrim absolute inset-0" />
      </div>
      <div className="grid gap-8 p-6 sm:p-9 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] lg:p-11">
        <div className="min-w-0">
          <p className="text-2xs font-medium tracking-[0.12em] text-hero-ink/75">创作 · 剧集 · {episode}</p>
          <h2 id="studio-title" className="mt-3 font-display text-hero font-semibold text-pretty">{name}</h2>
          <p className="mt-3 max-w-xl text-body-sm text-hero-ink/85">{lead}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {line.current && <button type="button" onClick={() => openStation(line.current!)} className="inline-flex h-11 items-center gap-2 rounded-full bg-lime px-5 text-[14px] font-semibold text-lime-ink shadow-[0_14px_34px_-14px_var(--lime)] transition-transform hover:-translate-y-px">先看「{stationLabels[line.current].label}」</button>}
            {line.current && <button type="button" onClick={() => handOffStation(line.current!)} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/25 bg-black/20 px-5 text-[14px] font-medium text-hero-ink backdrop-blur-sm transition-colors hover:bg-black/35"><Bot className="size-4" />这一站交给 Agent</button>}
          </div>
        </div>
        <aside aria-labelledby="studio-notices" className="rounded-[20px] border border-white/12 bg-black/25 p-5 backdrop-blur-md">
          <h3 id="studio-notices" className="font-display text-[18px] font-semibold">今晚的通告</h3>
          <p className="mt-0.5 text-2xs text-hero-ink/70">{notices.length ? `${notices.length} 件等你决定` : "没有在等你决定的事"}</p>
          {notices.length > 0 && <ol className="mt-4 space-y-1">
            {notices.map(({ station, decision }, index) => {
              const text = decisionText(decision);
              return <li key={`${station}:${decision.kind}:${decision.ref}`}>
                <button type="button" data-notice={decision.kind} onClick={() => openDecision(decision)} className="-mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-[12px] px-2 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
                  <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full border border-white/20 text-2xs tabular">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-body-sm font-medium">{stationLabels[station].label}：{text.verb}</span>
                    <span className="block truncate text-2xs text-hero-ink/70">{text.title}</span>
                  </span>
                </button>
              </li>;
            })}
          </ol>}
          <TimeHeroLine line={line} className="mt-4 text-hero-ink/80" />
          {detail && <p className="mt-1.5 text-2xs text-hero-ink/60">读取于 {formatRelative(detail.observed_at)}</p>}
        </aside>
      </div>
    </section>

    <NoticeStack notices={[
      read.data && "route_unavailable" in read.data && <InlineNotice key="route" tone="warning">控制中心服务端还没有剧集接口；更新服务端后才能读这一集的阶段。</InlineNotice>,
      detail?.scaena_episode_overridden && <InlineNotice key="override" tone="info">Scaena 按「{detail.scaena_episode_ref}」读取这一集，这是一个只读参数。</InlineNotice>,
    ]} />

    <TimeBand line={line} onOpenStation={openStation} onReturn={tasks.refresh} />

    <section aria-labelledby="studio-line" className="space-y-4">
      <div>
        <p className="text-2xs font-medium tracking-[0.12em] text-muted">制作线</p>
        <h2 id="studio-line" className="mt-1 font-display text-[24px] font-semibold text-ink">从一张图到一集漫剧，这一集走到这里</h2>
        <p className="mt-1 text-body-sm text-muted">每一站都写清楚谁来做：你来决定的标成暖色，可以交给 Agent 的给了现成说明。点站点条或卡片右上角，在右侧看这一站的全部内容；点结果就地看大图。工具还没开放的环节写「待接通」，不猜。</p>
      </div>
      {read.status === "loading" && !detail ? <SkeletonBlock className="h-72 rounded-tile" /> : <ProductionLineView line={line} tasks={tasks.rows} links={links} onHandOff={handOffStation} onOpenResult={openResult} onNavigate={onNavigate} onOpenStation={openStation} openStation={panel === "station" ? openStationId : null} />}
    </section>

    <section aria-labelledby="studio-board" className="space-y-4">
      <div>
        <p className="text-2xs font-medium tracking-[0.12em] text-muted">镜头板</p>
        <h2 id="studio-board" className="mt-1 font-display text-[24px] font-semibold text-ink">每一场、每一镜</h2>
        <p className="mt-1 text-body-sm text-muted">点一张镜头卡在右侧看它的细节；方向键在卡片之间移动，回车打开。</p>
      </div>
      <ReadStateView status={read.status === "empty" ? "ready" : read.status} error={read.error} onRetry={read.reload} skeleton={<SkeletonBlock className="h-48 rounded-tile" />}>
        <ShotBoard outline={detail?.outline} emptyReason={detail ? "Scaena 还没有这一集的拆解，或这个范围还没有连接 Scaena 拆解读取。" : "这一集暂时读不到。"} onHandOff={handOffShot} onOpen={openShot} openShot={panel === "shot" ? shownShot?.shot_ref ?? null : null} />
      </ReadStateView>
    </section>

    {panel === "station" && shownStation && <StationInspector line={line} station={shownStation} tasks={tasks.rows} links={links[shownStation.station]} mode={inspectorMode} onModeChange={setInspectorMode} onClose={() => setOverlay({ station: null }, "replace")} onStep={stepStation} onHandOff={() => handOffStation(shownStation.station)} onOpenResult={openResult} onOpenDecision={openDecision} onNavigate={onNavigate} />}
    {panel === "shot" && shownShot && <ShotInspector shots={shots} shot={shownShot} sceneOrder={sceneOrders.get(shownShot.scene_ref)} mode={inspectorMode} onModeChange={setInspectorMode} onClose={() => setOverlay({ shot: null }, "replace")} onStep={stepShot} onHandOff={() => handOffShot(shownShot)} />}
    {panel === "task" && shownTask && <TaskDetail task={shownTask} open mode={inspectorMode} onModeChange={setInspectorMode} preview={preview} onOpenChange={(open) => { if (!open) setOverlay({ task: null }, "replace"); }} />}
    <MediaViewer controller={preview} slides={slides} onNavigate={navigateViewer} />
    <HandoffSheet brief={brief} open={!!brief} onOpenChange={(open) => { if (!open) setBrief(null); }} />
  </div>;
}
