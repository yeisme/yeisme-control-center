import { LockKeyhole, ShieldQuestion } from "../icons";
import type { PromptCaptureObservation, PromptCaptureState } from "../observation-contract";
import type { TaskSnapshot } from "../task-observation";
import { Facts, InlineNotice, Pill, Unknown, cx } from "./ui";

const labels: Record<PromptCaptureState, string> = {
  not_recorded: "未采集",
  queued: "等待采集",
  capturing: "采集中",
  captured: "已采集",
  redacted: "已脱敏",
  blocked: "采集受阻",
  failed: "采集失败",
  expired: "采集已过期",
};

function tone(state: PromptCaptureState) {
  if (["captured", "redacted"].includes(state)) return "success" as const;
  if (["queued", "capturing"].includes(state)) return "info" as const;
  if (["blocked", "failed", "expired"].includes(state)) return "danger" as const;
  return "neutral" as const;
}

export function promptStateLabel(state?: PromptCaptureState) {
  return state ? labels[state] || state : "未提供";
}

export function promptFromTask(task: Pick<TaskSnapshot, "prompt_capture" | "process">) {
  return task.prompt_capture || task.process?.prompt_capture || task.process?.checkpoints?.find((checkpoint) => checkpoint.prompt_capture)?.prompt_capture;
}

export function PromptCaptureSummary({ prompt, compact = false, className }: { prompt?: PromptCaptureObservation; compact?: boolean; className?: string }) {
  if (!prompt) return compact ? <span className={cx("text-2xs text-faint", className)}>提示词未提供</span> : <InlineNotice tone="neutral" icon={<ShieldQuestion />}>来源没有提供提示词采集观察。</InlineNotice>;
  if (compact) return <span className={cx("flex min-w-0 items-center gap-1.5 text-2xs text-muted", className)}>
    <Pill tone={tone(prompt.state)} icon={!prompt.readable ? <LockKeyhole className="size-3" /> : undefined}>{labels[prompt.state]}</Pill>
    {prompt.length !== undefined && <span className="tabular">{prompt.length} 字符</span>}
    {prompt.summary && <span className="truncate text-faint">{prompt.summary}</span>}
  </span>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone={tone(prompt.state)} icon={!prompt.readable ? <LockKeyhole /> : undefined}>{labels[prompt.state]}</Pill>
      {prompt.version && <span className="text-2xs text-muted">版本 {prompt.version}</span>}
      {prompt.length !== undefined && <span className="text-2xs text-muted tabular">{prompt.length} 字符</span>}
    </div>
    {prompt.summary ? <p className="rounded-[10px] border border-line bg-panel-soft p-3 text-[13px] leading-5 text-ink-soft">{prompt.summary}</p> : <p className="text-[13px] text-muted">Owner 没有返回可展示的提示词摘要。</p>}
    <Facts columns={2} items={[
      { label: "来源", value: prompt.source || <Unknown /> },
      { label: "语言", value: prompt.locale || <Unknown /> },
      { label: "capture_ref", value: prompt.capture_ref || <Unknown />, wide: true },
      { label: "request_ref", value: prompt.request_ref || <Unknown />, wide: true },
      { label: "task_ref", value: prompt.task_ref || <Unknown />, wide: true },
      { label: "trace_ref", value: prompt.trace_ref || <Unknown />, wide: true },
      { label: "digest", value: prompt.digest ? <span className="break-all font-mono text-2xs">{prompt.digest}</span> : <Unknown />, wide: true },
      { label: "观察时间", value: prompt.observed_at || <Unknown /> },
    ]} />
    {prompt.reason && <InlineNotice tone={prompt.state === "failed" || prompt.state === "blocked" ? "warning" : "neutral"}>{prompt.reason}</InlineNotice>}
    {!prompt.readable && <InlineNotice tone="neutral" icon={<LockKeyhole />}>Owner 没有授权读取原始提示词；当前只展示脱敏摘要和采集元数据。</InlineNotice>}
  </div>;
}
