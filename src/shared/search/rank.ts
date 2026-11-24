import { matchFields, queryTerms, type Range } from "./match";

/**
 * Ranking for ⌘K. Every source becomes plain items; the best three across all of them come first, then each kind in a
 * fixed order, five at a time. An action or a recently opened thing wins a tie, so "深色" finds the theme switch before a
 * task whose title starts with 深色: actions are few, and a person who types their words means them.
 */
export type SearchGroup = "top" | "recent" | "action" | "page" | "task" | "work" | "episode" | "reminder" | "request" | "prompt" | "catalog";
export type SearchScope = "all" | "nav" | "task" | "work" | "episode" | "reminder" | "request" | "prompt";

export interface SearchItem {
  key: string;
  group: Exclude<SearchGroup, "top">;
  label: string;
  meta: string;
  /** More words to find it by, weighed below the label. */
  keywords?: string;
  /** A route in this app; items with the same route are one result. */
  target?: string;
  run?: () => void;
  /** Added to the score of a match: actions and recently opened things. */
  boost?: number;
}

export interface RankedItem extends SearchItem { score: number; labelRanges: Range[]; metaRanges: Range[] }
export interface RankedGroup { group: SearchGroup; items: RankedItem[]; total: number }

export const searchScopes: Array<{ id: SearchScope; label: string }> = [
  { id: "all", label: "全部" },
  { id: "nav", label: "页面与操作" },
  { id: "task", label: "任务" },
  { id: "work", label: "作品" },
  { id: "episode", label: "剧集" },
  { id: "reminder", label: "提醒" },
  { id: "request", label: "请求" },
  { id: "prompt", label: "配方" },
];

const scopeGroups: Record<SearchScope, Array<Exclude<SearchGroup, "top">>> = {
  all: ["action", "task", "work", "episode", "reminder", "request", "prompt", "catalog", "recent", "page"],
  nav: ["action", "page", "recent", "catalog"],
  task: ["task"],
  work: ["work"],
  episode: ["episode"],
  reminder: ["reminder"],
  request: ["request"],
  prompt: ["prompt"],
};

const prefixes: Record<string, SearchScope> = { 任务: "task", 作品: "work", 剧集: "episode", 集: "episode", 提醒: "reminder", 请求: "request", 配方: "prompt", 提示词: "prompt", 页面: "nav", 操作: "nav" };

/** `任务:雨夜` searches tasks for 雨夜; anything else is searched as typed. */
export function readScopePrefix(query: string): { scope: SearchScope | null; rest: string } {
  const match = /^([^:：]{1,4})[:：](.*)$/.exec(query.trim());
  const scope = match ? prefixes[match[1].trim()] : undefined;
  return scope ? { scope, rest: match![2].trim() } : { scope: null, rest: query };
}

export function groupsOf(scope: SearchScope) {
  return scopeGroups[scope];
}

export function rankSearch(items: readonly SearchItem[], query: string, options: { scope?: SearchScope; perGroup?: number; top?: number; expanded?: readonly SearchGroup[] } = {}): RankedGroup[] {
  const scope = options.scope || "all";
  const perGroup = options.perGroup ?? 5;
  const allowed = new Set(scopeGroups[scope]);
  const terms = queryTerms(query);
  const scoped = items.filter((item) => allowed.has(item.group));
  if (!terms.length) {
    // Nothing typed: what was opened lately, what can be done, where to go.
    const order: Array<Exclude<SearchGroup, "top">> = ["recent", "action", "page"];
    return order.filter((group) => allowed.has(group)).map((group) => {
      const all = scoped.filter((item) => item.group === group).map((item) => ({ ...item, score: 0, labelRanges: [], metaRanges: [] }));
      const limit = group === "recent" && !options.expanded?.includes(group) ? perGroup : all.length;
      return { group, items: all.slice(0, limit), total: all.length };
    }).filter((group) => group.items.length);
  }
  const ranked: RankedItem[] = [];
  for (const item of scoped) {
    const match = matchFields([{ text: item.label }, { text: item.keywords, weight: 0.7 }, { text: item.meta, weight: 0.5 }], terms);
    if (!match) continue;
    ranked.push({ ...item, score: match.score + (item.boost || 0), labelRanges: match.ranges[0], metaRanges: match.ranges[2] });
  }
  // One result per place: a task found as itself and as recently opened is listed once, where it scored best.
  const best = new Map<string, RankedItem>();
  for (const item of ranked) {
    const id = item.target || item.key;
    const kept = best.get(id);
    if (!kept || item.score > kept.score) best.set(id, item);
  }
  const sorted = [...best.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "zh-CN"));
  const topCount = scope === "all" ? options.top ?? 3 : 0;
  const top = sorted.slice(0, topCount);
  const topKeys = new Set(top.map((item) => item.key));
  const groups: RankedGroup[] = top.length ? [{ group: "top", items: top, total: top.length }] : [];
  for (const group of scopeGroups[scope]) {
    const all = sorted.filter((item) => item.group === group && !topKeys.has(item.key));
    if (!all.length) continue;
    groups.push({ group, items: options.expanded?.includes(group) ? all : all.slice(0, perGroup), total: all.length });
  }
  return groups;
}
