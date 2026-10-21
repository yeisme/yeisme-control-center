import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorClassOf, errorCode, isAbort, type AuthMethods, type SessionScope, type WorkspaceSession } from "../shared/api/control-center-client";
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
  logout: () => Promise<void>;
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
  const reloading = useRef(false);

  const adopt = useCallback((next: WorkspaceSession) => {
    epochRef.current = next.epoch;
    setSession(next);
    setScopeId((current) => {
      const remembered = current || sessionStorage.getItem(scopeStorageKey) || "";
      return next.scopes.some((scope) => scope.id === remembered) ? remembered : next.scopes[0]?.id || "";
    });
    setPhase("ready");
  }, []);

  const loadSession = useCallback(async (signal?: AbortSignal) => {
    try {
      adopt(await api.session(signal));
    } catch (error) {
      if (isAbort(error)) return;
      const code = errorCode(error);
      setPhaseCode(code);
      setSession(null);
      const errorClass = errorClassOf(error);
      setPhase(errorClass === "login_required" ? "login_required" : errorClass === "forbidden" ? "forbidden" : "offline");
    }
  }, [adopt]);

  useEffect(() => {
    const controller = new AbortController();
    api.authMethods(controller.signal).then(setMethods).catch(() => {});
    void loadSession(controller.signal);
    return () => controller.abort();
  }, [loadSession]);

  const setScope = useCallback((id: string) => {
    sessionStorage.setItem(scopeStorageKey, id);
    setScopeId(id);
    setGeneration((value) => value + 1);
  }, []);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  const expire = useCallback(() => {
    setSession(null);
    setPhase("login_required");
    setPhaseCode("login_required");
    setGeneration((value) => value + 1);
  }, []);

  const noteEpoch = useCallback((epoch: number | undefined) => {
    // Only a newer epoch invalidates; an older one is a late response that the generation guard already discards.
    if (epoch === undefined || epochRef.current === undefined || epoch <= epochRef.current || reloading.current) return;
    reloading.current = true;
    void loadSession().finally(() => {
      reloading.current = false;
      setGeneration((value) => value + 1);
    });
  }, [loadSession]);

  const login = useCallback(async (input: { username?: string; secret: string }) => {
    await api.login({ ...input, keyRequired: methods?.key_required === true });
    await loadSession();
    setGeneration((value) => value + 1);
  }, [loadSession, methods?.key_required]);

  const logout = useCallback(async () => {
    const csrf = session?.csrf;
    setSession(null);
    setPhase("login_required");
    setPhaseCode("");
    setGeneration((value) => value + 1);
    if (csrf) await api.logout(csrf).catch(() => {});
  }, [session?.csrf]);

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
  return { ...state, reload };
}
