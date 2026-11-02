import type { OpenToolConnection } from "../contracts";
import { normalizeTools } from "../tool-catalog-normalize";
import type { OpenToolBackend, OpenToolCheck, OpenToolOperation, OpenToolOperationState, OpenToolUsage } from "../../src/shared/open-tools";
import { openToolChecks, projection, summarizeOperations } from "./projection";
import { code, count, list, record, ref, time, OpenToolClient, type Fetcher, type OpenToolAdapter, type OpenToolObservation, type RouteRead } from "./types";

const runStates: Record<string, OpenToolOperationState> = { succeeded: "succeeded", failed: "failed" };
const kindLabels: Record<string, string> = {
  tool_invocation: "工具调用",
  runtime_change: "运行时变更",
  runtime_reload: "重新加载",
  runtime_restart: "重启",
  admin_apply: "管理变更",
};

const check = (id: string, label: string, read: RouteRead): OpenToolCheck => read.ok ? { id, label, state: "ok" } : { id, label, state: read.state, reason: read.reason };

/** Gateway tool names are `<namespace>_<tool>`; the longest matching namespace names the backend. */
function backendOf(name: unknown, namespaces: { id: string; namespace: string }[]) {
  if (typeof name !== "string") return undefined;
  const match = namespaces.filter((entry) => entry.namespace && name.startsWith(entry.namespace + "_")).sort((a, b) => b.namespace.length - a.namespace.length)[0];
  return match?.id;
}

export function gatewayOperation(raw: unknown, namespaces: { id: string; namespace: string }[] = []): OpenToolOperation | null {
  const row = record(raw);
  const id = ref(row.id);
  const updated = time(row.updated_at) || time(row.created_at);
  if (!id || !updated) return null;
  const native = code(row.status, "unknown");
  const kind = code(row.kind, "operation");
  const result = record(row.result);
  // `result.error` is owner text; only an explicit code survives. The result body itself is never kept.
  const errorCode = code(result.error_code);
  const backend = backendOf(result.tool, namespaces);
  return {
    ref: id,
    kind,
    label: kindLabels[kind] || kind,
    state: runStates[native] || "unknown",
    native_state: native,
    updated_at: updated,
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(backend ? { backend } : {}),
  };
}

export function gatewayUsage(body: unknown): OpenToolUsage | undefined {
  const value = record(body);
  const hop = record(value.hop_usage);
  const calls = count(hop.calls);
  if (calls === null) return undefined;
  const from = Date.parse(String(value.from || "")), to = Date.parse(String(value.to || ""));
  const days = Number.isFinite(from) && Number.isFinite(to) && to > from ? Math.max(1, Math.round((to - from) / 86_400_000)) : 7;
  const backends = Object.entries(record(value.groups)).flatMap(([key, group]) => {
    const id = ref(key);
    const counts = record(group);
    return id ? [{ id, calls: count(counts.calls) ?? 0, failures: count(counts.failures) ?? 0, p95_ms: count(counts.latency_p95_ms) }] : [];
  }).sort((a, b) => b.calls - a.calls).slice(0, 20);
  return { window: `${days} 天`, calls, failures: count(hop.failures) ?? 0, p95_ms: count(hop.latency_p95_ms), backends };
}

/**
 * The personal MCP Gateway with a workspace-bound token (`mcp:tools:read`, `mcp:audit:read`): readiness, the token's
 * own subject, backends, the tool index, REST runs and 7-day usage. Backend addresses, `last_error` text, missing
 * environment variable names and run results are dropped; `/healthz` (a local file path) and `/v1/runtime/state`
 * (process details) are never read.
 */
export class GatewayAdapter implements OpenToolAdapter {
  readonly tool = "gateway" as const;
  private readonly client: OpenToolClient;
  constructor(private readonly connection: OpenToolConnection, fetcher: Fetcher) {
    this.client = new OpenToolClient(connection, fetcher);
  }

  async observe(): Promise<OpenToolObservation> {
    const [ready, subject, backendList, toolIndex, operations, usage] = await Promise.all([
      this.client.get("/readyz", { auth: false, bodyOn: [503] }),
      this.client.get("/v1/tenants/current"),
      this.client.get("/v1/backends"),
      this.client.get("/v1/tools"),
      this.client.get("/v1/operations"),
      this.client.get("/v1/usage?group_by=backend"),
    ]);
    const readiness = record(ready.body);
    const isReady = ready.ok && readiness.ready === true;
    const failed = new Set(list(readiness.failed_backends).map(ref).filter(Boolean));
    // Without a workspace the Gateway lists no backends and refuses runs and usage; say so once.
    const workspace = subject.ok && !!ref(record(record(subject.body).subject).workspace_id);
    const credential: OpenToolCheck = subject.ok && !workspace ? { id: "credential", label: "令牌", state: "forbidden", reason: "gateway_workspace_unbound" } : check("credential", "令牌", subject);
    const health: OpenToolCheck = ready.ok ? (isReady ? { id: "health", label: "就绪", state: "ok" } : { id: "health", label: "就绪", state: "failed", reason: "gateway_not_ready" })
      : failed.size ? { id: "health", label: "就绪", state: "failed", reason: "gateway_not_ready" } : check("health", "就绪", ready);

    const index = record(toolIndex.ok ? toolIndex.body : null);
    const tools = toolIndex.ok ? normalizeTools("gateway", list(index.tools)) : null;
    const degradedIds = new Set(list(record(index.cache).degraded_backends).map(ref).filter(Boolean));
    const backends: OpenToolBackend[] = backendList.ok ? list(record(backendList.body).backends).flatMap((raw): OpenToolBackend[] => {
      const row = record(raw);
      const id = ref(row.id);
      if (!id) return [];
      const enabled = row.enabled !== false;
      const native = code(row.status, "unknown");
      const namespace = code(row.namespace) || null;
      const live = tools && namespace ? tools.filter((tool) => tool.name.startsWith(namespace + "_")).length : null;
      const state = !enabled ? "disabled" : failed.has(id) ? "down" : native === "misconfigured" || degradedIds.has(id) ? "degraded" : isReady ? "ready" : "unknown";
      return [{ id, namespace, enabled, state, native_state: native, tool_count: live ?? count(row.tool_count), checked_at: time(row.last_checked_at) }];
    }).slice(0, 50) : [];
    const namespaces = backends.flatMap((backend) => backend.namespace ? [{ id: backend.id, namespace: backend.namespace }] : []);

    const rows = operations.ok ? list(record(operations.body).operations).map((raw) => gatewayOperation(raw, namespaces)).filter((row): row is OpenToolOperation => !!row) : [];
    const runSummary = operations.ok
      ? summarizeOperations(rows, "partial", "gateway_rest_operations_only", { attention: (run) => run.state === "failed" })
      : summarizeOperations([], operations.state === "forbidden" ? "forbidden" : operations.state === "needs_contract" ? "needs_contract" : "unavailable", operations.reason);
    const usageSummary = usage.ok ? gatewayUsage(usage.body) : undefined;
    const attention = backends.some((backend) => backend.enabled && (backend.state === "down" || backend.state === "degraded"));
    const facts = [
      ...(tools ? [{ label: "工具", value: `${tools.length} 个` }] : []),
      ...(record(index.cache).stale === true ? [{ label: "工具目录", value: "缓存已过期" }] : []),
    ];
    return {
      projection: projection({
        tool: this.tool,
        label: this.connection.label,
        checks: [health, credential, check("backends", "后端", backendList), check("tools", "工具", toolIndex), check("operations", "运行记录", operations), check("usage", "用量", usage)],
        primary: ["credential", "backends", "tools", "operations", "usage"],
        // The owner console issues ordinary consumer credentials, which cannot read usage (mcp:audit:read).
        optional: openToolChecks.gateway.optional,
        degraded: attention,
        degradedReason: backends.some((backend) => backend.state === "down") ? "open_tool_backend_down" : "gateway_backend_degraded",
        facts,
        operations: runSummary,
        backends,
        ...(usageSummary ? { usage: usageSummary } : {}),
      }),
      tools,
    };
  }
}
