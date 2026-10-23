import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorCode, isAbort, type TaskNotification } from "../shared/api/control-center-client";
import { countsAsHomeAttention, isReminderState } from "../notifications";
import { useTasks } from "./tasks-context";
import { useWorkspace } from "./workspace";

export interface NotificationObservation {
  rows: TaskNotification[];
  unread: number;
  attention: number;
  status: "idle" | "ready" | "unavailable";
  error: string | null;
  syncing: boolean;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
  apply: (rows: TaskNotification[]) => void;
}

const NotificationContext = createContext<NotificationObservation | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const tasks = useTasks();
  const { scopeId, session, generation, phase } = useWorkspace();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [rows, setRows] = useState<TaskNotification[]>([]);
  const [status, setStatus] = useState<NotificationObservation["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [tick, setTick] = useState(0);
  const signature = useRef("");
  const enabled = phase === "ready" && !!scopeId && !!session?.csrf && tasks.status !== "loading";

  useEffect(() => {
    signature.current = "";
    setRows([]); setUnreadTotal(0); setNextCursor(null);
    setStatus("idle");
    setError(null);
  }, [scopeId, generation]);

  useEffect(() => {
    if (!enabled || !session?.csrf) return;
    const failures = tasks.rows.filter((task) => isReminderState(task.state)).map((task) => ({
      task_key: task.task_key,
      state: task.state,
      revision: task.revision,
      native_state: task.native_state,
      title: task.title.slice(0, 240),
      locator: { owner: task.locator.owner, instance_id: task.locator.instance_id, project: task.locator.project, task_family: task.locator.task_family, task_ref: task.locator.task_ref },
      provider_recovery: task.provider_recovery?.error_code ? { state: task.provider_recovery.state, native_state: task.provider_recovery.native_state, submission_ref: null, binding_id: null, error_code: task.provider_recovery.error_code, blocker: null, safe_to_resubmit: null, review_status: null, export_status: null, artifact_refs: [] } : undefined,
    }));
    const presentKeys = tasks.rows.map((task) => task.task_key || "").filter(Boolean);
    const complete = !tasks.truncated && tasks.status !== "unavailable" && tasks.status !== "stale";
    const nextSignature = [
      scopeId,
      generation,
      tick,
      complete ? "complete" : "partial",
      tasks.observedAt || "",
      ...tasks.rows.map((task) => `${task.task_key}:${task.state}:${task.revision}:${task.native_state}:${task.provider_recovery?.error_code || ""}`),
    ].join("|");
    if (nextSignature === signature.current) return;
    signature.current = nextSignature;
    const controller = new AbortController();
    setSyncing(true);
    const batches: typeof failures[] = [];
    for (let index = 0; index < Math.max(failures.length, 1); index += 40) batches.push(failures.slice(index, index + 40));
    const syncAll = async () => {
      let page = await api.notifications(scopeId, controller.signal);
      for (let index = 0; index < batches.length; index += 1) {
        page = await api.syncNotifications(scopeId, {
          tasks: batches[index] || [],
          present_task_keys: index === batches.length - 1 ? presentKeys : [],
          complete: complete && index === batches.length - 1,
        }, session.csrf, controller.signal);
      }
      return page;
    };
    syncAll()
      .then((page) => {
        if (controller.signal.aborted) return;
        setRows(page.rows); setUnreadTotal(page.unread); setNextCursor(page.next_cursor || null);
        setStatus("ready");
        setError(null);
      })
      .catch((cause) => {
        if (isAbort(cause) || controller.signal.aborted) return;
        setStatus((current) => current === "ready" ? "ready" : "unavailable");
        setError(errorCode(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setSyncing(false); });
    return () => controller.abort();
  }, [enabled, session?.csrf, scopeId, generation, tick, tasks.rows, tasks.observedAt, tasks.truncated, tasks.status]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const apply = useCallback((next: TaskNotification[]) => { const delta = next.filter((v) => !v.read_at).length - rows.filter((v) => !v.read_at).length; setUnreadTotal((value) => Math.max(0, value + delta)); setRows(next); }, [rows]);
  const moreIdentity = useRef(""); moreIdentity.current = `${scopeId}|${generation}`;
  const loadMore = useCallback(() => {
    if (!nextCursor || syncing) return;
    const identity = moreIdentity.current; setSyncing(true);
    void api.notifications(scopeId, undefined, nextCursor).then((page) => { if (identity !== moreIdentity.current) return; setRows((current) => [...current, ...page.rows.filter((v) => !current.some((r) => r.id === v.id))]); setNextCursor(page.next_cursor || null); setUnreadTotal(page.unread); }).catch((e) => { if (identity === moreIdentity.current) setError(errorCode(e)); }).finally(() => { if (identity === moreIdentity.current) setSyncing(false); });
  }, [nextCursor, syncing, scopeId]);
  const unread = unreadTotal;
  const attention = useMemo(() => rows.filter((row) => countsAsHomeAttention(row)).length, [rows]);
  const value = useMemo<NotificationObservation>(() => ({ rows, unread, attention, hasMore: !!nextCursor, loadMore, status, error, syncing, refresh, apply }), [rows, unread, attention, nextCursor, loadMore, status, error, syncing, refresh, apply]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("NotificationProvider missing");
  return value;
}
