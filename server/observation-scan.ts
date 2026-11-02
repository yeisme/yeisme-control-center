/**
 * The rolling read of one connection's task lists.
 *
 * An owner pages its lists in an order the control center does not choose (Scaena keys runs by an id with no time in it
 * and keeps failed runs only in `history`), and there is no "updated after" filter in `control_center.tasks.list`. So
 * the first page of a list can not be trusted to hold what failed. Besides page 1 of both lists, which every cycle
 * reads, each connection has one rolling position that walks its history list and then its active list, a few pages per
 * cycle, continuing where the last cycle stopped and starting over after the end of the active list.
 *
 * The walk has its own failure handling, apart from the connection's. A page beyond the first that can not be read
 * keeps its cursor and is tried again in the next cycle; after `walkPageAttempts` failures in a row the walk gives
 * that page up, goes on after it when the owner named a continuation (and otherwise treats the rest of that list as out
 * of reach), and counts it, so one bad page can neither stall the walk for ever nor slow the connection's first pages.
 */
export type ListMode = "active" | "history";

export interface RollingPosition {
  /** The list the next rolling page comes from. */
  mode: ListMode;
  /** The owner's own cursor for that page; undefined while the position is at the start of the list. */
  cursor: string | undefined;
  /** Passes over history and then active that reached the end without giving a page up, since the process started. */
  passes: number;
  /** Failed reads of the page at `cursor` in a row. */
  failures: number;
  /** Pages given up in the pass under way: such a pass does not count as complete. */
  skipped: number;
}

/** What a cycle learned from page 1 of one list: whether it could be read, and the owner's cursor for page 2. */
export interface FirstPage {
  ok: boolean;
  next?: string;
}

export type FirstPages = Record<ListMode, FirstPage | undefined>;

export const startOfScan = (): RollingPosition => ({ mode: "history", cursor: undefined, passes: 0, failures: 0, skipped: 0 });

/** The end of the active list: a pass is over, and the next one starts at history. Only a pass that gave up no page counts. */
function finishPass(position: RollingPosition): void {
  if (position.skipped === 0) position.passes += 1;
  position.skipped = 0;
  position.mode = "history";
  position.cursor = undefined;
  position.failures = 0;
}

/**
 * Page 1 of both lists is read in every cycle, so while the position is at the start of a list that page is already in
 * hand and the walk continues after it. Returns true when this ended a pass (the active list ended too), after which
 * the connection is done for the cycle: the next cycle starts again at page 2 of history.
 */
export function settle(position: RollingPosition, first: FirstPages): boolean {
  while (position.cursor === undefined) {
    const page = first[position.mode];
    if (!page?.ok) return false;
    if (page.next) {
      position.cursor = page.next;
      return false;
    }
    if (position.mode === "history") {
      position.mode = "active";
      continue;
    }
    finishPass(position);
    return true;
  }
  return false;
}

/** Moves on after a rolling page was read: to the owner's next page, or past the end of the list. True when a pass ended. */
export function advance(position: RollingPosition, next: string | undefined, first: FirstPages): boolean {
  position.failures = 0;
  if (next) {
    position.cursor = next;
    return false;
  }
  position.cursor = undefined;
  if (position.mode === "history") {
    position.mode = "active";
    return settle(position, first);
  }
  finishPass(position);
  return true;
}

/**
 * The page at the cursor could not be read. The cursor stays, so the same page is tried again next cycle, until
 * `attempts` failures in a row: then the page is given up. `after` is the owner's continuation when its answer
 * arrived and named one (a page it sent but that held a row the control center refuses); without it nothing past the
 * page can be reached, so the rest of the list is given up with it.
 */
export function failed(position: RollingPosition, after: string | undefined, first: FirstPages, attempts: number): { skipped: boolean; ended: boolean } {
  position.failures += 1;
  if (position.failures < attempts) return { skipped: false, ended: false };
  position.skipped += 1;
  return { skipped: true, ended: advance(position, after, first) };
}

/** A failed first page forgets the cursor, which may be stale or unusable; the list is walked again from its start. */
export function restart(position: RollingPosition): void {
  position.cursor = undefined;
  position.failures = 0;
}
