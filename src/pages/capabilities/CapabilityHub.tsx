import { useState } from "react";
import { AudioLines, CheckCircle2, CircleAlert, Clock3, Cpu, Image, LockKeyhole, Plug, RefreshCw, Video, Wrench } from "../../icons";
import { api, type ProviderCapabilityProjection, type ProviderReadiness } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { Button, CopyRef, EmptyState, Facts, InlineNotice, Panel, Pill, ReadStateView, SkeletonRows, StaleNotice, Unknown, cx, ownerLabel, type Tone } from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";
import { SourceCoverage } from "../../components/SourceCoverage";

export const readinessMeta: Record<ProviderReadiness, { label: string; tone: Tone; body: string }> = {
  observed: { label: "已观察", tone: "success", body: "近期观察到真实调用结果。" },
  configured: { label: "能力已发现", tone: "success", body: "owner 能力目录可读；提交仍受独立提交门控制。" },
  needs_configuration: { label: "凭据或下游未就绪", tone: "warning", body: "已登记，但凭据、binding 或下游能力尚未就绪。" },
  needs_contract: { label: "待合同", tone: "review", body: "只有目录信息，缺少能力合同，不显示为可调用。" },
  forbidden: { label: "无权限", tone: "danger", body: "当前身份不能读取该能力。" },
  unavailable: { label: "不可用", tone: "danger", body: "发现过程失败或超时。" },
  stale: { label: "数据过期", tone: "warning", body: "观察结果已过期。" },
};

const modalityIcon = { image: Image, video: Video, audio: AudioLines };
const modalityLabel = { image: "图像", video: "视频", audio: "音频" };

export default function CapabilityHub() {
  const read = useScopedRead((scope, signal) => api.capabilities(scope, signal), { isEmpty: (data) => data.capabilities.length === 0 });
  const services = useScopedRead((scope, signal) => api.services(scope, signal));
  const capabilities = read.data?.capabilities || [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = capabilities.find((item) => item.id === selectedId) || capabilities[0];
  const ready = capabilities.filter((item) => item.readiness === "configured" || item.readiness === "observed").length;

  return <div className="page-enter space-y-5" data-page="capabilities">
    <h1 className="sr-only">模型与工具</h1>
    <div className="flex flex-wrap items-center justify-end gap-2"><Button size="sm" onClick={() => { read.reload(); services.reload(); }} icon={<RefreshCw className="size-3.5" />}>重新发现</Button>{read.data && <>
        <Pill tone="success" icon={<CheckCircle2 />}>{ready}/{capabilities.length} 能力已发现</Pill>
        <Pill tone="neutral" icon={<LockKeyhole />}>Provider 提交默认关闭</Pill>
      </>}</div>
    <StaleNotice status={read.status} error={read.error} observedAt={read.observedAt} onRetry={read.reload} />
    <SourceCoverage services={services.data?.services || []} />
    <ReadStateView status={read.status} error={read.error} onRetry={read.reload} skeleton={<Panel><SkeletonRows rows={3} /></Panel>} empty={<Panel><EmptyState icon={<Cpu />} title="当前范围没有绑定 Provider owner" body="scope 未绑定 Eikona、Scaena 或 Sonora 时不发起能力发现。" /></Panel>}>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)]">
        <div className="space-y-3" role="list" aria-label="能力目录">
          {capabilities.map((item, index) => {
            const meta = readinessMeta[item.readiness] || readinessMeta.needs_configuration;
            const Icon = modalityIcon[item.modality] || Cpu;
            const active = item.id === selected?.id;
            const enabled = item.bindings.filter((binding) => binding.enabled).length;
            return <button key={item.id} type="button" role="listitem" aria-pressed={active} onClick={() => setSelectedId(item.id)} style={{ "--i": index } as React.CSSProperties} className={cx(
              "stagger-in flex w-full items-start gap-4 rounded-card border bg-panel p-4 text-left shadow-panel transition-[border-color,box-shadow] duration-150",
              active ? "border-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_12%,transparent)]" : "border-line hover:border-line-strong",
            )}>
              <span className={cx("grid size-11 shrink-0 place-items-center rounded-[11px] [&>svg]:size-5", item.modality === "image" ? "bg-kind-image-soft text-kind-image" : item.modality === "video" ? "bg-kind-video-soft text-kind-video" : "bg-kind-audio-soft text-kind-audio")}><Icon /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{item.name}</span>
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                </span>
                <span className="mt-1 block truncate font-mono text-2xs text-muted">{item.model_ref}</span>
                <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
                  <span>{modalityLabel[item.modality]}</span>
                  <span>MCP</span>
                  {item.bindings.length > 0 && <span className="tabular">binding {enabled}/{item.bindings.length} 启用</span>}
                  {item.voice_refs.length > 0 && <span className="tabular">{item.voice_refs.length} 个声线</span>}
                  <span>观察于 {formatRelative(item.observed_at)}</span>
                </span>
                {item.blocker && <span className="mt-2 flex items-center gap-1.5 text-2xs text-warning"><CircleAlert className="size-3.5 shrink-0" /><span className="truncate">{item.blocker}</span></span>}
              </span>
            </button>;
          })}
          <InlineNotice tone="neutral" icon={<Wrench />}>MCP Server 与 Tool 目录尚无 owner 读取合同（needs_contract），因此不展示虚构的工具列表。</InlineNotice>
        </div>
        {selected && <CapabilityDetail item={selected} />}
      </div>
    </ReadStateView>
  </div>;
}

function CapabilityDetail({ item }: { item: ProviderCapabilityProjection }) {
  const meta = readinessMeta[item.readiness] || readinessMeta.needs_configuration;
  return <Panel className="xl:sticky xl:top-[calc(var(--topbar-height)+20px)] xl:self-start" title={item.name} eyebrow={`${ownerLabel(item.owner)} · ${modalityLabel[item.modality]}`} actions={<Pill tone={meta.tone}>{meta.label}</Pill>}>
    <div className="space-y-4 p-5">
      <p className="text-[13px] text-muted">{meta.body}</p>
      <Facts columns={2} items={[
        { label: "默认模型", value: <CopyRef value={item.model_ref} label="模型引用" />, wide: true },
        { label: "传输", value: item.transport.toUpperCase() },
        { label: "提交门", value: item.submit_gate === "owner_authorized" ? "owner 已授权" : "默认关闭" },
        { label: "最近发现", value: formatRelative(item.observed_at) },
        { label: "支持实时提交", value: item.supports_live_submit ? "能力具备（仍受提交门约束）" : "否" },
      ]} />
      {item.bindings.length > 0 && <section className="space-y-2">
        <h3 className="text-[13px] font-semibold">Provider bindings</h3>
        <ul className="divide-y divide-line rounded-[10px] border border-line">
          {item.bindings.map((binding) => <li key={binding.binding_id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13px] font-medium"><span className="truncate">{binding.binding_id}</span>{binding.default && <Pill tone="info" className="h-5 px-1.5 text-2xs">默认</Pill>}</span>
              <span className="block truncate text-2xs text-muted">{[binding.model_ref, binding.resolution, binding.ratio, binding.duration_seconds ? `${binding.duration_seconds}s` : null, binding.requires_reference ? "需参考图" : null].filter(Boolean).join(" · ")}</span>
            </span>
            <Pill tone={binding.enabled ? "success" : "warning"}>{binding.enabled ? "已启用" : binding.disabled_reason || "已关闭"}</Pill>
          </li>)}
        </ul>
      </section>}
      {item.diagnostic && <section className="space-y-2">
        <h3 className="text-[13px] font-semibold">诊断</h3>
        <Facts columns={2} items={[
          { label: "状态", value: readinessMeta[item.diagnostic.status]?.label || item.diagnostic.status },
          { label: "代码", value: item.diagnostic.code || <Unknown /> },
          { label: "凭据已配置", value: item.diagnostic.configured === null ? <Unknown /> : item.diagnostic.configured ? "是" : "否" },
          { label: "诊断时间", value: formatRelative(item.diagnostic.observed_at) },
        ]} />
      </section>}
      {(item.provider_refs.length > 0 || item.voice_refs.length > 0 || item.model_refs.length > 1) && <section className="space-y-2">
        <h3 className="text-[13px] font-semibold">目录引用</h3>
        <div className="flex flex-wrap gap-1.5">
          {[...item.model_refs, ...item.provider_refs, ...item.voice_refs].slice(0, 24).map((ref) => <span key={ref} className="rounded-[6px] bg-panel-sunken px-2 py-1 font-mono text-2xs text-ink-soft">{ref}</span>)}
        </div>
      </section>}
      {item.blocker && <InlineNotice tone="warning">{item.blocker}</InlineNotice>}
      <InlineNotice tone="neutral" icon={item.submit_gate === "owner_authorized" ? <Plug /> : <Clock3 />}>Provider 提交是独立授权门。控制中心当前不发起任何付费生成；能力目录可读不代表可以提交。</InlineNotice>
    </div>
  </Panel>;
}
