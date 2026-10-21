import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Clock3, LayoutGrid, Palette, Plug, RefreshCw, Server, Terminal } from "../../icons";
import { api, type ServiceDirectoryEntry } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import type { ConnectionObservation } from "../../task-observation";
import type { ServiceConnectionProjection } from "../../service-directory";
import { Button, CoverageChip, DataTable, Dot, EmptyState, InlineNotice, MetricStrip, PageToolbar, Panel, Pill, ReadStateView, SearchField, SkeletonRows, StaleNotice, ToggleGroup, cx, type Column, type Tone } from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";
import { freshnessLabels, labelFrom, reasonLabel } from "../../shared/read-model/labels";
import { connectionStateLabel, connectionTone } from "../../shared/read-model/tasks";
import { taskStateLabels } from "../../task-observation";
import { createIdempotencyKey, runAction } from "../../shared/action-runner";

type Filter = "all" | "integrated" | "configured" | "gaps";

const kindLabels: Record<string, string> = { service: "服务", local_tool: "本地工具", workspace: "工作区", design: "设计原型" };
const kindIcons: Record<string, ReactNode> = { service: <Server />, local_tool: <Terminal />, workspace: <LayoutGrid />, design: <Palette /> };
const integrationLabels: Record<string, string> = { task_observation: "任务观测", request_projection: "请求投影", collection_projection: "收集投影", not_integrated: "未接入" };
const configurationLabels: Record<string, { label: string; tone: Tone }> = {
  configured: { label: "已配置", tone: "success" },
  not_configured: { label: "未配置", tone: "neutral" },
  needs_contract: { label: "待合同", tone: "review" },
};
const toneText: Record<Tone, string> = { success: "text-success", info: "text-info", warning: "text-warning", danger: "text-danger", review: "text-review", neutral: "text-muted" };
const readableToken = /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)*$/;

/** Owner reasons may be state codes; readable owner text passes through unchanged. */
function reasonText(reason: string) {
  if (!readableToken.test(reason)) return reason;
  const connection = connectionStateLabel(reason);
  return connection !== reason ? connection : reasonLabel(reason) || reason;
}

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

  const columns: Column<ServiceDirectoryEntry>[] = [
    { id: "service", header: "服务", cell: (service) => <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-control bg-panel-sunken text-muted [&>svg]:size-[17px]">{kindIcons[service.kind] || <Server />}</span>
      <div className="min-w-0">
        <p className="truncate text-body-sm font-semibold text-ink">{service.name}</p>
        <p className="truncate font-mono text-2xs text-faint">{service.owner_path}</p>
        <p className="mt-0.5 line-clamp-2 text-2xs text-muted @2xl:hidden">{service.purpose}</p>
      </div>
    </div> },
    { id: "purpose", header: "用途 / 缺口", priority: 2, cell: (service) => <div className="max-w-md min-w-0 text-body-sm">
      <p className="line-clamp-2 text-ink-soft">{service.purpose}</p>
      <p className="mt-0.5 line-clamp-2 text-2xs text-muted" title={service.gap}>{service.gap}</p>
    </div> },
    { id: "kind", header: "类型 · 接入", priority: 3, cell: (service) => <div className="whitespace-nowrap">
      <p className="text-body-sm text-ink-soft">{kindLabels[service.kind] || service.kind}</p>
      <p className="text-2xs text-muted">{labelFrom(integrationLabels, service.integration)}</p>
    </div> },
    { id: "status", header: "状态", align: "end", cell: (service) => <DirectoryStatus service={service} /> },
  ];

  return <div className="page-enter space-y-5" data-page="services">
    <h1 className="sr-only">服务与连接</h1>
    <PageToolbar
      summary="owner 观测连接的传输、授权、合同与内容证据，以及服务目录；只读，不接受浏览器提交的地址或凭据。"
      actions={<Button size="sm" onClick={read.reload} icon={<RefreshCw className="size-3.5" />}>重新观测</Button>}
      metrics={read.data ? <MetricStrip label="服务概况" items={[
        { label: "连接可读", value: `${readyCount}/${connections.length}`, tone: connections.length > 0 && readyCount < connections.length ? "warning" : undefined },
        { label: "已接入合同", value: integrated.length },
        { label: "未接入", value: services.length - integrated.length },
      ]} /> : undefined}
      meta={read.observedAt ? <Pill size="sm" icon={<Clock3 />}>读取于 {formatRelative(read.observedAt)}</Pill> : undefined}
    />
    <StaleNotice status={read.status} error={read.error} observedAt={read.observedAt} onRetry={read.reload} />

    <ReadStateView status={read.status} error={read.error} onRetry={read.reload} skeleton={<Panel><SkeletonRows rows={4} /></Panel>}>
      <section aria-label="已接入连接" className="space-y-3">
        <h2 className="text-title-sm font-semibold text-ink">任务连接<span className="ml-2 text-2xs font-normal text-muted tabular">{connections.length} 条</span></h2>
        {connections.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
          <ToggleGroup label="目录筛选" value={filter} onChange={setFilter} options={[
            { id: "all", label: "全部", count: services.length },
            { id: "integrated", label: "已接入", count: integrated.length },
            { id: "configured", label: "已配置", count: services.filter((service) => service.configuration === "configured").length },
            { id: "gaps", label: "缺口", count: services.filter((service) => service.integration === "not_integrated" || service.configuration !== "configured").length },
          ]} />
          <SearchField value={query} onChange={setQuery} placeholder="名称、用途、路径" label="搜索服务" className="ml-auto w-full sm:w-64" />
        </div>
        <DataTable label="服务目录列表" columns={columns} rows={visible} rowKey={(service) => service.id} empty={<EmptyState compact title="没有匹配的服务" />} />
      </Panel>
    </ReadStateView>
  </div>;
}

function Quiet({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-meta text-muted"><Dot tone={tone} />{children}</span>;
}

/** Pills only mark problems or open gaps; healthy and not-integrated rows stay quiet. */
function DirectoryStatus({ service }: { service: ServiceDirectoryEntry }) {
  const isIntegrated = service.integration !== "not_integrated";
  const coverage = service.coverage?.state;
  const items: ReactNode[] = [];
  if (isIntegrated) {
    if (coverage && coverage !== "complete" && coverage !== "not_recorded") items.push(<CoverageChip key="coverage" state={coverage === "stale" ? "expired" : coverage} />);
    else items.push(<Quiet key="coverage" tone={coverage === "complete" ? "success" : "neutral"}>{coverage === "complete" ? "可读" : coverage === "not_recorded" ? "未采集" : "尚未观测"}</Quiet>);
  }
  if (service.configuration !== "configured") {
    const configuration = configurationLabels[service.configuration] || configurationLabels.not_configured;
    items.push(<Pill key="configuration" tone={configuration.tone}>{configuration.label}</Pill>);
  }
  if (!items.length) items.push(<Quiet key="none">未接入</Quiet>);
  return <span className="inline-flex flex-wrap items-center justify-end gap-1.5">{items}</span>;
}

const collectionStateLabels: Record<string, string> = { active: "待确认", confirmed: "已确认", archived: "已归档" };
const collectionStateTone = (state: string): Tone => state === "confirmed" ? "success" : state === "archived" ? "neutral" : "warning";
const recordKindLabels: Record<string, string> = {
  screenplay: "剧本",
  director_plan: "导演计划",
  creative_storyboard: "创意分镜",
  production_handoff: "制作交接",
  candidate: "候选",
  review: "审阅",
  version: "版本",
  run: "运行证据",
};
const readable = (value: string | undefined, fallback: string) => value ? taskStateLabels[value] || value.replace(/_/g, " ") : fallback;

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
  return <Panel title="Auctra 文本创作记录收集" bodyClassName="p-5" actions={<Button size="sm" variant="secondary" onClick={() => void sync()} icon={<RefreshCw className="size-3.5" />}>同步记录</Button>}>
    <div className="space-y-3">
      <p className="text-body-sm text-muted">Control Center 只保存 refs、状态、摘要、时间和本地管理元数据；正文、路径和提示词留在 Auctra。</p>
      {collection.data && <div className="flex flex-wrap items-center gap-2"><CoverageChip state={collection.data.coverage === "stale" ? "expired" : collection.data.coverage} /><Pill tone="neutral">{collection.data.total} 条记录</Pill></div>}
      <ReadStateView status={collection.status} error={collection.error} onRetry={collection.reload} skeleton={<SkeletonRows rows={3} />} empty={<EmptyState compact title="还没有收集记录" body="点击“同步记录”从 Auctra 拉取当前授权范围的脱敏记录。" />}>
        {rows.length ? <ul className="divide-y divide-line rounded-control border border-line">{rows.map((row) => <li key={row.record_ref} className="flex flex-wrap items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-body-sm font-medium text-ink">{row.title || row.record_ref}</p><p className="truncate text-2xs text-muted">{labelFrom(recordKindLabels, row.record_kind, readable(row.record_kind, "类型未提供"))} · {readable(row.status, "状态未提供")} · {labelFrom(freshnessLabels, row.source_state)}</p></div><Pill tone={collectionStateTone(row.collection_state)}>{collectionStateLabels[row.collection_state] || row.collection_state}</Pill>{row.collection_state !== "confirmed" && row.collection_state !== "archived" && <Button size="sm" variant="ghost" onClick={() => void manage(row, "collection.record.confirm")}>确认</Button>}{row.collection_state !== "archived" && <Button size="sm" variant="ghost" onClick={() => void manage(row, "collection.record.archive")}>归档</Button>}</li>)}</ul> : <EmptyState compact title="还没有收集记录" body="点击“同步记录”从 Auctra 拉取当前授权范围的脱敏记录。" />}
      </ReadStateView>
    </div>
  </Panel>;
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
  const stateTone: Tone = state === "disabled" ? "neutral" : connectionTone(state);
  const dims = [
    { label: "传输", value: runtime?.transport || "unknown" },
    { label: "授权", value: runtime?.authorization || "unknown" },
    { label: "合同", value: runtime?.contract || "unknown" },
    { label: "内容", value: runtime?.content || (connection.content_requested ? "not_verified" : "not_requested") },
  ];
  const channelGroups = new Map<string, { labels: string[]; reason?: string }>();
  for (const [channel, observation] of Object.entries(runtime?.channels || {})) {
    if (!observation) continue;
    const group = channelGroups.get(observation.state) || { labels: [], reason: observation.reason };
    group.labels.push(channelLabels[channel] || channel);
    channelGroups.set(observation.state, group);
  }
  const reason = runtime?.reason && runtime.state !== "ready" ? reasonText(runtime.reason) : null;
  return <article className="flex min-w-0 flex-col rounded-card border border-line bg-panel p-4 shadow-panel">
    <header className="flex items-start gap-3">
      <Dot tone={stateTone} className="mt-2" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-body-sm font-semibold text-ink">{connection.label}</h3>
        <p className="truncate text-2xs text-muted">{service.name} · {connection.environment} · 项目 {connection.project}</p>
      </div>
      {state === "ready" ? <span className={cx("shrink-0 text-meta font-medium", toneText.success)}>可读</span> : <Pill tone={stateTone}>{state === "disabled" ? "已停用" : connectionStateLabel(state)}</Pill>}
    </header>
    <ul aria-label="连接证据" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-ink-soft">
      {dims.map((dim) => {
        const tone = dimensionTone(dim.value);
        const value = dimensionLabels[dim.value] || dim.value;
        return <li key={dim.label} className="inline-flex items-center gap-1.5" title={`${dim.label}：${value}`}>
          <Dot tone={tone} />
          <span>{dim.label}</span>
          {tone === "success" ? <span className="sr-only">{value}</span> : <span className={cx("font-medium", toneText[tone])}>{value}</span>}
        </li>;
      })}
    </ul>
    {channelGroups.size > 0 && <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-muted">
      <span className="text-2xs">读取通道</span>
      {[...channelGroups.entries()].map(([channelState, group]) => channelState === "ready"
        ? <span key={channelState} className="inline-flex items-center gap-1.5 text-ink-soft"><Dot tone="success" />可读：{group.labels.join("、")}</span>
        : <span key={channelState} className="inline-flex items-center gap-1.5"><Pill size="sm" tone={channelTone(channelState)} title={group.reason ? reasonText(group.reason) : undefined}>{connectionStateLabel(channelState)}</Pill>{group.labels.join("、")}</span>)}
    </div>}
    {runtime?.task_families?.length ? <p className="mt-2.5 truncate text-2xs text-muted">任务族：<span className="font-mono">{runtime.task_families.join(", ")}</span></p> : null}
    {reason && reason !== connectionStateLabel(state) && <InlineNotice tone="warning" className="mt-3 py-2 text-2xs">原因：{reason}</InlineNotice>}
    <footer className="mt-auto flex items-center justify-between gap-2 pt-4 text-2xs text-muted">
      <span className="flex min-w-0 items-center gap-1.5"><Clock3 className="size-3.5 shrink-0" /><span className="truncate">{runtime ? `检查于 ${formatRelative(runtime.checked_at)} · 最近成功 ${runtime.last_success_at ? formatRelative(runtime.last_success_at) : "无"}` : "未观测"}</span></span>
      <Button size="sm" variant="ghost" onClick={onTasks}>查看任务<ArrowRight className="size-3.5" /></Button>
    </footer>
  </article>;
}
