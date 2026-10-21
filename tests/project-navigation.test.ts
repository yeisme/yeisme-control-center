import { expect, it } from "vitest";
import { closeProjectTask, selectProjectTab, selectProjectTask } from "../src/shared/read-model/project-navigation";

it("keeps project context while selecting and closing a task inspector", () => {
  const base = new URLSearchParams("project=eikona%3Aproj_1&tab=tasks&owner=eikona");
  const selected = selectProjectTask(base, "task-1");
  expect(selected.toString()).toContain("project=eikona%3Aproj_1");
  expect(selected.get("tab")).toBe("tasks");
  expect(selected.get("owner")).toBe("eikona");
  expect(selected.get("task")).toBe("task-1");
  const closed = closeProjectTask(selected);
  expect(closed.get("task")).toBeNull();
  expect(closed.get("project")).toBe("eikona:proj_1");
  expect(closed.get("tab")).toBe("tasks");
  expect(closed.get("owner")).toBe("eikona");
});

it("clears a task selection when switching project tabs", () => {
  const next = selectProjectTab(new URLSearchParams("project=eikona%3Aproj_1&tab=tasks&task=task-1"), "assets");
  expect(next.get("tab")).toBe("assets");
  expect(next.get("task")).toBeNull();
  expect(next.get("project")).toBe("eikona:proj_1");
});
