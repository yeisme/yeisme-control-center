import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Boxes, Clock3, Cpu, History, ListTree, Plug, RefreshCw, Server, Sparkles, Waypoints, Wrench } from "../../icons";
import { api, isRouteUnavailable, type Epoch, type ProviderCapabilityProjection } from "../../shared/api/control-center-client";
import { useScopedRead, type ScopedRead } from "../../app/workspace";
import { useObservationCache } from "../../app/observation-cache";
import {
  Button, Checkbox, DataTable, EmptyState, InlineNotice, KindBadge, MetricStrip, NoticeStack, PageToolbar, Panel, Pill, ReadStateView, SearchField, SkeletonRows, StaleNotice,
  TabPanel, Tabs, ToggleGroup, Unknown, cx, ownerLabel, type Column, type MediaKind,
} from "../../components/ui";
import type { InspectorMode } from "../../components/InspectorShell";
import { toolCatalogCacheKey, type CatalogAction, type CatalogChannel, type CatalogModel, type CatalogOwner, type CatalogServer, type CatalogTool, type ToolCatalog } from "../../shared/tool-catalog";
import { formatRelative } from "../../shared/read-model/format";
import {
  availabilityLabels, availabilityTone, capabilityLabels, catalogCoverageLabels, catalogCoverageTone, changeLabels, changeTone, channelStatusLabels, channelStatusTone,
  entryKindLabels, freshnessLabels, generationModeLabels, laneLabels, labelFrom, modelStatusLabels, modelStatusTone, reasonLabel, riskLabels, riskTone,
} from "../../shared/read-model/labels";
import {
  catalogMetrics, changesByDay, entryRef, filterActions, filterChannels, filterModels, filterTools, findEntry, latestHighlights, parseCatalogTab, parseOwnerFilter, parseRiskFilter,
  type CatalogTab, type OwnerFilter, type RiskFilter,
} from "./catalog-view";
import { CatalogInspector } from "./CatalogInspector";
import { readinessMeta } from "./readiness";

type CatalogRead = (ToolCatalog & Epoch) | { route_unavailable: true };

const inspectorPreferenceKey = "yeisme.control.catalog.inspector-mode";
const ownerKind: Record<CatalogOwner, MediaKind> = { eikona: "image", scaena: "video", sonora: "audio", aigora: "text", gateway: "text", auctra: "text" };
const ownerOptions: { id: OwnerFilter; label: string }[] = [{ id: "all", label: "全部" }, { id: "eikona", label: "Eikona" }, { id: "scaena", label: "Scaena" }, { id: "sonora", label: "Sonora" }];
const riskOptions: { id: RiskFilter; label: string }[] = [{ id: "all", label: "全部风险" }, { id: "read_only", label: "只读" }, { id: "mutation", label: "写入" }, { id: "paid_external", label: "付费外部" }, { id: "human_gate", label: "人工门" }];

export default function CapabilityHub() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = parseCatalogTab(params.get("tab"));
  const owner = parseOwnerFilter(params.get("owner"));
  const risk = parseRiskFilter(params.get("risk"));
  const query = params.get("q") || "";
  const forceRef = useRef(false);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>(() => typeof window !== "undefined" && window.localStorage.getItem(inspectorPreferenceKey) === "floating" ? "floating" : "fixed");

  const read = useScopedRead<CatalogRead>(async (scope, signal) => {
    const refresh = forceRef.current;
    forceRef.current = false;
    try {
      return await api.toolCatalog(scope, { refresh }, signal);
    } catch (error) {
      if (isRouteUnavailable(error)) return { route_unavailable: true };
      throw error;
    }
  }, { isEmpty: (data) => !("route_unavailable" in data) && data.servers.every((server) => server.coverage === "needs_contract") });
  const routeMissing = !!read.data && "route_unavailable" in read.data;
  const catalog = read.data && !("route_unavailable" in read.data) ? read.data : null;
  const fallback = useScopedRead((scope, signal) => api.capabilities(scope, signal), { enabled: routeMissing, isEmpty: (data) => data.capabilities.length === 0 });
  const usage = useScopedRead((scope, signal) => api.usage(scope, signal), { enabled: !!catalog });
  const cache = useObservationCache();
  useEffect(() => { if (catalog) cache.put(toolCatalogCacheKey, catalog, 5 * 60_000, 30 * 60_000); }, [cache, catalog]);

  const update = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  }, [params, setParams]);
  const selected = catalog ? findEntry(catalog, params.get("entry")) : null;
  const open = (ref: string) => update({ entry: ref });
  const metrics = useMemo(() => catalog ? catalogMetrics(catalog) : null, [catalog]);
  const refresh = () => { forceRef.current = true; read.reload(); };
  const staleOwners = catalog?.coverage.filter((item) => item.freshness === "stale") || [];

  return <div className={cx(!selected && "page-enter", "space-y-5", selected && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="capabilities">
    <h1 className="sr-only">模型与工具</h1>
    <PageToolbar
      summary="跨 owner 的只读目录：模型、渠道、MCP 工具与动作。目录登记不等于可调用，控制中心不会调用任何条目。"
      metrics={metrics && <MetricStrip label="目录概况" items={[
        { label: "服务", value: `${metrics.readableServers}/${metrics.servers}`, hint: metrics.pendingServers ? `+${metrics.pendingServers} 待接入` : undefined },
        { label: "最新可用模型", value: metrics.latestReady, hint: `共 ${metrics.models}${metrics.historical ? ` · 历史 ${metrics.historical}` : ""}`, tone: metrics.latestReady ? "success" : "neutral" },
        { label: "就绪渠道", value: `${metrics.readyChannels}/${metrics.channels}` },
        { label: "工具与动作", value: metrics.tools + metrics.actions, hint: `只读 ${metrics.readOnlyActions} · 受控 ${metrics.gatedActions}` },
        { label: "近 7 天动态", value: metrics.changes, tone: metrics.changes ? "info" : "neutral" },
      ]} />}
      meta={catalog && <span className="inline-flex items-center gap-1.5 text-2xs text-muted"><Clock3 className="size-3.5" />{freshnessLabels[catalog.freshness]} · {formatRelative(catalog.observed_at)}{catalog.refresh.throttled && " · 15 秒内已刷新"}</span>}
      actions={<Button size="sm" onClick={refresh} icon={<RefreshCw className="size-3.5" />} title="每个 owner 15 秒内最多强制刷新一次">刷新目录</Button>}
    />
    <NoticeStack notices={[
      routeMissing && <InlineNotice key="route" tone="info" icon={<Plug />}>当前连接的控制中心服务版本没有提供工具目录接口，下面显示基础能力投影。升级服务端后会显示完整目录。</InlineNotice>,
      <StaleNotice key="stale" status={read.status} error={read.error} observedAt={read.observedAt} onRetry={read.reload} />,
      staleOwners.length > 0 && <InlineNotice key="owners" tone="warning" icon={<History />}>{staleOwners.map((item) => `${ownerLabel(item.owner)}：${reasonLabel(item.reason) || "最近一次发现失败"}`).join("；")}。显示的是上次成功发现的结果。</InlineNotice>,
    ]} />
    {routeMissing
      ? <FallbackCapabilities read={fallback} />
      : <ReadStateView status={read.status} error={read.error} onRetry={read.reload} skeleton={<CatalogSkeleton />} empty={<Panel><EmptyState icon={<Cpu />} title="当前范围没有可读的工具目录" body="scope 未绑定 Eikona、Scaena 或 Sonora 时不发起发现；Aigora、MCP Gateway 与 Auctra 仍待接入只读合同。" /></Panel>}>
        {catalog && metrics && <Tabs<CatalogTab>
          value={tab}
          onChange={(next) => update({ tab: next === "overview" ? null : next, entry: null })}
          label="目录视图"
          className="space-y-4"
          options={[
            { id: "overview", label: "概览" },
            { id: "models", label: "模型", count: metrics.models },
            { id: "channels", label: "渠道", count: metrics.channels },
            { id: "tools", label: "工具与动作", count: metrics.tools + metrics.actions },
            { id: "changes", label: "动态", count: metrics.changes },
          ]}
        >
          {tab !== "overview" && tab !== "changes" && <div className="flex flex-wrap items-center gap-2">
            <SearchField value={query} onChange={(value) => update({ q: value || null })} placeholder={tab === "models" ? "模型、Provider、渠道" : tab === "channels" ? "渠道、协议、模型" : "工具或动作名称"} label="搜索目录" className="w-full sm:w-72" />
            <ToggleGroup<OwnerFilter> value={owner} onChange={(value) => update({ owner: value === "all" ? null : value })} options={ownerOptions} label="按 owner 筛选" />
            {tab === "tools" && <ToggleGroup<RiskFilter> value={risk} onChange={(value) => update({ risk: value === "all" ? null : value })} options={riskOptions} label="按风险筛选" />}
          </div>}
          <TabPanel value="overview"><Overview catalog={catalog} onOpen={open} onTab={(next) => update({ tab: next })} /></TabPanel>
          <TabPanel value="models"><ModelsView models={catalog.models} query={query} owner={owner} selected={params.get("entry")} onOpen={open} /></TabPanel>
          <TabPanel value="channels"><ChannelsView channels={filterChannels(catalog.channels, { query, owner })} selected={params.get("entry")} onOpen={open} /></TabPanel>
          <TabPanel value="tools"><ToolsView catalog={catalog} query={query} owner={owner} risk={risk} selected={params.get("entry")} onOpen={open} /></TabPanel>
          <TabPanel value="changes"><ChangesView catalog={catalog} onOpen={open} /></TabPanel>
        </Tabs>}
      </ReadStateView>}
    {selected && catalog && <CatalogInspector
      entry={selected}
      catalog={catalog}
      usage={usage.data?.rows || []}
      mode={inspectorMode}
      onModeChange={(mode) => { setInspectorMode(mode); window.localStorage.setItem(inspectorPreferenceKey, mode); }}
      onClose={() => update({ entry: null })}
      onNavigate={(target) => navigate(target)}
    />}
  </div>;
}

function CatalogSkeleton() {
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((index) => <div key={index} className="h-40 rounded-card border border-line bg-panel p-4"><div className="skeleton h-9 w-9 rounded-[9px]" /><div className="skeleton mt-4 h-3.5 w-2/3" /><div className="skeleton mt-2 h-3 w-1/2" /><div className="skeleton mt-6 h-3 w-full" /></div>)}</div>
    <Panel><SkeletonRows rows={4} /></Panel>
  </div>;
}

function ServerCard({ server, onOpen }: { server: CatalogServer; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} data-catalog-row={entryRef("server", server.owner, server.id)} className="group flex min-w-0 flex-col rounded-card border border-line bg-panel p-4 text-left shadow-panel transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-raised">
    <span className="flex items-start gap-3">
      <KindBadge kind={ownerKind[server.owner]} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-ink">{server.name}</span><Pill size="sm" tone={catalogCoverageTone[server.coverage]}>{catalogCoverageLabels[server.coverage]}</Pill></span>
        <span className="mt-0.5 block truncate text-2xs text-muted">{[server.server_name, server.server_version && `v${server.server_version}`, server.protocol_version && `MCP ${server.protocol_version}`].filter(Boolean).join(" · ") || "未观察到服务信息"}</span>
      </span>
    </span>
    <span className="mt-4 grid grid-cols-4 gap-2 text-center">
      {([["工具", server.counts.tools], ["动作", server.counts.actions], ["模型", server.counts.models], ["渠道", server.counts.channels]] as const).map(([label, value]) => <span key={label} className="rounded-[8px] bg-panel-soft py-1.5"><span className="tabular block text-title-sm font-semibold text-ink">{value}</span><span className="block text-2xs text-muted">{label}</span></span>)}
    </span>
    {server.latest_policy && <span className="mt-3 line-clamp-2 text-2xs text-muted"><Sparkles className="mr-1 inline size-3 text-kind-text" />{server.latest_policy}</span>}
    {server.reason && <span className="mt-2 line-clamp-2 text-2xs text-warning">{reasonLabel(server.reason)}</span>}
    <span className="mt-auto flex items-center justify-between pt-3 text-2xs text-faint"><span>{freshnessLabels[server.freshness]}{server.observed_at ? ` · ${formatRelative(server.observed_at)}` : ""}</span><ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></span>
  </button>;
}

function Overview({ catalog, onOpen, onTab }: { catalog: ToolCatalog; onOpen: (ref: string) => void; onTab: (tab: CatalogTab) => void }) {
  const providers = catalog.servers.filter((server) => server.transport === "mcp");
  const pending = catalog.servers.filter((server) => server.coverage === "needs_contract");
  const highlights = latestHighlights(catalog);
  const risks = (["read_only", "remote_query", "mutation", "paid_external", "human_gate", "unknown"] as const).map((tier) => ({ tier, count: catalog.actions.filter((action) => action.risk === tier).length })).filter((item) => item.count > 0);
  const maxRisk = Math.max(1, ...risks.map((item) => item.count));
  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{providers.map((server) => <ServerCard key={server.id} server={server} onOpen={() => onOpen(entryRef("server", server.owner, server.id))} />)}</div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title="最新上线" eyebrow="owner 声明的最新模型与控制中心观察到的新增、变更" actions={<Button size="sm" variant="ghost" onClick={() => onTab("changes")}>全部动态</Button>}>
        {highlights.length ? <ul className="divide-y divide-line">{highlights.map((item) => <li key={item.ref}>
          <button type="button" data-catalog-row={item.ref} onClick={() => onOpen(item.ref)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-panel-soft">
            <KindBadge kind={ownerKind[item.owner]} size="sm" />
            <span className="min-w-0 flex-1"><span className="block truncate text-body-sm font-medium text-ink">{item.label}</span><span className="block truncate text-2xs text-muted">{ownerLabel(item.owner)} · {entryKindLabels[item.kind]}{item.at ? ` · ${formatRelative(item.at)}` : ""}</span></span>
            <Pill size="sm" tone={item.reason === "owner_latest" ? "success" : changeTone[item.reason]}>{item.reason === "owner_latest" ? "owner 最新" : changeLabels[item.reason]}</Pill>
          </button>
        </li>)}</ul> : <EmptyState compact icon={<Sparkles />} title="暂无最新上线" body="owner 尚未声明最新模型，且近 7 天没有观察到新增或变更。首次观察只建立基线。" />}
      </Panel>
      <div className="space-y-5">
        <Panel title="动作风险分布" eyebrow={`${catalog.actions.length} 个 owner 动作`}>
          {risks.length ? <ul className="space-y-2.5 px-5 py-4">{risks.map((item) => <li key={item.tier} className="grid grid-cols-[88px_minmax(0,1fr)_32px] items-center gap-3 text-2xs">
            <span className="text-muted">{riskLabels[item.tier]}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-panel-sunken"><span className={cx("block h-full rounded-full", { read_only: "bg-success", remote_query: "bg-info", mutation: "bg-warning", paid_external: "bg-danger", human_gate: "bg-review", unknown: "bg-neutral" }[item.tier])} style={{ width: `${(item.count / maxRisk) * 100}%` }} /></span>
            <span className="tabular text-right font-medium text-ink">{item.count}</span>
          </li>)}</ul> : <EmptyState compact icon={<ListTree />} title="owner 未声明动作" />}
        </Panel>
        <Panel title="待接入目录" eyebrow="已知存在、但还没有控制中心可用的只读合同">
          <ul className="divide-y divide-line">{pending.map((server) => <li key={server.id}>
            <button type="button" onClick={() => onOpen(entryRef("server", server.owner, server.id))} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-panel-soft">
              <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-panel-sunken text-muted"><Server className="size-3.5" /></span>
              <span className="min-w-0 flex-1"><span className="block text-body-sm font-medium text-ink">{server.name}</span><span className="block truncate text-2xs text-muted">{reasonLabel(server.reason)}</span></span>
              <Pill size="sm" tone="review">待接入</Pill>
            </button>
          </li>)}</ul>
        </Panel>
      </div>
    </div>
  </div>;
}

function paramSummary(model: CatalogModel) {
  const parts = [model.durations.slice(0, 3).join("/"), model.resolutions.slice(0, 3).join("/"), model.ratios.slice(0, 3).join("/")].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const modelColumns: Column<CatalogModel>[] = [
  { id: "model", header: "模型", cell: (model) => <span className="flex min-w-0 items-center gap-3">
    <KindBadge kind={ownerKind[model.owner]} size="sm" />
    <span className="min-w-0"><span className="block truncate font-medium text-ink">{model.model_ref}</span><span className="block truncate text-2xs text-muted">{[ownerLabel(model.owner), ...new Set([model.provider, model.channel].filter(Boolean))].join(" · ")}</span></span>
  </span> },
  { id: "capabilities", header: "能力", priority: 2, cell: (model) => model.capabilities.length ? <span className="flex flex-wrap gap-1">{model.capabilities.slice(0, 3).map((capability) => <span key={capability} className="whitespace-nowrap rounded-[5px] bg-panel-sunken px-1.5 py-0.5 text-2xs text-ink-soft">{labelFrom(capabilityLabels, capability)}</span>)}</span> : <Unknown>未声明</Unknown> },
  { id: "params", header: "参数", priority: 3, cell: (model) => paramSummary(model) ? <span className="whitespace-nowrap text-2xs text-muted">{paramSummary(model)}</span> : <Unknown>未声明</Unknown> },
  { id: "status", header: "状态", cell: (model) => <Pill size="sm" tone={modelStatusTone[model.status]}>{modelStatusLabels[model.status]}</Pill> },
  { id: "observed", header: "观察", priority: 3, align: "end", cell: (model) => <span className="whitespace-nowrap text-2xs text-muted">{model.observed_at ? formatRelative(model.observed_at) : "未提供"}</span> },
];

function ModelsView({ models, query, owner, selected, onOpen }: { models: CatalogModel[]; query: string; owner: OwnerFilter; selected: string | null; onOpen: (ref: string) => void }) {
  const [showHistorical, setShowHistorical] = useState(false);
  const { current, historical } = filterModels(models, { query, owner });
  const table = (rows: CatalogModel[], label: string) => <DataTable
    label={label}
    columns={modelColumns}
    rows={rows}
    rowKey={(model) => entryRef("model", model.owner, model.id)}
    rowAttributes={(model) => ({ "data-catalog-row": entryRef("model", model.owner, model.id) })}
    rowLabel={(model) => `查看模型 ${model.model_ref}`}
    selectedKey={selected}
    onRowClick={(model) => onOpen(entryRef("model", model.owner, model.id))}
  />;
  return <div className="space-y-4">
    <Panel bodyClassName="p-0">
      {current.length ? table(current, "当前模型") : <EmptyState compact icon={<Cpu />} title={query || owner !== "all" ? "没有匹配的模型" : "owner 没有返回模型快照"} body="观察者凭据可能无法读取模型快照；具体原因见概览中的服务覆盖。" />}
    </Panel>
    {historical.length > 0 && <Panel
      title={<span className="flex items-center gap-2"><History className="size-4 text-muted" />历史模型</span>}
      eyebrow="仅用于查询和对账原任务，不能新建任务"
      actions={<label className="flex items-center gap-2 text-2xs text-muted"><Checkbox checked={showHistorical} onChange={setShowHistorical} label="显示历史模型" />显示 {historical.length} 个</label>}
      bodyClassName="p-0"
    >
      {showHistorical && table(historical, "历史模型")}
    </Panel>}
  </div>;
}

const channelColumns: Column<CatalogChannel>[] = [
  { id: "channel", header: "渠道", cell: (channel) => <span className="flex min-w-0 items-center gap-3">
    <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-panel-sunken text-ink-soft"><Waypoints className="size-3.5" /></span>
    <span className="min-w-0"><span className="block truncate font-medium text-ink">{channel.name}</span><span className="block truncate text-2xs text-muted">{ownerLabel(channel.owner)}{channel.protocol ? ` · ${channel.protocol}` : ""}</span></span>
  </span> },
  { id: "models", header: "模型", priority: 2, cell: (channel) => channel.models.length ? <span className="block max-w-[260px] truncate text-2xs text-ink-soft" title={channel.models.join("\n")}>{channel.models[0]}{channel.models.length > 1 ? ` 等 ${channel.models.length} 个` : ""}</span> : <Unknown>未声明</Unknown> },
  { id: "capabilities", header: "能力", priority: 3, cell: (channel) => <span className="whitespace-nowrap text-2xs text-muted">{channel.capabilities.map((capability) => labelFrom(capabilityLabels, capability)).join(" · ") || "未声明"}</span> },
  { id: "routing", header: "路由", priority: 3, cell: (channel) => channel.routing ? <span className="whitespace-nowrap text-2xs text-muted tabular">P{channel.routing.priority ?? "?"} · W{channel.routing.weight ?? "?"}{channel.routing.default ? " · 默认" : ""}</span> : <Unknown>未声明</Unknown> },
  { id: "status", header: "状态", align: "end", cell: (channel) => <Pill size="sm" tone={channelStatusTone[channel.status]}>{channelStatusLabels[channel.status]}</Pill> },
];

function ChannelsView({ channels, selected, onOpen }: { channels: CatalogChannel[]; selected: string | null; onOpen: (ref: string) => void }) {
  return <Panel bodyClassName="p-0">
    <DataTable
      label="渠道目录"
      columns={channelColumns}
      rows={channels}
      rowKey={(channel) => entryRef("channel", channel.owner, channel.id)}
      rowAttributes={(channel) => ({ "data-catalog-row": entryRef("channel", channel.owner, channel.id) })}
      rowLabel={(channel) => `查看渠道 ${channel.name}`}
      selectedKey={selected}
      onRowClick={(channel) => onOpen(entryRef("channel", channel.owner, channel.id))}
      empty={<EmptyState compact icon={<Waypoints />} title="没有匹配的渠道" body="owner 未返回渠道摘要，或当前凭据不能读取。" />}
    />
  </Panel>;
}

const toolColumns: Column<CatalogTool>[] = [
  { id: "tool", header: "MCP 工具", cell: (tool) => <span className="min-w-0"><span className="block truncate font-mono text-xs font-medium text-ink">{tool.name}</span><span className="block truncate text-2xs text-muted">{tool.title || tool.description || "owner 未描述"}</span></span> },
  { id: "hints", header: "注解", priority: 2, cell: (tool) => <span className="flex flex-wrap gap-1">
    {tool.dispatcher && <Pill size="sm" tone="neutral">动作入口</Pill>}
    {tool.annotations.read_only === true && <Pill size="sm" tone="success">只读</Pill>}
    {tool.annotations.destructive === true && <Pill size="sm" tone="danger">破坏性</Pill>}
    {tool.annotations.idempotent === true && <Pill size="sm" tone="info">幂等</Pill>}
    {tool.annotations.read_only === null && !tool.dispatcher && <Pill size="sm" tone="neutral">未声明</Pill>}
  </span> },
  { id: "fields", header: "参数", priority: 3, align: "end", cell: (tool) => <span className="tabular text-2xs text-muted">{tool.input.field_count} 个</span> },
];

const actionColumns: Column<CatalogAction>[] = [
  { id: "action", header: "动作", cell: (action) => <span className="min-w-0"><span className="flex items-center gap-1.5"><span className="truncate font-mono text-xs font-medium text-ink">{action.name}</span>{action.creative_mode && <span className="whitespace-nowrap rounded-[5px] bg-kind-image-soft px-1.5 py-0.5 text-2xs text-kind-image">{generationModeLabels[action.creative_mode]}</span>}</span><span className="block truncate text-2xs text-muted">{action.summary || action.description || "owner 未描述"}</span></span> },
  { id: "risk", header: "风险", cell: (action) => <Pill size="sm" tone={riskTone[action.risk]}>{riskLabels[action.risk]}</Pill> },
  { id: "availability", header: "可用性", priority: 2, cell: (action) => <Pill size="sm" tone={availabilityTone[action.availability]}>{availabilityLabels[action.availability]}</Pill> },
  { id: "lane", header: "通道", priority: 3, cell: (action) => <span className="whitespace-nowrap text-2xs text-muted">{labelFrom(laneLabels, action.lane, "未声明")}</span> },
  { id: "gates", header: "确认 / 幂等", priority: 3, align: "end", cell: (action) => <span className="whitespace-nowrap text-2xs text-muted">{action.requires_confirm === null ? "—" : action.requires_confirm ? "需确认" : "免确认"} / {action.requires_idempotency === null ? "—" : action.requires_idempotency ? "需幂等键" : "无"}</span> },
];

const collapsedActionRows = 12;

function ToolsView({ catalog, query, owner, risk, selected, onOpen }: { catalog: ToolCatalog; query: string; owner: OwnerFilter; risk: RiskFilter; selected: string | null; onOpen: (ref: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const tools = filterTools(catalog.tools, { query, owner });
  const actions = filterActions(catalog.actions, { query, owner, risk });
  const owners = [...new Set([...tools.map((tool) => tool.owner), ...actions.map((action) => action.owner)])];
  const filtering = !!query.trim() || risk !== "all";
  if (!owners.length) return <Panel><EmptyState compact icon={<Wrench />} title="没有匹配的工具或动作" /></Panel>;
  return <div className="space-y-5">{owners.map((item) => {
    const ownerTools = risk === "all" ? tools.filter((tool) => tool.owner === item) : [];
    const allActions = actions.filter((action) => action.owner === item);
    // Real owners publish hundreds of actions; keep the selected row visible when collapsing.
    const showAll = filtering || expanded.has(item) || allActions.findIndex((action) => entryRef("action", action.owner, action.id) === selected) >= collapsedActionRows;
    const ownerActions = showAll ? allActions : allActions.slice(0, collapsedActionRows);
    const hidden = allActions.length - ownerActions.length;
    return <Panel key={item} title={<span className="flex items-center gap-2"><KindBadge kind={ownerKind[item]} size="sm" />{ownerLabel(item)}</span>} eyebrow={`${ownerTools.length} 个 MCP 工具 · ${allActions.length} 个动作`} bodyClassName="p-0">
      {ownerTools.length > 0 && <DataTable label={`${ownerLabel(item)} MCP 工具`} columns={toolColumns} rows={ownerTools} rowKey={(tool) => entryRef("tool", tool.owner, tool.id)} rowAttributes={(tool) => ({ "data-catalog-row": entryRef("tool", tool.owner, tool.id) })} rowLabel={(tool) => `查看工具 ${tool.name}`} selectedKey={selected} onRowClick={(tool) => onOpen(entryRef("tool", tool.owner, tool.id))} />}
      {ownerActions.length > 0 && <div className={cx(ownerTools.length > 0 && "border-t border-line")}>
        <DataTable label={`${ownerLabel(item)} 动作`} columns={actionColumns} rows={ownerActions} rowKey={(action) => entryRef("action", action.owner, action.id)} rowAttributes={(action) => ({ "data-catalog-row": entryRef("action", action.owner, action.id) })} rowLabel={(action) => `查看动作 ${action.name}`} selectedKey={selected} onRowClick={(action) => onOpen(entryRef("action", action.owner, action.id))} />
        {(hidden > 0 || (expanded.has(item) && !filtering && allActions.length > collapsedActionRows)) && <div className="border-t border-line px-5 py-2.5">
          <Button size="sm" variant="ghost" aria-expanded={hidden === 0} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(item)) next.delete(item); else next.add(item); return next; })}>
            {hidden > 0 ? `显示全部 ${allActions.length} 个动作` : "收起动作列表"}
          </Button>
        </div>}
      </div>}
      {!ownerActions.length && risk === "all" && <p className="border-t border-line px-5 py-3 text-2xs text-muted">owner 没有返回动作注册表，或当前凭据不能读取。</p>}
    </Panel>;
  })}</div>;
}

function ChangesView({ catalog, onOpen }: { catalog: ToolCatalog; onOpen: (ref: string) => void }) {
  const groups = changesByDay(catalog.changes);
  if (!groups.length) return <Panel><EmptyState icon={<Boxes />} title="近 7 天没有观察到目录变化" body="首次读取某个 owner 时只建立基线，不会把已有条目标记为新增。" /></Panel>;
  return <div className="space-y-4">
    <InlineNotice tone="neutral" icon={<History />}>这是控制中心按摘要比对得到的观察记录，不是 owner 的发布记录。</InlineNotice>
    {groups.map((group) => <Panel key={group.day} title={group.day} bodyClassName="p-0">
      <ul className="divide-y divide-line">{group.items.map((change) => {
        const ref = entryRef(change.kind, change.owner, change.entry_id);
        const exists = !!findEntry(catalog, ref);
        const row = <>
          <Pill size="sm" tone={changeTone[change.change]}>{changeLabels[change.change]}</Pill>
          <span className="min-w-0 flex-1"><span className="block truncate text-body-sm font-medium text-ink">{change.entry_id}</span><span className="block truncate text-2xs text-muted">{ownerLabel(change.owner)} · {entryKindLabels[change.kind]}</span></span>
          <span className="whitespace-nowrap text-2xs text-muted">{formatRelative(change.at)}</span>
        </>;
        return <li key={ref + change.at}>{exists
          ? <button type="button" onClick={() => onOpen(ref)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-panel-soft">{row}</button>
          : <div className="flex items-center gap-3 px-5 py-2.5 opacity-80">{row}</div>}</li>;
      })}</ul>
    </Panel>)}
  </div>;
}

/** Older servers expose only the per-owner capability projection; render it honestly as such. */
function FallbackCapabilities({ read }: { read: ScopedRead<{ capabilities: ProviderCapabilityProjection[] } & Epoch> }) {
  const rows = read.data?.capabilities || [];
  return <ReadStateView status={read.status} error={read.error} onRetry={read.reload} skeleton={<CatalogSkeleton />} empty={<Panel><EmptyState icon={<Cpu />} title="当前范围没有绑定 Provider owner" /></Panel>}>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((item) => {
      const meta = readinessMeta[item.readiness] || readinessMeta.needs_configuration;
      return <div key={item.id} className="rounded-card border border-line bg-panel p-4 shadow-panel">
        <div className="flex items-start gap-3">
          <KindBadge kind={item.modality === "image" ? "image" : item.modality === "video" ? "video" : "audio"} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{item.name}</span><Pill size="sm" tone={meta.tone}>{meta.label}</Pill></div>
            <p className="mt-0.5 truncate font-mono text-2xs text-muted">{item.model_ref}</p>
          </div>
        </div>
        <Field label="可预检模式">{item.input_modes.length ? item.input_modes.map((mode) => generationModeLabels[mode]).join(" · ") : <Unknown>owner 未声明</Unknown>}</Field>
        <Field label="binding">{item.bindings.length ? `${item.bindings.filter((binding) => binding.enabled).length}/${item.bindings.length} 启用` : <Unknown />}</Field>
        {item.blocker && <p className="mt-2 text-2xs text-warning">{reasonLabel(item.blocker)}</p>}
      </div>;
    })}</div>
  </ReadStateView>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <p className="mt-3 flex items-baseline justify-between gap-3 text-2xs"><span className="text-muted">{label}</span><span className="min-w-0 truncate text-right text-ink-soft">{children}</span></p>;
}
