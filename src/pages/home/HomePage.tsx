import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Activity, ArrowRight, CircleAlert, CircleHelp, ClipboardCheck, Clock3, Eye, Images, ListTodo, Plug, Route, ScrollText, ServerCog, ShieldQuestion, Unplug, Wallet } from "../../icons";
import { api, type UsageProjection } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace, type ScopedRead } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { Button, Dot, EmptyState, KindBadge, Panel, Progress, ReadStateView, SkeletonRows, StaleNotice, StatCard, TaskStatePill, ToggleGroup, cx, ownerLabel, type Tone } from "../../components/ui";
import { formatMoney, formatRelative } from "../../shared/read-model/format";
import { collectResults, connectionStateLabel, connectionTone, resultMeta, taskInProgress, taskKind } from "../../shared/read-model/tasks";
import { progressLabel, taskIsActive, taskStateLabels } from "../../task-observation";
import { useNotifications } from "../../app/notifications-context";
import { countsAsHomeAttention, reminderStateLabels } from "../../notifications";
import { SourceCoverage } from "../../components/SourceCoverage";
import { WorkQueueInspector, WorkStatePill, workQueueKindLabels, workQueueOwnerLabel, workQueuePriorityLabels, workQueueReasonLabel } from "./WorkQueueInspector";
import type { WorkQueueItem, WorkQueueKind } from "../../shared/work-queue";
import { matchesWorkQueueFilters } from "../../shared/work-queue";
import type { TaskInspectorMode } from "../tasks/TaskDetail";

type QueueFilter = "all" | "review_required" | "handoff_ready" | "service_blocked";
const queueFilters: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "review_required", label: "待审阅" },
  { id: "handoff_ready", label: "交接" },
  { id: "service_blocked", label: "阻塞" },
];
const queueLimit = 8;
const queueKindIcons: Record<WorkQueueKind, ReactNode> = {
  task_failure: <CircleAlert />,
  task_unknown: <CircleHelp />,
  review_required: <ClipboardCheck />,
  handoff_ready: <Route />,
  service_blocked: <Unplug />,
  contract_gap: <Plug />,
};
const stateText: Record<string, string> = { success: "text-success", danger: "text-danger", warning: "text-warning", neutral: "text-muted" };
const sourceDownStatuses = ["forbidden", "unavailable", "unknown", "needs_contract", "login_required"];

function greeting() {
  const hour = new Date().getHours();
  return hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
}

const countText = (value: number | null) => value === null ? "—" : value.toLocaleString("zh-CN");

export default function HomePage() {
  const navigate = useNavigate();
  const { session, scope } = useWorkspace();
  const tasks = useTasks();
  const reminders = useNotifications();
  const usage = useScopedRead((scopeId, signal) => api.usage(scopeId, signal));
  const services = useScopedRead((scopeId, signal) => api.services(scopeId, signal));
  const queue = useScopedRead((scopeId, signal) => api.workQueue(scopeId, {}, undefined, 50, signal), { poll: (data) => data ? 30_000 : 15_000 });
  const [params, setParams] = useSearchParams();
  const [queueKind, setQueueKind] = useState<QueueFilter>("all");
  const [inspectorMode, setInspectorMode] = useState<TaskInspectorMode>(() => typeof window !== "undefined" && window.localStorage.getItem("yeisme.control.tasks.inspector-mode") === "floating" ? "floating" : "fixed");

  const active = useMemo(() => tasks.rows.filter(taskInProgress), [tasks.rows]);
  const attention = useMemo(() => reminders.rows.filter((item) => countsAsHomeAttention(item)), [reminders.rows]);
  const unknown = attention.filter((item) => item.task_state === "unknown").length;
  const results = useMemo(() => collectResults(tasks.rows.filter((task) => !taskIsActive(task))).slice(0, 6), [tasks.rows]);
  const observedCount = useMemo(() => tasks.rows.reduce((sum, task) => sum + task.results.length, 0), [tasks.rows]);
  const ready = tasks.connections.filter((connection) => connection.state === "ready").length;
  const loading = tasks.status === "loading";
  const taskSourceDown = tasks.rows.length === 0 && tasks.connections.length === 0 && sourceDownStatuses.includes(tasks.status);

  const selectedWorkRef = params.get("work_item");
  const selectedWork = queue.data?.items.find((item) => item.work_ref === selectedWorkRef) || null;
  const visibleQueue = (queue.data?.items || []).filter((item) => matchesWorkQueueFilters(item, queueKind === "all" ? {} : { kind: queueKind }));
  const queueCounts = queue.data?.counts;
  const queueLoading = queue.status === "loading";
  const queueHint = (text: string) => queueCounts ? text : "队列来源未返回";
  const taskHint = (text: string) => taskSourceDown ? "任务来源未返回" : text;
  const skeleton = <span aria-hidden="true" className="skeleton inline-block h-6 w-12 align-middle" />;
  const queueValue = (value: number | null | undefined): ReactNode => queueLoading ? skeleton : countText(value ?? null);
  const taskValue = (value: number): ReactNode => loading ? skeleton : taskSourceDown ? "—" : countText(value);
  const problem = (value: number | null | undefined, tone: Tone): Tone => value ? tone : "neutral";
  const unknownCount = queueCounts?.unknown ?? (reminders.status === "idle" ? null : unknown);

  const focusQueue = () => {
    setQueueKind("all");
    document.getElementById("home-work-queue")?.scrollIntoView({ block: "start" });
  };
  const selectWork = (workRef: string) => {
    const next = new URLSearchParams(params);
    next.set("work_item", workRef);
    setParams(next);
  };

  const tiles: { label: string; value: ReactNode; hint: string; icon: ReactNode; tone: Tone; onClick: () => void }[] = [
    { label: "待处理", value: queueValue(queueCounts?.actionable), hint: queueHint("仍需判断的事项"), icon: <CircleAlert />, tone: problem(queueCounts?.actionable, "warning"), onClick: focusQueue },
    { label: "进行中任务", value: taskValue(active.length), hint: taskHint("排队与执行中"), icon: <Activity />, tone: problem(active.length, "info"), onClick: () => navigate("/tasks?view=active") },
    { label: "待审阅", value: queueValue(queueCounts?.review_required), hint: queueHint("owner 声明需审阅"), icon: <ClipboardCheck />, tone: problem(queueCounts?.review_required, "review"), onClick: () => navigate("/review") },
    { label: "未知 / 回查", value: queueLoading ? skeleton : countText(unknownCount), hint: queueCounts || unknownCount !== null ? "只回查，不重试" : "来源未返回", icon: <CircleHelp />, tone: problem(unknownCount, "warning"), onClick: () => navigate("/tasks") },
    { label: "来源过期", value: queueValue(queueCounts?.stale), hint: queueHint("需刷新来源证据"), icon: <Clock3 />, tone: problem(queueCounts?.stale, "warning"), onClick: () => navigate("/services") },
    { label: "已观察结果", value: taskValue(observedCount), hint: taskHint("当前批次的任务产出"), icon: <Images />, tone: "neutral", onClick: () => navigate("/assets") },
    { label: "可读连接", value: loading ? skeleton : taskSourceDown ? "—" : tasks.connections.length ? `${ready}/${tasks.connections.length}` : "0", hint: taskHint("任务观测连接"), icon: <Plug />, tone: !tasks.connections.length ? "neutral" : ready === tasks.connections.length ? "success" : "warning", onClick: () => navigate("/services") },
  ];

  return <div className={cx("page-enter", selectedWork && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="home">
    <div className="@container space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-body-sm text-muted">{scope?.label || "授权范围"}</p>
          <h1 className="mt-1 text-display font-semibold tracking-[-0.01em]">{greeting()}，{session?.name || "你"}</h1>
          <p className="mt-1.5 text-body-sm text-muted">这里只汇总 owner 返回的真实只读事实，缺失的数据保持未知。</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => navigate("/requests")} icon={<ScrollText className="size-3.5" />}>请求记录</Button>
          <Button size="sm" variant="primary" onClick={() => navigate("/tasks")} icon={<ListTodo className="size-3.5" />}>任务中心</Button>
        </div>
      </header>

      <StaleNotice status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} onRetry={tasks.refresh} />

      <section aria-label="概览" className="grid grid-cols-2 gap-3 @xl:grid-cols-12">
        {tiles.map((tile, index) => <div key={tile.label} className={cx("stagger-in min-w-0", index < 4 ? "@xl:col-span-3" : "@xl:col-span-4", index === tiles.length - 1 && "@max-xl:col-span-2")} style={{ "--i": index } as React.CSSProperties}>
          <StatCard className="h-full w-full" label={tile.label} value={tile.value} hint={tile.hint} icon={tile.icon} tone={tile.tone} onClick={tile.onClick} />
        </div>)}
      </section>

      <div className="grid items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="min-w-0 space-y-5">
          <Panel id="home-work-queue" className="scroll-mt-20" title="工作队列" actions={<>
            {queueCounts && <span className="hidden text-2xs text-muted tabular sm:inline">共 {queueCounts.total} 项</span>}
            <ToggleGroup label="工作队列筛选" value={queueKind} onChange={setQueueKind} options={queueFilters} />
          </>} bodyClassName="p-0">
            <ReadStateView status={queue.status === "empty" ? "ready" : queue.status} error={queue.error} onRetry={queue.reload} skeleton={<SkeletonRows rows={5} />}>
              {visibleQueue.length === 0 ? <EmptyState compact icon={<ShieldQuestion />} title={queueKind === "all" ? "当前没有需要处理的工作项" : "该筛选下没有工作项"} body={queueKind === "all" ? "来源没有返回阻塞、未知、待审阅或交接事项。" : "切换到“全部”查看其他类型的工作项。"} /> : <>
                <ul className="divide-y divide-line" data-work-queue-count={visibleQueue.length}>
                  {visibleQueue.slice(0, queueLimit).map((item) => <QueueRow key={item.work_ref} item={item} selected={item.work_ref === selectedWorkRef} onSelect={() => selectWork(item.work_ref)} />)}
                </ul>
                {visibleQueue.length > queueLimit && <p className="border-t border-line px-5 py-2.5 text-2xs text-muted">已显示前 {queueLimit} 项，共 {visibleQueue.length} 项。</p>}
              </>}
            </ReadStateView>
          </Panel>

          <Panel title="进行中" actions={active.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate("/tasks?view=active")}>全部 {active.length}<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
            {loading ? <SkeletonRows rows={3} /> : active.length === 0 ? <EmptyState compact icon={<Activity />} title="没有进行中的任务" /> : <ul className="divide-y divide-line">
              {active.slice(0, 4).map((task) => {
                const progress = task.progress;
                const percent = progress.kind === "percent" ? progress.percent : progress.kind === "count" && progress.total ? ((progress.completed ?? 0) / progress.total) * 100 : null;
                return <li key={task.task_key}>
                  <button type="button" onClick={() => navigate(`/tasks?task=${encodeURIComponent(task.task_key || "")}`)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-panel-soft">
                    <KindBadge kind={taskKind(task)} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-3"><span className="truncate text-body-sm font-medium text-ink">{task.title}</span><span className="shrink-0 text-2xs text-muted tabular">{progressLabel(progress)}</span></span>
                      {percent !== null && <Progress className="mt-1.5" value={percent} label={`${task.title} 进度`} />}
                    </span>
                  </button>
                </li>;
              })}
            </ul>}
          </Panel>

          <Panel title="最近结果" actions={<Button size="sm" variant="ghost" onClick={() => navigate("/assets")}>资源库<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
            {loading ? <SkeletonRows rows={2} /> : results.length === 0 ? <EmptyState compact icon={<Images />} title="当前批次没有已结束任务的结果" /> : <ul className="grid gap-2 p-3 @2xl:grid-cols-2">
              {results.map((entry) => <li key={entry.key} className="min-w-0">
                <button type="button" onClick={() => navigate(`/assets?result=${encodeURIComponent(entry.key)}`)} className="flex w-full items-center gap-3 rounded-control border border-line bg-panel-soft px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-panel">
                  <KindBadge kind={entry.kind} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-ink">{entry.result.name || "未命名结果"}</span>
                    <span className="block truncate text-2xs text-muted">{ownerLabel(entry.task.locator.owner)} · {resultMeta(entry.result).slice(0, 2).join(" · ") || "规格未提供"}</span>
                  </span>
                  <Eye aria-hidden="true" className="size-4 shrink-0 text-faint" />
                </button>
              </li>)}
            </ul>}
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel title="需要处理" actions={attention.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate("/reminders")}>全部 {attention.length}<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
            <ReadStateView status={reminders.status === "unavailable" && attention.length === 0 ? "unavailable" : (tasks.status === "loading" || reminders.status === "idle" || reminders.syncing) && attention.length === 0 ? "loading" : "ready"} error={reminders.error || tasks.error} onRetry={() => { tasks.refresh(); reminders.refresh(); }} skeleton={<SkeletonRows rows={4} />}>
              {attention.length === 0 ? <EmptyState compact icon={<ShieldQuestion />} title="没有未确认的失败提醒" body="同一失败只提醒一次。已确认、免提醒和归档的记录留在提醒中心。" /> : <ul className="divide-y divide-line" data-home-attention={attention.length}>
                {attention.slice(0, 5).map((item) => <li key={item.id}>
                  <button type="button" onClick={() => navigate(`/reminders?focus=${encodeURIComponent(item.id)}`)} className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-panel-soft">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-ink">{item.title || item.task_key}</span>
                      <span className="block line-clamp-2 text-2xs text-muted">{ownerLabel(item.owner)} · {item.project} · {taskStateLabels[item.task_state] || item.task_state} · {reminderStateLabels[item.state]} · {formatRelative(item.first_seen_at)}</span>
                    </span>
                    <TaskStatePill state={item.task_state} />
                  </button>
                </li>)}
              </ul>}
            </ReadStateView>
          </Panel>

          <Panel title="服务状态" actions={<Button size="sm" variant="ghost" onClick={() => navigate("/services")}>服务与连接<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
            {loading && !tasks.connections.length ? <SkeletonRows rows={3} /> : tasks.connections.length ? <ul className="divide-y divide-line">
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
            </ul> : <EmptyState compact icon={<ServerCog />} title={taskSourceDown ? "任务连接来源未返回" : "没有任务连接"} body={taskSourceDown ? "读取失败，不显示推断的连接状态。" : "当前范围没有配置 owner 观测连接。"} />}
          </Panel>

          <UsageGlance usage={usage} onOpen={() => navigate("/usage")} />
        </div>
      </div>

      <SourceCoverage services={services.data?.services || []} connections={tasks.connections} />
    </div>

    {selectedWork && <WorkQueueInspector item={selectedWork} open mode={inspectorMode} onModeChange={(mode) => { setInspectorMode(mode); window.localStorage.setItem("yeisme.control.tasks.inspector-mode", mode); }} onClose={() => { const next = new URLSearchParams(params); next.delete("work_item"); setParams(next); }} onNavigate={(target) => { const next = new URLSearchParams(params); next.delete("work_item"); setParams(next); navigate(target); }} />}
  </div>;
}

function QueueRow({ item, selected, onSelect }: { item: WorkQueueItem; selected: boolean; onSelect: () => void }) {
  const critical = item.priority === "critical";
  const high = item.priority === "high";
  return <li>
    <button type="button" aria-current={selected || undefined} onClick={onSelect} className={cx("group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-panel-soft", selected && "bg-primary-soft/50 hover:bg-primary-soft/60")}>
      <span aria-hidden="true" className={cx("grid size-8 shrink-0 place-items-center rounded-control [&>svg]:size-4", critical ? "bg-danger-soft text-danger" : high ? "bg-warning-soft text-warning" : "bg-panel-sunken text-ink-soft")}>{queueKindIcons[item.kind]}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-ink">{item.title}</span>
        <span className="block truncate text-2xs text-muted">
          {(critical || high) && <><span className={cx("font-semibold", critical ? "text-danger" : "text-warning")}>{workQueuePriorityLabels[item.priority]}</span> · </>}
          <span className="font-medium text-ink-soft">{workQueueKindLabels[item.kind]}</span> · {workQueueOwnerLabel(item.owner)} · {item.project || "项目未提供"} · {workQueueReasonLabel(item.attention_reason)} · {formatRelative(item.observed_at)}
        </span>
      </span>
      <WorkStatePill state={item.state} />
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
          <span className="text-2xs text-muted">已确认上游成本</span>
          <p className="tabular mt-0.5 text-title font-semibold text-ink">{Object.keys(byCurrency).length ? Object.entries(byCurrency).map(([currency, amount]) => formatMoney(amount, currency)).join(" · ") : <span className="text-body-sm font-normal text-faint">未观察到</span>}</p>
        </div>
        {budget ? <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-2xs text-muted"><span>内部预算观察（不阻断调用）</span><span className="tabular">已预留 {formatMoney(budget.reserved, "CNY")} / {formatMoney(budget.total, "CNY")}</span></div>
          <Progress value={ratio} label="预算已预留" tone={ratio !== null && ratio > 85 ? "danger" : ratio !== null && ratio > 60 ? "warning" : "neutral"} />
        </div> : <p className="text-2xs text-muted">预算观察未提供。</p>}
        <p className="flex items-center gap-1.5 text-2xs text-faint"><Wallet className="size-3.5 shrink-0" />{rows.length} 条回执用量 · 历史账本仍按来源读取</p>
      </div>
    </ReadStateView>
  </Panel>;
}
