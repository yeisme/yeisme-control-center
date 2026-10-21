import type { ReactNode } from "react";
import { LockKeyhole, ShieldQuestion } from "../icons";
import type { PromptCaptureObservation, PromptCaptureState } from "../observation-contract";
import type { TaskSnapshot } from "../task-observation";
import { formatFullTime } from "../shared/read-model/format";
import { labelFrom, reasonLabel } from "../shared/read-model/labels";
import { Facts, InlineNotice, Pill, cx } from "./ui";

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

const sourceLabels: Record<string, string> = { request: "请求", task: "任务", provider_run: "Provider 运行", owner: "Owner 回报" };
const localeLabels: Record<string, string> = { "zh-CN": "简体中文", "zh-TW": "繁体中文", "en-US": "英语（美国）", "en-GB": "英语（英国）", "ja-JP": "日语" };

function tone(state: PromptCaptureState) {
  if (["captured", "redacted"].includes(state)) return "success" as const;
  if (["queued", "capturing"].includes(state)) return "info" as const;
  if (["blocked", "failed", "expired"].includes(state)) return "danger" as const;
  return "neutral" as const;
}

export function promptStateLabel(state?: PromptCaptureState) {
  return state ? labels[state] || state : "未提供";
}

/** Owner reasons arrive either as free text or as snake_case codes; only codes are translated. */
export function readableReason(value: string | null | undefined) {
  if (!value) return null;
  return /^[a-z0-9_.:-]+$/i.test(value) ? reasonLabel(value) : value;
}

export function promptFromTask(task: Pick<TaskSnapshot, "prompt_capture" | "process">) {
  return task.prompt_capture || task.process?.prompt_capture || task.process?.checkpoints?.find((checkpoint) => checkpoint.prompt_capture)?.prompt_capture;
}

interface GapFact { label: string; value: ReactNode | null | undefined | false; wide?: boolean; mono?: boolean }

/** Facts that omit absent values and name them once in a disclosure instead of repeating “未提供”. */
export function FactsWithGaps({ items, columns = 2, className }: { items: GapFact[]; columns?: 1 | 2 | 3; className?: string }) {
  const present = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== false && item.value !== "");
  const missing = items.filter((item) => !present.includes(item));
  const shown = present.map((item) => ({ label: item.label, value: item.value, wide: item.wide, mono: item.mono }));
  if (columns === 2) {
    // Facts is a two-column grid; an odd run of half-width cells would leave a filled hole, so widen the last one.
    let run = -1;
    shown.forEach((item, index) => {
      if (item.wide) { if (run >= 0 && (index - run) % 2 === 1) shown[index - 1].wide = true; run = -1; return; }
      if (run < 0) run = index;
    });
    if (run >= 0 && (shown.length - run) % 2 === 1) shown[shown.length - 1].wide = true;
  }
  return <div className={cx("space-y-2", className)}>
    {shown.length > 0 && <Facts columns={columns} items={shown} />}
    {missing.length > 0 && <details className="group text-2xs text-muted">
      <summary className="w-fit cursor-pointer select-none rounded-chip font-medium hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">未提供的字段（{missing.length}）</summary>
      <p className="mt-1.5 leading-5 text-faint">{missing.map((item) => item.label).join(" · ")}</p>
    </details>}
  </div>;
}

export function PromptCaptureSummary({ prompt, compact = false, className }: { prompt?: PromptCaptureObservation; compact?: boolean; className?: string }) {
  if (!prompt) return compact ? <span className={cx("text-2xs text-faint", className)}>提示词未提供</span> : <InlineNotice tone="neutral" icon={<ShieldQuestion />}>来源没有提供提示词采集观察。</InlineNotice>;
  const stateLabel = promptStateLabel(prompt.state);
  if (compact) return <span className={cx("flex min-w-0 items-center gap-1.5 text-2xs text-muted", className)}>
    <Pill tone={tone(prompt.state)} size="sm" icon={!prompt.readable ? <LockKeyhole /> : undefined}>{stateLabel}</Pill>
    {prompt.length !== undefined && <span className="tabular shrink-0 whitespace-nowrap">{prompt.length} 字符</span>}
    {prompt.summary && <span className="min-w-0 truncate text-faint">{prompt.summary}</span>}
  </span>;
  const reason = readableReason(prompt.reason);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone={tone(prompt.state)} icon={!prompt.readable ? <LockKeyhole /> : undefined}>{stateLabel}</Pill>
      {prompt.version && <span className="whitespace-nowrap text-2xs text-muted">版本 {prompt.version}</span>}
      {prompt.length !== undefined && <span className="tabular whitespace-nowrap text-2xs text-muted">{prompt.length} 字符</span>}
    </div>
    {prompt.summary ? <p className="rounded-control border border-line bg-panel-soft p-3 text-body-sm leading-5 text-ink-soft">{prompt.summary}</p> : <p className="text-body-sm text-muted">Owner 没有返回可展示的提示词摘要。</p>}
    <FactsWithGaps items={[
      { label: "来源", value: prompt.source ? labelFrom(sourceLabels, prompt.source) : null },
      { label: "语言", value: prompt.locale ? labelFrom(localeLabels, prompt.locale) : null },
      { label: "观察时间", value: prompt.observed_at ? formatFullTime(prompt.observed_at) : null },
      { label: "采集引用", value: prompt.capture_ref, wide: true, mono: true },
      { label: "请求引用", value: prompt.request_ref, wide: true, mono: true },
      { label: "任务引用", value: prompt.task_ref, wide: true, mono: true },
      { label: "追踪引用", value: prompt.trace_ref, wide: true, mono: true },
      { label: "内容摘要", value: prompt.digest ? <span className="break-all font-mono text-2xs">{prompt.digest}</span> : null, wide: true },
    ]} />
    {reason && <InlineNotice tone={prompt.state === "failed" || prompt.state === "blocked" ? "warning" : "neutral"}>{reason}</InlineNotice>}
    {!prompt.readable && <InlineNotice tone="neutral" icon={<LockKeyhole />}>Owner 没有授权读取原始提示词；当前只展示脱敏摘要和采集元数据。</InlineNotice>}
  </div>;
}
