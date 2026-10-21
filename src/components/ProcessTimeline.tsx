import { Clock3, LoaderCircle, LockKeyhole, Plug, ShieldQuestion } from "../icons";
import type { ProcessCheckpoint, ProcessObservation } from "../observation-contract";
import { Button, InlineNotice, Pill, cx } from "./ui";
import { formatFullTime } from "../shared/read-model/format";
import { PromptCaptureSummary } from "./PromptCaptureSummary";

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
  return <div className="space-y-3">
    <PromptCaptureSummary prompt={prompt} compact />
    {error && <InlineNotice tone="warning" icon={<ShieldQuestion />}>过程暂不可读（{error}）。{onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>重试</Button>}</InlineNotice>}
    {!error && reason && <InlineNotice tone="warning" icon={<ShieldQuestion />}>来源观察：{reason}</InlineNotice>}
    {!error && observation?.coverage === "needs_contract" && <InlineNotice tone="neutral" icon={<Plug />}>来源未提供中间过程合同；当前只展示最终产物和已有元数据。</InlineNotice>}
    {!error && observation?.coverage === "not_recorded" && <InlineNotice tone="neutral" icon={<ShieldQuestion />}>来源没有记录提示词或过程正文。</InlineNotice>}
    {!error && observation?.coverage === "forbidden" && <InlineNotice tone="warning" icon={<LockKeyhole />}>来源拒绝过程观察；当前只展示已授权的任务和结果元数据。</InlineNotice>}
    {!error && observation?.coverage === "unavailable" && <InlineNotice tone="warning" icon={<ShieldQuestion />}>来源暂时不可用；不会用本地数据补齐过程。</InlineNotice>}
    {observation && observation.freshness === "stale" && <InlineNotice tone="warning" icon={<Clock3 />}>过程观察已过期，正在后台刷新。</InlineNotice>}
    {checkpoints.length === 0 && !error && <p className="text-[13px] text-muted">来源尚未返回中间检查点。</p>}
    {checkpoints.length > 0 && <ol className="relative space-y-0">
      {checkpoints.map((checkpoint, index) => <li key={checkpoint.id || index} className="relative flex gap-3 pb-3 pl-1">
        <span className="relative flex w-3 justify-center"><span className={cx("mt-1.5 size-2 rounded-full", index === 0 ? "bg-primary" : "bg-line-strong")} />{index < checkpoints.length - 1 && <span className="absolute top-4 bottom-[-4px] w-px bg-line" />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2"><span className="text-[13px] font-medium text-ink">{stageLabels[checkpoint.kind] || checkpoint.stage}</span><Pill tone={processTone(checkpoint.state)} icon={checkpoint.state === "running" ? <LoaderCircle className="motion-safe:animate-spin" /> : undefined}>{checkpoint.state}</Pill></span>
          {checkpoint.summary && <span className="mt-1 block text-[13px] leading-5 text-ink-soft">{checkpoint.summary}</span>}
          <span className="mt-1 block text-2xs text-faint">{formatFullTime(checkpoint.occurred_at, "时间未提供")}{checkpoint.duration_ms !== undefined && checkpoint.duration_ms !== null ? ` · ${checkpoint.duration_ms} ms` : ""}{checkpoint.reason_code ? ` · ${checkpoint.reason_code}` : ""}</span>
        </span>
      </li>)}
      {observation?.gap && <li className="ml-6 rounded-[8px] border border-dashed border-line-strong px-3 py-2 text-2xs text-muted">来源声明过程存在缺口，当前列表不是完整历史。</li>}
      {observation?.next_cursor && onLoadMore && <li className="ml-6 pt-1"><Button size="sm" variant="ghost" onClick={onLoadMore}>加载更早过程</Button></li>}
    </ol>}
  </div>;
}
