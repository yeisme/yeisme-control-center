import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useWorkspace } from "./workspace";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  staleUntil: number;
  promise?: Promise<T>;
}

export interface ObservationCache {
  peek: <T>(key: string) => { data: T; stale: boolean } | null;
  read: <T>(key: string, loader: () => Promise<T>, freshMs: number, staleMs: number) => Promise<{ data: T; stale: boolean }>;
  /** Publishes a value a page already read so other surfaces can peek without another request. */
  put: <T>(key: string, data: T, freshMs: number, staleMs: number) => void;
  clear: () => void;
}

export class ObservationCacheStore implements ObservationCache {
  private entries = new Map<string, CacheEntry<unknown>>();

  peek<T>(key: string) {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!entry || entry.staleUntil <= Date.now()) return null;
    return { data: entry.data, stale: entry.expiresAt <= Date.now() };
  }

  async read<T>(key: string, loader: () => Promise<T>, freshMs: number, staleMs: number) {
    const now = Date.now();
    const existing = this.entries.get(key) as CacheEntry<T> | undefined;
    if (existing && existing.expiresAt > now) return { data: existing.data, stale: false };
    if (existing?.promise) return { data: await existing.promise, stale: false };
    const promise = loader().then((data) => {
      this.entries.set(key, { data, expiresAt: Date.now() + freshMs, staleUntil: Date.now() + staleMs });
      return data;
    }).finally(() => {
      const current = this.entries.get(key) as CacheEntry<T> | undefined;
      if (current?.promise === promise) delete current.promise;
    });
    this.entries.set(key, { data: existing?.data as T, expiresAt: existing?.expiresAt || 0, staleUntil: Date.now() + staleMs, promise });
    if (this.entries.size > 256) this.entries.delete(this.entries.keys().next().value as string);
    return { data: await promise, stale: false };
  }

  put<T>(key: string, data: T, freshMs: number, staleMs: number) {
    const now = Date.now();
    this.entries.set(key, { data, expiresAt: now + freshMs, staleUntil: now + staleMs });
  }

  clear() { this.entries.clear(); }
}

const CacheContext = createContext<ObservationCache | null>(null);

export function ObservationCacheProvider({ children }: { children: ReactNode }) {
  const { scopeId, generation, session } = useWorkspace();
  const store = useRef(new ObservationCacheStore()).current;
  const identity = `${scopeId}|${generation}|${session?.epoch || 0}`;
  const identityRef = useRef(identity);

  useEffect(() => {
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    store.clear();
  }, [identity]);

  return <CacheContext.Provider value={store}>{children}</CacheContext.Provider>;
}

export function useObservationCache() {
  const value = useContext(CacheContext);
  if (!value) throw new Error("ObservationCacheProvider missing");
  return value;
}
