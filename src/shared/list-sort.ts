export type SortDir = "asc" | "desc";
export interface SortState { id: string; dir: SortDir }
export type SortValue = string | number | null | undefined;

/** `sort=updated:desc` from the address; a column the list does not offer, or a malformed value, reads as no sort. */
export function parseSort(value: string | null | undefined, allowed: readonly string[]): SortState | null {
  const match = /^([a-z][a-z0-9_-]{0,31}):(asc|desc)$/.exec(value || "");
  if (!match || !allowed.includes(match[1])) return null;
  return { id: match[1], dir: match[2] as SortDir };
}

export const formatSort = (sort: SortState | null) => sort ? `${sort.id}:${sort.dir}` : null;

/**
 * A header click: a new column starts at its natural direction (newest or largest first for times and numbers,
 * A→Z for names), the same column flips once, and a third click goes back to the list's own order.
 */
export function nextSort(current: SortState | null, id: string, first: SortDir = "asc"): SortState | null {
  if (!current || current.id !== id) return { id, dir: first };
  if (current.dir === first) return { id, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

const missing = (value: SortValue) => value === null || value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value));

/** Numbers by value, text by the Chinese collation (numbers inside text by value, so 第 2 集 before 第 10 集). */
export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * A stable sort of a copy. Rows without a value always go last, in either direction, so "newest first" never opens on
 * a run of rows that have no time.
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((left, right) => {
      const a = missing(left.key);
      const b = missing(right.key);
      if (a || b) return a === b ? left.index - right.index : a ? 1 : -1;
      return sign * compareValues(left.key, right.key) || left.index - right.index;
    })
    .map((item) => item.row);
}

/** `aria-sort` for a header: only the sorted column says a direction. */
export const ariaSort = (sort: SortState | null, id: string): "ascending" | "descending" | "none" => sort?.id === id ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
