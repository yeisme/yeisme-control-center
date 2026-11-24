import { useMemo, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Activity, ArrowRight, Bell, Clock3, Inbox } from "../../icons";
import { useTasks } from "../../app/tasks-context";
import { useNotifications } from "../../app/notifications-context";
import { useScopedRead } from "../../app/workspace";
import { api } from "../../shared/api/control-center-client";
import { defaultRequestQuery } from "../../request-visibility";
import { EmptyState, KindBadge, PageToolbar, Pager, Panel, SkeletonRows, ToggleGroup, cx, ownerLabel } from "../../components/ui";
import { useListPreferences } from "../../app/preferences";
import { usePagedRows } from "../../app/use-paged-rows";
import { pageSizes } from "../../shared/pager";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { formatRelative } from "../../shared/read-model/format";
import { kindOf } from "../../shared/media-kind";
import { ownerModality } from "../../shared/read-model/tasks";
import { readErrorMessage } from "../../shared/read-model/read-state";
import { activityGroupLabels, actorKindLabels, buildActivity, type ActivityActor, type ActivityEvent, type ActivityGroup, type ActivitySource, type ActivityTone } from "../../shared/read-model/activity";

type Show = "all" | ActivitySource;
const showOptions: { id: Show; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "task", label: "运行" },
  { id: "reminder", label: "提醒" },
  { id: "request", label: "请求" },
];
const groupOrder: ActivityGroup[] = ["now", "today", "earlier"];
const sourceDown = ["forbidden", "unavailable", "unknown", "needs_contract", "login_required"];

const toneDot: Record<ActivityTone, string> = {
  running: "bg-info",
  done: "bg-success",
  review: "bg-warm",
  problem: "bg-danger",
  unknown: "bg-warning",
  neutral: "bg-line-strong",
};
const toneText: Record<ActivityTone, string> = {
  running: "text-info",
  done: "text-success",
  review: "text-warm",
  problem: "text-danger",
  unknown: "text-warning",
  neutral: "text-muted",
};

/** Who started it, only as far as the owner said: a typed kind, the owner's own words with no kind, or 未知. */
function actorText(actor: ActivityActor) {
  if (actor.typed) return `${actorKindLabels[actor.kind]}${actor.name ? ` · ${actor.name}` : ""}`;
  return actor.name ? `${actor.name}（未标类型）` : "未知";
}

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });
function when(event: ActivityEvent) {
  const time = Date.parse(event.at);
  if (!time) return "时间未提供";
  return event.group === "earlier" ? day.format(time) : clock.format(time);
}

function EventThumb({ event }: { event: ActivityEvent }) {
  const result = event.task?.results.find((item) => item.ref);
  const kind = kindOf(result?.mime, ownerModality[event.owner as keyof typeof ownerModality]);
  if (event.task && result && (kind === "image" || kind === "video")) return <TaskThumbnail task={event.task} result={result} size="md" alt="" fallback={<KindBadge kind={kind} size="md" />} />;
  if (event.source === "reminder") return <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-panel-sunken text-muted"><Bell className="size-4" /></span>;
  return <KindBadge kind={kind} size="md" />;
}

function EventRow({ event, index, onOpen }: { event: ActivityEvent; index: number; onOpen: () => void }) {
  return <li className="relative stagger-in pl-16" style={{ "--i": index } as CSSProperties} data-activity={event.source} data-tone={event.tone}>
    <span className="absolute left-0 top-3.5 w-11 text-right text-2xs tabular text-muted">{when(event)}</span>
    <span aria-hidden="true" className={cx("absolute left-[52px] top-[18px] size-2 rounded-full ring-4 ring-canvas", toneDot[event.tone])} />
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 rounded-card px-3 py-2.5 text-left transition-colors hover:bg-panel focus-visible:bg-panel">
      <EventThumb event={event} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-semibold text-ink">{event.title}</span>
        <span className="mt-0.5 block truncate text-meta text-muted">
          {ownerLabel(event.owner)} · <span className={toneText[event.tone]}>{event.verb}</span>
        </span>
        <span className="mt-0.5 block truncate text-2xs text-faint" data-actor={event.actor.typed ? event.actor.kind : "unknown"}>发起：{actorText(event.actor)}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  </li>;
}

/** 动态: tasks, reminders and requests on one line. Only rearranges what was read; the professional lists stay one tab away. */
export default function ActivityPage() {
  const tasks = useTasks();
  const reminders = useNotifications();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const show = (showOptions.some((option) => option.id === params.get("show")) ? params.get("show") : "all") as Show;
  // The last day of requests, one page; the same window the requests page opens on.
  const requests = useScopedRead((scope, signal) => api.requests(scope, defaultRequestQuery(), signal), { key: "activity-requests" });

  const activity = useMemo(() => buildActivity({
    tasks: tasks.rows,
    reminders: reminders.rows,
    requests: requests.data?.rows || [],
    now: reminders.now,
  }), [reminders.now, reminders.rows, requests.data, tasks.rows]);
  const visible = (group: ActivityGroup) => activity.groups[group].filter((event) => show === "all" || event.source === show);

  const loading = tasks.status === "loading" && !tasks.rows.length;
  const running = activity.groups.now.filter((event) => event.tone === "running").length;
  const attention = activity.groups.now.length - running;
  const lead = loading ? "正在整理动态…" : running || attention ? [running ? `${running} 件在跑` : "", attention ? `${attention} 条提醒等你看` : ""].filter(Boolean).join("，") + "。" : "现在没有在跑的事，也没有等你看的提醒。";

  // Each source says for itself whether it was read; a source that failed never reads as "nothing happened".
  const sources = [
    { id: "task", label: "运行", down: !tasks.rows.length && sourceDown.includes(tasks.status), error: tasks.error },
    { id: "reminder", label: "提醒", down: reminders.status === "unavailable", error: reminders.error },
    { id: "request", label: "请求", down: !requests.data && sourceDown.includes(requests.status), error: requests.error },
  ];
  const down = sources.filter((source) => source.down);
  // One line across the groups: a page is a slice of it, and each page still says which group its events are in.
  const line = groupOrder.flatMap((group) => visible(group));
  const total = line.length;
  const { pageSize, setPageSize } = useListPreferences();
  const paged = usePagedRows(line, pageSize, []);
  const onPage = new Set(paged.rows.map((event) => event.id));

  return <div className="page-enter space-y-5" data-page="activity">
    <h1 className="sr-only">动态</h1>
    <PageToolbar
      lead={lead}
      summary="运行、提醒和请求按时间排成一条线。谁发起的只照工具的记录写：工具标了是人还是服务才写出来，没标就写「未标类型」或「未知」。"
      meta={tasks.observedAt ? <span className="inline-flex items-center gap-1.5 text-2xs text-muted"><Clock3 className="size-3.5" />读取于 {formatRelative(tasks.observedAt)}</span> : undefined}
      actions={<ToggleGroup<Show> label="看哪些动态" value={show} onChange={(value) => setParams(value === "all" ? new URLSearchParams() : new URLSearchParams({ show: value }), { replace: true })} options={showOptions} />}
    />
    {down.length > 0 && <p className="rounded-card border border-warning/30 bg-warning-soft px-4 py-2.5 text-body-sm text-warning" role="status" data-activity-sources-down>
      这次没读到：{down.map((source) => `${source.label}（${readErrorMessage(source.error).replace(/[。.]$/, "")}）`).join("、")}。没读到的不算「没有动态」。
    </p>}
    <Panel bodyClassName="px-3 py-4 sm:px-5">
      {loading ? <SkeletonRows rows={6} /> : total === 0
        ? <EmptyState icon={down.length ? <Inbox /> : <Activity />} title={down.length ? "读到的来源里没有动态" : "还没有动态"} body={show === "all" ? "开始一次生成，或者等工具里的任务跑起来，这里就会有记录。" : "换一个分类看看。"} />
        : <div className="space-y-6">
          {groupOrder.map((group) => {
            const events = visible(group).filter((event) => onPage.has(event.id));
            if (!events.length) return null;
            return <section key={group} aria-labelledby={`activity-${group}`} data-activity-group={group}>
              <h2 id={`activity-${group}`} className="mb-2 pl-16 font-display text-title font-semibold text-ink">{activityGroupLabels[group]}<span className="ml-2 font-sans text-meta font-normal text-muted tabular">{visible(group).length}</span></h2>
              <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[55px] before:top-2 before:w-px before:bg-line">
                {events.map((event, index) => <EventRow key={event.id} event={event} index={index} onOpen={() => navigate(event.target)} />)}
              </ol>
            </section>;
          })}
        </div>}
      {total > 0 && <Pager className="-mx-3 -mb-4 mt-4 sm:-mx-5" window={paged} onPage={paged.setPage} noun="条动态" pageSize={pageSize} pageSizes={pageSizes} onPageSize={(value) => { setPageSize(value as typeof pageSize); paged.setPage(1); }} />}
    </Panel>
  </div>;
}
