import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Archive, BellOff, Check, CheckCheck, CircleAlert, Clock3, PanelRightOpen, RefreshCw } from "../../icons";
import { linkActions, useCopy } from "../../app/item-actions";
import { api, errorCode, type NotificationMuteRule, type TaskNotification } from "../../shared/api/control-center-client";
import { useNotifications } from "../../app/notifications-context";
import { useTasks } from "../../app/tasks-context";
import { useWorkspace } from "../../app/workspace";
import {
  ActionsContextMenu,
  ActionsMenu,
  Button,
  Checkbox,
  EmptyState,
  InlineNotice,
  MetricStrip,
  NoticeStack,
  PageToolbar,
  Panel,
  Pill,
  SkeletonRows,
  TabPanel,
  Tabs,
  TaskStatePill,
  Unknown,
  cx,
  moveBetweenRows,
  ownerLabel,
  type ItemAction,
} from "../../components/ui";
import { formatFullTime, formatRelative, formatTime } from "../../shared/read-model/format";
import { recoveryLabels } from "../../shared/read-model/tasks";
import { countsAsUnread, reminderGroup, reminderGroupLabels, reminderStateLabels, type ReminderGroup } from "../../notifications";
import { FilterBar, matchesFacet } from "../../components/FilterBar";
import { taskStateLabels } from "../../task-observation";

const groups: ReminderGroup[] = ["new", "open", "quiet", "archived"];

const nativeStateLabels: Record<string, string> = {
  ...recoveryLabels,
  ...taskStateLabels,
  connection_lost_after_submit: "提交后连接中断",
};

function nativeStateLabel(value: string | undefined) {
  if (!value) return null;
  return nativeStateLabels[value] || value.replace(/[_-]+/g, " ");
}

export default function RemindersPage() {
  const reminders = useNotifications();
  const tasks = useTasks();
  const { scopeId, session } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  const focusedItem = focus ? reminders.rows.find((item) => item.id === focus) : undefined;
  const requested = params.get("group");
  const group = (groups.includes(requested as ReminderGroup) ? requested : focusedItem ? reminderGroup(focusedItem) : "new") as ReminderGroup;
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const csrf = session?.csrf || "";
  const focusedRow = useRef<HTMLLIElement | null>(null);
  const scrolledFor = useRef<string | null>(null);

  const rows = useMemo(() => reminders.rows.filter((item) => reminderGroup(item) === group && matchesFacet(item.owner, params.get("owner") || "") && matchesFacet(countsAsUnread(item) ? "unread" : "read", params.get("read") || "") && item.title.toLocaleLowerCase().includes((params.get("q") || "").toLocaleLowerCase()) && (!params.get("from") || item.first_seen_at >= params.get("from")!) && (!params.get("to") || item.first_seen_at.slice(0, 10) <= params.get("to")!)), [reminders.rows, group, params]);
  const counts = useMemo(() => Object.fromEntries(groups.map((id) => [id, reminders.rows.filter((item) => reminderGroup(item) === id).length])) as Record<ReminderGroup, number>, [reminders.rows]);

  useEffect(() => {
    const row = focusedRow.current;
    if (!focus || !row || scrolledFor.current === focus) return;
    scrolledFor.current = focus;
    row.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.focus({ preventScroll: true });
  });


  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  const afterBulk = async () => {
    reminders.apply(await api.notifications(scopeId));
    setSelected([]);
  };

  const acknowledge = (id: string) => run(async () => {
    await api.acknowledgeNotification(scopeId, id, csrf);
    await afterBulk();
  });
  const archive = (id: string) => run(async () => {
    await api.archiveNotification(scopeId, id, csrf);
    await afterBulk();
  });
  const [rules, setRules] = useState<NotificationMuteRule[]>([]);
  const loadRules = () => api.muteRules(scopeId).then((page) => setRules(page.rows)).catch(() => undefined);
  useEffect(() => { void loadRules(); }, [scopeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const mute = (id: string, muteScope: "fingerprint" | "task" | "error_code") => run(async () => {
    await api.muteNotification(scopeId, id, csrf, muteScope);
    await afterBulk();
    if (muteScope !== "fingerprint") await loadRules();
  });
  const removeRule = (id: string) => run(async () => {
    await api.removeMuteRule(scopeId, id, csrf);
    await loadRules();
  });

  const copy = useCopy();
  // Everything a reminder offers: its context menu shows all of it, its "更多操作" all but opening and the primary button.
  const rowActions = (item: TaskNotification): ItemAction[] => [
    { id: "open", label: "打开任务", icon: <PanelRightOpen className="size-3.5" />, group: "open", run: () => navigate(item.target_path || `/tasks?task=${encodeURIComponent(item.task_key)}`) },
    { id: "acknowledge", label: "确认", icon: <Check className="size-3.5" />, group: "resolve", disabled: busy || item.state === "acknowledged", run: () => void acknowledge(item.id) },
    { id: "archive", label: "归档", icon: <Archive className="size-3.5" />, group: "resolve", disabled: busy || item.state === "archived", run: () => void archive(item.id) },
    { id: "mute", label: "仅对这次失败免提醒", icon: <BellOff className="size-3.5" />, group: "mute", disabled: busy || item.state === "muted", run: () => void mute(item.id, "fingerprint") },
    { id: "mute-task", label: "此任务以后都免提醒", icon: <BellOff className="size-3.5" />, group: "mute", disabled: busy || rules.some((rule) => rule.kind === "task" && rule.key === item.task_identity), run: () => void mute(item.id, "task") },
    {
      id: "mute-code",
      label: item.last_error_code ? `相同错误码以后都免提醒 · ${item.last_error_code}` : "相同错误码免提醒（未提供错误码）",
      icon: <BellOff className="size-3.5" />,
      group: "mute",
      disabled: busy || !item.last_error_code || item.state === "muted",
      run: () => void mute(item.id, "error_code"),
    },
    ...linkActions(`/reminders?focus=${encodeURIComponent(item.id)}`, copy),
  ];

  const bulkReason = busy ? "正在处理，请稍候" : rows.length === 0 ? "当前分组没有提醒" : undefined;
  const loading = reminders.status === "idle" && reminders.rows.length === 0;
  const syncFailed = reminders.status === "unavailable";
  const toolbarNotices = [
    notice && <InlineNotice key="notice" tone="warning">操作没有完成（错误码 <code className="font-mono">{notice}</code>）。任务状态保持不变。</InlineNotice>,
    syncFailed && reminders.rows.length > 0 && <InlineNotice key="sync" tone="warning">提醒同步失败，下面显示的是上一次同步的结果，可能不完整。</InlineNotice>,
  ];

  return <div className="page-enter space-y-5" data-page="reminders" data-unread={reminders.unread}>
    <h1 className="sr-only">提醒中心</h1>
    <PageToolbar
      foldMetrics
      summary="同一次失败只提醒一次；revision、错误码或 owner 状态变化后，才会作为新失败重新出现。确认、免提醒和归档只写入控制中心数据库，不会改动 owner 任务。"
      actions={<Button size="sm" variant="ghost" disabled={busy} onClick={() => reminders.refresh()} icon={<RefreshCw className="size-3.5" />}>重新观察</Button>}
      metrics={<div data-reminder-unread={reminders.unread}>
        <MetricStrip label="提醒概况" items={[
          // The same count as the sidebar badge and the bell: unread and not yet handled.
          { label: "未读", value: reminders.unread, tone: reminders.unread > 0 ? "warning" : "neutral" },
          { label: "提醒总数", value: reminders.rows.length },
          { label: "已观察任务", value: tasks.rows.length },
        ]} />
      </div>}
      meta={tasks.observedAt && <span className="inline-flex items-center gap-1.5 text-2xs text-muted"><Clock3 className="size-3.5" />任务观察于 {formatRelative(tasks.observedAt)}</span>}
    />
    <NoticeStack notices={toolbarNotices} />
    <FilterBar placeholder="搜索通知与提醒" dates facets={[{ key: "owner", label: "来源", options: [...new Set(reminders.rows.map((v) => v.owner))].map((v) => ({ value: v, label: ownerLabel(v) })) }, { key: "read", label: "阅读状态", options: [{ value: "read", label: "已读" }, { value: "unread", label: "未读" }] }]} />
    <Tabs<ReminderGroup>
      value={group}
      onChange={(value) => { setParams({ group: value }, { replace: true }); setSelected([]); }}
      label="提醒分组"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-4"
      options={groups.map((id) => ({ id, label: reminderGroupLabels[id], count: counts[id] }))}
    >
      <div className="flex flex-wrap items-center gap-2" data-reminder-toolbar role="group" aria-label="批量操作">
        <Button size="sm" disabled={busy || rows.length === 0} disabledReason={bulkReason} onClick={() => run(async () => { await api.bulkNotifications(scopeId, { action: "acknowledge", all: false, ids: rows.map((row) => row.id) }, csrf); await afterBulk(); })} icon={<CheckCheck className="size-3.5" />}>全部确认</Button>
        <Button size="sm" disabled={busy || rows.length === 0} disabledReason={bulkReason} onClick={() => run(async () => { await api.bulkNotifications(scopeId, { action: "archive", ids: rows.map((row) => row.id) }, csrf); await afterBulk(); })} icon={<Archive className="size-3.5" />}>全部归档</Button>
        <Button size="sm" disabled={busy || selected.length === 0} disabledReason={busy ? "正在处理，请稍候" : "先勾选要免提醒的任务"} onClick={() => run(async () => { await api.bulkNotifications(scopeId, { action: "mute", ids: selected }, csrf); await afterBulk(); })} icon={<BellOff className="size-3.5" />}>对选中任务免提醒{selected.length > 0 && `（${selected.length}）`}</Button>
      </div>
      <TabPanel value={group} className="w-full">
        {loading ? <Panel><SkeletonRows rows={4} /></Panel> : rows.length === 0 ? <Panel>
          {syncFailed
            ? <EmptyState icon={<CircleAlert />} title="提醒同步失败" body="控制中心没能读取提醒记录，这不代表没有失败。请稍后点击“重新观察”。" />
            : <EmptyState icon={<CircleAlert />} title={group === "new" ? "没有新的失败提醒" : "这一组是空的"} body="同一次失败不会因刷新或切换页面重复出现；revision、错误码或 owner 状态变化后，会作为新失败出现在这里。" />}
        </Panel> : <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-panel shadow-panel" aria-label="提醒列表" onKeyDown={(event) => moveBetweenRows(event)}>
          {rows.map((item) => {
            const checked = selected.includes(item.id);
            const focused = focus === item.id;
            const actions = rowActions(item);
            const primary = actions.find((action) => action.id === "acknowledge" && !action.disabled) || actions.find((action) => action.id === "archive" && !action.disabled);
            const more = actions.filter((action) => action !== primary && action.id !== "open");
            const title = item.title || item.task_key;
            const nativeState = nativeStateLabel(item.native_state);
            return <ActionsContextMenu key={item.id} actions={actions}><li
              ref={focused ? focusedRow : undefined}
              tabIndex={focused ? -1 : undefined}
              aria-current={focused ? "true" : undefined}
              data-reminder={item.id}
              data-focused={focused ? "true" : undefined}
              className={cx(
                "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 px-4 py-3.5 outline-none transition-colors duration-300 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
                "data-[focused=true]:bg-primary-soft/60 data-[focused=true]:ring-2 data-[focused=true]:ring-inset data-[focused=true]:ring-primary",
              )}
            >
              <Checkbox className="mt-1" checked={checked} label={`选择 ${title}`} onChange={() => setSelected((current) => checked ? current.filter((id) => id !== item.id) : [...current, item.id])} />
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button type="button" data-row-button className="max-w-full truncate text-left text-sm font-semibold hover:underline" onClick={() => navigate(item.target_path || `/tasks?task=${encodeURIComponent(item.task_key)}`)}>{title}</button>
                  <TaskStatePill state={item.task_state} />
                  <Pill size="sm" tone={item.state === "unread" ? "warning" : "neutral"}>{reminderStateLabels[item.state] || item.state}</Pill>
                  {item.recovered_at && <Pill size="sm" tone="success" title={`owner 于 ${formatFullTime(item.recovered_at)} 前后不再报告失败`}>已恢复</Pill>}
                  {item.presence === "stale" && <Pill size="sm" tone="neutral">观察中缺失</Pill>}
                  {item.priority !== "normal" && <Pill size="sm" tone="neutral">{item.priority === "history" ? "低优先级历史" : "低优先级"}</Pill>}
                </div>
                <p className="text-meta text-ink-soft">{ownerLabel(item.owner)} · {item.project || <Unknown>项目未提供</Unknown>}</p>
                <dl data-reminder-version="true" className="flex flex-wrap gap-x-5 gap-y-0.5 text-2xs">
                  <div className="flex min-w-0 gap-1.5"><dt className="shrink-0 text-muted">revision</dt><dd className="min-w-0 break-all font-mono text-ink-soft">{item.task_revision || <Unknown>未提供</Unknown>}</dd></div>
                  <div className="flex min-w-0 gap-1.5"><dt className="shrink-0 text-muted">错误码</dt><dd className="min-w-0 break-all font-mono text-ink-soft">{item.last_error_code || <Unknown>未提供</Unknown>}</dd></div>
                  <div className="flex min-w-0 gap-1.5"><dt className="shrink-0 text-muted">owner 状态</dt><dd className="min-w-0 text-ink-soft">{nativeState || <Unknown>未提供</Unknown>}</dd></div>
                </dl>
                <p className="text-2xs text-muted">
                  <span title={formatFullTime(item.first_seen_at)}>首次失败 {formatTime(item.first_seen_at)}</span>
                  <span aria-hidden="true"> · </span>
                  <span title={formatFullTime(item.last_seen_at)}>最近观察 {formatRelative(item.last_seen_at)}</span>
                </p>
              </div>
              <div className="col-start-2 flex items-center gap-1.5 sm:col-start-3 sm:row-start-1">
                {primary && <Button size="sm" disabled={busy} icon={primary.icon} onClick={primary.run}>{primary.label}</Button>}
                <ActionsMenu actions={more} label={`更多操作：${title}`} />
              </div>
            </li></ActionsContextMenu>;
          })}
        </ul>}
        {reminders.hasMore && <div className="mt-3 flex justify-center"><Button size="sm" variant="ghost" disabled={reminders.syncing} onClick={reminders.loadMore}>加载更多提醒</Button></div>}
      </TabPanel>
    </Tabs>
    {rules.length > 0 && <section aria-labelledby="mute-rules-title" data-mute-rules className="rounded-card border border-line bg-panel p-4 shadow-panel">
      <h2 id="mute-rules-title" className="text-sm font-semibold">免提醒规则 <span className="tabular text-muted">{rules.length}</span></h2>
      <p className="mt-0.5 text-2xs text-muted">命中规则的新失败仍会记录，显示为“已免提醒”，不计入未读。撤销后，以后的新失败会照常提醒。</p>
      <ul className="mt-2 divide-y divide-line">{rules.map((rule) => <li key={rule.id} className="flex items-center gap-3 py-2 text-sm">
        <Pill size="sm" tone="neutral">{rule.kind === "task" ? "此任务" : "错误码"}</Pill>
        <span className="min-w-0 flex-1 truncate">{rule.kind === "task" ? rule.label || "未命名任务" : rule.key}<span className="text-2xs text-muted"> · {ownerLabel(rule.owner)} · {formatRelative(rule.created_at)}</span></span>
        <Button size="sm" variant="ghost" disabled={busy} aria-label={`撤销免提醒规则：${rule.kind === "task" ? rule.label || "未命名任务" : rule.key}`} onClick={() => void removeRule(rule.id)}>撤销</Button>
      </li>)}</ul>
    </section>}
  </div>;
}
