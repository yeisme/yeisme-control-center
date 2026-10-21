import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, BadgeCheck, CheckCircle2, ClipboardCheck, Cpu, LockKeyhole, Send } from "../../icons";
import { useTasks } from "../../app/tasks-context";
import { Button, EmptyState, InlineNotice, KindBadge, Panel, Pill, ReadStateView, SegmentedTabs, SkeletonRows, StaleNotice, TaskStatePill, ownerLabel } from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";
import { taskKind } from "../../shared/read-model/tasks";
import { SourceCoverage } from "../../components/SourceCoverage";
import { api } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { taskNeedsReview } from "../../shared/read-model/review";

type Tab = "review" | "delivery";

const principles = [
  { icon: <Cpu />, title: "执行完成", body: "机器返回结果；只代表任务结束。" },
  { icon: <ClipboardCheck />, title: "审阅通过", body: "团队认可候选结果，由 owner 记录。" },
  { icon: <BadgeCheck />, title: "正式采用", body: "指定版本进入项目主线。" },
  { icon: <Send />, title: "可交付", body: "清单完整且权限明确后才能交接。" },
];

export default function ReviewPage() {
  const tasks = useTasks();
  const services = useScopedRead((scope, signal) => api.services(scope, signal));
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") === "delivery" ? "delivery" : "review") as Tab;
  const queue = useMemo(() => tasks.rows.filter(taskNeedsReview), [tasks.rows]);
  const exports = useMemo(() => tasks.rows.filter((task) => task.provider_recovery?.export_status), [tasks.rows]);
  const reviewEmptyTitle = tasks.status === "empty" || tasks.status === "ready" ? "审阅数据未提供" : tasks.status === "forbidden" ? "无权读取审阅状态" : "审阅来源不可用";
  const reviewEmptyBody = tasks.status === "empty" || tasks.status === "ready"
    ? "当前批次没有 waiting_review 任务，也没有 owner 返回的审阅状态。不会用演示数据填充。"
    : tasks.status === "forbidden"
      ? "当前身份没有读取任务或 owner 审阅状态的权限。"
      : `任务观察未完成（${tasks.error || "source_unavailable"}），不会从本地数量推导审阅结果。`;

  return <div className="page-enter space-y-5" data-page="review">
    <h1 className="sr-only">审阅与交付</h1>
    <div className="flex justify-end"><SegmentedTabs label="审阅与交付" value={tab} onChange={(value) => setParams(value === "review" ? new URLSearchParams() : new URLSearchParams({ tab: value }), { replace: true })} options={[{ id: "review", label: "审阅队列", count: queue.length }, { id: "delivery", label: "交付" }]} /></div>
    <StaleNotice status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} onRetry={tasks.refresh} />

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
      {tab === "review" ? <Panel title="待审阅" actions={<span className="text-2xs text-muted">来自任务观察批次</span>} bodyClassName="p-0">
        <ReadStateView status={tasks.status === "empty" ? "ready" : tasks.status} error={tasks.error} onRetry={tasks.refresh} skeleton={<SkeletonRows rows={4} />}>
          {queue.length === 0 ? <EmptyState icon={<CheckCircle2 />} title={reviewEmptyTitle} body={reviewEmptyBody} /> : <ul className="divide-y divide-line">
            {queue.map((task) => <li key={task.task_key} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <KindBadge kind={taskKind(task)} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{task.title}</span>
                <span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} · {task.results.length} 个结果 · {formatRelative(task.updated_at || task.created_at)}</span>
              </span>
              {task.provider_recovery?.review_status && <Pill tone="review">审阅 {task.provider_recovery.review_status}</Pill>}
              <TaskStatePill state={task.state} />
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button size="sm" disabled title="审阅写入等待 owner 合同" icon={<LockKeyhole className="size-3.5" />}>采用</Button>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/tasks?task=${encodeURIComponent(task.task_key || "")}`)}>查看结果<ArrowRight className="size-3.5" /></Button>
              </div>
            </li>)}
          </ul>}
        </ReadStateView>
      </Panel> : <Panel title="交付" bodyClassName="p-0">
        {exports.length > 0 && <ul className="divide-y divide-line border-b border-line">
          {exports.map((task) => <li key={task.task_key} className="flex items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{task.title}</span><span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} 导出状态</span></span>
            <Pill tone="neutral">{task.provider_recovery?.export_status}</Pill>
          </li>)}
        </ul>}
        <EmptyState icon={<Send />} title="交付合同未提供" body="owner 尚未提供交付包、权限检查和发送合同。控制中心不会从任务或结果推导交付状态，也不会发送文件。" />
      </Panel>}

      <aside className="space-y-3">
        <Panel title="四种事实分开记录">
          <ol className="space-y-3 p-5">
            {principles.map((item, index) => <li key={item.title} className="flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-panel-sunken text-muted [&>svg]:size-4">{item.icon}</span>
              <span className="min-w-0"><span className="block text-[13px] font-semibold">{index + 1}. {item.title}</span><span className="block text-2xs text-muted">{item.body}</span></span>
            </li>)}
          </ol>
        </Panel>
        <InlineNotice tone="neutral" icon={<LockKeyhole />}>采用、修改意见和交付发送都是 owner 写操作，需要独立授权合同；当前按钮保持禁用。</InlineNotice>
        <SourceCoverage services={services.data?.services || []} connections={tasks.connections} readStatus={services.status} error={services.error || tasks.error} onRetry={() => { tasks.refresh(); services.reload(); }} />
      </aside>
    </div>
  </div>;
}
