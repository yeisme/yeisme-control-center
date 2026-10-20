import { describe, expect, it } from "vitest";
import { classForStatus, requestParams } from "../src/shared/api/control-center-client";
import { readErrorMessage, statusForFailure } from "../src/shared/read-model/read-state";
import { formatBytes, formatDurationMs, formatMoney, formatRelative } from "../src/shared/read-model/format";
import { actionReasonLabel, collectResults, inView, resultAction, taskInProgress } from "../src/shared/read-model/tasks";
import { defaultRequestQuery } from "../src/request-visibility";
import { pageFromPath } from "../src/app-shell/navigation";
import type { TaskSnapshot } from "../src/task-observation";

const task = (state: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  schema_version: "yeisme.task_observation.v1",
  locator: { owner: "eikona", instance_id: "i", project: "p", task_family: "run", task_ref: state },
  task_key: "key-" + state,
  connection_id: "c",
  title: state,
  state,
  native_state: state,
  stage: state,
  revision: "1",
  created_at: "2026-10-17T00:00:00Z",
  updated_at: null,
  observed_at: "2026-10-17T00:00:00Z",
  started_at: null,
  progress: { kind: "indeterminate", completed: null, total: null, percent: null },
  source: "",
  actor: null,
  parent_ref: null,
  results: [],
  allowed_actions: [],
  coverage: "complete",
  ...patch,
});

describe("error envelope classing", () => {
  it("derives the frozen error class from status when the server omits it", () => {
    expect(classForStatus(401)).toBe("login_required");
    expect(classForStatus(403)).toBe("forbidden");
    expect(classForStatus(409)).toBe("conflict");
    expect(classForStatus(410)).toBe("expired");
    expect(classForStatus(422)).toBe("invalid");
    expect(classForStatus(429)).toBe("rate_limited");
    expect(classForStatus(503)).toBe("unavailable");
  });

  it("maps failures to read states without guessing from message text", () => {
    expect(statusForFailure("login_required", "login_required", true)).toBe("login_required");
    expect(statusForFailure("unavailable", "needs_contract", false)).toBe("needs_contract");
    expect(statusForFailure("forbidden", "content_not_authorized", true)).toBe("forbidden");
    expect(statusForFailure("unavailable", "source_unavailable", true)).toBe("stale");
    expect(statusForFailure("unavailable", "source_unavailable", false)).toBe("unavailable");
    expect(statusForFailure("not_found", "task_not_found", false)).toBe("unknown");
    expect(statusForFailure("invalid", "operation_not_allowed", false)).toBe("unknown");
    expect(statusForFailure("invalid", "owner_action_contract_missing", false)).toBe("needs_contract");
  });

  it("turns machine errors into actionable read copy", () => {
    expect(readErrorMessage("operation_not_allowed")).toContain("未开放此读取入口");
    expect(readErrorMessage("owner_action_contract_missing")).toContain("尚未提供");
    expect(readErrorMessage("source_unavailable")).toContain("稍后重试");
  });
});

describe("task read model", () => {
  it("keeps unknown and blocked out of the in-progress view while still needing attention", () => {
    expect(taskInProgress(task("running"))).toBe(true);
    expect(taskInProgress(task("queued"))).toBe(true);
    expect(taskInProgress(task("unknown"))).toBe(false);
    expect(inView(task("unknown"), "active")).toBe(false);
    expect(inView(task("unknown"), "attention")).toBe(true);
    expect(inView(task("blocked"), "history")).toBe(false);
    expect(inView(task("succeeded"), "history")).toBe(true);
  });

  it("enables result actions only when the backend explicitly allows them", () => {
    const allowed = task("succeeded", { allowed_actions: [{ action: "preview", enabled: true }, { action: "download", enabled: false, reason: "content_not_authorized" }] });
    expect(resultAction(allowed, "preview")).toEqual({ enabled: true, reason: null });
    expect(resultAction(allowed, "download")).toEqual({ enabled: false, reason: "内容读取未授权" });
    expect(resultAction(task("succeeded"), "preview").enabled).toBe(false);
    expect(actionReasonLabel(undefined)).toBe("来源未开放该动作");
    const requestable = task("succeeded", { allowed_actions: [{ action: "preview", enabled: false, reason: "owner_result_access_requested" }] });
    expect(resultAction(requestable, "preview")).toEqual({ enabled: true, reason: "来源结果访问待逐结果授权" });
  });

  it("derives media kind from mime with the owner modality as fallback", () => {
    const entries = collectResults([
      task("succeeded", { task_key: "key-a", locator: { owner: "sonora", instance_id: "i", project: "p", task_family: "audio-job", task_ref: "a" }, results: [{ ref: "artifact-0", name: "a", mime: "", bytes: null, state: "" }] }),
      task("succeeded", { task_key: "key-v", results: [{ ref: "artifact-0", name: "v", mime: "video/mp4", bytes: 10, state: "" }] }),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(["audio", "video"]);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2);
  });
});

describe("request query parameters", () => {
  it("drops empty search and carries the cursor only when present", () => {
    const query = defaultRequestQuery(new Date("2026-10-17T12:00:00Z"));
    const params = requestParams(query);
    expect(params.search).toBeUndefined();
    expect(params.cursor).toBeUndefined();
    expect(params.from).toBe("2026-10-16T12:00:00.000Z");
    expect(requestParams({ ...query, cursor: "c1", search: "旧车站" })).toMatchObject({ cursor: "c1", search: "旧车站" });
  });
});

describe("formatting keeps missing values missing", () => {
  it("returns null instead of zero for unknown sizes, durations and money", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatDurationMs(null)).toBeNull();
    expect(formatMoney(null, "CNY")).toBeNull();
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatDurationMs(2000)).toBe("2.0 秒");
    expect(formatMoney(1.5, "USD")).toBe("$ 1.50");
    expect(formatRelative(null)).toBe("时间未提供");
  });
});

describe("route aliases", () => {
  it("routes legacy paths to the current pages", () => {
    expect(pageFromPath("/")).toBe("home");
    expect(pageFromPath("/history")).toBe("tasks");
    expect(pageFromPath("/delivery")).toBe("review");
    expect(pageFromPath("/requests")).toBe("requests");
    expect(pageFromPath("/settings")).toBe("team");
    expect(pageFromPath("/nonexistent")).toBe("home");
  });
});
