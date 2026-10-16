import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Cpu,
  Network,
  Plug,
  Server,
  Wrench,
} from "../icons";
import type { CapabilityCategory, CapabilityReadiness, CapabilityRecord } from "./types";

const categoryMeta: Record<CapabilityCategory, { label: string; icon: typeof Cpu }> = {
  model: { label: "AI 模型", icon: Cpu },
  mcp: { label: "MCP 服务", icon: Network },
  tool: { label: "Tool 目录", icon: Wrench },
  analysis: { label: "能力分析", icon: Activity },
};

const readinessTone: Record<CapabilityReadiness, string> = {
  registered: "neutral",
  configured: "info",
  authorized: "info",
  callable: "success",
  observed: "success",
  needs_contract: "warning",
};

function ReadinessBadge({ record }: { record: CapabilityRecord }) {
  const tone = readinessTone[record.readiness];
  const Icon = record.readiness === "observed" || record.readiness === "callable"
    ? CheckCircle2
    : record.readiness === "needs_contract"
      ? CircleAlert
      : Clock3;
  return <span className={`v18-status v18-status-${tone}`}><Icon size={13} />{record.readinessLabel}</span>;
}

export function CapabilityHub({ catalog }: { catalog: CapabilityRecord[] }) {
  const [category, setCategory] = useState<CapabilityCategory | "all">("all");
  const [selectedId, setSelectedId] = useState(catalog[0]?.id || "");
  const visible = useMemo(() => {
    if (category !== "analysis") return catalog.filter((record) => category === "all" || record.category === category);
    return catalog.map((record) => ({
      ...record,
      id: `analysis:${record.id}`,
      category: "analysis" as const,
      name: `${record.name} · 调用分析`,
      description: `${record.description}。调用量、成功率、延迟和失败原因只引用已观察数据。`,
      readinessLabel: record.observedAt ? "已观察" : "未记录",
    }));
  }, [catalog, category]);
  const selected = catalog.find((record) => record.id === selectedId) || visible[0];
  const observedCount = catalog.filter((record) => ["observed", "callable"].includes(record.readiness)).length;

  return <div className="v18-page v18-page-enter" data-page="capabilities">
    <div className="v18-page-header">
      <div>
        <p className="v18-eyebrow">资源运营</p>
        <h1>模型与工具</h1>
        <p className="v18-page-body">统一查看模型能力、MCP 连接、Tool 目录和当前接入状态。</p>
      </div>
      <span className="v18-inline-status"><Activity size={14} />{observedCount} 项最近已观察</span>
    </div>
    <div className="v18-hub-tabs" role="tablist" aria-label="能力类型">
      <button className={category === "all" ? "active" : ""} role="tab" aria-selected={category === "all"} onClick={() => setCategory("all")}>全部 <span>{catalog.length}</span></button>
      {(Object.keys(categoryMeta) as CapabilityCategory[]).map((key) => {
        const Icon = categoryMeta[key].icon;
        return <button key={key} className={category === key ? "active" : ""} role="tab" aria-selected={category === key} onClick={() => setCategory(key)}><Icon size={15} />{categoryMeta[key].label} <span>{key === "analysis" ? catalog.length : catalog.filter((record) => record.category === key).length}</span></button>;
      })}
    </div>
    <div className="v18-capability-hub-layout">
      <section className="v18-panel v18-capability-directory">
        <div className="v18-panel-heading"><div><p className="v18-eyebrow">能力目录</p><h2>{visible.length} 个登记条目</h2></div><span className="v18-muted">状态分层展示</span></div>
        <div className="v18-capability-directory-list">
          {visible.map((record) => {
            const CategoryIcon = categoryMeta[record.category].icon;
            return <button key={record.id} className={`v18-capability-directory-row ${record.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(record.id)}>
              <span className={`v18-capability-icon ${record.accent}`}><CategoryIcon size={18} /></span>
              <span className="v18-capability-directory-copy"><strong>{record.name}</strong><small>{record.provider} · {record.version}</small></span>
              <ReadinessBadge record={record} />
              <ArrowRight size={15} />
            </button>;
          })}
        </div>
      </section>
      {selected ? <aside className="v18-panel v18-capability-detail">
        <div className="v18-capability-detail-head"><span className={`v18-capability-icon ${selected.accent}`}><Server size={19} /></span><div><p className="v18-eyebrow">{categoryMeta[selected.category].label}</p><h2>{selected.name}</h2><p>{selected.description}</p></div></div>
        <ReadinessBadge record={selected} />
        <div className="v18-detail-facts">
          <div><span>Provider</span><strong>{selected.provider}</strong></div>
          <div><span>维护方</span><strong>{selected.owner}</strong></div>
          <div><span>计量单位</span><strong>{selected.metering}</strong></div>
          <div><span>最近观察</span><strong>{selected.observedAt || "尚未观察"}</strong></div>
          <div><span>成功率</span><strong>{selected.successRate === null ? "未知" : `${(selected.successRate * 100).toFixed(1)}%`}</strong></div>
          <div><span>延迟</span><strong>{selected.latencyMs === null ? "未知" : `${selected.latencyMs} ms`}</strong></div>
        </div>
        <div className="v18-capability-detail-section"><span className="v18-detail-label">支持能力</span><div className="v18-chip-row">{selected.modalities.map((item) => <span className="v18-detail-chip" key={item}>{item}</span>)}</div></div>
        <div className="v18-capability-detail-section"><span className="v18-detail-label">约束</span><ul className="v18-constraint-list">{selected.constraints.map((item) => <li key={item}>{item}</li>)}</ul></div>
        {selected.toolCount !== undefined && <div className="v18-capability-callout"><Plug size={15} /><span>公开 Tool <strong>{selected.toolCount}</strong> 个，调用费用沿下游 Model Call 归因。</span></div>}
        {selected.readiness === "needs_contract" && <div className="v18-contract-note"><CircleAlert size={15} /><span>当前只有目录信息，未显示为可调用。</span></div>}
      </aside> : <div className="v18-empty"><strong>没有匹配的能力</strong><p>切换上方分类查看其他条目。</p></div>}
    </div>
  </div>;
}
