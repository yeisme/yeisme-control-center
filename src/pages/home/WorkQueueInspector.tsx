import { useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, CircleDashed, Clock3, Eye, LockKeyhole, Route, ShieldQuestion } from "../../icons";
import { api, errorCode } from "../../shared/api/control-center-client";
import type { WorkQueueAction, WorkQueueItem, WorkQueueKind, WorkQueuePreviewState, WorkQueuePriority } from "../../shared/work-queue";
import type { ActionOwner, ControlAction } from "../../shared/action-contract";
import { creativeFlowStages } from "../../shared/creative-flow";
import { TaskInspectorFrame, type TaskInspectorMode } from "../tasks/TaskDetail";
import { useWorkspace } from "../../app/workspace";
import { OwnerLinkRow } from "../../components/OwnerLinkRow";
import { Button, CopyRef, CoverageChip, Facts, InlineNotice, Pill, TaskStatePill, Unknown, ownerLabel, useToast, type Tone } from "../../components/ui";
import { createIdempotencyKey } from "../../shared/action-runner";
import { formatFullTime, formatRelative } from "../../shared/read-model/format";
import { freshnessLabels, reasonLabel } from "../../shared/read-model/labels";
import { actionReasonLabel, connectionStateLabel, connectionTone } from "../../shared/read-model/tasks";
import { taskStateLabels } from "../../task-observation";

const knownActions = new Set<string>([
  "task.cancel",
  "provider_runs.create",
  "provider_runs.reconcile",
  "review.request_changes",
  "review.approve",
  "delivery.prepare",
  "delivery.send",
  "admin.user.create",
  "admin.user.revoke",
  "owner.config.update",
  "owner.membership.update",
]);

export const workQueueKindLabels: Record<WorkQueueKind, string> = {
  task_failure: "任务失败",
  task_unknown: "结果未知",
  review_required: "待审阅",
  handoff_ready: "可交接",
  service_blocked: "来源受阻",
  contract_gap: "合同缺口",
};
export const workQueuePriorityLabels: Record<WorkQueuePriority, string> = { critical: "紧急", high: "较高", normal: "普通", low: "较低" };
export const workQueuePriorityTone: Record<WorkQueuePriority, Tone> = { critical: "danger", high: "warning", normal: "neutral", low: "neutral" };

const previewStateLabels: Record<WorkQueuePreviewState, string> = { available: "可预览", needs_contract: "待合同", forbidden: "无权限", unavailable: "不可用", not_applicable: "不适用" };
const freshnessTone: Record<WorkQueueItem["freshness"], Tone> = { fresh: "success", stale: "warning", unknown: "neutral" };
const stageLabels: Record<string, string> = {
  screenplay: "剧本",
  director_plan: "导演计划",
  creative_storyboard: "创意分镜",
  production_handoff: "制作交接",
  production_breakdown: "制作拆解",
};
const objectKindLabels: Record<string, string> = {
  ...stageLabels,
  storyboard: "分镜",
  storyboard_breakdown: "分镜拆解",
  creative_flow: "创作流程",
  breakdown: "制作拆解",
  handoff: "交接",
};
const actionLabels: Record<string, string> = {
  "task.cancel": "取消任务",
  "provider_runs.create": "创建 Provider 运行",
  "provider_runs.reconcile": "回查 Provider 运行",
  "review.request_changes": "要求修改",
  "review.approve": "通过审阅",
  "delivery.prepare": "准备交付",
  "delivery.send": "发送交付",
  "admin.user.create": "创建用户",
  "admin.user.revoke": "撤销用户",
  "owner.config.update": "更新 owner 配置",
  "owner.membership.update": "更新 owner 成员",
  "notification.acknowledge": "确认提醒",
  "service.inspect": "检查服务",
  cancel: "取消任务",
  preview: "预览结果",
  download: "下载结果",
};
const reasonWords: Record<string, string> = {
  pending_review: "待审阅",
  changes_requested: "需要修改",
  approved: "已通过",
  rejected: "未通过",
  blocked: "受阻",
  stale: "数据过期",
  missing: "缺失",
  unknown: "结果未知",
  unavailable: "来源不可用",
  forbidden: "无读取权限",
  needs_contract: "缺少观测合同",
  not_exported: "未导出",
};
const readableToken = /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)*$/;

export function workQueueOwnerLabel(owner: string) {
  return owner === "control-center" ? "控制中心" : ownerLabel(owner);
}

/** Owner-provided reasons are sometimes machine codes; readable owner text passes through unchanged. */
export function workQueueReasonLabel(reason: string | null | undefined) {
  const text = (reason || "").trim();
  if (!text) return "原因未提供";
  if (!readableToken.test(text)) return text;
  if (reasonWords[text]) return reasonWords[text];
  const connection = connectionStateLabel(text);
  if (connection !== text) return connection;
  return taskStateLabels[text] || reasonLabel(text) || text;
}

const actionLabel = (action: string) => actionLabels[action] || action.replace(/[._]/g, " ");
const labelFor = (map: Record<string, string>, key: string) => map[key] || key.replace(/_/g, " ");

const workStateIcons: Record<Tone, ReactNode> = { success: <CheckCircle2 />, info: <Clock3 />, warning: <ShieldQuestion />, danger: <CircleAlert />, review: <Eye />, neutral: <CircleDashed /> };

/** Work items mix task states with connection and workflow states; none of them may render as a raw code. */
export function WorkStatePill({ state }: { state: string }) {
  if (taskStateLabels[state]) return <TaskStatePill state={state} />;
  const connection = connectionStateLabel(state);
  const known = connection !== state;
  const tone: Tone = state.includes("contract") ? "review" : known ? connectionTone(state) : state === "stale" || state === "missing" ? "warning" : state === "forbidden" || state === "unavailable" || state === "conflict" ? "danger" : state === "ready" || state === "accepted" ? "success" : "warning";
  return <Pill tone={tone} icon={workStateIcons[tone]}>{known ? connection : workQueueReasonLabel(state)}</Pill>;
}

export function WorkQueueInspector({ item, open, mode, onModeChange, onClose, onNavigate }: {
  item: WorkQueueItem | null;
  open: boolean;
  mode: TaskInspectorMode;
  onModeChange: (mode: TaskInspectorMode) => void;
  onClose: () => void;
  onNavigate: (target: string) => void;
}) {
  const { scopeId, session } = useWorkspace();
  const notify = useToast();
  const [maximized, setMaximized] = useState(false);
  const [preview, setPreview] = useState<{ state: "idle" | "loading" | "ready" | "error"; message?: string; digest?: string; blockers?: string[]; normalized?: Record<string, unknown> }>({ state: "idle" });
  if (!item) return null;

  const previewAction = async (action: string) => {
    if (!session?.csrf || !knownActions.has(action) || item.allowed_actions.find((candidate) => candidate.action === action)?.preview_state !== "available") return;
    setPreview({ state: "loading" });
    try {
      const idempotencyKey = createIdempotencyKey("queue-preview");
      const result = await api.previewAction({
        scope_id: scopeId,
        owner: (item.owner === "muweave" ? "control-center" : item.owner) as ActionOwner,
        target_kind: item.kind,
        target_ref: item.source_ref,
        action: action as ControlAction,
        expected_revision: item.revision || "0",
        idempotency_key: idempotencyKey,
        input: { source_ref: item.source_ref, work_ref: item.work_ref, expected_revision: item.revision || "0" },
      }, session.csrf);
      setPreview({ state: "ready", digest: result.preview_digest, blockers: result.blockers, normalized: result.normalized_input });
    } catch (error) {
      const code = errorCode(error);
      setPreview({ state: "error", message: code });
      notify(`动作预览失败（${workQueueReasonLabel(code)}）。没有执行 Owner 写入。`, "warning");
    }
  };

  const blockedReason = (candidate: WorkQueueAction) => {
    if (!candidate.enabled) return actionReasonLabel(candidate.reason);
    if (candidate.preview_state !== "available") return `预览状态：${previewStateLabels[candidate.preview_state]}`;
    if (!knownActions.has(candidate.action)) return "控制中心尚未支持预览该动作";
    if (!session?.csrf) return "当前会话没有预览权限";
    return undefined;
  };

  const episodeRef = item.workflow_stage ? item.safe_links.find((link) => link.kind === "owner" && link.launch?.episode_ref)?.launch?.episode_ref : undefined;
  const internalLinks = item.safe_links.filter((link) => link.kind === "control-center");
  const ownerLinks = item.safe_links.filter((link) => link.kind === "owner");
  const reason = workQueueReasonLabel(item.attention_reason);
  return <TaskInspectorFrame
    open={open}
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={() => setMaximized((value) => !value)}
    onClose={onClose}
    eyebrow={<span>{workQueueOwnerLabel(item.owner)} · {workQueueKindLabels[item.kind] || item.kind.replace(/_/g, " ")}</span>}
    title={item.title}
    description={<span className="inline-flex flex-wrap items-center gap-2"><span>{reason}</span><WorkStatePill state={item.state} /><Pill tone={workQueuePriorityTone[item.priority]}>优先级 {workQueuePriorityLabels[item.priority] || item.priority}</Pill></span>}
    context={<span className="inline-flex min-w-0 items-center gap-1.5"><span>工作台</span><ArrowRight className="size-3 shrink-0 text-faint" /><span>{item.project || "项目未提供"}</span></span>}
    icon={<span className="grid size-8 place-items-center rounded-control bg-panel-soft text-info"><Eye className="size-4" /></span>}
    reference={<CopyRef value={item.source_ref} label="来源引用" />}
    sections={[{ id: "overview", label: "概况" }, { id: "flow", label: "流程链" }, { id: "evidence", label: "证据" }, { id: "actions", label: "动作" }, { id: "handoff", label: "交接" }]}
    footer={<div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={onClose}>关闭</Button><span className="ml-auto flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3" />只读观察；Preview 不会 Confirm</span></div>}
  >
    <div className="space-y-5">
      {item.preview_state === "needs_contract" && <InlineNotice tone="warning">Owner 尚未提供可执行合同。当前只展示安全引用和恢复边界。</InlineNotice>}
      <section id="work-queue-inspector-overview" data-inspector-section="overview" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-body-sm font-semibold text-ink">工作项概况</h3>
        <Facts columns={2} items={[
          { label: "状态", value: <WorkStatePill state={item.state} /> },
          { label: "覆盖度", value: <CoverageChip state={item.coverage} /> },
          { label: "来源新鲜度", value: <Pill tone={freshnessTone[item.freshness] || "neutral"}>{freshnessLabels[item.freshness] || "未观察"}</Pill> },
          { label: "观察时间", value: <span title={formatFullTime(item.observed_at)}>{formatRelative(item.observed_at)}</span> },
          { label: "Revision", value: item.revision ? <span className="font-mono text-xs break-all">{item.revision}</span> : <Unknown /> },
          { label: "项目", value: item.project || <Unknown /> },
        ]} />
      </section>

      <section id="work-queue-inspector-flow" data-inspector-section="flow" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-body-sm font-semibold text-ink">流程链</h3>
        {item.workflow_stage ? <>
          <div className="rounded-control border border-line bg-panel-soft p-3 text-body-sm text-muted">当前阶段：<span className="font-medium text-ink">{labelFor(stageLabels, item.workflow_stage)}</span>{item.object_kind ? ` · ${labelFor(objectKindLabels, item.object_kind)}` : ""}</div>
          <ol aria-label="剧本到分镜流程" className="flex flex-wrap items-center gap-1.5 text-2xs text-muted">
            {creativeFlowStages.map((stage, index) => <li key={stage} aria-current={stage === item.workflow_stage ? "step" : undefined} className="inline-flex items-center gap-1.5">
              {index > 0 && <ArrowRight aria-hidden="true" className="size-3 text-faint" />}
              <span className={stage === item.workflow_stage ? "rounded-chip bg-info-soft px-2 py-1 font-medium text-info" : "rounded-chip border border-line px-2 py-1"}>{stageLabels[stage]}</span>
            </li>)}
          </ol>
          {item.lineage_refs?.length ? <div className="space-y-1"><p className="text-2xs text-muted">安全引用</p><div className="flex flex-wrap gap-1.5">{[...new Set(item.lineage_refs)].map((ref) => <CopyRef key={ref} value={ref} label="引用" />)}</div></div> : null}
          {episodeRef && <Button size="sm" variant="secondary" icon={<ArrowRight className="size-3.5" />} onClick={() => onNavigate(`/drama?episode=${encodeURIComponent(episodeRef)}`)}>在剧集制作中查看这一集</Button>}
        </> : <p className="text-body-sm text-muted">当前工作项不属于剧本到分镜流程。</p>}
      </section>

      <section id="work-queue-inspector-evidence" data-inspector-section="evidence" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-body-sm font-semibold text-ink">来源证据</h3>
        <div className="rounded-control border border-line bg-panel-soft p-3 text-body-sm text-muted">{reason}</div>
        <Facts columns={1} items={[
          { label: "工作项引用", value: <CopyRef value={item.work_ref} label="工作项引用" /> },
          { label: "来源引用", value: <CopyRef value={item.source_ref} label="来源引用" /> },
          ...(item.task_ref ? [{ label: "任务引用", value: <CopyRef value={item.task_ref} label="任务引用" /> }] : []),
          ...(item.operation_ref ? [{ label: "操作引用", value: <CopyRef value={item.operation_ref} label="操作引用" /> }] : []),
        ]} />
      </section>

      <section id="work-queue-inspector-actions" data-inspector-section="actions" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-body-sm font-semibold text-ink">动作 Preview</h3>
        {preview.state === "ready" && <InlineNotice tone={preview.blockers?.length ? "warning" : "info"}>{preview.blockers?.length ? preview.blockers.map((blocker) => workQueueReasonLabel(blocker)).join("；") : `Preview 已生成：${preview.digest || "digest 未提供"}。没有执行 Confirm。`}</InlineNotice>}
        {preview.state === "error" && <InlineNotice tone="warning">Preview 读取失败：{workQueueReasonLabel(preview.message)}。没有执行 Owner 写入。</InlineNotice>}
        <div className="space-y-2">
          {item.allowed_actions.length === 0 ? <p className="text-body-sm text-muted">当前来源没有声明动作。</p> : item.allowed_actions.map((candidate) => {
            const blocked = blockedReason(candidate);
            return <div key={candidate.action} className="flex items-center gap-3 rounded-control border border-line bg-panel-soft p-3">
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm font-medium text-ink" title={candidate.action}>{actionLabel(candidate.action)}</span>
                <span className="mt-0.5 block text-2xs text-muted">{candidate.reason ? actionReasonLabel(candidate.reason) : previewStateLabels[candidate.preview_state]}</span>
              </span>
              <Button size="sm" variant="ghost" disabled={Boolean(blocked) || preview.state === "loading"} disabledReason={blocked} onClick={() => void previewAction(candidate.action)}>Preview</Button>
            </div>;
          })}
        </div>
        {preview.normalized && <details className="rounded-control border border-line bg-panel-soft">
          <summary className="cursor-pointer select-none rounded-control px-3 py-2 text-meta font-medium text-muted hover:text-ink">原始预览数据</summary>
          <pre className="max-h-48 overflow-auto border-t border-line bg-panel-sunken p-3 text-2xs text-muted">{JSON.stringify(preview.normalized, null, 2)}</pre>
        </details>}
      </section>

      <section id="work-queue-inspector-handoff" data-inspector-section="handoff" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-body-sm font-semibold text-ink">安全交接</h3>
        <div className="space-y-2">
          {internalLinks.map((link) => <Button key={`${link.target}:${link.ref || ""}`} size="sm" variant="secondary" onClick={() => onNavigate(`/${link.target}${link.ref ? `?${link.target === "tasks" ? "task" : "ref"}=${encodeURIComponent(link.ref)}` : ""}`)} icon={<ArrowRight className="size-3.5" />}>{link.label}</Button>)}
          {ownerLinks.map((link) => <OwnerLinkRow key={`${link.target}:${link.launch?.target_route || ""}`} link={link} />)}
          {!internalLinks.length && !ownerLinks.length && <p className="text-body-sm text-muted">当前工作项没有安全交接入口。</p>}
        </div>
      </section>
    </div>
  </TaskInspectorFrame>;
}
