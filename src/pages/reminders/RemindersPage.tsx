import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Archive, BellOff, CheckCheck, CircleAlert, RefreshCw } from "../../icons";
import { api, errorCode, type TaskNotification } from "../../shared/api/control-center-client";
import { useNotifications } from "../../app/notifications-context";
import { useTasks } from "../../app/tasks-context";
import { useWorkspace } from "../../app/workspace";
import { Button, EmptyState, InlineNotice, Pill, SegmentedTabs, TaskStatePill, ownerLabel } from "../../components/ui";
import { formatFullTime } from "../../shared/read-model/format";
import { failureVersionLabel, reminderGroup, reminderGroupLabels, reminderStateLabels, type ReminderGroup } from "../../notifications";
import { taskStateLabels } from "../../task-observation";

const groups: ReminderGroup[] = ["new", "open", "quiet", "archived"];

export default function RemindersPage() {
  const reminders = useNotifications();
  const tasks = useTasks();
  const { scopeId, session } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requested = params.get("group");
  const group = (groups.includes(requested as ReminderGroup) ? requested : "new") as ReminderGroup;
  const focus = params.get("focus");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const csrf = session?.csrf || "";

  const rows = useMemo(() => reminders.rows.filter((item) => reminderGroup(item) === group), [reminders.rows, group]);
  const counts = useMemo(() => Object.fromEntries(groups.map((id) => [id, reminders.rows.filter((item) => reminderGroup(item) === id).length])) as Record<ReminderGroup, number>, [reminders.rows]);

  const replace = (next: TaskNotification[]) => reminders.apply(next);

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
    const page = await api.notifications(scopeId);
    replace(page.rows);
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
  const mute = (id: string, muteScope: "fingerprint" | "error_code") => run(async () => {
    await api.muteNotification(scopeId, id, csrf, muteScope);
    await afterBulk();
  });

  return <div className="page-enter space-y-5" data-page="reminders" data-unread={reminders.unread}>
    <h1 className="sr-only">提醒中心</h1>
    <div className="flex justify-end"><div className="flex items-center gap-2">
        <span className="rounded-full bg-warning-soft px-2.5 py-1 text-2xs font-semibold text-warning tabular" data-reminder-unread={reminders.unread}>未确认 {reminders.unread}</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => reminders.refresh()} icon={<RefreshCw className="size-3.5" />}>重新观察</Button>
      </div></div>
    {notice && <InlineNotice tone="warning">操作没有完成（{notice}）。任务状态保持不变。</InlineNotice>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SegmentedTabs label="提醒分组" value={group} onChange={(value) => { setParams({ group: value }, { replace: true }); setSelected([]); }} options={groups.map((id) => ({ id, label: reminderGroupLabels[id], count: counts[id] }))} />
      <div className="flex flex-wrap gap-2" data-reminder-toolbar>
        <Button size="sm" disabled={busy || rows.length === 0} onClick={() => run(async () => { await api.bulkNotifications(scopeId, { action: "acknowledge", all: false, ids: rows.map((row) => row.id) }, csrf); await afterBulk(); })} icon={<CheckCheck className="size-3.5" />}>全部确认</Button>
        <Button size="sm" disabled={busy || rows.length === 0} onClick={() => run(async () => { await api.bulkNotifications(scopeId, { action: "archive", ids: rows.map((row) => row.id) }, csrf); await afterBulk(); })} icon={<Archive className="size-3.5" />}>全部归档</Button>
        <Button size="sm" disabled={busy || selected.length === 0} onClick={() => run(async () => { await api.bulkNotifications(scopeId, { action: "mute", ids: selected }, csrf); await afterBulk(); })} icon={<BellOff className="size-3.5" />}>对选中任务免提醒</Button>
      </div>
    </div>
    {rows.length === 0 ? <EmptyState icon={<CircleAlert />} title={group === "new" ? "没有新的失败提醒" : "这一组是空的"} body="刷新和页面切换不会新增同一失败指纹。新的 revision、错误码或 owner 状态会重新出现在新失败。" /> : <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-panel">
      {rows.map((item) => {
        const checked = selected.includes(item.id);
        return <li key={item.id} data-reminder={item.id} data-focused={focus === item.id ? "true" : undefined} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
          <label className="mt-1 flex items-center gap-2 text-2xs text-muted">
            <input type="checkbox" checked={checked} aria-label={`选择 ${item.title || item.task_key}`} onChange={() => setSelected((current) => checked ? current.filter((id) => id !== item.id) : [...current, item.id])} />
          </label>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="truncate text-left text-[14px] font-semibold hover:underline" onClick={() => navigate(`/tasks?task=${encodeURIComponent(item.task_key)}`)}>{item.title || item.task_key}</button>
              <TaskStatePill state={item.task_state} />
              <Pill tone={item.state === "unread" ? "warning" : "neutral"}>{reminderStateLabels[item.state]}</Pill>
              {item.presence === "stale" && <Pill tone="neutral">观察中缺失</Pill>}
              {item.priority !== "normal" && <Pill tone="neutral">{item.priority === "history" ? "低优先级历史" : "低优先级"}</Pill>}
            </div>
            <p className="mt-1 text-2xs text-muted">{ownerLabel(item.owner)} · {item.project || "项目未提供"} · {taskStateLabels[item.task_state] || item.task_state}{item.last_error_code ? ` · ${item.last_error_code}` : ""}</p>
            <p className="mt-1 truncate text-2xs text-faint" title={failureVersionLabel(item)} data-reminder-version="true">失败版本：{failureVersionLabel(item)}</p>
            <p className="mt-1 text-2xs text-faint">首次失败 {formatFullTime(item.first_seen_at)} · 最近观察 {formatFullTime(item.last_seen_at)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" disabled={busy || item.state === "acknowledged"} onClick={() => acknowledge(item.id)}>确认</Button>
            <Button size="sm" variant="ghost" disabled={busy || item.state === "muted"} onClick={() => mute(item.id, "fingerprint")}>免提醒</Button>
            <Button size="sm" variant="ghost" disabled={busy || !item.last_error_code || item.state === "muted"} onClick={() => mute(item.id, "error_code")}>相同错误码免提醒</Button>
            <Button size="sm" variant="ghost" disabled={busy || item.state === "archived"} onClick={() => archive(item.id)}>归档</Button>
          </div>
        </li>;
      })}
    </ul>}
    <p className="text-2xs text-muted">任务列表仍显示 {tasks.rows.length} 条 owner 状态。提醒操作只写入控制中心数据库。</p>
  </div>;
}
