import { useEffect, useState } from "react";
import { BookOpen, LoaderCircle, LockKeyhole, Paperclip } from "../../icons";
import { api, errorCode, type AttachmentReadResult, type ContentRead, type Owner, type RequestObservationsPage, type RequestProjection } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { useObservationCache } from "../../app/observation-cache";
import { coverageLabels } from "../../request-visibility";
import { Button, CopyRef, CoverageChip, DetailSheet, Facts, InlineNotice, Pill, SegmentedTabs, SkeletonRows, TaskStatePill, Textarea, Unknown, ownerLabel } from "../../components/ui";
import { formatBytes, formatDurationMs, formatFullTime } from "../../shared/read-model/format";
import { ProcessTimeline } from "../../components/ProcessTimeline";

type Tab = "overview" | "process" | "content" | "execution";
const kindLabels: Record<string, string> = { gateway: "网关调用", generation: "生成任务", operation: "领域操作" };
const contentErrors: Record<string, string> = {
  audit_unavailable: "审计写入不可用；按规则不发起正文读取。",
  delegation_unavailable: "当前登录没有 owner 委托，无法读取正文。",
  content_contract_invalid: "owner 未声明符合合同的业务正文。",
  owner_forbidden: "owner 拒绝读取正文。",
  invalid_content_request: "用途说明需要 1–200 个字符。",
  attachment_limit_exceeded: "附件超出单次读取上限（8MB）。",
  media_limits_exceeded: "附件类型不在可预览白名单内。",
  needs_contract: "owner 尚未提供附件正文合同。",
};

export function RequestDetail({ owner, id, initial, onClose }: { owner: Owner; id: string; initial?: RequestProjection; onClose: () => void }) {
  const { scopeId } = useWorkspace();
  const cache = useObservationCache();
  const [record, setRecord] = useState<RequestProjection | null>(initial || null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [process, setProcess] = useState<{ page: RequestObservationsPage | null; status: "idle" | "loading" | "ready" | "unavailable"; error: string | null }>({ page: null, status: "idle", error: null });

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    api.request(scopeId, owner, id, controller.signal).then(setRecord).catch((failure) => { if (!controller.signal.aborted) setError(errorCode(failure)); });
    return () => controller.abort();
  }, [scopeId, owner, id, initial]);

  const loadProcess = async () => {
    if (!record || process.status === "loading") return;
    setProcess((current) => ({ ...current, status: "loading", error: null }));
    try {
      const result = await cache.read(`request-observation:${scopeId}:${owner}:${id}`, () => api.requestObservations(scopeId, owner, id), 10_000, 60_000);
      setProcess({ page: result.data, status: "ready", error: null });
    } catch (failure) {
      setProcess((current) => ({ ...current, status: "unavailable", error: errorCode(failure) }));
    }
  };

  useEffect(() => {
    if (tab === "process" && record && process.status === "idle") void loadProcess();
  }, [tab, record, process.status]);

  return <DetailSheet
    open
    returnFocus={`[data-request="${CSS.escape(owner + ":" + id)}"]`}
    onOpenChange={(open) => { if (!open) onClose(); }}
    width="lg"
    eyebrow={`${ownerLabel(owner)} · ${record ? kindLabels[record.kind] || record.kind : "请求"}`}
    title={record?.title || id}
    description={record ? <span className="inline-flex flex-wrap items-center gap-2"><TaskStatePill state={record.state} /><CoverageChip state={record.coverage.state} reason={record.coverage.reason} /></span> : undefined}
  >
    {!record ? error ? <InlineNotice tone="warning">无法读取请求详情（{error}）。</InlineNotice> : <SkeletonRows rows={4} /> : <div className="space-y-4">
      <SegmentedTabs label="请求详情" value={tab} onChange={setTab} options={[
        { id: "overview", label: "概况" },
        { id: "process", label: "采集与过程", count: record.process?.checkpoints.length || 0 },
        { id: "content", label: "内容" },
        { id: "execution", label: "执行", count: record.attempts.length },
      ]} />
      {tab === "overview" && <Overview record={record} />}
      {tab === "process" && <ProcessTimeline observation={process.page?.observation || record.process} events={process.page?.events} loading={process.status === "loading"} error={process.status === "unavailable" ? process.error : null} onRetry={() => void loadProcess()} />}
      {tab === "content" && <ContentTab record={record} />}
      {tab === "execution" && <Execution record={record} />}
    </div>}
  </DetailSheet>;
}

function params(values: Record<string, string | number | boolean | null>) {
  const entries = Object.entries(values);
  return entries.length ? <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">{entries.map(([key, value]) => <div key={key} className="flex min-w-0 gap-2"><dt className="shrink-0 text-muted">{key}</dt><dd className="min-w-0 truncate font-mono text-xs">{String(value)}</dd></div>)}</dl> : <Unknown>未记录</Unknown>;
}

function Overview({ record }: { record: RequestProjection }) {
  return <div className="space-y-4">
    <Facts columns={2} items={[
      { label: "请求引用", value: <CopyRef value={record.id} label="请求引用" />, wide: true },
      { label: "创建时间", value: formatFullTime(record.created_at) },
      { label: "耗时", value: formatDurationMs(record.duration_ms) || <Unknown /> },
      { label: "执行者", value: record.actor ? `${record.actor}${record.actor_type !== "unknown" ? ` · ${record.actor_type === "human" ? "成员" : "服务"}` : ""}` : <Unknown /> },
      { label: "模型", value: record.model || <Unknown /> },
      { label: "Owner 状态", value: record.native_state || <Unknown /> },
      { label: "租户 / 项目", value: `${record.tenant} / ${record.project}` },
      ...(record.parent_ref ? [{ label: "父引用", value: <CopyRef value={record.parent_ref} label="父引用" />, wide: true }] : []),
      ...(record.finance ? [{ label: "费用", value: record.finance.amount === null ? <Unknown>{record.finance.state}</Unknown> : `${record.finance.currency} ${record.finance.amount} · ${record.finance.state}` }] : []),
    ]} />
    <section className="space-y-2">
      <h3 className="text-[13px] font-semibold">提交参数</h3>
      <div className="rounded-[10px] border border-line px-3 py-2.5">{params(record.submitted)}</div>
      <h3 className="pt-1 text-[13px] font-semibold">实际生效参数</h3>
      <div className="rounded-[10px] border border-line px-3 py-2.5">{params(record.effective)}</div>
      <p className="text-2xs text-muted">只展示 owner 允许公开的参数键；正文不在此处展示。</p>
    </section>
    {record.attachments.length > 0 && <section className="space-y-2">
      <h3 className="text-[13px] font-semibold">附件 <span className="font-normal text-muted">{record.attachments.length}</span></h3>
      <ul className="divide-y divide-line rounded-[10px] border border-line">
        {record.attachments.map((attachment) => <li key={attachment.ref} className="flex items-center gap-3 px-3 py-2.5">
          <Paperclip className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px]">{attachment.name || attachment.ref}</span>
            <span className="block truncate text-2xs text-muted">{[attachment.source === "upload" ? "上传" : attachment.source === "reference" ? "引用" : "生成", attachment.mime, formatBytes(attachment.bytes), attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : null].filter(Boolean).join(" · ")}</span>
          </span>
          <CoverageChip state={attachment.state} />
        </li>)}
      </ul>
    </section>}
    {record.output_refs.length > 0 && <section className="space-y-2">
      <h3 className="text-[13px] font-semibold">产出引用</h3>
      <ul className="space-y-1">{record.output_refs.map((ref) => <li key={ref}><CopyRef value={ref} label="产出引用" /></li>)}</ul>
    </section>}
  </div>;
}

type AttachmentState = { loading?: boolean; read?: AttachmentReadResult; error?: string };

function AttachmentPreview({ read }: { read: AttachmentReadResult }) {
  if (read.url && (read.mime || "").startsWith("image/"))
    return <img src={read.url} alt="附件预览" className="max-h-[420px] w-auto rounded-[10px] border border-line" />;
  if (read.url && (read.mime || "").startsWith("audio/"))
    return <audio controls src={read.url} className="w-full" />;
  if (read.url && (read.mime || "").startsWith("video/"))
    return <video controls src={read.url} className="max-h-[420px] w-full rounded-[10px] border border-line" />;
  if (read.text)
    return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-line bg-panel-soft p-3 font-mono text-xs leading-5 text-ink">{read.text}</pre>;
  return <p className="text-[13px] text-muted">owner 没有返回可展示的附件内容（{coverageLabels[(read.state as keyof typeof coverageLabels)] || read.state}）。</p>;
}

function ContentTab({ record }: { record: RequestProjection }) {
  const { scopeId, session } = useWorkspace();
  const [direction, setDirection] = useState<"input" | "output">("input");
  const [purpose, setPurpose] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ direction: "input" | "output"; read: ContentRead } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Record<string, AttachmentState>>({});
  const availability = direction === "input" ? record.input : record.output;

  const read = async () => {
    if (!session || pending || !purpose.trim()) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult({ direction, read: await api.requestContent(scopeId, record.owner, record.id, direction, purpose.trim(), session.csrf) });
    } catch (failure) {
      setError(errorCode(failure));
    } finally {
      setPending(false);
    }
  };

  const readAttachment = async (ref: string, attachmentDirection: "input" | "output") => {
    if (!session || attachments[ref]?.loading || !purpose.trim()) return;
    setAttachments((current) => ({ ...current, [ref]: { loading: true } }));
    try {
      const read = await api.requestAttachment(scopeId, record.owner, record.id, ref, attachmentDirection, purpose.trim(), session.csrf);
      setAttachments((current) => ({ ...current, [ref]: { read } }));
    } catch (failure) {
      setAttachments((current) => ({ ...current, [ref]: { error: errorCode(failure) } }));
    }
  };

  return <div className="space-y-4">
    <InlineNotice tone="info" icon={<LockKeyhole />}>正文按需读取：每次读取都需要说明用途，服务端先写审计再访问 owner。正文只保存在当前页面内存中，切换范围或关闭详情即清除。</InlineNotice>
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedTabs label="方向" value={direction} onChange={(value) => { setDirection(value); setResult(null); setError(null); }} options={[{ id: "input", label: "输入" }, { id: "output", label: "输出" }]} />
      <span className="text-2xs text-muted">owner 声明：{coverageLabels[availability]}</span>
    </div>
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-ink-soft">读取用途（写入审计）</span>
      <Textarea value={purpose} maxLength={200} onChange={(event) => setPurpose(event.target.value)} placeholder="例如：排查该请求为何失败" className="min-h-16" />
    </label>
    <Button variant="primary" size="sm" disabled={!purpose.trim() || pending || availability === "not_recorded"} onClick={() => void read()} icon={pending ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <BookOpen className="size-3.5" />}>读取{direction === "input" ? "输入" : "输出"}正文</Button>
    {availability === "not_recorded" && <p className="text-2xs text-muted">owner 未采集该方向的正文。</p>}
    {error && <InlineNotice tone="warning">{contentErrors[error] || `读取失败（${error}）`}</InlineNotice>}
    {result && <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <CoverageChip state={result.read.state} />
        {result.read.truncated && <Pill tone="warning">已截断</Pill>}
        {result.read.receipt_ref && <span className="text-2xs text-muted">审计回执 <CopyRef value={result.read.receipt_ref} label="回执" /></span>}
      </div>
      {result.read.text ? <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-line bg-panel-soft p-3 font-mono text-xs leading-5 text-ink">{result.read.text}</pre> : <p className="text-[13px] text-muted">owner 没有返回可展示的正文（{coverageLabels[result.read.state]}）。</p>}
    </section>}
    {record.attachments.length > 0 && <section className="space-y-2">
      <h3 className="text-[13px] font-semibold">附件正文 <span className="font-normal text-muted">{record.attachments.length}</span></h3>
      <p className="text-2xs text-muted">上传/引用附件按输入方向、生成附件按输出方向读取；复用上面的用途说明与审计规则。</p>
      <ul className="divide-y divide-line rounded-[10px] border border-line">
        {record.attachments.map((attachment) => {
          const state = attachments[attachment.ref] || {};
          const attachmentDirection = attachment.source === "generated" ? "output" : "input";
          return <li key={attachment.ref} className="space-y-2 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <Paperclip className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{attachment.name || attachment.ref}</span>
                <span className="block truncate text-2xs text-muted">{[attachmentDirection === "input" ? "输入" : "输出", attachment.mime, formatBytes(attachment.bytes)].filter(Boolean).join(" · ")}</span>
              </span>
              <Button size="sm" disabled={!purpose.trim() || state.loading} onClick={() => void readAttachment(attachment.ref, attachmentDirection)} icon={state.loading ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <BookOpen className="size-3.5" />}>读取</Button>
            </div>
            {state.error && <InlineNotice tone="warning">{contentErrors[state.error] || `读取失败（${state.error}）`}</InlineNotice>}
            {state.read && <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CoverageChip state={state.read.state as never} />
                {state.read.truncated && <Pill tone="warning">已截断</Pill>}
                {state.read.receipt_ref && <span className="text-2xs text-muted">审计回执 <CopyRef value={state.read.receipt_ref} label="回执" /></span>}
              </div>
              <AttachmentPreview read={state.read} />
            </div>}
          </li>;})}
      </ul>
    </section>}
  </div>;
}

function Execution({ record }: { record: RequestProjection }) {
  if (!record.attempts.length) return <p className="text-[13px] text-muted">owner 没有提供执行尝试记录。</p>;
  return <ol className="space-y-2">
    {record.attempts.map((attempt, index) => <li key={attempt.ref} className="flex items-start gap-3 rounded-[10px] border border-line px-3 py-2.5">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-panel-sunken text-2xs font-semibold text-muted tabular">{index + 1}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><TaskStatePill state={attempt.state} /><CopyRef value={attempt.ref} label="尝试引用" /></span>
        <span className="mt-1 block text-2xs text-muted">{attempt.started_at ? `开始 ${formatFullTime(attempt.started_at)}` : "开始时间未提供"}{attempt.completed_at ? ` · 结束 ${formatFullTime(attempt.completed_at)}` : ""}</span>
      </span>
    </li>)}
  </ol>;
}
