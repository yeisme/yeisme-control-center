import { useState, type ReactNode } from "react";
import { ArrowRight, Eye, LockKeyhole, Route } from "../../icons";
import { api, errorCode } from "../../shared/api/control-center-client";
import type { WorkQueueItem } from "../../shared/work-queue";
import type { ActionOwner, ControlAction } from "../../shared/action-contract";
import { TaskInspectorFrame, type TaskInspectorMode } from "../tasks/TaskDetail";
import { useWorkspace } from "../../app/workspace";
import { Button, CopyRef, Facts, InlineNotice, Pill, TaskStatePill, Unknown, useToast } from "../../components/ui";
import { createIdempotencyKey } from "../../shared/action-runner";
import { formatFullTime, formatRelative } from "../../shared/read-model/format";

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
      notify(`动作预览失败（${code}）。没有执行 Owner 写入。`, "warning");
    }
  };

  const internalLinks = item.safe_links.filter((link) => link.kind === "control-center");
  const ownerLinks = item.safe_links.filter((link) => link.kind === "owner");
  return <TaskInspectorFrame
    open={open}
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={() => setMaximized((value) => !value)}
    onClose={onClose}
    eyebrow={<span>{item.owner} · {item.kind}</span>}
    title={item.title}
    description={<span className="inline-flex flex-wrap items-center gap-2"><span>{item.attention_reason}</span><TaskStatePill state={item.state} /><Pill tone={item.priority === "critical" ? "danger" : item.priority === "high" ? "warning" : "neutral"}>{item.priority}</Pill></span>}
    context={<span className="inline-flex min-w-0 items-center gap-1.5"><span>工作台</span><ArrowRight className="size-3 shrink-0 text-faint" /><span>{item.project || "项目未提供"}</span></span>}
    icon={<span className="grid size-8 place-items-center rounded-[9px] bg-panel-soft text-info"><Eye className="size-4" /></span>}
    reference={<CopyRef value={item.source_ref} label="source_ref" />}
    sections={[{ id: "overview", label: "概况" }, { id: "flow", label: "流程链" }, { id: "evidence", label: "证据" }, { id: "actions", label: "动作" }, { id: "handoff", label: "交接" }]}
    footer={<div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={onClose}>关闭</Button><span className="ml-auto flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3" />只读观察；Preview 不会 Confirm</span></div>}
  >
    <div className="space-y-5">
      {item.preview_state === "needs_contract" && <InlineNotice tone="warning">Owner 尚未提供可执行合同。当前只展示安全引用和恢复边界。</InlineNotice>}
      <section id="work-queue-inspector-overview" data-inspector-section="overview" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-[13px] font-semibold text-ink">工作项概况</h3>
        <Facts columns={2} items={[
          { label: "状态", value: <TaskStatePill state={item.state} /> },
          { label: "覆盖度", value: item.coverage },
          { label: "来源新鲜度", value: item.freshness },
          { label: "观察时间", value: <span title={formatFullTime(item.observed_at)}>{formatRelative(item.observed_at)}</span> },
          { label: "Revision", value: item.revision ? <span className="font-mono text-xs break-all">{item.revision}</span> : <Unknown /> },
          { label: "项目", value: item.project || <Unknown /> },
        ]} />
      </section>

      <section id="work-queue-inspector-flow" data-inspector-section="flow" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-[13px] font-semibold text-ink">流程链</h3>
        {item.workflow_stage ? <>
          <div className="rounded-[10px] border border-line bg-panel-soft p-3 text-[13px] text-muted">当前阶段：<span className="font-medium text-ink">{item.workflow_stage}</span>{item.object_kind ? ` · ${item.object_kind}` : ""}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted">
            {['screenplay', 'director_plan', 'creative_storyboard', 'production_handoff', 'production_breakdown'].map((stage, index) => <span key={stage} className={stage === item.workflow_stage ? "rounded-full bg-info-soft px-2 py-1 font-medium text-info" : "rounded-full border border-line px-2 py-1"}>{index ? "→ " : ""}{stage}</span>)}
          </div>
          {item.lineage_refs?.length ? <div className="space-y-1"><p className="text-2xs text-muted">安全引用</p><div className="flex flex-wrap gap-1.5">{item.lineage_refs.map((ref) => <CopyRef key={ref} value={ref} label="ref" />)}</div></div> : null}
        </> : <p className="text-[13px] text-muted">当前工作项不属于剧本到分镜流程。</p>}
      </section>

      <section id="work-queue-inspector-evidence" data-inspector-section="evidence" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-[13px] font-semibold text-ink">来源证据</h3>
        <div className="rounded-[10px] border border-line bg-panel-soft p-3 text-[13px] text-muted">{item.attention_reason}</div>
        <Facts columns={1} items={[
          { label: "work_ref", value: <CopyRef value={item.work_ref} label="work_ref" /> },
          { label: "source_ref", value: <CopyRef value={item.source_ref} label="source_ref" /> },
          ...(item.task_ref ? [{ label: "task_ref", value: <CopyRef value={item.task_ref} label="task_ref" /> }] : []),
          ...(item.operation_ref ? [{ label: "operation_ref", value: <CopyRef value={item.operation_ref} label="operation_ref" /> }] : []),
        ]} />
      </section>

      <section id="work-queue-inspector-actions" data-inspector-section="actions" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-[13px] font-semibold text-ink">动作 Preview</h3>
        {preview.state === "ready" && <InlineNotice tone={preview.blockers?.length ? "warning" : "info"}>{preview.blockers?.length ? preview.blockers.join("；") : `Preview 已生成：${preview.digest || "digest 未提供"}。没有执行 Confirm。`}</InlineNotice>}
        {preview.state === "error" && <InlineNotice tone="warning">Preview 读取失败：{preview.message || "unknown"}。没有执行 Owner 写入。</InlineNotice>}
        <div className="space-y-2">
          {item.allowed_actions.length === 0 ? <p className="text-[13px] text-muted">当前来源没有声明动作。</p> : item.allowed_actions.map((candidate) => <div key={candidate.action} className="flex items-center gap-3 rounded-[10px] border border-line bg-panel-soft p-3">
            <span className="min-w-0 flex-1"><span className="block break-all font-mono text-xs">{candidate.action}</span><span className="mt-1 block text-2xs text-muted">{candidate.reason || candidate.preview_state}</span></span>
            <Button size="sm" variant="ghost" disabled={!candidate.enabled || candidate.preview_state !== "available" || preview.state === "loading" || !knownActions.has(candidate.action)} onClick={() => void previewAction(candidate.action)}>Preview</Button>
          </div>)}
        </div>
        {preview.normalized && <pre className="max-h-48 overflow-auto rounded-[10px] bg-panel-sunken p-3 text-2xs text-muted">{JSON.stringify(preview.normalized, null, 2)}</pre>}
      </section>

      <section id="work-queue-inspector-handoff" data-inspector-section="handoff" tabIndex={-1} className="scroll-mt-24 space-y-2">
        <h3 className="text-[13px] font-semibold text-ink">安全交接</h3>
        <div className="space-y-2">
          {internalLinks.map((link) => <Button key={`${link.target}:${link.ref || ""}`} size="sm" variant="secondary" onClick={() => onNavigate(`/${link.target}${link.ref ? `?${link.target === "tasks" ? "task" : "ref"}=${encodeURIComponent(link.ref)}` : ""}`)} icon={<ArrowRight className="size-3.5" />}>{link.label}</Button>)}
          {ownerLinks.map((link) => <div key={`${link.target}:${link.launch?.target_route || ""}`} className="flex items-center gap-3 rounded-[10px] border border-line bg-panel-soft p-3"><Route className="size-4 shrink-0 text-faint" /><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{link.label}</span><span className="block text-2xs text-muted">受控 LaunchContext · owner 负责最终读取</span>{link.command && <code className="mt-1 block break-all text-2xs text-faint">{link.command}</code>}</span>{link.launch?.url ? <Button size="sm" variant="secondary" onClick={() => { const opened = window.open(link.launch?.url, "_blank", "noopener,noreferrer"); if (!opened) window.location.assign(link.launch!.url!); }}>打开</Button> : <Button size="sm" variant="ghost" disabled>{link.launch?.owner === "muweave" ? "待合同" : "复制命令"}</Button>}</div>)}
          {!internalLinks.length && !ownerLinks.length && <p className="text-[13px] text-muted">当前工作项没有安全交接入口。</p>}
        </div>
      </section>
    </div>
  </TaskInspectorFrame>;
}
