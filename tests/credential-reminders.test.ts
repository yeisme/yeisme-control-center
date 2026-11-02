import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createControlCenter } from "../server/app";
import { OpenToolService } from "../server/open-tools/service";
import { credentialStatuses } from "../server/credentials";
import { countsAsUnread } from "../server/notifications";
import { credentialFacts, credentialReminders, credentialTitle, credentialUnknown } from "../server/observation-credentials";
import { createObservationLoop } from "../server/observation-loop";
import { TaskConnections } from "../server/task-connections";
import { dayMs, type CredentialStatus } from "../src/shared/credentials";
import { T0, fakeDriveBridge, hour, minute, row, rows, setup, stored, user } from "./observation-loop.support";

const owner = "yeisme:personal|owner";
const iso = (ms: number) => new Date(ms).toISOString();
const inDays = (days: number) => iso(T0 + days * dayMs);

/** `setup()` with the credential reminders the server wires in `server/index.ts`. */
function withCredentials(options: Parameters<typeof setup>[0] = {}) {
  const s = setup(options);
  const loop = createObservationLoop(s.services, { log: () => undefined, random: () => 0, timers: s.timers, credentials: credentialReminders(s.services) });
  /** Records when the one connection's credential runs out. */
  const expireAt = (value: string | undefined) => { (s.config.connections![0] as { credential_expires_at?: string }).credential_expires_at = value; };
  const credentialRows = (subject = owner) => rows(s.services, subject).filter((reminder) => reminder.category === "credential");
  return { ...s, loop, expireAt, credentialRows };
}

const status = (over: Partial<CredentialStatus>): CredentialStatus => ({ id: "open_tool:gateway", owner: "gateway", label: "MCP Gateway", state: "rejected", shared_with: [], ...over });

describe("credential facts", () => {
  it("are made for credentials that cannot be used or will not be for long only, one per slot, state and stage", () => {
    const facts = credentialFacts([
      status({ id: "open_tool:gateway", state: "rejected", reason: "unauthenticated" }),
      status({ id: "open_tool:drivebridge", owner: "drivebridge", label: "DriveBridge", state: "expiring", stage: "1d", days_left: 1 }),
      status({ id: "connection:a", owner: "eikona", label: "Eikona 主库", state: "unreadable", reason: "permissions" }),
      status({ id: "connection:b", owner: "sonora", label: "Sonora", state: "expired" }),
      // Nothing to remind about: works but some reads are refused (the Services panel shows it), fine, or no expiry recorded.
      status({ id: "connection:c", owner: "scaena", label: "Scaena", state: "limited", reason: "content_denied" }),
      status({ id: "open_tool:x", owner: "gateway", label: "MCP Gateway", state: "limited", reason: "read_forbidden" }),
      status({ id: "connection:d", state: "ok" }),
      status({ id: "connection:e", state: "unknown_expiry" }),
      status({ id: "connection:f", state: "unknown_expiry", reason: "invalid_expiry" }),
    ]);
    expect(facts.map((fact) => `${fact.slot}|${fact.state}|${fact.stage}`)).toEqual([
      "open_tool:gateway|rejected|-", "open_tool:drivebridge|expiring|1d", "connection:a|unreadable|-", "connection:b|expired|-",
    ]);
    expect(facts[0]).toEqual({ slot: "open_tool:gateway", state: "rejected", stage: "-", title: "MCP Gateway · 凭据被拒", owner: "gateway", error_code: "unauthenticated" });
    // A state with no reason has no error code.
    expect(facts[3]).not.toHaveProperty("error_code");
  });

  it("are never made for a limited credential, in whatever way it is limited", () => {
    for (const reason of ["content_denied", "read_forbidden"] as const) expect(credentialFacts([status({ state: "limited", reason })]), reason).toEqual([]);
  });

  it("say what is wrong in Chinese, from the shared labels, with the stage of an expiring credential", () => {
    expect(credentialTitle(status({ state: "unreadable" }))).toBe("MCP Gateway · 凭据读不到");
    expect(credentialTitle(status({ state: "expired" }))).toBe("MCP Gateway · 凭据已过期");
    expect(credentialTitle(status({ state: "limited" }))).toBe("MCP Gateway · 部分读取被拒");
    expect(credentialTitle(status({ state: "expiring", stage: "7d" }))).toBe("MCP Gateway · 即将到期（7 天内）");
    expect(credentialTitle(status({ state: "expiring", stage: "1d" }))).toBe("MCP Gateway · 即将到期（1 天内）");
  });
});

describe("credential reminders", () => {
  it("open once per slot, state and stage, for every recipient and no viewer, and the key is credential:<slot>:<state>:<stage>", async () => {
    const { loop, expireAt, services, credentialRows } = withCredentials({ users: [user("alice", "admin"), user("bob", "viewer")], world: { "eikona-a": {} } });
    expireAt(inDays(5));
    expect((await loop.runCycle()).reminders_opened).toBe(2);
    expect((await loop.runCycle()).reminders_opened).toBe(0);
    expect(credentialRows()).toHaveLength(1);
    expect(credentialRows()[0]).toMatchObject({
      category: "credential", title: "eikona-a · 即将到期（7 天内）", target_path: "/services", owner: "eikona", session_id: "background",
      task_state: "expiring", failure_fingerprint: "credential:connection:eikona-a:expiring:7d", recovered_at: null, state: "unread",
    });
    expect(credentialRows("yeisme:personal|alice")).toHaveLength(1);
    expect(rows(services, "yeisme:personal|bob")).toEqual([]);
  });

  it("move on when the stage changes: the 7-day reminder is recovered and the 1-day one opens", async () => {
    const { loop, expireAt, clock, credentialRows } = withCredentials({ world: { "eikona-a": {} } });
    expireAt(inDays(5));
    await loop.runCycle();
    // Four days later one day is left.
    clock.now = T0 + 4.2 * dayMs;
    const summary = await loop.runCycle();
    expect(summary).toMatchObject({ reminders_opened: 1, reminders_recovered: 1 });
    const byKey = Object.fromEntries(credentialRows().map((reminder) => [reminder.failure_fingerprint, reminder]));
    expect(byKey["credential:connection:eikona-a:expiring:7d"].recovered_at).toBe(iso(clock.now));
    expect(byKey["credential:connection:eikona-a:expiring:1d"]).toMatchObject({ recovered_at: null, state: "unread", title: "eikona-a · 即将到期（1 天内）" });
    // Then it runs out: another state, another reminder.
    clock.now = T0 + 5.5 * dayMs;
    expect(await loop.runCycle()).toMatchObject({ reminders_opened: 1, reminders_recovered: 1 });
    expect(credentialRows().filter((reminder) => !reminder.recovered_at).map((reminder) => reminder.failure_fingerprint)).toEqual(["credential:connection:eikona-a:expired:-"]);
  });

  it("recover when the credential is replaced, and open again as a new unread reminder when the same step comes round again", async () => {
    const { loop, expireAt, clock, credentialRows, services } = withCredentials({ world: { "eikona-a": {} } });
    expireAt(inDays(5));
    await loop.runCycle();
    const [first] = credentialRows();
    // The person had acknowledged it before replacing the credential.
    services.notifications.acknowledge(first.id, "scope-a", "", owner);
    expireAt(inDays(90));
    expect(await loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 1 });
    expect(credentialRows()[0].recovered_at).toBe(iso(clock.now));
    // No longer counted as unread, or as a home attention item.
    expect(services.notifications.unreadCount("scope-a", "", owner)).toBe(0);
    // Months later the new credential is about to run out too: the same key, a new incident, nothing carried over.
    clock.now = T0 + 85 * dayMs;
    expect(await loop.runCycle()).toMatchObject({ reminders_opened: 1, reminders_recovered: 0 });
    expect(credentialRows()).toHaveLength(1);
    expect(credentialRows()[0]).toMatchObject({ id: first.id, state: "unread", recovered_at: null, acknowledged_at: null, first_seen_at: iso(clock.now) });
    expect(stored(services).filter((entry) => entry.category === "credential")).toHaveLength(1);
  });

  it("leave a credential whose facts could not be worked out as it is, instead of calling it recovered", async () => {
    const s = setup({ world: { "eikona-a": {} } });
    let broken = false;
    const hook = credentialReminders(s.services);
    const loop = createObservationLoop(s.services, { log: () => undefined, random: () => 0, timers: s.timers, credentials: (now, scope) => { if (broken) throw new Error("boom"); return hook(now, scope); } });
    (s.config.connections![0] as { credential_expires_at?: string }).credential_expires_at = inDays(5);
    await loop.runCycle();
    broken = true;
    const summary = await loop.runCycle();
    expect(summary.errors).toEqual({ credentials_unreadable: 1 });
    expect(summary.reminders_recovered).toBe(0);
    expect(rows(s.services, owner).filter((reminder) => reminder.category === "credential").map((reminder) => reminder.recovered_at)).toEqual([null]);
  });

  it("recover a credential that left the configuration, and touch nothing when the loop has no credential hook", async () => {
    const { loop, expireAt, config, credentialRows } = withCredentials({ world: { "eikona-a": {} } });
    expireAt(inDays(5));
    await loop.runCycle();
    // The connection is switched off: it does not use its credential, so there is nothing to remind about.
    config.connections![0].enabled = false;
    expect(await loop.runCycle()).toMatchObject({ reminders_recovered: 1 });
    expect(credentialRows()[0].recovered_at).not.toBeNull();
    const plain = setup({ world: { "eikona-a": {} } });
    (plain.config.connections![0] as { credential_expires_at?: string }).credential_expires_at = inDays(5);
    expect(await plain.loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 0 });
  });

  it("report a credential file that is not private, and recover once the connection has been read with the fixed file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "credential-reminders-"));
    try {
      const file = join(dir, "key");
      writeFileSync(file, "reminder-test-key\n", { mode: 0o600 });
      const { loop, config, clock, owners, credentialRows } = withCredentials({ world: { "eikona-a": {} } });
      config.connections![0].credential_ref = file;
      await loop.runCycle();
      expect(credentialRows()).toEqual([]);
      chmodSync(file, 0o644);
      // The file check alone says so; no owner is asked.
      const asked = owners.requests().length;
      expect(await loop.runCycle()).toMatchObject({ reminders_opened: 1 });
      expect(owners.requests().length).toBe(asked);
      expect(credentialRows()[0]).toMatchObject({ title: "eikona-a · 凭据读不到", task_state: "unreadable", last_error_code: "permissions", failure_fingerprint: "credential:connection:eikona-a:unreadable:-" });
      // Fixed, but the failed read is still what was last observed: a reminder is only ended on evidence, and the
      // connection waits out its backoff before it is read again.
      chmodSync(file, 0o600);
      expect(await loop.runCycle()).toMatchObject({ reminders_recovered: 0 });
      clock.now += 3 * hour;
      expect(await loop.runCycle()).toMatchObject({ reminders_recovered: 1 });
      expect(credentialRows()[0].recovered_at).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("notice an owner that turns the credential away in the background, from what the list reads saw", async () => {
    const { loop, credentialRows, services, scope } = withCredentials({ world: { "eikona-a": { status: 401 } } });
    // No page has asked for an observation: only the loop's own list reads have touched the connection.
    expect((await loop.runCycle()).errors).toMatchObject({ needs_authorization: 1 });
    expect(services.tasks.cached(scope)[0]).toMatchObject({ id: "eikona-a", state: "needs_authorization", runtime: { authorization: "denied" } });
    expect(credentialRows()[0]).toMatchObject({ title: "eikona-a · 凭据被拒", task_state: "rejected", last_error_code: "owner_denied", owner: "eikona" });
  });

  it("see the open tools the loop read, and turn a refused token into one reminder", async () => {
    const drive = fakeDriveBridge(0);
    const refusing = { ...drive, fetcher: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch };
    const { loop, credentialRows } = withCredentials({ world: { "eikona-a": {} }, driveBridge: refusing });
    expect((await loop.runCycle()).open_tools_read).toBe(true);
    const found = credentialRows().filter((reminder) => reminder.owner === "drivebridge");
    expect(found.map((reminder) => [reminder.task_state, reminder.last_error_code])).toEqual([["rejected", "unauthenticated"]]);
  });
});

describe("credential reminders cost no owner request", () => {
  it("the accessors and the facts only read memory", async () => {
    const drive = fakeDriveBridge(1);
    const { loop, services, scope, owners } = withCredentials({ world: { "eikona-a": { history: [row("run-1", "failed")] } }, driveBridge: drive });
    // Before anything was read there is nothing cached.
    expect(services.tasks.cached(scope)).toEqual([]);
    expect(services.openTools.credentialProjection("drivebridge")).toBeNull();
    expect(services.openTools.credentialProjections(scope)).toEqual([]);
    await loop.runCycle();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const before = { owners: owners.requests().length, drive: drive.requests.length };
    const hook = credentialReminders(services);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      hook(T0 + attempt * hour, scope);
      services.tasks.cached(scope);
      services.openTools.credentialProjection("drivebridge");
      services.openTools.credentialProjections(scope);
    }
    expect({ owners: owners.requests().length, drive: drive.requests.length }).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    // What was read is what the accessors hand back.
    expect(services.tasks.cached(scope).map((state) => state.id)).toEqual(["eikona-a"]);
    expect(services.openTools.credentialProjections(scope).map((projection) => projection.tool)).toEqual(["drivebridge"]);
  });

  it("a cycle with the hook makes the same owner requests as one without, whatever it finds", async () => {
    const world = () => ({ "eikona-a": { history: [row("run-1", "failed")], active: [row("run-2", "running")] }, "eikona-b": { status: 401 } });
    const without = setup({ connections: ["eikona-a", "eikona-b"], world: world(), driveBridge: fakeDriveBridge(2) });
    const withHook = withCredentials({ connections: ["eikona-a", "eikona-b"], world: world(), driveBridge: fakeDriveBridge(2) });
    for (const target of [without, withHook]) (target.config.connections![0] as { credential_expires_at?: string }).credential_expires_at = inDays(3);
    const plain = await without.loop.runCycle();
    const hooked = await withHook.loop.runCycle();
    // The hook found something to say, and it cost nothing.
    expect(withHook.credentialRows().length).toBeGreaterThanOrEqual(2);
    expect(hooked.calls).toBe(plain.calls);
    expect(withHook.owners.requests().length).toBe(without.owners.requests().length);
    expect(withHook.owners.requests().length).toBeGreaterThan(0);
  });
});

describe("credential reminders: not knowing is not recovery", () => {
  afterEach(() => vi.useRealTimers());

  type Mode = "unauthorized" | "ok" | "unavailable" | "limited" | "unreachable";
  /** DriveBridge whose credentialed routes answer as `mode` says; its open health route always answers. */
  function switchable(initial: Mode) {
    const mode = { current: initial };
    const base = fakeDriveBridge(0);
    const fetcher = (async (input: unknown, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith("/healthz")) return base.fetcher(input as never, init);
      if (mode.current === "unreachable") throw new TypeError("fetch failed");
      if (mode.current === "unauthorized") return new Response("no", { status: 401 });
      if (mode.current === "unavailable") return new Response("down", { status: 503 });
      if (mode.current === "limited") return new Response("slow down", { status: 429 });
      return base.fetcher(input as never, init);
    }) as unknown as typeof fetch;
    return { ...base, fetcher, mode };
  }

  /** The loop reads a tool through the service's own clock, so that moves with the loop's. */
  function clocked<T extends { clock: { now: number } }>(s: T) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(s.clock.now);
    return { ...s, step: (ms: number) => { s.clock.now += ms; vi.setSystemTime(s.clock.now); } };
  }

  /** The same ledger and owners with nothing remembered: what a restart of the process leaves. */
  function restarted(first: ReturnType<typeof setup>, driveBridge?: ReturnType<typeof fakeDriveBridge>) {
    const openTools = new OpenToolService(first.config, driveBridge?.fetcher);
    const { services } = createControlCenter(first.config, { db: first.db, clock: () => first.clock.now, openTools, tasks: new TaskConnections(first.config, first.owners.fetcher, randomBytes(32)) });
    const loop = createObservationLoop(services, { log: () => undefined, random: () => 0, timers: first.timers, credentials: credentialReminders(services) });
    return { services, loop, openTools };
  }

  const drive = (services: Parameters<typeof rows>[0]) => rows(services, owner).filter((reminder) => reminder.category === "credential" && reminder.owner === "drivebridge");

  describe.each([
    ["acknowledged", (services: Parameters<typeof rows>[0], id: string) => services.notifications.acknowledge(id, "scope-a", "", owner), { state: "acknowledged" }],
    ["snoozed", (services: Parameters<typeof rows>[0], id: string) => services.notifications.snooze(id, "scope-a", "", owner, new Date(T0 + 24 * hour).toISOString()), { state: "unread", snoozed_until: new Date(T0 + 24 * hour).toISOString() }],
  ] as const)("a refused open-tool credential whose reminder was %s", (_name, handle, kept) => {
    it("stays refused through readings that get no answer, and the person's choice survives each of them", async () => {
      const bridge = switchable("unauthorized");
      const s = clocked(withCredentials({ world: { "eikona-a": {} }, driveBridge: bridge, observation: { open_tools_every: 1 } }));
      expect((await s.loop.runCycle()).reminders_opened).toBe(1);
      const [opened] = drive(s.services);
      expect(opened).toMatchObject({ task_state: "rejected", last_error_code: "unauthenticated", state: "unread", recovered_at: null });
      handle(s.services, opened.id);
      const unreadWhileHandled = s.services.notifications.unreadCount("scope-a", "", owner);
      // The tool is down, slow, or not reachable: each is a reading that says nothing about the token.
      for (const mode of ["unavailable", "limited", "unreachable"] as const) {
        bridge.mode.current = mode;
        s.step(11 * minute);
        const summary = await s.loop.runCycle();
        expect(summary).toMatchObject({ open_tools_read: true, reminders_opened: 0, reminders_recovered: 0 });
        expect(drive(s.services)).toHaveLength(1);
        expect(drive(s.services)[0]).toMatchObject({ id: opened.id, recovered_at: null, first_seen_at: opened.first_seen_at, ...kept });
        expect(s.services.notifications.unreadCount("scope-a", "", owner)).toBe(unreadWhileHandled);
      }
      // The refusal comes back: the same incident, still as the person left it, not a new unread reminder.
      bridge.mode.current = "unauthorized";
      s.step(11 * minute);
      expect(await s.loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 0 });
      expect(drive(s.services)[0]).toMatchObject({ id: opened.id, recovered_at: null, first_seen_at: opened.first_seen_at, ...kept });
      // An answer that accepts the token is what ends it, and a later refusal is then a new incident.
      bridge.mode.current = "ok";
      s.step(11 * minute);
      expect(await s.loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 1 });
      expect(drive(s.services)[0].recovered_at).toBe(new Date(s.clock.now).toISOString());
      bridge.mode.current = "unauthorized";
      s.step(11 * minute);
      expect(await s.loop.runCycle()).toMatchObject({ reminders_opened: 1, reminders_recovered: 0 });
      expect(drive(s.services)[0]).toMatchObject({ id: opened.id, state: "unread", acknowledged_at: null, snoozed_until: null, recovered_at: null, first_seen_at: new Date(s.clock.now).toISOString() });
    });
  });

  it("does not let a reading that got no answer change what the Services card shows", async () => {
    const bridge = switchable("unauthorized");
    const s = clocked(setup({ world: { "eikona-a": {} }, driveBridge: bridge }));
    await s.openTools.observe("drivebridge");
    bridge.mode.current = "unavailable";
    s.step(11 * minute);
    const shown = await s.openTools.observe("drivebridge");
    // What people see is the latest reading, with the last good runs kept on screen, as before.
    expect(shown?.observation.projection).toMatchObject({ state: "unavailable", freshness: "stale" });
    expect(shown?.observation.projection.checks.map((check) => check.state)).not.toContain("forbidden");
    // What the credential is judged by is the last reading that answered.
    expect(s.openTools.credentialProjection("drivebridge")?.checks.map((check) => check.reason)).toContain("open_tool_unauthenticated");
  });

  it("keeps the reminder when the first reading after a restart gets no answer, and ends it on one that does", async () => {
    const bridge = switchable("unauthorized");
    const first = clocked(withCredentials({ world: { "eikona-a": {} }, driveBridge: bridge, observation: { open_tools_every: 1 } }));
    await first.loop.runCycle();
    const [opened] = drive(first.services);
    first.services.notifications.acknowledge(opened.id, "scope-a", "", owner);
    const after = switchable("unavailable");
    const second = restarted(first, after);
    expect(second.openTools.credentialProjection("drivebridge")).toBeNull();
    first.step(11 * minute);
    expect(await second.loop.runCycle()).toMatchObject({ open_tools_read: true, reminders_opened: 0, reminders_recovered: 0 });
    expect(drive(second.services)[0]).toMatchObject({ id: opened.id, state: "acknowledged", recovered_at: null });
    after.mode.current = "ok";
    first.step(11 * minute);
    expect(await second.loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 1 });
    expect(drive(second.services)[0].recovered_at).not.toBeNull();
  });

  describe("connections after a restart", () => {
    /** More connections than one cycle's budget reads, every one of them refused by its owner. */
    const ids = Array.from({ length: 12 }, (_, index) => `eikona-${String(index).padStart(2, "0")}`);
    const refusing = () => Object.fromEntries(ids.map((id) => [id, { status: 401 }])) as Record<string, { status?: number }>;
    const all = (services: Parameters<typeof rows>[0]) => rows(services, owner).filter((reminder) => reminder.category === "credential");

    async function refusedAndAcknowledged() {
      const world = refusing();
      const first = clocked(withCredentials({ connections: ids, world }));
      for (let attempt = 0; attempt < 5 && all(first.services).length < ids.length; attempt += 1) {
        await first.loop.runCycle();
        first.step(3 * hour);
      }
      expect(all(first.services)).toHaveLength(ids.length);
      for (const reminder of all(first.services)) first.services.notifications.acknowledge(reminder.id, "scope-a", "", owner);
      return { first, world };
    }

    it("keeps the reminders of the connections the first cycle has not read yet, with what the person did with them", async () => {
      const { first, world } = await refusedAndAcknowledged();
      const second = restarted(first);
      expect(second.services.tasks.cached(first.scope)).toEqual([]);
      const opened = all(second.services).map((reminder) => reminder.id).sort();
      // The first cycle reads what its budget allows; the rest is not known yet.
      const cycle = await second.loop.runCycle();
      const read = second.services.tasks.cached(first.scope).map((state) => state.id);
      expect(read.length).toBeGreaterThan(0);
      expect(read.length).toBeLessThan(ids.length);
      expect(cycle).toMatchObject({ reminders_opened: 0, reminders_recovered: 0 });
      expect(all(second.services).map((reminder) => reminder.id).sort()).toEqual(opened);
      expect(all(second.services).every((reminder) => reminder.recovered_at === null && reminder.state === "acknowledged")).toBe(true);
      // One of the connections not read yet turns out to be fine; only its reminder ends, on that evidence.
      const unread = ids.filter((id) => !read.includes(id));
      world[unread[0]] = {};
      first.step(3 * hour);
      const next = await second.loop.runCycle();
      expect(next).toMatchObject({ reminders_opened: 0, reminders_recovered: 1 });
      const ended = all(second.services).filter((reminder) => reminder.recovered_at !== null);
      expect(ended.map((reminder) => reminder.failure_fingerprint)).toEqual([`credential:connection:${unread[0]}:rejected:-`]);
      expect(all(second.services).filter((reminder) => reminder.recovered_at === null).every((reminder) => reminder.state === "acknowledged")).toBe(true);
    });

    it("keeps a refused connection's reminder while its reads since the restart get no answer", async () => {
      const world = { "eikona-a": { status: 401 } } as Record<string, { status?: number }>;
      const first = clocked(withCredentials({ world }));
      await first.loop.runCycle();
      const [reminder] = all(first.services);
      first.services.notifications.acknowledge(reminder.id, "scope-a", "", owner);
      // After the restart the owner is down: the connection has been read, and nothing was learned about its credential.
      world["eikona-a"] = { status: 503 };
      const second = restarted(first);
      first.step(3 * hour);
      expect(await second.loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 0 });
      expect(second.services.tasks.cached(first.scope)).toHaveLength(1);
      expect(all(second.services)[0]).toMatchObject({ id: reminder.id, state: "acknowledged", recovered_at: null });
      // Then the owner answers and takes the credential.
      world["eikona-a"] = {};
      first.step(3 * hour);
      expect(await second.loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 1 });
    });
  });
});

describe("credential reminders: a limited credential is shown on the Services panel and reminded of nowhere", () => {
  /** DriveBridge that accepts the token and answers the capabilities, but refuses its operations list with a 403: the credential works, one read was not granted. */
  function partlyRefusing() {
    const base = fakeDriveBridge(0);
    const fetcher = (async (input: unknown, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith("/operations")) return new Response("no", { status: 403 });
      return base.fetcher(input as never, init);
    }) as unknown as typeof fetch;
    return { ...base, fetcher };
  }
  const drive = (rowsOf: ReturnType<typeof rows>) => rowsOf.filter((reminder) => reminder.category === "credential" && reminder.owner === "drivebridge");
  /** How many credential reminders the reminders page and the bell count as unread. */
  const unread = (s: ReturnType<typeof withCredentials>) => rows(s.services, owner).filter((reminder) => reminder.category === "credential" && countsAsUnread(reminder, s.clock.now)).length;
  /** The credential rows the Services page is given, from what the control center already knows. */
  const panel = (s: ReturnType<typeof withCredentials>) => credentialStatuses(s.config, s.scope, { connections: s.services.tasks.cached(s.scope), scopeConnections: s.services.tasks.connections(s.scope), openTools: s.services.openTools.credentialProjections(s.scope), now: s.clock.now });

  it("opens no reminder for it, though the panel still lists the credential as limited", async () => {
    const s = withCredentials({ world: { "eikona-a": {} }, driveBridge: partlyRefusing(), observation: { open_tools_every: 1 } });
    const summary = await s.loop.runCycle();
    expect(summary.open_tools_read).toBe(true);
    expect(panel(s).find((row) => row.id === "open_tool:drivebridge")).toMatchObject({ state: "limited", reason: "read_forbidden" });
    expect(summary.reminders_opened).toBe(0);
    expect(drive(rows(s.services, owner))).toEqual([]);
    expect(unread(s)).toBe(0);
  });

  it("ends the reminder an earlier version opened for it at the next cycle, whatever the person had done with it, and does not open it again", async () => {
    const s = withCredentials({ world: { "eikona-a": {} }, driveBridge: partlyRefusing(), observation: { open_tools_every: 1 } });
    const opened = s.services.notifications.openEvent({
      scope: "scope-a", recipient: owner, event: "credential:open_tool:drivebridge:limited:-", category: "credential", title: "DriveBridge · 部分读取被拒",
      path: "/services", owner: "drivebridge", errorCode: "read_forbidden", taskState: "limited", sessionId: "background", recurs: true, now: iso(T0 - hour),
    });
    expect(opened.created).toBe(true);
    expect(unread(s)).toBe(1);
    const snoozed = s.services.notifications.openEvent({
      scope: "scope-a", recipient: owner, event: "credential:connection:eikona-a:limited:-", category: "credential", title: "eikona-a · 部分读取被拒",
      path: "/services", owner: "eikona", errorCode: "content_denied", taskState: "limited", sessionId: "background", recurs: true, now: iso(T0 - hour),
    });
    s.services.notifications.acknowledge(snoozed.id, "scope-a", "", owner);
    // The connection `eikona-a` is not read in this cycle's open tool step, and nothing has said anything about its credential: it was held before.
    expect(await s.loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 2 });
    const credential = rows(s.services, owner).filter((reminder) => reminder.category === "credential");
    expect(credential.map((reminder) => [reminder.failure_fingerprint, reminder.recovered_at])).toEqual(expect.arrayContaining([
      ["credential:open_tool:drivebridge:limited:-", iso(T0)], ["credential:connection:eikona-a:limited:-", iso(T0)],
    ]));
    expect(credential.every((reminder) => reminder.recovered_at === iso(T0))).toBe(true);
    expect(unread(s)).toBe(0);
    // The credential is still limited, and later cycles leave the ended reminders as they are.
    expect(panel(s).find((row) => row.id === "open_tool:drivebridge")?.state).toBe("limited");
    s.clock.now += 11 * minute;
    expect(await s.loop.runCycle()).toMatchObject({ reminders_opened: 0, reminders_recovered: 0 });
    expect(rows(s.services, owner).filter((reminder) => reminder.category === "credential" && reminder.recovered_at === null)).toEqual([]);
  });

  it("does not hold a limited key for a slot it has no reading of, though it holds the keys a refusal or an unreadable file would have", () => {
    const keys = credentialUnknown([status({ id: "connection:a", state: "limited" }), status({ id: "open_tool:gateway", state: "limited" }), status({ id: "connection:b", state: "ok" })], [], []);
    expect(keys.filter((key) => key.includes(":limited:"))).toEqual([]);
    expect(keys.sort()).toEqual([
      "credential:connection:a:rejected:-", "credential:connection:a:unreadable:-", "credential:connection:b:rejected:-", "credential:connection:b:unreadable:-",
      "credential:open_tool:gateway:rejected:-", "credential:open_tool:gateway:unreadable:-",
    ]);
  });
});
