import { describe, expect, it } from "vitest";
import {
  affectsDesktop, desktopSupport, desktopStorageKey, emptyDesktop, maxIndividualNotices, maxRememberedNotified, noticeMarker, noticeTitle, parseDesktop, planDesktopNotifications, readDesktop, stepDesktop, summaryTag, writeDesktop,
  type PlannedReminder, type StoredDesktop,
} from "../src/app/desktop-notifications";

const now = Date.parse("2026-11-02T10:00:00.000Z");
const hour = 3_600_000;
const names: Record<string, string> = { eikona: "Eikona", gateway: "MCP Gateway", drivebridge: "DriveBridge", "control-center": "控制中心" };
const label = (owner: string) => names[owner] ?? owner;

let sequence = 0;
/** A reminder with a task title the planner must never repeat. */
const reminder = (id: string, over: Partial<PlannedReminder> & { title?: string } = {}): PlannedReminder & { title: string } => ({
  id, state: "unread", owner: "eikona", category: "failure", read_at: null, snoozed_until: null, recovered_at: null,
  first_seen_at: new Date(now - (1000 - sequence++) * 1000).toISOString(), title: "绝密镜头 · 提示词：雨夜里的车", ...over,
});
const plan = (rows: PlannedReminder[], over: Partial<Parameters<typeof planDesktopNotifications>[0]> = {}) =>
  planDesktopNotifications({ rows, unread: rows.filter((row) => row.state === "unread").length, now, away: true, baseline: [], notified: {}, label, ...over });

describe("desktop notification plan: which reminders may notify", () => {
  it("takes what is unread when the scope is first seen as the baseline, and shows nothing", () => {
    const rows = [reminder("a"), reminder("b"), reminder("c", { state: "archived" })];
    const first = plan(rows, { baseline: null });
    expect(first.notices).toEqual([]);
    expect(first.baseline.sort()).toEqual(["a", "b"]);
  });

  it("does not notify a reminder that was unread when the switch was turned on, but does notify one that arrives later", () => {
    const old = [reminder("a"), reminder("b")];
    expect(plan(old, { baseline: ["a", "b"] }).notices).toEqual([]);
    const later = reminder("c");
    const result = plan([...old, later], { baseline: ["a", "b"] });
    expect(result.notices.map((notice) => notice.tag)).toEqual(["c"]);
    expect(result.notified).toEqual({ c: noticeMarker(later) });
  });

  it("leaves the baseline when a reminder stops being unread, so a reopened one is new again", () => {
    const a = reminder("a");
    const acknowledged = plan([{ ...a, state: "acknowledged" }], { baseline: ["a"] });
    expect(acknowledged.baseline).toEqual([]);
    expect(plan([a], { baseline: acknowledged.baseline }).notices.map((notice) => notice.tag)).toEqual(["a"]);
    // The same goes for one that was read, one that recovered, and one that is snoozed.
    for (const over of [{ read_at: "2026-11-02T09:00:00.000Z" }, { recovered_at: "2026-11-02T09:00:00.000Z" }, { snoozed_until: new Date(now + hour).toISOString() }] as Partial<PlannedReminder>[]) {
      expect(plan([{ ...a, ...over }], { baseline: ["a"] }).baseline).toEqual([]);
      expect(plan([{ ...a, ...over }], { baseline: [] }).notices).toEqual([]);
    }
  });

  it("shows nothing while the page is in view, and counts what was in view as seen, so it does not notify once the person has gone", () => {
    const rows = [reminder("a"), reminder("b")];
    const inView = plan(rows, { baseline: [], away: false });
    expect(inView.notices).toEqual([]);
    expect(inView.notified).toEqual({});
    expect(inView.baseline.sort()).toEqual(["a", "b"]);
    // The person leaves: those two stay quiet, a reminder that arrives meanwhile does not.
    const gone = plan([...rows, reminder("c")], { baseline: inView.baseline, away: true });
    expect(gone.notices.map((notice) => notice.tag)).toEqual(["c"]);
  });

  it("notifies a reminder once: what was notified stays quiet", () => {
    const rows = [reminder("a"), reminder("b")];
    const first = plan(rows);
    expect(first.notices).toHaveLength(2);
    const again = plan(rows, { notified: first.notified, baseline: first.baseline });
    expect(again.notices).toEqual([]);
    expect(Object.keys(again.notified).sort()).toEqual(["a", "b"]);
  });

  it("notifies once more when a snooze ends, and again for each later snooze, never while it lasts", () => {
    const a = reminder("a");
    const snoozed = (until: string) => ({ ...a, snoozed_until: until });
    const until = new Date(now - 60_000).toISOString();
    // It was notified before it was snoozed.
    const seen = { a: noticeMarker(a) };
    const during = plan([snoozed(new Date(now + hour).toISOString())], { notified: seen });
    expect(during.notices).toEqual([]);
    const ended = plan([snoozed(until)], { notified: seen });
    expect(ended.notices.map((notice) => notice.tag)).toEqual(["a"]);
    expect(ended.notified).toEqual({ a: noticeMarker(snoozed(until)) });
    expect(plan([snoozed(until)], { notified: ended.notified }).notices).toEqual([]);
    // Snoozed again to another time: when that ends it is one more.
    const later = new Date(now - 1000).toISOString();
    expect(plan([snoozed(later)], { notified: ended.notified }).notices).toHaveLength(1);
    // Reopened early, the snooze is gone and the reminder is the one that was already notified.
    expect(plan([a], { notified: seen }).notices).toEqual([]);
  });

  it("notifies a reminder whose snooze ends even if it was in the baseline when it was snoozed", () => {
    const a = reminder("a");
    const until = new Date(now - 1000).toISOString();
    // It was unread when the switch was turned on, so it was in the baseline; being snoozed took it out.
    const snoozedAt = plan([{ ...a, snoozed_until: new Date(now + hour).toISOString() }], { baseline: ["a"] });
    expect(snoozedAt.baseline).toEqual([]);
    expect(plan([{ ...a, snoozed_until: until }], { baseline: snoozedAt.baseline }).notices.map((notice) => notice.tag)).toEqual(["a"]);
  });
});

describe("desktop notification plan: what is shown", () => {
  it("shows at most three notifications for a batch, newest first, and one summary for the rest", () => {
    const rows = ["r1", "r2", "r3", "r4", "r5", "r6"].map((id, index) => reminder(id, { first_seen_at: new Date(now - (10 - index) * 60_000).toISOString(), owner: index < 4 ? "eikona" : "gateway" }));
    const result = plan(rows, { unread: 9 });
    expect(maxIndividualNotices).toBe(3);
    expect(result.notices.map((notice) => notice.tag)).toEqual(["r6", "r5", "r4", summaryTag]);
    expect(result.notices[3]).toMatchObject({ title: noticeTitle, path: "/reminders" });
    expect(result.notices[3].body).toBe("另有 3 条新提醒（Eikona），共 9 条未读");
    // All six are remembered, the three in the summary included.
    expect(Object.keys(result.notified).sort()).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
    // Three or fewer have no summary; the tag is the reminder's id and the click opens it.
    const three = plan(rows.slice(0, 3));
    expect(three.notices).toHaveLength(3);
    expect(three.notices.every((notice) => notice.tag.startsWith("r") && notice.path === `/reminders?focus=${notice.tag}`)).toBe(true);
    expect(plan(rows.slice(0, 4)).notices.map((notice) => notice.tag)).toEqual(["r4", "r3", "r2", summaryTag]);
  });

  it("names owners in the summary, at most three of them", () => {
    const owners = ["eikona", "gateway", "drivebridge", "sonora", "scaena"];
    const rows = [...owners, ...owners].map((owner, index) => reminder(`m${index}`, { owner, first_seen_at: new Date(now - index * 60_000).toISOString() }));
    const summary = plan(rows).notices.at(-1)!;
    expect(summary.tag).toBe(summaryTag);
    expect(summary.body).toMatch(/^另有 7 条新提醒（.+ 等），共 \d+ 条未读$/);
    expect(summary.body.match(/、/g)).toHaveLength(2);
  });

  it("carries the tool or owner, the kind of reminder and counts, and nothing the reminder says", () => {
    const rows = [
      reminder("f", { owner: "eikona", category: "failure" }),
      reminder("o", { owner: "drivebridge", category: "operation" }),
      reminder("c", { owner: "gateway", category: "credential" }),
    ];
    const result = plan(rows, { unread: 12 });
    expect(Object.fromEntries(result.notices.map((notice) => [notice.tag, notice.body]))).toEqual({
      c: "MCP Gateway · 凭据，共 12 条未读",
      o: "DriveBridge · 工具运行，共 12 条未读",
      f: "Eikona · 任务失败，共 12 条未读",
    });
    // Collaboration reminders name the control center, not a tool.
    expect(plan([reminder("p", { owner: "control-center", category: "project_assignment" })], { unread: 1 }).notices[0].body).toBe("控制中心 · 项目协作，共 1 条未读");
    const everything = JSON.stringify(result.notices);
    for (const leaked of ["绝密镜头", "提示词", "雨夜"]) expect(everything).not.toContain(leaked);
    expect(result.notices.every((notice) => notice.title === noticeTitle)).toBe(true);
  });

  it("forgets the oldest notified ids beyond the limit and keeps the newest", () => {
    const notified = Object.fromEntries(Array.from({ length: maxRememberedNotified }, (_, index) => [`old-${index}`, ""]));
    const result = plan([reminder("fresh")], { notified });
    const kept = Object.keys(result.notified);
    expect(kept).toHaveLength(maxRememberedNotified);
    expect(kept).not.toContain("old-0");
    expect(kept.at(-1)).toBe("fresh");
    expect(kept).toContain(`old-${maxRememberedNotified - 1}`);
  });

  it("does not change what it was given", () => {
    const baseline = ["a"];
    const notified = { z: "" };
    plan([reminder("a"), reminder("b")], { baseline, notified });
    expect(baseline).toEqual(["a"]);
    expect(notified).toEqual({ z: "" });
  });
});

describe("desktop notification support", () => {
  it("says why the switch cannot be turned on, in Chinese, in a fixed order", () => {
    expect(desktopSupport({ hasApi: false, secure: false, permission: "denied" })).toMatchObject({ state: "unavailable", reason: "unsupported", message: "这个浏览器不支持桌面通知。" });
    expect(desktopSupport({ hasApi: true, secure: false, permission: "denied" })).toMatchObject({ state: "unavailable", reason: "insecure" });
    expect((desktopSupport({ hasApi: true, secure: false }) as { message: string }).message).toContain("HTTPS");
    expect(desktopSupport({ hasApi: true, secure: true, permission: "denied" })).toMatchObject({ state: "unavailable", reason: "denied" });
    expect((desktopSupport({ hasApi: true, secure: true, permission: "denied" }) as { message: string }).message).toContain("网站设置");
  });

  it("allows it when the browser can, and tells a granted permission from one still to be asked for", () => {
    expect(desktopSupport({ hasApi: true, secure: true, permission: "default" })).toEqual({ state: "available" });
    expect(desktopSupport({ hasApi: true, secure: true, permission: "granted" })).toEqual({ state: "granted" });
  });
});

describe("what is kept between page loads", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
  };

  it("belongs to the account: what one account was notified of says nothing about another", () => {
    const storage = memory();
    const row = reminder("a");
    writeDesktop(storage, "issuer|alice", { v: 1, on: true, notified: { a: noticeMarker(row) }, baselines: { "scope-a": ["a", "b"] } });
    expect(readDesktop(storage, "issuer|alice")).toEqual({ v: 1, on: true, notified: { a: noticeMarker(row) }, baselines: { "scope-a": ["a", "b"] } });
    expect(readDesktop(storage, "issuer|bob")).toEqual(emptyDesktop());
    expect([...storage.data.keys()]).toEqual([desktopStorageKey("issuer|alice")]);
    // So the same reminder is new for bob and old for alice.
    expect(plan([row], { notified: readDesktop(storage, "issuer|alice").notified, baseline: [] }).notices).toEqual([]);
    expect(plan([row], { notified: readDesktop(storage, "issuer|bob").notified, baseline: [] }).notices).toHaveLength(1);
  });

  it("reads back whatever is there without failing", () => {
    expect(parseDesktop(null)).toEqual(emptyDesktop());
    for (const raw of ["", "not json", "[]", "null", '{"v":2,"on":true}', '"text"']) expect(parseDesktop(raw)).toEqual(emptyDesktop());
    expect(parseDesktop(JSON.stringify({ v: 1, on: "yes", notified: { a: "", b: 3, c: null }, baselines: { s: ["x", 4, null], t: "nope" } }))).toEqual({ v: 1, on: false, notified: { a: "" }, baselines: { s: ["x"] } });
    expect(readDesktop({ getItem: () => { throw new Error("blocked"); } }, "a")).toEqual(emptyDesktop());
    expect(readDesktop(undefined, "a")).toEqual(emptyDesktop());
    // A full or blocked storage loses the memory and nothing else.
    expect(() => writeDesktop({ setItem: () => { throw new Error("full"); } }, "a", emptyDesktop())).not.toThrow();
  });
});

describe("desktop notification plan: an incident that comes back, and what is remembered", () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it("notifies a reminder once more when its condition ended and came back as a new incident, and not when nothing changed", () => {
    const first = reminder("c", { category: "credential", owner: "gateway", first_seen_at: iso(now - 3 * hour) });
    const told = plan([first]);
    expect(told.notices.map((notice) => notice.tag)).toEqual(["c"]);
    // It recovered, and the page saw that.
    const recovered = plan([{ ...first, recovered_at: iso(now - hour) }], { notified: told.notified, baseline: told.baseline });
    expect(recovered.notices).toEqual([]);
    // The ledger reopens the same reminder as a new incident: the same id, a new first-seen time, no snooze left over.
    const back = { ...first, first_seen_at: iso(now - 60_000), recovered_at: null, snoozed_until: null };
    const again = plan([back], { notified: recovered.notified, baseline: recovered.baseline });
    expect(again.notices.map((notice) => notice.tag)).toEqual(["c"]);
    expect(again.notified.c).toBe(noticeMarker(back));
    // Seen again with nothing changed it is the incident already told.
    expect(plan([back], { notified: again.notified, baseline: again.baseline }).notices).toEqual([]);
    // A page that never saw it recovered still tells a reminder it had told while the person was away.
    expect(plan([back], { notified: told.notified, baseline: told.baseline }).notices.map((notice) => notice.tag)).toEqual(["c"]);
    // The person reopening the same reminder is not a new incident: nothing is told.
    expect(plan([first], { notified: told.notified, baseline: [] }).notices).toEqual([]);
    expect(noticeMarker(first)).not.toBe(noticeMarker(back));
    expect(noticeMarker(first)).toBe(noticeMarker({ ...first, title: "something else" } as never));
  });

  it("counts every unread reminder the page shows as seen, those notified earlier included", () => {
    const a = reminder("a");
    const b = reminder("b");
    const told = plan([a]);
    expect(told.baseline).toEqual([]);
    const view = plan([a, b], { baseline: told.baseline, notified: told.notified, away: false });
    expect(view.notices).toEqual([]);
    expect(view.baseline.sort()).toEqual(["a", "b"]);
  });

  it("forgets what is no longer unread before what still is, when it has to forget", () => {
    const still = reminder("still");
    const notified = { still: noticeMarker(still), ...Object.fromEntries(Array.from({ length: maxRememberedNotified - 1 }, (_, index) => [`gone-${index}`, ""])) };
    // The entry for the unread reminder is the oldest, and one more is told.
    const result = plan([still, reminder("new")], { notified, baseline: ["still"] });
    expect(Object.keys(result.notified)).toHaveLength(maxRememberedNotified);
    expect(result.notified).toHaveProperty("still");
    expect(result.notified).toHaveProperty("new");
    expect(result.notified).not.toHaveProperty("gone-0");
    // Reminders that are still unread are forgotten oldest first once there are no others.
    const flood = Array.from({ length: maxRememberedNotified }, (_, index) => reminder(`n${index}`));
    expect(Object.keys(plan([still, ...flood], { notified: { still: noticeMarker(still) }, baseline: ["still"] }).notified)).not.toContain("still");
  });

  it("does not tell an old unread reminder again when its entry has been forgotten, because the page showed it", () => {
    const old = reminder("old");
    const told = plan([old]);
    const seen = plan([old], { baseline: told.baseline, notified: told.notified, away: false });
    const flood = Array.from({ length: maxRememberedNotified }, (_, index) => reminder(`n${index}`));
    const crowded = plan([old, ...flood], { baseline: seen.baseline, notified: seen.notified });
    expect(crowded.notices.map((notice) => notice.tag)).not.toContain("old");
    expect(crowded.notified).not.toHaveProperty("old");
    expect(plan([old, ...flood], { baseline: crowded.baseline, notified: crowded.notified }).notices).toEqual([]);
    // What the page never showed has only the memory to go by, and is told once that is gone.
    expect(plan([old, ...flood], { baseline: [], notified: crowded.notified }).notices.map((notice) => notice.tag)).toContain("old");
  });
});

describe("a tab's pass over what is stored for the account", () => {
  const storedState = (over: Partial<StoredDesktop> = {}): StoredDesktop => ({ v: 1, on: true, notified: {}, baselines: {}, ...over });
  const step = (state: StoredDesktop, rows: PlannedReminder[], over: Partial<Parameters<typeof stepDesktop>[0]> = {}) =>
    stepDesktop({ stored: state, scope: "scope-a", rows, unread: rows.length, now, away: true, label, ...over });

  it("does nothing when the account has the switch off, whatever this tab last heard and however much is new", () => {
    const rows = [reminder("a"), reminder("b")];
    const on = step(storedState({ baselines: { "scope-a": [] } }), rows);
    expect(on?.notices.map((notice) => notice.tag).sort()).toEqual(["a", "b"]);
    // Another tab turned it off: the stored state says so, and this tab, hidden and polling, finds nothing to do or write.
    expect(step(storedState({ on: false, baselines: { "scope-a": [] } }), rows)).toBeNull();
  });

  it("takes a scope's first sight as its baseline, plans against it afterwards, and keeps each scope's own", () => {
    const rows = [reminder("a")];
    const first = step(storedState({ baselines: { "scope-b": ["x"] } }), rows)!;
    expect(first.notices).toEqual([]);
    expect(first.stored.baselines).toEqual({ "scope-b": ["x"], "scope-a": ["a"] });
    const next = step(first.stored, [...rows, reminder("b")])!;
    expect(next.notices.map((notice) => notice.tag)).toEqual(["b"]);
    expect(next.stored.notified).toEqual({ b: expect.any(String) });
    expect(next.stored.baselines["scope-b"]).toEqual(["x"]);
    expect(next.stored.on).toBe(true);
  });

  it("starts the baseline over when asked to, so a permission that came back on its own does not burst", () => {
    const rows = [reminder("a"), reminder("b")];
    const resumed = step(storedState({ baselines: { "scope-a": ["a"] }, notified: { z: "" } }), rows, { rebase: true })!;
    expect(resumed.notices).toEqual([]);
    expect(resumed.stored.baselines["scope-a"].sort()).toEqual(["a", "b"]);
    expect(resumed.stored.notified).toEqual({ z: "" });
    // Without it, the old baseline stands and "b" is told.
    expect(step(storedState({ baselines: { "scope-a": ["a"] } }), rows)!.notices.map((notice) => notice.tag)).toEqual(["b"]);
  });

  it("follows another tab's change to this account's key, and the clearing of storage, and nothing else", () => {
    expect(affectsDesktop(desktopStorageKey("issuer|alice"), "issuer|alice")).toBe(true);
    expect(affectsDesktop(null, "issuer|alice")).toBe(true);
    expect(affectsDesktop(desktopStorageKey("issuer|bob"), "issuer|alice")).toBe(false);
    expect(affectsDesktop("something.else", "issuer|alice")).toBe(false);
  });
});
