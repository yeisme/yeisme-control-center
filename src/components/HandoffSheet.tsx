import { useEffect, useMemo, useState } from "react";
import { Bot, Check, Copy, ShieldCheck } from "../icons";
import { Button, DetailSheet } from "./ui";
import { useCopy } from "../app/item-actions";
import { renderBriefText, type AgentBrief } from "../shared/agent-brief";

/**
 * "交给 Agent": one piece of Chinese text to paste into whatever agent the person uses. Copy only; Studio runs nothing
 * on the agent's behalf. The text stays on screen and selectable, and a refused clipboard opens it ready to copy by hand.
 */
export function HandoffSheet({ brief, open, onOpenChange }: { brief: AgentBrief | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const content = useMemo(() => brief ? renderBriefText(brief) : "", [brief]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => setCopied(false), [content]);
  if (!brief) return null;
  const promises = [
    brief.human_confirm_required ? "花钱的步骤只报价，等你确认" : "只读，不改任何东西",
    "动作名先查再用",
    "不碰密钥和地址",
  ];
  return <DetailSheet open={open} onOpenChange={onOpenChange} width="lg" eyebrow="交给 Agent" title={brief.title} description="复制下面这段说明，贴给你常用的 Agent。Studio 只给说明，不替 Agent 执行任何一步。">
    <div className="space-y-4" data-brief={brief.context.station || brief.context.task_ref || "brief"}>
      <p className="flex gap-2.5 rounded-[14px] bg-panel-sunken p-3.5 text-body-sm text-ink">
        <Bot aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
        <span>{brief.goal}</span>
      </p>
      <ul aria-label="这份说明的边界" className="flex flex-wrap gap-1.5">
        {promises.map((item) => <li key={item} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-2xs text-ink-soft"><ShieldCheck aria-hidden="true" className="size-3.5 text-success" />{item}</li>)}
      </ul>
      <pre tabIndex={0} aria-label="给 Agent 的说明" data-brief-text className="max-h-[52dvh] overflow-auto whitespace-pre-wrap break-words rounded-[14px] border border-line bg-panel-soft p-4 font-mono text-[12px] leading-5 text-ink-soft outline-none focus-visible:ring-2 focus-visible:ring-focus">{content}</pre>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-2xs text-muted">结果回到：{brief.return_label}</span>
        <Button variant="primary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy(content, "给 Agent 的说明").then((ok) => setCopied(ok))}>
          {copied ? "已复制" : "复制给 Agent 的说明"}
        </Button>
      </div>
    </div>
  </DetailSheet>;
}
