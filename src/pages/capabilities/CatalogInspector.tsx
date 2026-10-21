import { useState, type ReactNode } from "react";
import { ArrowRight, Boxes, Cpu, FileJson, ListTree, Server, ShieldAlert, Waypoints, Wrench } from "../../icons";
import { InspectorShell, type InspectorMode, type InspectorSection } from "../../components/InspectorShell";
import { Button, CopyRef, Facts, InlineNotice, Pill, Unknown, cx, ownerLabel } from "../../components/ui";
import type { UsageEvent } from "../../shared/api/control-center-client";
import type { CatalogChange, SchemaSummary, ToolCatalog } from "../../shared/tool-catalog";
import { formatFullTime, formatMoney, formatRelative } from "../../shared/read-model/format";
import {
  availabilityLabels, availabilityTone, capabilityLabels, catalogCoverageLabels, catalogCoverageTone, changeLabels, changeTone, channelStatusLabels, channelStatusTone,
  domainLabels, entryKindLabels, freshnessLabels, labelFrom, laneLabels, modelStatusLabels, modelStatusTone, reasonLabel, riskLabels, riskTone,
} from "../../shared/read-model/labels";
import { entryRef, precheckTarget, type CatalogEntry } from "./catalog-view";

const kindIcons = { server: Server, tool: Wrench, action: ListTree, model: Cpu, channel: Waypoints };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section data-inspector-section={id} className="space-y-2.5 pb-5">
    <h3 tabIndex={-1} className="text-body-sm font-semibold text-ink outline-none">{title}</h3>
    {children}
  </section>;
}

function Chips({ values, map, empty = "未声明" }: { values: string[]; map?: Record<string, string>; empty?: string }) {
  if (!values.length) return <Unknown>{empty}</Unknown>;
  return <div className="flex flex-wrap gap-1.5">{values.map((value) => <span key={value} className="rounded-[6px] bg-panel-sunken px-2 py-0.5 text-2xs text-ink-soft" title={value}>{map?.[value] || value}</span>)}</div>;
}

const triState = (value: boolean | null, yes: string, no: string) => value === null ? <Unknown>未声明</Unknown> : value ? yes : no;

/** Top-level fields of an owner input schema; nested bodies stay with the owner. */
export function SchemaFieldTable({ schema }: { schema: SchemaSummary }) {
  if (!schema.fields.length) return <Unknown>{schema.digest ? "该入口没有顶层参数" : "owner 未声明输入合同"}</Unknown>;
  return <div className="overflow-hidden rounded-[10px] border border-line">
    <table className="w-full text-left text-2xs">
      <thead className="bg-panel-soft text-muted"><tr><th scope="col" className="px-3 py-1.5 font-medium">字段</th><th scope="col" className="px-3 py-1.5 font-medium">类型</th><th scope="col" className="px-3 py-1.5 font-medium">说明</th></tr></thead>
      <tbody className="divide-y divide-line">
        {schema.fields.map((field) => <tr key={field.name} className="align-top">
          <td className="px-3 py-2"><span className="font-mono text-ink">{field.name}</span>{field.required && <span className="ml-1 text-danger" title="必填">*</span>}</td>
          <td className="px-3 py-2 font-mono text-muted">{field.type}</td>
          <td className="px-3 py-2 text-ink-soft">
            {field.description || <Unknown>未描述</Unknown>}
            {field.enum && <span className="mt-1 block text-muted">可选：{field.enum.join(" / ")}</span>}
            {field.default !== null && <span className="mt-0.5 block text-muted">默认：{field.default}</span>}
          </td>
        </tr>)}
      </tbody>
    </table>
    {(schema.truncated || schema.digest) && <p className="border-t border-line bg-panel-soft px-3 py-1.5 font-mono text-2xs text-faint">{schema.truncated ? `仅显示前 ${schema.fields.length} / ${schema.field_count} 个字段 · ` : ""}{schema.digest?.slice(0, 19)}…</p>}
  </div>;
}

function ChangeFacts({ changes }: { changes: CatalogChange[] }) {
  if (!changes.length) return <p className="text-2xs text-muted">近 7 天控制中心没有观察到该条目的新增或变更。</p>;
  return <ul className="space-y-1.5">{changes.map((change) => <li key={change.at + change.change} className="flex items-center gap-2 text-2xs text-muted"><Pill size="sm" tone={changeTone[change.change]}>{changeLabels[change.change]}</Pill>{formatFullTime(change.at)}</li>)}</ul>;
}

function UsageFacts({ rows }: { rows: UsageEvent[] }) {
  if (!rows.length) return <p className="text-2xs text-muted">暂无回执：控制中心没有记录该模型的 Provider 回执。</p>;
  const confirmed = rows.filter((row) => row.cost_state === "confirmed" && row.upstream_cost !== null);
  const currency = confirmed[0]?.currency || "CNY";
  const total = confirmed.reduce((sum, row) => sum + (row.upstream_cost || 0), 0);
  const latest = rows.map((row) => row.created_at).sort().at(-1);
  return <Facts columns={2} items={[
    { label: "回执", value: <span className="tabular">{rows.length} 条</span> },
    { label: "最近使用", value: latest ? formatRelative(latest) : <Unknown /> },
    { label: "已确认成本", value: confirmed.length ? formatMoney(total, currency) : <Unknown>无已确认成本</Unknown> },
    { label: "未确认", value: <span className="tabular">{rows.length - confirmed.length} 条</span> },
  ]} />;
}

export function CatalogInspector({ entry, catalog, usage, mode, onModeChange, onClose, onNavigate }: {
  entry: CatalogEntry;
  catalog: ToolCatalog;
  usage: UsageEvent[];
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
  onClose: () => void;
  onNavigate: (target: string) => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const { kind, value } = entry;
  const Icon = kindIcons[kind];
  const changes = catalog.changes.filter((change) => change.kind === kind && change.owner === value.owner && change.entry_id === value.id);
  const target = precheckTarget(entry);
  const title = kind === "model" ? value.model_ref : kind === "channel" ? value.name : kind === "server" ? value.name : value.name;
  const reference = kind === "model" ? value.model_ref : kind === "channel" ? value.channel_id : kind === "server" ? value.owner : value.name;

  let status: ReactNode = null;
  let sections: InspectorSection[] = [];
  let body: ReactNode = null;

  if (kind === "model") {
    status = <Pill tone={modelStatusTone[value.status]}>{modelStatusLabels[value.status]}</Pill>;
    const rows = usage.filter((row) => row.model_ref === value.model_ref);
    sections = [{ id: "summary", label: "概要" }, { id: "capability", label: "能力" }, { id: "pricing", label: "定价" }, { id: "usage", label: "用量" }, { id: "changes", label: "动态" }];
    body = <>
      <Section id="summary" title="概要">
        <Facts columns={2} items={[
          { label: "模型引用", value: <span className="font-mono text-xs">{value.model_ref}</span>, wide: true },
          { label: "Provider", value: value.provider || <Unknown /> },
          { label: "渠道", value: value.channel || <Unknown /> },
          { label: "状态来源", value: value.status_source === "owner" ? "owner 声明" : "owner 未声明（不推断为最新）" },
          { label: "就绪度", value: value.readiness || <Unknown /> },
          { label: "观察于", value: value.observed_at ? formatRelative(value.observed_at) : <Unknown /> },
          { label: "快照到期", value: value.expires_at ? formatFullTime(value.expires_at) : <Unknown /> },
        ]} />
        {value.status === "historical" && <InlineNotice tone="neutral">历史模型只用于查询和对账原任务，不能新建任务。</InlineNotice>}
        {value.warnings.length > 0 && <InlineNotice tone="warning">{value.warnings.map((warning) => reasonLabel(warning)).join("；")}</InlineNotice>}
      </Section>
      <Section id="capability" title="能力">
        <Facts columns={1} items={[
          { label: "能力", value: <Chips values={value.capabilities} map={capabilityLabels} /> },
          { label: "输入 / 输出", value: `${value.input_modalities.join(" + ") || "未声明"} → ${value.output_modalities.join(" + ") || "未声明"}` },
          { label: "时长", value: <Chips values={value.durations} /> },
          { label: "分辨率", value: <Chips values={value.resolutions} /> },
          { label: "比例", value: <Chips values={value.ratios} /> },
        ]} />
      </Section>
      <Section id="pricing" title="定价">
        {value.pricing ? <Facts columns={2} items={[
          { label: "来源", value: value.pricing.source || <Unknown /> },
          { label: "币种", value: value.pricing.currency || <Unknown /> },
          { label: "计价单位", value: value.pricing.unit || <Unknown /> },
          { label: "计价方式", value: value.pricing.price_type || <Unknown /> },
        ]} /> : <p className="text-2xs text-muted">owner 未提供定价快照；控制中心不估算价格。</p>}
      </Section>
      <Section id="usage" title="用量"><UsageFacts rows={rows} /></Section>
      <Section id="changes" title="动态"><ChangeFacts changes={changes} /></Section>
    </>;
  } else if (kind === "channel") {
    status = <Pill tone={channelStatusTone[value.status]}>{channelStatusLabels[value.status]}</Pill>;
    sections = [{ id: "summary", label: "概要" }, { id: "routing", label: "路由" }, { id: "models", label: "模型" }, { id: "changes", label: "动态" }];
    body = <>
      <Section id="summary" title="概要">
        <Facts columns={2} items={[
          { label: "渠道", value: <span className="font-mono text-xs">{value.channel_id}</span>, wide: true },
          { label: "Provider", value: value.provider || <Unknown /> },
          { label: "协议", value: value.protocol || <Unknown /> },
          { label: "最近尝试", value: value.last_attempt || <Unknown>未观察</Unknown> },
          { label: "最近成功", value: value.last_success || <Unknown>未观察</Unknown> },
          { label: "定价来源", value: value.pricing?.source || <Unknown /> },
          { label: "币种 / 单位", value: value.pricing ? `${value.pricing.currency || "未声明"} / ${value.pricing.unit || "未声明"}` : <Unknown /> },
        ]} />
        {value.note_required && <InlineNotice tone="info">owner 要求使用前阅读渠道说明；控制中心只展示该要求，不读取说明正文。</InlineNotice>}
      </Section>
      <Section id="routing" title="路由">
        {value.routing ? <Facts columns={2} items={[
          { label: "优先级", value: value.routing.priority ?? <Unknown /> },
          { label: "权重", value: value.routing.weight ?? <Unknown /> },
          { label: "默认渠道", value: triState(value.routing.default, "是", "否") },
          { label: "选择方式", value: value.routing.selection_mode || <Unknown /> },
        ]} /> : <Unknown>owner 未声明路由</Unknown>}
      </Section>
      <Section id="models" title="模型"><Chips values={value.models} /><Facts columns={1} items={[{ label: "能力", value: <Chips values={value.capabilities} map={capabilityLabels} /> }]} /></Section>
      <Section id="changes" title="动态"><ChangeFacts changes={changes} /></Section>
    </>;
  } else if (kind === "tool") {
    const annotations = value.annotations;
    status = <Pill tone={annotations.read_only ? "success" : annotations.destructive ? "danger" : "neutral"}>{annotations.read_only ? "只读工具" : annotations.destructive ? "破坏性工具" : value.dispatcher ? "动作入口" : "未声明只读"}</Pill>;
    sections = [{ id: "summary", label: "概要" }, { id: "annotations", label: "注解" }, { id: "input", label: "输入合同" }, { id: "changes", label: "动态" }];
    body = <>
      <Section id="summary" title="概要">
        <Facts columns={1} items={[
          { label: "工具名", value: <span className="font-mono text-xs">{value.name}</span> },
          { label: "说明", value: value.description || <Unknown>owner 未描述</Unknown> },
        ]} />
        {value.dispatcher && <InlineNotice tone="neutral" icon={<ListTree />}>这是 owner 的动作入口：具体能力以下方“动作”目录为准，工具注解只描述入口本身。</InlineNotice>}
      </Section>
      <Section id="annotations" title="注解">
        <Facts columns={2} items={[
          { label: "只读", value: triState(annotations.read_only, "是", "否") },
          { label: "破坏性", value: triState(annotations.destructive, "是", "否") },
          { label: "幂等", value: triState(annotations.idempotent, "是", "否") },
          { label: "访问外部世界", value: triState(annotations.open_world, "是", "否") },
        ]} />
      </Section>
      <Section id="input" title="输入合同"><SchemaFieldTable schema={value.input} /></Section>
      <Section id="changes" title="动态"><ChangeFacts changes={changes} /></Section>
    </>;
  } else if (kind === "action") {
    status = <span className="inline-flex flex-wrap gap-1.5"><Pill tone={riskTone[value.risk]}>{riskLabels[value.risk]}</Pill><Pill tone={availabilityTone[value.availability]}>{availabilityLabels[value.availability]}</Pill></span>;
    sections = [{ id: "summary", label: "概要" }, { id: "risk", label: "风险与确认" }, { id: "availability", label: "可用性" }, { id: "input", label: "输入合同" }, { id: "changes", label: "动态" }];
    body = <>
      <Section id="summary" title="概要">
        <Facts columns={1} items={[
          { label: "动作", value: <span className="font-mono text-xs">{value.name}</span> },
          { label: "说明", value: value.summary || value.description || <Unknown>owner 未描述</Unknown> },
          { label: "入口", value: value.tool ? <span className="font-mono text-xs">{value.tool}</span> : <Unknown /> },
          { label: "来源", value: <span className="font-mono text-xs">{value.source}</span> },
        ]} />
      </Section>
      <Section id="risk" title="风险与确认">
        <Facts columns={2} items={[
          { label: "风险等级", value: riskLabels[value.risk] },
          { label: "通道", value: labelFrom(laneLabels, value.lane, "未声明") },
          { label: "需要显式确认", value: triState(value.requires_confirm, "是", "否") },
          { label: "需要幂等键", value: triState(value.requires_idempotency, "是", "否") },
          { label: "副作用", value: <Chips values={value.side_effects.filter((effect) => effect !== "none")} empty="无声明" />, wide: true },
        ]} />
        {(value.risk === "paid_external" || value.risk === "human_gate") && <InlineNotice tone="warning" icon={<ShieldAlert />}>该动作会产生费用或需要人工决定，只能在 owner 独立授权的流程中执行。</InlineNotice>}
      </Section>
      <Section id="availability" title="可用性">
        <Facts columns={1} items={[
          { label: "运行时可用性", value: availabilityLabels[value.availability] },
          { label: "阻塞", value: value.blockers.length ? value.blockers.map((blocker) => reasonLabel(blocker) || blocker).join("；") : "无" },
          { label: "前置条件", value: <Chips values={value.conditions} empty="无声明" /> },
          { label: "下一步", value: value.next_actions.length ? value.next_actions.join("；") : <Unknown>无</Unknown> },
        ]} />
      </Section>
      <Section id="input" title="输入合同"><SchemaFieldTable schema={value.input} /></Section>
      <Section id="changes" title="动态"><ChangeFacts changes={changes} /></Section>
    </>;
  } else {
    status = <Pill tone={catalogCoverageTone[value.coverage]}>{catalogCoverageLabels[value.coverage]}</Pill>;
    sections = [{ id: "summary", label: "概要" }, { id: "policy", label: "策略" }, { id: "readiness", label: "就绪矩阵" }, { id: "changes", label: "动态" }];
    body = <>
      <Section id="summary" title="概要">
        <Facts columns={2} items={[
          { label: "服务", value: value.server_name || value.name },
          { label: "版本", value: value.server_version || <Unknown /> },
          { label: "协议", value: value.protocol_version ? `MCP ${value.protocol_version}` : value.transport.toUpperCase() },
          { label: "新鲜度", value: freshnessLabels[value.freshness] },
          { label: "观察于", value: value.observed_at ? formatRelative(value.observed_at) : <Unknown>未观察</Unknown> },
          { label: "目录规模", value: <span className="tabular">{value.counts.tools} 工具 · {value.counts.actions} 动作 · {value.counts.models} 模型 · {value.counts.channels} 渠道</span>, wide: true },
        ]} />
        {value.reason && <InlineNotice tone={value.coverage === "readable" ? "neutral" : "warning"}>{reasonLabel(value.reason)}</InlineNotice>}
      </Section>
      <Section id="policy" title="策略">
        <Facts columns={1} items={[
          { label: "最新模型策略", value: value.latest_policy || <Unknown>owner 未声明</Unknown> },
          { label: "原生渠道", value: <Chips values={value.native_channels} empty="未声明" /> },
        ]} />
      </Section>
      <Section id="readiness" title="就绪矩阵">
        {value.readiness.length ? <ul className="divide-y divide-line rounded-[10px] border border-line">
          {value.readiness.map((item) => <li key={item.domain} className="flex items-start gap-3 px-3 py-2">
            <span className="min-w-0 flex-1"><span className="block text-body-sm font-medium">{labelFrom(domainLabels, item.domain)}</span>{item.note && <span className="block text-2xs text-muted">{item.note}</span>}</span>
            <Pill size="sm" tone={availabilityTone[item.status]}>{availabilityLabels[item.status]}</Pill>
          </li>)}
        </ul> : <Unknown>owner 未提供就绪矩阵</Unknown>}
      </Section>
      <Section id="changes" title="动态"><ChangeFacts changes={changes} /></Section>
    </>;
  }

  const header = <div className="flex items-start gap-3">
    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] bg-panel-sunken text-ink-soft [&>svg]:size-[17px]"><Icon /></span>
    <div className="min-w-0 flex-1">
      <p className="text-2xs font-medium text-muted">{ownerLabel(value.owner)} · {entryKindLabels[kind]}</p>
      <h2 className="mt-0.5 break-words text-title font-semibold leading-snug tracking-[-0.01em] text-ink">{title}</h2>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{status}</div>
    </div>
  </div>;
  const footer = <div className="flex flex-wrap items-center gap-2">
    {target
      ? <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} onClick={() => onNavigate(target)}>在 AI 创作中预检</Button>
      : <Button size="sm" disabled disabledReason={kind === "model" ? "历史、不可用或漂移的模型不能用于新预检" : "该条目不是可预检的生成能力"}>在 AI 创作中预检</Button>}
    <CopyRef value={reference} label="引用" />
    <span className={cx("ml-auto inline-flex items-center gap-1 text-2xs text-muted")}><Boxes className="size-3" />目录登记不等于可调用</span>
  </div>;

  return <InspectorShell
    open
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={() => setMaximized((current) => !current)}
    onClose={onClose}
    label="目录条目"
    ariaLabel="目录条目详情"
    dataAttribute="data-catalog-inspector"
    header={header}
    meta={<p className="mt-2 flex min-w-0 items-center gap-1.5 text-2xs text-muted"><FileJson className="size-3 shrink-0" /><span className="truncate font-mono">{entryRef(kind, value.owner, value.id)}</span></p>}
    sections={sections}
    footer={footer}
  >{body}</InspectorShell>;
}
