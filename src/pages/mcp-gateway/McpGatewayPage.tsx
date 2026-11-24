import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Clock3, Server, ShieldCheck } from "../../icons";
import { useScopedRead } from "../../app/workspace";
import { api } from "../../shared/api/control-center-client";
import { EmptyState, PageToolbar, Panel, Pill, SkeletonRows, StatCard, cx } from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";
import type { GatewayMonitorSnapshot } from "../../shared/gateway-monitor";
import { diagnoseMcpConnection } from "../../shared/skill-template-experience";

const tone = (state: string) => {
  if (state === "ready") return "success";
  if (state === "degraded") return "warning";
  if (state === "forbidden" || state === "unavailable") return "danger";
  return "review";
};
const gatewayStatusLabel = (snapshot: GatewayMonitorSnapshot) => {
  if (snapshot.state === "ready" && snapshot.telemetry) return "MCP 工具发现正常 · 调用未验证";
  if (snapshot.state === "degraded") return "MCP 部分可用 · 观测不完整";
  if (snapshot.state === "forbidden") return "MCP 已连接但无权读取观测";
  if (snapshot.state === "needs_contract") return "MCP 合同未对齐";
  return "MCP 不可用";
};

export default function McpGatewayPage() {
  const navigate = useNavigate();
  const read = useScopedRead((scope, signal) => api.gatewayMonitor(scope, signal), { key: "gateway-monitor", cacheKey: "gateway-monitor" });
  const snapshot = read.data as GatewayMonitorSnapshot | undefined;
  const failed = useMemo(() => snapshot?.calls.filter((call) => call.state === "failed" || call.state === "unknown").length || 0, [snapshot]);
  const diagnosis = snapshot ? diagnoseMcpConnection({
    configured: true,
    transport: snapshot.state !== "unavailable",
    protocol: snapshot.state === "ready" || snapshot.state === "degraded",
    tools: snapshot.telemetry ? snapshot.telemetry.backends.length : null,
    schemaValid: snapshot.coverage.state !== "needs_contract",
    invocation: snapshot.state === "forbidden" ? "forbidden" : "unverified",
    degraded: snapshot.state === "degraded" || snapshot.coverage.state === "partial",
  }) : null;
  return <div className="page-enter space-y-5" data-page="mcp-gateway">
    <h1 className="sr-only">MCP 网关</h1>
    <PageToolbar lead="MCP 网关" summary="这里判断的是 MCP 协议是否能被客户端调用；管理配置另行授权。原始参数、完整输出和凭据不会进入控制中心。" actions={<button type="button" className="text-meta text-muted underline" onClick={() => navigate("/agents")}>打开 Agent 监控 <ArrowRight className="inline size-3.5" /></button>} />
    {read.status === "loading" && !snapshot ? <Panel><SkeletonRows rows={8} /></Panel> : read.error && !snapshot ? <EmptyState icon={<Server />} title="网关暂时不可读" body="控制中心没有把网络失败解释成网关没有运行。请稍后重试或检查服务连接。" /> : !snapshot ? <EmptyState icon={<Server />} title="尚未配置 MCP 网关" body="当前范围没有开放工具连接。" /> : <>{read.error && <p className="rounded-card border border-warning/30 bg-warning-soft px-4 py-2 text-meta text-warning" role="status">显示的是上一次成功读取，当前读数可能已过期。</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="网关状态" value={<Pill tone={tone(snapshot.state) as never}>{gatewayStatusLabel(snapshot)}</Pill>} icon={<ShieldCheck />} />
        <StatCard label="活跃会话" value={snapshot.telemetry?.active_sessions ?? "未知"} icon={<Server />} />
        <StatCard label="调用" value={snapshot.telemetry?.rpc_calls ?? "未知"} icon={<Clock3 />} />
        <StatCard label="待处理调用" value={failed} icon={<ShieldCheck />} />
      </div>
      {diagnosis && <Panel title="连接诊断与下一步">
        <p className="text-body-sm text-ink">{diagnosis.label}</p>
        <p className="mt-1 text-meta text-muted">{diagnosis.detail}</p>
        <p className="mt-3 text-meta text-ink">下一步：{diagnosis.next_action}</p>
        <button type="button" className="mt-3 text-meta text-accent underline" onClick={() => navigate("/capabilities?tab=tools")}>查看 Skills 与模板推荐</button>
      </Panel>}
      <Panel title="后端">
        <p className="mb-3 text-meta text-muted">Gateway 已报告的后端状态；不代表领域 owner 的任务已完成。任务结果请回到任务中心查看。</p>
        <ul className="divide-y divide-line">{snapshot.telemetry?.backends.map((backend) => <li key={backend.id} className="flex items-center justify-between gap-3 py-3"><span className="font-medium text-ink">{backend.id}</span><span className="text-meta text-muted">{backend.protocol || "协议未知"} · {backend.freshness}<Pill size="sm" tone={tone(backend.state) as never} className="ml-2">{backend.state}</Pill></span></li>)}</ul>
      </Panel>
      <Panel title="最近调用">
        <p className="mb-3 text-meta text-muted">失败和结果未知只提供原调用引用，后续动作必须查询原操作。</p>
        {snapshot.calls.length ? <ul className="divide-y divide-line">{snapshot.calls.slice(0, 12).map((call) => <li key={call.call_ref}><button className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-panel-sunken" onClick={() => navigate(`/agents?call=${encodeURIComponent(call.call_ref)}`)}><span className="min-w-0 truncate text-body-sm text-ink">{call.tool || "未命名工具"}<span className="ml-2 text-2xs text-muted">{call.call_ref}</span></span><span className={cx("shrink-0 text-meta", call.state === "failed" ? "text-danger" : call.state === "unknown" ? "text-warning" : "text-muted")}>{call.state} · {formatRelative(call.updated_at)}</span></button></li>)}</ul> : <p className="py-3 text-meta text-muted">没有可读的调用记录。</p>}
      </Panel>
      <Panel title="客户端接入预设">
        <p className="mb-3 text-meta text-muted">预设只包含环境变量占位符，不包含任何密钥。</p>
        <div className="grid gap-2 sm:grid-cols-2">{snapshot.presets.map((preset) => <div key={preset.id} className="rounded-card border border-line bg-panel-sunken p-3"><p className="font-medium text-ink">{preset.label}</p><code className="mt-2 block whitespace-pre-wrap break-words text-2xs text-muted">{preset.config}</code></div>)}</div>
      </Panel>
    </>}
  </div>;
}
