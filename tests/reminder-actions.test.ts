import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reopenActions, snoozeActions } from "../src/app/reminder-actions";
import { snoozeChoices, snoozeUntil } from "../src/notifications";

describe("choosing a time to be reminded again", () => {
  it("works the end of the snooze out when it is chosen, not when the menu was built", () => {
    // The menu is built late on a Monday evening, and the page is left open.
    let current = new Date(2026, 10, 2, 23, 50);
    const sent: string[] = [];
    const actions = snoozeActions({ state: "unread" }, (until) => sent.push(until), false, () => current);
    expect(actions.map((action) => action.label)).toEqual(["稍后提醒：1 小时后", "稍后提醒：明天上午", "稍后提醒：下周一上午"]);
    // Chosen the next morning: "tomorrow" is the morning after that, and the hour is an hour from then, in the future.
    current = new Date(2026, 10, 3, 8, 0);
    for (const action of actions) action.run();
    expect(sent).toEqual([
      new Date(2026, 10, 3, 9, 0).toISOString(),
      new Date(2026, 10, 4, 9, 0).toISOString(),
      new Date(2026, 10, 9, 9, 0).toISOString(),
    ]);
    expect(sent.every((until) => Date.parse(until) > current.getTime())).toBe(true);
    // Built a moment ago and chosen at once, the times are the ones the choices list shows.
    expect(snoozeChoices(current).map((choice) => choice.until)).toEqual(sent);
  });

  it("sends a time that is still ahead for a menu that was built long before it was used", () => {
    let current = new Date(2026, 10, 2, 9, 0);
    const sent: string[] = [];
    const [hour] = snoozeActions({ state: "unread" }, (until) => sent.push(until), false, () => current);
    // Three hours later the "1 小时后" built at nine would have been in the past, and the server refuses a past time.
    current = new Date(2026, 10, 2, 12, 0);
    hour.run();
    expect(Date.parse(sent[0])).toBe(current.getTime() + 3_600_000);
    expect(snoozeUntil("hour", current)).toBe(sent[0]);
  });

  it("offers a snooze only on an unread reminder that has not recovered, and a reopen only where there is something to reopen", () => {
    expect(snoozeActions({ state: "acknowledged" }, () => undefined)).toEqual([]);
    expect(snoozeActions({ state: "unread", recovered_at: "2026-11-01T00:00:00.000Z" }, () => undefined)).toEqual([]);
    expect(snoozeActions({ state: "unread" }, () => undefined, true).every((action) => action.disabled)).toBe(true);
    expect(reopenActions({ state: "unread" }, () => undefined)).toEqual([]);
    expect(reopenActions({ state: "archived" }, () => undefined).map((action) => action.id)).toEqual(["reopen"]);
  });
});

describe("every action on a reminder discards a re-read that began before it", () => {
  // The provider, the page and the bell are components, and these tests do not render components: what a render would
  // show is the order of a call, so the call is what is checked here (the guard itself is tested in reminder-refresh.test.ts).
  const source = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

  it("starts a change before the reminders page's actions and the bell's run, and when a new sync is asked for", () => {
    // At the start, before anything is awaited, and again when it has finished.
    expect(source("src/pages/reminders/RemindersPage.tsx")).toMatch(/const run = async[\s\S]{0,300}reminders\.beginChange\(\);\s*try \{\s*await work\(\);[\s\S]{0,200}finally \{\s*reminders\.beginChange\(\);/);
    expect(source("src/app-shell/AppShell.tsx")).toMatch(/const handle = [\s\S]{0,400}reminders\.beginChange\(\)/);
    expect(source("src/app/notifications-context.tsx")).toMatch(/const refresh = useCallback\(\(\) => \{ changes\.current\.bump\(\)/);
  });
});

describe("the groups, the counts and the home list move when a snooze ends", () => {
  const source = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

  it("works them out against the provider's clock, which the end of a snooze moves, and not against the rows alone", () => {
    const page = source("src/pages/reminders/RemindersPage.tsx");
    expect(page).toMatch(/const clock = reminders\.now;/);
    expect(page).toMatch(/\[reminders\.rows, clock, group, params\]/);
    expect(page).toMatch(/\[reminders\.rows, clock\]\)/);
    expect(source("src/pages/home/HomePage.tsx")).toMatch(/\[reminders\.rows, reminders\.now\]/);
    const provider = source("src/app/notifications-context.tsx");
    expect(provider).toMatch(/scheduleSnoozeEnd\(\{[\s\S]{0,300}setTickedAt\(Date\.now\(\)\)[\s\S]{0,300}\[rows, status, tickedAt\]/);
    expect(provider).toMatch(/const now = useMemo\(\(\) => Date\.now\(\), \[rows, tickedAt\]\)/);
  });
});

describe("a tab follows the account's desktop notification switch", () => {
  it("listens for the switch being changed in another tab, plans only from the stored state, and starts over when permission returns by itself", () => {
    const provider = readFileSync(resolve(import.meta.dirname, "../src/app/notifications-context.tsx"), "utf8");
    expect(provider).toMatch(/addEventListener\("storage", follow\)/);
    expect(provider).toMatch(/affectsDesktop\(event\.key, account\)/);
    expect(provider).toMatch(/stepDesktop\(\{[\s\S]{0,300}stored: readDesktop\(window\.localStorage, account\)[\s\S]{0,300}rebase: rebase\.current/);
    expect(provider).toMatch(/if \(!step\) \{ setStored\(false\); return; \}/);
    expect(provider).toMatch(/if \(granted && !wasGranted\.current && stored\) rebase\.current = true;/);
  });
});
