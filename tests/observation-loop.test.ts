import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { createMemoryDB } from "../server/db/client";
import { createObservationLoop, enabledAtState, lastCycleState, observationLimits, observationSettings, observationStatus } from "../server/observation-loop";
import { baseScopes, personalAccounts, reminderRecipients } from "../server/personal-accounts";
import type { ServerConfig } from "../server/contracts";
import { T0, asSession, channelsOf, fakeDriveBridge, hour, minute, ownerSession, row, rows, setup, stored, tokenFile, user } from "./observation-loop.support";

const owner = "yeisme:personal|owner";
const failing = { "eikona-a": { history: [row("run-1", "failed", { title: "站台背景" })] } };

describe("who receives background reminders", () => {
  it("is every enabled admin bound to the scope, the legacy owner included, and never a viewer", () => {
    const { config } = setup({
      users: [
        user("alice", "admin"),
        user("bob", "viewer"),
        user("carol", "admin", { enabled: false }),
        user("dave", "admin", { scope_ids: ["elsewhere"] }),
      ],
    });
    expect(reminderRecipients(config, "scope-a").sort()).toEqual(["yeisme:personal|alice", owner]);
    expect(personalAccounts(config).map((account) => `${account.username}:${account.role}${account.legacy ? ":legacy" : ""}`)).toEqual(["alice:admin", "bob:viewer", "dave:admin", "owner:admin:legacy"]);
    // A legacy owner who is only a viewer, and a server that is not in personal mode, have no recipients.
    expect(reminderRecipients(setup({ owner: "viewer" }).config, "scope-a")).toEqual([]);
    expect(reminderRecipients({ ...config, auth_mode: "oidc" }, "scope-a")).toEqual([]);
    expect(reminderRecipients(config, "elsewhere")).toEqual(["yeisme:personal|dave"]);
  });

  it("does not count a legacy owner who cannot sign in: with named users and no username in the config there is none", () => {
    const { config } = setup({ users: [user("alice", "admin")] });
    const unnamed = { ...config, personal: { ...config.personal!, username: undefined } } as ServerConfig;
    expect(personalAccounts(unnamed).map((account) => account.username)).toEqual(["alice"]);
    // With no named users at all the legacy owner is the only account, named "owner" when the config gives no name.
    const alone = { ...config, personal: { ...config.personal!, username: undefined, users: [] } } as ServerConfig;
    expect(personalAccounts(alone).map((account) => `${account.username}:${account.legacy}`)).toEqual(["owner:true"]);
  });

  it("follows the way sign-in resolves a name: an enabled user wins over the legacy owner of the same name", () => {
    const { config } = setup({ users: [user("owner", "viewer")] });
    expect(personalAccounts(config).map((account) => `${account.username}:${account.role}:${account.legacy}`)).toEqual(["owner:viewer:false"]);
    expect(reminderRecipients(config, "scope-a")).toEqual([]);
    // Once that user is disabled the legacy owner is the account again.
    const disabled = setup({ users: [user("owner", "viewer", { enabled: false })] }).config;
    expect(reminderRecipients(disabled, "scope-a")).toEqual([owner]);
  });

  it("is the named recipients when observation.recipients is set, but a named viewer or stranger still gets nothing", () => {
    const { config } = setup({
      users: [user("alice", "admin"), user("bob", "viewer")],
      observation: { recipients: ["yeisme:personal|alice", "yeisme:personal|bob", "yeisme:personal|nobody", "someone-else|alice"] },
    });
    expect(reminderRecipients(config, "scope-a")).toEqual(["yeisme:personal|alice"]);
    // An empty list is not a choice: the default recipients apply.
    expect(reminderRecipients({ ...config, observation: { enabled: true, recipients: [] } }, "scope-a").sort()).toEqual(["yeisme:personal|alice", owner]);
  });

  it("observes base scopes only, once each, never a shared project", () => {
    const { config, scope } = setup();
    const principals = [...config.principals, { issuer: "x", subject: "y", name: "Y", scopes: [scope, { ...scope, id: "project_shared" }, { ...scope, id: "scope-b" }] }];
    expect(baseScopes({ ...config, principals } as ServerConfig).map((candidate) => candidate.id)).toEqual(["scope-a", "scope-b"]);
  });

  it("says so in the cycle summary when a named recipient reaches nobody", async () => {
    const { loop, services } = setup({ users: [user("alice", "admin"), user("bob", "viewer")], world: failing, observation: { recipients: ["yeisme:personal|alice", "yeisme:personal|bob", "yeisme:personal|typo"] } });
    const summary = await loop.runCycle();
    expect(summary.errors).toEqual({ recipient_unresolved: 2 });
    expect(summary.reminders_opened).toBe(1);
    expect(rows(services, "yeisme:personal|alice")).toHaveLength(1);
    expect(rows(services, owner)).toEqual([]);
  });

  it("writes one reminder per admin, with the background session, and none for viewers", async () => {
    const { loop, services } = setup({ users: [user("alice", "admin"), user("bob", "viewer")], world: failing });
    const summary = await loop.runCycle();
    expect(summary.reminders_opened).toBe(2);
    expect(summary.errors).toEqual({});
    for (const subject of [owner, "yeisme:personal|alice"]) {
      const [reminder] = rows(services, subject);
      expect(reminder).toMatchObject({ title: "站台背景", state: "unread", task_state: "failed", owner: "eikona", category: "failure", session_id: "background" });
    }
    expect(rows(services, "yeisme:personal|bob")).toEqual([]);
    expect(stored(services)).toHaveLength(2);
    expect(stored(services).every((row) => row.sessionId === "background")).toBe(true);
  });
});

describe("the seam between the request handler and background jobs", () => {
  it("hands a background job the objects the handler uses, and createApp is just the handler", async () => {
    const { handle, services, config, clock } = setup();
    expect(Object.keys(services).sort()).toEqual(["auth", "clock", "config", "db", "notifications", "openTools", "state", "tasks"]);
    expect(services.config).toBe(config);
    expect(services.clock()).toBe(clock.now);
    expect(typeof handle).toBe("function");
    // A reminder written through the services is the one the handler lists: one ledger.
    services.notifications.event({ scope: "scope-a", recipient: owner, event: "e1", category: "operation", title: "来自后台", path: "/services" });
    const asOwner = asSession(services, handle, ownerSession());
    expect((await asOwner("/notifications?scope=scope-a")).body.rows.map((reminder: { title: string }) => reminder.title)).toEqual(["来自后台"]);
    const app = createApp(config, { db: createMemoryDB() });
    expect(typeof app).toBe("function");
    expect((await app(new Request(config.origin + "/api/control-center/v1/health"))).status).toBe(200);
    // The default clock is the real one.
    const real = (await import("../server/app")).createControlCenter(config, { db: createMemoryDB() }).services;
    expect(Math.abs(real.clock() - Date.now())).toBeLessThan(1000);
  });
});

describe("settings", () => {
  const of = (observation: unknown) => observationSettings({ observation } as unknown as ServerConfig);

  it("defaults the interval to 10 minutes and reads open tools every third cycle; a missing block is simply off", () => {
    expect(of({ enabled: true })).toEqual({ enabled: true, valid: true, problems: [], intervalMinutes: 10, openToolsEvery: 3, recipients: [] });
    expect(of({ enabled: true, interval_minutes: 30, open_tools_every: 1, recipients: ["yeisme:personal|owner"] })).toMatchObject({ enabled: true, valid: true, intervalMinutes: 30, openToolsEvery: 1, recipients: ["yeisme:personal|owner"] });
    for (const bounds of [5, 1440]) expect(of({ enabled: true, interval_minutes: bounds })).toMatchObject({ valid: true, intervalMinutes: bounds });
    expect(of({ enabled: true, open_tools_every: 1000 })).toMatchObject({ valid: true, openToolsEvery: 1000 });
    for (const none of [undefined, null, {}, { enabled: false }]) expect(of(none)).toMatchObject({ enabled: false, valid: true, problems: [] });
  });

  it("treats a malformed block as off and names what is wrong by code, never by value", () => {
    const cases: [unknown, string][] = [
      [{ enabled: true, interval_minutes: 2 }, "observation_interval_out_of_range"],
      [{ enabled: true, interval_minutes: 99999 }, "observation_interval_out_of_range"],
      [{ enabled: true, interval_minutes: "soon" }, "observation_interval_out_of_range"],
      [{ enabled: true, interval_minutes: 0 }, "observation_interval_out_of_range"],
      [{ enabled: true, interval_minutes: Number.NaN }, "observation_interval_out_of_range"],
      [{ enabled: true, open_tools_every: 0 }, "observation_open_tools_every_out_of_range"],
      [{ enabled: true, open_tools_every: 4.9 }, "observation_open_tools_every_out_of_range"],
      [{ enabled: true, open_tools_every: 1001 }, "observation_open_tools_every_out_of_range"],
      [{ enabled: "true" }, "observation_enabled_not_boolean"],
      [{ enabled: 1 }, "observation_enabled_not_boolean"],
      [{ enabled: true, recipients: "yeisme:personal|owner" }, "observation_recipients_invalid"],
      [{ enabled: true, recipients: [1] }, "observation_recipients_invalid"],
      [{ enabled: true, recipients: [""] }, "observation_recipients_invalid"],
      [{ enabled: true, recipients: Array.from({ length: 101 }, (_, index) => `i|${index}`) }, "observation_recipients_invalid"],
      [{ enabled: true, recipients: { 0: "x" } }, "observation_recipients_invalid"],
      [[], "observation_not_an_object"],
      [5, "observation_not_an_object"],
      ["on", "observation_not_an_object"],
    ];
    for (const [block, code] of cases) {
      const settings = of(block);
      expect(settings, JSON.stringify(block)).toMatchObject({ enabled: false, valid: false, intervalMinutes: 10, openToolsEvery: 3, recipients: [] });
      expect(settings.problems, JSON.stringify(block)).toContain(code);
    }
    // Several problems are all reported, and a good value next to a bad one is not trusted either.
    expect(of({ enabled: "yes", interval_minutes: 1, recipients: "x" }).problems).toEqual(["observation_enabled_not_boolean", "observation_interval_out_of_range", "observation_recipients_invalid"]);
    expect(of({ enabled: true, interval_minutes: 30, recipients: "x" })).toMatchObject({ enabled: false, intervalMinutes: 10 });
  });

  it("never lets a malformed block fail the recipient lookup or the status route, with or without a loop", async () => {
    const blocks: unknown[] = [{ enabled: true, recipients: "yeisme:personal|owner" }, { enabled: "true" }, { enabled: true, interval_minutes: 0 }, { enabled: true, interval_minutes: 99999 }, [], 5, "on"];
    for (const block of blocks) {
      const { config, services, handle, loop } = setup({ users: [user("bob", "viewer")], world: failing });
      (config as unknown as { observation: unknown }).observation = block;
      // Who receives reminders falls back to the default admins instead of throwing on `.filter`.
      expect(reminderRecipients(config, "scope-a")).toEqual([owner]);
      for (const withLoop of [false, true]) {
        services.observation = withLoop ? loop : undefined;
        const asOwner = asSession(services, handle, ownerSession());
        const answer = await asOwner("/observation/status?scope=scope-a");
        expect(answer.status, JSON.stringify(block)).toBe(200);
        expect(answer.body, JSON.stringify(block)).toMatchObject({ schema_version: "yeisme.observation_status.v1", enabled: false, config_valid: false, interval_minutes: 10, recipient: true, last_cycle: null });
        expect((await asOwner("/observation/status")).status).toBe(200);
        vi.restoreAllMocks();
      }
      // A loop that was started anyway still runs and still hands reminders to the default recipients.
      const summary = await loop.runCycle();
      expect(summary.errors).toEqual({});
      expect(rows(services, owner).map((reminder) => reminder.title)).toEqual(["站台背景"]);
    }
  });
});

describe("the flood guard", () => {
  it("opens reminders only for tasks updated after the day before observation was first enabled", async () => {
    const old = row("run-old", "failed", { title: "三天前", updated_at: new Date(T0 - 72 * hour).toISOString() });
    const edge = row("run-edge", "failed", { title: "二十三小时前", updated_at: new Date(T0 - 23 * hour).toISOString() });
    const fresh = row("run-new", "failed", { title: "一小时前" });
    const undated = row("run-undated", "failed", { title: "没有时间", updated_at: null, created_at: "" });
    const { loop, services } = setup({ world: { "eikona-a": { history: [old, edge, fresh, undated] } } });
    await loop.runCycle();
    expect(rows(services, owner).map((reminder) => reminder.title).sort()).toEqual(["一小时前", "二十三小时前"]);
    // Recorded once, in the database, when observation first ran.
    expect(services.state.read(enabledAtState)).toBe(new Date(T0).toISOString());
  });

  it("is anchored at the first enabling: a loop that keeps running keeps the same floor, and a restart within a day does not move it", async () => {
    const world = { "eikona-a": { history: [row("run-old", "failed", { title: "旧失败", updated_at: new Date(T0 - 48 * hour).toISOString() })] } };
    const { loop, services, clock } = setup({ world });
    for (const hours of [0, 6, 12, 18, 24, 30]) {
      clock.now = T0 + hours * hour;
      await loop.runCycle();
    }
    expect(rows(services, owner)).toEqual([]);
    expect(services.state.read(enabledAtState)).toBe(new Date(T0).toISOString());
    expect(services.state.read(lastCycleState)).toBe(new Date(T0 + 30 * hour).toISOString());
    // A failure the lists only show now still opens a reminder, though it is older than a day before this cycle: the
    // floor stayed a day before the first enabling and did not follow the cycles.
    world["eikona-a"].history.push(row("run-late", "failed", { title: "迟到的失败", updated_at: new Date(T0 + 4 * hour).toISOString() }));
    await loop.runCycle();
    expect(rows(services, owner).map((reminder) => reminder.title)).toEqual(["迟到的失败"]);
    // A new loop on the same database, an hour later, starts from the recorded time, not from now.
    clock.now = T0 + 31 * hour;
    await createObservationLoop(services, { log: () => undefined }).runCycle();
    expect(rows(services, owner).map((reminder) => reminder.title)).toEqual(["迟到的失败"]);
    expect(services.state.read(enabledAtState)).toBe(new Date(T0).toISOString());
  });

  it("starts over after a long gap: enabling again months later does not open a reminder for every failure since the first enabling", async () => {
    const day = 24 * hour;
    const world = { "eikona-a": { history: [] as ReturnType<typeof row>[] } };
    const { loop, services, clock } = setup({ world });
    await loop.runCycle();
    expect(services.state.read(enabledAtState)).toBe(new Date(T0).toISOString());
    // The loop is switched off for forty days. Meanwhile things failed.
    clock.now = T0 + 40 * day;
    world["eikona-a"].history.push(
      row("run-gap", "failed", { title: "停用期间的失败", updated_at: new Date(T0 + 20 * day).toISOString() }),
      row("run-edge", "failed", { title: "前一天内的失败", updated_at: new Date(clock.now - 23 * hour).toISOString() }),
      row("run-now", "failed", { title: "刚刚的失败", updated_at: new Date(clock.now - 5 * minute).toISOString() }),
    );
    await loop.runCycle();
    expect(rows(services, owner).map((reminder) => reminder.title).sort()).toEqual(["刚刚的失败", "前一天内的失败"]);
    // The anchor moved to this cycle, as for a first enabling, and the next cycle keeps it.
    expect(services.state.read(enabledAtState)).toBe(new Date(T0 + 40 * day).toISOString());
    expect(services.state.read(lastCycleState)).toBe(new Date(T0 + 40 * day).toISOString());
    clock.now += 10 * minute;
    await loop.runCycle();
    expect(rows(services, owner)).toHaveLength(2);
  });

  it("counts a gap against two intervals when that is longer than a day, so a slow schedule never restarts itself", async () => {
    const world = { "eikona-a": { history: [row("run-mid", "failed", { title: "中间的失败", updated_at: new Date(T0 - 30 * hour).toISOString() })] } };
    const { loop, services, clock } = setup({ world, observation: { interval_minutes: 1440 } });
    await loop.runCycle();
    // The first anchor is T0 - 24 h, so a failure last updated 30 hours before T0 never opens.
    expect(rows(services, owner)).toEqual([]);
    clock.now = T0 + 47 * hour;
    await loop.runCycle();
    expect(services.state.read(enabledAtState)).toBe(new Date(T0).toISOString());
    // Three days of silence is a gap even for a daily schedule.
    clock.now = T0 + 47 * hour + 49 * hour;
    await loop.runCycle();
    expect(services.state.read(enabledAtState)).toBe(new Date(clock.now).toISOString());
  });

  it("only guards new reminders: a failure that happens after the first cycle opens one however old the task is", async () => {
    const world = { "eikona-a": { history: [] as ReturnType<typeof row>[] } };
    const { loop, services, clock } = setup({ world });
    await loop.runCycle();
    clock.now = T0 + 30 * minute;
    world["eikona-a"].history.push(row("run-late", "failed", { title: "稍后失败", updated_at: new Date(clock.now - minute).toISOString() }));
    await loop.runCycle();
    expect(rows(services, owner).map((reminder) => reminder.title)).toEqual(["稍后失败"]);
  });
});

describe("observation status", () => {
  it("reports settings, the last cycle and the next run without calling an owner", async () => {
    const { loop, services, handle, owners } = setup({ users: [user("bob", "viewer")], world: failing, observation: { interval_minutes: 15 } });
    services.observation = loop;
    const asOwner = asSession(services, handle, ownerSession());
    const before = await asOwner("/observation/status?scope=scope-a");
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ schema_version: "yeisme.observation_status.v1", enabled: true, config_valid: true, running: false, interval_minutes: 15, open_tools_every: 3, scope: "scope-a", observed: true, recipient: true, last_cycle: null, next_run_at: null, epoch: 1 });
    loop.start();
    await loop.runCycle();
    const reads = owners.log.length;
    const after = await asOwner("/observation/status");
    expect(after.body.running).toBe(true);
    expect(after.body.next_run_at).toBe(new Date(T0 + 60_000).toISOString());
    expect(after.body.last_cycle).toMatchObject({ started_at: new Date(T0).toISOString(), calls: 3, pages_read: 2, pages_skipped: 0, reminders_opened: 1, reminders_recovered: 0, errors: {}, connections_read: 1, connections_skipped: 0, scan_incomplete: 0, open_tools_read: false });
    expect(after.body).toMatchObject({ scope: null, observed: true });
    expect(owners.log.length).toBe(reads);
    // Counts and codes only: no address, path, key or reminder text.
    const text = JSON.stringify(after.body);
    for (const leaked of ["127.0.0.1", "eikona-a", "token", "站台背景", "/tmp"]) expect(text).not.toContain(leaked);
    await loop.stop();
  });

  it("shows a session only its own scopes: another scope's counts, errors and connections never reach it", async () => {
    const world = {
      "eikona-a": { history: [row("a-1", "failed", { title: "甲失败" })] },
      "eikona-b": { history: [row("b-1", "failed", { title: "乙失败一" }), row("b-2", "failed", { title: "乙失败二" })] },
      "eikona-c": { status: 503 },
    };
    const { loop, services, handle } = setup({
      users: [user("bob", "viewer"), user("carol", "viewer", { scope_ids: ["scope-b"] })],
      extraScopes: [{ id: "scope-b", connections: ["eikona-b"] }, { id: "scope-c", connections: ["eikona-c"] }],
      world,
    });
    services.observation = loop;
    await loop.runCycle();
    // The loop itself kept every scope's numbers apart, and the totals are their sum.
    expect(Object.fromEntries(Object.entries(loop.lastCycle!.scopes).map(([id, scope]) => [id, [scope.reminders_opened, scope.connections_read, Object.keys(scope.errors).length]]))).toEqual({ "scope-a": [1, 1, 0], "scope-b": [2, 1, 0], "scope-c": [0, 1, 1] });
    expect(loop.lastCycle).toMatchObject({ reminders_opened: 3, connections_read: 3, errors: { source_unavailable: 1 }, shared_errors: {} });

    const owned = asSession(services, handle, ownerSession());
    const lastOf = async (path: string) => (await owned(path)).body.last_cycle as Record<string, any>;
    expect(await lastOf("/observation/status?scope=scope-a")).toMatchObject({ reminders_opened: 1, connections_read: 1, pages_read: 2, errors: {} });
    expect(await lastOf("/observation/status?scope=scope-b")).toMatchObject({ reminders_opened: 2, connections_read: 1, errors: {} });
    expect(await lastOf("/observation/status?scope=scope-c")).toMatchObject({ reminders_opened: 0, errors: { source_unavailable: 1 } });
    // Without a scope, the answer covers all of this session's scopes.
    expect(await lastOf("/observation/status")).toMatchObject({ reminders_opened: 3, connections_read: 3, pages_read: 6, errors: { source_unavailable: 1 } });
    expect((await owned("/observation/status?scope=scope-b")).body).toMatchObject({ scope: "scope-b", observed: true });
    const asOwnerScopeA = JSON.stringify(await lastOf("/observation/status?scope=scope-a"));
    vi.restoreAllMocks();

    // A viewer of scope-a gets exactly what the owner gets for scope-a: nothing of scope-b or scope-c.
    const bob = asSession(services, handle, ownerSession({ id: "session-bob", subject: "bob", csrf: "csrf-bob" }));
    const bobs = await bob("/observation/status");
    expect(JSON.stringify(bobs.body.last_cycle)).toBe(asOwnerScopeA);
    expect(bobs.body).toMatchObject({ scope: null, recipient: false, observed: true });
    expect(JSON.stringify(bobs.body)).not.toMatch(/scope-b|scope-c|eikona-b|eikona-c|source_unavailable|乙失败/);
    expect((await bob("/observation/status?scope=scope-b")).status).toBe(404);
    expect((await bob("/observation/status?scope=scope-c")).status).toBe(404);
    vi.restoreAllMocks();

    const carol = asSession(services, handle, ownerSession({ id: "session-carol", subject: "carol", csrf: "csrf-carol" }));
    const carols = await carol("/observation/status");
    expect(carols.body.last_cycle).toMatchObject({ reminders_opened: 2, connections_read: 1, errors: {} });
    expect(JSON.stringify(carols.body)).not.toMatch(/scope-a|scope-c|eikona-a|eikona-c|source_unavailable|甲失败/);
    vi.restoreAllMocks();
  });

  it("counts a scope once however many times the session lists it", async () => {
    const world = { "eikona-a": { history: [row("a-1", "failed", { title: "甲失败" })] } };
    const { loop, services, handle } = setup({ users: [user("bob", "viewer", { scope_ids: ["scope-a", "scope-a"] })], world });
    services.observation = loop;
    await loop.runCycle();
    const once = observationStatus(services, owner, ["scope-a"]);
    const twice = observationStatus(services, owner, ["scope-a", "scope-a", "scope-a"]);
    expect(once.last_cycle).toMatchObject({ reminders_opened: 1, calls: 3, pages_read: 2, connections_read: 1 });
    expect(twice).toEqual(once);
    // The same through the route, for a user whose binding names the scope twice.
    const bob = asSession(services, handle, ownerSession({ id: "session-bob", subject: "bob", csrf: "csrf-bob" }));
    const answer = await bob("/observation/status");
    expect(answer.status).toBe(200);
    expect(answer.body.last_cycle).toMatchObject({ reminders_opened: 1, calls: 3, pages_read: 2, connections_read: 1 });
    vi.restoreAllMocks();
  });

  it("answers for a scope nobody observes with zero counts, and for a loop that has not run with no cycle", async () => {
    const { loop, services } = setup({ users: [user("bob", "viewer")], world: failing, extraScopes: [{ id: "scope-b", connections: ["eikona-b"] }] });
    services.observation = loop;
    // No admin is bound to scope-b.
    (services.config.personal as { scope_ids: string[] }).scope_ids = ["scope-a"];
    (services.config.personal as { users: unknown[] }).users = [user("bob", "viewer", { scope_ids: ["scope-a", "scope-b"] })];
    expect(observationStatus(services, owner, ["scope-b"])).toMatchObject({ observed: false, recipient: false, last_cycle: null });
    await loop.runCycle();
    expect(observationStatus(services, owner, ["scope-b"]).last_cycle).toMatchObject({ reminders_opened: 0, calls: 0, pages_read: 0, connections_read: 0, scan_incomplete: 0, errors: {}, open_tools_read: false });
    expect(observationStatus(services, owner, ["scope-a"]).last_cycle).toMatchObject({ reminders_opened: 1 });
  });

  it("is open to any role of a personal session, says whether that user is a recipient, and refuses everything else", async () => {
    const { services, handle } = setup({ users: [user("bob", "viewer")] });
    const bob = asSession(services, handle, ownerSession({ id: "session-bob", subject: "bob", csrf: "csrf-bob" }));
    expect((await bob("/observation/status")).body).toMatchObject({ enabled: true, recipient: false });
    expect((await bob("/observation/status?scope=nowhere")).status).toBe(404);
    expect((await bob("/observation/status", "POST", {})).status).toBe(405);
    const guest = asSession(services, handle, ownerSession({ id: "session-guest", personal: false }));
    expect((await guest("/observation/status")).status).toBe(403);
    // Disabled configuration still answers, as off.
    const off = setup({ observation: { enabled: false } });
    expect((await asSession(off.services, off.handle, ownerSession())("/observation/status")).body).toMatchObject({ enabled: false, running: false });
    expect(observationStatus({ config: off.config, observation: undefined }, owner, ["scope-a"]).recipient).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("budget numbers", () => {
  it("states the limits the spec promises", () => {
    expect(observationLimits).toMatchObject({ callsPerCycle: 40, callsPerConnection: 3, maxCallsPerConnection: 8, minIntervalMinutes: 5, defaultIntervalMinutes: 10, defaultOpenToolsEvery: 3, firstCycleMs: 60_000, maxBackoffMs: 60 * minute, operationRemindersPerTool: 10, floodWindowMs: 24 * hour });
    expect(fakeDriveBridge(0).requests).toEqual([]);
  });
});

describe("one ledger for the background and the browser", () => {
  it("converges: a browser sync of the same failure finds the background reminder and adds no second row", async () => {
    const { loop, services, handle } = setup({ world: failing });
    await loop.runCycle();
    const [opened] = rows(services, owner);
    expect(opened).toMatchObject({ session_id: "background", state: "unread" });
    // The browser lists the task, proposes its key, and the server re-reads it before writing anything.
    const { rows: listed } = await services.tasks.list(services.config.principals[0].scopes[0], "history");
    const asOwner = asSession(services, handle, ownerSession());
    const synced = await asOwner("/notifications/sync?scope=scope-a", "POST", { tasks: [{ task_key: listed[0].task_key }], present_task_keys: [listed[0].task_key] });
    expect(synced.status).toBe(200);
    expect(synced.body.inserted).toEqual([]);
    expect(synced.body.touched).toEqual([opened.id]);
    expect(synced.body.rows).toHaveLength(1);
    expect(stored(services)).toHaveLength(1);
    // Handling it once handles it for both: the browser acknowledges, the next background cycle leaves it alone.
    await asOwner(`/notifications/${opened.id}/acknowledge?scope=scope-a`, "POST", { scope: "scope-a" });
    await loop.runCycle();
    expect(stored(services)).toHaveLength(1);
    expect(rows(services, owner)[0].state).toBe("acknowledged");
  });

  it("syncs with complete:false: a task missing from the pages read keeps its reminder live instead of going stale", async () => {
    const world = { "eikona-a": { history: [row("run-1", "failed", { title: "会不见" })] as ReturnType<typeof row>[] } };
    const { loop, services } = setup({ world });
    await loop.runCycle();
    expect(rows(services, owner)[0]).toMatchObject({ title: "会不见", presence: "live" });
    // The next pages do not show that task at all, as when it sits on a page this cycle did not read.
    world["eikona-a"].history = [row("run-other", "succeeded")];
    const sync = vi.spyOn(services.notifications, "sync");
    await loop.runCycle();
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ complete: false, sessionId: "background", subject: owner }));
    expect(rows(services, owner)[0]).toMatchObject({ title: "会不见", presence: "live", recovered_at: null });
    // The same absence in a projection that is complete, as the browser reports it, would have staled it.
    services.notifications.sync({ scopeId: "scope-a", sessionId: "browser", subject: owner, observed: [], presentTaskKeys: [], complete: true });
    expect(rows(services, owner)[0]).toMatchObject({ presence: "stale" });
  });

  it("uses the id and fingerprint the browser path would, so a failure first seen in the browser is found by the loop", async () => {
    const { loop, services, handle } = setup({ world: failing });
    const { rows: listed } = await services.tasks.list(services.config.principals[0].scopes[0], "history");
    const asOwner = asSession(services, handle, ownerSession({ id: "session-first" }));
    const first = await asOwner("/notifications/sync?scope=scope-a", "POST", { tasks: [{ task_key: listed[0].task_key }], present_task_keys: [listed[0].task_key] });
    expect(first.body.inserted).toHaveLength(1);
    const summary = await loop.runCycle();
    expect(summary.reminders_opened).toBe(0);
    expect(stored(services)).toHaveLength(1);
    expect(stored(services)[0].id).toBe(first.body.inserted[0]);
  });

  it("marks a failure recovered from the list rows alone, with no task detail read", async () => {
    const world = { "eikona-a": { history: [row("run-1", "failed", { title: "会恢复" })] as ReturnType<typeof row>[], active: [] as ReturnType<typeof row>[] } };
    const { loop, services, owners, clock } = setup({ world });
    await loop.runCycle();
    expect(rows(services, owner)[0].recovered_at).toBeNull();
    // The owner now reports the task as running again.
    world["eikona-a"].history = [];
    world["eikona-a"].active = [row("run-1", "running", { revision: "rev-2" })];
    clock.now = T0 + 10 * minute;
    const summary = await loop.runCycle();
    expect(summary.reminders_recovered).toBe(1);
    expect(rows(services, owner)[0].recovered_at).toBe(new Date(clock.now).toISOString());
    expect(owners.log.some((entry) => entry.action === "control_center.tasks.get")).toBe(false);
    // A task missing from the first page is not taken as recovered.
    world["eikona-a"].active = [];
    world["eikona-a"].history = [row("run-2", "failed", { title: "另一个" })];
    clock.now = T0 + 20 * minute;
    await loop.runCycle();
    expect(rows(services, owner).find((reminder) => reminder.title === "会恢复")?.recovered_at).toBeTruthy();
    expect(rows(services, owner).find((reminder) => reminder.title === "另一个")?.recovered_at).toBeNull();
  });

  it("does not call a task still failing recovered because it also shows up healthy elsewhere in the lists", async () => {
    const world = { "eikona-a": { history: [row("run-1", "failed")], active: [row("run-1", "running")] } };
    const { loop, services } = setup({ world });
    await loop.runCycle();
    await loop.runCycle();
    expect(rows(services, owner)[0].recovered_at).toBeNull();
  });
});

describe("the call budget", () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => `eikona-${String(index + 1).padStart(2, "0")}`);
  const quiet = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, {}]));

  it("reads each connection's active and history lists once and nothing else, and never calls Providers or Auctra", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { loop, owners } = setup({ connections: ["eikona-a", "eikona-b"], world: quiet(["eikona-a", "eikona-b"]) });
    const summary = await loop.runCycle();
    // Per connection: the MCP handshake and the two first pages. The handshake is a request like any other.
    expect(summary).toMatchObject({ calls: 6, pages_read: 4, connections_read: 2, connections_skipped: 0, scan_incomplete: 0, open_tools_read: false });
    for (const id of ["eikona-a", "eikona-b"]) {
      expect(owners.reads(id).map((entry) => entry.action)).toEqual(["control_center.tasks.list", "control_center.tasks.list"]);
      expect(owners.requests(id).map((entry) => entry.method)).toEqual(["initialize", "tools/call", "tools/call"]);
    }
    expect(owners.requests()).toHaveLength(summary.calls);
    // The session stays open: the next cycle costs the two pages only.
    expect(await loop.runCycle()).toMatchObject({ calls: 4, pages_read: 4 });
    expect(owners.log.filter((entry) => entry.action && entry.action !== "control_center.tasks.list")).toEqual([]);
    // Only the injected owner transports were used: a Provider or an Auctra reader would have gone through fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reserves three requests for each connection it reads and a fourth for its MCP handshake, and rotates through the rest", async () => {
    const ids = many(25);
    const { loop, owners } = setup({ connections: ids, world: quiet(ids) });
    const made = () => owners.requests().length;
    const cycle = async () => {
      const before = made();
      const summary = await loop.runCycle();
      expect(made() - before, "the budget counts the requests the owners really got").toBe(summary.calls);
      return summary;
    };
    // Nothing to roll on: the handshake and two first pages each, four requests reserved, so ten fit in forty.
    const first = await cycle();
    expect(first).toMatchObject({ calls: 30, pages_read: 20, connections_read: 10, connections_skipped: 15 });
    expect(ids.filter((id) => owners.reads(id).length > 0)).toEqual(ids.slice(0, 10));
    // The second cycle starts where the first stopped. Those ten need a handshake too.
    expect(await cycle()).toMatchObject({ calls: 30, connections_read: 10 });
    expect(ids.map((id) => owners.reads(id).length / 2)).toEqual([...Array(20).fill(1), ...Array(5).fill(0)]);
    // The third reads the last five (handshakes) and then six that already have a session (three reserved each).
    const third = await cycle();
    expect(third).toMatchObject({ calls: 27, connections_read: 11 });
    expect(ids.map((id) => owners.reads(id).length / 2)).toEqual([...Array(6).fill(2), ...Array(14).fill(1), ...Array(5).fill(1)]);
  });

  it("never makes more than 40 requests, however long the lists are, and never more than 8 for one connection, handshake included", async () => {
    const ids = many(25);
    const long = Array.from({ length: 80 }, (_, index) => row(`run-${index}`, "succeeded"));
    const world = Object.fromEntries(ids.map((id) => [id, { history: long, active: long, pageSize: 1 }]));
    const { loop, owners } = setup({ connections: ids, world });
    for (let cycle = 0; cycle < 6; cycle++) {
      const before = owners.requests().length;
      const perConnection = new Map<string, number>();
      const summary = await loop.runCycle();
      for (const entry of owners.requests().slice(before)) perConnection.set(entry.connection, (perConnection.get(entry.connection) ?? 0) + 1);
      expect(owners.requests().length - before).toBe(summary.calls);
      expect(summary.calls).toBeLessThanOrEqual(40);
      // Every request is accounted for, and the reserve is used up.
      expect(summary.calls).toBeGreaterThanOrEqual(38);
      for (const [id, n] of perConnection) expect(n, id).toBeLessThanOrEqual(8);
      if (cycle === 0) {
        // Ten connections with a handshake each: 10 x (1 + 2) first requests and one rolling page each.
        expect(summary).toMatchObject({ calls: 40, pages_read: 30, connections_read: 10 });
        expect([...perConnection.values()]).toEqual(Array(10).fill(4));
      }
    }
    // Over the cycles every connection was read.
    expect(ids.every((id) => owners.reads(id).length >= 3)).toBe(true);
    const lone = setup({ connections: ["eikona-a"], world: { "eikona-a": { history: long, active: long, pageSize: 1 } } });
    const summary = await lone.loop.runCycle();
    // Eight requests: the handshake, both first pages and five rolling pages.
    expect(summary).toMatchObject({ calls: 8, pages_read: 7, connections_read: 1 });
    expect(lone.owners.requests()).toHaveLength(8);
    expect(lone.owners.cursors("eikona-a", "history")).toEqual([undefined, "1", "2", "3", "4", "5"]);
  });

  it("counts the requests of an open-tool reading, three for DriveBridge, against the forty: nine connections plus the tool", async () => {
    const ids = many(25);
    const drive = fakeDriveBridge(0);
    const long = Array.from({ length: 80 }, (_, index) => row(`run-${index}`, "succeeded"));
    const { loop, services, owners } = setup({ connections: ids, world: Object.fromEntries(ids.map((id) => [id, { history: long, pageSize: 1 }])), driveBridge: drive });
    const observe = vi.spyOn(services.openTools, "observe");
    const summary = await loop.runCycle();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(drive.requests).toHaveLength(3);
    // The tool keeps three of the forty, so (40 - 3) / 4 = nine connections fit, and every spare request goes to a rolling page.
    expect(owners.requests()).toHaveLength(37);
    expect(summary).toMatchObject({ calls: 40, connections_read: 9, open_tools_read: true });
    expect(owners.requests().length + drive.requests.length).toBe(summary.calls);
    // Without long lists the same cycle costs the handshake and two pages per connection and the tool's three requests.
    const quietOnes = setup({ connections: ids, world: quiet(ids), driveBridge: fakeDriveBridge(0) });
    expect(await quietOnes.loop.runCycle()).toMatchObject({ calls: 9 * 3 + 3, connections_read: 9, open_tools_read: true });
  });

  it("charges nothing for an open tool served from the cache, and the Gateway's six requests when it is read cold", async () => {
    const { OpenToolService, observeRequests } = await import("../server/open-tools/service");
    for (const kind of ["drivebridge", "gateway"] as const) {
      const requests: string[] = [];
      const service = new OpenToolService({ open_tools: { [kind]: { endpoint: "https://tool.example/base", credential_ref: tokenFile } } } as unknown as ServerConfig, (async (input: unknown) => {
        requests.push(String(input));
        return new Response(null, { status: 404 });
      }) as unknown as typeof fetch);
      expect(service.observeCost(kind)).toBe(observeRequests[kind]);
      // A cold reading makes exactly the requests announced for the tool (the cost the loop keeps back for it)...
      const cold = await service.observe(kind);
      expect(cold?.requests).toBe(observeRequests[kind]);
      expect(requests).toHaveLength(observeRequests[kind]);
      // ...and a reading served from the cache makes none, which is what the loop then charges.
      const warm = await service.observe(kind);
      expect(warm?.requests).toBe(0);
      expect(requests).toHaveLength(observeRequests[kind]);
    }
    expect(observeRequests).toEqual({ drivebridge: 3, gateway: 6 });
  });
});

describe("the rolling read of long lists", () => {
  const ok = (count: number, prefix = "ok") => Array.from({ length: count }, (_, index) => row(`${prefix}-${String(index).padStart(2, "0")}`, "succeeded"));
  const titles = (services: Parameters<typeof rows>[0]) => rows(services, owner).map((reminder) => reminder.title).sort();

  it("reads page 1 of both lists every cycle and walks on from where the last cycle stopped, starting over after the end", async () => {
    // 15 pages of two rows in history; the active list is one page. A cycle has eight requests for the connection.
    const { loop, owners } = setup({ world: { "eikona-a": { history: ok(30), active: ok(1, "act"), pageSize: 2 } } });
    const walk = async () => {
      const before = { history: owners.cursors("eikona-a", "history").length, active: owners.cursors("eikona-a", "active").length };
      const summary = await loop.runCycle();
      return { summary, history: owners.cursors("eikona-a", "history").slice(before.history), active: owners.cursors("eikona-a", "active").slice(before.active) };
    };
    // The first cycle spends one of its eight requests on the MCP handshake, so it reaches one page less.
    const one = await walk();
    expect(one.active).toEqual([undefined]);
    expect(one.history).toEqual([undefined, "2", "4", "6", "8", "10"]);
    expect(one.summary).toMatchObject({ calls: 8, pages_read: 7, scan_incomplete: 1 });
    const two = await walk();
    expect(two.history).toEqual([undefined, "12", "14", "16", "18", "20", "22"]);
    expect(two.summary).toMatchObject({ calls: 8, pages_read: 8, scan_incomplete: 1 });
    // The last pages end history, and active's first page, already in hand, is its whole list: a pass is complete.
    const three = await walk();
    expect(three.history).toEqual([undefined, "24", "26", "28"]);
    expect(three.active).toEqual([undefined]);
    expect(three.summary).toMatchObject({ calls: 5, pages_read: 5, scan_incomplete: 0 });
    // Then it starts over at page 2 of history.
    const four = await walk();
    expect(four.history).toEqual([undefined, "2", "4", "6", "8", "10", "12"]);
    expect(four.summary).toMatchObject({ pages_read: 8, scan_incomplete: 0 });
  });

  it("opens a reminder for a failure beyond page 1 within the number of cycles the walk needs", async () => {
    // 20 pages of two rows. Row 30 is on page 16: page 1 is read every cycle, rolling pages 2-7, 8-13 and 14-19 follow.
    const history = ok(40);
    history[30] = row("run-late", "failed", { title: "第十六页的失败" });
    const { loop, services } = setup({ world: { "eikona-a": { history, pageSize: 2 } } });
    await loop.runCycle();
    expect(titles(services)).toEqual([]);
    await loop.runCycle();
    expect(titles(services)).toEqual([]);
    const third = await loop.runCycle();
    expect(titles(services)).toEqual(["第十六页的失败"]);
    expect(third.reminders_opened).toBe(1);
    // Later laps find the same failure and add nothing.
    for (let lap = 0; lap < 4; lap++) await loop.runCycle();
    expect(titles(services)).toEqual(["第十六页的失败"]);
  });

  it("finds a family that exists only after the cursor, in history and in the active list", async () => {
    const delegation = { locator: { owner: "eikona", project: "p", task_family: "delegation", task_ref: "del-1" } };
    const video = { locator: { owner: "eikona", project: "p", task_family: "video-task", task_ref: "vid-1" } };
    const history = [...ok(6), row("vid-1", "failed", { ...video, title: "视频任务失败" }), row("del-1", "failed", { ...delegation, title: "委托失败" })];
    const active = [...ok(4, "act"), row("del-2", "blocked", { ...delegation, locator: { ...delegation.locator, task_ref: "del-2" }, title: "委托被阻塞" })];
    const { loop, services } = setup({ world: { "eikona-a": { history, active, pageSize: 2 } } });
    // Page 1 of neither list shows any of them.
    expect(history.slice(0, 2).concat(active.slice(0, 2)).every((task) => task.state === "succeeded")).toBe(true);
    const summary = await loop.runCycle();
    expect(titles(services)).toEqual(["委托失败", "委托被阻塞", "视频任务失败"]);
    expect(summary.reminders_opened).toBe(3);
  });

  it("marks a task recovered when a deeper page shows it healthy again", async () => {
    const history = ok(10);
    history[7] = row("run-7", "failed", { title: "第八行" });
    const { loop, services } = setup({ world: { "eikona-a": { history, pageSize: 2 } } });
    await loop.runCycle();
    expect(titles(services)).toEqual(["第八行"]);
    history[7] = row("run-7", "succeeded", { title: "第八行" });
    expect(rows(services, owner)[0].recovered_at).toBeNull();
    const next = await loop.runCycle();
    expect(next.reminders_recovered).toBe(1);
    expect(rows(services, owner)[0].recovered_at).toBeTruthy();
  });

  it("keeps page 1 on its usual cadence when a deep page keeps failing: the walk holds, the connection does not back off", async () => {
    // History page 4 (cursor "6") always answers 500; 19 cycles ten minutes apart.
    const world = { "eikona-a": { history: ok(30), active: ok(1, "act"), pageSize: 2, breakAt: "6" as string | undefined } };
    const { loop, owners, clock, services } = setup({ world });
    const codes: string[][] = [];
    for (let cycle = 0; cycle < 19; cycle++) {
      clock.now = T0 + cycle * 10 * minute;
      const before = owners.cursors("eikona-a", "history").length;
      const summary = await loop.runCycle();
      const asked = owners.cursors("eikona-a", "history").slice(before);
      // Page 1 of history is read every single cycle, and the connection is never skipped or put in backoff.
      expect(asked[0], `cycle ${cycle}`).toBeUndefined();
      expect(summary.connections_read, `cycle ${cycle}`).toBe(1);
      expect(summary.connections_skipped).toBe(0);
      expect(summary.errors).not.toHaveProperty("source_unavailable");
      codes.push(Object.keys(summary.errors));
    }
    expect(owners.cursors("eikona-a", "active").filter((cursor) => cursor === undefined)).toHaveLength(19);
    // Two failures keep the cursor and say so, the third gives the page up: with nothing known past it, that is the rest
    // of history. The next pass walks to the bad page again at once, so the pattern repeats every three cycles.
    const failedTwiceThenSkipped = [["walk_page_failed"], ["walk_page_failed"], ["walk_page_skipped"]];
    expect(codes).toEqual(Array.from({ length: 19 }, (_, index) => failedTwiceThenSkipped[index % 3]));
    // A pass that gave a page up is not a complete one: the connection stays counted as not yet walked through.
    expect(loop.lastCycle).toMatchObject({ scan_incomplete: 1 });
    // What browsers are shown for the connection is the state of its first pages, which read fine.
    expect(channelsOf(services.tasks, "eikona-a")).toMatchObject({ history: { state: "ready" }, active: { state: "ready" } });
  });

  it("keeps the cursor of a rolling page that failed once, and tries that page again in the next cycle", async () => {
    const world = { "eikona-a": { history: ok(30), pageSize: 2, breakAt: "6" as string | undefined } };
    const { loop, owners, services } = setup({ world });
    const first = await loop.runCycle();
    expect(owners.cursors("eikona-a", "history")).toEqual([undefined, "2", "4", "6"]);
    expect(first.errors).toEqual({ walk_page_failed: 1 });
    expect(first).toMatchObject({ connections_skipped: 0, pages_skipped: 0 });
    expect(channelsOf(services.tasks, "eikona-a")).toMatchObject({ history: { state: "ready" } });
    // The owner recovers: the walk goes on at the page that failed, not at page 2, and the page-1 reads never stopped.
    world["eikona-a"].breakAt = undefined;
    const before = owners.cursors("eikona-a", "history").length;
    const second = await loop.runCycle();
    expect(owners.cursors("eikona-a", "history").slice(before)).toEqual([undefined, "6", "8", "10", "12", "14", "16"]);
    expect(second.errors).toEqual({});
    // Two failures in a row, then success: the count starts over, so three more failures are needed to give a page up.
    world["eikona-a"].breakAt = "20";
    expect((await loop.runCycle()).errors).toEqual({ walk_page_failed: 1 });
    expect((await loop.runCycle()).errors).toEqual({ walk_page_failed: 1 });
    world["eikona-a"].breakAt = undefined;
    expect((await loop.runCycle()).errors).toEqual({});
    // The walk finished a pass on that cycle. A page that fails now is a first failure, not the third.
    world["eikona-a"].breakAt = "6";
    expect((await loop.runCycle()).errors).toEqual({ walk_page_failed: 1 });
  });

  it("gives up a page the owner sent but that holds a row it refuses, goes on after it, and counts it", async () => {
    // Page 4 (rows 6 and 7) holds a row for another project, so the whole page is refused; the owner still names page 5.
    const history = ok(30);
    history[7] = row("stranger", "succeeded", { locator: { owner: "eikona", project: "somewhere-else", task_family: "run", task_ref: "stranger" } });
    history[12] = row("run-12", "failed", { title: "第七页的失败" });
    const { loop, owners, services, clock } = setup({ world: { "eikona-a": { history, pageSize: 2 } } });
    const summaries = [];
    for (let cycle = 0; cycle < 6; cycle++) {
      clock.now = T0 + cycle * 10 * minute;
      summaries.push(await loop.runCycle());
    }
    expect(summaries.slice(0, 3).map((summary) => summary.errors)).toEqual([{ walk_page_failed: 1 }, { walk_page_failed: 1 }, { walk_page_skipped: 1 }]);
    expect(summaries[2]).toMatchObject({ pages_skipped: 1 });
    expect(loop.lastCycle?.scopes["scope-a"]).toBeDefined();
    // The walk is not stuck behind the page: after it was given up, page 5 and the failure on page 7 were reached.
    expect(owners.cursors("eikona-a", "history")).toContain("8");
    expect(rows(services, owner).map((reminder) => reminder.title)).toEqual(["第七页的失败"]);
    // The connection itself was never in trouble.
    expect(summaries.every((summary) => summary.connections_skipped === 0 && !("forbidden" in summary.errors))).toBe(true);
    expect(channelsOf(services.tasks, "eikona-a")).toMatchObject({ history: { state: "ready" } });
  });

  it("still backs a connection off as a whole when its first pages fail, and forgets its place in the walk", async () => {
    const world = { "eikona-a": { history: ok(30), pageSize: 2, status: undefined as number | undefined }, "eikona-b": {} };
    const { loop, owners, clock } = setup({ connections: ["eikona-a", "eikona-b"], world });
    await loop.runCycle();
    // Mid-walk: the last page read was "10", so the cursor stands at "12".
    expect(owners.cursors("eikona-a", "history").at(-1)).toBe("10");
    world["eikona-a"].status = 503;
    clock.now = T0 + 10 * minute;
    expect((await loop.runCycle()).errors).toEqual({ source_unavailable: 1 });
    // Backing off for 20 minutes: not read at 20 (it waits twice as long).
    world["eikona-a"].status = undefined;
    clock.now = T0 + 20 * minute;
    expect(await loop.runCycle()).toMatchObject({ connections_read: 1, connections_skipped: 1 });
    // Read again at 30: the walk starts over at page 2, not at the cursor it had.
    clock.now = T0 + 30 * minute;
    const before = owners.cursors("eikona-a", "history").length;
    expect(await loop.runCycle()).toMatchObject({ connections_read: 2, errors: {} });
    expect(owners.cursors("eikona-a", "history").slice(before).slice(0, 3)).toEqual([undefined, "2", "4"]);
  });

  it("counts connections not yet walked to the end, including ones not read at all yet, until their first pass", async () => {
    const world = { "eikona-a": { history: ok(30), pageSize: 2 }, "eikona-b": {}, "eikona-c": { status: 503 } };
    const { loop } = setup({ connections: ["eikona-a", "eikona-b", "eikona-c"], world });
    // a is mid-walk and c failed: neither has reached the end of its lists. b did.
    expect(await loop.runCycle()).toMatchObject({ connections_read: 3, scan_incomplete: 2 });
    expect(loop.lastCycle?.scopes["scope-a"]).toMatchObject({ scan_incomplete: 2 });
  });
});

describe("recovery does not depend on the order the pages were read in", () => {
  const x = (state: string) => row("run-x", state, { title: "X" });
  const titles = (services: Parameters<typeof rows>[0]) => rows(services, owner).map((reminder) => reminder.title);

  it("opens a reminder for a task that fails on one page and runs on a later one, which is read last", async () => {
    // X failed (history page 1) and runs (active page 2). Page 1 of active is read first, the rolling page after history.
    const world = { "eikona-a": { history: [x("failed")], active: [row("act-1", "running"), x("running")], pageSize: 1 } };
    const { loop, services, owners } = setup({ world });
    const summary = await loop.runCycle();
    expect(owners.cursors("eikona-a", "active")).toEqual([undefined, "1"]);
    expect(titles(services)).toEqual(["X"]);
    expect(summary).toMatchObject({ reminders_opened: 1, reminders_recovered: 0 });
    // With both rows on page 1 it already did.
    const together = setup({ world: { "eikona-a": { history: [x("failed")], active: [x("running")] } } });
    await together.loop.runCycle();
    expect(titles(together.services)).toEqual(["X"]);
  });

  it("does not recover a task while any row of the cycle still shows it failing", async () => {
    const world = { "eikona-a": { history: [x("failed")], active: [row("act-1", "running"), x("running")], pageSize: 1 } };
    const { loop, services, clock } = setup({ world });
    await loop.runCycle();
    // The healthy-looking row is read last in every following cycle too: the reminder stays open.
    for (let cycle = 1; cycle <= 3; cycle++) {
      clock.now = T0 + cycle * 10 * minute;
      expect((await loop.runCycle()).reminders_recovered).toBe(0);
    }
    expect(rows(services, owner)[0].recovered_at).toBeNull();
    // It is recovered once no row shows it failing.
    world["eikona-a"].history = [];
    clock.now = T0 + 40 * minute;
    expect((await loop.runCycle()).reminders_recovered).toBe(1);
    expect(rows(services, owner)[0].recovered_at).toBeTruthy();
  });

  it("does not open and recover a reminder from cycle to cycle while the walk comes and goes", async () => {
    // X fails on history page 1, which every cycle reads, and runs on active page 3, which the walk reaches every other cycle.
    const active = Array.from({ length: 10 }, (_, index) => (index === 2 ? x("running") : row(`act-${index}`, "running")));
    const world = { "eikona-a": { history: [x("failed")], active, pageSize: 1 } };
    const { loop, services, owners, clock } = setup({ world });
    const seen: boolean[] = [];
    const opened: number[] = [];
    const recovered: number[] = [];
    for (let cycle = 0; cycle < 8; cycle++) {
      clock.now = T0 + cycle * 10 * minute;
      const before = owners.cursors("eikona-a", "active").length;
      const summary = await loop.runCycle();
      seen.push(owners.cursors("eikona-a", "active").slice(before).includes("2"));
      opened.push(summary.reminders_opened);
      recovered.push(summary.reminders_recovered);
      if (rows(services, owner).length) expect(rows(services, owner)[0].recovered_at, `cycle ${cycle}`).toBeNull();
    }
    // The healthy row really did come and go with the walk, so this proves something.
    expect(seen.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(seen.filter((was) => !was).length).toBeGreaterThanOrEqual(3);
    expect(opened).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(recovered).toEqual(Array(8).fill(0));
    expect(rows(services, owner)).toHaveLength(1);
  });
});

describe("a connection shared by two scopes", () => {
  it("is read once per cycle, with one budget, and its rows go to each scope's own recipients under that scope's keys", async () => {
    const long = Array.from({ length: 80 }, (_, index) => row(`run-${index}`, "succeeded"));
    long[40] = row("run-40", "failed", { title: "共享连接的失败" });
    const { loop, owners, services, handle } = setup({
      users: [user("bob", "admin", { scope_ids: ["scope-b"] })],
      extraScopes: [{ id: "scope-b", connections: ["eikona-a"] }],
      world: { "eikona-a": { history: long, pageSize: 1 } },
    });
    const summary = await loop.runCycle();
    // One read: the handshake, both first pages and five rolling pages, not sixteen requests.
    expect(owners.requests("eikona-a")).toHaveLength(8);
    expect(summary).toMatchObject({ calls: 8, pages_read: 7, connections_read: 1 });
    // Each scope sees the connection as its own, and the totals count it once.
    expect(loop.lastCycle?.scopes["scope-a"]).toMatchObject({ calls: 8, pages_read: 7, connections_read: 1 });
    expect(loop.lastCycle?.scopes["scope-b"]).toMatchObject({ calls: 8, pages_read: 7, connections_read: 1 });
    // The failure sits on page 41 and is found by later cycles, in both scopes, for the recipients each scope has.
    for (let cycle = 0; cycle < 12; cycle++) await loop.runCycle();
    expect(rows(services, owner, "scope-a").map((reminder) => reminder.title)).toEqual(["共享连接的失败"]);
    expect(rows(services, owner, "scope-b").map((reminder) => reminder.title)).toEqual(["共享连接的失败"]);
    expect(rows(services, "yeisme:personal|bob", "scope-b").map((reminder) => reminder.title)).toEqual(["共享连接的失败"]);
    expect(rows(services, "yeisme:personal|bob", "scope-a")).toEqual([]);
    // A task key names its scope. The one in scope-b's reminder is valid there, and opens the task.
    const keyOf = (scope: string) => rows(services, owner, scope)[0].task_key;
    expect(keyOf("scope-a")).not.toBe(keyOf("scope-b"));
    expect(JSON.parse(Buffer.from(keyOf("scope-b").split(".")[0], "base64url").toString())).toMatchObject({ scope: "scope-b", c: "eikona-a", ref: "run-40" });
    const asOwner = asSession(services, handle, ownerSession());
    expect((await asOwner(`/tasks/${encodeURIComponent(keyOf("scope-b"))}?scope=scope-b`)).status).toBe(200);
    expect((await asOwner(`/tasks/${encodeURIComponent(keyOf("scope-a"))}?scope=scope-b`)).status).toBeGreaterThanOrEqual(400);
    vi.restoreAllMocks();
  });

  it("gives the connection one backoff and one walk, whatever number of scopes have it", async () => {
    const { loop, owners, clock } = setup({ extraScopes: [{ id: "scope-b", connections: ["eikona-a"] }], world: { "eikona-a": { status: 503 } } });
    const first = await loop.runCycle();
    // Two requests (each list read tries the handshake), counted once; one error per scope that has the connection.
    expect(first.calls).toBe(2);
    expect(first.errors).toEqual({ source_unavailable: 1 });
    expect(loop.lastCycle?.scopes["scope-a"].errors).toEqual({ source_unavailable: 1 });
    expect(loop.lastCycle?.scopes["scope-b"].errors).toEqual({ source_unavailable: 1 });
    clock.now = T0 + 10 * minute;
    expect(await loop.runCycle()).toMatchObject({ connections_read: 0, connections_skipped: 1, calls: 0 });
    expect(owners.requests()).toHaveLength(2);
  });
});

describe("what the loop keeps for a connection between cycles", () => {
  const ok = (count: number) => Array.from({ length: count }, (_, index) => row(`ok-${String(index).padStart(2, "0")}`, "succeeded"));

  it("lets go of the backoff and the place in the walk of a connection that left the config, so one that comes back starts fresh", async () => {
    const world = { "eikona-a": { history: ok(30), pageSize: 2 }, "eikona-b": { status: 503 } };
    const { loop, owners, scope, clock } = setup({ connections: ["eikona-a", "eikona-b"], world });
    await loop.runCycle();
    expect(owners.cursors("eikona-a", "history").at(-1)).toBe("10");
    // b is backing off until minute 20, a stands at page 7 of its walk. Both leave the config for a cycle...
    scope.connection_ids = [];
    clock.now = T0 + 10 * minute;
    expect(await loop.runCycle()).toMatchObject({ connections_read: 0, connections_skipped: 0 });
    // ...and come back. b is read at once: its backoff went with it. a starts its walk over.
    scope.connection_ids = ["eikona-a", "eikona-b"];
    world["eikona-b"] = {} as typeof world["eikona-b"];
    const before = owners.cursors("eikona-a", "history").length;
    clock.now = T0 + 11 * minute;
    expect(await loop.runCycle()).toMatchObject({ connections_read: 2, connections_skipped: 0, errors: {} });
    expect(owners.cursors("eikona-a", "history").slice(before).slice(0, 3)).toEqual([undefined, "2", "4"]);
  });

  it("keeps all of it when the connections of a scope could not be listed this time", async () => {
    const world = { "eikona-a": { history: ok(30), pageSize: 2 }, "eikona-b": { status: 503 } };
    const { loop, owners, services, clock } = setup({ connections: ["eikona-a", "eikona-b"], world });
    await loop.runCycle();
    // The registered connections come from the database; a read of it fails once.
    vi.spyOn(services.tasks, "connections").mockImplementationOnce(() => { throw new Error("database is locked"); });
    clock.now = T0 + 5 * minute;
    const failed = await loop.runCycle();
    expect(failed.errors).toEqual({ connections_unreadable: 1 });
    expect(failed).toMatchObject({ connections_read: 0 });
    // Next time b is still backing off (until minute 20) and a goes on at page 7, not at page 2.
    world["eikona-b"] = {} as typeof world["eikona-b"];
    const before = owners.cursors("eikona-a", "history").length;
    clock.now = T0 + 10 * minute;
    expect(await loop.runCycle()).toMatchObject({ connections_read: 1, connections_skipped: 1 });
    expect(owners.cursors("eikona-a", "history").slice(before).slice(0, 3)).toEqual([undefined, "12", "14"]);
    vi.restoreAllMocks();
  });
});

describe("delivering to each recipient on its own", () => {
  it("writes the reminder for the others when one recipient's write fails, and says so", async () => {
    const world = { "eikona-a": { history: [row("run-1", "failed", { title: "站台背景" })] } };
    const { loop, services, config } = setup({ users: [user("zed", "admin")], world });
    // The one whose write fails comes first in line; the one after it must not be skipped because of it.
    const [broken, other] = reminderRecipients(config, "scope-a");
    expect([broken, other].sort()).toEqual([owner, "yeisme:personal|zed"].sort());
    const sync = services.notifications.sync.bind(services.notifications);
    vi.spyOn(services.notifications, "sync").mockImplementation((input) => {
      if (input.subject === broken) throw new Error("database is locked");
      return sync(input);
    });
    const summary = await loop.runCycle();
    expect(summary.errors).toEqual({ reminder_write_failed: 1 });
    expect(summary.reminders_opened).toBe(1);
    expect(rows(services, other).map((reminder) => reminder.title)).toEqual(["站台背景"]);
    expect(rows(services, broken)).toEqual([]);
    // Nothing is lost for good: the next cycle writes the one that failed.
    vi.restoreAllMocks();
    const again = await loop.runCycle();
    expect(again).toMatchObject({ reminders_opened: 1, errors: {} });
    expect(rows(services, broken).map((reminder) => reminder.title)).toEqual(["站台背景"]);
  });
});

describe("backoff", () => {
  it("waits twice as long after each failed read of a connection, up to an hour, and starts over when it answers", async () => {
    const world = { "eikona-a": { status: 503 } as { status?: number; history?: ReturnType<typeof row>[] }, "eikona-b": {} };
    const { loop, owners, clock } = setup({ connections: ["eikona-a", "eikona-b"], world });
    const requestsTo = (id: string) => owners.log.filter((entry) => entry.connection === id).length;
    const at = async (minutes: number) => { clock.now = T0 + minutes * minute; return loop.runCycle(); };

    const first = await at(0);
    expect(first.errors).toEqual({ source_unavailable: 1 });
    // The failing connection gets two requests (each list read tries the handshake), the healthy one three.
    expect(first.calls).toBe(5);
    const afterFirst = requestsTo("eikona-a");
    expect(afterFirst).toBeGreaterThan(0);
    // The healthy connection keeps being read every cycle; the failing one is left alone for 20 minutes.
    const second = await at(10);
    expect(second).toMatchObject({ connections_read: 1, connections_skipped: 1, errors: {}, calls: 2 });
    expect(requestsTo("eikona-a")).toBe(afterFirst);
    expect((await at(20)).errors).toEqual({ source_unavailable: 1 });
    const afterThird = requestsTo("eikona-a");
    expect(afterThird).toBeGreaterThan(afterFirst);
    // The second failure waits 40 minutes: nothing at 30, 40 and 50, a read at 60.
    for (const minutes of [30, 40, 50]) await at(minutes);
    expect(requestsTo("eikona-a")).toBe(afterThird);
    expect((await at(60)).errors).toEqual({ source_unavailable: 1 });
    // Then 80 minutes would follow, but an hour is the most it waits.
    await at(119);
    const afterFourth = requestsTo("eikona-a");
    await at(120);
    expect(requestsTo("eikona-a")).toBeGreaterThan(afterFourth);
    // Once the owner answers again the connection is read every cycle.
    world["eikona-a"] = {};
    await at(180);
    expect((await at(190)).connections_read).toBe(2);
    expect((await at(200)).errors).toEqual({});
  });

  it("keeps other kinds of failure out of the way too, and a failing connection never blocks a healthy one", async () => {
    const world = { "eikona-a": { status: 403 }, "eikona-b": { history: [row("run-b", "failed", { title: "b 失败" })] } };
    const { loop, services } = setup({ connections: ["eikona-a", "eikona-b"], world });
    const summary = await loop.runCycle();
    expect(Object.keys(summary.errors)).toEqual(["needs_authorization"]);
    expect(rows(services, owner).map((reminder) => reminder.title)).toEqual(["b 失败"]);
  });
});

describe("open tools", () => {
  it("reads open tools on the first cycle and then every third, and counts each read as a call", async () => {
    const drive = fakeDriveBridge(1);
    const { loop, services } = setup({ driveBridge: drive, world: { "eikona-a": {} } });
    const observe = vi.spyOn(services.openTools, "observe");
    const seen: boolean[] = [];
    for (let index = 0; index < 7; index++) seen.push((await loop.runCycle()).open_tools_read);
    expect(seen).toEqual([true, false, false, true, false, false, true]);
    expect(observe).toHaveBeenCalledTimes(3);
  });

  it("reads them every cycle when asked to", async () => {
    const { loop, services } = setup({ driveBridge: fakeDriveBridge(0), world: { "eikona-a": {} }, observation: { open_tools_every: 1 } });
    const observe = vi.spyOn(services.openTools, "observe");
    await loop.runCycle();
    await loop.runCycle();
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("turns failed runs into operation reminders that open the services page, ten per tool at most, once each", async () => {
    const drive = fakeDriveBridge(14);
    const { loop, services } = setup({ driveBridge: drive, users: [user("alice", "admin"), user("bob", "viewer")], world: { "eikona-a": {} } });
    const first = await loop.runCycle();
    // Ten runs, two admins.
    expect(first.reminders_opened).toBe(20);
    const mine = rows(services, owner);
    expect(mine).toHaveLength(10);
    expect(mine[0]).toMatchObject({ category: "operation", target_path: "/services", owner: "drivebridge", state: "unread", task_state: "failed", last_error_code: "failed", session_id: "background" });
    expect(mine.map((reminder) => reminder.title)).toEqual(Array(10).fill("DriveBridge 导出失败"));
    expect(rows(services, "yeisme:personal|alice")).toHaveLength(10);
    expect(rows(services, "yeisme:personal|bob")).toEqual([]);
    // The same runs are not announced again; they do not count as home attention either.
    expect((await services.notifications.list("scope-a", "", owner)).every((reminder) => !services.notifications.actionable(reminder))).toBe(true);
    drive.requests.length = 0;
    const second = await loop.runCycle();
    expect(second.reminders_opened).toBe(0);
    expect(second.open_tools_read).toBe(false);
    expect(rows(services, owner)).toHaveLength(10);
    // The owner's error text and paths never reach the ledger.
    const text = JSON.stringify(stored(services));
    for (const leaked of ["permission denied", "/secret", "/srv/"]) expect(text).not.toContain(leaked);
  });

  it("announces a run when it fails, not while it is still running, and a tool it cannot read is an error code", async () => {
    const drive = fakeDriveBridge(0);
    drive.runs.push({ id: "op_moving", kind: "upload", status: "transferring", size_bytes: 100, bytes_transferred: 10, updated_at: drive.ago(1) });
    const { loop, services } = setup({ driveBridge: drive, world: { "eikona-a": {} }, observation: { open_tools_every: 1 } });
    await loop.runCycle();
    expect(rows(services, owner)).toEqual([]);
    drive.runs[drive.runs.length - 1] = { id: "op_moving", kind: "upload", status: "failed", updated_at: drive.ago(0) };
    // The service keeps a reading for two minutes; a forced read stands in for that time passing.
    await services.openTools.observe("drivebridge", { force: true });
    expect((await loop.runCycle()).reminders_opened).toBe(1);
    expect(rows(services, owner).map((reminder) => reminder.title)).toEqual(["DriveBridge 上传失败"]);
    const down = setup({ driveBridge: { requests: [], runs: [], ago: () => "", fetcher: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch }, world: { "eikona-a": {} } });
    expect((await down.loop.runCycle()).errors).toEqual({ open_tool_forbidden: 1 });
    expect(rows(down.services, owner)).toEqual([]);
  });
});

describe("running in the background", () => {
  it("schedules the first cycle a minute after start plus jitter, then one interval after each cycle finishes", async () => {
    const { loop, timers, clock } = setup({ world: { "eikona-a": {} }, observation: { interval_minutes: 7 }, loop: { random: () => 0.5 } });
    loop.start();
    expect(timers.pending().map((timer) => timer.ms)).toEqual([60_000 + 7_500]);
    expect(loop.nextRunAt).toBe(new Date(T0 + 67_500).toISOString());
    expect(loop.running).toBe(true);
    // Starting twice does not schedule twice.
    loop.start();
    expect(timers.scheduled).toHaveLength(1);
    clock.now = T0 + 67_500;
    timers.fire(0);
    await vi.waitFor(() => expect(loop.cycleCount).toBe(1));
    await vi.waitFor(() => expect(timers.scheduled).toHaveLength(2));
    expect(timers.scheduled[1].ms).toBe(7 * minute);
    expect(loop.nextRunAt).toBe(new Date(clock.now + 7 * minute).toISOString());
    await loop.stop();
  });

  it("never runs two cycles at once: a second request joins the one in flight", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const { loop, owners } = setup({ world: { "eikona-a": { hold } } });
    const first = loop.runCycle();
    const second = loop.runCycle();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(owners.log.length).toBeGreaterThan(0));
    const during = owners.log.length;
    release();
    await first;
    expect(loop.cycleCount).toBe(1);
    expect(owners.log.length).toBeGreaterThanOrEqual(during);
    // Afterwards a new cycle may run.
    expect(loop.runCycle()).not.toBe(first);
    await vi.waitFor(() => expect(loop.cycleCount).toBe(2));
  });

  it("stop cancels the timer, waits for a cycle in flight, and schedules nothing afterwards", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const { loop, owners, timers } = setup({ world: { "eikona-a": { hold }, "eikona-b": {} }, extraScopes: [{ id: "scope-b", connections: ["eikona-b"] }] });
    loop.start();
    timers.fire(0);
    await vi.waitFor(() => expect(owners.log.length).toBeGreaterThan(0));
    let stopped = false;
    const stopping = loop.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    expect(loop.running).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(loop.lastCycle).not.toBeNull();
    // The cycle stopped at the round it was in: no history list was asked for, in either scope.
    expect(owners.reads("eikona-a").map((entry) => entry.mode)).toEqual(["active"]);
    expect(owners.reads("eikona-b").map((entry) => entry.mode)).toEqual(["active"]);
    expect(timers.pending()).toEqual([]);
    expect(loop.nextRunAt).toBeNull();
    // Stopping an idle loop cancels its pending timer.
    const idle = setup({ world: { "eikona-a": {} } });
    idle.loop.start();
    const pending = idle.timers.scheduled[0];
    await idle.loop.stop();
    expect(pending.cleared).toBe(true);
    expect(idle.timers.pending()).toEqual([]);
  });

  it("a stopped loop can be started again", async () => {
    const { loop, timers } = setup({ world: { "eikona-a": {} } });
    loop.start();
    await loop.stop();
    loop.start();
    expect(loop.running).toBe(true);
    expect(timers.pending()).toHaveLength(1);
    await loop.stop();
  });

  it("a restart while a cycle is still running leaves exactly one timer: the old run never schedules or overwrites", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const { loop, owners, timers } = setup({ world: { "eikona-a": { hold } } });
    loop.start();
    timers.fire(0);
    await vi.waitFor(() => expect(owners.log.length).toBeGreaterThan(0));
    // Stop and start again while the first run's cycle is held at the owner.
    const stopping = loop.stop();
    loop.start();
    expect(timers.pending()).toHaveLength(1);
    const restarted = timers.pending()[0];
    release();
    await stopping;
    await vi.waitFor(() => expect(loop.lastCycle).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The old tick finished after the restart and must not have set a second timer or replaced the new run's.
    expect(timers.pending()).toEqual([restarted]);
    expect(timers.scheduled).toHaveLength(2);
    expect(loop.running).toBe(true);
    await loop.stop();
    expect(timers.pending()).toEqual([]);
    expect(loop.nextRunAt).toBeNull();
  });

  it("never holds two timers, even if scheduling is asked for twice", async () => {
    const { loop, timers } = setup({ world: { "eikona-a": {} } });
    loop.start();
    loop.start();
    expect(timers.pending()).toHaveLength(1);
    timers.fire(0);
    await vi.waitFor(() => expect(loop.cycleCount).toBe(1));
    await vi.waitFor(() => expect(timers.pending()).toHaveLength(1));
    expect(timers.scheduled).toHaveLength(2);
    await loop.stop();
  });

  it("logs only when something opened, recovered or went wrong, and never what the reminders say", async () => {
    const lines: string[] = [];
    const world = { "eikona-a": { history: [row("run-1", "failed", { title: "站台背景" })] } };
    const { loop } = setup({ world, loop: { log: (line) => lines.push(line) } });
    await loop.runCycle();
    await loop.runCycle();
    expect(lines).toEqual(["[control-center] observation cycle: calls=3 opened=1 recovered=0"]);
    world["eikona-a"].history = [];
    const broken = setup({ world: { "eikona-a": { status: 503 } }, loop: { log: (line) => lines.push(line) } });
    await broken.loop.runCycle();
    expect(lines[1]).toBe("[control-center] observation cycle: calls=2 opened=0 recovered=0 errors=source_unavailable=1");
    expect(lines.join("\n")).not.toContain("站台背景");
  });

  it("calls no Provider, no Auctra reader and no owner API outside the task connections and open tools", async () => {
    const forbidden = (name: string) => new Proxy({}, { get: (_target, property) => (property === "then" || typeof property !== "string" ? undefined : () => { throw new Error(`${name}.${property} was called by background observation`); }) });
    const { createControlCenter } = await import("../server/app");
    const { createMemoryDB } = await import("../server/db/client");
    const { TaskConnections } = await import("../server/task-connections");
    const { createObservationLoop } = await import("../server/observation-loop");
    const base = setup({ world: failing, driveBridge: fakeDriveBridge(2) });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { services } = createControlCenter(base.config, {
      db: createMemoryDB(), openTools: base.openTools,
      tasks: new TaskConnections(base.config, base.owners.fetcher),
      providers: forbidden("providers") as never, auctra: forbidden("auctra") as never, scaenaStoryboard: forbidden("scaena") as never, readers: forbidden("readers") as never,
    });
    const summary = await createObservationLoop(services, { log: () => undefined }).runCycle();
    expect(summary.errors).toEqual({});
    expect(summary.reminders_opened).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hands credential reminders from the lifecycle to every recipient once, under the credential:<slot>:<state>:<stage> key", async () => {
    const facts = [{ slot: "eikona-a", state: "expiring", stage: "7d", title: "Eikona 凭据将在 7 天后到期", owner: "eikona" }];
    const { loop, services } = setup({ users: [user("alice", "admin"), user("bob", "viewer")], world: { "eikona-a": {} }, loop: { credentials: () => facts } });
    expect((await loop.runCycle()).reminders_opened).toBe(2);
    expect((await loop.runCycle()).reminders_opened).toBe(0);
    expect(rows(services, owner)[0]).toMatchObject({ category: "credential", title: "Eikona 凭据将在 7 天后到期", target_path: "/services", owner: "eikona", session_id: "background", failure_fingerprint: "credential:eikona-a:expiring:7d" });
    expect(rows(services, "yeisme:personal|bob")).toEqual([]);
    // A later stage of the same credential is a new reminder.
    facts.push({ slot: "eikona-a", state: "expiring", stage: "1d", title: "Eikona 凭据明天到期", owner: "eikona" });
    expect((await loop.runCycle()).reminders_opened).toBe(2);
    expect(rows(services, owner).filter((reminder) => reminder.category === "credential")).toHaveLength(2);
    // A hook that throws costs the cycle one error code, not the cycle.
    const faulty = setup({ world: failing, loop: { credentials: () => { throw new Error("boom"); } } });
    const summary = await faulty.loop.runCycle();
    expect(summary.errors).toEqual({ credentials_unreadable: 1 });
    expect(summary.reminders_opened).toBe(1);
  });
});
