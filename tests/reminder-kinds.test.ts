import { describe, expect, it } from "vitest";
import { hasFailureVersion, reminderGroup, reminderKind, reminderKindLabels, reminderStateLabel } from "../src/notifications";

describe("what kind of reminder it is", () => {
  it("tells a task failure from a tool run, a credential and project collaboration, with a label of its own for each", () => {
    expect([undefined, "failure", "operation", "credential", "generation_batch", "project_assignment", "anything-else"].map((category) => reminderKind({ category }))).toEqual([
      "failure", "failure", "operation", "credential", "collaboration", "collaboration", "collaboration",
    ]);
    // Operation and credential reminders are not "项目协作" any more.
    expect(reminderKindLabels).toEqual({ failure: "任务失败", operation: "工具运行", credential: "凭据", collaboration: "项目协作" });
  });

  it("gives only a task failure a failure version, so the others show neither revision nor error code", () => {
    expect([undefined, "failure"].map((category) => hasFailureVersion({ category }))).toEqual([true, true]);
    for (const category of ["operation", "credential", "generation_batch", "project_assignment"]) expect(hasFailureVersion({ category })).toBe(false);
  });
});

describe("the state of a snoozed reminder", () => {
  const now = Date.parse("2026-11-02T10:00:00.000Z");
  const until = (ms: number) => new Date(now + ms).toISOString();

  it("reads as snoozed, and sits with the quiet reminders, while the snooze lasts", () => {
    const snoozed = { state: "unread", priority: "normal", snoozed_until: until(3_600_000), recovered_at: null };
    expect(reminderStateLabel(snoozed, now)).toBe("稍后提醒");
    expect(reminderGroup(snoozed, now)).toBe("quiet");
    // Once it has ended it is an ordinary new reminder again.
    expect(reminderStateLabel(snoozed, now + 3_600_001)).toBe("未查看");
    expect(reminderGroup(snoozed, now + 3_600_001)).toBe("new");
  });

  it("keeps the other groups as they were", () => {
    const base = { state: "unread", priority: "normal", snoozed_until: null, recovered_at: null };
    expect(reminderGroup(base, now)).toBe("new");
    expect(reminderGroup({ ...base, state: "acknowledged" }, now)).toBe("open");
    expect(reminderGroup({ ...base, state: "archived" }, now)).toBe("archived");
    expect(reminderGroup({ ...base, state: "muted" }, now)).toBe("quiet");
    expect(reminderGroup({ ...base, priority: "low" }, now)).toBe("quiet");
    expect(reminderGroup({ ...base, recovered_at: until(-1000) }, now)).toBe("quiet");
  });
});
