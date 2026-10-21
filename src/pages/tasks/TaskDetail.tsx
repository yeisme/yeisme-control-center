import { useEffect, useRef, useState } from "react";
import { Archive, BellOff, CheckCheck, ChevronRight, Columns3, Copy, LoaderCircle, MoreHorizontal, RefreshCw, Route, ShieldQuestion } from "../../icons";
import { api, errorCode, type TaskEvent, type TaskSnapshot } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { useNotifications } from "../../app/notifications-context";
import { useObservationCache } from "../../app/observation-cache";
import { Button, CopyRef, InlineNotice, KindBadge, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, Pill, Progress, TaskStatePill, cx, ownerLabel, taskTone, useToast } from "../../components/ui";
import { ResultViewer } from "../../components/ResultViewer";
import type { MediaPreviewController } from "../../components/media-preview";
import { formatRelative } from "../../shared/read-model/format";
import { labelFrom } from "../../shared/read-model/labels";
import { connectionFor, connectionStateLabel, ownerModality, recoveryLabels, stageLabel, taskInProgress } from "../../shared/read-model/tasks";
import { observationDelay, progressLabel, contentStateMessage, taskStateLabels } from "../../task-observation";
import { reminderStateLabels, taskAllowsSafeCancel, taskDeleteAvailable } from "../../notifications";
import { createIdempotencyKey } from "../../shared/action-runner";
import { kindOf } from "../../components/ui/Kind";
import { ProcessTimeline } from "../../components/ProcessTimeline";
import { FactsWithGaps, PromptCaptureSummary } from "../../components/PromptCaptureSummary";
import type { ProcessObservation } from "../../observation-contract";
import { InspectorShell, type InspectorMode, type InspectorSection } from "../../components/InspectorShell";

const taskFamilyLabels: Record<string, string> = {
  run: "生成运行",
  image: "图像任务",
  delegation: "委托任务",
  "video-task": "视频任务",
  "voice-render-job": "配音合成",
  "music-job": "音乐生成",
  "audio-job": "音频任务",
  "local-job": "本地任务",
};

const humanize = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();

export function taskFamilyLabel(family: string | null | undefined) {
  return family ? taskFamilyLabels[family] || humanize(family) : "类型未提供";
}

const nativeStateLabels: Record<string, string> = {
  connection_lost_after_submit: "提交后连接中断",
  InvalidApiKey: "凭据无效",
};
const reviewStatusLabels: Record<string, string> = { pending_review: "待审阅", approved: "已通过", changes_requested: "需修改", rejected: "未通过" };
const exportStatusLabels: Record<string, string> = { not_exported: "未导出", exporting: "导出中", exported: "已导出", export_failed: "导出失败" };

function nativeStateLabel(value: string) {
  return nativeStateLabels[value] || taskStateLabels[value] || humanize(value);
}

interface EventState { events: TaskEvent[]; gap: boolean; next?: string; resume?: string; freshness?: "fresh" | "stale" | "unknown"; observedAt?: string; observation?: ProcessObservation; coverage?: string; reason?: string; status: "loading" | "ready" | "unavailable"; error: string | null; loadingMore: boolean }

export type TaskInspectorMode = InspectorMode;

export function TaskDetail({ task: initial, open, mode, onModeChange, preview, onOpenChange }: { task: TaskSnapshot; open: boolean; mode: TaskInspectorMode; onModeChange: (mode: TaskInspectorMode) => void; preview: MediaPreviewController; onOpenChange: (open: boolean) => void }) {
  const { scopeId, generation, session } = useWorkspace();
  const cache = useObservationCache();
  const { upsert, connections } = useTasks();
  const reminders = useNotifications();
  const notify = useToast();
  const [cancelling, setCancelling] = useState(false);
  const [task, setTask] = useState(initial);
  const [rereading, setRereading] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [events, setEvents] = useState<EventState>({ events: [], gap: false, status: "loading", error: null, loadingMore: false });
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const key = task.task_key || "";
  const active = taskInProgress(task);
  const connection = connectionFor(task, connections);

  useEffect(() => setTask(initial), [initial]);

  // InspectorShell owns Escape for the panel; while the overflow menu is open Escape must only close the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [menuOpen]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let failures = 0;
    const load = async () => {
      try {
        const after = eventsRef.current.resume;
        const page = after
          ? await api.taskEvents(scopeId, key, undefined, controller.signal, after)
          : (await cache.read(`task-events:${scopeId}:${key}`, () => api.taskEvents(scopeId, key, undefined, controller.signal), 3_000, 15_000)).data;
        if (controller.signal.aborted) return;
        failures = 0;
        setEvents((current) => {
          const merged = [...current.events, ...page.events].filter((event, index, values) => values.findIndex((item) => item.id === event.id) === index).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.occurred_at.localeCompare(b.occurred_at));
          return { ...current, events: merged, gap: current.gap || page.gap, next: page.next_cursor || current.next, resume: page.resume_cursor || current.resume, freshness: page.freshness, observedAt: page.observed_at, observation: page.observation || current.observation, coverage: page.coverage, reason: page.reason, status: "ready", error: null };
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        failures += 1;
        setEvents((current) => ({ ...current, status: current.events.length ? "ready" : "unavailable", error: errorCode(error) }));
      }
      if (active && !controller.signal.aborted) timer = window.setTimeout(() => void load(), observationDelay(true, true, document.hidden, failures));
    };
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [key, scopeId, generation, active]);

  const loadMore = async () => {
    if (!events.next || events.loadingMore) return;
    setEvents((current) => ({ ...current, loadingMore: true }));
    try {
      const page = await api.taskEvents(scopeId, key, events.next);
      setEvents((current) => ({ ...current, events: [...current.events, ...page.events.filter((event) => !current.events.some((item) => item.id === event.id))], gap: page.gap, next: page.next_cursor, resume: page.resume_cursor || current.resume, freshness: page.freshness, observedAt: page.observed_at, observation: page.observation || current.observation, coverage: page.coverage, reason: page.reason, loadingMore: false }));
    } catch (error) {
      setEvents((current) => ({ ...current, loadingMore: false, error: errorCode(error) }));
    }
  };

  const reminder = reminders.rows.find((item) => item.task_key === key && item.presence === "live") || reminders.rows.find((item) => item.task_key === key);
  const safeCancel = taskAllowsSafeCancel(task);
  const showDelete = taskDeleteAvailable();

  const reread = async () => {
    if (!key || rereading) return;
    setRereading(true);
    try {
      const next = await api.task(scopeId, key);
      setTask(next);
      upsert(next);
      notify(next.state === task.state ? "已重新读取原任务，状态未变化；未创建新的提交。" : `原任务状态已更新为「${taskStateLabels[next.state] || "结果未知"}」；未创建新的提交。`, "success");
    } catch (error) {
      notify(`原任务读取失败（${errorCode(error)}），状态保持不变。`, "warning");
    } finally {
      setRereading(false);
    }
  };

  const markReminder = async (action: "acknowledge" | "mute" | "archive") => {
    if (!reminder || !session?.csrf) return;
    try {
      if (action === "acknowledge") await api.acknowledgeNotification(scopeId, reminder.id, session.csrf);
      else if (action === "mute") await api.muteNotification(scopeId, reminder.id, session.csrf, "fingerprint");
      else await api.archiveNotification(scopeId, reminder.id, session.csrf);
      const page = await api.notifications(scopeId);
      reminders.apply(page.rows);
      notify("提醒状态已更新。任务事实没有改变。", "success");
    } catch (error) {
      notify(`提醒更新失败（${errorCode(error)}）。任务状态保持不变。`, "warning");
    }
  };

  const safeCancelTask = async () => {
    if (!safeCancel || !session?.csrf || !key || cancelling) return;
    setCancelling(true);
    try {
      const idempotencyKey = createIdempotencyKey("cancel");
      const preview = await api.previewAction({
        scope_id: scopeId,
        owner: "control-center",
        target_kind: "task",
        target_ref: key,
        action: "task.cancel",
        expected_revision: task.revision,
        idempotency_key: idempotencyKey,
        input: { confirm: true, expected_revision: task.revision, idempotency_key: idempotencyKey },
      }, session.csrf);
      if (preview.availability !== "available" || preview.blockers.length) {
        notify(preview.blockers[0] || "安全取消当前不可用。", "warning");
        return;
      }
      const receipt = await api.confirmAction({
        scope_id: scopeId,
        preview_ref: preview.preview_ref,
        preview_digest: preview.preview_digest,
        idempotency_key: idempotencyKey,
      }, session.csrf);
      const next = await api.task(scopeId, key);
      setTask(next);
      upsert(next);
      notify(receipt.state === "unknown" ? "取消结果未知，已保留恢复查询，未删除任务。" : "已提交安全取消。任务记录仍然保留。", receipt.state === "unknown" ? "warning" : "success");
    } catch (error) {
      notify(`安全取消没有完成（${errorCode(error)}）。任务没有被删除。`, "warning");
    } finally {
      setCancelling(false);
    }
  };

  const recovery = task.provider_recovery;
  const progress = progressLabel(task.progress);
  const percent = task.progress.kind === "percent" && task.progress.percent !== null ? task.progress.percent : task.progress.kind === "count" && task.progress.total ? Math.round(((task.progress.completed || 0) / task.progress.total) * 100) : null;
  const stateTone = taskTone(task.state);
  const progressTone = stateTone === "success" || stateTone === "danger" ? stateTone : "neutral";
  const stageText = stageLabel(task.stage);
  const showStage = !!task.stage && task.stage !== task.state && stageText !== taskStateLabels[task.state];
  const canAcknowledge = !!reminder && reminder.state !== "acknowledged";
  const canMute = !!reminder && reminder.state !== "muted";
  const canArchive = !!reminder && reminder.state !== "archived";
  const hasMoreActions = canAcknowledge || canMute || canArchive || showDelete;
  const processBase = events.observation || task.process || (events.coverage ? {
    schema_version: "yeisme.process_observation.v1" as const,
    state: "unknown" as const,
    freshness: events.freshness || "unknown",
    coverage: events.coverage as ProcessObservation["coverage"],
    observed_at: events.observedAt || new Date().toISOString(),
    checkpoints: [],
    gap: events.gap,
  } : undefined);
  const processObservation = processBase ? {
    ...processBase,
    checkpoints: events.events.length ? events.events.map((event) => ({
      id: event.id,
      sequence: event.sequence,
      occurred_at: event.occurred_at,
      kind: (event.kind as never) || "unknown",
      stage: event.stage,
      state: event.state,
      summary: event.summary,
      reason_code: event.reason_code,
      duration_ms: event.duration_ms,
      attempt_ref: event.attempt_ref,
      progress: event.progress,
      evidence_refs: event.evidence_refs,
      prompt_capture: event.prompt_capture,
    })) : processBase.checkpoints,
    gap: events.gap,
    next_cursor: events.next,
    resume_cursor: events.resume,
    freshness: events.freshness || processBase.freshness,
    observed_at: events.observedAt || processBase.observed_at,
  } : undefined;
  const promptCapture = task.prompt_capture || processObservation?.prompt_capture || events.events.find((event) => event.prompt_capture)?.prompt_capture;

  return <TaskInspectorFrame
    open={open}
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={() => setMaximized((value) => !value)}
    onClose={() => onOpenChange(false)}
    eyebrow={<span className="inline-flex items-center gap-1.5">{ownerLabel(task.locator.owner)} · {taskFamilyLabel(task.locator.task_family)}</span>}
    title={task.title}
    description={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"><TaskStatePill state={task.state} />{showStage && <span>{stageText}</span>}{reminder && <Pill size="sm" tone={reminder.state === "unread" ? "warning" : "neutral"}>提醒{reminderStateLabels[reminder.state] || "状态未提供"}</Pill>}</span>}
    context={<span className="inline-flex min-w-0 items-center gap-1.5"><span className="shrink-0">任务中心</span><ChevronRight className="size-3 shrink-0 text-faint" /><span className="truncate">{connection?.label || ownerLabel(task.locator.owner)}</span></span>}
    icon={<KindBadge kind={kindOf(task.results[0]?.mime, ownerModality[task.locator.owner])} size="md" />}
    reference={<CopyRef value={task.locator.task_ref} label="任务引用" />}
    sections={[
      { id: "overview", label: "概况" },
      ...(task.results.length > 0 ? [{ id: "results", label: `结果 ${task.results.length}` }] : []),
      ...(recovery ? [{ id: "recovery", label: "恢复" }] : []),
      { id: "prompt", label: "提示词采集" },
      { id: "process", label: "采集与过程" },
      { id: "reference", label: "原始引用" },
    ]}
    footer={<div className="flex flex-wrap items-center gap-2">
      <Button variant={task.state === "unknown" ? "primary" : "secondary"} size="sm" disabled={rereading} onClick={() => void reread()} icon={rereading ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <RefreshCw className="size-3.5" />}>重新读取原任务</Button>
      {safeCancel && <Button size="sm" variant="danger" disabled={cancelling} data-safe-cancel="true" onClick={() => void safeCancelTask()}>{cancelling ? "正在取消" : "安全取消"}</Button>}
      {hasMoreActions && <MenuRoot modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger asChild><Button size="sm" variant="ghost" className="ml-auto" aria-label="更多操作" icon={<MoreHorizontal className="size-4" />}>更多</Button></MenuTrigger>
        <MenuContent align="end" className="z-[70]!">
          {canAcknowledge && <MenuItem icon={<CheckCheck />} disabled={!session?.csrf} onSelect={() => void markReminder("acknowledge")}>确认提醒</MenuItem>}
          {canMute && <MenuItem icon={<BellOff />} disabled={!session?.csrf} onSelect={() => void markReminder("mute")}>对该任务免提醒</MenuItem>}
          {canArchive && <MenuItem icon={<Archive />} disabled={!session?.csrf} onSelect={() => void markReminder("archive")}>归档提醒</MenuItem>}
          {showDelete && <>{reminder && <MenuSeparator />}<MenuItem tone="danger">删除任务</MenuItem></>}
        </MenuContent>
      </MenuRoot>}
    </div>}
  >
    <div className="space-y-5">
      {task.state === "unknown" && <InlineNotice tone="warning" icon={<ShieldQuestion />}>结果尚未确认：来源没有返回可判定的终态。请只重新读取原任务；不要据此重新提交生成。</InlineNotice>}

      <section id="task-inspector-overview" data-inspector-section="overview" tabIndex={-1} aria-label="执行进度" className="scroll-mt-24 rounded-card border border-line bg-panel-soft p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body-sm font-medium text-ink-soft">执行进度</p>
          {percent !== null && <p className="tabular text-sm font-semibold text-ink">{progress}</p>}
        </div>
        <Progress value={percent} label="进度" tone={progressTone} className="mt-2.5" />
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs text-muted sm:grid-cols-4">
          <span>创建 {formatRelative(task.created_at)}</span>
          <span>开始 {task.started_at ? formatRelative(task.started_at) : "未提供"}</span>
          <span>更新 {task.updated_at ? formatRelative(task.updated_at) : "未提供"}</span>
          <span>观察 {formatRelative(task.observed_at)}</span>
        </div>
      </section>

      {task.results.length > 0 && <section id="task-inspector-results" data-inspector-section="results" tabIndex={-1} aria-label="结果" className="scroll-mt-24 space-y-2">
        <h3 className="text-body-sm font-semibold text-ink">结果 <span className="font-normal text-muted">{task.results.length}</span></h3>
        {connection?.runtime && connection.runtime.content !== "supported" && <p className="text-2xs text-muted">{contentStateMessage(connection.runtime.content)}</p>}
        <div className="space-y-2">
          {task.results.map((result) => <ResultViewer key={result.ref} task={task} result={result} kind={kindOf(result.mime, ownerModality[task.locator.owner])} preview={preview} />)}
        </div>
      </section>}

      {recovery && <section id="task-inspector-recovery" data-inspector-section="recovery" tabIndex={-1} aria-label="Provider 恢复状态" className="scroll-mt-24 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-body-sm font-semibold text-ink">Provider 恢复状态</h3>
          <Pill tone={recovery.state === "generated" ? "success" : recovery.state === "submission_unknown" ? "warning" : recovery.state === "accepted_pending" ? "info" : recovery.state === "blocked" || recovery.state === "rejected_no_generation" ? "danger" : "neutral"}>{labelFrom(recoveryLabels, recovery.state, "状态未提供")}</Pill>
        </div>
        <FactsWithGaps items={[
          { label: "提交引用", value: recovery.submission_ref ? <CopyRef value={recovery.submission_ref} label="提交引用" /> : null, wide: true },
          { label: "绑定", value: recovery.binding_id, mono: true },
          { label: "Provider 状态", value: recovery.native_state ? <span title={recovery.native_state}>{nativeStateLabel(recovery.native_state)}</span> : null },
          { label: "错误", value: recovery.error_code ? <span title={recovery.error_code}>{nativeStateLabel(recovery.error_code)}</span> : "无" },
          { label: "可安全重投", value: recovery.safe_to_resubmit === null ? null : recovery.safe_to_resubmit ? "owner 声明可以" : "否" },
          { label: "审阅", value: recovery.review_status ? labelFrom(reviewStatusLabels, recovery.review_status) : null },
          { label: "导出", value: recovery.export_status ? labelFrom(exportStatusLabels, recovery.export_status) : null },
        ]} />
        {(recovery.blocker || recovery.safe_to_resubmit === false) && <InlineNotice tone="warning">{recovery.blocker || "owner 声明不可重投；只做原任务对账。"}</InlineNotice>}
      </section>}

      <section id="task-inspector-prompt" data-inspector-section="prompt" tabIndex={-1} aria-label="提示词采集" className="scroll-mt-24 space-y-2">
        <h3 className="text-body-sm font-semibold text-ink">提示词采集</h3>
        <PromptCaptureSummary prompt={promptCapture} />
      </section>

      <section id="task-inspector-process" data-inspector-section="process" tabIndex={-1} aria-label="采集与过程" className="scroll-mt-24 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-body-sm font-semibold text-ink">采集与过程</h3>
          {events.status === "ready" && active && <span className="text-2xs text-muted">执行中，自动刷新</span>}
        </div>
        <ProcessTimeline
          observation={processObservation}
          reason={events.reason}
          loading={events.status === "loading"}
          error={events.status === "unavailable" ? events.error : null}
          onRetry={() => { setEvents((current) => ({ ...current, status: "loading", error: null })); void api.taskEvents(scopeId, key).then((page) => setEvents({ events: page.events, gap: page.gap, next: page.next_cursor, resume: page.resume_cursor, freshness: page.freshness, observedAt: page.observed_at, observation: page.observation, coverage: page.coverage, reason: page.reason, status: "ready", error: null, loadingMore: false })).catch((error) => setEvents((current) => ({ ...current, status: "unavailable", error: errorCode(error) }))); }}
          onLoadMore={events.next ? () => void loadMore() : undefined}
        />
      </section>

      <section id="task-inspector-reference" data-inspector-section="reference" tabIndex={-1} aria-label="定位" className="scroll-mt-24 space-y-2">
        <h3 className="text-body-sm font-semibold text-ink">原始引用</h3>
        <FactsWithGaps items={[
          { label: "任务引用", value: <CopyRef value={task.locator.task_ref} label="任务引用" />, wide: true },
          { label: "Owner 项目", value: task.locator.project, mono: true },
          { label: "连接", value: connection ? `${connection.label} · ${connectionStateLabel(connection.state)}` : task.connection_id },
          { label: "修订号", value: task.revision ? <span className="font-mono text-xs">{task.revision}</span> : null },
          { label: "覆盖度", value: task.coverage === "complete" ? "完整" : "部分字段" },
          { label: "执行者", value: task.actor },
          { label: "来源", value: task.source },
          ...(task.native_state && task.native_state !== task.state ? [{ label: "来源状态", value: <span title={task.native_state}>{nativeStateLabel(task.native_state)}</span> }] : []),
          ...(task.episode_ref ? [{ label: "分集", value: task.episode_ref }] : []),
          ...(task.parent_ref ? [{ label: "父引用", value: <CopyRef value={task.parent_ref} label="父引用" /> }] : []),
        ]} />
        {task.work_url && <a href={task.work_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-body-sm font-medium text-info hover:underline"><Route className="size-4" />在片场打开对应作品</a>}
      </section>
    </div>
  </TaskInspectorFrame>;
}

export function TaskInspectorFrame({ open, mode, maximized, onModeChange, onMaximize, onClose, eyebrow, title, description, context, icon, reference, sections, footer, children }: {
  open: boolean;
  mode: TaskInspectorMode;
  maximized: boolean;
  onModeChange: (mode: TaskInspectorMode) => void;
  onMaximize: () => void;
  onClose: () => void;
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  context: React.ReactNode;
  icon: React.ReactNode;
  reference: React.ReactNode;
  sections: { id: string; label: string }[];
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const header = <div className="flex items-start gap-3">
    <span className="mt-0.5 shrink-0">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="text-2xs font-medium text-muted">{eyebrow}</p>
      <h2 className="mt-0.5 break-words text-title font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <div className="mt-1 text-body-sm text-muted">{description}</div>
    </div>
  </div>;
  const meta = <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-muted">
    <span className="flex min-w-0 items-center gap-1.5"><Columns3 className="size-3.5 shrink-0 text-faint" /><span className="min-w-0 truncate">{context}</span></span>
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel-soft px-2 py-0.5 text-muted"><Copy className="size-3" />引用</span>
      <span className="min-w-0 truncate">{reference}</span>
    </span>
  </div>;
  return <InspectorShell
    open={open}
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={onMaximize}
    onClose={onClose}
    label="任务"
    ariaLabel="任务详情"
    dataAttribute="data-task-inspector"
    header={header}
    meta={meta}
    sections={sections as InspectorSection[]}
    footer={footer}
  >{children}</InspectorShell>;
}
