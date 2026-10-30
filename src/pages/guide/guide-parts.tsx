import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "../../icons";
// Direct imports: the public guide must not load the menu and dialog components behind the ui barrel.
import { cx } from "../../components/ui/cx";
import { copyReference } from "../../shared/clipboard";
import { Reveal } from "./guide-motion";

/** One copyable command; the copied text is exactly what is shown. `block` keeps line breaks for config files. */
export function CommandLine({ command, note, dark = false, block = false, label = "命令" }: { command: string; note?: string; dark?: boolean; block?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => { setCopied(false); setCopyFailed(false); }, [command]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    setCopyFailed(false);
    try {
      const ok = await copyReference(command);
      setCopied(ok === true);
      setCopyFailed(ok !== true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };
  const name = block ? ` ${label}` : `${label} ${command}`;
  return <div className={cx("guide-command", dark && "is-dark", block && "is-block")}>
    <div className="flex min-w-0 items-start gap-2">
      {!block && <span aria-hidden="true" className="guide-command-prompt">$</span>}
      {block ? <pre className="min-w-0 flex-1"><code>{command}</code></pre> : <code className="min-w-0 flex-1 [overflow-wrap:anywhere]">{command}</code>}
      <button type="button" className="guide-copy" aria-label={copied ? `已复制${label}` : copyFailed ? `复制失败，请手动选择${label}` : `复制${name}`} title={copied ? "已复制" : copyFailed ? "复制失败" : "复制"} onClick={() => void copy()}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button>
    </div>
    {note && <p className="guide-command-note">{note}</p>}
    {copyFailed && (block
      ? <textarea aria-label={`手动复制${label}`} readOnly value={command} rows={Math.min(12, command.split("\n").length)} className="mt-2 w-full rounded border border-line bg-panel px-2 py-1 font-mono text-xs text-ink" onFocus={(event) => event.currentTarget.select()} />
      : <input aria-label={`手动复制${label}`} readOnly value={command} className="mt-2 w-full rounded border border-line bg-panel px-2 py-1 font-mono text-xs text-ink" onFocus={(event) => event.currentTarget.select()} />)}
  </div>;
}

export function SectionHeading({ eyebrow, title, body, id }: { eyebrow: string; title: ReactNode; body?: ReactNode; id?: string }) {
  return <Reveal className="guide-heading">
    <p className="guide-eyebrow">{eyebrow}</p>
    <h2 id={id} className="guide-h2">{title}</h2>
    {body && <p className="guide-lead">{body}</p>}
  </Reveal>;
}

export function Picker<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: ReactNode }[]; onChange: (value: T) => void }) {
  return <div role="radiogroup" aria-label={label} className="guide-picker">
    {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={option.id === value} data-active={option.id === value || undefined} onClick={() => onChange(option.id)}>{option.label}</button>)}
  </div>;
}

export function scrollIntoViewGently(id: string, block: ScrollLogicalPosition = "start") {
  document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block });
}
