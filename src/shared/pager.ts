/** Page sizes a list offers; galleries show more, smaller things per page. */
export const pageSizes = [20, 40, 80, 120] as const;
export type PageSize = (typeof pageSizes)[number];
export const galleryPageSizes = [24, 48, 96] as const;
export type GalleryPageSize = (typeof galleryPageSizes)[number];

/** A page number from the address: a positive integer; anything else (missing, 0, "abc", 2.5) reads as page 1. */
export function parsePage(value: string | null | undefined): number {
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

export interface PageWindow {
  /** The page shown: the one asked for, kept within the pages that exist. */
  page: number;
  pageCount: number;
  /** First row on the page (inclusive) and the row after the last (exclusive), as slice indices. */
  start: number;
  end: number;
  total: number;
}

/** Which rows the asked-for page holds. A page past the end shows the last page; an empty list is one empty page. */
export function pageWindow(total: number, pageSize: number, requested: number): PageWindow {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const count = Math.max(0, Math.floor(total) || 0);
  const pageCount = Math.max(1, Math.ceil(count / size));
  const page = Math.min(Math.max(1, Math.floor(requested) || 1), pageCount);
  const start = (page - 1) * size;
  return { page, pageCount, start, end: Math.min(start + size, count), total: count };
}

/**
 * Page numbers to show as buttons: the first and the last, the current page and `around` pages on each side, and a
 * gap where numbers are left out. A gap never hides just one number; that number is shown instead.
 */
export function pageNumbers(page: number, pageCount: number, around = 1): Array<number | "gap"> {
  if (pageCount <= 1) return [1];
  const keep = new Set<number>([1, pageCount]);
  for (let value = page - around; value <= page + around; value += 1) if (value >= 1 && value <= pageCount) keep.add(value);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && value - previous === 2) out.push(previous + 1);
    else if (previous !== undefined && value - previous > 2) out.push("gap");
    out.push(value);
  });
  return out;
}

/** "显示 21–40 / 57 条" — or "没有条目" for an empty list. */
export function rangeText(window: PageWindow, noun = "条") {
  if (!window.total) return `没有${noun === "条" ? "条目" : noun}`;
  return `显示 ${window.start + 1}–${window.end} / ${window.total} ${noun}`;
}

/**
 * The row before or after `current` in the whole list (not just the page shown), and the page that row is on. Null at
 * either end, or when the current row is not in the list.
 */
export function stepWithin(keys: readonly string[], current: string | null | undefined, delta: -1 | 1, pageSize: number): { key: string; index: number; page: number } | null {
  if (!current) return null;
  const index = keys.indexOf(current);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= keys.length) return null;
  const size = Math.max(1, Math.floor(pageSize) || 1);
  return { key: keys[target]!, index: target, page: Math.floor(target / size) + 1 };
}
