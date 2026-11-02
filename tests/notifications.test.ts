import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, createControlCenter } from "../server/app";
import { AuthError } from "../server/auth";
import { SessionAuth } from "../server/auth";
import { createMemoryDB } from "../server/db/client";
import { providerRuns } from "../server/db/schema";
import {
  DEMOTE_AFTER_MS,
  HISTORY_AFTER_MS,
  MAX_SNOOZE_MS,
  NotificationStore,
  countsAsUnread,
  failureFact,
  failureFingerprint,
  snoozeDeadline,
  type FailureFact,
} from "../server/notifications";
import { signTaskIdentity, taskIdentity, taskIdentityOf } from "../server/task-connections";
import { canReopen, canSnooze, countsAsHomeAttention, failureVersionLabel, reminderGroup, snoozeChoices, taskAllowsSafeCancel, taskDeleteAvailable } from "../src/notifications";
import type { ServerConfig, Session } from "../server/contracts";
import type { TaskSnapshot } from "../src/task-observation";

const scope = "scope-a";
const fact = (over: Partial<FailureFact> = {}): FailureFact => ({
  scope_id: scope,
  task_key: "task-1",
  // The unsigned half of the key: a different signature (another server process) keeps the same identity.
  task_identity: (over.task_key ?? "task-1").split(".")[0],
  state: "failed",
  revision: "rev-1",
  native_state: "failed",
  error_code: "upstream_timeout",
  title: "站台背景",
  owner: "eikona",
  project: "rain",
  ...over,
});

function store() {
  return new NotificationStore(createMemoryDB());
}

const day = 24 * 60 * 60 * 1000;

describe("failure reminders", () => {
  it("shows the failure version without exposing the raw fingerprint", () => {
    expect(failureVersionLabel({ task_revision: "rev-2", last_error_code: "provider_rejected", native_state: "provider_failed" })).toBe("revision rev-2 · 错误码 provider_rejected · owner provider_failed");
    expect(failureVersionLabel({})).toBe("revision 未提供 · 错误码未提供 · owner 状态未提供");
  });

  it("creates one reminder for the same task revision and ignores polling", () => {
    const reminders = store();
    const first = reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact()], now: "2026-10-19T00:00:00.000Z" });
    const second = reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact(), fact()], now: "2026-10-19T00:01:00.000Z" });
    expect(first.inserted).toHaveLength(1);
    expect(second.inserted).toHaveLength(0);
    expect(second.touched).toEqual(first.inserted);
    const rows = reminders.list(scope, "s1", "user-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.last_seen_at).toBe("2026-10-19T00:01:00.000Z");
    expect(rows[0]?.task_state).toBe("failed");
  });

  it("opens a new reminder when revision, error code, or native state changes", () => {
    const reminders = store();
    const base = { scopeId: scope, sessionId: "s1", subject: "user-a", now: "2026-10-19T00:00:00.000Z" };
    reminders.sync({ ...base, observed: [fact()] });
    reminders.sync({ ...base, observed: [fact({ revision: "rev-2" })] });
    reminders.sync({ ...base, observed: [fact({ error_code: "provider_rejected" })] });
    reminders.sync({ ...base, observed: [fact({ native_state: "provider_failed" })] });
    const rows = reminders.list(scope, "s1", "user-a");
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.failure_fingerprint)).size).toBe(4);
  });

  it("keeps owner task facts unchanged when a reminder is acknowledged, muted, or archived", () => {
    const reminders = store();
    const inserted = reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact()] }).inserted[0]!;
    const taskState = reminders.list(scope, "s1", "user-a")[0]?.task_state;
    expect(reminders.acknowledge(inserted, scope, "s1", "user-a").task_state).toBe(taskState);
    reminders.reopen(inserted, scope, "s1", "user-a");
    expect(reminders.mute(inserted, scope, "s1", "user-a").owner_writes).toBe(0);
    expect(reminders.archive(inserted, scope, "s1", "user-a").task_state).toBe("failed");
    expect(reminders.list(scope, "s1", "user-a")[0]?.state).toBe("archived");
  });

  it("mutes only the current fingerprint and still alerts a later failure version", () => {
    const reminders = store();
    const inserted = reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact()] }).inserted[0]!;
    reminders.mute(inserted, scope, "s1", "user-a");
    const next = reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact({ revision: "rev-2" })] });
    expect(next.inserted).toHaveLength(1);
    expect(reminders.list(scope, "s1", "user-a").some((row) => row.state === "unread" && row.task_revision === "rev-2")).toBe(true);
  });

  it("demotes untouched reminders after 24 hours and 7 days without deleting them", () => {
    const reminders = store();
    const start = "2026-10-01T00:00:00.000Z";
    reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact()], now: start });
    const afterDay = reminders.list(scope, "s1", "user-a", Date.parse(start) + DEMOTE_AFTER_MS + 1000);
    expect(afterDay[0]?.priority).toBe("low");
    expect(countsAsHomeAttention(afterDay[0]!)).toBe(false);
    const aged = reminders.cleanup(scope, "s1", "user-a", new Date(Date.parse(start) + HISTORY_AFTER_MS + day).toISOString());
    expect(aged.deleted_tasks).toBe(0);
    expect(aged.owner_writes).toBe(0);
    expect(reminders.list(scope, "s1", "user-a")[0]?.priority).toBe("history");
    expect(reminders.list(scope, "s1", "user-a")).toHaveLength(1);
  });

  it("bulk cleanup updates only the control-center ledger", () => {
    const db = createMemoryDB();
    const reminders = new NotificationStore(db);
    reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact(), fact({ task_key: "task-2", revision: "rev-9" })] });
    const before = db.select().from(providerRuns).all().length;
    const updated = reminders.bulk({ scopeId: scope, sessionId: "s1", subject: "user-a", action: "archive", all: true });
    expect(updated.updated).toHaveLength(2);
    expect(updated.owner_writes).toBe(0);
    expect(db.select().from(providerRuns).all()).toHaveLength(before);
    expect(reminders.list(scope, "s1", "user-a").every((row) => row.state === "archived")).toBe(true);
  });

  it("keeps a disappeared task reminder and does not infer success", () => {
    const reminders = store();
    reminders.sync({
      scopeId: scope,
      sessionId: "s1",
      subject: "user-a",
      observed: [fact()],
      presentTaskKeys: ["task-1"],
      complete: true,
    });
    const next = reminders.sync({
      scopeId: scope,
      sessionId: "s1",
      subject: "user-a",
      observed: [],
      presentTaskKeys: [],
      complete: true,
    });
    expect(next.staled).toHaveLength(1);
    expect(reminders.list(scope, "s1", "user-a")[0]).toMatchObject({ presence: "stale", task_state: "failed" });
  });

  it("keeps a recipient's reminders across sessions while isolating scope and subject", () => {
    const reminders = store();
    reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact()] });
    expect(reminders.list("scope-b", "s1", "user-a")).toHaveLength(0);
    expect(reminders.list(scope, "s2", "user-a")).toHaveLength(1);
    expect(reminders.list(scope, "s1", "user-b")).toHaveLength(0);
    expect(() => reminders.acknowledge(reminders.list(scope, "s1", "user-a")[0]!.id, "scope-b", "s1", "user-a")).toThrowError(AuthError);
  });

  it("refuses owner deletion for terminal failures and allows safe cancel only while running", () => {
    const actions = [{ action: "cancel" as const, enabled: true }];
    expect(taskAllowsSafeCancel({ state: "running", allowed_actions: actions })).toBe(true);
    expect(taskAllowsSafeCancel({ state: "failed", allowed_actions: actions })).toBe(false);
    expect(taskAllowsSafeCancel({ state: "running", allowed_actions: [{ action: "cancel", enabled: false }] })).toBe(false);
    expect(taskDeleteAvailable()).toBe(false);
    expect(failureFingerprint(fact())).toContain("upstream_timeout");
  });
});

describe("failure facts", () => {
  const snapshot = (over: Record<string, unknown> = {}) => ({
    task_key: signTaskIdentity(taskIdentity({ scope, c: "eikona-a", ref: "run-1", family: "run" }), Buffer.from("k")),
    connection_id: "eikona-a", state: "failed", revision: "rev-9", native_state: "provider_failed", title: "站台背景",
    locator: { owner: "eikona", project: "rain", task_family: "run", task_ref: "run-1" }, ...over,
  }) as unknown as TaskSnapshot;

  it("names the task by the identity of its verified snapshot, which is the identity half of its key", () => {
    const task = snapshot();
    const built = failureFact(scope, task);
    expect(built).toEqual({ scope_id: scope, task_key: task.task_key, task_identity: taskIdentityOf(task.task_key!), state: "failed", revision: "rev-9", native_state: "provider_failed", error_code: "", title: "站台背景", owner: "eikona", project: "rain" });
    // The same failure read again, under another signature, is the same fingerprint: one reminder.
    const resigned = snapshot({ task_key: signTaskIdentity(taskIdentity({ scope, c: "eikona-a", ref: "run-1", family: "run" }), Buffer.from("other")) });
    expect(failureFingerprint(failureFact(scope, resigned))).toBe(failureFingerprint(built));
    // Another scope is another identity.
    expect(failureFact("scope-b", task).task_identity).not.toBe(built.task_identity);
  });

  it("carries the owner's error code and falls back to the key's identity without a connection", () => {
    const withCode = failureFact(scope, snapshot({ provider_recovery: { error_code: "InvalidApiKey" } }));
    expect(withCode.error_code).toBe("InvalidApiKey");
    const plain = failureFact(scope, snapshot({ connection_id: undefined, task_key: "identity-half.signature", revision: undefined, native_state: undefined }));
    expect(plain).toMatchObject({ task_identity: "identity-half", revision: "", native_state: "", error_code: "" });
  });
});

describe("server-authored events", () => {
  const event = (over: Record<string, unknown> = {}) => ({ scope: "scope-a", recipient: "user-a", event: "operation:drivebridge:op_1:failed", category: "operation", title: "DriveBridge 导出失败", path: "/services", ...over });

  it("opens the services page with the owner, its error code and its state, once per recipient and scope", () => {
    const reminders = store();
    const first = reminders.openEvent({ ...event(), owner: "drivebridge", errorCode: "resume_required", taskState: "failed", nativeState: "interrupted", sessionId: "background", now: "2026-10-30T00:00:00.000Z" });
    expect(first.created).toBe(true);
    expect(reminders.openEvent(event()).created).toBe(false);
    expect(reminders.event(event())).toBe(first.id);
    const [row] = reminders.list("scope-a", "", "user-a");
    expect(row).toMatchObject({ id: first.id, category: "operation", target_path: "/services", owner: "drivebridge", last_error_code: "resume_required", task_state: "failed", native_state: "interrupted", session_id: "background", first_seen_at: "2026-10-30T00:00:00.000Z", state: "unread" });
    expect(countsAsUnread(row)).toBe(true);
    // It is not a task failure, so it never counts as home attention.
    expect(reminders.actionable(row)).toBe(false);
    // Another recipient, another scope or another event is another row.
    expect(reminders.openEvent(event({ recipient: "user-b" })).created).toBe(true);
    expect(reminders.openEvent(event({ scope: "scope-b" })).created).toBe(true);
    expect(reminders.openEvent(event({ event: "operation:drivebridge:op_1:unknown" })).created).toBe(true);
  });

  it("keeps the earlier shape for collaboration events and refuses any other target", () => {
    const reminders = store();
    reminders.event({ scope: "project_1", recipient: "user-a", event: "preview_1", category: "project_assignment", title: "项目「雨」的共享设置已更新", path: "/projects?sharedProject=project_1" });
    expect(reminders.list("project_1", "", "user-a")[0]).toMatchObject({ category: "project_assignment", owner: "control-center", task_state: "succeeded", last_error_code: "", session_id: "", target_path: "/projects?sharedProject=project_1" });
    for (const path of ["/tasks", "/servicesx", "https://example.test/services", "services", "/services/../tasks"]) expect(() => reminders.event(event({ path }))).toThrowError(/invalid_notification_target/);
    for (const path of ["/services", "/services?tab=open-tools", "/reminders", "/creation?batch=1", "/projects"]) expect(() => reminders.event(event({ path, event: path }))).not.toThrow();
  });
});

describe("snoozing a reminder", () => {
  const start = "2026-11-02T00:00:00.000Z";
  const t0 = Date.parse(start);
  const open = () => {
    const reminders = store();
    const id = reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact()], now: start }).inserted[0]!;
    return { reminders, id };
  };

  it("takes a time in the future, at most 30 days away, with a zone, and nothing else", () => {
    const ok = (value: unknown) => snoozeDeadline(value, t0);
    expect(ok("2026-11-02T01:00:00.000Z")).toBe("2026-11-02T01:00:00.000Z");
    expect(ok("2026-11-02T09:00:00+08:00")).toBe("2026-11-02T01:00:00.000Z");
    expect(ok("2026-11-02T01:00Z")).toBe("2026-11-02T01:00:00.000Z");
    // Right at the limit is allowed, a moment past it is not.
    expect(ok(new Date(t0 + MAX_SNOOZE_MS).toISOString())).toBe(new Date(t0 + MAX_SNOOZE_MS).toISOString());
    for (const value of [new Date(t0 + MAX_SNOOZE_MS + 1).toISOString(), "2026-11-02T00:00:00.000Z", "2026-11-01T23:00:00.000Z", "2026-11-02T01:00:00", "2026-11-02", "tomorrow", "", "2026-13-40T00:00:00Z", 1793000000000, null, undefined, {}, ["2026-11-02T01:00:00Z"]]) {
      expect(() => ok(value), String(value)).toThrowError(/invalid_snooze_until/);
    }
  });

  it("keeps the reminder unread but quiet until the time has passed, and then it counts again", () => {
    const { reminders, id } = open();
    const until = new Date(t0 + 3_600_000).toISOString();
    const snoozed = reminders.snooze(id, scope, "s1", "user-a", until);
    expect(snoozed).toMatchObject({ state: "unread", snoozed_until: until });
    expect(countsAsUnread(snoozed, t0)).toBe(false);
    expect(reminders.unreadCount(scope, "s1", "user-a", t0)).toBe(0);
    expect(reminderGroup(snoozed, t0)).toBe("quiet");
    // The hour passes: the same row counts again and is among the new ones.
    const later = reminders.list(scope, "s1", "user-a", t0 + 3_600_001)[0]!;
    expect(countsAsUnread(later, t0 + 3_600_001)).toBe(true);
    expect(reminderGroup(later, t0 + 3_600_001)).toBe("new");
    expect(reminders.unreadCount(scope, "s1", "user-a", t0 + 3_600_001)).toBe(1);
    // Observing the same failure again does not undo it; a new failure version opens a reminder that is not snoozed.
    reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact()], now: new Date(t0 + 60_000).toISOString() });
    expect(reminders.list(scope, "s1", "user-a", t0)[0]!.snoozed_until).toBe(until);
    reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [fact({ revision: "rev-2" })], now: new Date(t0 + 120_000).toISOString() });
    const next = reminders.list(scope, "s1", "user-a", t0).find((row) => row.task_revision === "rev-2")!;
    expect(next.snoozed_until).toBeNull();
    expect(countsAsUnread(next, t0)).toBe(true);
  });

  it("can be moved to a later time, only while the reminder is unread and has not recovered", () => {
    const { reminders, id } = open();
    reminders.snooze(id, scope, "s1", "user-a", new Date(t0 + 3_600_000).toISOString());
    const longer = new Date(t0 + 86_400_000).toISOString();
    expect(reminders.snooze(id, scope, "s1", "user-a", longer).snoozed_until).toBe(longer);
    for (const handle of [() => reminders.acknowledge(id, scope, "s1", "user-a"), () => reminders.archive(id, scope, "s1", "user-a"), () => reminders.mute(id, scope, "s1", "user-a")]) {
      handle();
      expect(() => reminders.snooze(id, scope, "s1", "user-a", longer)).toThrowError(/notification_not_snoozable/);
      reminders.reopen(id, scope, "s1", "user-a");
    }
    reminders.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: [], recovered: [fact().task_identity], now: start });
    expect(() => reminders.snooze(id, scope, "s1", "user-a", longer)).toThrowError(/notification_not_snoozable/);
  });

  it("is refused for a reminder that belongs to another scope or another person", () => {
    const { reminders, id } = open();
    const until = new Date(t0 + 3_600_000).toISOString();
    expect(() => reminders.snooze(id, "scope-b", "s1", "user-a", until)).toThrowError(/notification_not_found/);
    expect(() => reminders.snooze(id, scope, "s1", "user-b", until)).toThrowError(/notification_not_found/);
  });

  it("is ended by reopening, which also brings an archived, acknowledged or muted reminder back as unread", () => {
    const { reminders, id } = open();
    const until = new Date(t0 + 3_600_000).toISOString();
    reminders.snooze(id, scope, "s1", "user-a", until);
    const early = reminders.reopen(id, scope, "s1", "user-a");
    expect(early).toMatchObject({ state: "unread", snoozed_until: null, reopened: true });
    expect(countsAsUnread(early, t0)).toBe(true);
    for (const handle of [() => reminders.archive(id, scope, "s1", "user-a"), () => reminders.acknowledge(id, scope, "s1", "user-a"), () => reminders.mute(id, scope, "s1", "user-a")]) {
      handle();
      const handled = reminders.list(scope, "s1", "user-a", t0)[0]!;
      expect(countsAsUnread(handled, t0)).toBe(false);
      expect(canReopen(handled, t0)).toBe(true);
      const back = reminders.reopen(id, scope, "s1", "user-a");
      expect(back).toMatchObject({ state: "unread", archived_at: null, acknowledged_at: null, muted_at: null, snoozed_until: null });
      expect(countsAsUnread(back, t0)).toBe(true);
    }
  });

  it("is offered only where it can work", () => {
    const base = { state: "unread", recovered_at: null, snoozed_until: null };
    expect(canSnooze(base)).toBe(true);
    expect(canSnooze({ ...base, state: "archived" })).toBe(false);
    expect(canSnooze({ ...base, recovered_at: "2026-11-01T00:00:00.000Z" })).toBe(false);
    expect(canReopen(base, t0)).toBe(false);
    expect(canReopen({ ...base, snoozed_until: new Date(t0 + 1000).toISOString() }, t0)).toBe(true);
    // A snooze that has ended is not a handled reminder.
    expect(canReopen({ ...base, snoozed_until: new Date(t0 - 1000).toISOString() }, t0)).toBe(false);
    expect(canReopen({ ...base, state: "archived", recovered_at: "2026-11-01T00:00:00.000Z" }, t0)).toBe(false);
  });

  it("offers an hour, tomorrow morning and next Monday morning, all in the future and within the limit", () => {
    // 2026-11-02 is a Monday; whatever the zone of the machine running this, the choices are in local time.
    const monday = new Date(2026, 10, 2, 15, 30);
    const [hour, tomorrow, week] = snoozeChoices(monday);
    expect(hour.until).toBe(new Date(monday.getTime() + 3_600_000).toISOString());
    expect(new Date(tomorrow.until)).toEqual(new Date(2026, 10, 3, 9, 0));
    expect(new Date(week.until)).toEqual(new Date(2026, 10, 9, 9, 0));
    expect([hour.label, tomorrow.label, week.label]).toEqual(["1 小时后", "明天上午", "下周一上午"]);
    // From a Saturday the next Monday is two days away; from a Sunday, one.
    expect(new Date(snoozeChoices(new Date(2026, 10, 7, 20, 0))[2].until)).toEqual(new Date(2026, 10, 9, 9, 0));
    expect(new Date(snoozeChoices(new Date(2026, 10, 8, 20, 0))[2].until)).toEqual(new Date(2026, 10, 9, 9, 0));
    for (const choice of snoozeChoices(monday)) {
      expect(Date.parse(choice.until)).toBeGreaterThan(monday.getTime());
      expect(() => snoozeDeadline(choice.until, monday.getTime())).not.toThrow();
    }
  });
});

describe("events that can end and come back", () => {
  const credential = (over: Record<string, unknown> = {}) => ({ scope: "scope-a", recipient: "user-a", event: "credential:open_tool:gateway:rejected:-", category: "credential", title: "MCP Gateway · 凭据被拒", path: "/services", owner: "gateway", errorCode: "unauthenticated", taskState: "rejected", recurs: true, ...over });

  it("end the reminders of a condition that no longer holds, and only those of that recipient, scope and category", () => {
    const reminders = store();
    const gateway = reminders.openEvent(credential());
    const drive = reminders.openEvent(credential({ event: "credential:open_tool:drivebridge:expiring:7d", taskState: "expiring" }));
    const otherPerson = reminders.openEvent(credential({ recipient: "user-b" }));
    const otherScope = reminders.openEvent(credential({ scope: "scope-b" }));
    const operation = reminders.openEvent({ ...credential({ event: "operation:drivebridge:op_1:failed", category: "operation" }) });
    const ended = reminders.recoverEvents({ scope: "scope-a", recipient: "user-a", category: "credential", keep: ["credential:open_tool:drivebridge:expiring:7d"], now: "2026-11-02T00:00:00.000Z" });
    expect(ended).toEqual([gateway.id]);
    const byId = Object.fromEntries(reminders.list("scope-a", "", "user-a").map((row) => [row.id, row]));
    expect(byId[gateway.id]).toMatchObject({ recovered_at: "2026-11-02T00:00:00.000Z" });
    expect(countsAsUnread(byId[gateway.id])).toBe(false);
    expect(byId[drive.id].recovered_at).toBeNull();
    expect(byId[operation.id].recovered_at).toBeNull();
    expect(reminders.list("scope-a", "", "user-b")[0].recovered_at).toBeNull();
    expect(reminders.list("scope-b", "", "user-a")[0].recovered_at).toBeNull();
    expect(otherPerson.created && otherScope.created).toBe(true);
    // Ending what is already ended changes nothing.
    expect(reminders.recoverEvents({ scope: "scope-a", recipient: "user-a", category: "credential", keep: [], now: "2026-11-03T00:00:00.000Z" })).toEqual([drive.id]);
    expect(reminders.list("scope-a", "", "user-a").find((row) => row.id === gateway.id)!.recovered_at).toBe("2026-11-02T00:00:00.000Z");
  });

  it("open a new reminder when the same event comes back, but only for an event that says it recurs", () => {
    const reminders = store();
    const first = reminders.openEvent(credential({ now: "2026-11-01T00:00:00.000Z" }));
    reminders.archive(first.id, "scope-a", "", "user-a");
    reminders.recoverEvents({ scope: "scope-a", recipient: "user-a", category: "credential", keep: [], now: "2026-11-02T00:00:00.000Z" });
    // Without `recurs` the old row stands, recovered and archived.
    expect(reminders.openEvent(credential({ recurs: false, now: "2026-11-03T00:00:00.000Z" }))).toEqual({ id: first.id, created: false });
    expect(reminders.list("scope-a", "", "user-a")[0]).toMatchObject({ state: "archived", recovered_at: "2026-11-02T00:00:00.000Z" });
    // Still open and recurring: not written again.
    const live = reminders.openEvent(credential({ event: "credential:open_tool:gateway:expired:-", now: "2026-11-03T00:00:00.000Z" }));
    expect(reminders.openEvent(credential({ event: "credential:open_tool:gateway:expired:-", now: "2026-11-04T00:00:00.000Z" }))).toEqual({ id: live.id, created: false });
    // With it, a recovered one opens again with nothing the old one was handled with.
    expect(reminders.openEvent(credential({ title: "MCP Gateway · 凭据被拒（再次）", now: "2026-11-05T00:00:00.000Z" }))).toEqual({ id: first.id, created: true });
    const [again] = reminders.list("scope-a", "", "user-a").filter((row) => row.id === first.id);
    expect(again).toMatchObject({ state: "unread", archived_at: null, recovered_at: null, snoozed_until: null, read_at: null, title: "MCP Gateway · 凭据被拒（再次）", first_seen_at: "2026-11-05T00:00:00.000Z", priority: "normal" });
    expect(countsAsUnread(again)).toBe(true);
  });
});

const config: ServerConfig = {
  origin: "http://127.0.0.1:4299",
  port: 4299,
  owners: {},
  principals: [],
};

function session(over: Partial<Session> = {}): Session {
  return {
    id: "session-a",
    issuer: "https://id.example",
    subject: "owner",
    name: "Owner",
    csrf: "csrf-a",
    accessToken: "",
    accessAudience: [],
    expires: Date.now() + 60_000,
    epoch: 1,
    ...over,
  };
}

function call(app: (request: Request) => Promise<Response>, path: string, method = "GET", body?: unknown, current = session()) {
  return app(new Request(config.origin + "/api/control-center/v1" + path, {
    method,
    headers: { Cookie: "yeisme_session=" + current.id, Origin: config.origin, "X-CSRF-Token": current.csrf, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe("notification http boundary", () => {
  it("rejects unverified browser failure facts and isolates recipient reads", async () => {
    const auth = new SessionAuth(config);
    const first = session();
    const second = session({ id: "session-b", subject: "other", csrf: "csrf-b" });
    auth.sessions.set(first.id, first);
    auth.sessions.set(second.id, second);
    const principalConfig = {
      ...config,
      principals: [{
        issuer: first.issuer,
        subject: first.subject,
        name: first.name,
        scopes: [{ id: "scope-a", tenant: "t", team: "", project: "p", label: "A", owners: {} }],
      }, {
        issuer: second.issuer,
        subject: second.subject,
        name: "Other",
        scopes: [{ id: "scope-a", tenant: "t", team: "", project: "p", label: "A", owners: {} }],
      }],
    };
    const scopedAuth = new SessionAuth(principalConfig);
    scopedAuth.sessions.set(first.id, first);
    scopedAuth.sessions.set(second.id, second);
    const scopedApp = createApp(principalConfig, { auth: scopedAuth, db: createMemoryDB() });
    const snapshot = { task_key: "task-1", state: "failed", revision: "1", native_state: "failed", title: "失败镜头", locator: { owner: "eikona", project: "rain" }, provider_recovery: { error_code: "upstream_timeout" } };
    const synced = await call(scopedApp, "/notifications/sync?scope=scope-a", "POST", { tasks: [snapshot], present_task_keys: ["task-1"], complete: true }, first);
    expect(synced.status).toBe(200);
    const body = await synced.json() as { unread: number; owner_writes: number; verification_complete: boolean };
    expect(body.unread).toBe(0);
    expect(body.owner_writes).toBe(0);
    expect(body.verification_complete).toBe(false);
    const other = await call(scopedApp, "/notifications?scope=scope-a", "GET", undefined, second);
    expect(other.status).toBe(200);
    expect((await other.json() as { rows: unknown[] }).rows).toEqual([]);
    const removed = await call(scopedApp, "/tasks/task-1?scope=scope-a", "DELETE", undefined, first);
    expect(removed.status).toBe(405);
    const foreign = await call(scopedApp, "/tasks/task-1?scope=missing", "DELETE", undefined, first);
    expect(foreign.status).toBe(404);
    expect((await removed.json() as { error: string }).error).toBe("task_delete_not_supported");
  });
});

describe("snooze and reopen over http", () => {
  afterEach(() => vi.useRealTimers());
  const hour = 3_600_000;

  /** Two people on one scope, and a failure reminder of the first. */
  function world() {
    const first = session({ expires: Date.now() + 30 * 24 * hour });
    const second = session({ id: "session-b", subject: "other", csrf: "csrf-b", expires: Date.now() + 30 * 24 * hour });
    const scopes = [{ id: "scope-a", tenant: "t", team: "", project: "p", label: "A", owners: {} }];
    const worldConfig: ServerConfig = { ...config, principals: [first, second].map((who) => ({ issuer: who.issuer, subject: who.subject, name: who.name, scopes })) };
    const auth = new SessionAuth(worldConfig);
    auth.sessions.set(first.id, first);
    auth.sessions.set(second.id, second);
    const { handle, services } = createControlCenter(worldConfig, { db: createMemoryDB(), auth });
    const id = services.notifications.sync({ scopeId: "scope-a", sessionId: first.id, subject: `${first.issuer}|${first.subject}`, observed: [fact()] }).inserted[0]!;
    const snooze = (body: unknown, who = first, path = `/notifications/${id}/snooze?scope=scope-a`) => call(handle, path, "POST", body, who);
    const page = async (who = first) => await (await call(handle, "/notifications?scope=scope-a", "GET", undefined, who)).json() as { unread: number; rows: { id: string; state: string; snoozed_until: string | null }[] };
    return { handle, services, id, first, second, snooze, page };
  }
  const error = async (response: Response) => (await response.json() as { error: string }).error;

  it("puts a reminder aside until a time, without touching the task or an owner, and the count follows", async () => {
    const { snooze, page, id } = world();
    expect((await page()).unread).toBe(1);
    const until = new Date(Date.now() + 2 * hour).toISOString();
    const response = await snooze({ until });
    expect(response.status).toBe(200);
    const body = await response.json() as { notification: { id: string; state: string; snoozed_until: string; task_state: string }; owner_writes: number; task_states_changed: number };
    expect(body).toMatchObject({ notification: { id, state: "unread", snoozed_until: until, task_state: "failed" }, owner_writes: 0, task_states_changed: 0 });
    expect(await page()).toMatchObject({ unread: 0, rows: [{ id, state: "unread", snoozed_until: until }] });
    // Two hours and a minute later the same reminder counts again, with nothing done to it.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * hour + 60_000 });
    expect((await page()).unread).toBe(1);
  });

  it("is checked like every other reminder action: a CSRF token, the right person and scope, and a valid body", async () => {
    const { handle, id, first, second, snooze, page } = world();
    const until = new Date(Date.now() + hour).toISOString();
    // No CSRF token.
    const bare = await handle(new Request(config.origin + `/api/control-center/v1/notifications/${id}/snooze?scope=scope-a`, { method: "POST", headers: { Cookie: "yeisme_session=" + first.id, Origin: config.origin, "Content-Type": "application/json" }, body: JSON.stringify({ until }) }));
    expect(bare.status).toBe(403);
    // Somebody else's reminder, a scope the session does not have, and a reminder that does not exist.
    const foreign = await snooze({ until }, second);
    expect([foreign.status, await error(foreign)]).toEqual([404, "notification_not_found"]);
    expect((await snooze({ until }, first, `/notifications/${id}/snooze?scope=elsewhere`)).status).toBe(404);
    expect((await snooze({ until }, first, "/notifications/notification_nothing/snooze?scope=scope-a")).status).toBe(404);
    expect((await call(handle, `/notifications/${id}/snooze?scope=scope-a`, "GET", undefined, first)).status).toBe(405);
    expect((await page()).unread).toBe(1);
    // A body that is not exactly `{ until }`, and times the server refuses.
    const refused = async (body: unknown) => { const response = await snooze(body); return [response.status, await error(response)]; };
    expect(await refused({})).toEqual([400, "invalid_snooze_until"]);
    expect(await refused({ until: "soon" })).toEqual([400, "invalid_snooze_until"]);
    expect(await refused({ until: new Date(Date.now() - hour).toISOString() })).toEqual([400, "invalid_snooze_until"]);
    expect(await refused({ until: new Date(Date.now() + 31 * 24 * hour).toISOString() })).toEqual([400, "invalid_snooze_until"]);
    expect(await refused({ until: new Date(Date.now() + 2 * hour).toISOString().replace("Z", "") })).toEqual([400, "invalid_snooze_until"]);
    expect(await refused({ until, mute: true })).toEqual([400, "invalid_request"]);
    expect(await refused([until])).toEqual([400, "invalid_request"]);
    expect(await refused("x".repeat(300))).toEqual([400, "invalid_request"]);
    const garbled = await call(handle, `/notifications/${id}/snooze?scope=scope-a`, "POST", undefined, first);
    expect([garbled.status, await error(garbled)]).toEqual([400, "invalid_request"]);
    expect((await page()).unread).toBe(1);
  });

  it("refuses a reminder that is already handled, and reopening brings back an archived or snoozed one", async () => {
    const { handle, id, first, snooze, page } = world();
    const until = new Date(Date.now() + hour).toISOString();
    const act = (action: string) => call(handle, `/notifications/${id}/${action}?scope=scope-a`, "POST", {}, first);
    expect((await act("archive")).status).toBe(200);
    expect((await page()).unread).toBe(0);
    const blocked = await snooze({ until });
    expect([blocked.status, await error(blocked)]).toEqual([409, "notification_not_snoozable"]);
    const reopened = await act("reopen");
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ notification: { state: "unread", archived_at: null, snoozed_until: null }, owner_writes: 0, task_states_changed: 0 });
    expect((await page()).unread).toBe(1);
    // Snooze it, then reopen it early: the snooze ends at once.
    await snooze({ until });
    expect((await page()).unread).toBe(0);
    expect((await act("reopen")).status).toBe(200);
    expect(await page()).toMatchObject({ unread: 1, rows: [{ state: "unread", snoozed_until: null }] });
  });
});

const _taskTypeProbe: Pick<TaskSnapshot, "state" | "allowed_actions"> = { state: "failed", allowed_actions: [] };
void _taskTypeProbe;
