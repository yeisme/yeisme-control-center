/**
 * Counts beside a filter's options: for each option, how many rows the list would show with it, given every other
 * filter. A filter never narrows its own counts, so picking one state still shows how many the other states hold.
 */
export function facetCounts<T>(
  rows: readonly T[],
  keys: readonly string[],
  valuesOf: (row: T, key: string) => string | readonly string[] | null | undefined,
  passes: (row: T, except: string) => boolean,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const key of keys) {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (!passes(row, key)) continue;
      const value = valuesOf(row, key);
      const values = value === null || value === undefined ? [] : typeof value === "string" ? [value] : value;
      for (const item of new Set(values)) if (item) counts[item] = (counts[item] || 0) + 1;
    }
    out[key] = counts;
  }
  return out;
}
