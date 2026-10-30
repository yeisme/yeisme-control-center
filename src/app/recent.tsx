import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWorkspace } from "./workspace";
import { pushRecent, readRecent, recentPrefix, type RecentItem } from "./recent-store";

export { clearRecentItems, recentTarget, type RecentItem, type RecentKind } from "./recent-store";

/** `scope` is the scope `items` were loaded for; it lags one commit behind a scope switch, so readers can wait for it. */
const RecentContext = createContext<{ items: RecentItem[]; scope: string; remember: (item: RecentItem) => void }>({ items: [], scope: "", remember: () => {} });

/** Recently opened items for the current identity and scope, kept for this tab only. */
export function RecentProvider({ children }: { children: ReactNode }) {
  const { session, scopeId } = useWorkspace();
  const identity = session ? session.identity || session.username || session.name : "";
  const storageKey = identity && scopeId ? `${recentPrefix}${identity}:${scopeId}` : "";
  const [loaded, setLoaded] = useState<{ scope: string; items: RecentItem[] }>({ scope: "", items: [] });
  // Updated after the page's own effects: the commit that switches scope still renders the previous scope's
  // shared task data once, and anything a page records during that commit is dropped.
  const settledKey = useRef("");
  useEffect(() => {
    settledKey.current = storageKey;
    setLoaded({ scope: scopeId, items: storageKey ? readRecent(sessionStorage, storageKey) : [] });
  }, [storageKey, scopeId]);
  const remember = useCallback((item: RecentItem) => {
    if (!storageKey || settledKey.current !== storageKey) return;
    setLoaded((current) => {
      const next = pushRecent(current.items, item);
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage disabled or full: the in-memory list still works. */ }
      return { ...current, items: next };
    });
  }, [storageKey]);
  const value = useMemo(() => ({ items: loaded.items, scope: loaded.scope, remember }), [loaded, remember]);
  return <RecentContext.Provider value={value}>{children}</RecentContext.Provider>;
}

export const useRecentItems = () => useContext(RecentContext);

/** Records the item a page has open; only a change of the item itself records it again. */
export function useRememberRecent(item: RecentItem | null) {
  const { remember } = useRecentItems();
  const latest = useRef(remember);
  latest.current = remember;
  const signature = item ? JSON.stringify(item) : "";
  useEffect(() => { if (signature) latest.current(JSON.parse(signature) as RecentItem); }, [signature]);
}
