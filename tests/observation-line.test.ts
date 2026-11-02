import { describe, expect, it } from "vitest";
import type { ObservationStatus } from "../src/shared/api/control-center-client";
import { observationLineText } from "../src/pages/reminders/observation-line";

const now = Date.parse("2026-11-02T10:00:00.000Z");
const minutes = (n: number) => new Date(now + n * 60_000).toISOString();
const status = (over: Partial<ObservationStatus> = {}): ObservationStatus => ({
  schema_version: "yeisme.observation_status.v1", enabled: true, config_valid: true, running: true, interval_minutes: 10, open_tools_every: 3, scope: "scope-a",
  observed: true, recipient: true, next_run_at: minutes(7), epoch: 1,
  last_cycle: { started_at: minutes(-4), finished_at: minutes(-3), calls: 12, pages_read: 9, pages_skipped: 0, reminders_opened: 2, reminders_recovered: 1, connections_read: 4, connections_skipped: 0, scan_incomplete: 0, open_tools_read: true, errors: {} },
  ...over,
});

describe("the line about background observation", () => {
  it("says how often it runs, what the last cycle did, when the next one is and that the account receives the reminders", () => {
    expect(observationLineText(status(), now)).toBe("每 10 分钟观察一次 · 上次 3 分钟前：读了 9 页，新增 2 条、恢复 1 条 · 下次约 7 分钟后 · 这个范围的后台提醒会发给你");
  });

  it("counts what could not be read without naming a code, a connection or an address", () => {
    const line = observationLineText(status({ last_cycle: { ...status().last_cycle!, errors: { needs_authorization: 2, open_tool_forbidden: 1, walk_page_failed: 1 } } }), now);
    expect(line).toContain("4 处没读成");
    for (const leaked of ["needs_authorization", "open_tool", "walk_page", "http", "/"]) expect(line.replace("分钟", "")).not.toContain(leaked);
  });

  it("tells a first cycle that has not run, an account that is not a recipient, and a scope nobody receives", () => {
    expect(observationLineText(status({ last_cycle: null, next_run_at: minutes(1) }), now)).toBe("每 10 分钟观察一次 · 还没有跑过第一次 · 下次约 1 分钟后 · 这个范围的后台提醒会发给你");
    expect(observationLineText(status({ recipient: false }), now)).toContain("发给别的管理员，不发给你");
    expect(observationLineText(status({ recipient: false, observed: false, next_run_at: null }), now)).toBe("每 10 分钟观察一次 · 上次 3 分钟前：读了 9 页，新增 2 条、恢复 1 条 · 这个范围没有人接收后台提醒");
  });

  it("says plainly when it is off, misconfigured or not running here", () => {
    expect(observationLineText(status({ enabled: false, running: false, last_cycle: null, next_run_at: null }), now)).toBe("后台观察没有开启：没有人打开页面时，不会自动产生提醒。");
    expect(observationLineText(status({ enabled: false, config_valid: false, running: false }), now)).toBe("后台观察的配置有问题，已经关闭；没有人打开页面时不会产生提醒。");
    expect(observationLineText(status({ running: false, last_cycle: null, next_run_at: null }), now)).toBe("后台观察已经配置，但这个进程没有在运行它。");
  });

  it("rounds a long wait to hours and days", () => {
    expect(observationLineText(status({ next_run_at: minutes(150) }), now)).toContain("下次约 3 小时后");
    expect(observationLineText(status({ last_cycle: { ...status().last_cycle!, finished_at: minutes(-3 * 60) } }), now)).toContain("上次 3 小时前");
    expect(observationLineText(status({ next_run_at: minutes(0) }), now)).toContain("下次马上");
    // Just now has no digits to set off, so no space either.
    expect(observationLineText(status({ last_cycle: { ...status().last_cycle!, finished_at: minutes(0) } }), now)).toContain("上次刚刚：读了 9 页");
  });
});
