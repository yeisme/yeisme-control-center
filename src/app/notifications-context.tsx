import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorCode, isAbort, type NotificationPage, type TaskNotification } from "../shared/api/control-center-client";
import { countsAsHomeAttention, countsAsUnread, isReminderState } from "../notifications";
import { ownerLabel } from "../components/ui";
import { affectsDesktop, desktopSupport, desktopUnavailableMessages, readDesktop, stepDesktop, writeDesktop, type DesktopNotice, type DesktopSupport } from "./desktop-notifications";
import { browserRefreshEnv, ChangeClock, mergeFirstPage, readUnlessChanged, scheduleSnoozeEnd, startRefresh } from "./reminder-refresh";
import { useTasks } from "./tasks-context";
import { useWorkspace } from "./workspace";

/** Desktop notifications: what the browser allows, whether this account turned them on, and the switch. */
export interface DesktopControl {
  support: DesktopSupport;
  on: boolean;
  /**
   * Turns them on or off. The browser is asked for permission on the call that turns them on and nowhere else. Resolves
   * with the reason, in words for the person, when they could not be turned on.
   */
  set: (on: boolean) => Promise<string | null>;
}

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
  /** Replace the list with a freshly read first page, including the server's counts over every row. */
  apply: (page: Pick<NotificationPage, "rows" | "unread" | "attention" | "next_cursor">) => void;
  /** Replace one row after a single-row action, adjusting the counts by what that row changed. */
  update: (row: TaskNotification) => void;
  /**
   * Call when an action on a reminder starts: a re-read that began before it may carry the state from before the action,
   * and is dropped instead of putting the old row back.
   */
  beginChange: () => void;
  /** The time the groups and the unread view are worked out against; it moves on when a snooze ends, though no row changes. */
  now: number;
  desktop: DesktopControl;
}

const NotificationContext = createContext<NotificationObservation | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const tasks = useTasks();
  const { scopeId, session, generation, phase } = useWorkspace();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [attentionTotal, setAttentionTotal] = useState<number | null>(null);
  const [rows, setRows] = useState<TaskNotification[]>([]);
  const [status, setStatus] = useState<NotificationObservation["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [tick, setTick] = useState(0);
  /** Set when a snooze ends (see `scheduleSnoozeEnd`): the server leaves the end time in the row, so nothing else would move the page on. */
  const [tickedAt, setTickedAt] = useState(0);
  const signature = useRef("");
  /** Counts every change made here; a re-read that began before one is dropped, so it cannot bring an old page back. */
  const changes = useRef(new ChangeClock());
  /** The person loaded more than the first page, so a re-read of the first page must leave the rest alone. */
  const extended = useRef(false);
  /** The scope the rows belong to; empty from a scope change until its first page arrives, so nothing plans on the old scope's rows. */
  const loaded = useRef("");
  const rowsRef = useRef<TaskNotification[]>([]);
  rowsRef.current = rows;
  const reread = useRef<(() => Promise<void>) | null>(null);
  const enabled = phase === "ready" && !!scopeId && !!session?.csrf && tasks.status !== "loading";

  useEffect(() => {
    signature.current = "";
    changes.current.bump();
    extended.current = false;
    loaded.current = "";
    setRows([]); setUnreadTotal(0); setAttentionTotal(null); setNextCursor(null);
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
        changes.current.bump(); extended.current = false; loaded.current = scopeId;
        setRows(page.rows); setUnreadTotal(page.unread); setAttentionTotal(page.attention ?? null); setNextCursor(page.next_cursor || null);
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

  // The account's desktop notification switch: stored per account, and only in force while the browser still allows it.
  const account = session?.identity || session?.username || session?.name || "";
  const [stored, setStored] = useState(false);
  const [permission, setPermission] = useState<string | undefined>(() => typeof Notification === "undefined" ? undefined : Notification.permission);
  const support = desktopSupport({ hasApi: typeof Notification !== "undefined", secure: typeof window !== "undefined" && window.isSecureContext, permission });
  const desktopOn = stored && support.state === "granted";
  const desktopOnRef = useRef(false);
  desktopOnRef.current = desktopOn;
  useEffect(() => { setStored(!!account && readDesktop(window.localStorage, account).on); }, [account]);
  // The switch belongs to the account, not to a tab: turned off (or on) in another tab, this one follows at once, so a tab
  // that is out of sight does not go on polling and notifying until it is reloaded.
  useEffect(() => {
    if (!account) return;
    const follow = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || !affectsDesktop(event.key, account)) return;
      setStored(readDesktop(window.localStorage, account).on);
      setPermission(typeof Notification === "undefined" ? undefined : Notification.permission);
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, [account]);
  // Permission that comes back by itself (it was reset or allowed again in the browser's settings) while the switch is
  // stored on: what arrived meanwhile is not news, so the next pass starts the baseline over instead of resuming an old one.
  const wasGranted = useRef(support.state === "granted");
  const rebase = useRef(false);
  useEffect(() => {
    const granted = support.state === "granted";
    if (granted && !wasGranted.current && stored) rebase.current = true;
    wasGranted.current = granted;
  }, [support.state, stored]);
  // Permission taken back in the browser's settings turns the switch off for good: allowing it again later must be a choice
  // made at the switch, not a burst of notifications for everything that arrived meanwhile.
  useEffect(() => {
    if (!stored || !account || support.state !== "unavailable") return;
    writeDesktop(window.localStorage, account, { ...readDesktop(window.localStorage, account), on: false });
    setStored(false);
  }, [stored, account, support.state]);
  // The permission is changed in the browser's own settings; look again when the person comes back to the page.
  useEffect(() => {
    const look = () => setPermission(typeof Notification === "undefined" ? undefined : Notification.permission);
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, []);

  // Every minute, and as soon as the page comes back into view, read the first page again. This reads the control
  // center's own ledger and no owner, and it is what shows what the background loop wrote while nobody was looking.
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | null = null;
    const read = async () => {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      await readUnlessChanged(changes.current, () => api.notifications(scopeId, mine.signal), (page) => {
        if (mine.signal.aborted) return;
        loaded.current = scopeId;
        setRows((current) => {
          const next = mergeFirstPage(current, page.rows, extended.current);
          return JSON.stringify(next) === JSON.stringify(current) ? current : next;
        });
        setUnreadTotal(page.unread); setAttentionTotal(page.attention ?? null);
        if (!extended.current) setNextCursor(page.next_cursor || null);
        setStatus("ready"); setError(null);
      });
    };
    reread.current = read;
    const stop = startRefresh({ refresh: read, env: browserRefreshEnv(), whileHidden: () => desktopOnRef.current });
    return () => { stop(); controller?.abort(); if (reread.current === read) reread.current = null; };
  }, [enabled, scopeId, generation]);

  // A snooze ends on its own, and the server leaves its time in the row, so a re-read brings back the same rows: the page's
  // clock is what moves the row out of the quiet group and back into the count. It moves on at each end, which also sets
  // the timer for the next one; the re-read follows the server's own counts.
  useEffect(() => {
    if (status !== "ready") return;
    return scheduleSnoozeEnd({
      rows, now: Date.now(),
      tick: () => { setTickedAt(Date.now()); void reread.current?.().catch(() => undefined); },
      set: (callback, ms) => window.setTimeout(callback, ms),
      clear: (handle) => window.clearTimeout(handle as number),
    });
  }, [rows, status, tickedAt]);

  // Desktop notifications: plan what to show for the page as it now is (see desktop-notifications.ts), and show it.
  useEffect(() => {
    if (!desktopOn || status !== "ready" || !scopeId || !account || loaded.current !== scopeId) return;
    const away = document.visibilityState === "hidden" || !document.hasFocus();
    const step = stepDesktop({
      // Read each time: the switch may have been turned off in another tab since this one last heard.
      stored: readDesktop(window.localStorage, account), scope: scopeId, rows, unread: unreadTotal, now: Date.now(), away, rebase: rebase.current,
      label: (owner) => owner === "control-center" ? "控制中心" : ownerLabel(owner),
    });
    rebase.current = false;
    if (!step) { setStored(false); return; }
    writeDesktop(window.localStorage, account, step.stored);
    for (const notice of step.notices) showDesktopNotice(notice);
  }, [rows, unreadTotal, status, desktopOn, scopeId, account]);

  const setDesktop = useCallback(async (on: boolean): Promise<string | null> => {
    if (!account) return "还没有登录。";
    const kept = readDesktop(window.localStorage, account);
    if (!on) {
      writeDesktop(window.localStorage, account, { ...kept, on: false });
      setStored(false);
      return null;
    }
    const now = desktopSupport({ hasApi: typeof Notification !== "undefined", secure: window.isSecureContext, permission: typeof Notification === "undefined" ? undefined : Notification.permission });
    if (now.state === "unavailable") return now.message;
    let answer = Notification.permission;
    if (answer !== "granted") {
      // Asked here and nowhere else: only the click that turns the switch on may bring up the browser's own prompt.
      try { answer = await Notification.requestPermission(); } catch { answer = Notification.permission; }
      setPermission(answer);
      if (answer !== "granted") return answer === "denied" ? desktopUnavailableMessages.denied : "浏览器没有给出许可，桌面通知保持关闭。";
    }
    // What is unread now never notifies; only what becomes unread from here on.
    writeDesktop(window.localStorage, account, { ...kept, on: true, baselines: scopeId ? { [scopeId]: rowsRef.current.filter((row) => countsAsUnread(row)).map((row) => row.id) } : {} });
    setStored(true);
    return null;
  }, [account, scopeId]);

  const beginChange = useCallback(() => changes.current.bump(), []);
  // Whoever asks for a new sync has just changed something (a mute, say): a re-read still on its way is from before it.
  const refresh = useCallback(() => { changes.current.bump(); setTick((value) => value + 1); }, []);
  const apply = useCallback((page: Pick<NotificationPage, "rows" | "unread" | "attention" | "next_cursor">) => {
    changes.current.bump(); extended.current = false;
    setRows(page.rows); setUnreadTotal(page.unread); setAttentionTotal(page.attention ?? null); setNextCursor(page.next_cursor || null);
  }, []);
  const update = useCallback((row: TaskNotification) => {
    const previous = rows.find((item) => item.id === row.id);
    if (!previous) return;
    changes.current.bump();
    setUnreadTotal((value) => Math.max(0, value + Number(countsAsUnread(row)) - Number(countsAsUnread(previous))));
    setAttentionTotal((value) => value === null ? null : Math.max(0, value + Number(countsAsHomeAttention(row)) - Number(countsAsHomeAttention(previous))));
    setRows((current) => current.map((item) => item.id === row.id ? row : item));
  }, [rows]);
  const moreIdentity = useRef(""); moreIdentity.current = `${scopeId}|${generation}`;
  const loadMore = useCallback(() => {
    if (!nextCursor || syncing) return;
    const identity = moreIdentity.current; setSyncing(true);
    void api.notifications(scopeId, undefined, nextCursor).then((page) => { if (identity !== moreIdentity.current) return; changes.current.bump(); extended.current = true; setRows((current) => [...current, ...page.rows.filter((v) => !current.some((r) => r.id === v.id))]); setNextCursor(page.next_cursor || null); setUnreadTotal(page.unread); setAttentionTotal(page.attention ?? null); }).catch((e) => { if (identity === moreIdentity.current) setError(errorCode(e)); }).finally(() => { if (identity === moreIdentity.current) setSyncing(false); });
  }, [nextCursor, syncing, scopeId]);
  const unread = unreadTotal;
  // The time the groups and the unread view are worked out against: taken again whenever the rows change and whenever a
  // snooze ends, so it is never older than the rows it judges (a stale one would call an ended snooze still running).
  const now = useMemo(() => Date.now(), [rows, tickedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // The server counts every row; the loaded page is only a fallback for older servers.
  const pageAttention = useMemo(() => rows.filter((row) => countsAsHomeAttention(row, now)).length, [rows, now]);
  const attention = attentionTotal ?? pageAttention;
  const unavailable = support.state === "unavailable" ? support.reason : "";
  const desktop = useMemo<DesktopControl>(() => ({ support, on: desktopOn, set: setDesktop }), [support.state, unavailable, desktopOn, setDesktop]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo<NotificationObservation>(() => ({ rows, unread, attention, hasMore: !!nextCursor, loadMore, status, error, syncing, refresh, apply, update, beginChange, now, desktop }), [rows, unread, attention, nextCursor, loadMore, status, error, syncing, refresh, apply, update, beginChange, now, desktop]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("NotificationProvider missing");
  return value;
}

/** Shows one planned notification. A click brings the page forward and opens the reminder; a browser that refuses is left alone. */
function showDesktopNotice(notice: DesktopNotice) {
  try {
    const shown = new Notification(notice.title, { body: notice.body, tag: notice.tag });
    shown.onclick = () => {
      window.focus();
      window.location.hash = notice.path;
      shown.close();
    };
  } catch {
    // Some browsers only show notifications from a service worker; there is none here, so there is nothing to fall back to.
  }
}
