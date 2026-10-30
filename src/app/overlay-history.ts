import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/** Query parameters compared as a set, so the order a page writes them in does not matter. */
export const querySignature = (params: URLSearchParams) => [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join("&");

/** How a query change moves through history, given which parameters open an overlay. */
export type OverlayMove = "open" | "switch" | "close" | "other";

export function overlayMove(before: URLSearchParams, after: URLSearchParams, overlayKeys: readonly string[]): OverlayMove {
  const count = (params: URLSearchParams) => overlayKeys.filter((key) => params.get(key)).length;
  const was = count(before);
  const now = count(after);
  if (now > was) return "open";
  if (now < was) return "close";
  return now > 0 && overlayKeys.some((key) => before.get(key) !== after.get(key)) ? "switch" : "other";
}

/**
 * The query as it is now. React Router applies navigations as transitions, so a component committed by an urgent
 * update (a viewer opening on click) can still hold the URL from before the navigation.
 */
function liveQuery(rendered: URLSearchParams) {
  const hash = window.location.hash;
  if (!hash.startsWith("#/")) return rendered;
  const index = hash.indexOf("?");
  return new URLSearchParams(index >= 0 ? hash.slice(index + 1) : "");
}

/** React Router writes history synchronously and gives every entry a unique key. */
const entryKey = () => (window.history.state as { key?: string } | null)?.key;

/**
 * Where each overlay entry was opened from: entry key to the query before it opened. Entries are matched by React
 * Router's unique key, so another visit to the same URL never inherits a way back; a reload forgets the table, and
 * closing then simply replaces the entry.
 */
const openedFrom = new Map<string, string>();

/**
 * URL-backed overlays (inspectors, detail sheets, the media viewer) share one history contract:
 * - opening one pushes an entry, so Back closes the topmost overlay and stays on the page;
 * - switching items while it is open replaces that entry, so Back still closes it in one step;
 * - closing it returns to the entry it was opened from, so the next Back goes where it would have gone before,
 *   instead of landing on a copy of the page or reopening what was just closed.
 * Other changes (filters, views) keep the page's own push or replace.
 */
export function useOverlayParams(overlayKeys: readonly string[]) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const write = useCallback((next: URLSearchParams, history: "push" | "replace" = "replace") => {
    const current = liveQuery(params);
    const key = entryKey();
    const base = key ? openedFrom.get(key) : undefined;
    const move = overlayMove(current, next, overlayKeys);
    if (move === "close" && base !== undefined && base === querySignature(next)) {
      navigate(-1);
      return;
    }
    const replace = move === "close" || move === "switch" || (move === "other" && history === "replace");
    setParams(next, { replace });
    const written = entryKey();
    if (!written) return;
    if (move === "open") openedFrom.set(written, querySignature(current));
    // A replaced entry gets a new key; it keeps the way back of the entry it replaced.
    else if (replace && base !== undefined && move !== "close") openedFrom.set(written, base);
  }, [navigate, overlayKeys, params, setParams]);
  return [params, write] as const;
}
