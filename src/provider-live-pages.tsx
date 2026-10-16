import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AudioLines,
  CircleAlert,
  Cpu,
  Image,
  LoaderCircle,
  RefreshCw,
  Send,
  Video,
  Wallet,
  ServerCog,
} from "./icons";
import { Button, Field, Pick } from "./ui";
import { AdminPanel, AdminTabs } from "./admin-ui";
import { controlRead } from "./control-api";
import type { ControlCenterSession } from "./service-directory";
import "./provider-live.css";

export type Owner = "eikona" | "scaena" | "sonora";
export type Modality = "image" | "video" | "audio";
export type Capability = {
  id: string;
  kind?: "model" | "mcp" | "tool" | "analysis";
  owner: Owner;
  provider?: string;
  version?: string;
  modality: Modality;
  name: string;
  model_ref: string;
  state: string;
  authorization_state?: string;
  contract_state?: string;
  supports_live_submit: boolean;
  observed_at: string;
  last_call_at?: string;
  transport?: string;
  constraints?: Record<string, string | number | boolean | null>;
  metering?: string;
  quality?: Record<string, string | number | null>;
  tools?: string[];
  project_refs?: string[];
};
export type UsageRow = {
  source_ref: string;
  trace_ref: string;
  owner: Owner;
  model_ref: string;
  modality: Modality;
  quantity: number | null;
  unit: string;
  upstream_cost: number | null;
  currency: string;
  cost_state: string;
  status: string;
  project_ref: string;
  created_at: string;
};
export type Run = {
  run_ref: string;
  owner: Owner;
  modality: Modality;
  model_ref: string;
  project_ref: string;
  trace_ref: string;
  source_ref: string | null;
  state: string;
  output_refs: string[];
  upstream_cost: number | null;
  currency: string;
  cost_state: string;
  observed_at: string;
  error_code: string | null;
};
export type ProviderInspectorTarget =
  | { kind: "capability"; value: Capability }
  | { kind: "usage"; value: UsageRow }
  | { kind: "run"; value: Run };

const ownerLabel: Record<Owner, string> = { eikona: "Eikona", scaena: "Scaena", sonora: "Sonora" };
const modalityLabel: Record<Modality, string> = { image: "图像", video: "视频", audio: "音频" };
const stateLabel: Record<string, string> = {
  configured: "已登记",
  needs_configuration: "待配置",
  needs_contract: "待合同",
  accepted: "已接收",
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  unknown: "结果未知",
  reconciling: "核对中",
  reconciled: "已核对",
};
const iconFor = (modality: Modality) => modality === "image" ? Image : modality === "video" ? Video : AudioLines;
function titleForState(value: string) { return stateLabel[value] || value || "未知"; }
function RunBadge({ state }: { state: string }) { return <span className={`provider-state provider-state-${state}`}><i />{titleForState(state)}</span>; }
function scopePath(scope: string, suffix: string) { return `${suffix}${suffix.includes("?") ? "&" : "?"}scope=${encodeURIComponent(scope)}`; }
function safeDate(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未知"; }
function valueOrUnknown(value?: string | number | boolean | null) { return value === undefined || value === null || value === "" ? "未知" : String(value); }

type CapabilityView = "models" | "mcp" | "tools" | "analysis";
type DirectoryService = { id: string; name: string; owner_path: string; configuration: string; connections: { id: string; label: string; project: string; enabled: boolean; runtime?: { state: string; checked_at: string; authorization: string; contract: string; content: string } }[] };

export function ProviderCapabilitiesPage({ scope, revision, onOpen }: { scope: string; revision: number; onOpen?: (row: Capability) => void }) {
  const [rows, setRows] = useState<Capability[]>([]);
  const [services, setServices] = useState<DirectoryService[]>([]);
  const [view, setView] = useState<CapabilityView>("models");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      controlRead<{ capabilities: Capability[] }>(scopePath(scope, "/capabilities"), c.signal),
      controlRead<{ services: DirectoryService[] }>(scopePath(scope, "/services?observe=1"), c.signal),
    ])
      .then(([capabilityData, serviceData]) => { setRows(capabilityData.capabilities || []); setServices(serviceData.services || []); })
      .catch((e) => !c.signal.aborted && setError(e.message || "source_unavailable"))
      .finally(() => !c.signal.aborted && setLoading(false));
    return () => c.abort();
  }, [scope, revision]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const serviceRows: Capability[] = services.filter((service) => ["eikona", "scaena", "sonora"].includes(service.id)).flatMap((service) => service.connections.filter((connection) => connection.enabled).map((connection) => ({
      id: `mcp:${service.id}:${connection.id}`, kind: "mcp" as const, owner: service.id as Owner, provider: service.name,
      modality: service.id === "scaena" ? "video" : service.id === "sonora" ? "audio" : "image", name: service.name,
      model_ref: connection.label, state: connection.runtime?.state || service.configuration, authorization_state: connection.runtime?.authorization,
      contract_state: connection.runtime?.contract, supports_live_submit: false, observed_at: connection.runtime?.checked_at || "", transport: "MCP",
      project_refs: [connection.project], tools: [],
    })));
    const toolRows: Capability[] = rows.flatMap((row) => (row.tools || []).map((tool) => ({
      ...row,
      id: `tool:${row.id}:${tool}`,
      kind: "tool" as const,
      name: tool,
      model_ref: row.model_ref,
      tools: [],
    })));
    const sourceRows = view === "mcp" ? serviceRows : view === "tools" ? toolRows : rows;
    const grouped = new Map<string, Capability>();
    for (const row of sourceRows) {
      const kind = row.kind || "model";
      const matchKind = view === "models" ? kind === "model" : view === "mcp" ? kind === "mcp" : view === "tools" ? kind === "tool" : true;
      if (!matchKind || (owner && row.owner !== owner) || (state && row.state !== state)) continue;
      if (needle && ![row.name, row.model_ref, row.owner, row.provider || "", ...(row.tools || [])].some((v) => v.toLowerCase().includes(needle))) continue;
      const key = view === "models"
        ? [row.owner, row.model_ref, row.modality].join(":")
        : view === "mcp"
          ? [row.owner, row.provider || row.name].join(":")
          : row.id;
      const existing = grouped.get(key);
      if (!existing) grouped.set(key, { ...row, project_refs: [...(row.project_refs || [])] });
      else grouped.set(key, { ...existing, project_refs: [...new Set([...(existing.project_refs || []), ...(row.project_refs || [])])] });
    }
    return [...grouped.values()];
  }, [rows, view, search, owner, state]);

  const viewLabel = view === "models" ? "AI 模型" : view === "mcp" ? "MCP 服务" : view === "tools" ? "Tool 目录" : "能力分析";
  return <div className="provider-page capability-hub">
    <header className="provider-page-heading">
      <div><p className="eyebrow">模型与工具</p><h2>能力中心</h2><p>目录、授权、调用合同与真实 Provider 状态分开呈现。</p></div>
      <Button onClick={() => location.reload()}><RefreshCw size={15} />刷新</Button>
    </header>
    <div className="provider-view-tabs" role="tablist" aria-label="能力中心视图">
      {([["models", "AI 模型"], ["mcp", "MCP 服务"], ["tools", "Tool 目录"], ["analysis", "能力分析"]] as [CapabilityView, string][]).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>
      )}
    </div>
    <div className="provider-directory-toolbar">
      <label><span>搜索能力、模型或工具</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="输入名称、model ref 或 owner" /></label>
      <label><span>Owner</span><select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">全部 owner</option>{(["eikona", "scaena", "sonora"] as Owner[]).map((value) => <option key={value} value={value}>{ownerLabel[value]}</option>)}</select></label>
      <label><span>状态</span><select value={state} onChange={(e) => setState(e.target.value)}><option value="">全部状态</option>{Object.entries(stateLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <span className="provider-directory-count">{viewLabel} · {visible.length} 项</span>
    </div>
    {error && <div className="provider-notice error"><CircleAlert size={16} />{stateLabel[error] || error}</div>}
    {loading ? <div className="provider-loading"><LoaderCircle className="spin" size={18} />正在读取能力目录</div> :
      <div className="provider-directory-table-wrap">
        <table className="provider-directory-table">
          <thead><tr><th>名称 / Provider</th><th>模型 / 工具</th><th>模态</th><th>传输</th><th>授权与合同</th><th>最近观察</th><th>操作</th></tr></thead>
          <tbody>{visible.map((row) => {
            const Icon = iconFor(row.modality);
            return <tr key={row.id}>
              <td><div className="provider-directory-name"><span className={`provider-modality ${row.modality}`}><Icon size={16} /></span><span><strong>{row.name}</strong><small>{ownerLabel[row.owner]} · {row.provider || "Provider 未提供"}</small></span></div></td>
              <td><strong>{row.model_ref}</strong><small>{row.tools?.length ? `${row.tools.length} 个工具` : row.project_refs?.length ? `${row.project_refs.length} 个项目范围` : "未提供附属目录"}</small></td>
              <td>{modalityLabel[row.modality]}</td>
              <td>{row.transport || "MCP"}</td>
              <td><RunBadge state={row.state} /><small>{row.supports_live_submit ? "真实提交已开放" : titleForState(row.contract_state || "needs_contract")}</small></td>
              <td className="tabular">{safeDate(row.observed_at)}</td>
              <td><Button variant="ghost" onClick={() => onOpen?.(row)}>查看详情 →</Button></td>
            </tr>;
          })}</tbody>
        </table>
        {!visible.length && <div className="provider-empty"><ServerCog size={20} /><p>当前授权范围没有符合条件的{viewLabel}记录。</p></div>}
      </div>
    }
    <div className="provider-notice"><Cpu size={16} />目录登记、授权、可调用和实际观察是不同状态；缺少明确 action manifest 时保持待合同。</div>
  </div>;
}

export function ProviderUsagePage({ scope, revision, onOpen }: { scope: string; revision: number; onOpen?: (row: UsageRow) => void }) {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [budgetState, setBudgetState] = useState({ total: 30, reserved: 0, remaining: 30 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    controlRead<{ rows: UsageRow[]; budget?: { total: number; reserved: number; remaining: number } }>(scopePath(scope, "/usage"), c.signal)
      .then((v) => { setRows(v.rows || []); if (v.budget) setBudgetState(v.budget); })
      .catch((e) => !c.signal.aborted && setError(e.message || "source_unavailable"))
      .finally(() => !c.signal.aborted && setLoading(false));
    return () => c.abort();
  }, [scope, revision]);
  const uniqueRows = useMemo(() => [...new Map(rows.map((row) => [row.owner + ":" + row.source_ref, row])).values()], [rows]);
  const confirmed = uniqueRows.filter((row) => row.cost_state === "confirmed" && row.currency === "CNY").reduce((sum, row) => sum + (row.upstream_cost || 0), 0);
  const unknown = uniqueRows.filter((row) => row.cost_state === "unknown").length;
  const totals = useMemo(() => Object.fromEntries((["image", "video", "audio"] as Modality[]).map((modality) => [modality, uniqueRows.filter((row) => row.modality === modality).length])), [uniqueRows]);
  return <div className="provider-page"><header className="provider-page-heading"><div><p className="eyebrow">用量与费用</p><h2>Provider 回执分析</h2><p>只统计已收到的来源事件；未知金额不会被补成零。</p></div><span className="provider-budget"><Wallet size={16} />预算剩余 CNY {budgetState.remaining.toFixed(2)} / {budgetState.total.toFixed(2)}</span></header>{error && <div className="provider-notice error"><CircleAlert size={16} />{error}</div>}<div className="provider-kpis"><article className="ui-card"><small>已确认上游成本</small><strong>¥ {confirmed.toFixed(2)}</strong><span>不含未知和估算</span></article><article className="ui-card"><small>来源事件</small><strong>{uniqueRows.length}</strong><span>按 owner + source_ref 去重</span></article><article className="ui-card"><small>金额未知</small><strong>{unknown}</strong><span>预算已预留 ¥ {budgetState.reserved.toFixed(2)}</span></article></div><div className="provider-breakdown">{(["image", "video", "audio"] as Modality[]).map((modality) => <div key={modality}><span>{modalityLabel[modality]}</span><div><i style={{ width: `${Math.min(100, Number(totals[modality] || 0) * 18)}%` }} /></div><strong>{totals[modality] || 0}</strong></div>)}</div>{loading ? <div className="provider-loading"><LoaderCircle className="spin" size={18} />正在读取用量</div> : <div className="ui-card provider-usage-table"><div className="provider-table-head"><span>时间 / Provider</span><span>模型</span><span>状态</span><span>成本</span></div>{uniqueRows.length ? uniqueRows.slice().reverse().map((row) => <button className="provider-table-row provider-usage-row-button" key={row.owner + ":" + row.source_ref} onClick={() => onOpen?.(row)}><span><strong>{safeDate(row.created_at)}</strong><small>{ownerLabel[row.owner]} · {row.source_ref}</small></span><span>{row.model_ref}<small>{modalityLabel[row.modality]} · {row.quantity ?? "未知"} {row.unit}</small></span><span><RunBadge state={row.status} /></span><span>{row.upstream_cost === null ? "未知" : `${row.currency} ${row.upstream_cost.toFixed(2)}`}<small>{row.cost_state === "confirmed" ? "owner 回执" : row.cost_state}</small></span></button>) : <div className="provider-empty">暂无 Provider 回执。历史请求仍在任务页查看。</div>}</div>}</div>;
}

export function ProviderCreationPage({ scope, session, revision, onRun }: { scope: string; session: ControlCenterSession; revision: number; onRun?: (run: Run | null) => void }) {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [owner, setOwner] = useState<Owner>("eikona");
  const [prompt, setPrompt] = useState("一张低成本的抽象雨夜街灯图");
  const [budget, setBudget] = useState("15");
  const [project, setProject] = useState(session.scopes.find((item) => item.id === scope)?.project || "");
  const [aspect, setAspect] = useState("1:1");
  const [quality, setQuality] = useState("low");
  const [size, setSize] = useState("1024x1024");
  const [duration, setDuration] = useState("4");
  const [format, setFormat] = useState("wav");
  const [count, setCount] = useState("1");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    controlRead<{ capabilities: Capability[] }>(scopePath(scope, "/capabilities"), c.signal).then((v) => setCapabilities(v.capabilities || [])).catch(() => {});
    return () => c.abort();
  }, [scope, revision]);
  const capability = capabilities.find((item) => item.owner === owner);
  useEffect(() => { onRun?.(run); }, [onRun, run]);
  useEffect(() => {
    if (!run || ["succeeded", "failed", "unknown", "reconciled"].includes(run.state)) return;
    const source = new EventSource(scopePath(scope, `/provider-runs/${encodeURIComponent(run.run_ref)}/events`));
    const onProviderRun = (event: MessageEvent) => { try { setRun(JSON.parse(event.data)); } catch { /* polling remains authoritative */ } };
    source.addEventListener("provider-run", onProviderRun);
    source.onerror = () => source.close();
    const interval = window.setInterval(() => controlRead<Run>(scopePath(scope, `/provider-runs/${encodeURIComponent(run.run_ref)}`)).then(setRun).catch(() => {}), 5000);
    return () => { source.close(); window.clearInterval(interval); };
  }, [run?.run_ref, run?.state, scope]);
  const modality = capability?.modality || (owner === "eikona" ? "image" : owner === "scaena" ? "video" : "audio");
  const submit = async () => {
    if (!capability?.supports_live_submit || !session.csrf) { setError("当前 owner 未开放真实提交合同"); return; }
    setBusy(true); setError(""); setRun(null);
    try {
      const parameters = modality === "image" ? { aspect, quality, size, count: Number(count) } : modality === "video" ? { aspect, duration_seconds: Number(duration), count: Number(count) } : { duration_seconds: Number(duration), format };
      const value = await controlRead<Run>(scopePath(scope, "/provider-runs"), undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
        body: JSON.stringify({ mode: "live", owner, modality, model_ref: capability.model_ref, scope_id: scope, project_ref: project, prompt, parameters, budget_cap: { amount: Number(budget), currency: "CNY" }, idempotency_key: `canary-${owner}-${Date.now()}` }),
      });
      setRun(value);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "provider_submit_unknown"); }
    finally { setBusy(false); }
  };
  return <div className="provider-page provider-creation-page">
    <header className="provider-page-heading"><div><p className="eyebrow">AI 创作</p><h2>实时 Provider 调用</h2><p>一次提交、同一 run_ref 追踪；结果未知时只提供原任务核对。</p></div><span className="provider-budget"><Activity size={16} />总预算 CNY 30</span></header>
    <div className="provider-create-grid">
      <section className="ui-card provider-form">
        <div className="provider-form-title"><Send size={17} /><h3>创建一次受控任务</h3></div>
        <div className="provider-form-section"><h4>范围与能力</h4><Pick label="Provider" value={owner} onChange={(v) => setOwner(v as Owner)} options={(["eikona", "scaena", "sonora"] as Owner[]).map((v) => ({ value: v, label: ownerLabel[v] }))} /><Field label="项目引用"><input value={project} onChange={(e) => setProject(e.target.value)} /></Field><div className="provider-form-facts"><span>模态<strong>{modalityLabel[modality]}</strong></span><span>模型<strong>{capability?.model_ref || "未登记"}</strong></span><span>合同<strong>{capability ? titleForState(capability.contract_state || capability.state) : "读取中"}</strong></span></div></div>
        <div className="provider-form-section"><h4>输入与参考</h4><Field label="提示词"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={10000} /></Field><p className="provider-form-note">参考资源只允许选择当前工作区已授权内容；本表单不上传凭据或原始 Provider payload。</p></div>
        <div className="provider-form-section"><h4>生成参数</h4>{modality === "image" && <div className="provider-field-grid"><Field label="尺寸"><select value={size} onChange={(e) => setSize(e.target.value)}><option>1024x1024</option><option>1152x2048</option><option>2048x1152</option></select></Field><Field label="比例"><select value={aspect} onChange={(e) => setAspect(e.target.value)}><option>1:1</option><option>9:16</option><option>16:9</option></select></Field><Field label="质量"><select value={quality} onChange={(e) => setQuality(e.target.value)}><option value="low">最低成本</option><option value="medium">标准</option><option value="high">高质量</option></select></Field></div>}{modality === "video" && <div className="provider-field-grid"><Field label="时长（秒）"><input inputMode="decimal" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field><Field label="比例"><select value={aspect} onChange={(e) => setAspect(e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option></select></Field></div>}{modality === "audio" && <div className="provider-field-grid"><Field label="时长（秒）"><input inputMode="decimal" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field><Field label="格式"><select value={format} onChange={(e) => setFormat(e.target.value)}><option>wav</option><option>mp3</option></select></Field></div>}<Field label="结果数量"><input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></Field></div>
        <div className="provider-form-section"><h4>预算预检</h4><Field label="本次上限（CNY）"><input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field><p className="provider-form-note">预算只做提交前上限闸门；最终成本只采信 owner 回执，未知金额保持未知。</p></div>
        <Button variant="primary" disabled={busy || !capability?.supports_live_submit} onClick={submit}>{busy ? <><LoaderCircle className="spin" size={15} />提交中</> : <><Send size={15} />提交一次</>}</Button>
      </section>
      <section className="ui-card provider-run-panel"><div className="provider-form-title"><Activity size={17} /><h3>实时回执</h3></div>{run ? <div className="provider-receipt"><RunBadge state={run.state} /><dl><div><dt>Run</dt><dd>{run.run_ref}</dd></div><div><dt>Trace</dt><dd>{run.trace_ref}</dd></div><div><dt>原始任务引用</dt><dd>{run.source_ref || "尚未返回"}</dd></div><div><dt>成本</dt><dd>{run.upstream_cost === null ? "未知" : `${run.currency} ${run.upstream_cost.toFixed(2)}`} · {run.cost_state}</dd></div></dl></div> : <div className="provider-empty"><Activity size={20} /><p>提交后在右侧工作区显示 SSE 状态和原始任务引用。</p></div>}</section>
    </div>
    {error && <div className="provider-notice error"><CircleAlert size={16} />{error}</div>}
  </div>;
}

export function ProviderInspector({ target, scope, close }: { target: ProviderInspectorTarget; scope: string; close: () => void }) {
  const title = target.kind === "capability" ? target.value.name : target.kind === "usage" ? target.value.model_ref : `${ownerLabel[target.value.owner]} · ${modalityLabel[target.value.modality]}`;
  const subtitle = target.kind === "capability" ? `${ownerLabel[target.value.owner]} · ${modalityLabel[target.value.modality]}` : target.kind === "usage" ? `${ownerLabel[target.value.owner]} · 用量来源` : "实时 Provider 回执";
  const status = target.kind === "capability" ? target.value.state : target.kind === "usage" ? target.value.status : target.value.state;
  const objectKey = target.kind === "capability" ? target.value.id : target.kind === "usage" ? target.value.source_ref : target.value.run_ref;
  return <AdminPanel open editing={false} live title={title} subtitle={subtitle} status={<RunBadge state={status} />} stage="detail" context={scope} objectKey={target.kind + ":" + objectKey} close={close} tabs={<AdminTabs value="概况" onChange={() => {}} items={[{ id: "概况", label: "概况" }]} />}>
    {target.kind === "capability" && <CapabilityInspectorBody value={target.value} scope={scope} />}
    {target.kind === "usage" && <UsageInspectorBody value={target.value} />}
    {target.kind === "run" && <RunInspectorBody value={target.value} />}
  </AdminPanel>;
}
function InspectorFacts({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return <div className="provider-inspector-content"><dl className="provider-inspector-facts">{children}</dl>{extra}<div className="provider-inspector-note">只显示授权范围内的投影；不会显示凭据、原始 prompt 或 Provider payload。</div></div>;
}
function CapabilityInspectorBody({ value, scope }: { value: Capability; scope: string }) {
  return <InspectorFacts extra={!value.supports_live_submit && <div className="provider-notice"><CircleAlert size={15} />当前只展示目录或诊断状态，没有正式提交合同。</div>}><div><dt>Provider</dt><dd>{ownerLabel[value.owner]}</dd></div><div><dt>模态</dt><dd>{modalityLabel[value.modality]}</dd></div><div><dt>模型</dt><dd>{value.model_ref}</dd></div><div><dt>版本</dt><dd>{value.version || "未知"}</dd></div><div><dt>项目范围</dt><dd>{value.project_refs?.join(", ") || scope}</dd></div><div><dt>约束</dt><dd>{value.constraints ? Object.entries(value.constraints).map(([key, item]) => `${key}: ${valueOrUnknown(item)}`).join(" · ") : "未知"}</dd></div><div><dt>计量</dt><dd>{value.metering || "未知"}</dd></div><div><dt>最近观察</dt><dd>{safeDate(value.observed_at)}</dd></div><div><dt>真实提交</dt><dd>{value.supports_live_submit ? "已开放" : "未开放"}</dd></div></InspectorFacts>;
}
function UsageInspectorBody({ value }: { value: UsageRow }) {
  return <InspectorFacts><div><dt>Provider</dt><dd>{ownerLabel[value.owner]}</dd></div><div><dt>模态</dt><dd>{modalityLabel[value.modality]}</dd></div><div><dt>模型</dt><dd>{value.model_ref}</dd></div><div><dt>项目</dt><dd>{value.project_ref}</dd></div><div><dt>Trace</dt><dd>{value.trace_ref}</dd></div><div><dt>来源引用</dt><dd>{value.source_ref}</dd></div><div><dt>计量</dt><dd>{value.quantity ?? "未知"} {value.unit}</dd></div><div><dt>成本</dt><dd>{value.upstream_cost === null ? "未知" : `${value.currency} ${value.upstream_cost.toFixed(2)}`} · {value.cost_state}</dd></div></InspectorFacts>;
}
function RunInspectorBody({ value }: { value: Run }) {
  return <InspectorFacts extra={value.error_code && <div className="provider-notice error"><CircleAlert size={15} />{value.error_code}</div>}><div><dt>Run</dt><dd>{value.run_ref}</dd></div><div><dt>Provider</dt><dd>{ownerLabel[value.owner]}</dd></div><div><dt>模态</dt><dd>{modalityLabel[value.modality]}</dd></div><div><dt>模型</dt><dd>{value.model_ref}</dd></div><div><dt>项目</dt><dd>{value.project_ref}</dd></div><div><dt>Trace</dt><dd>{value.trace_ref}</dd></div><div><dt>原始引用</dt><dd>{value.source_ref || "尚未返回"}</dd></div><div><dt>成本</dt><dd>{value.upstream_cost === null ? "未知" : `${value.currency} ${value.upstream_cost.toFixed(2)}`} · {value.cost_state}</dd></div><div><dt>结果资产</dt><dd>{value.output_refs.length ? value.output_refs.join(", ") : "尚未返回结果引用"}</dd></div></InspectorFacts>;
}
