import { describe, expect, it, vi } from "vitest";
import { browserRefreshEnv, ChangeClock, maxTimerMs, mergeFirstPage, nextSnoozeEnd, readUnlessChanged, refreshEveryMs, scheduleSnoozeEnd, snoozeGraceMs, startRefresh, type RefreshEnv } from "../src/app/reminder-refresh";

/** Lets a finished read release its guard. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A page clock the test drives by hand. */
function fakeEnv(visible = true) {
  const state = { visible, wake: [] as (() => void)[], timers: [] as { callback: () => void; ms: number; cancelled: boolean }[] };
  const env: RefreshEnv = {
    visible: () => state.visible,
    onWake: (callback) => { state.wake.push(callback); return () => { state.wake = state.wake.filter((entry) => entry !== callback); }; },
    every: (callback, ms) => { const timer = { callback, ms, cancelled: false }; state.timers.push(timer); return () => { timer.cancelled = true; }; },
  };
  const live = () => state.timers.filter((timer) => !timer.cancelled);
  return { env, state, live, tick: () => { for (const timer of live()) timer.callback(); }, wake: () => state.wake.forEach((callback) => callback()) };
}

describe("the minute re-read of reminders", () => {
  it("reads every minute while the page is in view", async () => {
    const page = fakeEnv();
    const refresh = vi.fn(async () => undefined);
    const stop = startRefresh({ refresh, env: page.env });
    expect(refreshEveryMs).toBe(60_000);
    expect(page.live().map((timer) => timer.ms)).toEqual([60_000]);
    expect(refresh).not.toHaveBeenCalled();
    page.tick();
    await settle();
    page.tick();
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("waits while the page is out of view, unless something needs it to keep looking, and reads at once when it comes back", async () => {
    const page = fakeEnv(false);
    let keepLooking = false;
    const refresh = vi.fn(async () => undefined);
    const stop = startRefresh({ refresh, env: page.env, whileHidden: () => keepLooking });
    page.tick();
    expect(refresh).not.toHaveBeenCalled();
    // Desktop notifications on: a hidden page still looks, because that is when they are for.
    keepLooking = true;
    page.tick();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    keepLooking = false;
    // The person comes back: read now, and the next minute counts from now.
    page.state.visible = true;
    const timersBefore = page.state.timers.length;
    page.wake();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(page.state.timers.length).toBe(timersBefore + 1);
    expect(page.live()).toHaveLength(1);
    stop();
  });

  it("does not start a read while the last one is still running, and starts again once it ends", async () => {
    const page = fakeEnv();
    let finish: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = startRefresh({ refresh, env: page.env });
    page.tick();
    page.tick();
    page.wake();
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await settle();
    page.tick();
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("goes on after a read fails, and stops completely when told to", async () => {
    const page = fakeEnv();
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => { throw new Error("thrown"); })
      .mockResolvedValue(undefined);
    const stop = startRefresh({ refresh, env: page.env });
    for (let attempt = 0; attempt < 3; attempt += 1) { page.tick(); await settle(); }
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    expect(page.live()).toEqual([]);
    expect(page.state.wake).toEqual([]);
    page.wake();
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});

describe("the browser's page clock", () => {
  it("wakes on coming into view or gaining focus, not on going out of view, and lets go of its listeners", () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" }) as unknown as Document;
    const win = Object.assign(new EventTarget(), { setInterval: vi.fn(() => 7), clearInterval: vi.fn() }) as unknown as Window;
    const env = browserRefreshEnv(doc, win);
    const wake = vi.fn();
    const forget = env.onWake(wake);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(wake).not.toHaveBeenCalled();
    (doc as unknown as { visibilityState: string }).visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    expect(wake).toHaveBeenCalledTimes(2);
    expect(env.visible()).toBe(true);
    forget();
    win.dispatchEvent(new Event("focus"));
    expect(wake).toHaveBeenCalledTimes(2);
    const cancel = env.every(() => undefined, 60_000);
    expect(win.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    cancel();
    expect(win.clearInterval).toHaveBeenCalledWith(7);
  });
});

describe("keeping what was loaded beyond the first page", () => {
  const row = (id: string, state = "unread") => ({ id, state });

  it("replaces the rows with the fresh first page when nothing more was loaded", () => {
    expect(mergeFirstPage([row("a"), row("b")], [row("n"), row("a", "archived")], false)).toEqual([row("n"), row("a", "archived")]);
  });

  it("puts the fresh first page ahead of the rows loaded after it, without repeating one", () => {
    const current = [row("a"), row("b"), row("far-1"), row("far-2")];
    const merged = mergeFirstPage(current, [row("n"), row("a", "archived"), row("b")], true);
    expect(merged.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["n:unread", "a:archived", "b:unread", "far-1:unread", "far-2:unread"]);
    expect(mergeFirstPage([], [row("a")], true)).toEqual([row("a")]);
  });
});

describe("when a snooze ends", () => {
  const now = Date.parse("2026-11-02T10:00:00.000Z");
  it("finds the earliest end that is still to come", () => {
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(nextSnoozeEnd([{ snoozed_until: at(3_600_000) }, { snoozed_until: at(60_000) }, { snoozed_until: at(-1000) }, { snoozed_until: null }, {}], now)).toBe(now + 60_000);
    expect(nextSnoozeEnd([{ snoozed_until: at(-1000) }, { snoozed_until: "soon" }], now)).toBeNull();
    expect(nextSnoozeEnd([], now)).toBeNull();
  });
});

describe("when a snooze ends the page's clock moves on, and the next snooze is waited for", () => {
  const now = Date.parse("2026-11-02T10:00:00.000Z");
  const at = (ms: number) => new Date(now + ms).toISOString();
  /** Timers the test fires by hand. */
  const timers = () => {
    const set: { callback: () => void; ms: number; cleared: boolean }[] = [];
    return { set, api: { set: (callback: () => void, ms: number) => { const entry = { callback, ms, cleared: false }; set.push(entry); return entry; }, clear: (handle: unknown) => { (handle as { cleared: boolean }).cleared = true; } } };
  };

  it("waits for the earliest end, a moment past it, and ticks once", () => {
    const clock = timers();
    const tick = vi.fn();
    scheduleSnoozeEnd({ rows: [{ snoozed_until: at(3_600_000) }, { snoozed_until: at(90_000) }], now, tick, ...clock.api });
    expect(clock.set.map((entry) => entry.ms)).toEqual([90_000 + snoozeGraceMs]);
    clock.set[0].callback();
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("schedules the following snooze once the clock has moved past the first, which the rows alone would never show", () => {
    // The rows do not change when a snooze ends: the server leaves the time in place. Only `now` moves.
    const rows = [{ snoozed_until: at(60_000) }, { snoozed_until: at(7_200_000) }];
    const clock = timers();
    let page = now;
    scheduleSnoozeEnd({ rows, now: page, tick: () => { page = now + 60_000 + snoozeGraceMs; }, ...clock.api });
    clock.set[0].callback();
    scheduleSnoozeEnd({ rows, now: page, tick: () => undefined, ...clock.api });
    expect(clock.set.map((entry) => entry.ms)).toEqual([60_000 + snoozeGraceMs, 7_200_000 - 60_000]);
    // With every snooze over there is nothing left to wait for.
    scheduleSnoozeEnd({ rows, now: now + 8_000_000, tick: () => undefined, ...clock.api });
    expect(clock.set).toHaveLength(2);
  });

  it("schedules nothing for no snooze or a snooze in the past, and can be cancelled", () => {
    const clock = timers();
    for (const rows of [[], [{ snoozed_until: null }], [{ snoozed_until: at(-1000) }]]) scheduleSnoozeEnd({ rows, now, tick: () => undefined, ...clock.api });
    expect(clock.set).toEqual([]);
    const cancel = scheduleSnoozeEnd({ rows: [{ snoozed_until: at(1000) }], now, tick: () => undefined, ...clock.api });
    cancel();
    expect(clock.set.map((entry) => entry.cleared)).toEqual([true]);
  });

  it("waits for a snooze further off than a timer can in steps, so a 30-day snooze is not forgotten", () => {
    const clock = timers();
    const month = 30 * 24 * 3_600_000;
    const rows = [{ snoozed_until: at(month) }];
    scheduleSnoozeEnd({ rows, now, tick: () => undefined, ...clock.api });
    expect(clock.set.map((entry) => entry.ms)).toEqual([maxTimerMs]);
    // When the step ends the snooze is still running, and the next step is the rest of the way.
    scheduleSnoozeEnd({ rows, now: now + maxTimerMs, tick: () => undefined, ...clock.api });
    expect(clock.set.map((entry) => entry.ms)).toEqual([maxTimerMs, month - maxTimerMs + snoozeGraceMs]);
  });
});

describe("a read that began before a change", () => {
  const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

  it("is dropped, so it cannot put an old row back; one that began after is used", async () => {
    const clock = new ChangeClock();
    const used: string[] = [];
    const early = deferred<string>();
    const reading = readUnlessChanged(clock, () => early.promise, (value) => used.push(value));
    // An action starts while the read is in flight, and the read answers with the state from before it.
    clock.bump();
    early.resolve("before the action");
    expect(await reading).toBe(false);
    expect(used).toEqual([]);
    expect(await readUnlessChanged(clock, async () => "after the action", (value) => used.push(value))).toBe(true);
    expect(used).toEqual(["after the action"]);
  });

  it("is used when nothing was changed while it ran, and every change in a row drops what was in flight", async () => {
    const clock = new ChangeClock();
    const used: number[] = [];
    expect(await readUnlessChanged(clock, async () => 1, (value) => used.push(value))).toBe(true);
    const slow = deferred<number>();
    const reading = readUnlessChanged(clock, () => slow.promise, (value) => used.push(value));
    clock.bump();
    clock.bump();
    slow.resolve(2);
    expect(await reading).toBe(false);
    expect(used).toEqual([1]);
    expect(clock.holds(clock.mark())).toBe(true);
  });
});
