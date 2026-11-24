import { useMemo, useState, type ReactNode } from "react";
import { useInspectorMode } from "../../app/preferences";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useOverlayParams } from "../../app/overlay-history";
import { ArrowRight, Bot, CalendarDays, CircleAlert, CircleHelp, ClipboardCheck, Images, KeyRound, Plug, Route, ServerCog, ShieldQuestion, TriangleAlert, Unplug, Wallet } from "../../icons";
import { api, type UsageProjection } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace, type ScopedRead } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { Button, Dot, EmptyState, KindBadge, NoticeStack, Panel, Progress, ReadStateView, SkeletonRows, TaskStatePill, ToggleGroup, cx, ownerLabel, type Tone } from "../../components/ui";
import { formatMoney, formatRelative } from "../../shared/read-model/format";
import { connectionStateLabel, connectionTone, resultMeta, resultName, taskInProgress, taskKind } from "../../shared/read-model/tasks";
import { progressLabel, taskStateLabels, type TaskSnapshot } from "../../task-observation";
import { useNotifications } from "../../app/notifications-context";
import { countsAsHomeAttention, reminderStateLabels } from "../../notifications";
import { SourceCoverage } from "../../components/SourceCoverage";
import { openToolStateLabels, type OpenToolProjection } from "../../shared/open-tools";
import { SourceStatusLine } from "../../components/SourceStatusLine";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { HandoffSheet } from "../../components/HandoffSheet";
import { WorkQueueInspector, WorkStatePill, workQueueKindLabels, workQueueOwnerLabel, workQueuePriorityLabels, workQueueReasonLabel } from "./WorkQueueInspector";
import type { WorkQueueItem, WorkQueueKind } from "../../shared/work-queue";
import { matchesWorkQueueFilters } from "../../shared/work-queue";
import { buildAgentBrief, type AgentBrief } from "../../shared/agent-brief";
import { greeting, pickCover, pickDecisions, pickFocus, pickOutputs } from "./today-model";
import { scrollBehavior } from "../../shared/motion/reduced";

type QueueFilter = "all" | "review_required" | "handoff_ready" | "service_blocked" | "credential_renewal";
const queueFilters: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "review_required", label: "等你确认" },
  { id: "handoff_ready", label: "可交接" },
  { id: "service_blocked", label: "读不到" },
  { id: "credential_renewal", label: "凭据" },
];
const queueLimit = 8;
const workOverlays = ["work_item"] as const;
const queueKindIcons: Record<WorkQueueKind, ReactNode> = {
  task_failure: <CircleAlert />,
  task_unknown: <CircleHelp />,
  review_required: <ClipboardCheck />,
  handoff_ready: <Route />,
  service_blocked: <Unplug />,
  contract_gap: <Plug />,
  operation_failure: <TriangleAlert />,
  credential_renewal: <KeyRound />,
};
const stateText: Record<string, string> = { success: "text-success", danger: "text-danger", warning: "text-warning", neutral: "text-muted" };
const sourceDownStatuses = ["forbidden", "unavailable", "unknown", "needs_contract", "login_required"];

/** How a decision reads on its card: a verb in a person's words, a tone, and what the main button says. */
const decisionCopy: Partial<Record<WorkQueueKind, { verb: string; tone: "review" | "danger" | "warning" | "success"; action: string }>> = {
  review_required: { verb: "等你挑选", tone: "review", action: "去挑选" },
  task_unknown: { verb: "结果未知，先回查", tone: "warning", action: "看看" },
  task_failure: { verb: "没做成", tone: "danger", action: "看原因" },
  operation_failure: { verb: "工具运行失败", tone: "danger", action: "看原因" },
  handoff_ready: { verb: "可以交给下一站", tone: "success", action: "看交接" },
};
const toneDot: Record<string, string> = { review: "bg-review", danger: "bg-danger", warning: "bg-warning", success: "bg-success" };
const toneText: Record<string, string> = { review: "text-review", danger: "text-danger", warning: "text-warning", success: "text-success" };

/** An open tool on the home page: its state, then what needs attention or what is running. */
function OpenToolRow({ tool }: { tool: OpenToolProjection }) {
  const tone: Tone = tool.state === "ready" ? "success" : tool.state === "degraded" || tool.state === "rate_limited" ? "warning" : tool.state === "needs_contract" ? "neutral" : "danger";
  const counts = tool.operations.counts;
  const down = (tool.backends || []).filter((backend) => backend.enabled && backend.state === "down").length;
  const summary = tool.state !== "ready" && tool.state !== "degraded" ? "—"
    : tool.operations.attention.length ? `${tool.operations.attention.length} 个运行要处理`
      : down ? `${down} 个后端不可用`
        : tool.backends?.length ? `${tool.backends.length} 个后端`
          : `${counts.running + counts.queued} 个进行中`;
  return <li className="flex items-center gap-3 px-5 py-3" data-open-tool={tool.tool}>
    <Dot tone={tone} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-body-sm font-medium text-ink">{tool.label}</span>
      <span className="block truncate text-2xs text-muted">开放工具{tool.freshness === "stale" ? ` · 显示 ${formatRelative(tool.observed_at)} 的读数` : ""}</span>
    </span>
    <span className="shrink-0 text-right text-2xs text-muted">
      <span className={cx("block font-medium", stateText[tone] || "text-muted")}>{openToolStateLabels[tool.state]}</span>
      <span className="tabular">{summary}</span>
    </span>
  </li>;
}

const countText = (value: number | null) => value === null ? "—" : value.toLocaleString("zh-CN");
const dateText = (now: Date) => `${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()]} · ${now.getMonth() + 1} 月 ${now.getDate()} 日`;

/** A section heading in the creative half of the page: a small label, then one serif sentence. */
function SectionHead({ id, label, title, action }: { id: string; label: string; title: ReactNode; action?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
    <div className="min-w-0">
      <p className="text-2xs font-medium tracking-[0.12em] text-muted">{label}</p>
      <h2 id={id} className="mt-1 font-display text-[22px] font-semibold leading-tight text-ink text-pretty">{title}</h2>
    </div>
    {action}
  </div>;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { session, scope, scopeId } = useWorkspace();
  const tasks = useTasks();
  const reminders = useNotifications();
  const usage = useScopedRead((scopeId, signal) => api.usage(scopeId, signal), { cacheKey: "usage" });
  const services = useScopedRead((scopeId, signal) => api.services(scopeId, signal), { cacheKey: "services" });
  const queue = useScopedRead((scopeId, signal) => api.workQueue(scopeId, {}, undefined, 50, signal), { cacheKey: "work-queue", poll: (data) => data ? 30_000 : 15_000 });
  // Only titles and rails for the hero: three recent episodes, from the server's cached read.
  const episodes = useScopedRead((scopeId, signal) => api.dramaEpisodes(scopeId, { limit: 3, order: "recent" }, signal), { cacheKey: "drama-episodes:recent:3" });
  const openTools = (services.data?.services || []).flatMap((service) => service.open_tool ? [service.open_tool] : []);
  const [params] = useSearchParams();
  const [, writeOverlay] = useOverlayParams(workOverlays);
  const [queueKind, setQueueKind] = useState<QueueFilter>("all");
  const [brief, setBrief] = useState<AgentBrief | null>(null);
  const [inspectorMode, setInspectorMode] = useInspectorMode();

  const now = useMemo(() => new Date(), [tasks.rows]);
  const active = useMemo(() => tasks.rows.filter(taskInProgress), [tasks.rows]);
  const attention = useMemo(() => reminders.rows.filter((item) => countsAsHomeAttention(item, reminders.now)), [reminders.rows, reminders.now]);
  const episodeRows = useMemo(() => (episodes.data && "rows" in episodes.data ? episodes.data.rows : []), [episodes.data]);
  const focus = useMemo(() => pickFocus({ scopeLabel: scope?.label || "这个项目", episodes: episodeRows, tasks: tasks.rows }), [episodeRows, scope?.label, tasks.rows]);
  const cover = useMemo(() => pickCover(tasks.rows, focus.kind === "episode" ? [focus.episode_ref || "", focus.scaena_episode_ref || ""] : undefined), [focus, tasks.rows]);
  const outputs = useMemo(() => pickOutputs(tasks.rows, now), [tasks.rows, now]);
  const ready = tasks.connections.filter((connection) => connection.state === "ready").length;
  const loading = tasks.status === "loading";
  const taskSourceDown = tasks.rows.length === 0 && tasks.connections.length === 0 && sourceDownStatuses.includes(tasks.status);

  const selectedWorkRef = params.get("work_item");
  const selectedWork = queue.data?.items.find((item) => item.work_ref === selectedWorkRef) || null;
  const decisions = pickDecisions(queue.data?.items || []);
  const visibleQueue = (queue.data?.items || []).filter((item) => matchesWorkQueueFilters(item, queueKind === "all" ? {} : { kind: queueKind }));
  const queueCounts = queue.data?.counts;
  const taskByRef = useMemo(() => new Map(tasks.rows.map((task) => [task.locator.task_ref, task])), [tasks.rows]);

  const selectWork = (workRef: string) => {
    const next = new URLSearchParams(params);
    next.set("work_item", workRef);
    writeOverlay(next);
  };
  const closeWork = () => {
    const next = new URLSearchParams(params);
    next.delete("work_item");
    writeOverlay(next);
  };
  const handOff = (item: WorkQueueItem) => setBrief(buildAgentBrief({ kind: "work_item", item, returnTo: `#/?work_item=${encodeURIComponent(item.work_ref)}` }));

  return <div className={cx("page-enter", selectedWork && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="home">
    <div className="@container mx-auto max-w-[1360px] space-y-10">
      <TodayHero focus={focus} cover={cover} name={session?.name || "你"} now={now} loading={loading && !tasks.rows.length} onContinue={() => navigate(focus.target)} onOutputs={() => document.getElementById("today-outputs")?.scrollIntoView({ block: "start", behavior: scrollBehavior() })} />

      <NoticeStack notices={[<SourceStatusLine key="source" noun="今天" partial={false} />]} />

      <section aria-labelledby="today-decisions" className="rise" style={{ "--i": 1 } as React.CSSProperties}>
        <SectionHead id="today-decisions" label="等你决定" title={decisions.length ? `${decisions.length === 1 ? "一件事" : `${decisions.length} 件事`}，决定接下来怎么走` : "没有在等你决定的事"} action={queueCounts && queueCounts.total > decisions.length ? <Button size="sm" variant="ghost" onClick={() => document.getElementById("home-work-queue")?.scrollIntoView({ block: "start", behavior: scrollBehavior() })}>全部 {queueCounts.total} 件<ArrowRight className="size-3.5" /></Button> : undefined} />
        {queue.status === "loading" && !queue.data ? <div className="grid gap-4 @3xl:grid-cols-3">{[0, 1, 2].map((index) => <div key={index} className="skeleton h-36 rounded-tile" />)}</div>
          : decisions.length ? <ul className="grid gap-4 @3xl:grid-cols-3">
            {decisions.map((item) => <DecisionCard key={item.work_ref} item={item} task={item.task_ref ? taskByRef.get(item.task_ref) : undefined} onOpen={() => selectWork(item.work_ref)} onHandOff={() => handOff(item)} />)}
          </ul>
            : <p className="rounded-tile border border-dashed border-line px-5 py-6 text-body-sm text-muted">{queue.status !== "ready" && queue.status !== "empty" ? "队列暂时读不到，下面的「全部待办」会说明原因。" : "没有要挑的结果、要回查的任务或可以交接的阶段。"}</p>}
      </section>

      <section aria-labelledby="today-running" className="rise" style={{ "--i": 2 } as React.CSSProperties}>
        <SectionHead id="today-running" label="正在片场" title={active.length ? "它们会自己跑完" : loading ? "正在读取…" : "现在没有在跑的任务"} action={active.length > 3 ? <Button size="sm" variant="ghost" onClick={() => navigate("/tasks?view=active")}>全部 {active.length}<ArrowRight className="size-3.5" /></Button> : undefined} />
        {loading && !tasks.rows.length ? <div className="grid gap-4 @3xl:grid-cols-3">{[0, 1, 2].map((index) => <div key={index} className="skeleton h-28 rounded-tile" />)}</div>
          : active.length ? <ul className="grid gap-4 @3xl:grid-cols-3">{active.slice(0, 3).map((task) => <RunningCard key={task.task_key} task={task} onOpen={() => navigate(`/tasks?task=${encodeURIComponent(task.task_key || "")}`)} />)}</ul> : null}
      </section>

      <section id="today-outputs" aria-labelledby="today-outputs-title" className="scroll-mt-20 rise" style={{ "--i": 3 } as React.CSSProperties}>
        <SectionHead id="today-outputs-title" label={outputs.label} title={outputs.entries.length ? (outputs.label === "今天的产出" ? "今天做出来的" : "最近做出来的") : "还没有可以看的结果"} action={<Button size="sm" variant="ghost" onClick={() => navigate("/assets")}>全部作品<ArrowRight className="size-3.5" /></Button>} />
        {loading && !tasks.rows.length ? <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton aspect-[4/3] rounded-tile" />)}</div>
          : outputs.entries.length ? <ul className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
            {outputs.entries.map((entry) => <li key={entry.key} className="min-w-0">
              <button type="button" onClick={() => navigate(`/assets?result=${encodeURIComponent(entry.key)}`)} className="group block w-full text-left">
                <span className="relative block aspect-[4/3] overflow-hidden rounded-tile border border-line bg-panel-sunken shadow-card">
                  <TaskThumbnail task={entry.task} result={entry.result} frameless className="transition-transform duration-500 ease-out group-hover:scale-[1.03]" fallback={<KindBadge kind={entry.kind} />} />
                  <span className="absolute left-2.5 top-2.5"><KindBadge kind={entry.kind} size="sm" /></span>
                </span>
                <span className="mt-2 block truncate text-body-sm font-medium text-ink">{resultName(entry)}</span>
                <span className="block truncate text-2xs text-muted">{[ownerLabel(entry.task.locator.owner), ...resultMeta(entry.result).slice(0, 2)].join(" · ")}</span>
              </button>
            </li>)}
          </ul> : <EmptyState compact icon={<Images />} title="还没有已完成的结果" body="任务跑完、结果可读之后会出现在这里。" />}
      </section>

      <Panel id="home-work-queue" className="scroll-mt-20" eyebrow="全部待办" title="工作队列" actions={<>
        {queueCounts && <span className="hidden text-2xs text-muted tabular sm:inline">共 {queueCounts.total} 项</span>}
        <ToggleGroup label="工作队列筛选" value={queueKind} onChange={setQueueKind} options={queueFilters} />
      </>} bodyClassName="p-0">
        <ReadStateView status={queue.status === "empty" ? "ready" : queue.status} error={queue.error} onRetry={queue.reload} skeleton={<SkeletonRows rows={5} />}>
          {visibleQueue.length === 0 ? <EmptyState compact icon={<ShieldQuestion />} title={queueKind === "all" ? "现在没有待办" : "这一类没有待办"} body={queueKind === "all" ? "没有读不到的连接、结果未知的任务、等你确认的阶段或可以交接的内容。" : "切换到「全部」看看其他类型。"} /> : <>
            <ul className="divide-y divide-line" data-work-queue-count={visibleQueue.length}>
              {visibleQueue.slice(0, queueLimit).map((item) => <QueueRow key={item.work_ref} item={item} selected={item.work_ref === selectedWorkRef} onSelect={() => selectWork(item.work_ref)} />)}
            </ul>
            {visibleQueue.length > queueLimit && <p className="border-t border-line px-5 py-2.5 text-2xs text-muted">已显示前 {queueLimit} 项，共 {visibleQueue.length} 项。</p>}
          </>}
        </ReadStateView>
      </Panel>

      <section aria-labelledby="today-system" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-2xs font-medium tracking-[0.12em] text-muted">系统</p>
            <h2 id="today-system" className="mt-1 text-title font-semibold text-ink">工具和连接</h2>
          </div>
          <p className="text-2xs text-muted">只在读不到或要处理时才需要看这里。</p>
        </div>
        <div className="grid items-start gap-5 @4xl:grid-cols-3">
          <Panel title="需要处理" actions={attention.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate("/reminders")}>全部 {attention.length}<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
            <ReadStateView status={reminders.status === "unavailable" && attention.length === 0 ? "unavailable" : (tasks.status === "loading" || reminders.status === "idle" || reminders.syncing) && attention.length === 0 ? "loading" : "ready"} error={reminders.error || tasks.error} onRetry={() => { tasks.refresh(); reminders.refresh(); }} skeleton={<SkeletonRows rows={4} />}>
              {attention.length === 0 ? <EmptyState compact icon={<ShieldQuestion />} title="没有未确认的失败提醒" body="同一失败只提醒一次。已确认、免提醒和归档的记录留在提醒里。" /> : <ul className="divide-y divide-line" data-home-attention={attention.length}>
                {attention.slice(0, 5).map((item) => <li key={item.id}>
                  <button type="button" onClick={() => navigate(`/reminders?focus=${encodeURIComponent(item.id)}`)} className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-panel-soft">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-ink">{item.title || item.task_key}</span>
                      <span className="block line-clamp-2 text-2xs text-muted">{ownerLabel(item.owner)} · {taskStateLabels[item.task_state] || item.task_state} · {reminderStateLabels[item.state]} · {formatRelative(item.first_seen_at)}</span>
                    </span>
                    <TaskStatePill state={item.task_state} />
                  </button>
                </li>)}
              </ul>}
            </ReadStateView>
          </Panel>

          <Panel title="服务状态" actions={<Button size="sm" variant="ghost" onClick={() => navigate("/services")}>连接<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
            {loading && !tasks.connections.length && !openTools.length ? <SkeletonRows rows={3} /> : tasks.connections.length || openTools.length ? <ul className="divide-y divide-line">
              {openTools.map((tool) => <OpenToolRow key={tool.tool} tool={tool} />)}
              {tasks.connections.map((connection) => {
                const count = tasks.rows.filter((task) => task.connection_id === connection.id).length;
                const tone = connectionTone(connection.state);
                return <li key={connection.id} className="flex items-center gap-3 px-5 py-3">
                  <Dot tone={tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-ink">{connection.label}</span>
                    <span className="block truncate text-2xs text-muted" title={connection.project}>{ownerLabel(connection.owner)} · {connection.project}</span>
                  </span>
                  <span className="shrink-0 text-right text-2xs text-muted">
                    <span className={cx("block font-medium", stateText[tone])}>{connectionStateLabel(connection.state)}</span>
                    <span className="tabular">{connection.state === "ready" ? `${count} 个任务` : "—"}</span>
                  </span>
                </li>;
              })}
            </ul> : <EmptyState compact icon={<ServerCog />} title={taskSourceDown ? "任务连接读不到" : "没有任务连接"} body={taskSourceDown ? "读取失败，不显示推断的连接状态。" : "这个范围还没有接上任何工具。"} />}
          </Panel>

          <UsageGlance usage={usage} onOpen={() => navigate("/usage")} />
        </div>
        <SourceCoverage services={services.data?.services || []} connections={tasks.connections} />
      </section>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-2xs text-muted" aria-label="状态线">
        <Button size="sm" variant="ghost" onClick={() => navigate("/services")} icon={<Dot tone={!tasks.connections.length ? "neutral" : ready === tasks.connections.length ? "success" : "warning"} />}>
          可读连接 {loading ? "…" : taskSourceDown ? "—" : tasks.connections.length ? `${ready}/${tasks.connections.length}` : "0"}
        </Button>
        <span className="tabular">待办 {queue.status === "loading" ? "…" : countText(queueCounts?.actionable ?? null)}</span>
        <span>{tasks.observedAt ? `观察于 ${formatRelative(tasks.observedAt)}` : "尚未完成观察"}</span>
        <span className="ml-auto">{scopeId ? `范围 ${scope?.label || scopeId}` : ""}</span>
      </footer>
    </div>

    {selectedWork && <WorkQueueInspector item={selectedWork} open mode={inspectorMode} onModeChange={setInspectorMode} onClose={closeWork} onNavigate={(target) => navigate(target)} onHandOff={handOff} />}
    <HandoffSheet brief={brief} open={!!brief} onOpenChange={(open) => { if (!open) setBrief(null); }} />
  </div>;
}

/** The one thing to continue: a real cover when there is one, type on a quiet gradient when there is not. */
function TodayHero({ focus, cover, name, now, loading, onContinue, onOutputs }: { focus: ReturnType<typeof pickFocus>; cover: ReturnType<typeof pickCover>; name: string; now: Date; loading: boolean; onContinue: () => void; onOutputs: () => void }) {
  return <section aria-labelledby="today-title" className="relative isolate overflow-hidden rounded-hero bg-surface-hero text-hero-ink shadow-hero rise">
    <div aria-hidden="true" className="absolute inset-0 -z-10">
      {cover
        ? <TaskThumbnail task={cover.task} result={cover.result} frameless alt="" className="ken-burns" fallback={<span className="cover-type size-full" />} />
        : <span className="cover-type block size-full" />}
      <span className="hero-scrim absolute inset-0" />
    </div>
    <div className="flex min-h-[340px] flex-col justify-between gap-8 p-6 sm:p-9 lg:min-h-[400px] lg:p-11">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex max-w-full items-center gap-2 rounded-full bg-black/25 px-3 py-1.5 text-2xs font-medium tracking-[0.08em] text-hero-ink/90 backdrop-blur-sm">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-lime" />
          <span className="truncate">{focus.eyebrow}</span>
        </p>
        <p className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-2xs text-hero-ink/85 backdrop-blur-sm"><CalendarDays aria-hidden="true" className="size-3.5" />{dateText(now)}</p>
      </div>
      <div className="max-w-2xl">
        <p className="text-body-sm text-hero-ink/80">{greeting(now)}，{name}</p>
        <h1 id="today-title" className="mt-2 font-display text-hero font-semibold tracking-[0.005em] text-pretty">{loading ? "正在读取今天的进度…" : focus.headline}</h1>
        <p className="mt-3 text-body-sm text-hero-ink/80 tabular">{loading ? "稍等一下" : focus.detail}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" onClick={onContinue} className="inline-flex h-12 items-center gap-2 rounded-full bg-lime px-6 text-[15px] font-semibold text-lime-ink shadow-[0_14px_34px_-14px_var(--lime)] transition-transform duration-150 hover:-translate-y-px active:scale-[0.98]">{focus.action}<ArrowRight className="size-4" /></button>
          <button type="button" onClick={onOutputs} className="inline-flex h-12 items-center rounded-full border border-white/25 bg-black/20 px-5 text-[15px] font-medium text-hero-ink backdrop-blur-sm transition-colors hover:bg-black/35">看看产出</button>
        </div>
      </div>
    </div>
  </section>;
}

function DecisionCard({ item, task, onOpen, onHandOff }: { item: WorkQueueItem; task?: TaskSnapshot; onOpen: () => void; onHandOff: () => void }) {
  const copy = decisionCopy[item.kind] || { verb: workQueueKindLabels[item.kind], tone: "warning" as const, action: "看看" };
  const result = task?.results.find((entry) => entry.mime?.startsWith("image/") || entry.mime?.startsWith("video/"));
  return <li className="min-w-0" data-decision={item.kind}>
    <article className="flex h-full gap-4 rounded-tile border border-line bg-panel p-4 shadow-card transition-colors hover:border-line-strong">
      <span className="relative size-20 shrink-0 overflow-hidden rounded-[14px] border border-line bg-panel-sunken">
        {task && result ? <TaskThumbnail task={task} result={result} frameless alt="" fallback={<span className="grid size-full place-items-center text-muted [&>svg]:size-6">{queueKindIcons[item.kind]}</span>} />
          : <span className="grid size-full place-items-center text-muted [&>svg]:size-6">{queueKindIcons[item.kind]}</span>}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx("inline-flex items-center gap-1.5 text-2xs font-semibold", toneText[copy.tone])}><span aria-hidden="true" className={cx("size-1.5 rounded-full", toneDot[copy.tone])} />{copy.verb}</span>
        <span className="mt-1 line-clamp-2 text-title-sm font-semibold text-ink">{item.title}</span>
        <span className="mt-1 line-clamp-2 text-2xs text-muted">{workQueueOwnerLabel(item.owner)} · {workQueueReasonLabel(item.attention_reason, item.kind)}</span>
        <span className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <Button size="sm" variant="primary" onClick={onOpen}>{copy.action}</Button>
          <Button size="sm" variant="ghost" icon={<Bot className="size-3.5" />} onClick={onHandOff}>交给 Agent</Button>
        </span>
      </span>
    </article>
  </li>;
}

function RunningCard({ task, onOpen }: { task: TaskSnapshot; onOpen: () => void }) {
  const progress = task.progress;
  const percent = progress.kind === "percent" ? progress.percent : progress.kind === "count" && progress.total ? ((progress.completed ?? 0) / progress.total) * 100 : null;
  return <li className="min-w-0">
    <button type="button" onClick={onOpen} className="flex h-full w-full flex-col gap-3 rounded-tile border border-line bg-panel p-4 text-left shadow-card transition-colors hover:border-line-strong">
      <span className="flex items-center gap-2.5">
        <KindBadge kind={taskKind(task)} size="sm" />
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ink">{task.title}</span>
      </span>
      <span className="flex items-center justify-between gap-3 text-2xs text-muted"><span className="truncate">{ownerLabel(task.locator.owner)} · {taskStateLabels[task.state] || task.state}</span><span className="shrink-0 tabular">{progressLabel(progress)}</span></span>
      {percent !== null ? <Progress value={percent} label={`${task.title} 进度`} /> : <span aria-hidden="true" className="h-1.5 rounded-full bg-panel-sunken" />}
    </button>
  </li>;
}

function QueueRow({ item, selected, onSelect }: { item: WorkQueueItem; selected: boolean; onSelect: () => void }) {
  const critical = item.priority === "critical";
  const high = item.priority === "high";
  return <li data-work-kind={item.kind}>
    <button type="button" aria-current={selected || undefined} onClick={onSelect} className={cx("group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-panel-soft", selected && "bg-primary-soft/50 hover:bg-primary-soft/60")}>
      <span aria-hidden="true" className={cx("grid size-8 shrink-0 place-items-center rounded-full [&>svg]:size-4", critical ? "bg-danger-soft text-danger" : high ? "bg-warning-soft text-warning" : "bg-panel-sunken text-ink-soft")}>{queueKindIcons[item.kind]}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-ink">{item.title}</span>
        <span className="block truncate text-2xs text-muted">
          {(critical || high) && <><span className={cx("font-semibold", critical ? "text-danger" : "text-warning")}>{workQueuePriorityLabels[item.priority]}</span> · </>}
          <span className="font-medium text-ink-soft">{workQueueKindLabels[item.kind]}</span> · {workQueueOwnerLabel(item.owner)} · {workQueueReasonLabel(item.attention_reason, item.kind)} · {formatRelative(item.observed_at)}
        </span>
      </span>
      <WorkStatePill state={item.state} kind={item.kind} />
    </button>
  </li>;
}

function UsageGlance({ usage, onOpen }: { usage: ScopedRead<UsageProjection>; onOpen: () => void }) {
  const budget = usage.data?.budget;
  const rows = usage.data?.rows || [];
  const confirmed = rows.filter((row) => row.cost_state === "confirmed" && row.upstream_cost !== null);
  const byCurrency = confirmed.reduce<Record<string, number>>((sum, row) => ({ ...sum, [row.currency]: (sum[row.currency] || 0) + (row.upstream_cost || 0) }), {});
  const ratio = budget && budget.total > 0 ? Math.min(100, (budget.reserved / budget.total) * 100) : null;
  return <Panel title="用量与预算" actions={<Button size="sm" variant="ghost" onClick={onOpen}>详情<ArrowRight className="size-3.5" /></Button>}>
    <ReadStateView status={usage.status === "empty" ? "ready" : usage.status} error={usage.error} onRetry={usage.reload} skeleton={<SkeletonRows rows={2} />}>
      <div className="space-y-4 p-5">
        <div>
          <span className="text-2xs text-muted">已确认的花费</span>
          <p className="tabular mt-0.5 text-title font-semibold text-ink">{Object.keys(byCurrency).length ? Object.entries(byCurrency).map(([currency, amount]) => formatMoney(amount, currency)).join(" · ") : <span className="text-body-sm font-normal text-faint">还没有确认的花费</span>}</p>
        </div>
        {budget ? <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-2xs text-muted"><span>预算（只观察，不拦截调用）</span><span className="tabular">已预留 {formatMoney(budget.reserved, "CNY")} / {formatMoney(budget.total, "CNY")}</span></div>
          <Progress value={ratio} label="预算已预留" tone={ratio !== null && ratio > 85 ? "danger" : ratio !== null && ratio > 60 ? "warning" : "neutral"} />
        </div> : <p className="text-2xs text-muted">还没有预算记录。</p>}
        <p className="flex items-center gap-1.5 text-2xs text-faint"><Wallet className="size-3.5 shrink-0" />{rows.length} 条用量回执</p>
      </div>
    </ReadStateView>
  </Panel>;
}
