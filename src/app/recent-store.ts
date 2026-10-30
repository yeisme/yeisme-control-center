/** Recently opened items: pure list rules and tab-scoped storage. */

export type RecentKind = "task" | "result" | "request" | "project" | "episode";
/** Something the user opened: only the title, a short hint and the route already shown on the page, never content. */
export interface RecentItem { key: string; kind: RecentKind; label: string; meta: string; target: string }

export const recentPrefix = "yeisme.recent.v1:";
const limit = 8;
const kinds: RecentKind[] = ["task", "result", "request", "project", "episode"];

/** Most recent first, one entry per key. */
export function pushRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((entry) => entry.key !== item.key)].slice(0, limit);
}

/** Route that reopens what is on screen now; the preview layer is not part of it. */
export function recentTarget(pathname: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.delete("preview");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

const valid = (value: unknown): value is RecentItem => {
  const item = value as Partial<RecentItem> | null;
  return typeof item?.key === "string" && typeof item.label === "string" && typeof item.meta === "string" && typeof item.target === "string" && item.target.startsWith("/") && kinds.includes(item.kind as RecentKind);
};

export function readRecent(storage: Pick<Storage, "getItem">, key: string): RecentItem[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter(valid).slice(0, limit) : [];
  } catch {
    return [];
  }
}

/** Logout clears every identity's and scope's list in this tab. */
export function clearRecentItems(storage: Storage = sessionStorage) {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(recentPrefix)) storage.removeItem(key);
  }
}
