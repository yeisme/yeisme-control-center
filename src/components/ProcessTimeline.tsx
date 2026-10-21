import { Clock3, LoaderCircle, LockKeyhole, Plug, ShieldQuestion } from "../icons";
import type { ProcessCheckpoint, ProcessObservation } from "../observation-contract";
import { Button, InlineNotice, NoticeStack, Pill, cx } from "./ui";
import { formatDurationMs, formatFullTime } from "../shared/read-model/format";
import { reasonLabel } from "../shared/read-model/labels";
import { readErrorMessage } from "../shared/read-model/read-state";
import { taskStageLabels, taskStateLabels } from "../task-observation";
import { PromptCaptureSummary, readableReason } from "./PromptCaptureSummary";

const stageLabels: Record<string, string> = {
  request_received: "请求已接收",
  prompt_capture: "提示词采集",
  prompt_validate: "提示词校验",
  prompt_normalize: "提示词规范化",
  submit: "提交执行",
  provider_running: "Provider 执行",
  artifact_collect: "回收产物",
  artifact_ready: "产物就绪",
  review: "等待审阅",
  reconcile: "对账确认",
  failed: "过程失败",
  unknown: "状态未知",
};

const stateLabels: Record<string, string> = {
  ...taskStateLabels,
  active: "进行中",
  complete: "已完成",
  captured: "已采集",
  capturing: "采集中",
  redacted: "已脱敏",
  not_recorded: "未记录",
  needs_contract: "待接入",
};

const humanize = (value: string) => value.replace(/[_-]+/g, " ").trim();

function checkpointLabel(checkpoint: ProcessCheckpoint) {
  if (checkpoint.kind !== "unknown" && stageLabels[checkpoint.kind]) return stageLabels[checkpoint.kind];
  return taskStageLabels[checkpoint.stage] || stageLabels[checkpoint.stage] || (checkpoint.stage ? humanize(checkpoint.stage) : "阶段未提供");
}

function processTone(state: string) {
  if (["succeeded", "completed", "captured", "complete"].includes(state)) return "success" as const;
  if (["running", "capturing", "active", "queued"].includes(state)) return "info" as const;
  if (["failed", "blocked"].includes(state)) return "danger" as const;
  if (state === "needs_contract") return "review" as const;
  return "neutral" as const;
}

export function ProcessTimeline({ observation, events, loading = false, error, reason, onRetry, onLoadMore }: { observation?: ProcessObservation; events?: ProcessCheckpoint[]; loading?: boolean; error?: string | null; reason?: string; onRetry?: () => void; onLoadMore?: () => void }) {
  const checkpoints = events?.length ? events : observation?.checkpoints || [];
  const prompt = observation?.prompt_capture || checkpoints.find((event) => event.prompt_capture)?.prompt_capture;
  if (loading) return <div className="space-y-2" aria-label="加载过程观察"><div className="skeleton h-16" /><div className="skeleton h-12" /><div className="skeleton h-12" /></div>;
  const coverage = observation?.coverage;
  const sourceReason = !error ? readableReason(reason) : null;
  const notices = [
    error && <InlineNotice key="error" tone="warning" icon={<ShieldQuestion />}>过程暂不可读。{readErrorMessage(error)}{onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>重试</Button>}</InlineNotice>,
    !error && coverage === "forbidden" && <InlineNotice key="forbidden" tone="warning" icon={<LockKeyhole />}>来源拒绝过程观察；当前只展示已授权的任务和结果元数据。</InlineNotice>,
    !error && coverage === "unavailable" && <InlineNotice key="unavailable" tone="warning" icon={<ShieldQuestion />}>来源暂时不可用；不会用本地数据补齐过程。</InlineNotice>,
    sourceReason && <InlineNotice key="reason" tone="warning" icon={<ShieldQuestion />}>来源观察：{sourceReason}</InlineNotice>,
    observation?.freshness === "stale" && <InlineNotice key="stale" tone="warning" icon={<Clock3 />}>过程观察已过期，正在后台刷新。</InlineNotice>,
    !error && coverage === "needs_contract" && <InlineNotice key="needs-contract" tone="neutral" icon={<Plug />}>来源未提供中间过程合同；当前只展示最终产物和已有元数据。</InlineNotice>,
    !error && coverage === "not_recorded" && <InlineNotice key="not-recorded" tone="neutral" icon={<ShieldQuestion />}>来源没有记录提示词或过程正文。</InlineNotice>,
  ];
  return <div className="space-y-3">
    <PromptCaptureSummary prompt={prompt} compact />
    <NoticeStack notices={notices} />
    {checkpoints.length === 0 && !error && <p className="text-body-sm text-muted">来源尚未返回中间检查点。</p>}
    {checkpoints.length > 0 && <ol className="relative space-y-0">
      {checkpoints.map((checkpoint, index) => {
        const duration = formatDurationMs(checkpoint.duration_ms);
        const stateText = stateLabels[checkpoint.state] || (checkpoint.state ? humanize(checkpoint.state) : "状态未提供");
        return <li key={checkpoint.id || index} className="relative flex gap-3 pb-3 pl-1">
          <span className="relative flex w-3 justify-center"><span className={cx("mt-1.5 size-2 rounded-full", index === 0 ? "bg-primary" : "bg-line-strong")} />{index < checkpoints.length - 1 && <span className="absolute top-4 bottom-[-4px] w-px bg-line" />}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2"><span className="text-body-sm font-medium text-ink">{checkpointLabel(checkpoint)}</span><Pill tone={processTone(checkpoint.state)} size="sm" title={stateLabels[checkpoint.state] ? undefined : checkpoint.state} icon={checkpoint.state === "running" ? <LoaderCircle className="motion-safe:animate-spin" /> : undefined}>{stateText}</Pill></span>
            {checkpoint.summary && <span className="mt-1 block text-body-sm text-ink-soft">{checkpoint.summary}</span>}
            <span className="mt-1 block text-2xs text-faint">{formatFullTime(checkpoint.occurred_at, "时间未提供")}{duration ? ` · 耗时 ${duration}` : ""}{checkpoint.reason_code ? ` · ${reasonLabel(checkpoint.reason_code)}` : ""}</span>
          </span>
        </li>;
      })}
      {observation?.gap && <li className="ml-6 rounded-control border border-dashed border-line-strong px-3 py-2 text-2xs text-muted">来源声明过程存在缺口，当前列表不是完整历史。</li>}
      {observation?.next_cursor && onLoadMore && <li className="ml-6 pt-1"><Button size="sm" variant="ghost" onClick={onLoadMore}>加载更早过程</Button></li>}
    </ol>}
  </div>;
}
