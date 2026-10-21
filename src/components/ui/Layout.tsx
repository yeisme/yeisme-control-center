import { useState, type ReactNode } from "react";
import { CircleAlert, Clock3, LockKeyhole, Plug, RefreshCw, ShieldQuestion, Unplug, Inbox, LogIn } from "../../icons";
import { cx } from "./cx";
import { Button } from "./Button";
import { readErrorMessage, readStatusLabels, type ReadStatus } from "../../shared/read-model/read-state";
import { formatRelative } from "../../shared/read-model/format";

export function Panel({ title, eyebrow, actions, children, className, bodyClassName, id }: { title?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return <section id={id} className={cx("min-w-0 rounded-card border border-line bg-panel shadow-panel", className)}>
    {(title || actions || eyebrow) && <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-5 py-3">
      <div className="min-w-0 shrink-0">
        {eyebrow && <p className="text-2xs font-medium tracking-wide text-muted">{eyebrow}</p>}
        {title && <h2 className="truncate text-[15px] font-semibold text-ink">{title}</h2>}
      </div>
      {actions && <div className="flex min-w-0 items-center gap-2">{actions}</div>}
    </header>}
    <div className={cx("min-w-0", bodyClassName)}>{children}</div>
  </section>;
}

/**
 * Page-level toolbar that replaces the empty band above each page: purpose and actions on the first
 * line, key metrics and freshness/coverage meta on the second. Pages keep their `h1.sr-only`.
 */
export function PageToolbar({ summary, metrics, meta, actions, children, className }: { summary?: ReactNode; metrics?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={cx("flex flex-col gap-3", className)} data-page-toolbar>
    {(summary || actions) && <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {summary ? <p className="min-w-0 max-w-3xl text-body-sm text-muted text-pretty">{summary}</p> : <span />}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>}
    {(metrics || meta) && <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">{metrics}</div>
      {meta && <div className="flex flex-wrap items-center gap-2">{meta}</div>}
    </div>}
    {children}
  </div>;
}

/** Collapses stacked page notices into the most important one plus an expandable remainder. */
export function NoticeStack({ notices, className }: { notices: ReactNode[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const visible = notices.filter(Boolean);
  if (!visible.length) return null;
  const rest = visible.length - 1;
  return <div className={cx("space-y-2", className)}>
    {visible[0]}
    {rest > 0 && open && visible.slice(1)}
    {rest > 0 && <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="text-2xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
      {open ? "收起提示" : `另有 ${rest} 条提示`}
    </button>}
  </div>;
}

export function SegmentedTabs<T extends string>({ value, options, onChange, label, className }: { value: T; options: { id: T; label: ReactNode; count?: number | null }[]; onChange: (value: T) => void; label: string; className?: string }) {
  return <div role="tablist" aria-label={label} className={cx("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-control bg-panel-sunken p-0.5", className)}>
    {options.map((option) => {
      const active = option.id === value;
      return <button
        key={option.id}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onChange(option.id)}
        className={cx(
          "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150",
          active ? "bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/8%)]" : "text-muted hover:text-ink",
        )}
      >
        {option.label}
        {option.count !== undefined && option.count !== null && <span className={cx("tabular rounded px-1 text-2xs", active ? "bg-panel-sunken text-ink-soft" : "text-faint")}>{option.count}</span>}
      </button>;
    })}
  </div>;
}

export function Facts({ items, columns = 2, className }: { items: { label: string; value: ReactNode; mono?: boolean; wide?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  return <dl className={cx("grid gap-px overflow-hidden rounded-[10px] border border-line bg-line", columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3", className)}>
    {items.map((item) => <div key={item.label} className={cx("min-w-0 bg-panel px-3 py-2.5", item.wide && "col-span-full")}>
      <dt className="text-2xs text-muted">{item.label}</dt>
      <dd className={cx("mt-0.5 break-words text-[13px] text-ink", item.mono && "font-mono text-xs")}>{item.value}</dd>
    </div>)}
  </dl>;
}

export function Unknown({ children = "未提供" }: { children?: ReactNode }) {
  return <span className="text-faint">{children}</span>;
}

export function EmptyState({ icon, title, body, action, compact = false }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return <div className={cx("flex flex-col items-center justify-center text-center", compact ? "gap-1.5 px-4 py-8" : "gap-2 px-6 py-14")}>
    <span className="mb-1 grid size-10 place-items-center rounded-full bg-panel-sunken text-muted [&>svg]:size-[18px]">{icon || <Inbox />}</span>
    <p className="text-sm font-semibold text-ink">{title}</p>
    {body && <p className="max-w-md text-[13px] text-muted text-pretty">{body}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>;
}

const statusCopy: Partial<Record<ReadStatus, { icon: ReactNode; title: string; body: string }>> = {
  forbidden: { icon: <LockKeyhole />, title: "当前身份无权读取", body: "该来源拒绝了当前授权范围；不会改用其他凭据或演示数据补齐。" },
  unavailable: { icon: <Unplug />, title: "来源暂不可用", body: "读取失败，没有可展示的历史数据。稍后重试或检查 owner 连接。" },
  unknown: { icon: <ShieldQuestion />, title: "结果尚未确认", body: "来源没有返回可确认的结果；不会把它推断为成功或失败。" },
  needs_contract: { icon: <Plug />, title: "等待 owner 合同", body: "该能力的读取合同尚未提供，因此保持不可用。" },
  login_required: { icon: <LogIn />, title: "登录已过期", body: "请重新登录后继续。" },
};

/** Shared rendering for non-ready read states; children render only for ready/stale/empty-with-children cases. */
export function ReadStateView({ status, error, onRetry, skeleton, empty, children }: { status: ReadStatus; error?: string | null; onRetry?: () => void; skeleton?: ReactNode; empty?: ReactNode; children?: ReactNode }) {
  if (status === "loading") return <>{skeleton ?? <SkeletonRows />}</>;
  if (status === "empty") return <>{empty ?? <EmptyState title="暂无记录" body="来源返回了空结果。" />}</>;
  if (status === "ready" || status === "stale") return <>{children}</>;
  const copy = statusCopy[status] || statusCopy.unavailable!;
  return <EmptyState icon={copy.icon} title={copy.title} body={<>{copy.body}{error && <span className="mt-1 block text-2xs text-faint">{readErrorMessage(error)}</span>}</>} action={onRetry && status !== "login_required" ? <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>重试</Button> : undefined} />;
}

export function StaleNotice({ status, error, observedAt, onRetry }: { status: ReadStatus; error?: string | null; observedAt?: string | null; onRetry?: () => void }) {
  if (status !== "stale") return null;
  return <div role="status" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning">
    <Clock3 className="size-4 shrink-0" />
    <span className="min-w-0 flex-1">{readStatusLabels.stale}：{error ? readErrorMessage(error) : "最近一次读取失败"} 显示的是 {observedAt ? formatRelative(observedAt) : "较早"} 的结果。</span>
    {onRetry && <Button size="sm" variant="ghost" className="text-warning hover:bg-warning/10" onClick={onRetry}>重新读取</Button>}
  </div>;
}

export function InlineNotice({ tone = "neutral", icon, children, className }: { tone?: "neutral" | "warning" | "info" | "danger" | "review"; icon?: ReactNode; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "border-line bg-panel-soft text-ink-soft",
    warning: "border-warning/25 bg-warning-soft text-warning",
    info: "border-info/25 bg-info-soft text-info",
    danger: "border-danger/25 bg-danger-soft text-danger",
    review: "border-review/25 bg-review-soft text-review",
  };
  return <div className={cx("flex items-start gap-2 rounded-[10px] border px-3 py-2.5 text-[13px] leading-5", tones[tone], className)}>
    <span className="mt-0.5 shrink-0 [&>svg]:size-4">{icon || <CircleAlert />}</span>
    <div className="min-w-0 flex-1 text-pretty">{children}</div>
  </div>;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return <div aria-hidden="true" className={cx("space-y-3 p-5", className)}>
    {Array.from({ length: rows }, (_, index) => <div key={index} className="flex items-center gap-3">
      <div className="skeleton size-9 shrink-0 rounded-[9px]" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton h-3.5" style={{ width: `${62 - (index % 3) * 12}%` }} />
        <div className="skeleton h-3" style={{ width: `${38 - (index % 2) * 10}%` }} />
      </div>
      <div className="skeleton h-6 w-16 rounded-chip" />
    </div>)}
  </div>;
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("skeleton", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-panel px-1 font-sans text-2xs text-muted">{children}</kbd>;
}
