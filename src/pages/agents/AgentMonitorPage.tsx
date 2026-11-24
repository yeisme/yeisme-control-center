import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, Clock3, CircleHelp, Server } from "../../icons";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { api } from "../../shared/api/control-center-client";
import { EmptyState, PageToolbar, Panel, Pill, SkeletonRows, StatCard } from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";

export default function AgentMonitorPage() {
  const { scopeId, generation, expire } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const read = useScopedRead((scope, signal) => api.gatewayMonitor(scope, signal), { key: "agent-monitor", cacheKey: "gateway-monitor" });
  const snapshot = read.data;

  const selected = params.get("call");
  const calls = useMemo(() => snapshot?.calls || [], [snapshot]);
  const detailRead = useScopedRead((scope, signal) => api.gatewayCall(scope, selected!, signal), { key: selected || "", enabled: !!selected });
  const detail = detailRead.data;
  const [streamState, setStreamState] = useState<"polling" | "sse" | "degraded">("polling");
  useEffect(() => {
    if (!scopeId) return;
    let source: EventSource | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const coalesce = () => { if (!refresh) refresh = setTimeout(() => { refresh = undefined; read.reload(); }, 500); };
    const stop = () => { source?.close(); source = undefined; clearInterval(poll); poll = undefined; clearTimeout(refresh); refresh = undefined; };
    const start = () => {
      stop();
      if (stopped || document.visibilityState !== "visible") return;
      setStreamState("polling"); read.reload();
      source = new EventSource(api.gatewayEventsUrl(scopeId));
      source.addEventListener("open", () => setStreamState("sse"));
      for (const event of ["ready", "gateway_event", "cursor_gap"]) source.addEventListener(event, coalesce);
      source.addEventListener("error", () => {
        source?.close(); source = undefined;
        setStreamState("degraded");
        poll = setInterval(() => read.reload(), 12_000);
      });
    };
    const visibility = () => { if (document.visibilityState === "visible") start(); else stop(); };
    document.addEventListener("visibilitychange", visibility); start();
    return () => { stopped = true; document.removeEventListener("visibilitychange", visibility); stop(); };
  }, [scopeId, generation, read.reload]);
  useEffect(() => {
    if (read.error && ["login_required", "session_expired"].includes(read.error)) expire();
  }, [read.error, expire]);
  return <div className="page-enter space-y-5" data-page="agents">
    <h1 className="sr-only">Agent 监控</h1>
    <PageToolbar lead="Agent 监控" summary="只显示 Gateway 已明确记录的 Agent 会话和调用关联；没有 exact gateway_call_ref 时保持未知。" meta={<Pill size="sm" tone={streamState === "sse" ? "success" : streamState === "degraded" ? "warning" : "neutral"}>{streamState === "sse" ? "实时事件" : streamState === "degraded" ? "事件流不可用，轮询中" : "轮询"}</Pill>} />
    {read.status === "loading" && !snapshot ? <Panel><SkeletonRows rows={7} /></Panel> : !snapshot ? <EmptyState icon={<Activity />} title="没有 Agent 监控读数" body="当前范围没有可读的 Gateway 个人遥测。" /> : <>{read.error && <p className="rounded-card border border-warning/30 bg-warning-soft px-4 py-2 text-meta text-warning">实时读取失败，当前页面保留上一批数据。</p>}
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="活跃会话" value={snapshot.telemetry?.active_sessions ?? "未知"} icon={<CircleHelp />} /><StatCard label="调用总数" value={snapshot.telemetry?.rpc_calls ?? "未知"} icon={<Activity />} /><StatCard label="代理 p95" value={snapshot.telemetry?.proxy_latency_p95_ms == null ? "未知" : `${snapshot.telemetry.proxy_latency_p95_ms} ms`} icon={<Clock3 />} /></div>
      <Panel title="Agent 会话"><p className="mb-3 text-meta text-muted">会话引用来自 Gateway；不展示 token、参数或完整响应。</p><ul className="divide-y divide-line">{snapshot.sessions.map((session) => <li key={session.session_ref} className="flex items-center justify-between gap-3 py-3"><span><span className="font-medium text-ink">{session.session_ref}</span><span className="ml-2 text-2xs text-muted">{session.protocol_version || "协议未知"}</span></span><span className="text-meta text-muted"><Pill size="sm" tone={session.active ? "success" : "neutral"}>{session.active ? "活跃" : "已结束"}</Pill> · {session.calls} 次调用 · {formatRelative(session.updated_at)}</span></li>)}</ul></Panel>
      <Panel title="调用链"><p className="mb-3 text-meta text-muted">{selected ? `已选调用 ${selected}` : "调用与领域任务只有在 exact origin_refs.gateway_call_ref 相等时才关联。"}</p><ul className="divide-y divide-line">{calls.map((call) => <li key={call.call_ref}><button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-panel-sunken" onClick={() => { const next = new URLSearchParams(params); next.set("call", call.call_ref); setParams(next); }}><span className="min-w-0 truncate text-body-sm text-ink">{call.tool || "未命名工具"}<span className="ml-2 text-2xs text-muted">{call.call_ref}</span></span><span className="shrink-0 text-meta text-muted">{call.state} · {call.backend || "后端未知"}</span></button></li>)}</ul>{!calls.length && <p className="py-3 text-meta text-muted">没有调用链记录。</p>}{selected && detailRead.status === "loading" && <SkeletonRows rows={2} />}{selected && detailRead.error && <p role="status" className="text-meta text-warning">调用详情读取失败；请重试。</p>}{detail && detail.call_ref === selected && <div className="mt-3 rounded-card border border-line bg-panel-sunken p-3"><p className="text-meta font-medium text-ink">调用详情 · {detail.call_ref}</p><p className="mt-1 text-2xs text-muted">恢复：{detail.recovery} · 事件 {detail.events.length} 条</p><ul className="mt-2 space-y-1 text-2xs text-muted">{detail.events.map((event) => <li key={`${event.at}-${event.stage}`}>{event.stage} · {event.state} · {formatRelative(event.at)}</li>)}</ul></div>}</Panel>
      <Panel title="底层遥测"><p className="mb-3 text-meta text-muted">Gateway 只返回聚合计数和延迟，不返回原始 Agent 内容。</p><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-card border border-line bg-panel-sunken p-3"><Server className="size-4 text-muted" /><p className="mt-2 text-meta text-muted">上游 p95</p><p className="font-semibold text-ink">{snapshot.telemetry?.upstream_latency_p95_ms == null ? "未知" : `${snapshot.telemetry.upstream_latency_p95_ms} ms`}</p></div><div className="rounded-card border border-line bg-panel-sunken p-3"><Activity className="size-4 text-muted" /><p className="mt-2 text-meta text-muted">Token 估算</p><p className="font-semibold text-ink">{snapshot.telemetry?.token_estimate == null ? "未知" : snapshot.telemetry.token_estimate}</p></div></div></Panel>
    </>}
  </div>;
}
