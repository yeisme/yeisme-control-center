import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, BadgeCheck, CheckCircle2, ClipboardCheck, Clock3, Cpu, Info, LockKeyhole, Send } from "../../icons";
import { useTasks } from "../../app/tasks-context";
import {
  Button,
  EmptyState,
  KindBadge,
  MetricStrip,
  NoticeStack,
  PageToolbar,
  Panel,
  Pill,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
  ReadStateView,
  SkeletonRows,
  StaleNotice,
  TabPanel,
  Tabs,
  TaskStatePill,
  ownerLabel,
} from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";
import { labelFrom } from "../../shared/read-model/labels";
import { readErrorMessage } from "../../shared/read-model/read-state";
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

const reviewStatusLabels: Record<string, string> = {
  pending_review: "待审阅",
  needs_review: "待审阅",
  waiting_review: "待审阅",
  in_review: "审阅中",
  reviewing: "审阅中",
  changes_requested: "需修改",
  rejected: "未通过",
  approved: "已通过",
};

const exportStatusLabels: Record<string, string> = {
  not_exported: "未导出",
  pending: "待导出",
  preparing: "准备中",
  prepared: "已备好",
  ready: "可导出",
  exporting: "导出中",
  exported: "已导出",
  failed: "导出失败",
};

const humanize = (value: string) => value.replace(/[_-]+/g, " ");
const reviewStatusLabel = (value: string) => humanize(labelFrom(reviewStatusLabels, value));
const exportStatusLabel = (value: string) => humanize(labelFrom(exportStatusLabels, value));

function FactsPopover() {
  return <PopoverRoot>
    <PopoverTrigger asChild>
      <Button size="sm" variant="ghost" icon={<Info className="size-3.5" />}>四种事实</Button>
    </PopoverTrigger>
    <PopoverContent className="w-[min(340px,calc(100vw-24px))] p-4">
      <p className="text-body-sm font-semibold">四种事实分开记录</p>
      <p className="mt-0.5 text-2xs text-muted">每一步由对应的 owner 单独记录，不能互相推断。</p>
      <ol className="mt-3 space-y-3">
        {principles.map((item, index) => <li key={item.title} className="flex gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-control bg-panel-sunken text-muted [&>svg]:size-4">{item.icon}</span>
          <span className="min-w-0"><span className="block text-body-sm font-semibold">{index + 1}. {item.title}</span><span className="block text-2xs text-muted">{item.body}</span></span>
        </li>)}
      </ol>
    </PopoverContent>
  </PopoverRoot>;
}

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
    ? "当前批次没有待审阅任务，也没有 owner 返回的审阅状态。不会用演示数据填充。"
    : tasks.status === "forbidden"
      ? "当前身份没有读取任务或 owner 审阅状态的权限。"
      : `任务观察未完成：${readErrorMessage(tasks.error)}不会从本地数量推导审阅结果。`;

  return <div className="page-enter space-y-5" data-page="review">
    <h1 className="sr-only">审阅与交付</h1>
    <PageToolbar
      summary="审阅与交付只读展示 owner 返回的状态。采用、修改意见和交付发送都是 owner 写操作，需要独立授权合同，当前保持禁用。"
      actions={<FactsPopover />}
      metrics={tasks.status !== "loading" && <MetricStrip label="审阅概况" items={[
        { label: "待审阅", value: queue.length, tone: queue.length > 0 ? "review" : "neutral" },
        { label: "有导出状态", value: exports.length },
      ]} />}
      meta={tasks.observedAt && <span className="inline-flex items-center gap-1.5 text-2xs text-muted"><Clock3 className="size-3.5" />任务观察于 {formatRelative(tasks.observedAt)}</span>}
    />
    <NoticeStack notices={[tasks.status === "stale" && <StaleNotice key="stale" status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} onRetry={tasks.refresh} />]} />
    <Tabs<Tab>
      value={tab}
      onChange={(value) => setParams(value === "review" ? new URLSearchParams() : new URLSearchParams({ tab: value }), { replace: true })}
      label="审阅与交付"
      className="space-y-4"
      options={[{ id: "review", label: "审阅队列", count: queue.length }, { id: "delivery", label: "交付", count: exports.length }]}
    >
      <TabPanel value="review">
        <Panel title="待审阅" actions={<span className="text-meta text-muted">来自任务观察批次</span>} bodyClassName="p-0">
          <ReadStateView status={tasks.status === "empty" ? "ready" : tasks.status} error={tasks.error} onRetry={tasks.refresh} skeleton={<SkeletonRows rows={4} />}>
            {queue.length === 0 ? <EmptyState icon={<CheckCircle2 />} title={reviewEmptyTitle} body={reviewEmptyBody} /> : <ul className="divide-y divide-line">
              {queue.map((task) => <li key={task.task_key} className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-5 py-3.5">
                <KindBadge kind={taskKind(task)} size="sm" />
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate text-body-sm font-medium">{task.title}</span>
                  <span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} · {task.results.length} 个结果 · {formatRelative(task.updated_at || task.created_at)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {task.provider_recovery?.review_status && <Pill size="sm" tone="review">审阅：{reviewStatusLabel(task.provider_recovery.review_status)}</Pill>}
                  <TaskStatePill state={task.state} />
                </span>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <Button size="sm" disabled disabledReason="采用需要 owner 提供审阅写入合同；控制中心只读，不会替 owner 记录采用结论。" icon={<LockKeyhole className="size-3.5" />}>采用</Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/tasks?task=${encodeURIComponent(task.task_key || "")}`)}>查看结果<ArrowRight className="size-3.5" /></Button>
                </div>
              </li>)}
            </ul>}
          </ReadStateView>
        </Panel>
      </TabPanel>
      <TabPanel value="delivery">
        <Panel title="交付" bodyClassName="p-0">
          {exports.length > 0 && <ul className="divide-y divide-line border-b border-line">
            {exports.map((task) => <li key={task.task_key} className="flex items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1"><span className="block truncate text-body-sm font-medium">{task.title}</span><span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} 导出状态</span></span>
              <Pill size="sm" tone="neutral">{exportStatusLabel(task.provider_recovery?.export_status || "")}</Pill>
            </li>)}
          </ul>}
          <EmptyState icon={<Send />} title="交付合同未提供" body="owner 尚未提供交付包、权限检查和发送合同。控制中心不会从任务或结果推导交付状态，也不会发送文件。" />
        </Panel>
      </TabPanel>
    </Tabs>
    <SourceCoverage services={services.data?.services || []} connections={tasks.connections} readStatus={services.status} error={services.error || tasks.error} onRetry={() => { tasks.refresh(); services.reload(); }} />
  </div>;
}
