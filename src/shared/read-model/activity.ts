import type { TaskSnapshot } from "../../task-observation";
import type { RequestProjection } from "../../request-visibility";
import type { TaskNotification } from "../api/control-center-client";
import { taskInProgress } from "./tasks";
import { taskNeedsReview } from "./review";
import { reminderKind, taskIdentityOf } from "../../notifications";

/**
 * 动态: one timeline over tasks, reminders and requests, in a person's words. It only rearranges what was read; it
 * never adds a fact. Who did something is said only when the owner said it: a typed `actor_type` on a request or a
 * task. Free text in `actor` is quoted, never classified. `agent` appears only when that typed field says so.
 */
export type ActivitySource = "task" | "reminder" | "request";
export type ActivityGroup = "now" | "today" | "earlier";
export type ActivityTone = "running" | "done" | "review" | "problem" | "unknown" | "neutral";

export interface ActivityActor {
  /** `unknown` unless the owner typed the kind. `agent` is never inferred from free text. */
  kind: "person" | "agent" | "service" | "unknown";
  /** The owner's own words for who it was, shown as given. */
  name?: string;
  /** True when the kind came from a typed field rather than free text. */
  typed: boolean;
}

export interface ActivityEvent {
  id: string;
  source: ActivitySource;
  at: string;
  group: ActivityGroup;
  title: string;
  owner: string;
  state: string;
  tone: ActivityTone;
  /** What happened, in a person's words. */
  verb: string;
  actor: ActivityActor;
  /** Where the event opens, as an app route. */
  target: string;
  /** The task behind a task or reminder event, for its thumbnail. */
  task?: TaskSnapshot;
}

export interface ActivityInput {
  tasks: TaskSnapshot[];
  reminders: TaskNotification[];
  requests: RequestProjection[];
  now: number;
}

export const activityGroupLabels: Record<ActivityGroup, string> = { now: "现在", today: "今天", earlier: "更早" };
export const actorKindLabels: Record<ActivityActor["kind"], string> = { person: "人", agent: "Agent", service: "服务", unknown: "未知" };

const doneStates = new Set(["succeeded", "completed"]);
const problemStates = new Set(["failed", "partial_failed", "rejected"]);

function taskWords(task: Pick<TaskSnapshot, "state" | "provider_recovery">): { verb: string; tone: ActivityTone } {
  if (taskInProgress(task)) return { verb: "在跑", tone: "running" };
  if (taskNeedsReview(task)) return { verb: "等你挑选", tone: "review" };
  if (task.state === "unknown") return { verb: "结果未知，先回查", tone: "unknown" };
  if (problemStates.has(task.state)) return { verb: "没做成", tone: "problem" };
  if (doneStates.has(task.state)) return { verb: "做完了", tone: "done" };
  if (task.state === "cancelled" || task.state === "canceled") return { verb: "已取消", tone: "neutral" };
  return { verb: "状态未说明", tone: "neutral" };
}

/** A reminder in a person's words; only a task failure is about one task, the other kinds say what they are about. */
function reminderWords(reminder: TaskNotification): { verb: string; tone: ActivityTone } {
  const kind = reminderKind(reminder);
  if (reminder.recovered_at) return { verb: kind === "credential" ? "提醒：凭据已经换好" : "提醒：已经恢复", tone: "done" };
  if (kind === "credential") return { verb: "提醒：凭据要处理", tone: "problem" };
  if (kind === "operation") return { verb: "提醒：工具运行出了问题", tone: "problem" };
  if (kind === "collaboration") return { verb: "提醒：项目协作", tone: "neutral" };
  return reminder.task_state === "unknown" ? { verb: "提醒：结果未知，先回查", tone: "unknown" } : { verb: "提醒：没做成", tone: "problem" };
}

function requestWords(state: string): { verb: string; tone: ActivityTone } {
  if (["queued", "pending", "running", "accepted", "in_progress"].includes(state)) return { verb: "在跑", tone: "running" };
  if (doneStates.has(state)) return { verb: "做完了", tone: "done" };
  if (problemStates.has(state) || state === "error") return { verb: "没做成", tone: "problem" };
  if (state === "unknown") return { verb: "结果未知，先回查", tone: "unknown" };
  return { verb: "状态未说明", tone: "neutral" };
}

/** A request says who sent it with a typed field; `unknown` stays unknown. */
export function actorOfRequest(request: Pick<RequestProjection, "actor" | "actor_type">): ActivityActor {
  const name = request.actor?.trim() || undefined;
  const kind = request.actor_type === "human" ? "person" : request.actor_type === "agent" ? "agent" : request.actor_type === "service" ? "service" : "unknown";
  return { kind, ...(name ? { name } : {}), typed: kind !== "unknown" };
}

/** A task is typed only when the owner set `actor_type`. Free text in `actor` stays untyped. */
export function actorOfTask(task: Pick<TaskSnapshot, "actor" | "actor_type">): ActivityActor {
  const name = task.actor?.trim() || undefined;
  const kind = task.actor_type === "human" ? "person" : task.actor_type === "agent" ? "agent" : task.actor_type === "service" ? "service" : "unknown";
  return { kind, ...(name ? { name } : {}), typed: kind !== "unknown" };
}

const dayOf = (time: number) => new Date(time).toDateString();
const timeOf = (value: string | null | undefined) => Date.parse(value || "") || 0;
const taskAt = (task: TaskSnapshot) => task.updated_at || task.started_at || task.created_at || task.observed_at;
const taskKey = (task: TaskSnapshot) => task.task_key || `${task.locator.owner}:${task.locator.instance_id}:${task.locator.task_ref}`;
const taskIdentity = (task: TaskSnapshot) => taskIdentityOf(taskKey(task));
const reminderIdentity = (reminder: TaskNotification) => reminder.task_identity || taskIdentityOf(reminder.task_key);

/**
 * A task may have several stored failure versions when its owner changes a
 * revision, error code or native state. The activity stream is a current-work
 * view, not a failure-version history, so choose one stable representative.
 */
function reminderRepresentative(rows: TaskNotification[]) {
  const byTask = new Map<string, TaskNotification>();
  const score = (row: TaskNotification) => [
    row.state === "unread" && !row.read_at && !row.recovered_at ? 1 : 0,
    row.presence === "live" && !row.recovered_at ? 1 : 0,
    row.state !== "archived" ? 1 : 0,
    timeOf(row.last_seen_at || row.first_seen_at),
  ];
  const better = (candidate: TaskNotification, current: TaskNotification) => {
    const left = score(candidate);
    const right = score(current);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] > right[index];
    }
    return candidate.id < current.id;
  };
  for (const row of rows) {
    // Non-task reminders have their own stable event identity and must not be
    // merged with a task just because they happen to carry a similar key.
    if (reminderKind(row) !== "failure") continue;
    const identity = reminderIdentity(row);
    if (!identity) continue;
    const current = byTask.get(identity);
    if (!current || better(row, current)) byTask.set(identity, row);
  }
  return byTask;
}

function groupOf(at: string, now: number, live: boolean): ActivityGroup {
  if (live) return "now";
  const time = timeOf(at);
  return time && dayOf(time) === dayOf(now) ? "today" : "earlier";
}

export function buildActivity(input: ActivityInput): { events: ActivityEvent[]; groups: Record<ActivityGroup, ActivityEvent[]> } {
  const events: ActivityEvent[] = [];
  // A reminder stands for its task: the task is not shown twice. Failure
  // versions are folded by stable task identity so a changing owner revision
  // cannot create a repeated line in the activity stream.
  const failureReminders = reminderRepresentative(input.reminders);
  const reminded = new Set([...failureReminders.values()]
    .filter((row) => row.state !== "archived")
    .map(reminderIdentity));
  // A request names the task it started; its typed sender then belongs to that task, and the request is not shown twice.
  const senders = new Map<string, ActivityActor>();
  const covered = new Set<string>();
  for (const request of input.requests) {
    if (!request.task_ref) continue;
    const task = input.tasks.find((item) => item.locator.owner === request.owner && item.locator.task_ref === request.task_ref);
    if (!task) continue;
    covered.add(request.id);
    const actor = actorOfRequest(request);
    if (actor.typed || actor.name) senders.set(taskKey(task), actor);
  }
  const tasksByKey = new Map(input.tasks.map((task) => [taskKey(task), task]));
  const tasksByIdentity = new Map(input.tasks.map((task) => [taskIdentity(task), task]));
  const displayedReminders = [
    ...input.reminders.filter((row) => reminderKind(row) !== "failure"),
    ...failureReminders.values(),
  ];

  for (const task of input.tasks) {
    const key = taskKey(task);
    if (reminded.has(taskIdentity(task))) continue;
    const words = taskWords(task);
    const at = taskAt(task);
    events.push({
      id: `task:${key}`,
      source: "task",
      at,
      group: groupOf(at, input.now, words.tone === "running"),
      title: task.title,
      owner: task.locator.owner,
      state: task.state,
      ...words,
      actor: senders.get(key) || actorOfTask(task),
      target: `/tasks?${new URLSearchParams({ task: key })}`,
      task,
    });
  }
  for (const reminder of displayedReminders) {
    if (reminder.state === "archived") continue;
    const task = reminderKind(reminder) === "failure"
      ? tasksByIdentity.get(reminderIdentity(reminder))
      : tasksByKey.get(reminder.task_key);
    const at = reminder.last_seen_at || reminder.first_seen_at;
    events.push({
      id: `reminder:${reminder.id}`,
      source: "reminder",
      at,
      group: groupOf(at, input.now, reminder.state === "unread" && reminder.presence === "live" && !reminder.recovered_at),
      title: reminder.title,
      owner: reminder.owner,
      state: reminder.task_state,
      ...reminderWords(reminder),
      actor: task ? senders.get(reminder.task_key) || actorOfTask(task) : { kind: "unknown", typed: false },
      target: `/reminders?${new URLSearchParams({ focus: reminder.id })}`,
      ...(task ? { task } : {}),
    });
  }
  for (const request of input.requests) {
    if (covered.has(request.id)) continue;
    const words = requestWords(request.state);
    events.push({
      id: `request:${request.owner}:${request.id}`,
      source: "request",
      at: request.created_at,
      group: groupOf(request.created_at, input.now, words.tone === "running"),
      title: request.title || request.id,
      owner: request.owner,
      state: request.state,
      ...words,
      actor: actorOfRequest(request),
      target: `/requests?${new URLSearchParams({ request: `${request.owner}:${request.id}` })}`,
    });
  }
  events.sort((a, b) => timeOf(b.at) - timeOf(a.at) || a.id.localeCompare(b.id));
  const groups: Record<ActivityGroup, ActivityEvent[]> = { now: [], today: [], earlier: [] };
  for (const event of events) groups[event.group].push(event);
  return { events, groups };
}
