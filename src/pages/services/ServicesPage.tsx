import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, CircleDashed, CircleSlash, Clock3, LockKeyhole, Network, Plug, RefreshCw, ServerCog } from "../../icons";
import { api, type ServiceDirectoryEntry } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import type { ConnectionObservation } from "../../task-observation";
import type { ServiceConnectionProjection } from "../../service-directory";
import { Button, CoverageChip, Dot, EmptyState, InlineNotice, Panel, Pill, ReadStateView, SearchField, SegmentedTabs, SkeletonRows, StaleNotice, cx, type Tone } from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";
import { connectionStateLabel, connectionTone } from "../../shared/read-model/tasks";
import { createIdempotencyKey, runAction } from "../../shared/action-runner";

type Filter = "all" | "integrated" | "configured" | "gaps";

const kindLabels: Record<string, string> = { service: "服务", local_tool: "本地工具", workspace: "工作区", design: "设计原型" };
const integrationLabels: Record<string, string> = { task_observation: "任务观测", request_projection: "请求投影", collection_projection: "收集投影", not_integrated: "未接入" };
const configurationLabels: Record<string, { label: string; tone: Tone }> = {
  configured: { label: "已配置", tone: "success" },
  not_configured: { label: "未配置", tone: "neutral" },
  needs_contract: { label: "待合同", tone: "review" },
};

export default function ServicesPage() {
  const navigate = useNavigate();
  const read = useScopedRead((scope, signal) => api.services(scope, signal), { isEmpty: (data) => data.services.length === 0 });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const services = read.data?.services || [];
  const integrated = services.filter((service) => service.integration !== "not_integrated");
  const connections = integrated.flatMap((service) => service.connections.map((connection) => ({ service, connection })));
  const readyCount = connections.filter(({ connection }) => connection.runtime?.state === "ready").length;

  const visible = useMemo(() => services.filter((service) => {
    if (filter === "integrated" && service.integration === "not_integrated") return false;
    if (filter === "configured" && service.configuration !== "configured") return false;
    if (filter === "gaps" && service.integration !== "not_integrated" && service.configuration === "configured") return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${service.name} ${service.purpose} ${service.owner_path} ${service.gap}`.toLocaleLowerCase().includes(needle);
  }), [services, filter, query]);

  return <div className="page-enter space-y-5" data-page="services">
    <h1 className="sr-only">服务与连接</h1>
    <div className="flex flex-wrap items-center justify-end gap-2"><Button size="sm" onClick={read.reload} icon={<RefreshCw className="size-3.5" />}>重新观测</Button>{read.data && <>
        <Pill tone="success" icon={<CheckCircle2 />}>{readyCount}/{connections.length} 连接可读</Pill>
        <Pill tone="info" icon={<Network />}>{integrated.length} 项已接入合同</Pill>
        <Pill tone="neutral" icon={<CircleDashed />}>{services.length - integrated.length} 项未接入</Pill>
      </>}</div>
    <StaleNotice status={read.status} error={read.error} observedAt={read.observedAt} onRetry={read.reload} />

    <ReadStateView status={read.status} error={read.error} onRetry={read.reload} skeleton={<Panel><SkeletonRows rows={4} /></Panel>}>
      <section aria-label="已接入连接" className="space-y-3">
        <h2 className="text-[15px] font-semibold text-ink">任务连接</h2>
        {connections.length ? <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {connections.map(({ service, connection }) => <ConnectionCard key={service.id + connection.id} service={service} connection={connection} onTasks={() => navigate(`/tasks?connection=${encodeURIComponent(connection.id)}`)} />)}
        </div> : <Panel><EmptyState icon={<Plug />} title="当前范围没有任务连接" body="管理员需要在服务端配置 owner 观测连接；页面不会接受浏览器提交的地址。" /></Panel>}
      </section>

      {services.some((service) => service.id === "auctra") && <AuctraCollectionPanel />}

      <Panel
        title="服务目录"
        actions={<span className="text-2xs text-muted tabular">{visible.length} / {services.length}</span>}
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SegmentedTabs label="目录筛选" value={filter} onChange={setFilter} options={[
            { id: "all", label: "全部", count: services.length },
            { id: "integrated", label: "已接入", count: integrated.length },
            { id: "configured", label: "已配置", count: services.filter((service) => service.configuration === "configured").length },
            { id: "gaps", label: "缺口", count: services.filter((service) => service.integration === "not_integrated" || service.configuration !== "configured").length },
          ]} />
          <SearchField value={query} onChange={setQuery} placeholder="名称、用途、路径" label="搜索服务" className="ml-auto w-full sm:w-64" />
        </div>
        {visible.length ? <ul className="divide-y divide-line">
          {visible.map((service) => <ServiceRow key={service.id} service={service} />)}
        </ul> : <EmptyState compact title="没有匹配的服务" />}
      </Panel>
    </ReadStateView>
  </div>;
}

function AuctraCollectionPanel() {
  const { scopeId, session } = useWorkspace();
  const collection = useScopedRead((scope, signal) => api.auctraCollection(scope, { limit: 50 }, signal), { isEmpty: (data) => data.rows.length === 0 });
  const sync = async () => {
    if (!session?.csrf) return;
    await api.syncAuctraCollection(scopeId, { limit: 100 }, session.csrf);
    collection.reload();
  };
  const manage = async (record: { record_ref: string; metadata_revision: number; collection_state: string }, action: "collection.record.confirm" | "collection.record.archive") => {
    if (!session?.csrf) return;
    await runAction(api, { scope_id: scopeId, owner: "control-center", target_kind: "auctra_collection_record", target_ref: record.record_ref, action, expected_revision: String(record.metadata_revision), idempotency_key: createIdempotencyKey("collection") , input: { expected_revision: String(record.metadata_revision) } }, session.csrf);
    collection.reload();
  };
  const rows = collection.data?.rows || [];
  return <Panel title="Auctra 文本创作记录收集" actions={<Button size="sm" variant="secondary" onClick={() => void sync()} icon={<RefreshCw className="size-3.5" />}>同步记录</Button>}>
    <div className="space-y-3">
      <p className="text-[13px] text-muted">Control Center 只保存 refs、状态、摘要、时间和本地管理元数据；正文、路径和提示词留在 Auctra。</p>
      {collection.data && <div className="flex flex-wrap gap-2"><Pill tone={collection.data.coverage === "complete" ? "success" : "warning"}>覆盖：{collection.data.coverage}</Pill><Pill tone="neutral">{collection.data.total} 条记录</Pill></div>}
      <ReadStateView status={collection.status} error={collection.error} onRetry={collection.reload} skeleton={<SkeletonRows rows={3} />}>
        {rows.length ? <ul className="divide-y divide-line rounded-control border border-line">{rows.map((row) => <li key={row.record_ref} className="flex flex-wrap items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-ink">{row.title || row.record_ref}</p><p className="truncate text-2xs text-muted">{row.record_kind} · {row.status || "unknown"} · {row.source_state}</p></div><Pill tone={row.collection_state === "confirmed" ? "success" : row.collection_state === "archived" ? "neutral" : "warning"}>{row.collection_state}</Pill>{row.collection_state !== "confirmed" && row.collection_state !== "archived" && <Button size="sm" variant="ghost" onClick={() => void manage(row, "collection.record.confirm")}>确认</Button>}{row.collection_state !== "archived" && <Button size="sm" variant="ghost" onClick={() => void manage(row, "collection.record.archive")}>归档</Button>}</li>)}</ul> : <EmptyState compact title="还没有收集记录" body="点击“同步记录”从 Auctra 拉取当前授权范围的脱敏记录。" />}
      </ReadStateView>
    </div>
  </Panel>;
}

function ServiceRow({ service }: { service: ServiceDirectoryEntry }) {
  const configuration = configurationLabels[service.configuration] || configurationLabels.not_configured;
  return <li className="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] sm:items-center">
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-panel-sunken text-muted"><ServerCog className="size-[17px]" /></span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-ink">{service.name}</p>
        <p className="truncate font-mono text-2xs text-faint">{service.owner_path}</p>
      </div>
    </div>
    <div className="min-w-0 text-[13px]">
      <p className="truncate text-ink-soft">{service.purpose}</p>
      <p className="truncate text-2xs text-muted" title={service.gap}>{service.gap}</p>
    </div>
    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
      <Pill tone="neutral">{kindLabels[service.kind] || service.kind}</Pill>
      <Pill tone={service.integration === "not_integrated" ? "neutral" : "info"}>{integrationLabels[service.integration] || service.integration}</Pill>
      <Pill tone={configuration.tone}>{configuration.label}</Pill>
      {service.coverage && <CoverageChip state={service.coverage.state} />}
    </div>
  </li>;
}

const dimensionTone = (value: string): Tone => ["verified", "supported"].includes(value) ? "success" : ["denied", "unsupported"].includes(value) ? "danger" : value === "not_requested" ? "neutral" : "warning";

const dimensionLabels: Record<string, string> = {
  verified: "已验证",
  unknown: "未知",
  denied: "已拒绝",
  supported: "支持",
  unsupported: "不支持",
  not_requested: "未开启",
  not_verified: "未验证",
};
const channelLabels: Record<string, string> = {
  connection: "连接",
  active: "进行中",
  history: "历史",
  detail: "详情",
  events: "事件",
  artifacts: "结果",
};
const channelTone = (state: string): Tone => state === "ready" ? "success" : ["forbidden", "needs_authorization"].includes(state) ? "danger" : state === "needs_contract" ? "review" : "warning";

function ConnectionCard({ service, connection, onTasks }: { service: ServiceDirectoryEntry; connection: ServiceConnectionProjection; onTasks: () => void }) {
  const runtime: ConnectionObservation | undefined = connection.runtime;
  const state = runtime?.state || (connection.enabled ? "not_checked" : "disabled");
  const dims = [
    { label: "传输", value: runtime?.transport || "unknown", icon: <Network /> },
    { label: "授权", value: runtime?.authorization || "unknown", icon: <LockKeyhole /> },
    { label: "合同", value: runtime?.contract || "unknown", icon: <Plug /> },
    { label: "内容", value: runtime?.content || (connection.content_requested ? "not_verified" : "not_requested"), icon: <CircleSlash /> },
  ];
  return <article className="flex min-w-0 flex-col rounded-card border border-line bg-panel p-4 shadow-panel">
    <header className="flex items-start gap-3">
      <Dot tone={state === "disabled" ? "neutral" : connectionTone(state)} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-ink">{connection.label}</h3>
        <p className="truncate text-2xs text-muted">{service.name} · {connection.environment} · 项目 {connection.project}</p>
      </div>
      <Pill tone={state === "disabled" ? "neutral" : connectionTone(state)}>{state === "disabled" ? "已停用" : connectionStateLabel(state)}</Pill>
    </header>
    <dl className="mt-4 grid grid-cols-2 gap-2">
      {dims.map((dim) => <div key={dim.label} className="flex items-center justify-between gap-2 rounded-[9px] bg-panel-soft px-2.5 py-2">
        <dt className="flex items-center gap-1.5 text-2xs text-muted [&>svg]:size-3.5">{dim.icon}{dim.label}</dt>
        <dd><Pill tone={dimensionTone(dim.value)} className="h-5 px-1.5 text-2xs">{dimensionLabels[dim.value] || dim.value}</Pill></dd>
      </div>)}
    </dl>
    {runtime?.channels && Object.keys(runtime.channels).length > 0 && <div className="mt-3 rounded-[9px] border border-line bg-panel-soft p-2.5">
      <p className="text-2xs font-medium text-muted">运行读取通道</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(runtime.channels).map(([channel, observation]) => observation && <Pill key={channel} tone={channelTone(observation.state)} className="h-5 px-1.5 text-2xs" title={observation.reason || undefined}>{channelLabels[channel] || channel} · {connectionStateLabel(observation.state)}</Pill>)}
      </div>
    </div>}
    {runtime?.task_families?.length ? <p className="mt-3 truncate text-2xs text-muted">任务族：<span className="font-mono">{runtime.task_families.join(", ")}</span></p> : null}
    {runtime?.reason && runtime.state !== "ready" && <InlineNotice tone="warning" className="mt-3 py-2 text-2xs">原因：{runtime.reason}</InlineNotice>}
    <footer className="mt-auto flex items-center justify-between gap-2 pt-4 text-2xs text-muted">
      <span className="flex min-w-0 items-center gap-1.5"><Clock3 className="size-3.5 shrink-0" /><span className="truncate">{runtime ? `检查于 ${formatRelative(runtime.checked_at)} · 最近成功 ${runtime.last_success_at ? formatRelative(runtime.last_success_at) : "无"}` : "未观测"}</span></span>
      <Button size="sm" variant="ghost" onClick={onTasks}>查看任务<ArrowRight className="size-3.5" /></Button>
    </footer>
  </article>;
}
