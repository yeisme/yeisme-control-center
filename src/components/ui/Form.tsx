import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown, Search, X } from "../../icons";
import { cx } from "./cx";

const control = "h-9 w-full min-w-0 rounded-control border border-line bg-panel px-3 text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line-strong focus:border-focus focus:ring-3 focus:ring-focus/15 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx(control, className)} {...props} />;
});

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(control, "h-auto min-h-24 resize-y py-2 leading-6", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className={cx("relative inline-flex min-w-0", className)}>
    <select className={cx(control, "appearance-none pr-8")} {...props}>{children}</select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
  </span>;
}

export function SearchField({ value, onChange, placeholder, label, className }: { value: string; onChange: (value: string) => void; placeholder: string; label: string; className?: string }) {
  return <label className={cx("relative inline-flex min-w-0 items-center", className)}>
    <span className="sr-only">{label}</span>
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-faint" />
    <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={cx(control, "pl-9 pr-8")} />
    {value && <button type="button" aria-label="清除搜索" onClick={() => onChange("")} className="absolute right-2 grid size-5 place-items-center rounded text-faint hover:bg-panel-sunken hover:text-ink"><X className="size-3.5" /></button>}
  </label>;
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
    <span className="text-[13px] font-medium text-ink-soft">{label}</span>
    {children}
    {hint && <span className="text-2xs text-muted">{hint}</span>}
  </label>;
}
