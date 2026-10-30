import { describe, expect, it } from "vitest";
import { sourceLine, sourceStatus, type SourceInput } from "../src/shared/source-status";
import { cjkSpaced } from "../src/shared/read-model/format";
import type { TaskConnectionState } from "../src/task-observation";

const now = Date.parse("2026-10-28T08:00:00Z");
const connection = (id: string, label: string, state = "ready", channels: TaskConnectionState["channels"] = {}): TaskConnectionState => ({
  id, label, state, channels, owner: "eikona", instance_id: id, environment: "fixture", project: "rain-reunion", observed_at: "2026-10-28T07:59:50Z",
});
const readable = [connection("a", "Eikona · 图像生产"), connection("b", "Sonora · 配音与音乐"), connection("c", "Sonora · 归档")];
const input = (patch: Partial<SourceInput> = {}): SourceInput => ({
  status: "ready",
  error: null,
  connections: readable,
  observedAt: "2026-10-28T07:59:50Z",
  readFailed: false,
  lanes: { active: { status: "ready" }, history: { status: "ready" } },
  ...patch,
});

describe("sourceStatus", () => {
  it("reads unreadable connections as gaps in the list, not as stale data", () => {
    const status = sourceStatus(input({
      status: "stale",
      error: "needs_authorization",
      connections: [...readable, connection("d", "Scaena · 片场委托", "source_unavailable"), connection("e", "Eikona · 旧项目（未授权）", "needs_authorization")],
      lanes: { active: { status: "forbidden" }, history: { status: "forbidden" } },
    }));
    expect(status).toMatchObject({ kind: "partial", readable: 3, total: 5, tone: "warning", label: "3/5 连接可读", lanes: [] });
    expect(status.gaps).toEqual([
      { id: "d", label: "Scaena · 片场委托", reason: "来源不可用" },
      { id: "e", label: "Eikona · 旧项目（未授权）", reason: "需要 owner 授权" },
    ]);
    expect(sourceLine(status, "任务列表", now)).toEqual({ text: "2 个连接暂不可读，任务列表可能不完整：Scaena · 片场委托、Eikona · 旧项目（未授权）", retry: false });
  });

  it("judges a connection by its own state, as the lanes strip and 服务与连接 do", () => {
    // A failed later history page marks only a channel; the connection still reads and keeps its count.
    const status = sourceStatus(input({ connections: [readable[0], connection("d", "Scaena · 片场委托", "ready", { history: { state: "invalid_task_page", observed_at: "2026-10-28T07:59:50Z" } })] }));
    expect(status).toMatchObject({ kind: "ready", label: "2/2 连接可读", gaps: [] });
    expect(sourceStatus(input({ connections: [connection("d", "Scaena · 片场委托", "source_rate_limited")] })).gaps[0].reason).toBe("来源限流");
  });

  it("calls data stale only when the whole read failed, with the time of the rows shown", () => {
    const status = sourceStatus(input({ status: "stale", error: "network_error", readFailed: true, observedAt: "2026-10-28T07:57:00Z" }));
    expect(status).toMatchObject({ kind: "stale", tone: "warning", label: "数据可能已过期" });
    expect(sourceLine(status, "资源库", now)).toEqual({ text: "数据可能已过期：最近一次读取失败，显示的是 3 分钟前的结果。", retry: true });
    expect(sourceLine(sourceStatus(input({ status: "stale", readFailed: true })), "资源库", now)?.text).toContain("显示的是刚刚的结果");
  });

  it("names a failed lane when no connection explains it", () => {
    const status = sourceStatus(input({ status: "stale", error: "source_unavailable", lanes: { active: { status: "ready" }, history: { status: "unavailable" } } }));
    expect(status).toMatchObject({ kind: "partial", lanes: ["历史任务"], label: "3/3 连接可读" });
    expect(sourceLine(status, "任务列表", now)).toEqual({ text: "历史任务暂不可读，任务列表可能不完整。", retry: true });
  });

  it("puts a lane whose own read failed ahead of connection states", () => {
    const status = sourceStatus(input({
      status: "stale",
      connections: [...readable, connection("d", "Scaena · 片场委托", "source_unavailable")],
      lanes: { active: { status: "unavailable", failed: true }, history: { status: "stale" } },
    }));
    expect(status).toMatchObject({ kind: "partial", lanes: ["进行中任务"], label: "进行中任务暂不可读" });
    expect(sourceLine(status, "资源库", now)).toEqual({ text: "进行中任务暂不可读，资源库可能不完整。", retry: true });
  });

  it("leaves down, empty and healthy sources to the page and the top bar", () => {
    const down = sourceStatus(input({ status: "unavailable", connections: [] }));
    expect(down).toMatchObject({ kind: "down", tone: "danger", label: "任务来源不可读" });
    expect(sourceLine(down, "任务列表", now)).toBeNull();
    const blocked = sourceStatus(input({ status: "forbidden", connections: [connection("e", "Eikona · 旧项目", "needs_authorization")] }));
    expect(blocked).toMatchObject({ kind: "down", label: "0/1 连接可读" });
    expect(sourceStatus(input({ status: "forbidden", error: "personal_connection_required", connections: [] }))).toMatchObject({ kind: "none", tone: "neutral", label: "无任务连接" });
    expect(sourceStatus(input({ status: "empty", connections: [] }))).toMatchObject({ kind: "none", label: "无任务连接" });
    expect(sourceStatus(input({ status: "loading" }))).toMatchObject({ kind: "loading", label: "读取连接…" });
    const ready = sourceStatus(input());
    expect(ready).toMatchObject({ kind: "ready", tone: "success", label: "3/3 连接可读" });
    expect(sourceLine(ready, "任务列表", now)).toBeNull();
  });
});

describe("cjkSpaced", () => {
  it("spaces only the ends that meet digits or Latin", () => {
    expect(cjkSpaced("刚刚")).toBe("刚刚");
    expect(cjkSpaced("3 分钟前")).toBe(" 3 分钟前");
    expect(cjkSpaced("10/28 15:11")).toBe(" 10/28 15:11 ");
  });
});
