import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryDB, migrateDatabase, openDatabase } from "../server/db/client";
import { taskNotifications } from "../server/db/schema";
import { taskSigningKey } from "../server/db/control-state";
import { rekeyNotifications } from "../server/db/notification-rekey";
import { NotificationStore, countsAsUnread, type FailureFact } from "../server/notifications";
import { TaskConnections, signTaskIdentity, taskIdentity } from "../server/task-connections";
import type { ScopeBinding, ServerConfig } from "../server/contracts";

const scope = "scope-a";
const identity = taskIdentity({ scope, c: "eikona-a", ref: "run-1", family: "run" });
const fact = (over: Partial<FailureFact> = {}): FailureFact => ({
  scope_id: scope, task_key: identity + ".sig-1", task_identity: identity, state: "failed", revision: "rev-1",
  native_state: "failed", error_code: "upstream_timeout", title: "站台背景", owner: "eikona", project: "rain", ...over,
});
const sync = (store: NotificationStore, facts: FailureFact[], extra: Partial<Parameters<NotificationStore["sync"]>[0]> = {}) =>
  store.sync({ scopeId: scope, sessionId: "s1", subject: "user-a", observed: facts, ...extra });

describe("reminders survive server restarts", () => {
  it("a new signature on the same task keeps the reminder and its handled state", () => {
    const db = createMemoryDB();
    const before = new NotificationStore(db);
    const [id] = sync(before, [fact()]).inserted;
    before.acknowledge(id!, scope, "s1", "user-a");
    // Another process: same database, a task key signed differently.
    const after = new NotificationStore(db);
    const result = sync(after, [fact({ task_key: identity + ".sig-2" })]);
    expect(result.inserted).toEqual([]);
    const [row] = after.list(scope, "s1", "user-a");
    expect(row?.state).toBe("acknowledged");
    expect(row?.task_key).toBe(identity + ".sig-2");
    expect(countsAsUnread(row!)).toBe(false);
  });

  it("keeps one signing key per database, so task keys verify across processes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-key-"));
    const first = openDatabase(join(dir, "c.sqlite")); migrateDatabase(first);
    const key = taskSigningKey(first);
    const second = openDatabase(join(dir, "c.sqlite"));
    expect(taskSigningKey(second).equals(key)).toBe(true);
    expect(taskSigningKey(createMemoryDB()).equals(key)).toBe(false);
    const binding: ScopeBinding = { id: scope, tenant: "t", team: "", project: "p", label: "p", owners: {}, connection_ids: ["eikona-a"] };
    const config = { connections: [{ id: "eikona-a", owner: "eikona", instance_id: "i", label: "a", environment: "lan", endpoint: "http://127.0.0.1:1/mcp", credential_ref: "x", project: "p", enabled: true }] } as unknown as ServerConfig;
    const raw = signTaskIdentity(identity, key);
    expect(new TaskConnections(config, fetch, key).locate(raw, binding).ref).toBe("run-1");
    expect(() => new TaskConnections(config, fetch, randomBytes(32)).locate(raw, binding)).toThrow();
  });
});

describe("one-time repair of reminders duplicated by earlier restarts", () => {
  const legacy = (id: string, signature: string, state: string, lastSeen: string, readAt: string | null = null) => ({
    id, scopeId: scope, sessionId: "", subject: "user-a", taskKey: (identity + "." + signature).slice(0, 240), taskRevision: "rev-1",
    // The old fingerprint held the whole signed key.
    failureFingerprint: [scope, identity + "." + signature, "failed", "rev-1", "failed", "upstream_timeout"].join("\u001f"),
    state, firstSeenAt: lastSeen, lastSeenAt: lastSeen, readAt, acknowledgedAt: state === "acknowledged" ? lastSeen : null,
  });
  it("merges every copy of a failure version in place, keeping ids, and runs once", () => {
    const db = createMemoryDB();
    db.insert(taskNotifications).values([
      legacy("n-1", "sig-1", "acknowledged", "2026-10-27T08:00:00.000Z"),
      legacy("n-2", "sig-2", "unread", "2026-10-27T10:27:31.000Z"),
      legacy("n-3", "sig-3", "unread", "2026-10-28T05:31:00.000Z", "2026-10-28T06:00:00.000Z"),
    ]).run();
    const dry = rekeyNotifications(db, { dryRun: true });
    expect(dry).toMatchObject({ rows: 3, groups: 1, merged_groups: 1, unread_before: 1, unread_after: 0 });
    expect(db.select().from(taskNotifications).all().map((row) => row.state)).toEqual(["acknowledged", "unread", "unread"]);
    const key = randomBytes(32);
    rekeyNotifications(db, { key });
    const rows = db.select().from(taskNotifications).all();
    expect(rows.map((row) => row.id)).toEqual(["n-1", "n-2", "n-3"]);
    expect(new Set(rows.map((row) => row.state))).toEqual(new Set(["acknowledged"]));
    expect(new Set(rows.map((row) => row.failureFingerprint)).size).toBe(1);
    expect(rows.every((row) => row.taskIdentity === identity && row.taskKey === signTaskIdentity(identity, key))).toBe(true);
    expect(rows.every((row) => row.firstSeenAt === "2026-10-27T08:00:00.000Z" && row.readAt === "2026-10-28T06:00:00.000Z")).toBe(true);
    const store = new NotificationStore(db);
    expect(store.list(scope, "", "user-a")).toHaveLength(1);
    // The next sight of the same failure, under the new identity format, touches the merged rows.
    expect(sync(store, [fact()]).inserted).toEqual([]);
    expect(rekeyNotifications(db, { key }).skipped).toBe(true);
  });
});

describe("lasting mute rules and recovered tasks", () => {
  it("a task rule keeps later failure versions muted until it is removed", () => {
    const store = new NotificationStore(createMemoryDB());
    const [id] = sync(store, [fact()]).inserted;
    const { rule } = store.mute(id!, scope, "s1", "user-a", undefined, "task");
    expect(rule).toMatchObject({ kind: "task", key: identity, owner: "eikona" });
    sync(store, [fact({ revision: "rev-2" })]);
    expect(store.list(scope, "s1", "user-a").find((row) => row.task_revision === "rev-2")?.state).toBe("muted");
    store.removeMuteRule(rule!.id, [scope], "user-a");
    sync(store, [fact({ revision: "rev-3" })]);
    expect(store.list(scope, "s1", "user-a").find((row) => row.task_revision === "rev-3")?.state).toBe("unread");
    expect(() => store.removeMuteRule(rule!.id, [scope], "user-a")).toThrow();
  });

  it("an error-code rule is limited to the owner that reported the code", () => {
    const store = new NotificationStore(createMemoryDB());
    const [id] = sync(store, [fact()]).inserted;
    store.mute(id!, scope, "s1", "user-a", undefined, "error_code");
    const other = taskIdentity({ scope, c: "sonora-a", ref: "job-9", family: "job" });
    sync(store, [fact({ task_key: other + ".s", task_identity: other, owner: "sonora", revision: "r9" }), fact({ revision: "rev-2" })]);
    const rows = store.list(scope, "s1", "user-a");
    expect(rows.find((row) => row.owner === "sonora")?.state).toBe("unread");
    expect(rows.find((row) => row.task_revision === "rev-2")?.state).toBe("muted");
    expect(store.muteRules([scope], "user-a")).toHaveLength(1);
  });

  it("a recovered task stops counting, and failing again reopens the count", () => {
    const store = new NotificationStore(createMemoryDB());
    sync(store, [fact()]);
    expect(store.recoveryCandidates(scope, "user-a")).toEqual([identity]);
    expect(sync(store, [], { recovered: [identity] }).recovered).toHaveLength(1);
    const [row] = store.list(scope, "s1", "user-a");
    expect(row?.recovered_at).toBeTruthy();
    expect(countsAsUnread(row!)).toBe(false);
    expect(store.recoveryCandidates(scope, "user-a")).toEqual([]);
    sync(store, [fact()]);
    expect(countsAsUnread(store.list(scope, "s1", "user-a")[0]!)).toBe(true);
  });
});
