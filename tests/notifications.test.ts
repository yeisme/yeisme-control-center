import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { AuthError } from "../server/auth";
import { SessionAuth } from "../server/auth";
import { createMemoryDB } from "../server/db/client";
import { providerRuns } from "../server/db/schema";
import {
  DEMOTE_AFTER_MS,
  HISTORY_AFTER_MS,
  NotificationStore,
  countsAsUnread,
  failureFact,
  failureFingerprint,
  type FailureFact,
} from "../server/notifications";
import { signTaskIdentity, taskIdentity, taskIdentityOf } from "../server/task-connections";
import { countsAsHomeAttention, failureVersionLabel, taskAllowsSafeCancel, taskDeleteAvailable } from "../src/notifications";
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

const _taskTypeProbe: Pick<TaskSnapshot, "state" | "allowed_actions"> = { state: "failed", allowed_actions: [] };
void _taskTypeProbe;
