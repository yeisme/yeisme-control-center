import { describe, expect, it } from "vitest";
import { readTaskPagesBounded } from "../src/task-polling";
import type { TaskPage, TaskSnapshot } from "../src/task-observation";

const row = (key: string): TaskSnapshot => ({
  schema_version: "yeisme.task_observation.v1",
  locator: { owner: "eikona", instance_id: "i", project: "p", task_family: "run", task_ref: key },
  task_key: key,
  connection_id: "c",
  title: key,
  state: "succeeded",
  native_state: "succeeded",
  stage: "completed",
  revision: "1",
  created_at: "",
  updated_at: null,
  observed_at: "",
  started_at: null,
  progress: { kind: "indeterminate", completed: null, total: null, percent: null },
  source: "",
  actor: null,
  parent_ref: null,
  results: [],
  allowed_actions: [],
  coverage: "complete",
});

const page = (keys: string[], next?: string): TaskPage => ({
  rows: keys.map(row),
  connections: [{ id: "c", owner: "eikona", instance_id: "i", label: "c", environment: "e", project: "p", state: "ready", observed_at: "" }],
  next_cursors: next ? { c: next } : {},
});

describe("bounded task paging", () => {
  it("keeps rows read before the page cap and names the truncation", async () => {
    let calls = 0;
    const result = await readTaskPagesBounded(async () => page([`r${calls++}`], "more-" + calls), 3);
    expect(result.rows.map((task) => task.task_key)).toEqual(["r0", "r1", "r2"]);
    expect(result.truncated).toBe("task_page_limit");
  });

  it("reports a repeated cursor instead of looping", async () => {
    const result = await readTaskPagesBounded(async () => page(["same"], "loop"), 10);
    expect(result.truncated).toBe("task_cursor_repeated");
    expect(result.rows).toHaveLength(1);
  });

  it("completes without truncation when cursors run out", async () => {
    const pages = [page(["a"], "x"), page(["b"])];
    const result = await readTaskPagesBounded(async () => pages.shift()!, 10);
    expect(result.truncated).toBeNull();
    expect(result.rows.map((task) => task.task_key)).toEqual(["a", "b"]);
  });
});
