import { countsAsUnread, reminderKind, reminderKindLabels } from "../notifications";

/**
 * Desktop notifications for reminders, as a plan: given the reminders the page holds, what the browser should show now
 * and what to remember. Nothing here touches the DOM or storage, so every rule can be tested on its own.
 *
 * The rules, in the order they apply:
 * - Only a reminder that became unread after the switch was turned on may notify. What was unread then, and everything
 *   unread that the page showed while it was in view, is the baseline; a reminder leaves the baseline when it stops being
 *   unread, so one that is acknowledged and later reopened is new again.
 * - Nothing is shown while the page is in view and has focus: the person is looking at it.
 * - A reminder notifies once. It notifies once more when a snooze on it ends, because the snooze end is a new time it
 *   became unread, and once more when a condition that ended comes back (a credential problem that recurs is the same
 *   reminder, reopened with a new first-seen time), because that is a new incident.
 * - At most three notifications per plan; the rest of that batch become one summary.
 * - A notification carries the tool or owner name, the kind of reminder and counts. Never a task title, a prompt or any
 *   text an owner wrote.
 */

/** What the plan reads of a reminder: no title, no task key, nothing an owner wrote. */
export interface PlannedReminder {
  id: string;
  state: string;
  owner: string;
  category?: string;
  read_at?: string | null;
  snoozed_until?: string | null;
  recovered_at?: string | null;
  first_seen_at?: string;
}

export interface DesktopNotice {
  title: string;
  body: string;
  /** One reminder's id, so a repeat replaces it; the summary has its own. */
  tag: string;
  /** The in-app route to open when it is clicked. */
  path: string;
}

export interface DesktopPlan {
  notices: DesktopNotice[];
  /** Reminder ids to leave alone until they stop being unread. */
  baseline: string[];
  /** Reminder id → the incident and snooze it was notified under (`noticeMarker`). */
  notified: Record<string, string>;
}

/** Individual notifications per plan; a bigger batch adds one summary for the rest. */
export const maxIndividualNotices = 3;
/** The most notified ids kept per account; the oldest are forgotten first. */
export const maxRememberedNotified = 300;
export const summaryTag = "reminders-summary";
export const noticeTitle = "控制中心提醒";

/**
 * What a reminder was notified under: when it first appeared, and the snooze it had. A snooze that ends, and a condition
 * that came back after it ended (the ledger reopens the same reminder with a new first-seen time), change it, so each is
 * notified once more; an explicit reopen of the same reminder does not.
 */
export const noticeMarker = (reminder: Pick<PlannedReminder, "first_seen_at" | "snoozed_until">) => `${reminder.first_seen_at ?? ""}|${reminder.snoozed_until ?? ""}`;

/** Keeps `notified` within the limit: ids that are no longer unread go first, oldest first, then the oldest of the rest. */
function trimNotified(notified: Record<string, string>, unreadIds: ReadonlySet<string>) {
  const keys = Object.keys(notified);
  const excess = keys.length - maxRememberedNotified;
  if (excess <= 0) return notified;
  const forgotten = [...keys.filter((id) => !unreadIds.has(id)), ...keys.filter((id) => unreadIds.has(id))].slice(0, excess);
  const kept = { ...notified };
  for (const id of forgotten) delete kept[id];
  return kept;
}

export function planDesktopNotifications(input: {
  rows: readonly PlannedReminder[];
  /** Every unread reminder the server counts, for the notification's body. */
  unread: number;
  now: number;
  /** The page is hidden or its window has no focus. */
  away: boolean;
  /** Null: this scope has not been seen since the switch was turned on, so what is unread now is the baseline. */
  baseline: readonly string[] | null;
  notified: Readonly<Record<string, string>>;
  /** A tool or owner id as a name; the default shows the id. */
  label?: (owner: string) => string;
}): DesktopPlan {
  const unreadRows = input.rows.filter((reminder) => countsAsUnread(reminder, input.now));
  const unreadIds = new Set(unreadRows.map((reminder) => reminder.id));
  if (input.baseline === null) return { notices: [], baseline: [...unreadIds], notified: { ...input.notified } };
  const baseline = new Set(input.baseline.filter((id) => unreadIds.has(id)));
  const fresh = unreadRows
    .filter((reminder) => !baseline.has(reminder.id) && input.notified[reminder.id] !== noticeMarker(reminder))
    .sort((a, b) => (b.first_seen_at ?? "").localeCompare(a.first_seen_at ?? "") || a.id.localeCompare(b.id));
  if (!input.away) {
    // Everything unread that the page showed counts as seen, what was notified before included: none of it notifies
    // later, when the person has gone, whatever has been trimmed from the memory of what was notified since.
    for (const reminder of unreadRows) baseline.add(reminder.id);
    return { notices: [], baseline: [...baseline], notified: trimNotified({ ...input.notified }, unreadIds) };
  }
  const label = input.label ?? ((owner: string) => owner);
  const notices: DesktopNotice[] = fresh.slice(0, maxIndividualNotices).map((reminder) => ({
    title: noticeTitle,
    body: `${label(reminder.owner)} · ${reminderKindLabels[reminderKind(reminder)]}，共 ${input.unread} 条未读`,
    tag: reminder.id,
    path: `/reminders?focus=${encodeURIComponent(reminder.id)}`,
  }));
  const rest = fresh.slice(maxIndividualNotices);
  if (rest.length) {
    const names = [...new Set(rest.map((reminder) => label(reminder.owner)))];
    notices.push({
      title: noticeTitle,
      body: `另有 ${rest.length} 条新提醒（${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}），共 ${input.unread} 条未读`,
      tag: summaryTag,
      path: "/reminders",
    });
  }
  const notified = { ...input.notified };
  for (const reminder of fresh) {
    // Re-adding moves it to the end, so the entries forgotten first are the ones notified longest ago.
    delete notified[reminder.id];
    notified[reminder.id] = noticeMarker(reminder);
  }
  return { notices, baseline: [...baseline], notified: trimNotified(notified, unreadIds) };
}

/** Why the switch cannot be turned on, in words for the person at the page. */
export type DesktopUnavailable = "unsupported" | "insecure" | "denied";
export type DesktopSupport = { state: "available" | "granted" } | { state: "unavailable"; reason: DesktopUnavailable; message: string };

export const desktopUnavailableMessages: Record<DesktopUnavailable, string> = {
  unsupported: "这个浏览器不支持桌面通知。",
  insecure: "桌面通知要求页面用 HTTPS（本机 localhost 也可以）打开；现在是普通 http，浏览器不会弹出通知。",
  denied: "浏览器已禁止这个网站发通知。到地址栏的网站设置里改成允许，才能打开。",
};

/** What the browser allows, from facts the caller reads: the API exists, the page is a secure context, the permission. */
export function desktopSupport(env: { hasApi: boolean; secure: boolean; permission?: string }): DesktopSupport {
  const unavailable = (reason: DesktopUnavailable): DesktopSupport => ({ state: "unavailable", reason, message: desktopUnavailableMessages[reason] });
  if (!env.hasApi) return unavailable("unsupported");
  if (!env.secure) return unavailable("insecure");
  if (env.permission === "denied") return unavailable("denied");
  return { state: env.permission === "granted" ? "granted" : "available" };
}

/** What is kept for one account between page loads. The notified ids belong to the account, the baselines to a scope. */
export interface StoredDesktop {
  v: 1;
  on: boolean;
  notified: Record<string, string>;
  baselines: Record<string, string[]>;
}

export const emptyDesktop = (): StoredDesktop => ({ v: 1, on: false, notified: {}, baselines: {} });
export const desktopStorageKey = (account: string) => `yeisme.control.desktop-notifications:${account}`;

/** Reads the stored state back, tolerating anything: storage can hold an older shape, or whatever another script wrote. */
export function parseDesktop(raw: string | null): StoredDesktop {
  if (!raw) return emptyDesktop();
  try {
    const value = JSON.parse(raw) as Partial<StoredDesktop> | null;
    if (!value || typeof value !== "object" || value.v !== 1) return emptyDesktop();
    const notified: Record<string, string> = {};
    for (const [id, snooze] of Object.entries(value.notified && typeof value.notified === "object" ? value.notified : {})) if (typeof snooze === "string") notified[id] = snooze;
    const baselines: Record<string, string[]> = {};
    for (const [scope, ids] of Object.entries(value.baselines && typeof value.baselines === "object" ? value.baselines : {})) if (Array.isArray(ids)) baselines[scope] = ids.filter((id): id is string => typeof id === "string");
    return { v: 1, on: value.on === true, notified, baselines };
  } catch {
    return emptyDesktop();
  }
}

/**
 * One pass of a page's desktop notifications over what is stored for the account. The switch lives in the stored state,
 * which every tab of the account shares, so a tab that has not heard of the switch being turned off in another one finds
 * it off here and does nothing: null, with nothing to write and nothing to show. Otherwise the plan for the scope, and the
 * stored state with the plan's baseline and notified ids in it. `rebase` treats the scope as first seen: what is unread
 * now becomes the baseline and nothing is shown (for a permission that came back on its own).
 */
export function stepDesktop(input: {
  stored: StoredDesktop;
  scope: string;
  rows: readonly PlannedReminder[];
  unread: number;
  now: number;
  away: boolean;
  rebase?: boolean;
  label?: (owner: string) => string;
}): { stored: StoredDesktop; notices: DesktopNotice[] } | null {
  if (!input.stored.on) return null;
  const plan = planDesktopNotifications({
    rows: input.rows, unread: input.unread, now: input.now, away: input.away, label: input.label,
    baseline: input.rebase ? null : input.stored.baselines[input.scope] ?? null,
    notified: input.stored.notified,
  });
  return { stored: { ...input.stored, notified: plan.notified, baselines: { ...input.stored.baselines, [input.scope]: plan.baseline } }, notices: plan.notices };
}

/** Whether a `storage` event from another tab concerns this account's desktop notification state (a null key: storage was cleared). */
export const affectsDesktop = (key: string | null, account: string) => key === null || key === desktopStorageKey(account);

export function readDesktop(storage: Pick<Storage, "getItem"> | undefined, account: string): StoredDesktop {
  try { return parseDesktop(storage?.getItem(desktopStorageKey(account)) ?? null); } catch { return emptyDesktop(); }
}

export function writeDesktop(storage: Pick<Storage, "setItem"> | undefined, account: string, state: StoredDesktop) {
  // A full or blocked storage costs the memory of what was notified, nothing more.
  try { storage?.setItem(desktopStorageKey(account), JSON.stringify(state)); } catch { /* not remembered */ }
}
