import { useCallback, useMemo } from "react";
import { liveQuery, useOverlayParams } from "./overlay-history";
import { pageWindow, parsePage, type PageWindow } from "../shared/pager";

export interface PagedRows<T> extends PageWindow {
  rows: T[];
  setPage: (page: number) => void;
}

/**
 * One page of a list, with the page number in the address (`page`, or `<prefix>page`). The page goes through the page's
 * own overlay parameters, so turning pages never adds a Back step and never disturbs an open Inspector. The address is
 * never rewritten to clamp a page: while rows are still loading a long list would otherwise lose its page on reload.
 */
export function usePagedRows<T>(rows: readonly T[], pageSize: number, overlayKeys: readonly string[], options: { prefix?: string; focusIndex?: number } = {}): PagedRows<T> {
  const [params, write] = useOverlayParams(overlayKeys);
  const param = `${options.prefix || ""}page`;
  // A link that names a row (`focus=…`) and no page opens on the page that row is on.
  const focusPage = options.focusIndex !== undefined && options.focusIndex >= 0 ? Math.floor(options.focusIndex / Math.max(1, pageSize)) + 1 : 1;
  const requested = params.has(param) ? parsePage(params.get(param)) : focusPage;
  const window = useMemo(() => pageWindow(rows.length, pageSize, requested), [pageSize, requested, rows.length]);
  const setPage = useCallback((page: number) => {
    const next = new URLSearchParams(liveQuery(params));
    if (page <= 1) next.delete(param);
    else next.set(param, String(Math.floor(page)));
    write(next, "replace");
  }, [param, params, write]);
  const pageRows = useMemo(() => rows.slice(window.start, window.end), [rows, window.end, window.start]);
  return { ...window, rows: pageRows, setPage };
}
