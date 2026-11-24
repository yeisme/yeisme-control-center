import { ChevronLeft, ChevronRight, LoaderCircle } from "../../icons";
import { Button } from "./Button";
import { cx } from "./cx";
import { Select } from "./Form";
import { pageNumbers, rangeText, type PageWindow } from "../../shared/pager";
import type { ListDensity } from "../../shared/preferences";

export interface PagerMore {
  /** What another read brings, e.g. 「读取更多请求」. */
  label: string;
  loading?: boolean;
  /** Reads the next batch; resolves once its rows are in the list. */
  onMore: () => Promise<unknown> | void;
}

/**
 * The one pager every list uses: where you are, page numbers, previous and next, page size and density. With `more`,
 * the source has another batch: 「下一页」 on the last page reads it first and then turns the page.
 */
export function Pager({ window, onPage, noun = "条", pageSize, pageSizes, onPageSize, density, onDensity, more, className }: {
  window: PageWindow;
  onPage: (page: number) => void;
  noun?: string;
  pageSize?: number;
  pageSizes?: readonly number[];
  onPageSize?: (size: number) => void;
  density?: ListDensity;
  onDensity?: (density: ListDensity) => void;
  more?: PagerMore | null;
  className?: string;
}) {
  const { page, pageCount } = window;
  const atEnd = page >= pageCount;
  const next = async () => {
    if (!atEnd) return onPage(page + 1);
    if (!more || more.loading) return;
    await more.onMore();
    onPage(page + 1);
  };
  return <nav aria-label="翻页" data-pager className={cx("@container flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line px-4 py-3 text-2xs text-muted", className)}>
    <span className="tabular" aria-live="polite">{rangeText(window, noun)} · 第 {page} / {pageCount} 页</span>
    <div className="flex flex-wrap items-center gap-2">
      {pageSize !== undefined && pageSizes && onPageSize && <label className="flex items-center gap-1.5">每页 <Select aria-label="每页数量" className="w-24" value={String(pageSize)} onChange={(event) => onPageSize(Number(event.target.value))}>
        {pageSizes.map((value) => <option key={value} value={value}>{value}</option>)}
      </Select></label>}
      {density && onDensity && <label className="flex items-center gap-1.5">密度 <Select aria-label="列表密度" className="w-24" value={density} onChange={(event) => onDensity(event.target.value as ListDensity)}>
        <option value="compact">紧凑</option><option value="comfortable">标准</option><option value="spacious">宽松</option>
      </Select></label>}
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="size-3.5" />}>上一页</Button>
      {pageCount > 1 && <ol className="hidden items-center gap-0.5 @lg:flex" aria-label="页码">
        {pageNumbers(page, pageCount).map((value, index) => value === "gap"
          ? <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-faint">…</li>
          : <li key={value}><button type="button" aria-label={`第 ${value} 页`} aria-current={value === page ? "page" : undefined} onClick={() => onPage(value)} className={cx("tabular h-8 min-w-8 rounded-control px-2 text-[13px] transition-colors duration-150", value === page ? "bg-panel-sunken font-semibold text-ink" : "text-ink-soft hover:bg-panel-sunken hover:text-ink")}>{value}</button></li>)}
      </ol>}
      <Button size="sm" variant="ghost" disabled={atEnd && (!more || !!more.loading)} onClick={() => void next()} icon={atEnd && more?.loading ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <ChevronRight className="size-3.5" />}>下一页</Button>
      {more && <Button size="sm" variant="secondary" disabled={more.loading} onClick={() => void more.onMore()}>{more.loading ? "正在读取…" : more.label}</Button>}
    </div>
  </nav>;
}
