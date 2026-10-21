import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CheckCircle2, CircleAlert, Copy, Info } from "../../icons";
import { cx } from "./cx";

type ToastTone = "success" | "info" | "warning";
interface ToastItem { id: number; tone: ToastTone; message: string }

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);
  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++next.current;
    setItems((current) => [...current.slice(-2), { id, tone, message }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 3200);
  }, []);
  return <ToastContext.Provider value={notify}>
    {children}
    <div aria-live="polite" className="pointer-events-none fixed left-1/2 top-[calc(var(--topbar-height)+12px)] z-[60] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col items-center gap-2">
      {items.map((item) => <div key={item.id} role="status" className="pop-in pointer-events-auto flex w-full items-start gap-2.5 rounded-[12px] border border-line bg-panel px-3.5 py-3 text-[13px] text-ink shadow-float">
        <span className={cx("mt-0.5 shrink-0 [&>svg]:size-4", item.tone === "success" ? "text-success" : item.tone === "warning" ? "text-warning" : "text-info")}>
          {item.tone === "success" ? <CheckCircle2 /> : item.tone === "warning" ? <CircleAlert /> : <Info />}
        </span>
        <span className="min-w-0 flex-1 text-pretty">{item.message}</span>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  return useContext(ToastContext);
}

export function CopyRef({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return <button
    type="button"
    title={value}
    aria-label={`复制${label || "引用"}`}
    onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => {})}
    className={cx("group inline-flex max-w-full items-center gap-1.5 rounded-[6px] font-mono text-xs text-ink-soft hover:text-ink", className)}
  >
    <span className="truncate">{value}</span>
    <span className="shrink-0 text-faint group-hover:text-muted [&>svg]:size-3.5">{copied ? <Check className="text-success" /> : <Copy />}</span>
  </button>;
}
