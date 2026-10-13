import { controlRead as query } from "./control-api";
import { ConnectionCards } from "./connection-status";
import { useEffect, useRef, useState, type RefObject } from "react";
import "./task-monitor.css";
import { taskTarget, taskListTarget } from "./task-links";
import {
  pendingCancellation,
  rememberCancellation,
  finishCancellation,
  cancellationNeedsFollowup,
} from "./task-cancel";
import { AdminPanel, AdminTabs } from "./admin-ui";
import { mergeConnectionObservations, readTaskPages, mergeTaskObservation, combineTaskPages } from "./task-polling";
import { TaskArtifactView } from "./task-artifact";
import { Badge, Button, Empty } from "./ui";
import { ListTodo } from "./icons";
import {
  observationDelay,
  contentStateMessage,
  progressLabel,
  taskIsActive,
  taskNeedsAttention,
  filterTasks,
  type TaskFilters,
  taskStageLabels,
  taskStateLabels,
  type TaskPage,
  type TaskSnapshot,
  type TaskEvent,
} from "./task-observation";
interface CancelResult {
  task: TaskSnapshot;
  receipt: { ref: string; outcome: string; occurred_at: string | null };
}
const cancelLabels: Record<string, string> = {
  cancelled: "已取消",
  requested: "取消请求已受理，仍等待worker确认",
  already_terminal: "任务已到终态，未回滚产物",
  not_supported: "当前状态不支持取消",
  unknown: "取消处理未能确认；保留原回执并交由owner恢复，禁止自动重发",
};
const errors: Record<string, string> = {
  needs_authorization: "需要 owner 授权",
  needs_contract: "当前服务未部署观测合同",
  scope_access_denied: "当前工作区授权不可用，已清理任务与内容",
  source_unavailable: "来源暂不可用",
  invalid_mcp_response: "服务响应不符合观测合同",
  connection_endpoint_denied: "连接地址未获准",
  cancel_not_supported: "该任务不支持安全取消",
  login_required: "登录已过期，请重新登录",
};
const message = (code: string) => errors[code] || code;
export interface TaskViewState { scope: string; page: string; mode: "active" | "history"; filters: TaskFilters }
export function TaskMonitor({
  scope,
  csrf,
  page = "tasks",
  revision = 0,
  onSessionExpired,
  viewState,
}: {
  scope: string;
  csrf: string;
  page?: string;
  revision?: number;
  onSessionExpired?: () => void;
  viewState?: RefObject<Map<string, TaskViewState>>;
}) {
  const viewKey = scope + ":" + page;
  const saved = viewState?.current.get(viewKey);
  const [mode, setMode] = useState<"active" | "history">(saved?.mode || (page === "assets" ? "history" : "active")),
    [data, setData] = useState<TaskPage | null>(null),
    [selected, setSelected] = useState<TaskSnapshot | null>(null),
    [error, setError] = useState(""),
    [connectionNotice, setConnectionNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [events, setEvents] = useState<TaskEvent[]>([]),
    [eventGap, setEventGap] = useState(false),
    [tab, setTab] = useState("概况"),
    [refresh, setRefresh] = useState(0),
    [notice, setNotice] = useState(""),
    [notifications, setNotifications] = useState(false),
    [notificationHint, setNotificationHint] = useState(""),
    [targetHash, setTargetHash] = useState(location.hash),
    [targetError, setTargetError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [cancelBusy, setCancelBusy] = useState(false),
    [cancelUnknown, setCancelUnknown] = useState(false),
    [cancelMessage, setCancelMessage] = useState("");
  const emptyFilters: TaskFilters = {
    text: "",
    connection: "",
    state: "",
    family: "",
    from: "",
    through: "",
  };
  const [filters, setFilters] = useState<TaskFilters>(() => ({ ...(saved?.filters || emptyFilters), connection: taskListTarget(location.hash)?.connection || saved?.filters.connection || "" }));
  useEffect(() => { if (viewState) viewState.current.set(viewKey, { scope, page, mode, filters }); }, [scope, page, mode, filters, viewState, viewKey]);
  const listTarget = taskListTarget(targetHash);
  const linkedProject = filters.connection === listTarget?.connection ? listTarget?.project : undefined;
  const visibleRows = filterTasks(data?.rows || [], filters).filter(task => (!linkedProject || task.locator.project === linkedProject) && (page !== "assets" || task.results.length > 0));
  const attention = (data?.rows || []).filter(taskNeedsAttention);
  const works = [
    ...new Map(
      (data?.rows || []).filter((t) => t.work_url).map((t) => [t.work_url!, t]),
    ).values(),
  ];
  const notificationEnabled = useRef(false);
  const notificationSeen = useRef(new Set<string>());
  const openNotifications = useRef(new Set<Notification>());
  const notifyTask = (task: TaskSnapshot) => {
    setNotice(`${task.title} · ${taskStateLabels[task.state] || task.state}`);
    const key = task.task_key + ":" + task.state;
    if (
      !notificationEnabled.current ||
      notificationSeen.current.has(key) ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    )
      return;
    notificationSeen.current.add(key);
    if (notificationSeen.current.size > 1000) notificationSeen.current.clear();
    try {
      // Notifications deliberately omit task titles, project names and media.
      const notification = new Notification("任务状态已更新", {
        body: "返回控制中心查看原任务；完成不代表人工采用。",
        tag: key,
      });
      if (openNotifications.current.size >= 8) {
        const first = openNotifications.current.values().next().value;
        first?.close();
        if (first) openNotifications.current.delete(first);
      }
      openNotifications.current.add(notification);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      notification.onclose = () =>
        openNotifications.current.delete(notification);
    } catch {
      setNotificationHint("系统通知不可用，页内提示仍保留。");
    }
  };
  useEffect(
    () => () => {
      notificationEnabled.current = false;
      for (const n of openNotifications.current) n.close();
      openNotifications.current.clear();
    },
    [],
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const known = useRef(new Map<string, TaskSnapshot>()),
    cancelKey = useRef<string | undefined>(undefined),
    confirmationRevision = useRef<string>("");
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const search = "scope=" + encodeURIComponent(scope);
  useEffect(() => {
    setSelected(null);
    setFilters({ ...(saved?.filters || emptyFilters), connection: taskListTarget(location.hash)?.connection || saved?.filters.connection || "" });
    setData(null);
    setEvents([]);
    setError("");
    setNotice("");
    setConnectionNotice("");
    known.current.clear();
    notificationEnabled.current = false;
    setNotifications(false);
    setNotificationHint("");
    notificationSeen.current.clear();
    for (const n of openNotifications.current) n.close();
    openNotifications.current.clear();
  }, [scope]);
  useEffect(() => {
    setData(null);
  }, [mode]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      busy = false,
      failures = 0,
      stopped = false,
      active = true;
    const update = async () => {
      if (busy || stopped || controller.signal.aborted) return;
      busy = true;
      setLoading(true);
      try {
        const readObservation = async <T,>(path: string): Promise<T> => {
          const response = await fetch("/api/control-center/v1" + path, {
            credentials: "same-origin", cache: "no-store", signal: controller.signal,
          });
          if (response.status === 401) throw Error("login_required");
          if (response.status === 403) throw Error("scope_access_denied");
          const body = await response.json();
          if (!response.ok) throw Error(body.error || "source_unavailable");
          return body as T;
        };
        const readMode = (lane: "active" | "history") => readTaskPages((cursors) =>
          readObservation<TaskPage>(
            "/tasks?" + search + "&mode=" + lane +
              (cursors ? "&cursors=" + encodeURIComponent(JSON.stringify(cursors)) : ""),
          ),
        );
        const [tasksRead, connectionsRead] = await Promise.allSettled([
          page === "overview"
            ? Promise.all([readMode("active"), readMode("history")]).then(([activePage, historyPage]) => combineTaskPages(activePage, historyPage))
            : readMode(mode),
          readObservation<{ connections: TaskPage["connections"] }>("/connections?" + search),
        ]);
        if (controller.signal.aborted) return;
        for (const read of [tasksRead, connectionsRead]) {
          if (read.status === "rejected" && read.reason instanceof Error &&
              ["login_required", "identity_not_bound", "scope_access_denied", "scope_not_found", "personal_connection_required"].includes(read.reason.message))
            throw read.reason;
        }
        if (tasksRead.status === "rejected") throw tasksRead.reason;
        const observations = connectionsRead.status === "fulfilled" ? connectionsRead.value.connections : [];
        const observedResult = mergeConnectionObservations(tasksRead.value, observations);
        setConnectionNotice(connectionsRead.status === "rejected"
          ? "连接权限状态暂不可验证；任务快照保留，预览和下载暂不可用。" : "");
        // Apply content gates after snapshot retention as well, so stale rows
        // cannot retain enabled actions when this observation is unavailable.
        setData((old) => mergeConnectionObservations(mergeTaskObservation(old, observedResult), observations));
        setError("");
        failures = connectionsRead.status === "rejected" || observedResult.connections.some((c) => c.state !== "ready")
          ? failures + 1 : 0;
        active = observedResult.rows.some(taskIsActive);
        const denied = new Set(
          observedResult.connections
            .filter((c) => c.state === "needs_authorization")
            .map((c) => c.id),
        );
        if (denied.has(selectedRef.current?.connection_id || "")) {
          setSelected(null);
          setEvents([]);
        }

        // Terminal tasks disappear from active pages. Query the same known
        // identities (at most eight per cycle), never infer success from absence.
        const observed = new Set(observedResult.rows.map((t) => t.task_key));
        const ready = new Set(
          observedResult.connections
            .filter((c) => c.state === "ready")
            .map((c) => c.id),
        );
        for (const [key, prior] of known.current)
          if (denied.has(prior.connection_id || "")) known.current.delete(key);
        if (mode === "active") {
          const missing = [...known.current.values()]
            .filter(
              (t) =>
                taskIsActive(t) &&
                !observed.has(t.task_key) &&
                ready.has(t.connection_id || ""),
            )
            .slice(0, 8);
          for (const prior of missing) {
            try {
              const latest = await query<TaskSnapshot>(
                "/tasks/" + encodeURIComponent(prior.task_key!) + "?" + search,
                controller.signal,
              );
              if (controller.signal.aborted) return;
              known.current.set(prior.task_key!, latest);
              if (!taskIsActive(latest)) notifyTask(latest);
            } catch {
              if (controller.signal.aborted) return;
              // Rotate failures so one unavailable record cannot starve others.
              known.current.delete(prior.task_key!);
              known.current.set(prior.task_key!, prior);
            }
          }
        }
        for (const task of observedResult.rows) {
          const id = task.task_key!;
          const old = known.current.get(id);
          if (old && old.state !== task.state && !taskIsActive(task))
            notifyTask(task);
          known.current.set(id, task);
        }
        if (known.current.size > 1000) known.current.clear();
      } catch (e) {
        if (controller.signal.aborted) return;
        const code = e instanceof Error ? e.message : "source_unavailable";
        setError(code);
        setData((old) => old ? mergeConnectionObservations(old, []) : old);
        if (["login_required", "identity_not_bound"].includes(code)) onSessionExpired?.();
        failures++;
        if (
          [
            "login_required",
            "identity_not_bound",
            "scope_not_found",
            "scope_access_denied",
            "personal_connection_required",
          ].includes(code)
        ) {
          stopped = true;
          setSelected(null);
          setEvents([]);
          setData(null);
          known.current.clear();
        }
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
        if (!stopped && !controller.signal.aborted) {
          timer = setTimeout(
            update,
            observationDelay(active, false, document.hidden, failures),
          );
        }
      }
    };
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void update();
      }
    };
    document.addEventListener("visibilitychange", visible);
    void update();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [scope, mode, page, refresh, revision, onSessionExpired]);
  useEffect(() => {
    const changed = () => {
      setSelected(null);
      setTargetHash(location.hash);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    setTargetError("");
    const list = taskListTarget(targetHash);
    if (list) {
      setFilters(current => ({ ...current, connection: list.connection }));
      return;
    }
    const target = taskTarget(targetHash);
    if (!target) return;
    const c = new AbortController();
    void query<TaskSnapshot>(
      "/tasks/resolve?" + search + "&" + new URLSearchParams({ ...target }),
      c.signal,
    )
      .then((task) => {
        if (!c.signal.aborted) {
          setSelected(task);
          setTab("概况");
          setConfirm(false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setTargetError(e instanceof Error ? e.message : "task_not_found");
      });
    return () => c.abort();
  }, [scope, targetHash]);
  const selectedKey = selected?.task_key;
  useEffect(() => {
    setCancelUnknown(false);
    setCancelMessage("");
    cancelKey.current = undefined;
    if (!selected) return;
    try {
      const key = pendingCancellation(scope, selected);
      if (key) {
        cancelKey.current = key;
        setCancelUnknown(true);
        setCancelMessage("原取消结果待确认，请查询同一回执；不重发。");
      }
    } catch {
      setCancelUnknown(true);
      setCancelMessage(
        "无法读取取消恢复身份，已禁止新取消；请检查当前标签页存储。",
      );
    }
  }, [selectedKey, scope]);
  useEffect(() => {
    if (!selectedKey) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      failures = 0,
      busy = false;
    const update = async () => {
      if (busy || c.signal.aborted) return;
      busy = true;
      try {
        const detail = await query<TaskSnapshot>(
          "/tasks/" + encodeURIComponent(selectedKey) + "?" + search,
          c.signal,
        );
        if (c.signal.aborted) return;
        setSelected((v) => (v?.task_key === selectedKey ? detail : v));
        failures = 0;
        const old = selectedRef.current;
        if (old && old.state !== detail.state && !taskIsActive(detail))
          notifyTask(detail);
        if (taskIsActive(detail))
          timer = setTimeout(
            update,
            observationDelay(true, true, document.hidden),
          );
      } catch (e) {
        if (!c.signal.aborted) {
          failures++;
          const code = e instanceof Error ? e.message : "source_unavailable";
          setError(code);
          if (["login_required", "identity_not_bound"].includes(code)) onSessionExpired?.();
          if (
            [
              "needs_authorization",
              "login_required",
              "scope_not_found",
              "owner_action_denied",
            ].includes(code)
          ) {
            setSelected(null);
            setEvents([]);
          } else
            timer = setTimeout(
              update,
              observationDelay(true, true, document.hidden, failures),
            );
        }
      } finally {
        busy = false;
      }
    };
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void update();
      }
    };
    document.addEventListener("visibilitychange", visible);
    void update();
    return () => {
      c.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [selectedKey, scope]);
  useEffect(() => {
    setEvents([]);
    setEventGap(false);
    if (tab !== "执行与证据" || !selectedKey) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      cursor = "",
      failures = 0,
      stopped = false;
    const update = async () => {
      try {
        const r = await query<{
          events: TaskEvent[];
          next_cursor?: string;
          gap?: boolean;
        }>(
          "/tasks/" +
            encodeURIComponent(selectedKey) +
            "/events?" +
            search +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          c.signal,
        );
        if (c.signal.aborted) return;
        setEvents((old) =>
          [
            ...new Map(
              [...(r.gap ? [] : old), ...r.events].map((e) => [e.id, e]),
            ).values(),
          ].slice(-500),
        );
        if (r.gap) setEventGap(true);
        cursor = r.next_cursor || cursor;
        failures = 0;
      } catch (e) {
        if (!c.signal.aborted) {
          failures++;
          const code = e instanceof Error ? e.message : "source_unavailable";
          if (
            [
              "needs_authorization",
              "login_required",
              "scope_not_found",
              "owner_action_denied",
            ].includes(code)
          ) {
            stopped = true;
            setEvents([]);
            setSelected(null);
          }
          if (["login_required", "identity_not_bound"].includes(code)) onSessionExpired?.();
          setError("事件读取失败，任务快照仍可查看");
        }
      } finally {
        if (!stopped && !c.signal.aborted)
          timer = setTimeout(
            update,
            observationDelay(true, false, document.hidden, failures),
          );
      }
    };
    void update();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [tab, selectedKey, scope]);
  const open = (task: TaskSnapshot) => {
    setSelected(task);
    setTab(page === "assets" ? "结果" : "概况");
    setConfirm(false);
    cancelKey.current = undefined;
    setCancelUnknown(false);
    setCancelMessage("");
  };
  return (
    <div className="task-monitor space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {page === "services"
              ? "服务任务接入"
              : page === "overview"
                ? "运行摘要"
                : page === "assets" ? "任务结果与资产引用" : "任务与执行进展"}
          </h2>
          <p className="text-sm text-muted-foreground">
            来自已授权 MCP 实例；不触发生成或自动重试。
          </p>
        </div>
        <div className="task-page-actions">
        <Button
          aria-pressed={notifications}
          onClick={async () => {
            if (notificationEnabled.current) {
              notificationEnabled.current = false;
              setNotifications(false);
              for (const n of openNotifications.current) n.close();
              openNotifications.current.clear();
              return;
            }
            if (!("Notification" in window)) {
              setNotificationHint("当前浏览器不支持系统通知。");
              return;
            }
            const activeScope = scope;
            try {
              const permission = await Notification.requestPermission();
              if (activeScope !== scopeRef.current) return;
              notificationEnabled.current = permission === "granted";
              setNotifications(permission === "granted");
              setNotificationHint(
                permission === "granted"
                  ? "仅当前工作区、本次会话启用；关闭页面后不后台观察。"
                  : "未授予系统通知权限；保留页内提示。",
              );
            } catch {
              setNotificationHint("系统通知不可用，页内提示仍保留。");
            }
          }}
        >
          {notifications ? "关闭系统通知" : "开启系统通知"}
        </Button>
        <Button onClick={() => setRefresh((n) => n + 1)} disabled={loading}>
          {loading ? "正在读取" : "刷新观察"}
        </Button>
        </div>
      </div>
      {targetError && (
        <p role="alert">{targetError} · 链接目标未通过当前范围授权。</p>
      )}
      {notificationHint && (
        <p role="status" className="text-sm text-muted-foreground">
          {notificationHint}
        </p>
      )}
      {notice && (
        <div role="status" className="rounded-lg border p-3">
          {notice}
          <Button className="ml-3" onClick={() => setNotice("")}>
            关闭提示
          </Button>
        </div>
      )}
      {connectionNotice && <p role="status" className="text-sm text-muted-foreground">{connectionNotice}</p>}
      {error && (
        <div role="alert" className="rounded-lg border p-3">
          {message(error)} · 保留上次观察，不认定任务失败。
        </div>
      )}
      <div className={page === "overview" ? "task-overview-grid" : undefined}>
        {page === "overview" && (
          <section
            className="rounded-xl border p-4 space-y-3"
            aria-label="现在需要处理"
          >
            <h3 className="font-semibold">现在需要处理</h3>
            <p className="text-sm text-muted-foreground">
              按原任务事实显示，不推断费用、失败原因或业务影响。
            </p>
            {attention.slice(0, 6).map((t) => (
              <article key={t.task_key} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <strong>{t.title}</strong>
                  <Badge
                    state={t.state}
                    label={taskStateLabels[t.state] || t.state}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.locator.owner} · {t.locator.project} · {t.locator.task_ref}
                </p>
                <p className="text-sm">
                  {t.state === "unknown"
                    ? "结果尚未确认；只查询原任务，不重投。"
                    : t.state === "waiting_review"
                      ? "执行已结束，人工审阅与采用仍是独立动作。"
                      : "保留已有结果；查看原任务，不自动重试。"}
                </p>
                <Button onClick={() => open(t)}>查看原任务</Button>
              </article>
            ))}
            {!attention.length && (
              <p className="text-sm">
                {data
                  ? "当前批次未发现待处理记录；不代表所有来源正常。"
                  : "正在读取已授权来源。"}
              </p>
            )}
            {attention.length > 6 && (
              <p className="text-sm">
                这里只显示前6项，其余请在下方任务列表筛选。
              </p>
            )}
          </section>
        )}
        <ConnectionCards connections={data?.connections || []} now={now} onOpen={page === "overview" ? owner => { location.hash = "#/services?owner=" + encodeURIComponent(owner); } : undefined} />
      </div>
      {page === "overview" && (
        <div className="task-result-grid">
        <section
          className="rounded-xl border p-4 space-y-3"
          aria-label="继续作品"
        >
          <h3 className="font-semibold">继续作品</h3>
          {works.slice(0, 6).map((t) => (
            <a
              key={t.work_url}
              href={t.work_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block underline"
            >
              {t.locator.project} · {t.episode_ref} · 返回作品
            </a>
          ))}
          {!works.length && (
            <p className="text-sm text-muted-foreground">
              当前批次未提供授权作品关联。只按明确引用定位，不猜测同名项目。
            </p>
          )}
          {works.length > 6 && (
            <p className="text-sm">其余作品可从下方原任务返回。</p>
          )}
        </section>
        <section className="rounded-xl border p-4 space-y-3" aria-label="最近结果">
          <h3 className="font-semibold">最近结果</h3>
          {(data?.rows || []).filter(t => t.results.length > 0).sort((a, b) =>
            (Date.parse(b.updated_at || b.created_at) || 0) - (Date.parse(a.updated_at || a.created_at) || 0)
          ).slice(0, 4).map(t => <div className="task-result-row" key={t.task_key}>
            <div><strong>{t.title}</strong><p className="text-xs text-muted-foreground">{t.locator.owner} · {t.results.length} 项结果</p></div>
            <Button variant="ghost" onClick={() => { open(t); setTab("结果"); }}>查看结果</Button>
          </div>)}
          {!data?.rows.some(t => t.results.length > 0) && <p className="text-sm text-muted-foreground">当前观察尚无结果引用；内容权限在打开时校验。</p>}
        </section>
        </div>
      )}
      {data?.connections.length === 0 && (
        <Empty
          title="当前工作区没有观测连接"
          description="使用本机配置命令登记服务、项目和受限凭据引用；不会复用浏览器或 Agent 密钥。"
        />
      )}
      {page === "overview" && <p className="text-sm text-muted-foreground">活动与历史观察合并 · 当前授权批次 {data?.rows.length ?? "—"} 项 · 不代表全量统计</p>}
      {page === "assets" ? <p className="text-sm text-muted-foreground">只展示当前授权历史批次中的结果引用，不是全量资产库。预览和下载仍需 owner 的独立内容授权。</p> : page !== "overview" && <AdminTabs
        value={mode}
        onChange={(v) => setMode(v as "active" | "history")}
        items={[
          { id: "active", label: "进行中与待确认" },
          { id: "history", label: "任务历史与结果" },
        ]}
      />}
      <fieldset className="task-filters rounded-xl border p-3">
        <legend className="px-1 text-sm">筛选当前授权批次</legend>
        <label>
          任务 / 项目引用
          <input
            value={filters.text}
            onChange={(e) => setFilters({ ...filters, text: e.target.value })}
            type="search"
          />
        </label>
        <label>
          服务实例
          <select
            aria-label="服务实例"
            value={filters.connection}
            onChange={(e) =>
              setFilters({ ...filters, connection: e.target.value })
            }
          >
            <option value="">全部实例</option>
            {data?.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} · {c.instance_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          任务状态
          <select
            aria-label="任务状态"
            value={filters.state}
            onChange={(e) => setFilters({ ...filters, state: e.target.value })}
          >
            <option value="">全部状态</option>
            {[...new Set((data?.rows || []).map((t) => t.state))]
              .sort()
              .map((s) => (
                <option key={s} value={s}>
                  {taskStateLabels[s] || s}
                </option>
              ))}
          </select>
        </label>
        <label>
          任务族
          <select
            aria-label="任务族"
            value={filters.family}
            onChange={(e) => setFilters({ ...filters, family: e.target.value })}
          >
            <option value="">全部任务族</option>
            {[...new Set((data?.rows || []).map((t) => t.locator.task_family))]
              .sort()
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </select>
        </label>
        <label>
          创建起日（UTC）
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          创建止日（UTC）
          <input
            type="date"
            value={filters.through}
            onChange={(e) =>
              setFilters({ ...filters, through: e.target.value })
            }
          />
        </label>
        <Button onClick={() => setFilters(emptyFilters)}>清除筛选</Button>
      </fieldset>
      <p className="text-sm text-muted-foreground">
        显示 {visibleRows.length} / {data?.rows.length ?? 0} 项 ·
        有界观察，不是所有历史记录；缺失日期不进入日期筛选。
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3">任务 / 来源</th>
              <th className="p-3">{page === "assets" ? "结果与权限" : "执行阶段"}</th>
              <th className="p-3">进度</th>
              <th className="p-3">观察</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((t) => (
              <tr key={t.task_key} className="border-b last:border-0">
                <td className="p-3">
                  <button
                    className="text-left font-medium underline-offset-4 hover:underline"
                    onClick={() => open(t)}
                  >
                    {t.title}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {t.locator.owner} · {t.locator.task_ref}
                  </p>
                </td>
                <td className="p-3">
                  <Badge
                    state={t.state}
                    label={taskStateLabels[t.state] || t.state}
                  />
                  <p>{page === "assets" ? `${t.results.length} 项结果 · 点击查看授权预览` : taskStageLabels[t.stage] || t.stage}</p>
                </td>
                <td className="p-3 tabular-nums">
                  {progressLabel(t.progress)}
                </td>
                <td className="p-3 text-xs">
                  {new Date(t.observed_at).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && visibleRows.length === 0 && data.connections.length > 0 && (
        <Empty
          title={page === "assets" ? "当前批次没有可见结果" : "当前批次没有任务"}
          description="空批次不代表所有来源均可用；请查看上方接入状态。"
        />
      )}
      {selected && (
        <AdminPanel
          open
          editing={false}
          live
          icon={<ListTodo size={20} />}
          status={<><Badge state={selected.state} label={taskStateLabels[selected.state] || selected.state} /><span>{selected.results.length} 项结果</span></>}
          title={selected.title}
          subtitle={selected.locator.owner + " · " + selected.locator.task_ref}
          stage="detail"
          context={selected.locator.project}
          objectKey={selected.task_key!}
          close={() => setSelected(null)}
          tabs={
            <AdminTabs
              value={tab}
              onChange={setTab}
              items={["概况", "结果", "执行与证据"].map((id) => ({
                id,
                label: id === "结果" ? `结果（${selected.results.length}）` : id,
              }))}
            />
          }
          footer={
            <>
              {selected.work_url && (
                <a
                  href={selected.work_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  返回作品（新标签页）
                </a>
              )}
              <Button onClick={() => setSelected(null)}>返回任务列表</Button>
            </>
          }
        >
          {tab === "概况" && (
            <div className="space-y-4">
              <Badge
                state={selected.state}
                label={taskStateLabels[selected.state] || selected.state}
              />
              <h3>{taskStageLabels[selected.stage] || selected.stage || "未提供"}</h3>
              <p>
                {progressLabel(selected.progress)}
                。未提供百分比时，不推测完成时间。
              </p>
              <dl className="connection-facts">
                <dt>创建时间</dt>
                <dd>{selected.created_at || "未提供"}</dd>
                <dt>owner记录更新</dt>
                <dd>{selected.updated_at || "未提供"}</dd>
                <dt>来源入口</dt>
                <dd>{selected.source || "未提供"}</dd>
                <dt>原始状态</dt>
                <dd>{selected.native_state || "未提供"}</dd>
              </dl>
              <section className="task-content-permission" aria-label="结果内容权限">
                <h3>结果内容权限</h3>
                <p>{contentStateMessage(data?.connections.find((connection) => connection.id === selected.connection_id)?.runtime?.content)}</p>
              </section>
              <Button
                disabled={
                  cancelUnknown ||
                  !selected.allowed_actions.some(
                    (a) => a.action === "cancel" && a.enabled,
                  )
                }
                onClick={() => {
                  confirmationRevision.current = selected.revision;
                  setConfirm(true);
                }}
              >
                请求取消
              </Button>
              <p className="text-xs text-muted-foreground">
                {selected.allowed_actions.find((a) => a.action === "cancel")
                  ?.reason ||
                  "取消需 owner 明确支持；重试及重新生成请返回原工具。"}
              </p>
              {cancelMessage && <p role="status">{cancelMessage}</p>}
              {cancelUnknown && (
                <Button
                  disabled={cancelBusy}
                  onClick={async () => {
                    const key = selected.task_key;
                    setCancelBusy(true);
                    try {
                      const next = await query<CancelResult>(
                        "/tasks/" +
                          encodeURIComponent(key!) +
                          "/cancel-receipt?" +
                          search +
                          "&idempotency_key=" +
                          encodeURIComponent(cancelKey.current || ""),
                      );
                      if (selectedRef.current?.task_key !== key) return;
                      setSelected(next.task);
                      if (!cancellationNeedsFollowup(next.receipt.outcome)) {
                        finishCancellation(scope, selected);
                        cancelKey.current = undefined;
                      }
                      setCancelUnknown(
                        cancellationNeedsFollowup(next.receipt.outcome),
                      );
                      setCancelMessage(
                        cancelLabels[next.receipt.outcome] ||
                          next.receipt.outcome,
                      );
                      setError("");
                    } catch {
                      if (selectedRef.current?.task_key === key)
                        setCancelMessage(
                          "尚未查到原取消回执；保持未知，不自动重投。",
                        );
                    } finally {
                      setCancelBusy(false);
                    }
                  }}
                >
                  查询原取消回执
                </Button>
              )}
              {confirm && (
                <div role="alert" className="space-y-2 rounded-lg border p-3">
                  <p>
                    仅取消这个任务；已发生的费用不保证退还。结果未知时只查原任务。
                  </p>
                  <Button
                    disabled={cancelBusy}
                    onClick={async () => {
                      setCancelBusy(true);
                      cancelKey.current ||= crypto.randomUUID();
                      const targetKey = selected.task_key;
                      try {
                        rememberCancellation(
                          scope,
                          selected,
                          cancelKey.current,
                        );
                        const next = await query<CancelResult>(
                          "/tasks/" +
                            encodeURIComponent(selected.task_key!) +
                            "/cancel?" +
                            search,
                          undefined,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              "X-CSRF-Token": csrf,
                            },
                            body: JSON.stringify({
                              confirm: true,
                              expected_revision: confirmationRevision.current,
                              idempotency_key: cancelKey.current,
                            }),
                          },
                        );
                        if (selectedRef.current?.task_key !== targetKey) return;
                        setSelected(next.task);
                        if (!cancellationNeedsFollowup(next.receipt.outcome)) {
                          finishCancellation(scope, selected);
                          cancelKey.current = undefined;
                        }
                        setCancelMessage(
                          cancelLabels[next.receipt.outcome] ||
                            next.receipt.outcome,
                        );
                        setCancelUnknown(
                          cancellationNeedsFollowup(next.receipt.outcome),
                        );
                        setConfirm(false);
                      } catch (e) {
                        if (selectedRef.current?.task_key !== targetKey) return;
                        const code =
                          e instanceof Error
                            ? e.message
                            : "cancel_outcome_unknown";
                        if (code === "version_conflict") {
                          finishCancellation(scope, selected);
                          cancelKey.current = undefined;
                          setConfirm(false);
                          setCancelUnknown(false);
                          setCancelMessage(
                            "任务版本已变化，未取消；请先查询原任务后重新确认。",
                          );
                          setError(code);
                          return;
                        }
                        setCancelUnknown(true);
                        setConfirm(false);
                        setCancelMessage(
                          "取消结果尚未确认，只查询同一回执；不会自动重发。",
                        );
                        setError(
                          e instanceof Error
                            ? e.message
                            : "cancel_outcome_unknown",
                        );
                      } finally {
                        setCancelBusy(false);
                      }
                    }}
                  >
                    确认取消
                  </Button>
                  <Button onClick={() => setConfirm(false)}>返回</Button>
                </div>
              )}
            </div>
          )}
          {tab === "结果" && (
            <div className="space-y-3">
              <h3>{selected.results.length} 项结果</h3>
              {selected.results.length ? (
                selected.results.map((a) => (
                  <TaskArtifactView
                    key={`${scope}:${selected.task_key}:${a.ref}`}
                    artifact={a}
                    task={selected.task_key!}
                    scope={scope}
                    csrf={csrf}
                    allowedActions={selected.allowed_actions}
                    content={data?.connections.find((connection) => connection.id === selected.connection_id)?.runtime?.content}
                    onSessionExpired={onSessionExpired}
                  />
                ))
              ) : (
                <Empty
                  title="尚无可查看的结果"
                  description="任务完成、结果读取权限和人工采用是不同事实。"
                />
              )}
            </div>
          )}
          {tab === "执行与证据" && (
            <ol className="space-y-3">
              {eventGap && (
                <li role="status">
                  事件历史存在缺口或尚未记录；以原任务快照为准，不自动恢复执行。
                </li>
              )}
              {events.map((e) => (
                <li key={e.id} className="border-b pb-2">
                  <strong>{taskStageLabels[e.stage] || e.stage}</strong>
                  <p className="text-xs text-muted-foreground">
                    {e.occurred_at}
                  </p>
                </li>
              ))}
              {events.length === 0 && (
                <li>未取得可展示事件。快照仍是当前任务依据。</li>
              )}
            </ol>
          )}
        </AdminPanel>
      )}
    </div>
  );
}
