import type { PromptCaptureObservation } from "../observation-contract";
import type { TaskFilters, TaskSnapshot } from "../task-observation";
import { kindOf, ownerModality, type MediaKind } from "./media-kind";
import { matchFields, normalizeText, queryTerms } from "./search/match";

/**
 * The task query, for example `状态:失败 工具:eikona 集:ep-01 更新:7d -雨 "雨夜 街口"`. A clause the page can show as a
 * filter moves into the same address parameter the filter bar writes. Everything else (words, phrases, exclusions, a
 * negated clause) stays in `q` and is read again whenever the list filters. It runs on the rows already read: nothing
 * here asks a server for more.
 */
export type QueryKey = "state" | "owner" | "episode" | "project" | "family" | "kind" | "connection" | "upd" | "created" | "results" | "prompt" | "sort";

export const queryKeyWords: Array<{ key: Exclude<QueryKey, "kind">; words: string[]; label: string; hint: string }> = [
  { key: "state", words: ["状态", "state"], label: "状态", hint: "失败、进行中、等你确认、未知、完成" },
  { key: "owner", words: ["工具", "来源", "owner", "tool"], label: "工具", hint: "eikona、scaena、sonora…" },
  { key: "episode", words: ["集", "剧集", "episode", "ep"], label: "集", hint: "集引用，如 ep-01" },
  { key: "project", words: ["项目", "project"], label: "项目", hint: "工具里的项目" },
  { key: "family", words: ["类型", "type", "family"], label: "类型", hint: "图片、视频、声音，或任务类型" },
  { key: "connection", words: ["连接", "connection"], label: "连接", hint: "连接名" },
  { key: "upd", words: ["更新", "updated"], label: "更新", hint: "24h、7d、30d、今天、本周、2026-11-01..2026-11-05" },
  { key: "created", words: ["创建", "created"], label: "创建", hint: "7d、今天、2026-11-01..2026-11-05" },
  { key: "results", words: ["结果", "results"], label: "结果", hint: "有、无" },
  { key: "prompt", words: ["提示词", "prompt"], label: "提示词", hint: "已采集、未记录、已脱敏…" },
  { key: "sort", words: ["排序", "sort"], label: "排序", hint: "最新、最早、标题、状态" },
];

/** What the list knows about, so `工具:Eikona` or `连接:图像生产` can be read by their labels too. */
export interface QueryVocabulary {
  owners: Array<{ value: string; label: string }>;
  connections: Array<{ value: string; label: string }>;
  families: Array<{ value: string; label: string }>;
}
export const emptyVocabulary: QueryVocabulary = { owners: [], connections: [], families: [] };

const stateAliases: Record<string, string[]> = {
  失败: ["failed"], 没做成: ["failed"], 部分失败: ["partial_failed"], 未通过: ["rejected"],
  进行中: ["running"], 在跑: ["running"], 执行中: ["running"], 运行中: ["running"],
  排队: ["queued"], 排队中: ["queued"], 等待: ["pending"], 等待执行: ["pending"],
  等你确认: ["waiting_review"], 待确认: ["waiting_review"], 等你挑选: ["waiting_review"], 待挑选: ["waiting_review"], 待审阅: ["waiting_review"],
  未知: ["unknown"], 结果未知: ["unknown"], 回查: ["unknown"],
  完成: ["succeeded", "completed"], 已完成: ["succeeded", "completed"], 成功: ["succeeded", "completed"],
  取消: ["cancelled", "canceled"], 已取消: ["cancelled", "canceled"],
  受阻: ["blocked"],
};
const kindAliases: Record<string, MediaKind> = { 图片: "image", 图: "image", image: "image", 视频: "video", video: "video", 声音: "audio", 音频: "audio", audio: "audio", 文本: "text", 文字: "text", text: "text" };
const promptAliases: Record<string, string> = { 已采集: "captured", 采集: "captured", 已脱敏: "redacted", 排队: "queued", 采集中: "capturing", 未记录: "not_recorded", 受阻: "blocked", 失败: "failed", 过期: "expired", 已过期: "expired" };
const sortAliases: Record<string, string> = { 最新: "updated:desc", 更新: "updated:desc", 最早: "updated:asc", 标题: "task:asc", 名称: "task:asc", 状态: "state:asc" };
const yes = ["有", "是", "yes", "true", "1"];
const no = ["无", "没有", "否", "no", "false", "0"];
const rawId = /^[a-z][a-z0-9_.:-]{0,63}$/;

/** A clause as typed: its key, its values (comma-separated), and whether it was negated with a leading `-`. */
export interface QueryClause { key: QueryKey; values: string[]; negated: boolean; raw: string }

export interface ParsedQuery {
  clauses: QueryClause[];
  /** Words and quoted phrases every row has to contain. */
  terms: string[];
  /** Words and phrases after a `-`: no row may contain them. */
  excluded: string[];
}

const keyOf = (word: string) => queryKeyWords.find((item) => item.words.some((candidate) => normalizeText(candidate) === normalizeText(word)))?.key;

/** Tokens of a query: quoted parts stay whole, `key:"a b"` keeps its quoted value, a leading `-` is kept on the token. */
function tokens(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote = "";
  const closing: Record<string, string> = { '"': '"', "“": "”", "「": "」" };
  for (const char of input) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (closing[char]) { quote = closing[char]; current += char; continue; }
    if (char === " " || char === "\t" || char === "\n" || char === "　") {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

const unquote = (value: string) => value.replace(/^["“「]/, "").replace(/["”」]$/, "");

export function parseTaskQuery(input: string): ParsedQuery {
  const parsed: ParsedQuery = { clauses: [], terms: [], excluded: [] };
  for (const token of tokens(input)) {
    const negated = token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;
    // Bare 有结果 / 无结果 read as the results clause.
    if (body === "有结果" || body === "无结果" || body === "没结果") {
      parsed.clauses.push({ key: "results", values: [body === "有结果" ? "有" : "无"], negated, raw: token });
      continue;
    }
    const colon = body.search(/[:：]/);
    const key = colon > 0 ? keyOf(body.slice(0, colon)) : undefined;
    const value = colon > 0 ? unquote(body.slice(colon + 1)) : "";
    if (key && value) {
      parsed.clauses.push({ key, values: value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean), negated, raw: token });
      continue;
    }
    // A clause still being typed (`更新:` with no value yet) filters nothing, rather than searching for "更新:".
    if (key) continue;
    const term = unquote(body).trim();
    if (!term) continue;
    (negated ? parsed.excluded : parsed.terms).push(term);
  }
  return parsed;
}

function byValueOrLabel(value: string, options: Array<{ value: string; label: string }>): string | null {
  const wanted = normalizeText(value);
  const hit = options.find((option) => normalizeText(option.value) === wanted || normalizeText(option.label) === wanted)
    || options.find((option) => normalizeText(option.label).includes(wanted));
  return hit ? hit.value : null;
}

/** The parameter values one clause stands for, or null when a value means nothing the list can filter on. */
export function resolveClause(clause: QueryClause, vocabulary: QueryVocabulary, now: number): { param: string; values: string[] } | null {
  const values: string[] = [];
  let param: string = clause.key;
  for (const raw of clause.values) {
    const value = raw.trim();
    const lower = value.toLowerCase();
    switch (clause.key) {
      case "state": {
        const states = stateAliases[value] || (rawId.test(lower) ? [lower] : null);
        if (!states) return null;
        values.push(...states);
        break;
      }
      case "owner": {
        const owner = byValueOrLabel(value, vocabulary.owners) || (rawId.test(lower) ? lower : null);
        if (!owner) return null;
        values.push(owner);
        break;
      }
      case "connection": {
        const connection = byValueOrLabel(value, vocabulary.connections);
        if (!connection) return null;
        values.push(connection);
        break;
      }
      case "family": {
        const kind = kindAliases[lower] || kindAliases[value];
        if (kind) { param = "kind"; values.push(kind); break; }
        const family = byValueOrLabel(value, vocabulary.families) || (rawId.test(lower) ? lower : null);
        if (!family) return null;
        values.push(family);
        break;
      }
      case "episode":
      case "project":
        values.push(value);
        break;
      case "upd": {
        const window = normalizeWindow(value);
        if (!window) return null;
        return { param: "upd", values: [window] };
      }
      case "created": {
        const range = createdRange(value, now);
        if (!range) return null;
        return { param: "created", values: [range.from || "", range.to || ""] };
      }
      case "results":
        if (yes.includes(lower)) return { param: "results", values: ["yes"] };
        if (no.includes(lower)) return { param: "results", values: ["no"] };
        return null;
      case "prompt": {
        const state = promptAliases[value] || (rawId.test(lower) ? lower : null);
        if (!state) return null;
        values.push(state);
        break;
      }
      case "sort": {
        const sort = sortAliases[value] || (/^(task|state|updated):(asc|desc)$/.test(lower) ? lower : null);
        if (!sort) return null;
        return { param: "sort", values: [sort] };
      }
      default:
        return null;
    }
  }
  return values.length ? { param, values: [...new Set(values)] } : null;
}

export interface ExtractedQuery {
  /** Address parameters to set; a multi-value filter is comma-separated like the filter bar writes it. */
  params: Record<string, string>;
  /** What stays in the search box (and in `q`): words, phrases, exclusions, negated or unreadable clauses. */
  rest: string;
}

/**
 * Moves every clause the page can show as a filter out of the typed text and into parameters, merged with what the
 * address already holds (a second `状态:` adds a state, it does not replace the first).
 */
export function extractTaskQuery(input: string, current: URLSearchParams, vocabulary: QueryVocabulary, now: number): ExtractedQuery {
  const params: Record<string, string> = {};
  const rest: string[] = [];
  const merged = (param: string, values: string[]) => {
    const before = (params[param] ?? current.get(param) ?? "").split(",").filter(Boolean);
    params[param] = [...new Set([...before, ...values])].join(",");
  };
  for (const token of tokens(input)) {
    const clause = parseTaskQuery(token).clauses[0];
    const resolved = clause && !clause.negated ? resolveClause(clause, vocabulary, now) : null;
    if (!clause || !resolved) { rest.push(token); continue; }
    if (resolved.param === "created") {
      const [from, to] = resolved.values;
      if (from) params.from = from;
      if (to) params.to = to;
    } else if (["upd", "results", "sort"].includes(resolved.param)) {
      params[resolved.param] = resolved.values[0];
    } else {
      merged(resolved.param, resolved.values);
    }
  }
  return { params, rest: rest.join(" ") };
}

const dayMs = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (time: number) => { const date = new Date(time); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
const isoDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** `更新:` values in one spelling: `24h`, `7d`, `今天`, `本周`, or a date range `a..b` (either end may be open). */
export function normalizeWindow(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (["今天", "today"].includes(text)) return "今天";
  if (["本周", "这周", "week", "this-week"].includes(text)) return "本周";
  const relative = /^([0-9]{1,3})(h|d|小时|天)$/.exec(text);
  if (relative && Number(relative[1]) > 0) return `${Number(relative[1])}${relative[2] === "h" || relative[2] === "小时" ? "h" : "d"}`;
  const [from, to, ...extra] = text.includes("..") ? text.split("..") : [text, text];
  if (extra.length || (!from && !to)) return null;
  if ((from && !isoDate.test(from)) || (to && !isoDate.test(to))) return null;
  if (from && to && from > to) return null;
  return text.includes("..") ? `${from}..${to}` : from;
}

/** The time span a window covers, in milliseconds; `to` is exclusive and null means open. */
export function windowBounds(window: string, now: number): { from: number | null; to: number | null } | null {
  const value = normalizeWindow(window);
  if (!value) return null;
  if (value === "今天") { const start = new Date(now); start.setHours(0, 0, 0, 0); return { from: start.getTime(), to: null }; }
  if (value === "本周") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { from: start.getTime(), to: null };
  }
  const relative = /^([0-9]+)(h|d)$/.exec(value);
  if (relative) return { from: now - Number(relative[1]) * (relative[2] === "h" ? 3_600_000 : dayMs), to: null };
  const [from, to] = value.includes("..") ? value.split("..") : [value, value];
  return {
    from: from ? Date.parse(`${from}T00:00:00Z`) : null,
    to: to ? Date.parse(`${to}T00:00:00Z`) + dayMs : null,
  };
}

/** How a window reads on a chip: 近 7 天, 今天, 2026-11-01 至 2026-11-05. */
export function windowLabel(window: string): string {
  const value = normalizeWindow(window);
  if (!value) return window;
  if (value === "今天" || value === "本周") return value;
  const relative = /^([0-9]+)(h|d)$/.exec(value);
  if (relative) return `近 ${relative[1]} ${relative[2] === "h" ? "小时" : "天"}`;
  if (!value.includes("..")) return value;
  const [from, to] = value.split("..");
  return from && to ? `${from} 至 ${to}` : from ? `${from} 起` : `${to} 止`;
}

/** `创建:` into the created-date filter's from/to: dates as given, a relative window as the dates it starts and ends on. */
export function createdRange(value: string, now: number): { from?: string; to?: string } | null {
  const window = normalizeWindow(value);
  if (!window) return null;
  const bounds = windowBounds(window, now);
  if (!bounds) return null;
  if (window.includes("..") || isoDate.test(window)) {
    const [from, to] = window.includes("..") ? window.split("..") : [window, window];
    return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return { from: localDate(bounds.from ?? now) };
}

export function promptCaptureForTask(task: Pick<TaskSnapshot, "prompt_capture" | "process">): PromptCaptureObservation | undefined {
  return task.prompt_capture || task.process?.prompt_capture || task.process?.checkpoints?.find((checkpoint) => checkpoint.prompt_capture)?.prompt_capture;
}

const taskKindOf = (task: TaskSnapshot) => kindOf((task.results || []).find((result) => result.mime)?.mime, ownerModality[task.locator.owner]);
const resultCount = (task: TaskSnapshot) => task.results?.length || 0;
const taskUpdated = (task: TaskSnapshot) => Date.parse(task.updated_at || task.started_at || task.created_at || "") || 0;

/** The text a task is searched by, most telling first. */
export function taskSearchFields(task: TaskSnapshot, vocabulary: QueryVocabulary = emptyVocabulary) {
  const connection = vocabulary.connections.find((item) => item.value === task.connection_id)?.label;
  return [
    { text: task.title, weight: 2 },
    { text: task.locator.task_ref, weight: 1.2 },
    { text: task.episode_ref || "", weight: 1.2 },
    { text: task.locator.project },
    { text: task.locator.owner },
    { text: vocabulary.owners.find((item) => item.value === task.locator.owner)?.label },
    { text: connection },
  ];
}

const listed = (selected: string | undefined, value: string | undefined) => !selected || selected.split(",").includes(value || "");

export interface CompiledTaskFilters {
  /** Whether a task passes every filter, or every filter but one (for the counts beside that filter's options). */
  matches: (task: TaskSnapshot, except?: string) => boolean;
  /** How well a task matches the words typed; 0 when nothing was typed. */
  score: (task: TaskSnapshot) => number;
  parsed: ParsedQuery;
}

/**
 * The list's filters, read once and kept as a predicate per filter. Missing timestamps never satisfy an explicit date
 * range. Words match whole or by prefix, word start or inside a field; never by letters scattered apart.
 */
export function compileTaskFilters(filters: TaskFilters, options: { vocabulary?: QueryVocabulary; now?: number } = {}): CompiledTaskFilters {
  const vocabulary = options.vocabulary || emptyVocabulary;
  const now = options.now ?? Date.now();
  const parsed = parseTaskQuery(filters.text || "");
  const terms = parsed.terms.flatMap((term) => queryTerms(term).length > 1 ? [term] : queryTerms(term));
  const updated = filters.updated ? windowBounds(filters.updated, now) : null;
  const negatedTests = parsed.clauses.filter((clause) => clause.negated).map((clause) => {
    const resolved = resolveClause({ ...clause, negated: false }, vocabulary, now);
    return (task: TaskSnapshot) => !resolved || !clauseHolds(task, resolved, now);
  });
  // A clause typed but not moved into a filter (the box still holds it) filters too, the same way the chip would.
  const positiveTests = parsed.clauses.filter((clause) => !clause.negated).map((clause) => {
    const resolved = resolveClause(clause, vocabulary, now);
    return (task: TaskSnapshot) => !resolved || clauseHolds(task, resolved, now);
  });
  const tests: Record<string, (task: TaskSnapshot) => boolean> = {
    connection: (task) => listed(filters.connection, task.connection_id),
    owner: (task) => listed(filters.owner, task.locator.owner),
    project: (task) => listed(filters.project, task.locator.project),
    state: (task) => listed(filters.state, task.state),
    family: (task) => listed(filters.family, task.locator.task_family),
    // Only worked out when the filter is set: a row may not carry results at all.
    kind: (task) => !filters.modality || listed(filters.modality, taskKindOf(task)),
    episode: (task) => listed(filters.episode, task.episode_ref || ""),
    results: (task) => filters.results === "yes" ? resultCount(task) > 0 : filters.results === "no" ? resultCount(task) === 0 : true,
    prompt: (task) => !filters.prompt || listed(filters.prompt, promptCaptureForTask(task)?.state),
    upd: (task) => {
      if (!updated) return true;
      const time = taskUpdated(task);
      return !!time && (updated.from === null || time >= updated.from) && (updated.to === null || time < updated.to);
    },
    created: (task) => {
      if (!filters.from && !filters.through) return true;
      const created = Date.parse(task.created_at);
      if (!Number.isFinite(created)) return false;
      if (filters.from && created < Date.parse(`${filters.from}T00:00:00Z`)) return false;
      if (filters.through && created >= Date.parse(`${filters.through}T00:00:00Z`) + dayMs) return false;
      return true;
    },
    text: (task) => {
      const fields = taskSearchFields(task, vocabulary);
      if (terms.length && !matchFields(fields, terms, { subsequence: false })) return false;
      if (parsed.excluded.some((term) => matchFields(fields, [term], { subsequence: false }))) return false;
      return negatedTests.every((test) => test(task)) && positiveTests.every((test) => test(task));
    },
  };
  return {
    parsed,
    matches: (task, except) => Object.entries(tests).every(([key, test]) => key === except || test(task)),
    score: (task) => terms.length ? matchFields(taskSearchFields(task, vocabulary), terms, { subsequence: false })?.score || 0 : 0,
  };
}

function clauseHolds(task: TaskSnapshot, resolved: { param: string; values: string[] }, now: number): boolean {
  const any = (value: string | undefined) => resolved.values.includes(value || "");
  switch (resolved.param) {
    case "state": return any(task.state);
    case "owner": return any(task.locator.owner);
    case "connection": return any(task.connection_id);
    case "family": return any(task.locator.task_family);
    case "kind": return any(taskKindOf(task));
    case "episode": return resolved.values.some((value) => normalizeText(task.episode_ref || "") === normalizeText(value));
    case "project": return resolved.values.some((value) => normalizeText(task.locator.project) === normalizeText(value));
    case "results": return resolved.values[0] === "yes" ? resultCount(task) > 0 : resultCount(task) === 0;
    case "prompt": return any(promptCaptureForTask(task)?.state);
    case "upd": {
      const bounds = windowBounds(resolved.values[0], now);
      const time = taskUpdated(task);
      return !!bounds && !!time && (bounds.from === null || time >= bounds.from) && (bounds.to === null || time < bounds.to);
    }
    default: return true;
  }
}

/** Typed words and no sort chosen: best match first, then the most recently updated. */
export function rankByQuery(tasks: readonly TaskSnapshot[], compiled: CompiledTaskFilters): TaskSnapshot[] {
  if (!compiled.parsed.terms.length) return [...tasks];
  return tasks.map((task, index) => ({ task, index, score: compiled.score(task), time: taskUpdated(task) }))
    .sort((a, b) => b.score - a.score || b.time - a.time || a.index - b.index)
    .map((item) => item.task);
}
