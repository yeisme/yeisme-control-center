import { maxSavedViews, type StoredView } from "./preferences";

/** The address parameters a task view is made of; the open task, the viewer and the page are never part of a view. */
export const taskViewKeys = ["view", "q", "state", "owner", "episode", "project", "family", "kind", "connection", "upd", "from", "to", "results", "prompt", "sort"] as const;

/** Ready-made views, the questions people ask a task list most. */
export const presetTaskViews: ReadonlyArray<StoredView & { hint: string }> = [
  { id: "preset:unknown", name: "需要回查", query: "state=unknown", created_at: "", hint: "结果未知，只回查不重试" },
  { id: "preset:review", name: "等你确认", query: "state=waiting_review", created_at: "", hint: "等你挑的结果" },
  { id: "preset:today", name: "今天更新", query: "upd=%E4%BB%8A%E5%A4%A9", created_at: "", hint: "今天有变化的任务" },
  { id: "preset:results", name: "有结果", query: "results=yes", created_at: "", hint: "已经有产物的任务" },
  { id: "preset:running", name: "正在跑", query: "view=active", created_at: "", hint: "排队和执行中的任务" },
];

/** A view's query in one spelling: only view keys, sorted, so the same filters always compare equal. */
export function canonicalViewQuery(params: URLSearchParams, keys: readonly string[] = taskViewKeys): string {
  const kept = new URLSearchParams();
  for (const key of [...keys].sort()) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  return kept.toString();
}

/** The address with a view applied: its own parameters replace every view key, everything else is left alone. */
export function applyView(params: URLSearchParams, query: string, keys: readonly string[] = taskViewKeys): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of keys) next.delete(key);
  next.delete("page");
  for (const [key, value] of new URLSearchParams(query)) if ((keys as readonly string[]).includes(key) && value) next.set(key, value);
  return next;
}

export function activeView(views: readonly StoredView[], params: URLSearchParams, keys: readonly string[] = taskViewKeys): StoredView | undefined {
  const current = canonicalViewQuery(params, keys);
  if (!current) return undefined;
  return views.find((view) => canonicalViewQuery(new URLSearchParams(view.query), keys) === current);
}

export type SaveResult = { ok: true; views: StoredView[]; view: StoredView } | { ok: false; reason: "empty_name" | "empty_query" | "full" };

/** Saves under a name; the same name again replaces that view instead of adding a second one. */
export function saveView(views: readonly StoredView[], name: string, query: string, now: string, id: string): SaveResult {
  const title = name.trim().slice(0, 40);
  if (!title) return { ok: false, reason: "empty_name" };
  if (!query) return { ok: false, reason: "empty_query" };
  const existing = views.find((view) => view.name === title);
  if (existing) {
    const view = { ...existing, query, created_at: now };
    return { ok: true, view, views: views.map((item) => item.id === existing.id ? view : item) };
  }
  if (views.length >= maxSavedViews) return { ok: false, reason: "full" };
  const view = { id, name: title, query, created_at: now };
  return { ok: true, view, views: [...views, view] };
}

export const removeView = (views: readonly StoredView[], id: string) => views.filter((view) => view.id !== id);

export function renameView(views: readonly StoredView[], id: string, name: string): StoredView[] {
  const title = name.trim().slice(0, 40);
  if (!title || views.some((view) => view.id !== id && view.name === title)) return [...views];
  return views.map((view) => view.id === id ? { ...view, name: title } : view);
}
