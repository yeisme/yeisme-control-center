import type { TaskConnectionState } from "../task-observation";
import type { ReadStatus } from "./read-model/read-state";
import { cjkSpaced, formatRelative } from "./read-model/format";
import { connectionStateLabel } from "./read-model/tasks";

/**
 * One reading of the scope's task sources, shared by the top bar and by every page that lists observed tasks, so a
 * cause is described the same way wherever it shows. Connections are judged one by one, by the same connection state the
 * task lanes strip and 服务与连接 show: a single unreadable connection leaves the others' tasks current, which is a gap
 * in the list, not stale data.
 */
export type SourceStatusKind = "loading" | "ready" | "partial" | "stale" | "down" | "none";

export interface SourceGap {
  id: string;
  label: string;
  /** Readable reason, such as 来源不可用 or 需要 owner 授权. */
  reason: string;
}

export interface SourceStatus {
  kind: SourceStatusKind;
  readable: number;
  total: number;
  /** Connections that did not read, so the batch may lack some or all of their tasks. */
  gaps: SourceGap[];
  /** Task lanes missing from the batch: lanes whose own read failed, or failed lanes no connection explains. */
  lanes: string[];
  observedAt: string | null;
  tone: "neutral" | "success" | "warning" | "danger";
  /** Short label for the top bar. */
  label: string;
}

interface LaneInput { status: ReadStatus; failed?: boolean }

export interface SourceInput {
  status: ReadStatus;
  error: string | null;
  connections: TaskConnectionState[];
  observedAt: string | null;
  /** The latest observation cycle failed as a whole, so the rows come from an earlier cycle. */
  readFailed: boolean;
  lanes: { active: LaneInput; history: LaneInput };
}

const downStatuses: ReadStatus[] = ["forbidden", "unavailable", "unknown", "needs_contract", "login_required"];
const laneGap = (lane: LaneInput) => !["ready", "empty", "loading"].includes(lane.status);

export function sourceStatus(input: SourceInput): SourceStatus {
  const total = input.connections.length;
  const gaps = input.connections.filter((connection) => connection.state !== "ready").map((connection) => ({ id: connection.id, label: connection.label, reason: connectionStateLabel(connection.state || "not_checked") }));
  const readable = total - gaps.length;
  const named = [["进行中任务", input.lanes.active], ["历史任务", input.lanes.history]] as const;
  // A lane whose read failed outranks connection states: none of its tasks arrived, whatever the connections say.
  const failed = named.filter(([, lane]) => lane.failed && laneGap(lane)).map(([label]) => label);
  const lanes = failed.length ? failed : gaps.length ? [] : named.filter(([, lane]) => laneGap(lane)).map(([label]) => label);
  const count = `${readable}/${total} 连接可读`;
  const base = { readable, total, gaps, lanes, observedAt: input.observedAt };
  if (input.status === "loading") return { ...base, kind: "loading", tone: "neutral", label: "读取连接…" };
  if (input.status === "stale" && input.readFailed) return { ...base, kind: "stale", tone: "warning", label: "数据可能已过期" };
  if (input.error === "personal_connection_required" || (total === 0 && !downStatuses.includes(input.status))) return { ...base, kind: "none", tone: "neutral", label: "无任务连接" };
  if (downStatuses.includes(input.status)) return { ...base, kind: "down", tone: "danger", label: total ? count : "任务来源不可读" };
  if (failed.length) return { ...base, kind: "partial", tone: "warning", label: `${failed.join("、")}暂不可读` };
  if (gaps.length || lanes.length) return { ...base, kind: "partial", tone: readable === 0 ? "danger" : "warning", label: count };
  return { ...base, kind: "ready", tone: "success", label: count };
}

export interface SourceLine {
  text: string;
  /** Reading again may help: the whole read failed or a lane failed, rather than a connection reporting its state. */
  retry: boolean;
}

/**
 * The single line a page shows about its sources, or null when there is nothing to add. `noun` names what the page
 * lists. Pages show nothing when the sources are down: their empty state already explains that.
 */
export function sourceLine(status: SourceStatus, noun: string, now = Date.now()): SourceLine | null {
  if (status.kind === "stale") return { text: `数据可能已过期：最近一次读取失败，显示的是${cjkSpaced(status.observedAt ? formatRelative(status.observedAt, now) : "较早")}的结果。`, retry: true };
  if (status.kind !== "partial") return null;
  if (status.lanes.length) return { text: `${status.lanes.join("、")}暂不可读，${noun}可能不完整。`, retry: true };
  return { text: `${status.gaps.length} 个连接暂不可读，${noun}可能不完整：${status.gaps.map((gap) => gap.label).join("、")}`, retry: false };
}
