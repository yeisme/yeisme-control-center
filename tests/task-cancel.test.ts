import { afterEach, expect, it, vi } from "vitest";
import {
  pendingCancellation,
  rememberCancellation,
  finishCancellation,
  cancellationNeedsFollowup,
} from "../src/task-cancel";
import type { TaskSnapshot } from "../src/task-observation";
afterEach(() => vi.unstubAllGlobals());
it("binds recovery to stable scope/locator instead of restart-rotated task key", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  const task = {
    connection_id: "c",
    task_key: "old",
    locator: {
      owner: "eikona",
      instance_id: "one",
      project: "p",
      task_family: "run",
      task_ref: "original",
    },
  } as TaskSnapshot;
  rememberCancellation("s", task, "original-cancellation-id");
  expect(pendingCancellation("s", { ...task, task_key: "new" })).toBe(
    "original-cancellation-id",
  );
  expect(pendingCancellation("other", task)).toBeUndefined();
  expect(
    pendingCancellation("s", {
      ...task,
      locator: { ...task.locator, instance_id: "two" },
    }),
  ).toBeUndefined();
  expect(cancellationNeedsFollowup("requested")).toBe(true);
  expect(cancellationNeedsFollowup("unknown")).toBe(true);
  expect(cancellationNeedsFollowup("cancelled")).toBe(false);
  expect(() => rememberCancellation("s", task, "invalid")).toThrow(
    "cancel_recovery_invalid",
  );
  finishCancellation("s", task);
  expect(pendingCancellation("s", task)).toBeUndefined();
});
it("fails closed when browser storage is unavailable", () => {
  vi.stubGlobal("sessionStorage", {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  });
  const task = { locator: {}, connection_id: "c" } as TaskSnapshot;
  expect(() => pendingCancellation("s", task)).toThrow("denied");
  expect(() =>
    rememberCancellation("s", task, "original-cancellation-id"),
  ).toThrow("denied");
});
