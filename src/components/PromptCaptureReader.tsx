import { useId, useState } from "react";
import { BookOpen, LoaderCircle, LockKeyhole } from "../icons";
import { api, errorCode, type TaskPromptContent } from "../shared/api/control-center-client";
import { useWorkspace } from "../app/workspace";
import { Button, CopyRef, InlineNotice, Pill, Textarea } from "./ui";

const readErrors: Record<string, string> = {
  audit_unavailable: "审计写入不可用；按规则没有读取 owner 正文。",
  content_not_authorized: "当前连接没有读取正文的授权，或 owner 拒绝了这次读取。",
  needs_contract: "owner 尚未提供可读取的提示词正文合同。",
  delegation_unavailable: "当前登录没有 owner 委托，无法读取正文。",
  invalid_request: "读取用途需要 1–200 个字符。",
};

/**
 * Explicit original-prompt read for one task. The owner binds the captured
 * entry to the task and project and writes its audit row before returning the
 * body. The body stays in this component's memory; closing the inspector
 * clears it.
 */
export function PromptCaptureReader({ taskKey, captureRef }: { taskKey: string; captureRef: string }) {
  const { scopeId, session } = useWorkspace();
  const purposeId = useId();
  const [purpose, setPurpose] = useState("Review the original prompt in Control Center");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TaskPromptContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    if (!session?.csrf || pending || !purpose.trim()) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.taskPromptContent(scopeId, taskKey, captureRef, purpose.trim(), session.csrf));
    } catch (failure) {
      setError(errorCode(failure));
    } finally {
      setPending(false);
    }
  };

  return <div className="space-y-2.5">
    <InlineNotice tone="info" icon={<LockKeyhole />}>读取原始提示词会先写入审计；只返回绑定到当前任务的提示词，正文只保留在当前页面内存中。</InlineNotice>
    <label htmlFor={purposeId} className="block space-y-1.5">
      <span className="text-[13px] font-medium text-ink-soft">读取用途（写入审计）</span>
      <Textarea id={purposeId} value={purpose} maxLength={200} onChange={(event) => setPurpose(event.target.value)} placeholder="例如：排查该请求为何失败" className="min-h-16" />
    </label>
    <Button variant="primary" size="sm" disabled={!purpose.trim() || pending} onClick={() => void read()} icon={pending ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <BookOpen className="size-3.5" />}>读取原始提示词</Button>
    {error && <InlineNotice tone="warning">{readErrors[error] || `读取失败（${error}）`}</InlineNotice>}
    {result?.state === "not_recorded" && <p className="text-[13px] text-muted">owner 没有留存可读取的原始提示词。</p>}
    {result?.state === "complete" && <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="success">原始提示词</Pill>
        {result.truncated && <Pill tone="warning">已截断</Pill>}
        {result.receipt_ref && <span className="text-2xs text-muted">审计回执 <CopyRef value={result.receipt_ref} label="回执" /></span>}
      </div>
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-line bg-panel-soft p-3 font-mono text-xs leading-5 text-ink">{result.text}</pre>
    </section>}
  </div>;
}
