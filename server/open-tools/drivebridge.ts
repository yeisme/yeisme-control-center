import type { OpenToolConnection } from "../contracts";
import type { OpenToolCheck, OpenToolOperation, OpenToolOperationState } from "../../src/shared/open-tools";
import { projection, summarizeOperations } from "./projection";
import { code, count, list, record, ref, time, OpenToolClient, type Fetcher, type OpenToolAdapter, type OpenToolObservation, type RouteRead } from "./types";

/** DriveBridge run statuses (files.go, lifecycle.go); anything else is shown as unknown, never guessed. */
const runStates: Record<string, OpenToolOperationState> = {
  awaiting_upload: "queued",
  transferring: "running",
  verifying: "running",
  running: "running",
  completed: "succeeded",
  failed: "failed",
  // The transfer stopped part way (a restart, a lost connection) and has to be resumed.
  interrupted: "failed",
  cancelled: "cancelled",
};

const kindLabels: Record<string, string> = {
  upload: "上传",
  upload_batch: "批量上传",
  archive: "归档",
  copy: "复制",
  directory_copy: "目录复制",
  import: "导入",
  export: "导出",
  directory_export: "目录导出",
  transfer_plan: "传输计划",
  cloud_scan: "云盘扫描",
  content_process: "内容处理",
  file_thread: "文件讨论",
  thread_reply: "讨论回复",
  projection_rebuild: "索引重建",
};

/** DriveBridge writes snake_case error codes; any other value (one path still writes raw text) is dropped. */
const errorCode = (value: unknown) => typeof value === "string" && /^[a-z][a-z_]{0,79}$/.test(value) ? value : "";

const check = (id: string, label: string, read: RouteRead): OpenToolCheck => read.ok ? { id, label, state: "ok" } : { id, label, state: read.state, reason: read.reason };

const formatSize = (bytes: number) => bytes >= 1073741824 ? `${Math.round(bytes / 1073741824)} GiB` : `${Math.max(1, Math.round(bytes / 1048576))} MiB`;

/** The `{ "data": … }` envelope DriveBridge wraps every JSON answer in. */
const data = (body: unknown) => record(body).data;

export function driveBridgeOperation(raw: unknown): OpenToolOperation | null {
  const row = record(raw);
  const id = ref(row.id);
  const updated = time(row.updated_at) || time(row.created_at);
  if (!id || !updated) return null;
  const native = code(row.status, "unknown");
  const kind = code(row.kind, "operation");
  const size = count(row.size_bytes);
  const files = count(row.total_files);
  const filesDone = count(row.progress_files);
  const bytesDone = count(row.bytes_transferred);
  const progress = files && files > 1 && filesDone !== null ? { done: Math.min(filesDone, files), total: files, unit: "files" as const }
    : size && bytesDone !== null ? { done: Math.min(bytesDone, size), total: size, unit: "bytes" as const } : undefined;
  const error = errorCode(row.error);
  return {
    ref: id,
    kind,
    label: kindLabels[kind] || kind,
    state: runStates[native] || "unknown",
    native_state: native,
    updated_at: updated,
    ...(progress ? { progress } : {}),
    ...(size !== null ? { size_bytes: size } : {}),
    ...(error ? { error_code: error } : {}),
  };
}

/**
 * DriveBridge with a space-scoped Agent token: health, capabilities and the run list. Agent tokens cannot read space
 * capacity or files, so coverage stays partial; paths, file names, digests and owner error text are dropped here.
 */
export class DriveBridgeAdapter implements OpenToolAdapter {
  readonly tool = "drivebridge" as const;
  // DriveBridge writes an audit row for every authenticated call, so it is read every two minutes at most.
  readonly ttlMs = 120_000;
  private readonly client: OpenToolClient;
  constructor(private readonly connection: OpenToolConnection, fetcher: Fetcher) {
    this.client = new OpenToolClient(connection, fetcher);
  }

  async observe(): Promise<OpenToolObservation> {
    const [health, capabilities, operations] = await Promise.all([
      this.client.get("/healthz", { auth: false }),
      this.client.get("/api/v1/capabilities"),
      this.client.get("/api/v1/operations?limit=50"),
    ]);
    // A server started without --enabled answers its health route and refuses everything else.
    const disabled = health.ok && record(data(health.body)).enabled === false;
    const named = (read: RouteRead): RouteRead => disabled && !read.ok && read.state === "unavailable" ? { ...read, reason: "drivebridge_disabled" } : read;
    const caps = named(capabilities);
    const runs = named(operations);
    const checks = [
      disabled ? { id: "health", label: "健康", state: "failed" as const, reason: "drivebridge_disabled" } : check("health", "健康", health),
      check("capabilities", "能力", caps),
      check("operations", "运行记录", runs),
    ];
    const facts: { label: string; value: string }[] = [];
    if (caps.ok) {
      const body = record(data(caps.body));
      const version = code(body.spec_version);
      if (version) facts.push({ label: "接口", value: version });
      const part = count(body.part_size);
      if (part) facts.push({ label: "分块", value: formatSize(part) });
      const maxFile = count(record(body.limits).max_file_bytes);
      if (maxFile) facts.push({ label: "单文件上限", value: formatSize(maxFile) });
    }
    const rows = runs.ok ? list(data(runs.body)).map(driveBridgeOperation).filter((row): row is OpenToolOperation => !!row) : [];
    // A status this adapter does not know shows as unknown but is not raised as an unknown outcome.
    const raise = (run: OpenToolOperation) => (run.state === "failed" || run.state === "unknown") && run.native_state in runStates;
    const summary = runs.ok
      ? summarizeOperations(rows, "partial", "agent_token_operations_only", { attention: raise })
      : summarizeOperations([], runs.state === "forbidden" ? "forbidden" : runs.state === "needs_contract" ? "needs_contract" : "unavailable", runs.reason);
    return {
      projection: projection({
        tool: this.tool,
        label: this.connection.label,
        checks,
        primary: ["capabilities", "operations"],
        facts,
        operations: summary,
        // An Agent token sees runs but not space capacity or files, so a full reading is still partial.
        coverage: runs.ok ? { state: "partial", reason: "agent_token_operations_only" } : undefined,
      }),
      tools: null,
    };
  }
}
