import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Activity, ArrowRight, CircleAlert, Eye, Images, ListTodo, ScrollText, ServerCog, ShieldQuestion, Wallet } from "../../icons";
import { api, type UsageProjection } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace, type ScopedRead } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { Button, Dot, EmptyState, KindBadge, Panel, ReadStateView, SkeletonRows, StaleNotice, TaskStatePill, cx, ownerLabel } from "../../components/ui";
import { formatMoney, formatRelative } from "../../shared/read-model/format";
import { collectResults, connectionStateLabel, connectionTone, resultMeta, taskInProgress, taskKind } from "../../shared/read-model/tasks";
import { progressLabel, taskIsActive, taskStateLabels } from "../../task-observation";
import { useNotifications } from "../../app/notifications-context";
import { countsAsHomeAttention, reminderStateLabels } from "../../notifications";
import { SourceCoverage } from "../../components/SourceCoverage";
import { WorkQueueInspector } from "./WorkQueueInspector";
import type { WorkQueueItem } from "../../shared/work-queue";
import { matchesWorkQueueFilters } from "../../shared/work-queue";
import type { TaskInspectorMode } from "../tasks/TaskDetail";

function greeting() {
  const hour = new Date().getHours();
  return hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
}

export default function HomePage() {
  const navigate = useNavigate();
  const { session, scope } = useWorkspace();
  const tasks = useTasks();
  const reminders = useNotifications();
  const usage = useScopedRead((scopeId, signal) => api.usage(scopeId, signal));
  const services = useScopedRead((scopeId, signal) => api.services(scopeId, signal));
  const queue = useScopedRead((scopeId, signal) => api.workQueue(scopeId, {}, undefined, 50, signal), { poll: (data) => data ? 30_000 : 15_000 });
  const [params, setParams] = useSearchParams();
  const [queueKind, setQueueKind] = useState<string>("");
  const [inspectorMode, setInspectorMode] = useState<TaskInspectorMode>(() => typeof window !== "undefined" && window.localStorage.getItem("yeisme.control.tasks.inspector-mode") === "floating" ? "floating" : "fixed");

  const active = useMemo(() => tasks.rows.filter(taskInProgress), [tasks.rows]);
  const attention = useMemo(() => reminders.rows.filter((item) => countsAsHomeAttention(item)), [reminders.rows]);
  const unknown = attention.filter((item) => item.task_state === "unknown").length;
  const results = useMemo(() => collectResults(tasks.rows.filter((task) => !taskIsActive(task))).slice(0, 6), [tasks.rows]);
  const ready = tasks.connections.filter((connection) => connection.state === "ready").length;
  const loading = tasks.status === "loading";

  const selectedWorkRef = params.get("work_item");
  const selectedWork = queue.data?.items.find((item) => item.work_ref === selectedWorkRef) || null;
  const visibleQueue = (queue.data?.items || []).filter((item) => matchesWorkQueueFilters(item, queueKind ? { kind: queueKind as WorkQueueItem["kind"] } : {}));
  const queueCounts = queue.data?.counts;
  const stats = [
    { label: "待处理", value: queueCounts?.actionable ?? 0, hint: "工作队列中仍需判断的事项", icon: <CircleAlert />, tone: queueCounts?.actionable ? "text-warning bg-warning-soft" : "text-success bg-success-soft", target: "/" },
    { label: "进行中任务", value: active.length, hint: "排队与执行中", icon: <Activity />, tone: "text-info bg-info-soft", target: "/tasks?view=active" },
    { label: "待审阅", value: queueCounts?.review_required ?? 0, hint: "Owner 声明需要审阅", icon: <ShieldQuestion />, tone: queueCounts?.review_required ? "text-warning bg-warning-soft" : "text-success bg-success-soft", target: "/review" },
    { label: "未知 / 回查", value: queueCounts?.unknown ?? unknown, hint: "只查询原引用，不自动重试", icon: <ShieldQuestion />, tone: (queueCounts?.unknown ?? unknown) ? "text-warning bg-warning-soft" : "text-success bg-success-soft", target: "/tasks" },
    { label: "来源过期", value: queueCounts?.stale ?? 0, hint: "需要刷新来源证据", icon: <ServerCog />, tone: queueCounts?.stale ? "text-warning bg-warning-soft" : "text-success bg-success-soft", target: "/services" },
    { label: "已观察结果", value: collectResults(tasks.rows).length, hint: "当前批次的任务产出", icon: <Images />, tone: "text-kind-image bg-kind-image-soft", target: "/assets" },
    { label: "可读连接", value: tasks.connections.length ? `${ready}/${tasks.connections.length}` : "0", hint: "任务观测连接", icon: <ServerCog />, tone: ready === tasks.connections.length && ready > 0 ? "text-success bg-success-soft" : "text-warning bg-warning-soft", target: "/services" },
  ];

  return <div className={cx("page-enter space-y-6", selectedWork && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="home">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[13px] text-muted">{scope?.label || "授权范围"}</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.01em]">{greeting()}，{session?.name || "你"}</h1>
        <p className="mt-1.5 text-sm text-muted">这里只汇总 owner 返回的真实只读事实，缺失的数据保持未知。</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => navigate("/requests")} icon={<ScrollText className="size-3.5" />}>请求记录</Button>
        <Button size="sm" variant="primary" onClick={() => navigate("/tasks")} icon={<ListTodo className="size-3.5" />}>任务中心</Button>
      </div>
    </header>

    <StaleNotice status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} onRetry={tasks.refresh} />

    <section aria-label="概览" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.map((stat, index) => <button key={stat.label} type="button" onClick={() => navigate(stat.target)} className="stagger-in group flex min-w-0 items-start gap-3 rounded-card border border-line bg-panel p-4 text-left shadow-panel transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong" style={{ "--i": index } as React.CSSProperties}>
        <span className={cx("grid size-9 shrink-0 place-items-center rounded-[10px] [&>svg]:size-[18px]", stat.tone)}>{stat.icon}</span>
        <span className="min-w-0">
          <span className="block text-2xs text-muted">{stat.label}</span>
          {loading || queue.status === "loading" ? <span className="skeleton mt-1.5 block h-6 w-12" /> : <span className="block text-2xl font-semibold leading-8 tracking-tight tabular">{stat.value}</span>}
          <span className="block truncate text-2xs text-faint">{stat.hint}</span>
        </span>
      </button>)}
    </section>

    <Panel title="工作队列" actions={<div className="flex items-center gap-1"><Button size="sm" variant={queueKind === "" ? "secondary" : "ghost"} onClick={() => setQueueKind("")}>全部</Button><Button size="sm" variant={queueKind === "review_required" ? "secondary" : "ghost"} onClick={() => setQueueKind("review_required")}>待审阅</Button><Button size="sm" variant={queueKind === "handoff_ready" ? "secondary" : "ghost"} onClick={() => setQueueKind("handoff_ready")}>交接</Button><Button size="sm" variant={queueKind === "service_blocked" ? "secondary" : "ghost"} onClick={() => setQueueKind("service_blocked")}>阻塞</Button></div>} bodyClassName="p-0">
      <ReadStateView status={queue.status === "empty" ? "ready" : queue.status} error={queue.error} onRetry={queue.reload} skeleton={<SkeletonRows rows={5} />}>
        {visibleQueue.length === 0 ? <EmptyState compact icon={<ShieldQuestion />} title="当前没有需要处理的工作项" body="来源没有返回阻塞、未知、待审阅或交接事项。" /> : <ul className="divide-y divide-line" data-work-queue-count={visibleQueue.length}>
          {visibleQueue.slice(0, 8).map((item) => <li key={item.work_ref}>
            <button type="button" className="group flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-panel-soft" onClick={() => { const next = new URLSearchParams(params); next.set("work_item", item.work_ref); setParams(next); }}>
              <span className={cx("grid size-8 shrink-0 place-items-center rounded-[9px] text-2xs font-semibold", item.priority === "critical" ? "bg-danger-soft text-danger" : item.priority === "high" ? "bg-warning-soft text-warning" : "bg-panel-soft text-info")}>{item.kind === "review_required" ? "审" : item.kind === "handoff_ready" ? "交" : item.kind === "service_blocked" ? "源" : "!"}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{item.title}</span><span className="block truncate text-2xs text-muted">{item.owner} · {item.project || "项目未提供"} · {item.attention_reason} · {formatRelative(item.observed_at)}</span></span>
              <TaskStatePill state={item.state} />
            </button>
          </li>)}
        </ul>}
      </ReadStateView>
    </Panel>

    {selectedWork && <WorkQueueInspector item={selectedWork} open mode={inspectorMode} onModeChange={(mode) => { setInspectorMode(mode); window.localStorage.setItem("yeisme.control.tasks.inspector-mode", mode); }} onClose={() => { const next = new URLSearchParams(params); next.delete("work_item"); setParams(next); }} onNavigate={(target) => { const next = new URLSearchParams(params); next.delete("work_item"); setParams(next); navigate(target); }} />}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel title="需要处理" actions={attention.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate("/reminders")}>全部 {attention.length}<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
        <ReadStateView status={reminders.status === "unavailable" && attention.length === 0 ? "unavailable" : (tasks.status === "loading" || reminders.status === "idle" || reminders.syncing) && attention.length === 0 ? "loading" : "ready"} error={reminders.error || tasks.error} onRetry={() => { tasks.refresh(); reminders.refresh(); }} skeleton={<SkeletonRows rows={4} />}>
          {attention.length === 0 ? <EmptyState compact icon={<ShieldQuestion />} title="没有未确认的失败提醒" body="同一失败只提醒一次。已确认、免提醒和归档的记录留在提醒中心。" /> : <ul className="divide-y divide-line" data-home-attention={attention.length}>
            {attention.slice(0, 6).map((item) => <li key={item.id}>
              <button type="button" onClick={() => navigate(`/reminders?focus=${encodeURIComponent(item.id)}`)} className="group flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-panel-soft">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{item.title || item.task_key}</span>
                  <span className="block truncate text-2xs text-muted">{ownerLabel(item.owner)} · {item.project} · {taskStateLabels[item.task_state] || item.task_state} · {reminderStateLabels[item.state]} · {formatRelative(item.first_seen_at)}</span>
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
            return <li key={connection.id} className="flex items-center gap-3 px-5 py-3">
              <Dot tone={connectionTone(connection.state)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{connection.label}</span>
                <span className="block truncate text-2xs text-muted" title={connection.project}>{ownerLabel(connection.owner)} · {connection.project}</span>
              </span>
              <span className="text-right text-2xs text-muted">
                <span className={cx("block font-medium", connection.state === "ready" ? "text-success" : "text-warning")}>{connectionStateLabel(connection.state)}</span>
                <span className="tabular">{connection.state === "ready" ? `${count} 个任务` : "—"}</span>
              </span>
            </li>;
          })}
        </ul> : <EmptyState compact icon={<ServerCog />} title="没有任务连接" body="当前范围没有配置 owner 观测连接。" />}
      </Panel>
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel title="进行中" actions={active.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate("/tasks?view=active")}>全部 {active.length}<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
        {loading ? <SkeletonRows rows={3} /> : active.length === 0 ? <EmptyState compact icon={<Activity />} title="没有进行中的任务" /> : <ul className="divide-y divide-line">
          {active.slice(0, 5).map((task) => {
            const percent = task.progress.kind === "percent" ? task.progress.percent : null;
            return <li key={task.task_key}>
              <button type="button" onClick={() => navigate(`/tasks?task=${encodeURIComponent(task.task_key || "")}`)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-panel-soft">
                <KindBadge kind={taskKind(task)} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3"><span className="truncate text-[13px] font-medium">{task.title}</span><span className="shrink-0 text-2xs text-muted tabular">{progressLabel(task.progress)}</span></span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-line">{percent !== null && <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />}</span>
                </span>
              </button>
            </li>;
          })}
        </ul>}
      </Panel>

      <UsageGlance usage={usage} onOpen={() => navigate("/usage")} />
    </div>

    <Panel title="最近结果" actions={<Button size="sm" variant="ghost" onClick={() => navigate("/assets")}>资源库<ArrowRight className="size-3.5" /></Button>} bodyClassName="p-0">
      {loading ? <SkeletonRows rows={2} /> : results.length === 0 ? <EmptyState compact icon={<Images />} title="当前批次没有已结束任务的结果" /> : <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
        {results.map((entry) => <li key={entry.key} className="bg-panel">
          <button type="button" onClick={() => navigate(`/assets?result=${encodeURIComponent(entry.key)}`)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-panel-soft">
            <KindBadge kind={entry.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{entry.result.name || "未命名结果"}</span>
              <span className="block truncate text-2xs text-muted">{ownerLabel(entry.task.locator.owner)} · {resultMeta(entry.result).slice(0, 2).join(" · ") || "规格未提供"}</span>
            </span>
            <Eye className="size-4 shrink-0 text-faint" />
          </button>
        </li>)}
      </ul>}
    </Panel>
    <SourceCoverage services={services.data?.services || []} connections={tasks.connections} />
  </div>;
}

function UsageGlance({ usage, onOpen }: { usage: ScopedRead<UsageProjection>; onOpen: () => void }) {
  const budget = usage.data?.budget;
  const rows = usage.data?.rows || [];
  const confirmed = rows.filter((row) => row.cost_state === "confirmed" && row.upstream_cost !== null);
  const byCurrency = confirmed.reduce<Record<string, number>>((sum, row) => ({ ...sum, [row.currency]: (sum[row.currency] || 0) + (row.upstream_cost || 0) }), {});
  return <Panel title="用量与预算" actions={<Button size="sm" variant="ghost" onClick={onOpen}>详情<ArrowRight className="size-3.5" /></Button>}>
    <ReadStateView status={usage.status === "empty" ? "ready" : usage.status} error={usage.error} onRetry={usage.reload} skeleton={<SkeletonRows rows={2} />}>
      <div className="space-y-4 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-2xs text-muted">已确认上游成本</span>
          <span className="text-lg font-semibold tabular">{Object.keys(byCurrency).length ? Object.entries(byCurrency).map(([currency, amount]) => formatMoney(amount, currency)).join(" · ") : <span className="text-sm font-normal text-faint">未观察到</span>}</span>
        </div>
        {budget ? <div>
          <div className="flex items-baseline justify-between text-2xs text-muted"><span>内部预算观察（不阻断调用）</span><span className="tabular">已预留 {formatMoney(budget.reserved, "CNY")} / {formatMoney(budget.total, "CNY")}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-chart-3" style={{ width: `${Math.min(100, (budget.reserved / Math.max(budget.total, 1)) * 100)}%` }} /></div>
        </div> : <p className="text-2xs text-muted">预算观察未提供。</p>}
        <p className="flex items-center gap-1.5 text-2xs text-faint"><Wallet className="size-3.5" />{rows.length} 条回执用量 · 历史账本仍按来源读取</p>
      </div>
    </ReadStateView>
  </Panel>;
}
