/**
 * One matcher for every search box: ⌘K, page searches and the task query. Text is compared after NFKC (so full-width
 * "ＡＢＣ１" and half-width "abc1" are the same) and case folding. A match carries the ranges it hit in the original
 * text, for highlighting.
 */
export type Range = [start: number, end: number];
export interface Match { score: number; ranges: Range[] }

export const matchScores = { exact: 1000, prefix: 800, wordStart: 600, contains: 400, subsequence: 200 } as const;

interface Prepared { text: string; starts: number[]; ends: number[] }

/** Normalized text, with where each normalized character came from in the original. */
function prepare(original: string): Prepared {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of original) {
    const piece = char.normalize("NFKC").toLocaleLowerCase();
    for (let k = 0; k < piece.length; k += 1) { starts.push(index); ends.push(index + char.length); }
    text += piece;
    index += char.length;
  }
  return { text, starts, ends };
}

export function normalizeText(value: string) {
  return prepare(value).text;
}

const separator = /[\s·・\-_/\\:：.,，。、|()（）[\]【】「」『』《》<>"'“”‘’!?！？+#@&]/;
const isCjk = (char: string) => /[㐀-鿿豈-﫿぀-ヿ가-힯]/.test(char);

/** A word starts at the beginning, after a separator, or where Latin text meets CJK text. */
function wordStart(text: string, at: number) {
  if (at === 0) return true;
  const before = text[at - 1];
  const here = text[at];
  if (separator.test(before)) return true;
  return isCjk(before) !== isCjk(here);
}

function toOriginal(prepared: Prepared, start: number, end: number): Range {
  return [prepared.starts[start], prepared.ends[end - 1]];
}

/** Merge touching or overlapping ranges, sorted. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([range[0], range[1]]);
  }
  return out;
}

/**
 * How well one term matches one text: exact > prefix > a word start > anywhere > the letters in order. Earlier and
 * tighter is better within each kind. Null when the term is not there at all.
 */
export interface MatchOptions {
  /** Letters in order within a short span; on in ⌘K, off for list filters, where a row must show why it matched. */
  subsequence?: boolean;
}

export function matchTerm(original: string, term: string, options: MatchOptions = {}): Match | null {
  const query = normalizeText(term).trim();
  if (!query) return { score: 0, ranges: [] };
  const prepared = prepare(original);
  const text = prepared.text;
  if (!text) return null;
  if (text === query) return { score: matchScores.exact, ranges: [toOriginal(prepared, 0, text.length)] };
  if (text.startsWith(query)) return { score: matchScores.prefix + Math.max(0, 100 - (text.length - query.length)), ranges: [toOriginal(prepared, 0, query.length)] };
  let first = -1;
  for (let at = text.indexOf(query); at >= 0; at = text.indexOf(query, at + 1)) {
    if (first < 0) first = at;
    if (wordStart(text, at)) return { score: matchScores.wordStart + Math.max(0, 100 - at), ranges: [toOriginal(prepared, at, at + query.length)] };
  }
  if (first >= 0) return { score: matchScores.contains + Math.max(0, 100 - first), ranges: [toOriginal(prepared, first, first + query.length)] };
  // The letters in order, within a short span: "yxgp" finds "云霄 · 光谱"-style initials, a typo never matches the world.
  if (options.subsequence === false || [...query].length < 2) return null;
  const hits: number[] = [];
  let from = 0;
  for (const char of query) {
    const at = text.indexOf(char, from);
    if (at < 0) return null;
    hits.push(at);
    from = at + char.length;
  }
  const spread = hits[hits.length - 1] - hits[0] + 1;
  if (spread > Math.max(6, query.length * 3)) return null;
  return { score: matchScores.subsequence + Math.max(0, 100 - (spread - query.length) * 10 - hits[0]), ranges: mergeRanges(hits.map((at) => toOriginal(prepared, at, at + 1))) };
}

/** Terms of a query: split on spaces; a quoted part stays one term. */
export function queryTerms(query: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|“([^”]*)”|「([^」]*)」|(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (value) out.push(value);
  }
  return out;
}

export interface Field { text: string | null | undefined; weight?: number }
export interface FieldsMatch { score: number; ranges: Range[][] }

/**
 * Every term has to match some field; the record scores the sum of each term's best field (times that field's weight)
 * and keeps the ranges per field. Null when any term matches nothing.
 */
export function matchFields(fields: Field[], terms: string[], options: MatchOptions = {}): FieldsMatch | null {
  const ranges: Range[][] = fields.map(() => []);
  if (!terms.length) return { score: 0, ranges };
  let score = 0;
  for (const term of terms) {
    let best: { score: number; field: number; match: Match } | null = null;
    fields.forEach((field, index) => {
      if (!field.text) return;
      const match = matchTerm(field.text, term, options);
      if (!match) return;
      const weighted = match.score * (field.weight ?? 1);
      if (!best || weighted > best.score) best = { score: weighted, field: index, match };
    });
    if (!best) return null;
    const found = best as { score: number; field: number; match: Match };
    score += found.score;
    ranges[found.field].push(...found.match.ranges);
  }
  return { score, ranges: ranges.map(mergeRanges) };
}
