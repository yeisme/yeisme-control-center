import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";
import type { Tone } from "./Status";

const toneText: Record<Tone, string> = { success: "text-success", info: "text-info", warning: "text-warning", danger: "text-danger", review: "text-review", neutral: "text-ink" };
const toneChip: Record<Tone, string> = { success: "bg-success-soft text-success", info: "bg-info-soft text-info", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", review: "bg-review-soft text-review", neutral: "bg-panel-sunken text-ink-soft" };
const toneBar: Record<Tone, string> = { success: "bg-success", info: "bg-info", warning: "bg-warning", danger: "bg-danger", review: "bg-review", neutral: "bg-primary" };

export interface Metric {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}

/** Compact inline metrics for page toolbars; values stay in ink unless a tone marks a problem. */
export function MetricStrip({ items, className, label = "概况" }: { items: Metric[]; className?: string; label?: string }) {
  if (!items.length) return null;
  return <dl aria-label={label} className={cx("flex min-w-0 flex-wrap items-stretch overflow-hidden rounded-control border border-line bg-panel shadow-panel", className)}>
    {items.map((item, index) => <div key={item.label} className={cx("flex min-w-0 flex-col justify-center px-3 py-1.5", index > 0 && "border-l border-line")}>
      <dt className="whitespace-nowrap text-2xs text-muted">{item.label}</dt>
      <dd className={cx("tabular flex items-baseline gap-1.5 whitespace-nowrap text-title-sm font-semibold", toneText[item.tone || "neutral"])}>
        {item.value}
        {item.hint && <span className="text-2xs font-normal text-muted">{item.hint}</span>}
      </dd>
    </div>)}
  </dl>;
}

export function StatCard({ label, value, hint, icon, tone = "neutral", className, onClick, selected }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone; className?: string; onClick?: () => void; selected?: boolean }) {
  const body = <>
    <div className="flex items-center justify-between gap-3">
      <span className="truncate text-meta text-muted">{label}</span>
      {icon && <span className={cx("grid size-7 shrink-0 place-items-center rounded-[8px] [&>svg]:size-3.5", toneChip[tone])}>{icon}</span>}
    </div>
    <span className={cx("tabular mt-1 block truncate text-metric font-semibold tracking-tight", tone === "neutral" ? "text-ink" : toneText[tone])}>{value}</span>
    {hint && <span className="mt-0.5 block truncate text-2xs text-muted">{hint}</span>}
  </>;
  const classes = cx("min-w-0 rounded-card border bg-panel px-4 py-3 text-left shadow-panel", selected ? "border-primary shadow-selected" : "border-line", className);
  if (!onClick) return <div className={classes}>{body}</div>;
  return <button type="button" aria-pressed={selected} onClick={onClick} className={cx(classes, "transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-raised")}>{body}</button>;
}

/** Determinate progress; `null` means the owner did not report a value, so no track is drawn. */
export function Progress({ value, tone = "neutral", label, className }: { value: number | null | undefined; tone?: Tone; label: string; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return <span className={cx("text-2xs text-faint", className)}>{label}：未提供</span>;
  const percent = Math.max(0, Math.min(100, value));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className={cx("h-1.5 overflow-hidden rounded-full bg-panel-sunken", className)}>
    <div className={cx("h-full rounded-full transition-[width] duration-500 ease-out", toneBar[tone])} style={{ width: `${percent}%` }} />
  </div>;
}

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** 1 always visible; 2 needs a 672px-wide table; 3 needs 896px. Driven by container width, not viewport. */
  priority?: 1 | 2 | 3;
  align?: "start" | "end";
  className?: string;
}

const priorityClass = { 1: "", 2: "hidden @2xl:table-cell", 3: "hidden @4xl:table-cell" } as const;
const densityPad = { compact: "py-1.5", comfortable: "py-2.5", spacious: "py-3.5" } as const;

/**
 * Shared list table. Column visibility follows the table's own width, so a docked Inspector never
 * squeezes columns into one-character wraps. Rows are clickable with the mouse; the first cell's
 * button is the keyboard target.
 */
export function DataTable<T>({ columns, rows, rowKey, label, onRowClick, rowLabel, selectedKey, density = "comfortable", empty, className, rowAttributes }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  label: string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  selectedKey?: string | null;
  density?: keyof typeof densityPad;
  empty?: ReactNode;
  className?: string;
  rowAttributes?: (row: T) => Record<string, string | undefined>;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  const open = (row: T) => onRowClick?.(row);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, row: T) => {
    if (event.key === " ") { event.preventDefault(); open(row); }
  };
  return <div className={cx("@container min-w-0 overflow-x-auto", className)}>
    <table aria-label={label} className="w-full border-collapse text-left text-body-sm">
      <thead className="sticky top-0 z-[1] bg-panel-soft">
        <tr className="border-b border-line">
          {columns.map((column) => <th key={column.id} scope="col" className={cx("whitespace-nowrap px-4 py-2 text-2xs font-medium text-muted", column.align === "end" && "text-right", priorityClass[column.priority || 1])}>{column.header}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = rowKey(row);
          const selected = selectedKey === key;
          return <tr
            key={key}
            {...rowAttributes?.(row)}
            data-selected={selected || undefined}
            onClick={onRowClick ? () => open(row) : undefined}
            className={cx("border-b border-line last:border-b-0 transition-colors duration-150", onRowClick && "cursor-pointer hover:bg-panel-soft", selected && "bg-primary-soft/50 hover:bg-primary-soft/60")}
          >
            {columns.map((column, index) => <td key={column.id} className={cx("min-w-0 px-4 align-middle", densityPad[density], column.align === "end" && "text-right", priorityClass[column.priority || 1], column.className)}>
              {index === 0 && onRowClick
                ? <button type="button" onClick={(event) => { event.stopPropagation(); open(row); }} onKeyDown={(event) => onKey(event, row)} aria-label={rowLabel?.(row)} aria-current={selected || undefined} className="block w-full min-w-0 rounded-[6px] text-left outline-offset-2">{column.cell(row)}</button>
                : column.cell(row)}
            </td>)}
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
