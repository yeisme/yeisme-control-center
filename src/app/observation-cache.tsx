import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { useWorkspace } from "./workspace";

export interface ObservationCachePolicy {
  freshMs: number;
  staleMs: number;
}

/** The client-side read policy is deliberately explicit so resource freshness does not drift by call site. */
export const OBSERVATION_CACHE_POLICIES = {
  taskActive: { freshMs: 3_000, staleMs: 15_000 },
  taskHistory: { freshMs: 30_000, staleMs: 300_000 },
  taskConnections: { freshMs: 15_000, staleMs: 60_000 },
  taskEvents: { freshMs: 3_000, staleMs: 15_000 },
  requests: { freshMs: 10_000, staleMs: 60_000 },
  requestSummary: { freshMs: 10_000, staleMs: 60_000 },
  requestObservation: { freshMs: 10_000, staleMs: 60_000 },
  toolCatalog: { freshMs: 300_000, staleMs: 1_800_000 },
} satisfies Record<string, ObservationCachePolicy>;

interface InFlight<T> {
  controller: AbortController;
  consumers: Set<symbol>;
  identityVersion: number;
  done: boolean;
  promise: Promise<T>;
}

interface CacheEntry<T> {
  data?: T;
  expiresAt: number;
  staleUntil: number;
  observedAt: string;
  identityVersion: number;
  request?: InFlight<T>;
}

export interface ObservationCache {
  peek: <T>(key: string) => { data: T; stale: boolean; observedAt: string } | null;
  read: <T>(key: string, loader: (signal: AbortSignal) => Promise<T>, freshMs: number, staleMs: number, signal?: AbortSignal) => Promise<{ data: T; stale: boolean; observedAt: string }>;
  addListener: (key: string, listener: () => void) => () => void;
  /** Publishes a value a page already read so other surfaces can peek without another request. */
  put: <T>(key: string, data: T, freshMs: number, staleMs: number) => void;
  /** Invalidates one exact resource key, or all resources when called without a key. */
  invalidate: (key?: string) => void;
  /** Changes the session/scope identity and makes every old response unable to publish. */
  setIdentity: (identity: string) => void;
  clear: () => void;
}

function aborted() {
  return new DOMException("The operation was aborted", "AbortError");
}

export class ObservationCacheStore implements ObservationCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private listeners = new Map<string, Set<() => void>>();
  private identity: string;
  private identityVersion = 0;

  constructor(identity = "") {
    this.identity = identity;
  }

  setIdentity(identity: string) {
    if (this.identity === identity) return;
    this.identity = identity;
    this.identityVersion += 1;
    this.clear();
  }

  peek<T>(key: string) {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    const now = Date.now();
    if (!entry || entry.identityVersion !== this.identityVersion || entry.data === undefined || entry.staleUntil <= now) return null;
    return { data: entry.data, stale: entry.expiresAt <= now, observedAt: entry.observedAt };
  }

  read<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, freshMs: number, staleMs: number, signal?: AbortSignal): Promise<{ data: T; stale: boolean; observedAt: string }> {
    if (signal?.aborted) return Promise.reject(aborted());
    const now = Date.now();
    let entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (entry && entry.identityVersion !== this.identityVersion) {
      this.invalidate(key);
      entry = undefined;
    }
    if (entry?.data !== undefined && entry.expiresAt > now) return Promise.resolve({ data: entry.data, stale: false, observedAt: entry.observedAt });
    if (entry?.data !== undefined && entry.staleUntil > now) {
      if (!entry.request) this.start(key, entry, loader, freshMs, staleMs, true);
      return Promise.resolve({ data: entry.data, stale: true, observedAt: entry.observedAt });
    }
    if (entry?.request) {
      return this.subscribe(entry.request, signal).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return this.read(key, loader, freshMs, staleMs, signal);
        throw error;
      });
    }
    const request = this.start(key, entry, loader, freshMs, staleMs, false);
    return this.subscribe(request, signal);
  }

  put<T>(key: string, data: T, freshMs: number, staleMs: number) {
    this.invalidate(key);
    const now = Date.now();
    this.entries.set(key, { data, expiresAt: now + freshMs, staleUntil: now + staleMs, observedAt: new Date(now).toISOString(), identityVersion: this.identityVersion });
    this.notify(key);
    this.trim();
  }

  invalidate(key?: string) {
    if (key === undefined) {
      for (const entry of this.entries.values()) this.cancel(entry);
      this.entries.clear();
      return;
    }
    const entry = this.entries.get(key);
    if (entry) this.cancel(entry);
    this.entries.delete(key);
  }

  clear() {
    this.invalidate();
  }

  addListener(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) || new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }

  private notify(key: string) {
    for (const listener of this.listeners.get(key) || []) listener();
  }

  private start<T>(key: string, previous: CacheEntry<T> | undefined, loader: (signal: AbortSignal) => Promise<T>, freshMs: number, staleMs: number, background: boolean) {
    const request = {} as InFlight<T>;
    request.controller = new AbortController();
    request.consumers = new Set();
    request.identityVersion = this.identityVersion;
    request.done = false;
    let promise!: Promise<T>;
    promise = loader(request.controller.signal).then((data) => {
      const current = this.entries.get(key) as CacheEntry<T> | undefined;
      if (current?.request === request && request.identityVersion === this.identityVersion) {
        const now = Date.now();
        this.entries.set(key, { data, expiresAt: now + freshMs, staleUntil: now + staleMs, observedAt: new Date(now).toISOString(), identityVersion: this.identityVersion, request });
        this.notify(key);
      }
      return data;
    }).finally(() => {
      request.done = true;
      const current = this.entries.get(key) as CacheEntry<T> | undefined;
      if (current?.request !== request) return;
      delete current.request;
      if (current.data === undefined || current.staleUntil <= Date.now()) this.entries.delete(key);
    });
    request.promise = promise;
    const current: CacheEntry<T> = previous && previous.identityVersion === this.identityVersion
      ? previous
      : { expiresAt: 0, staleUntil: 0, observedAt: "", identityVersion: this.identityVersion };
    current.request = request;
    this.entries.set(key, current);
    this.trim();
    if (background) void promise.catch(() => undefined);
    return request;
  }

  private subscribe<T>(request: InFlight<T>, signal?: AbortSignal): Promise<{ data: T; stale: boolean; observedAt: string }> {
    if (signal?.aborted) return Promise.reject(aborted());
    const token = Symbol();
    request.consumers.add(token);
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        request.consumers.delete(token);
        if (request.consumers.size === 0 && !request.done) request.controller.abort();
      };
      const onAbort = () => { release(); reject(aborted()); };
      signal?.addEventListener("abort", onAbort, { once: true });
      request.promise.then((data) => {
        if (settled) return;
        release();
        resolve({ data, stale: false, observedAt: new Date().toISOString() });
      }, (error: unknown) => {
        if (settled) return;
        release();
        reject(error);
      });
    });
  }

  private cancel<T>(entry: CacheEntry<T>) {
    if (entry.request && !entry.request.done) entry.request.controller.abort();
  }

  private trim() {
    while (this.entries.size > 256) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.invalidate(oldest);
    }
  }
}

const CacheContext = createContext<ObservationCache | null>(null);

export function ObservationCacheProvider({ children }: { children: ReactNode }) {
  const { scopeId, generation, session } = useWorkspace();
  const identity = `${session?.identity || session?.username || session?.name || "anonymous"}|${scopeId}|${generation}|${session?.epoch || 0}`;
  // A new identity gets a new store during render without mutating the store used by a possibly interrupted tree.
  const value = useMemo(() => new ObservationCacheStore(identity), [identity]);

  return <CacheContext.Provider value={value}>{children}</CacheContext.Provider>;
}

export function useObservationCache() {
  const value = useContext(CacheContext);
  if (!value) throw new Error("ObservationCacheProvider missing");
  return value;
}
