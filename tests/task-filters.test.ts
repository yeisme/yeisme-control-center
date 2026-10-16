import { expect, it } from "vitest";
import {
  filterTasks,
  taskNeedsAttention,
  type TaskFilters,
  type TaskSnapshot,
} from "../src/task-observation";
const filters: TaskFilters = {
  text: "",
  state: "",
  family: "",
  connection: "",
  owner: "",
  project: "",
  modality: "",
  results: "",
  from: "",
  through: "",
};
const rows = [
  {
    title: "原图",
    connection_id: "e",
    locator: {
      owner: "eikona",
      project: "p",
      task_ref: "r",
      task_family: "run",
    },
    state: "unknown",
    created_at: "2026-10-01T23:59:59Z",
  },
  {
    title: "原图",
    connection_id: "other",
    locator: {
      owner: "eikona",
      project: "p",
      task_ref: "r",
      task_family: "run",
    },
    state: "completed",
    created_at: "2026-10-02T00:00:00Z",
  },
  {
    title: "声音",
    connection_id: "s",
    locator: {
      owner: "sonora",
      project: "p",
      task_ref: "audio",
      task_family: "voice-render-job",
    },
    state: "failed",
    created_at: "",
  },
] as TaskSnapshot[];
it("filters authorized rows without merging same-name instances or inventing dates", () => {
  expect(filterTasks(rows, filters)).toEqual(rows);
  expect(
    filterTasks(rows, {
      ...filters,
      connection: "e",
      text: "原图",
      state: "unknown",
      family: "run",
    }),
  ).toEqual([rows[0]]);
  expect(
    filterTasks(rows, {
      ...filters,
      from: "2026-10-01",
      through: "2026-10-01",
    }),
  ).toEqual([rows[0]]);
  expect(filterTasks(rows, { ...filters, text: "sonora" })).toEqual([rows[2]]);
  expect(
    filterTasks(rows, {
      ...filters,
      from: "2026-10-03",
      through: "2026-10-01",
    }),
  ).toEqual([]);
  expect(filterTasks(rows, { ...filters, owner: "sonora", results: "no" })).toEqual([rows[2]]);
  expect(filterTasks(rows, { ...filters, project: "p", owner: "eikona" })).toEqual([rows[0], rows[1]]);
  expect(rows.filter(taskNeedsAttention)).toEqual([rows[0], rows[2]]);
});
