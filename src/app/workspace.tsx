import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorClassOf, errorCode, isAbort, type AuthMethods, type SessionScope, type WorkspaceSession } from "../shared/api/control-center-client";
import { onStaleSession } from "../shared/api/session-signals";
import { useToast } from "../components/ui";
import { clearMediaSessionCaches } from "./media-cache";
import { clearRecentItems } from "./recent-store";
import { signOut, staleSessionVerdict, staleSignalPlan } from "./session-recovery";
import { statusForFailure, type ReadState } from "../shared/read-model/read-state";

export type AuthPhase = "loading" | "login_required" | "forbidden" | "offline" | "ready";

interface WorkspaceValue {
  phase: AuthPhase;
  phaseCode: string;
  methods: AuthMethods | null;
  session: WorkspaceSession | null;
  scope: SessionScope | null;
  scopeId: string;
  /** Increments on scope change, logout, epoch change and manual refresh; reads from an older generation are discarded. */
  generation: number;
  isAdmin: boolean;
  setScope: (id: string) => void;
  refresh: () => void;
  login: (input: { username?: string; secret: string }) => Promise<void>;
  /** Ends the session on the server; resolves false, leaving the page signed in, when the server could not be told. */
  logout: () => Promise<boolean>;
  expire: () => void;
  noteEpoch: (epoch: number | undefined) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const scopeStorageKey = "yeisme.control.scope";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>("loading");
  const [phaseCode, setPhaseCode] = useState("");
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [scopeId, setScopeId] = useState("");
  const [generation, setGeneration] = useState(0);
  const epochRef = useRef<number | undefined>(undefined);
  /** The CSRF token the page holds, to tell a refusal of the current token from the late answer to an old one. */
  const csrfRef = useRef<string | undefined>(undefined);
  /** When the page last read the session because a token was refused; at most one such read per ten seconds. */
  const staleReloadAt = useRef<number | undefined>(undefined);
  const reloading = useRef(false);
  const notify = useToast();

  const adopt = useCallback((next: WorkspaceSession) => {
    epochRef.current = next.epoch;
    csrfRef.current = next.csrf;
    setSession(next);
    setScopeId((current) => {
      const remembered = current || sessionStorage.getItem(scopeStorageKey) || "";
      return next.scopes.some((scope) => scope.id === remembered) ? remembered : next.scopes[0]?.id || "";
    });
    setPhase("ready");
  }, []);

  /** The session could not be read: the page shows why instead of its old data. */
  const failSession = useCallback((error: unknown) => {
    const code = errorCode(error);
    setPhaseCode(code);
    clearMediaSessionCaches();
    csrfRef.current = undefined;
    setSession(null);
    const errorClass = errorClassOf(error);
    setPhase(errorClass === "login_required" ? "login_required" : errorClass === "forbidden" ? "forbidden" : "offline");
  }, []);

  const loadSession = useCallback(async (signal?: AbortSignal) => {
    try {
      adopt(await api.session(signal));
    } catch (error) {
      if (isAbort(error)) return;
      failSession(error);
    }
  }, [adopt, failSession]);

  useEffect(() => {
    const controller = new AbortController();
    api.authMethods(controller.signal).then(setMethods).catch(() => {});
    void loadSession(controller.signal);
    return () => controller.abort();
  }, [loadSession]);

  const setScope = useCallback((id: string) => {
    clearMediaSessionCaches();
    sessionStorage.setItem(scopeStorageKey, id);
    setScopeId(id);
    setGeneration((value) => value + 1);
  }, []);

  const refresh = useCallback(() => { void loadSession(); setGeneration((value) => value + 1); }, [loadSession]);

  const expire = useCallback(() => {
    clearMediaSessionCaches();
    setSession(null);
    setPhase("login_required");
    setPhaseCode("login_required");
    setGeneration((value) => value + 1);
  }, []);

  /** Reads the session again and makes every scoped read start over; one reload at a time. */
  const reloadSession = useCallback(() => {
    if (reloading.current) return;
    clearMediaSessionCaches();
    reloading.current = true;
    void loadSession().finally(() => {
      reloading.current = false;
      setGeneration((value) => value + 1);
    });
  }, [loadSession]);

  const noteEpoch = useCallback((epoch: number | undefined) => {
    // Only a newer epoch invalidates; an older one is a late response that the generation guard already discards.
    if (epoch === undefined || epochRef.current === undefined || epoch <= epochRef.current) return;
    reloadSession();
  }, [reloadSession]);

  // The server refused a CSRF token. Usually the cookie belongs to another session now (another tab signed in as someone
  // else): the session is read once, and if the server hands out a different token the page takes it and starts over. If it
  // hands out the very token it refused, the cause is not a stale session (a proxy that strips `Origin` refuses every write),
  // reloading would only send the same writes into the same refusal, and the page stops with the forbidden state instead.
  useEffect(() => onStaleSession((sent) => {
    const now = Date.now();
    if (reloading.current || staleSignalPlan({ sent, held: csrfRef.current, now, lastReloadAt: staleReloadAt.current }) === "ignore") return;
    staleReloadAt.current = now;
    reloading.current = true;
    void (async () => {
      try {
        const next = await api.session();
        clearMediaSessionCaches();
        if (staleSessionVerdict(sent, next.csrf) === "refused") {
          csrfRef.current = undefined;
          setSession(null);
          setPhaseCode("csrf_denied");
          setPhase("forbidden");
          return;
        }
        notify("登录状态已在别处更改，已重新读取当前身份。", "warning");
        adopt(next);
        setGeneration((value) => value + 1);
      } catch (error) {
        if (!isAbort(error)) failSession(error);
      } finally {
        reloading.current = false;
      }
    })();
  }), [notify, adopt, failSession]);

  const login = useCallback(async (input: { username?: string; secret: string }) => {
    await api.login({ ...input, keyRequired: methods?.key_required === true });
    await loadSession();
    setGeneration((value) => value + 1);
  }, [loadSession, methods?.key_required]);

  const logoutRef = useRef<() => Promise<boolean>>(async () => false);
  const logout = useCallback(async () => {
    const csrf = session?.csrf;
    if (csrf) {
      // The session cookie is HttpOnly: only the server ends the session, so the page signs out only once it has.
      const ended = await signOut(() => api.logout(csrf));
      if (!ended.ok) {
        // A refused token is handled by the stale-session path, which reads the session again.
        if (!ended.stale) notify("退出登录没有成功，会话仍然有效。", "warning", { label: "重试", run: () => void logoutRef.current() });
        return false;
      }
    }
    clearMediaSessionCaches();
    clearRecentItems();
    csrfRef.current = undefined;
    setSession(null);
    setPhase("login_required");
    setPhaseCode("");
    setGeneration((value) => value + 1);
    return true;
  }, [session?.csrf, notify]);
  logoutRef.current = logout;

  const value = useMemo<WorkspaceValue>(() => ({
    phase,
    phaseCode,
    methods,
    session,
    scope: session?.scopes.find((scope) => scope.id === scopeId) || null,
    scopeId,
    generation,
    isAdmin: session?.role === "admin",
    setScope,
    refresh,
    login,
    logout,
    expire,
    noteEpoch,
  }), [phase, phaseCode, methods, session, scopeId, generation, setScope, refresh, login, logout, expire, noteEpoch]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider missing");
  return value;
}

interface ScopedReadOptions<T> {
  /** Extra dependency key; a change re-reads within the same generation. */
  key?: string;
  enabled?: boolean;
  isEmpty?: (data: T) => boolean;
  /** Poll interval in ms computed from the latest data; null stops polling. */
  poll?: (data: T | null, failures: number) => number | null;
}

/**
 * Reads scope-bound data and discards any response whose scope, generation or key
 * changed while it was in flight. Failures after a success keep the old data as stale.
 */
export type ScopedRead<T> = ReadState<T> & { reload: () => void };

export function useScopedRead<T extends object>(
  read: (scope: string, signal: AbortSignal) => Promise<T>,
  options: ScopedReadOptions<T> = {},
): ScopedRead<T> {
  const { scopeId, generation, expire, noteEpoch, phase } = useWorkspace();
  const { key = "", enabled = true } = options;
  const [state, setState] = useState<ReadState<T>>({ status: "loading", data: null, error: null, observedAt: null });
  const [tick, setTick] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const identity = `${scopeId}|${generation}|${key}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const loadedIdentity = useRef("");
  const failures = useRef(0);

  useEffect(() => {
    identityRef.current = identity;
    failures.current = 0;
    setState({ status: "loading", data: null, error: null, observedAt: null });
  }, [identity]);

  useEffect(() => {
    if (!enabled || !scopeId || phase !== "ready") return;
    const controller = new AbortController();
    const requested = identity;
    let timer: number | undefined;
    const run = async () => {
      try {
        const data = await readRef.current(scopeId, controller.signal);
        if (controller.signal.aborted || identityRef.current !== requested) return;
        noteEpoch("epoch" in data && typeof data.epoch === "number" ? data.epoch : undefined);
        failures.current = 0;
        loadedIdentity.current = requested;
        const empty = optionsRef.current.isEmpty?.(data) ?? false;
        setState({ status: empty ? "empty" : "ready", data, error: null, observedAt: new Date().toISOString() });
        schedule(data);
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted || identityRef.current !== requested) return;
        const code = errorCode(error);
        const errorClass = errorClassOf(error);
        if (errorClass === "login_required") { expire(); return; }
        failures.current += 1;
        setState((previous) => ({
          status: statusForFailure(errorClass, code, previous.data !== null),
          data: previous.data,
          error: code,
          observedAt: previous.observedAt,
        }));
        schedule(null);
      }
    };
    const schedule = (data: T | null) => {
      const delay = optionsRef.current.poll?.(data, failures.current);
      if (delay && !controller.signal.aborted) timer = window.setTimeout(() => void run(), delay);
    };
    void run();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [identity, enabled, scopeId, phase, tick, expire, noteEpoch]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return loadedIdentity.current === identity || state.data === null ? { ...state, reload } : { status: "loading", data: null, error: null, observedAt: null, reload };
}
