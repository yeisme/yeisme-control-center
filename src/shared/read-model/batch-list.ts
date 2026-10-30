import type { GenerationBatchQuery } from "../collaboration";

/**
 * The batch list keeps its state in the address: the filter bar's `batchFilter*` keys, the page cursor under the same
 * prefix (so changing a filter drops it), and `batch` for one batch opened from a reminder or a link.
 */
export const batchFilterPrefix = "batchFilter";
const filterKeys = ["q", "state", "owner", "from", "to"] as const;

/** A calendar day becomes an instant in local time: `from` at the start of its day, `to` at the start of the next. */
export function dayStart(day: string, next = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (next) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

/** The list query the address describes. */
export function batchListQuery(params: URLSearchParams, limit = 20): GenerationBatchQuery {
  const get = (key: string) => params.get(batchFilterPrefix + key) || undefined;
  return { q: get("q"), state: get("state"), owner: get("owner"), from: dayStart(get("from") || ""), to: dayStart(get("to") || "", true), cursor: get("cursor"), limit };
}

/** Whether a filter narrows the list; a page cursor or an opened batch alone does not. */
export function batchListFiltered(params: URLSearchParams) {
  return filterKeys.some((key) => !!params.get(batchFilterPrefix + key));
}

/** Moves to a page of the list (`null` for the newest), keeping the filters and the opened batch. */
export function pageBatchList(params: URLSearchParams, cursor: string | null) {
  const next = new URLSearchParams(params);
  if (cursor) next.set(batchFilterPrefix + "cursor", cursor);
  else next.delete(batchFilterPrefix + "cursor");
  return next;
}

/** Closes the opened batch, keeping the filters and the page. */
export function closeOpenedBatch(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete("batch");
  return next;
}
