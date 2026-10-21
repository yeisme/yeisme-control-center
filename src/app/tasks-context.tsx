import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorClassOf, errorCode, isAbort, type TaskConnectionState, type TaskSnapshot } from "../shared/api/control-center-client";
import { combineTaskPages, mergeConnectionObservations, readTaskPagesBounded } from "../task-polling";
import { observationDelay, taskIsActive, type TaskPage } from "../task-observation";
import { statusForFailure, type ReadStatus } from "../shared/read-model/read-state";
import { useWorkspace } from "./workspace";
import { useObservationCache } from "./observation-cache";

export interface TaskObservation {
  status: ReadStatus;
  error: string | null;
  rows: TaskSnapshot[];
  connections: TaskConnectionState[];
  observedAt: string | null;
  refreshing: boolean;
  /** True when the history lane was not fully paged (page cap); rows are a bounded batch. */
  truncated: boolean;
  lanes: {
    active: TaskLaneObservation;
    history: TaskLaneObservation;
  };
  refresh: () => void;
  /** Replace one row in place after a detail re-read of the original task. */
  upsert: (task: TaskSnapshot) => void;
}

export interface TaskLaneObservation {
  status: ReadStatus;
  error: string | null;
  observedAt: string | null;
}

const TaskContext = createContext<TaskObservation | null>(null);

const emptyPage = (): TaskPage => ({ rows: [], connections: [], next_cursors: {} });

function stateForPage(mode: "active" | "history", page: TaskPage, cachedStale = false): TaskLaneObservation {
  const channelStates = page.connections.map((connection) => connection.channels?.[mode]?.state || connection.state).filter(Boolean);
  const reason = page.connections.map((connection) => connection.channels?.[mode]?.reason || connection.state).find((value) => value && value !== "ready") || null;
  if (channelStates.some((state) => ["forbidden", "needs_authorization", "owner_action_denied"].includes(state)))
    return { status: "forbidden", error: reason || "needs_authorization", observedAt: page.connections.find((connection) => connection.observed_at)?.observed_at || null };
  if (channelStates.some((state) => ["needs_contract", "owner_action_contract_missing"].includes(state)))
    return { status: "needs_contract", error: reason || "needs_contract", observedAt: page.connections.find((connection) => connection.observed_at)?.observed_at || null };
  if (channelStates.some((state) => ["source_unavailable", "source_rate_limited", "source_busy"].includes(state)))
    return { status: page.rows.length || cachedStale ? "stale" : "unavailable", error: reason || "source_unavailable", observedAt: page.connections.find((connection) => connection.observed_at)?.observed_at || null };
  return { status: page.rows.length ? (cachedStale ? "stale" : "ready") : "empty", error: null, observedAt: page.connections.find((connection) => connection.observed_at)?.observed_at || null };
}

async function readLane(scope: string, mode: "active" | "history", signal: AbortSignal, maxPages: number) {
  let epoch: number | undefined;
  try {
    const { truncated, ...page } = await readTaskPagesBounded(async (cursors) => {
      const next = await api.tasks(scope, mode, cursors, signal);
      epoch = next.epoch;
      return next;
    }, maxPages);
    return { page, epoch, truncated: truncated !== null, lane: stateForPage(mode, page) };
  } catch (error) {
    if (isAbort(error)) throw error;
    const code = errorCode(error);
    const errorClass = errorClassOf(error);
    return {
      page: null,
      epoch,
      truncated: false,
      lane: { status: statusForFailure(errorClass, code, false), error: code, observedAt: null } satisfies TaskLaneObservation,
    };
  }
}

/** One observation cycle for the whole scope; shared by every page so the owner sees one consistent batch. */
export function TaskObservationProvider({ children }: { children: ReactNode }) {
  const { scopeId, generation, phase, expire, noteEpoch, session } = useWorkspace();
  const cache = useObservationCache();
  const [state, setState] = useState<Omit<TaskObservation, "refresh" | "upsert">>({
    status: "loading",
    error: null,
    rows: [],
    connections: [],
    observedAt: null,
    refreshing: false,
    truncated: false,
    lanes: {
      active: { status: "loading", error: null, observedAt: null },
      history: { status: "loading", error: null, observedAt: null },
    },
  });
  const [tick, setTick] = useState(0);
  const identity = `${scopeId}|${generation}`;
  const identityRef = useRef(identity);
  const failures = useRef(0);
  const enabled = phase === "ready" && !!scopeId && session?.task_connections !== false;

  useEffect(() => {
    identityRef.current = identity;
    failures.current = 0;
    setState({
      status: "loading",
      error: null,
      rows: [],
      connections: [],
      observedAt: null,
      refreshing: false,
      truncated: false,
      lanes: {
        active: { status: "loading", error: null, observedAt: null },
        history: { status: "loading", error: null, observedAt: null },
      },
    });
  }, [identity]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const requested = identity;
    let timer: number | undefined;
    const cycle = async () => {
      setState((current) => ({ ...current, refreshing: true }));
      try {
        const [activeRead, historyRead, observed] = await Promise.all([
          cache.read(`tasks:${scopeId}:active`, () => readLane(scopeId, "active", controller.signal, 20), 3_000, 15_000),
          cache.read(`tasks:${scopeId}:history`, () => readLane(scopeId, "history", controller.signal, 8), 30_000, 300_000),
          cache.read(`connections:${scopeId}`, () => api.connections(scopeId, controller.signal), 15_000, 60_000).then((v) => v.data).catch((error: unknown) => {
            if (isAbort(error)) throw error;
            return null;
          }),
        ]);
        if (controller.signal.aborted || identityRef.current !== requested) return;
        const active = activeRead.data;
        const history = historyRead.data;
        if (active.lane.status === "login_required" || history.lane.status === "login_required") {
          expire();
          return;
        }
        noteEpoch(active.epoch ?? history.epoch);
        let combined = combineTaskPages(active.page || emptyPage(), history.page || emptyPage());
        if (observed) combined = mergeConnectionObservations(combined, observed.connections);
        const laneError = active.lane.error || history.lane.error;
        const laneFailed = [active.lane, history.lane].some((lane) => !["ready", "empty"].includes(lane.status));
        failures.current = laneFailed ? failures.current + 1 : 0;
        const status = combined.rows.length
          ? laneFailed ? "stale" : "ready"
          : active.lane.status === "loading" || history.lane.status === "loading"
            ? "loading"
            : active.lane.status === "empty" && history.lane.status === "empty"
              ? "empty"
              : (active.lane.status !== "empty" ? active.lane.status : history.lane.status);
        setState({
          status,
          error: laneError,
          rows: combined.rows.sort(byRecency),
          connections: combined.connections,
          observedAt: new Date().toISOString(),
          refreshing: false,
          truncated: active.truncated || history.truncated,
          lanes: {
            active: { ...active.lane, observedAt: active.lane.observedAt || new Date().toISOString() },
            history: { ...history.lane, observedAt: history.lane.observedAt || new Date().toISOString() },
          },
        });
        schedule(combined.rows.some(taskIsActive));
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted || identityRef.current !== requested) return;
        const errorClass = errorClassOf(error);
        if (errorClass === "login_required") { expire(); return; }
        failures.current += 1;
        setState((current) => ({
          ...current,
          status: statusForFailure(errorClass, errorCode(error), current.rows.length > 0 || current.observedAt !== null),
          error: errorCode(error),
          refreshing: false,
        }));
        schedule(false);
      }
    };
    const schedule = (active: boolean) => {
      if (controller.signal.aborted) return;
      // Full cycles are heavier than a single read, so the overview lane waits at least 15s.
      const delay = Math.max(15_000, observationDelay(active, false, document.hidden, failures.current));
      timer = window.setTimeout(() => void cycle(), delay);
    };
    void cycle();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [identity, enabled, scopeId, tick, expire, noteEpoch]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const upsert = useCallback((task: TaskSnapshot) => {
    setState((current) => ({ ...current, rows: current.rows.map((row) => row.task_key === task.task_key ? task : row) }));
  }, []);

  const value = useMemo<TaskObservation>(() => ({
    ...state,
    status: enabled ? state.status : session?.task_connections === false ? "forbidden" : state.status,
    error: enabled ? state.error : session?.task_connections === false ? "personal_connection_required" : state.error,
    refresh,
    upsert,
  }), [state, enabled, session?.task_connections, refresh, upsert]);
  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks() {
  const value = useContext(TaskContext);
  if (!value) throw new Error("TaskObservationProvider missing");
  return value;
}

export function taskTime(task: TaskSnapshot) {
  return Date.parse(task.updated_at || task.started_at || task.created_at || "") || 0;
}

function byRecency(a: TaskSnapshot, b: TaskSnapshot) {
  return taskTime(b) - taskTime(a);
}
