import { useMemo, useState } from "react";
import { Activity, ArrowRight, CircleAlert, Clock3, Layers, ListFilter, Wallet, X } from "../icons";
import type { UsageFact } from "./types";

type RangeKey = "7d" | "14d";

const palette = ["#6d9b71", "#8f6baa", "#6d97b5", "#c6944b", "#7d8f87"];

function TrendChart({ values }: { values: { label: string; cost: number }[] }) {
  const max = Math.max(...values.map((value) => value.cost), 1);
  return <div className="v18-css-chart v18-trend-chart" aria-label="每日成本趋势">{values.map((value) => <div className="v18-trend-point" key={value.label}><span style={{ height: `${Math.max(8, (value.cost / max) * 100)}%` }} title={`${value.label} ¥ ${value.cost.toFixed(2)}`} /><small>{value.label}</small></div>)}</div>;
}

function DonutChart({ values }: { values: { name: string; value: number }[] }) {
  const total = values.reduce((sum, value) => sum + value.value, 0);
  return <div className="v18-css-donut-wrap"><div className="v18-css-donut" style={{ background: `conic-gradient(${values.map((value, index) => `${palette[index % palette.length]} ${total ? (value.value / total) * 100 : 0}%`).reduce((parts, value, index) => { const previous = values.slice(0, index).reduce((sum, item) => sum + (total ? (item.value / total) * 100 : 0), 0); return [...parts, `${value.replace(/ [^ ]+%$/, ` ${previous}% ${previous + (total ? (values[index].value / total) * 100 : 0)}%`)}`]; }, [] as string[]).join(", ")})` }}><span>{total ? `¥ ${total.toFixed(2)}` : "未知"}</span></div></div>;
}

function ProjectBars({ values }: { values: { name: string; cost: number }[] }) {
  const max = Math.max(...values.map((value) => value.cost), 1);
  return <div className="v18-project-bars">{values.map((value) => <div key={value.name}><span>{value.name}</span><div><i style={{ width: `${(value.cost / max) * 100}%` }} /></div><strong>¥ {value.cost.toFixed(2)}</strong></div>)}</div>;
}

export function dedupeUsageFacts(facts: UsageFact[]) {
  const unique = new Map<string, UsageFact>();
  facts.forEach((fact) => {
    if (!unique.has(fact.sourceRef)) unique.set(fact.sourceRef, fact);
  });
  return [...unique.values()];
}

function confirmedCost(rows: UsageFact[]) {
  return rows.reduce((sum, row) => sum + (row.costState === "confirmed" && row.upstreamCost !== null ? row.upstreamCost : 0), 0);
}

export function UsageAnalytics({ facts }: { facts: UsageFact[] }) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [project, setProject] = useState("all");
  const [modality, setModality] = useState("all");
  const [selectedRow, setSelectedRow] = useState<UsageFact | null>(null);
  const uniqueFacts = useMemo(() => dedupeUsageFacts(facts), [facts]);
  const projects = [...new Map(uniqueFacts.map((row) => [row.projectId, row.projectName])).entries()];
  const visible = useMemo(() => {
    const days = range === "7d" ? 7 : 14;
    const cutoff = new Date("2026-10-14T00:00:00+08:00").getTime() - (days - 1) * 86400000;
    return uniqueFacts.filter((row) => {
      const inRange = Date.parse(row.createdAt) >= cutoff;
      const inProject = project === "all" || row.projectId === project;
      const inModality = modality === "all" || row.modality === modality;
      return inRange && inProject && inModality;
    });
  }, [modality, project, range, uniqueFacts]);

  const confirmed = confirmedCost(visible);
  const pending = visible.filter((row) => row.costState === "pending").length;
  const unknown = visible.filter((row) => row.costState === "unknown").length;
  const modelCalls = visible.filter((row) => row.model.includes("Sunburst") || row.modality !== "工具").length;
  const toolCalls = visible.filter((row) => row.tool || row.modality === "工具").length;

  const trend = useMemo(() => {
    const days = range === "7d" ? 7 : 14;
    const values = Array.from({ length: days }, (_, index) => {
      const date = new Date("2026-10-14T00:00:00+08:00");
      date.setDate(date.getDate() - (days - 1 - index));
      const key = date.toISOString().slice(0, 10);
      const dayRows = visible.filter((row) => row.createdAt.slice(0, 10) === key);
      return {
        key,
        label: key.slice(5),
        cost: Number(confirmedCost(dayRows).toFixed(2)),
        calls: dayRows.length,
      };
    });
    return values;
  }, [range, visible]);

  const byModality = useMemo(() => {
    const grouped = new Map<string, number>();
    visible.forEach((row) => grouped.set(row.modality, (grouped.get(row.modality) || 0) + (row.costState === "confirmed" ? row.upstreamCost || 0 : 0)));
    return [...grouped].map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }));
  }, [visible]);

  const byProject = useMemo(() => {
    const grouped = new Map<string, number>();
    visible.forEach((row) => grouped.set(row.projectName, (grouped.get(row.projectName) || 0) + (row.costState === "confirmed" ? row.upstreamCost || 0 : 0)));
    return [...grouped].map(([name, cost]) => ({ name, cost: Number(cost.toFixed(2)) }));
  }, [visible]);

  return <div className="v18-page v18-page-enter" data-page="usage">
    <div className="v18-page-header">
      <div>
        <p className="v18-eyebrow">资源运营</p>
        <h1>用量与成本</h1>
        <p className="v18-page-body">追踪模型、MCP、Tool 和项目的消费归因。当前为演示数据，仅用于用量与成本观察。</p>
      </div>
      <span className="v18-inline-status"><Clock3 size={14} />覆盖至 2026-10-14 14:22</span>
    </div>
    <div className="v18-usage-filters" aria-label="用量筛选">
      <span className="v18-filter-label"><ListFilter size={14} />筛选</span>
      <select aria-label="时间范围" value={range} onChange={(event) => setRange(event.target.value as RangeKey)}><option value="7d">近 7 天</option><option value="14d">近 14 天</option></select>
      <select aria-label="项目" value={project} onChange={(event) => setProject(event.target.value)}><option value="all">全部项目</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select aria-label="能力类型" value={modality} onChange={(event) => setModality(event.target.value)}><option value="all">全部能力</option><option value="图像">图像</option><option value="视频">视频</option><option value="音频">音频</option><option value="文本">文本</option><option value="工具">工具</option></select>
    </div>
    <section className="v18-usage-kpis">
      <article><span className="v18-kpi-icon sage"><Wallet size={16} /></span><small>已确认上游成本</small><strong>¥ {confirmed.toFixed(2)}</strong><em>只计入已确认费用</em></article>
      <article><span className="v18-kpi-icon blue"><Activity size={16} /></span><small>模型调用</small><strong>{modelCalls.toLocaleString("zh-CN")}</strong><em>按来源事件去重</em></article>
      <article><span className="v18-kpi-icon violet"><Layers size={16} /></span><small>MCP / Tool 调用</small><strong>{toolCalls.toLocaleString("zh-CN")}</strong><em>含嵌套调用，不等于模型请求</em></article>
      <article><span className="v18-kpi-icon amber"><CircleAlert size={16} /></span><small>待核算记录</small><strong>{pending + unknown}</strong><em>{pending} 待结算 · {unknown} 未知</em></article>
    </section>
    <section className="v18-usage-chart-grid">
      <article className="v18-panel v18-chart-panel v18-chart-wide"><div className="v18-panel-heading"><div><p className="v18-eyebrow">每日趋势</p><h2>成本与调用一起看</h2></div><span className="v18-chart-note">CNY · 已确认成本</span></div><TrendChart values={trend} /></article>
      <article className="v18-panel v18-chart-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">成本构成</p><h2>按能力类型</h2></div></div><DonutChart values={byModality} /><div className="v18-chart-legend">{byModality.map((entry, index) => <span key={entry.name}><i style={{ background: palette[index % palette.length] }} />{entry.name} ¥ {entry.value.toFixed(2)}</span>)}</div></article>
      <article className="v18-panel v18-chart-panel v18-chart-wide"><div className="v18-panel-heading"><div><p className="v18-eyebrow">项目归因</p><h2>哪些项目消费最多</h2></div><span className="v18-chart-note">按可确认成本排序</span></div><ProjectBars values={byProject} /></article>
      <article className="v18-panel v18-chart-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">预算观察</p><h2>内部预警</h2></div></div><div className="v18-budget-block"><div><span>Rain Studio · 演示预算</span><strong>¥ {confirmed.toFixed(2)} <small>/ ¥ 160.00</small></strong></div><div className="v18-budget-track"><span style={{ width: `${Math.min((confirmed / 160) * 100, 100)}%` }} /></div><p>这是内部观察和预警，不会阻止调用，也不会产生扣款。</p></div><div className="v18-budget-list"><span><i className="sage-dot" />已确认 <strong>¥ {confirmed.toFixed(2)}</strong></span><span><i className="amber-dot" />待核算 <strong>{pending + unknown} 条</strong></span></div></article>
    </section>
    <section className="v18-panel v18-usage-table-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">费用明细</p><h2>原始用量记录</h2></div><span className="v18-muted">{visible.length} 条 · 点击查看来源</span></div><div className="v18-usage-table"><div className="v18-usage-table-head"><span>时间 / 项目</span><span>模型或 Tool</span><span>计量</span><span>状态</span><span>成本</span><span /></div>{visible.slice().reverse().map((row) => <button key={row.id} className="v18-usage-row" onClick={() => setSelectedRow(row)}><span><strong>{row.createdAt.slice(5, 16).replace("T", " ")}</strong><small>{row.projectName} · {row.member}</small></span><span><strong>{row.model}</strong><small>{row.mcpServer || "直接调用"} {row.tool ? `· ${row.tool}` : ""}</small></span><span>{row.quantity === null ? "未知" : `${row.quantity.toLocaleString("zh-CN")} ${row.unit}`}</span><span className={`v18-cost-state ${row.costState}`}>{row.costState === "confirmed" ? "已确认" : row.costState === "estimated" ? "估算" : row.costState === "pending" ? "待核算" : "未知"}</span><span>{row.upstreamCost === null ? "未知" : `¥ ${row.upstreamCost.toFixed(2)}`}</span><ArrowRight size={15} /></button>)}</div></section>
    {selectedRow && <div className="v18-usage-detail" role="dialog" aria-label="用量记录详情"><button className="v18-icon-button" aria-label="关闭明细" onClick={() => setSelectedRow(null)}><X size={16} /></button><p className="v18-eyebrow">来源记录</p><h2>{selectedRow.model}</h2><p>{selectedRow.projectName} · {selectedRow.member}</p><dl className="v18-detail-facts"><div><dt>Trace</dt><dd>{selectedRow.traceRef}</dd></div><div><dt>来源引用</dt><dd>{selectedRow.sourceRef}</dd></div><div><dt>计量</dt><dd>{selectedRow.quantity === null ? "未知" : `${selectedRow.quantity} ${selectedRow.unit}`}</dd></div><div><dt>成本状态</dt><dd>{selectedRow.costState === "confirmed" ? "已确认" : selectedRow.costState === "estimated" ? "估算" : selectedRow.costState === "pending" ? "待核算" : "未知"}</dd></div><div><dt>上游成本</dt><dd>{selectedRow.upstreamCost === null ? "未知" : `¥ ${selectedRow.upstreamCost.toFixed(2)}`}</dd></div><div><dt>耗时</dt><dd>{selectedRow.durationMs === null ? "未知" : `${selectedRow.durationMs} ms`}</dd></div></dl><div className="v18-contract-note"><CircleAlert size={15} /><span>明细只引用演示来源，不构成客户收费记录。</span></div></div>}
  </div>;
}
