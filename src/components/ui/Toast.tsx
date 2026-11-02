import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CheckCircle2, CircleAlert, Copy, Info } from "../../icons";
import { copyReference } from "../../shared/clipboard";
import { cx } from "./cx";

type ToastTone = "success" | "info" | "warning";
/** A button on a toast, for a message that asks the reader to do something, such as try again. */
export interface ToastAction { label: string; run: () => void }
interface ToastItem { id: number; tone: ToastTone; message: string; action?: ToastAction }

const ToastContext = createContext<(message: string, tone?: ToastTone, action?: ToastAction) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const notify = useCallback((message: string, tone: ToastTone = "info", action?: ToastAction) => {
    const id = ++next.current;
    setItems((current) => [...current.slice(-2), { id, tone, message, action }]);
    // A toast with a button stays longer: it asks to be acted on, and should not vanish while it is being read.
    window.setTimeout(() => dismiss(id), action ? 12000 : 3200);
  }, [dismiss]);
  return <ToastContext.Provider value={notify}>
    {children}
    <div aria-live="polite" className="pointer-events-none fixed left-1/2 top-[calc(var(--topbar-height)+12px)] z-[85] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col items-center gap-2">
      {items.map((item) => <div key={item.id} role="status" className="pop-in pointer-events-auto flex w-full items-start gap-2.5 rounded-[12px] border border-line bg-panel px-3.5 py-3 text-[13px] text-ink shadow-float">
        <span className={cx("mt-0.5 shrink-0 [&>svg]:size-4", item.tone === "success" ? "text-success" : item.tone === "warning" ? "text-warning" : "text-info")}>
          {item.tone === "success" ? <CheckCircle2 /> : item.tone === "warning" ? <CircleAlert /> : <Info />}
        </span>
        <span className="min-w-0 flex-1 text-pretty">{item.message}</span>
        {item.action && <button type="button" onClick={() => { dismiss(item.id); item.action?.run(); }} className="-my-1 -mr-1.5 inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-control px-2 text-[13px] font-medium text-accent hover:bg-panel-soft">{item.action.label}</button>}
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  return useContext(ToastContext);
}

export function CopyRef({ value, label, className, onCopyFailed, onCopySucceeded }: { value: string; label?: string; className?: string; onCopyFailed?: (value: string) => void; onCopySucceeded?: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return <button
    type="button"
    title={value}
    aria-label={`复制${label || "引用"} ${value}`}
    onClick={() => void copyReference(value).then((ok) => { setCopied(ok); if (ok) onCopySucceeded?.(); else onCopyFailed?.(value); }).catch(() => { setCopied(false); onCopyFailed?.(value); })}
    className={cx("group inline-flex max-w-full items-center gap-1.5 rounded-[6px] font-mono text-xs text-ink-soft hover:text-ink", className)}
  >
    <span className="truncate">{value}</span>
    <span className="shrink-0 text-faint group-hover:text-muted [&>svg]:size-3.5">{copied ? <Check className="text-success" /> : <Copy />}</span>
  </button>;
}
