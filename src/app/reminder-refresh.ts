/**
 * The periodic re-read of the first page of reminders. It reads the control center's own ledger only (the database;
 * no owner is asked), so it can run every minute: the background loop writes reminders there whether or not a page is
 * open, and a page that never re-read would not see them until something else made it sync.
 */

export const refreshEveryMs = 60_000;

/** The page's clock and its comings and goings, so the schedule can be tested without a browser. */
export interface RefreshEnv {
  /** The page is in view. */
  visible(): boolean;
  /** Calls back when the page comes into view or its window gains focus; returns what stops listening. */
  onWake(callback: () => void): () => void;
  /** Calls back every `ms` until the returned function is called. */
  every(callback: () => void, ms: number): () => void;
}

/**
 * Re-reads every `every` ms while the page is in view, and also while it is not when `whileHidden` says so (desktop
 * notifications need a page that is out of sight to keep looking). Coming into view or gaining focus re-reads at once and
 * starts the minute again. A read that is still running is not started a second time. Returns the function that stops it.
 */
export function startRefresh(options: {
  refresh: () => Promise<unknown> | void;
  env: RefreshEnv;
  every?: number;
  whileHidden?: () => boolean;
}): () => void {
  const every = options.every ?? refreshEveryMs;
  let reading = false;
  let stopped = false;
  const read = () => {
    if (reading || stopped) return;
    reading = true;
    let result: Promise<unknown> | void = undefined;
    try { result = options.refresh(); } catch { /* a failed read is tried again at the next tick */ }
    Promise.resolve(result).catch(() => undefined).finally(() => { reading = false; });
  };
  const tick = () => { if (options.env.visible() || options.whileHidden?.()) read(); };
  let cancel = options.env.every(tick, every);
  const stopListening = options.env.onWake(() => {
    read();
    cancel();
    cancel = options.env.every(tick, every);
  });
  return () => {
    stopped = true;
    cancel();
    stopListening();
  };
}

/** The browser's page clock as a `RefreshEnv`. */
export function browserRefreshEnv(doc: Document = document, win: Window = window): RefreshEnv {
  return {
    visible: () => doc.visibilityState === "visible",
    onWake: (callback) => {
      const wake = () => { if (doc.visibilityState === "visible") callback(); };
      doc.addEventListener("visibilitychange", wake);
      win.addEventListener("focus", wake);
      return () => {
        doc.removeEventListener("visibilitychange", wake);
        win.removeEventListener("focus", wake);
      };
    },
    every: (callback, ms) => {
      const handle = win.setInterval(callback, ms);
      return () => win.clearInterval(handle);
    },
  };
}

/**
 * Counts the changes made to the reminders here (an action starting or finishing, a page applied, a sync), so a read that
 * began before a change can be told from one that began after it. A read that began before one may carry the state from
 * before it, and must not put an old row back.
 */
export class ChangeClock {
  private count = 0;
  /** A change is starting or has been made: every read that began before this is out of date. */
  bump() { this.count += 1; }
  /** Marks the start of a read. */
  mark() { return this.count; }
  /** Whether nothing was changed since the mark. */
  holds(mark: number) { return mark === this.count; }
}

/** Runs `read`, and hands what it returned to `use` only if no change was made while it ran. Says whether `use` was called. */
export async function readUnlessChanged<T>(clock: ChangeClock, read: () => Promise<T>, use: (value: T) => void): Promise<boolean> {
  const mark = clock.mark();
  const value = await read();
  if (!clock.holds(mark)) return false;
  use(value);
  return true;
}

/**
 * The page after a re-read of the first page. A person who pressed "加载更多" holds rows past the first page; a re-read
 * must not drop them, so then the fresh first page replaces its own rows and the rest stay. Without that, the rows are
 * the fresh page and nothing else.
 */
export function mergeFirstPage<T extends { id: string }>(current: readonly T[], first: readonly T[], extended: boolean): T[] {
  if (!extended) return [...first];
  const fresh = new Set(first.map((row) => row.id));
  return [...first, ...current.filter((row) => !fresh.has(row.id))];
}

/** The earliest time after `now` at which a snooze in these rows ends, or null: the page re-reads then so the badge follows. */
export function nextSnoozeEnd(rows: readonly { snoozed_until?: string | null }[], now: number): number | null {
  let earliest: number | null = null;
  for (const row of rows) {
    const end = row.snoozed_until ? Date.parse(row.snoozed_until) : NaN;
    if (Number.isFinite(end) && end > now && (earliest === null || end < earliest)) earliest = end;
  }
  return earliest;
}

/** The longest delay a timer takes (about 24.8 days; a snooze may run to 30). */
export const maxTimerMs = 2 ** 31 - 1;
/** How long after a snooze ends the clock moves on, so the end has certainly passed when it does. */
export const snoozeGraceMs = 1000;

/**
 * Calls `tick` once the next snooze in `rows` has ended. The server never clears a snooze, so after it ends the rows are
 * the same as before and nothing re-renders by itself: `tick` is what moves the page's idea of "now" on (the groups and the
 * badge are worked out against it) and re-reads the counts. The caller schedules again once the clock has moved, and that
 * is what picks the following snooze. A snooze further off than a timer can wait is waited for in steps: the tick at the end
 * of a step finds it still running and aims again. Returns what cancels it; nothing is scheduled when no snooze is running.
 */
export function scheduleSnoozeEnd(options: {
  rows: readonly { snoozed_until?: string | null }[];
  now: number;
  tick: () => void;
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}): () => void {
  const end = nextSnoozeEnd(options.rows, options.now);
  if (end === null) return () => undefined;
  const handle = options.set(options.tick, Math.min(end - options.now + snoozeGraceMs, maxTimerMs));
  return () => options.clear(handle);
}
