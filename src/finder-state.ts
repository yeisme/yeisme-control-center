import type { Env, Page } from "./data";
export type ItemKind =
  "project" | "service" | "asset" | "task" | "approval" | "external";
export type FinderSelection = { kind: ItemKind; id: string } | null;
export type ViewMode = "icons" | "list";
export type SortOrder =
  "name-asc" | "name-desc" | "type" | "status" | "updated";
export interface BrowseSnapshot {
  page: Page;
  env: Env;
  project: string;
  query: string;
  filter: string;
  selection: FinderSelection;
  scroll: number;
  inspector: boolean;
}
export interface BrowseHistory {
  entries: BrowseSnapshot[];
  index: number;
}
export function pushBrowse(
  history: BrowseHistory,
  current: BrowseSnapshot,
  next: BrowseSnapshot,
): BrowseHistory {
  const entries = history.entries.slice(0, history.index + 1);
  entries[history.index] = current;
  if (
    current.page === next.page &&
    current.project === next.project &&
    current.env === next.env
  )
    return {
      entries: entries.map((e, i) => (i === history.index ? next : e)),
      index: history.index,
    };
  entries.push(next);
  const trimmed = entries.slice(-40);
  return { entries: trimmed, index: trimmed.length - 1 };
}
export function moveBrowse(
  history: BrowseHistory,
  current: BrowseSnapshot,
  delta: number,
): { history: BrowseHistory; snapshot: BrowseSnapshot } | null {
  const index = history.index + delta;
  if (index < 0 || index >= history.entries.length) return null;
  const entries = history.entries.map((e, i) =>
    i === history.index ? current : e,
  );
  if (entries[index].env !== current.env) return null;
  return { history: { entries, index }, snapshot: entries[index] };
}
export interface Sortable {
  id: string;
  name: string;
  type?: string;
  status?: string;
  updated?: string;
}
const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
export function sortObjects<T extends Sortable>(
  items: T[],
  order: SortOrder,
): T[] {
  return [...items].sort((a, b) => {
    const key =
      order === "type"
        ? "type"
        : order === "status"
          ? "status"
          : order === "updated"
            ? "updated"
            : "name";
    const av = a[key],
      bv = b[key];
    if (!av && bv) return 1;
    if (av && !bv) return -1;
    return (
      collator.compare(av || "", bv || "") *
        (order === "name-desc" || order === "updated" ? -1 : 1) ||
      collator.compare(a.name, b.name) ||
      collator.compare(a.id, b.id)
    );
  });
}
export function nextItemIndex(
  index: number,
  key: string,
  count: number,
  columns = 1,
) {
  if (!count) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const delta =
    key === "ArrowRight"
      ? 1
      : key === "ArrowLeft"
        ? -1
        : key === "ArrowDown"
          ? columns
          : key === "ArrowUp"
            ? -columns
            : 0;
  return Math.max(0, Math.min(count - 1, index + delta));
}
