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
  /** True when the latest observation cycle failed as a whole, so the rows come from an earlier cycle. */
  readFailed: boolean;
  lanes: {
    active: TaskLaneObservation;
    history: TaskLaneObservation;
  };
  refresh: () => void;
  /** Replace one row in place after a detail re-read of the original task. */
  upsert: (task: TaskSnapshot) => void;
  /** How much history the rows cover, for a query to say honestly what it searched. */
  coverage: TaskCoverage;
  /** Reads `pages` more history pages per connection, from where the last read stopped; the rows join the list. */
  readDeeper: (pages?: number) => void;
  cancelDeeper: () => void;
  /** After an expired cursor: forget the deeper rows and start the history over from its first page. */
  restartDeeper: () => void;
}

export interface TaskCoverage {
  /** History pages read per connection: the regular cycle's plus every deeper read. */
  historyPages: number;
  /** The history lane has older pages nobody has read yet. */
  more: boolean;
  /** Rows that only a deeper read brought in. */
  deeperRows: number;
  deeper: { status: "idle" | "reading" | "error" | "expired"; error: string | null; done: number; total: number };
}

export interface TaskLaneObservation {
  status: ReadStatus;
  error: string | null;
  observedAt: string | null;
  /** The lane's own read failed, so none of its tasks are in the batch (rather than one connection reporting a state). */
  failed?: boolean;
}

const TaskContext = createContext<TaskObservation | null>(null);

interface DeepRead {
  rows: Map<string, TaskSnapshot>;
  pages: number;
  /** Where the next deeper read starts; null until the first deeper read, which starts where the cycle stopped. */
  remaining: Record<string, string> | null;
  status: TaskCoverage["deeper"]["status"];
  error: string | null;
  done: number;
  total: number;
}
const emptyDeep: DeepRead = { rows: new Map(), pages: 0, remaining: null, status: "idle", error: null, done: 0, total: 0 };

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
    const { truncated, remaining, pages, ...page } = await readTaskPagesBounded(async (cursors) => {
      const next = await api.tasks(scope, mode, cursors, signal);
      epoch = next.epoch;
      return next;
    }, maxPages);
    return { page, epoch, truncated: truncated !== null, remaining, pages, lane: stateForPage(mode, page) };
  } catch (error) {
    if (isAbort(error)) throw error;
    const code = errorCode(error);
    const errorClass = errorClassOf(error);
    return {
      page: null,
      epoch,
      truncated: false,
      remaining: {} as Record<string, string>,
      pages: 0,
      lane: { status: statusForFailure(errorClass, code, false), error: code, observedAt: null, failed: true } satisfies TaskLaneObservation,
    };
  }
}

type LaneRead = Awaited<ReturnType<typeof readLane>>;

/** Carries a failed lane read out of the observation cache, which stores only reads that returned a page. */
class LaneFailure {
  constructor(readonly read: LaneRead) {}
}

/** One observation cycle for the whole scope; shared by every page so the owner sees one consistent batch. */
export function TaskObservationProvider({ children }: { children: ReactNode }) {
  const { scopeId, generation, phase, expire, noteEpoch, session } = useWorkspace();
  const cache = useObservationCache();
  const [state, setState] = useState<Omit<TaskObservation, "refresh" | "upsert" | "coverage" | "readDeeper" | "cancelDeeper" | "restartDeeper">>({
    status: "loading",
    error: null,
    rows: [],
    connections: [],
    observedAt: null,
    refreshing: false,
    truncated: false,
    readFailed: false,
    lanes: {
      active: { status: "loading", error: null, observedAt: null },
      history: { status: "loading", error: null, observedAt: null },
    },
  });
  const [tick, setTick] = useState(0);
  // Where the regular cycle's history read stopped: the next page per connection, and how many pages it read.
  const [history, setHistory] = useState<{ remaining: Record<string, string>; pages: number; activeTruncated: boolean }>({ remaining: {}, pages: 0, activeTruncated: false });
  const [deep, setDeep] = useState<DeepRead>(emptyDeep);
  const deepController = useRef<AbortController | null>(null);
  const identity = `${scopeId}|${generation}`;
  const identityRef = useRef(identity);
  const failures = useRef(0);
  const enabled = phase === "ready" && !!scopeId && session?.task_connections !== false;

  useEffect(() => {
    identityRef.current = identity;
    failures.current = 0;
    deepController.current?.abort();
    deepController.current = null;
    setDeep(emptyDeep);
    setHistory({ remaining: {}, pages: 0, activeTruncated: false });
    setState({
      status: "loading",
      error: null,
      rows: [],
      connections: [],
      observedAt: null,
      refreshing: false,
      truncated: false,
      readFailed: false,
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
        // A failed lane read is not cached, so the next cycle or 重新读取 asks again instead of reusing the failure.
        const lane = (mode: "active" | "history", maxPages: number, freshMs: number, staleMs: number) => cache.read(`tasks:${scopeId}:${mode}`, async (signal) => {
          const read = await readLane(scopeId, mode, signal, maxPages);
          if (!read.page) throw new LaneFailure(read);
          return read;
        }, freshMs, staleMs, controller.signal).then((cached) => ({
          ...cached.data,
          lane: { ...cached.data.lane, status: cached.stale ? "stale" : cached.data.lane.status },
          stale: cached.stale,
        }), (error: unknown) => {
          if (error instanceof LaneFailure) return error.read;
          throw error;
        });
        const [active, history, observedResult] = await Promise.all([
          lane("active", 20, 3_000, 15_000),
          lane("history", 8, 30_000, 300_000),
          cache.read(`connections:${scopeId}`, (signal) => api.connections(scopeId, signal), 15_000, 60_000, controller.signal).then((v) => v).catch((error: unknown) => {
            if (isAbort(error)) throw error;
            return null;
          }),
        ]);
        if (controller.signal.aborted || identityRef.current !== requested) return;
        const observed = observedResult?.data || null;
        const observedStale = observedResult?.stale || false;
        if (active.lane.status === "login_required" || history.lane.status === "login_required") {
          expire();
          return;
        }
        noteEpoch(active.epoch ?? history.epoch);
        let combined = combineTaskPages(active.page || emptyPage(), history.page || emptyPage());
        if (observed) combined = mergeConnectionObservations(combined, observed.connections);
        const laneError = active.lane.error || history.lane.error;
        const laneFailed = [active.lane, history.lane].some((lane) => !["ready", "empty"].includes(lane.status));
        const observedFailed = observedStale;
        const observedStatus = observedFailed && combined.rows.length ? "stale" : null;
        failures.current = laneFailed ? failures.current + 1 : 0;
        const status = combined.rows.length
          ? laneFailed || observedStatus ? "stale" : "ready"
          : active.lane.status === "loading" || history.lane.status === "loading"
            ? "loading"
            : active.lane.status === "empty" && history.lane.status === "empty"
              ? "empty"
              : (active.lane.status !== "empty" ? active.lane.status : history.lane.status);
        // Both lane reads failed in transit (not refused): keep the last batch and mark it stale instead of emptying the
        // list. Refusals (forbidden, missing contract) still clear it, so revoked access never keeps showing old tasks.
        const transportFailed = !active.page && !history.page && active.lane.status === "unavailable" && history.lane.status === "unavailable";
        setState((current) => transportFailed && current.rows.length ? { ...current, status: "stale", error: laneError, refreshing: false, readFailed: true } : {
          status,
          error: laneError,
          rows: combined.rows.sort(byRecency),
          connections: combined.connections,
          observedAt: new Date().toISOString(),
          refreshing: false,
          truncated: active.truncated || history.truncated,
          readFailed: false,
          lanes: {
            active: { ...active.lane, observedAt: active.lane.observedAt || new Date().toISOString() },
            history: { ...history.lane, observedAt: history.lane.observedAt || new Date().toISOString() },
          },
        });
        if (history.page) setHistory({ remaining: history.remaining, pages: history.pages, activeTruncated: active.truncated });
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
          readFailed: true,
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

  const refresh = useCallback(() => {
    deepController.current?.abort();
    deepController.current = null;
    cache.invalidate(`tasks:${scopeId}:active`);
    cache.invalidate(`tasks:${scopeId}:history`);
    cache.invalidate(`connections:${scopeId}`);
    setDeep(emptyDeep);
    setHistory({ remaining: {}, pages: 0, activeTruncated: false });
    setTick((value) => value + 1);
  }, [cache, scopeId]);
  const upsert = useCallback((task: TaskSnapshot) => {
    setState((current) => ({ ...current, rows: current.rows.map((row) => row.task_key === task.task_key ? task : row) }));
    setDeep((current) => current.rows.has(task.task_key || "") ? { ...current, rows: new Map(current.rows).set(task.task_key!, task) } : current);
  }, []);

  const readDeeper = useCallback((pages = 8) => {
    if (deepController.current || !enabled) return;
    const start = deep.remaining ?? history.remaining;
    if (!Object.keys(start).length) return;
    const controller = new AbortController();
    deepController.current = controller;
    const requested = identityRef.current;
    let done = 0;
    setDeep((current) => ({ ...current, status: "reading", error: null, done: 0, total: pages }));
    void readTaskPagesBounded(async (cursors) => {
      const page = await api.tasks(scopeId, "history", cursors, controller.signal);
      done += 1;
      if (identityRef.current === requested) setDeep((current) => ({ ...current, done }));
      return page;
    }, pages, start).then((result) => {
      if (controller.signal.aborted || identityRef.current !== requested) return;
      setDeep((current) => {
        const rows = new Map(current.rows);
        for (const task of result.rows) if (task.task_key) rows.set(task.task_key, task);
        return { rows, pages: current.pages + result.pages, remaining: result.remaining, status: "idle", error: null, done: 0, total: 0 };
      });
    }).catch((error: unknown) => {
      if (identityRef.current !== requested) return;
      if (isAbort(error) || controller.signal.aborted) { setDeep((current) => ({ ...current, status: "idle", done: 0, total: 0 })); return; }
      if (errorClassOf(error) === "login_required") { expire(); return; }
      const code = errorCode(error);
      // The cursors are signed and short-lived: an old one is refused as a conflict, and only a fresh start helps.
      const expired = errorClassOf(error) === "conflict" || /cursor/.test(code);
      setDeep((current) => ({ ...current, status: expired ? "expired" : "error", error: code, done: 0, total: 0 }));
    }).finally(() => { if (deepController.current === controller) deepController.current = null; });
  }, [deep.remaining, enabled, expire, history.remaining, scopeId]);
  const cancelDeeper = useCallback(() => { deepController.current?.abort(); }, []);
  const restartDeeper = useCallback(() => {
    deepController.current?.abort();
    deepController.current = null;
    setDeep(emptyDeep);
    cache.invalidate(`tasks:${scopeId}:history`);
    setTick((value) => value + 1);
  }, []);

  const value = useMemo<TaskObservation>(() => {
    // Rows a deeper read brought in join the cycle's rows; the cycle's copy of a task is the fresher one.
    const known = new Set(state.rows.map((row) => row.task_key));
    const extra = [...deep.rows.values()].filter((row) => !known.has(row.task_key));
    const more = Object.keys(deep.remaining ?? history.remaining).length > 0;
    return {
      ...state,
      rows: extra.length ? [...state.rows, ...extra].sort(byRecency) : state.rows,
      // After a deeper read, history counts as cut short only while older pages remain unread.
      truncated: deep.remaining ? history.activeTruncated || more : state.truncated,
      status: enabled ? state.status : session?.task_connections === false ? "forbidden" : state.status,
      error: enabled ? state.error : session?.task_connections === false ? "personal_connection_required" : state.error,
      refresh,
      upsert,
      coverage: { historyPages: history.pages + deep.pages, more, deeperRows: extra.length, deeper: { status: deep.status, error: deep.error, done: deep.done, total: deep.total } },
      readDeeper,
      cancelDeeper,
      restartDeeper,
    };
  }, [state, deep, history, enabled, session?.task_connections, refresh, upsert, readDeeper, cancelDeeper, restartDeeper]);
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
