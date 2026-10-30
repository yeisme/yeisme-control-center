import { expect, it } from "vitest";
import { closeProjectTask, selectProjectResult, selectProjectTab, selectProjectTask } from "../src/shared/read-model/project-navigation";
import { batchListFiltered, batchListQuery, closeOpenedBatch, dayStart, pageBatchList } from "../src/shared/read-model/batch-list";

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

it("opens a project result without leaving the project page", () => {
  const next = selectProjectResult(new URLSearchParams("project=eikona%3Aproj_1&tab=tasks"), "task-1:poster");
  expect(next.get("tab")).toBe("assets");
  expect(next.get("result")).toBe("task-1:poster");
  expect(next.get("project")).toBe("eikona:proj_1");
  expect(selectProjectResult(next, null).get("result")).toBeNull();
});

it("restores a batch list's filters and page from the address, with calendar days as local instants", () => {
  const params = new URLSearchParams({ sharedProject: "project_1", batch: "batch_old", batchFilterq: "雨夜", batchFilterstate: "failed,partial", batchFilterowner: "eikona", batchFilterfrom: "2026-10-01", batchFilterto: "2026-10-02", batchFiltercursor: "signed.cursor" });
  expect(batchListQuery(params)).toEqual({ q: "雨夜", state: "failed,partial", owner: "eikona", from: new Date("2026-10-01T00:00:00").toISOString(), to: new Date("2026-10-03T00:00:00").toISOString(), cursor: "signed.cursor", limit: 20 });
  // A day that is not a day is no filter rather than an error the server would have to answer.
  expect(dayStart("2026-13-45")).toBeUndefined();
  expect(batchListQuery(new URLSearchParams("batchFilterfrom=yesterday")).from).toBeUndefined();
  expect(batchListFiltered(params)).toBe(true);
  expect(batchListFiltered(new URLSearchParams("batchFiltercursor=c&batch=b"))).toBe(false);
});

it("pages and closes an opened batch without losing the project, the filters or each other", () => {
  const params = new URLSearchParams("sharedProject=project_1&batch=batch_old&batchFilterstate=failed");
  const older = pageBatchList(params, "signed.cursor");
  expect(Object.fromEntries(older)).toEqual({ sharedProject: "project_1", batch: "batch_old", batchFilterstate: "failed", batchFiltercursor: "signed.cursor" });
  expect(pageBatchList(older, null).has("batchFiltercursor")).toBe(false);
  expect(Object.fromEntries(closeOpenedBatch(older))).toEqual({ sharedProject: "project_1", batchFilterstate: "failed", batchFiltercursor: "signed.cursor" });
});
