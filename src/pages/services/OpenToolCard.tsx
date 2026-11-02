import { ArrowRight, Clock3 } from "../../icons";
import { Button, Dot, InlineNotice, Pill, cx, type Tone } from "../../components/ui";
import { formatBytes, formatCount, formatDurationMs, formatRelative } from "../../shared/read-model/format";
import { reasonLabel } from "../../shared/read-model/labels";
import type { CredentialStatus } from "../../shared/credentials";
import { CredentialLine } from "./CredentialsPanel";
import {
  openToolOperationStateLabels,
  openToolStateLabels,
  type OpenToolCheckState,
  type OpenToolOperation,
  type OpenToolOperationState,
  type OpenToolProjection,
  type OpenToolState,
} from "../../shared/open-tools";

const stateTone: Record<OpenToolState, Tone> = { ready: "success", degraded: "warning", unavailable: "danger", forbidden: "danger", needs_contract: "review", rate_limited: "warning" };
const checkTone: Record<OpenToolCheckState, Tone> = { ok: "success", failed: "danger", forbidden: "danger", needs_contract: "review", unavailable: "danger", rate_limited: "warning" };
const runTone: Record<OpenToolOperationState, Tone> = { queued: "neutral", running: "info", succeeded: "success", failed: "danger", cancelled: "neutral", unknown: "warning" };
const backendTone = { ready: "success", degraded: "warning", down: "danger", disabled: "neutral", unknown: "neutral" } as const satisfies Record<string, Tone>;
const backendLabels = { ready: "可用", degraded: "部分异常", down: "不可用", disabled: "已停用", unknown: "未检查" } as const;
const toneText: Record<Tone, string> = { success: "text-success", info: "text-info", warning: "text-warning", danger: "text-danger", review: "text-review", neutral: "text-muted" };

function progressText(run: OpenToolOperation) {
  if (!run.progress || run.progress.total <= 0) return run.size_bytes ? formatBytes(run.size_bytes) : null;
  const percent = Math.min(100, Math.floor((run.progress.done / run.progress.total) * 100));
  return run.progress.unit === "files" ? `${run.progress.done}/${run.progress.total} 个文件` : `${formatBytes(run.progress.total)} · ${percent}%`;
}

function RunRow({ run }: { run: OpenToolOperation }) {
  const progress = progressText(run);
  return <li className="flex min-w-0 items-center gap-2 py-1.5 text-meta">
    <Dot tone={runTone[run.state]} />
    <span className="min-w-0 flex-1 truncate text-ink-soft">{run.label}{run.backend ? <span className="text-muted"> · {run.backend}</span> : null}{progress ? <span className="text-muted tabular"> · {progress}</span> : null}{run.error_code ? <span className="text-muted"> · {reasonLabel(run.error_code) || run.error_code}</span> : null}</span>
    <span className={cx("shrink-0 font-medium", toneText[runTone[run.state]])} title={run.error_code ? reasonLabel(run.error_code) || run.error_code : run.native_state}>{openToolOperationStateLabels[run.state]}</span>
    <span className="shrink-0 text-2xs text-muted tabular">{formatRelative(run.updated_at)}</span>
  </li>;
}

/** One open tool on the services page: health checks, then runs, backends and usage as the tool reports them. */
export function OpenToolCard({ name, purpose, tool, credential, now, onQueue, onCatalog }: { name: string; purpose: string; tool: OpenToolProjection; credential?: CredentialStatus; now: number; onQueue: () => void; onCatalog?: () => void }) {
  const tone = stateTone[tool.state];
  const reason = tool.state !== "ready" && tool.reason ? reasonLabel(tool.reason) : null;
  const counts = tool.operations.counts;
  const active = counts.running + counts.queued;
  const backends = tool.backends || [];
  const healthy = backends.filter((backend) => backend.enabled && backend.state === "ready").length;
  const shownRuns = (tool.operations.attention.length ? tool.operations.attention : tool.operations.recent).slice(0, 5);
  return <article data-open-tool={tool.tool} className="flex min-w-0 flex-col rounded-card border border-line bg-panel p-4 shadow-panel">
    <header className="flex items-start gap-3">
      <Dot tone={tone} className="mt-2" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-body-sm font-semibold text-ink">{tool.label}</h3>
        <p className="truncate text-2xs text-muted">{name} · {purpose}</p>
      </div>
      {tool.state === "ready" ? <span className={cx("shrink-0 text-meta font-medium", toneText.success)}>可读</span> : <Pill tone={tone}>{openToolStateLabels[tool.state]}</Pill>}
    </header>
    <ul aria-label="读取检查" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-ink-soft">
      {tool.checks.map((check) => {
        // A read the credential was not granted, on a tool that is otherwise fine, is information, not an alarm.
        const tone: Tone = check.state === "forbidden" && tool.state === "ready" ? "neutral" : checkTone[check.state];
        return <li key={check.id} className="inline-flex items-center gap-1.5" title={check.reason ? reasonLabel(check.reason) || check.reason : check.label}>
        <Dot tone={tone} />
        <span>{check.label}</span>
        {check.state !== "ok" && <span className={cx("font-medium", toneText[tone])}>{check.state === "needs_contract" ? "待接口" : check.state === "forbidden" ? (tool.state === "ready" ? "未授权" : "无权限") : check.state === "rate_limited" ? "限流" : "失败"}</span>}
      </li>;
      })}
    </ul>
    {tool.facts.length > 0 && <p className="mt-2 truncate text-2xs text-muted">{tool.facts.map((fact) => `${fact.label} ${fact.value}`).join(" · ")}</p>}
    <OpenToolDetails tool={tool} active={active} healthy={healthy} shownRuns={shownRuns} />
    {reason && <InlineNotice tone={tone === "danger" ? "danger" : "warning"} className="mt-3 py-2 text-2xs">原因：{reason}</InlineNotice>}
    <footer className="mt-auto pt-4 text-2xs text-muted">
      {credential && <CredentialLine row={credential} now={now} />}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5"><Clock3 className="size-3.5 shrink-0" /><span className="truncate">{tool.freshness === "stale" ? `显示 ${formatRelative(tool.observed_at)} 的读数` : `观察于 ${formatRelative(tool.observed_at)}`}</span></span>
        <span className="flex shrink-0 items-center gap-1">
          {onCatalog && <Button size="sm" variant="ghost" onClick={onCatalog}>工具目录</Button>}
          <Button size="sm" variant="ghost" onClick={onQueue}>工作台<ArrowRight className="size-3.5" /></Button>
        </span>
      </div>
    </footer>
  </article>;
}

function OpenToolDetails({ tool, active, healthy, shownRuns }: { tool: OpenToolProjection; active: number; healthy: number; shownRuns: OpenToolOperation[] }) {
  const counts = tool.operations.counts;
  const backends = tool.backends || [];
  const usage = tool.usage;
  return <>
    {backends.length > 0 && <div className="mt-3">
      <p className="text-2xs text-muted">后端 <span className="tabular">{healthy}/{backends.filter((backend) => backend.enabled).length}</span> 可用{backends.some((backend) => !backend.enabled) ? <span className="tabular"> · 停用 {backends.filter((backend) => !backend.enabled).length}</span> : null}</p>
      <ul aria-label="后端" className="mt-1 flex flex-wrap gap-1.5">
        {backends.slice(0, 12).map((backend) => <li key={backend.id}><Pill size="sm" tone={backendTone[backend.state]} title={backend.tool_count === null ? undefined : `${backend.tool_count} 个工具`}>{backend.id}{backend.state === "ready" ? "" : ` · ${backendLabels[backend.state]}`}</Pill></li>)}
        {backends.length > 12 && <li className="text-2xs text-muted">另 {backends.length - 12} 个</li>}
      </ul>
    </div>}
    {usage && <p className="mt-2 text-2xs text-muted tabular">近 {usage.window}调用 {formatCount(usage.calls)} 次 · 失败 {formatCount(usage.failures)}{usage.p95_ms !== null ? ` · p95 ${formatDurationMs(usage.p95_ms)}` : ""}</p>}
    {tool.operations.coverage !== "not_recorded" && <div className="mt-3">
      <p className="text-2xs text-muted tabular">运行：进行中 {active} · 失败 {counts.failed} · 结果未知 {counts.unknown}{tool.operations.attention.length ? " · 下面是近 7 天要处理的" : ""}</p>
      {shownRuns.length ? <ul aria-label="最近运行" className="mt-1 divide-y divide-line">{shownRuns.map((run) => <RunRow key={run.ref} run={run} />)}</ul> : <p className="mt-1 text-meta text-muted">没有运行记录。</p>}
    </div>}
  </>;
}
