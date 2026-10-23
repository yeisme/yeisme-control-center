import { useMemo, useState, type ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AudioLines, Check, CircleAlert, Cpu, FileImage, Image, LockKeyhole, Plus, Sparkles, X, Video } from "../../icons";
import { api, type ProviderCapabilityProjection } from "../../shared/api/control-center-client";
import { BatchGeneration } from "./BatchGeneration";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { Button, EmptyState, Field, InlineNotice, PageToolbar, Panel, Pill, ReadStateView, Select, SkeletonRows, Textarea, cx, ownerLabel } from "../../components/ui";
import { reasonLabel } from "../../shared/read-model/labels";
import { collectResults, resultAction, resultMeta, type ResultEntry } from "../../shared/read-model/tasks";
import { formatMoney } from "../../shared/read-model/format";
import { readinessMeta } from "../capabilities/readiness";
import {
  creativeGenerationModes,
  creativeModeLabels,
  creativeModeModalities,
  emptyCreativeInput,
  validateCreativeInput,
  type CreativeGenerationMode,
  type CreativeInputSpec,
  type CreativeReference,
  type CreativeReferenceRole,
  type CreativeTimelineKeyframe,
} from "../../shared/creative-input";

const modalityIcon = { image: Image, video: Video, audio: AudioLines, text: FileImage };
const modalityLabel = { image: "图像", video: "视频", audio: "音频", text: "文本" };
const roleLabels: Record<CreativeReferenceRole, string> = { subject: "主体", style: "风格", composition: "构图", motion: "运动", first_frame: "首帧", last_frame: "尾帧", keyframe: "关键帧" };

export default function CreationPage() {
  const { scopeId } = useWorkspace();
  const project = useScopedRead((_scope, signal) => api.sharedProject(scopeId, signal), { enabled: scopeId.startsWith("project_"), key: scopeId });
  if (scopeId.startsWith("project_")) return <ReadStateView status={project.status} error={project.error} onRetry={project.reload} skeleton={<SkeletonRows rows={5} />}>{project.data && <BatchGeneration key={project.data.id} project={project.data} />}</ReadStateView>;
  return <OwnerCreationPage />;
}
function OwnerCreationPage() {
  const navigate = useNavigate();
  const capabilities = useScopedRead((scope, signal) => api.capabilities(scope, signal), { isEmpty: (data) => data.capabilities.length === 0 });
  const usage = useScopedRead((scope, signal) => api.usage(scope, signal));
  const tasks = useTasks();
  const items = capabilities.data?.capabilities || [];
  const results = useMemo(() => collectResults(tasks.rows), [tasks.rows]);
  const [params] = useSearchParams();
  const requestedOwner = params.get("owner");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) || items.find((item) => item.owner === requestedOwner) || items[0];
  // A catalog deep link pre-selects mode and model for the requested owner only; later owner switches start clean.
  const seeded = selected && selected.owner === requestedOwner && !selectedId ? { mode: params.get("mode"), model: params.get("model") } : null;

  return <div className="page-enter space-y-5" data-page="creation">
    <h1 className="sr-only">AI 创作</h1>
    <PageToolbar summary="统一多模态工作台 · 页面会话草稿 · 本地预览变体。模式与参数只来自 owner 声明的能力。" meta={<Pill tone="neutral" icon={<LockKeyhole />}>Provider 提交门：默认关闭</Pill>} actions={<Button size="sm" variant="ghost" onClick={() => navigate("/capabilities?tab=models")}>查看模型目录</Button>} />
    <ReadStateView status={capabilities.status} error={capabilities.error} onRetry={capabilities.reload} skeleton={<Panel><SkeletonRows rows={3} /></Panel>} empty={<Panel><EmptyState icon={<Cpu />} title="当前范围没有可用的创作能力" body="scope 未绑定 Provider owner，或 owner 未返回能力目录。" action={<Button size="sm" onClick={() => navigate("/capabilities")}>查看模型与工具</Button>} /></Panel>}>
      <div className="grid gap-5 xl:grid-cols-[270px_minmax(0,1fr)]">
        <CapabilityList items={items} selected={selected} onSelect={setSelectedId} />
        {selected ? <CreationWorkbench key={`${selected.id}:${seeded?.mode || ""}:${seeded?.model || ""}`} capability={selected} budget={usage.data?.budget} artifacts={results} requestedMode={seeded?.mode || null} requestedModel={seeded?.model || null} /> : null}
      </div>
    </ReadStateView>
  </div>;
}

function CapabilityList({ items, selected, onSelect }: { items: ProviderCapabilityProjection[]; selected?: ProviderCapabilityProjection; onSelect: (id: string) => void }) {
  return <section aria-label="创作能力目录" className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">能力目录</h2><span className="text-2xs text-muted">{items.length} 个 owner 能力</span></div><div className="space-y-2">
    {items.map((item) => { const Icon = modalityIcon[item.modality] || Cpu; const meta = readinessMeta[item.readiness] || readinessMeta.needs_configuration; const active = item.id === selected?.id; return <button key={item.id} type="button" aria-pressed={active} onClick={() => onSelect(item.id)} className={cx("relative flex w-full items-start gap-3 rounded-card border bg-panel p-3.5 text-left shadow-panel transition-[border-color,box-shadow]", active ? "border-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_12%,transparent)]" : "border-line hover:border-line-strong")}>
      <span className={cx("grid size-9 shrink-0 place-items-center rounded-[10px] [&>svg]:size-4.5", item.modality === "image" ? "bg-kind-image-soft text-kind-image" : item.modality === "video" ? "bg-kind-video-soft text-kind-video" : "bg-kind-audio-soft text-kind-audio")}><Icon /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{modalityLabel[item.modality]} · {ownerLabel(item.owner)}</span><span className="mt-0.5 block truncate font-mono text-2xs text-muted">{item.model_ref}</span><span className="mt-2 flex flex-wrap gap-1.5"><Pill tone={meta.tone}>{meta.label}</Pill>{item.input_modes.length > 0 && <Pill tone="info">{item.input_modes.length} 种模式</Pill>}</span></span>{active && <Check className="absolute right-3 top-3 size-4 text-primary" />}
    </button>; })}
  </div></section>;
}

function CreationWorkbench({ capability, budget, artifacts, requestedMode, requestedModel }: { capability: ProviderCapabilityProjection; budget?: { total: number; reserved: number; remaining: number; per_owner: Record<string, number> }; artifacts: ResultEntry[]; requestedMode: string | null; requestedModel: string | null }) {
  const declaredModes = capability.input_modes;
  const initialMode = declaredModes.find((mode) => mode === requestedMode) || declaredModes[0] || "text_to_image";
  const enabledBindings = capability.bindings.filter((binding) => binding.enabled);
  const models = useMemo(() => [...new Set([...(requestedModel ? [requestedModel] : []), capability.model_ref, ...capability.model_refs, ...enabledBindings.map((binding) => binding.model_ref)])].filter(Boolean), [requestedModel, capability.model_ref, capability.model_refs, enabledBindings]);
  const [input, setInput] = useState<CreativeInputSpec>(() => ({ ...emptyCreativeInput(models[0] || capability.model_ref), generation_mode: initialMode, ...(initialMode === "keyframe_video" ? { timeline: { duration_ms: 6000, keyframes: [{ id: "kf:start", at_ms: 0, reference_refs: [] }, { id: "kf:end", at_ms: 6000, reference_refs: [] }], transition: "cut" as const } } : {}) }));
  const contract = useMemo(() => ({ input_modes: capability.input_modes, reference_roles: capability.reference_roles, timeline_support: capability.timeline_support, output_constraints: capability.output_constraints, input_schema_ref: capability.input_schema_ref, limits: capability.limits }), [capability]);
  const validation = useMemo(() => validateCreativeInput(input, contract), [input, contract]);
  const mode = input.generation_mode;
  const update = (patch: Partial<CreativeInputSpec>) => setInput((current) => ({ ...current, ...patch }));
  const addReference = (reference: CreativeReference) => update({ references: [...input.references, reference] });
  const addLocalReference = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; addReference({ ref: `local:${Date.now()}:${file.name}`, source: "local", name: file.name, mime: file.type || "application/octet-stream", bytes: file.size, roles: [], access: "session" }); event.target.value = ""; };
  const removeReference = (ref: string) => update({ references: input.references.filter((item) => item.ref !== ref), timeline: input.timeline ? { ...input.timeline, keyframes: input.timeline.keyframes.map((frame) => ({ ...frame, reference_refs: frame.reference_refs.filter((item) => item !== ref) })) } : undefined });
  const addKeyframe = () => { const timeline = input.timeline || { duration_ms: 6000, keyframes: [], transition: "cut" as const }; const at = Math.max(0, Math.min(timeline.duration_ms, timeline.keyframes.length ? timeline.duration_ms - 1000 : 0)); update({ timeline: { ...timeline, keyframes: [...timeline.keyframes, { id: `kf:${Date.now()}`, at_ms: at, reference_refs: [], prompt: "" }] } }); };
  const updateKeyframe = (id: string, patch: Partial<CreativeTimelineKeyframe>) => { if (!input.timeline) return; update({ timeline: { ...input.timeline, keyframes: input.timeline.keyframes.map((frame) => frame.id === id ? { ...frame, ...patch } : frame) } }); };
  const removeKeyframe = (id: string) => { if (!input.timeline) return; update({ timeline: { ...input.timeline, keyframes: input.timeline.keyframes.filter((frame) => frame.id !== id) } }); };
  const setMode = (next: CreativeGenerationMode) => update({ generation_mode: next, timeline: next === "keyframe_video" ? input.timeline || { duration_ms: 6000, keyframes: [{ id: "kf:start", at_ms: 0, reference_refs: [] }, { id: "kf:end", at_ms: 6000, reference_refs: [] }], transition: "cut" } : undefined });
  const previewCount = Math.min(4, Math.max(1, input.variant_count));
  const previewSeed = `${input.generation_mode}:${input.model_ref}:${input.prompt}:${input.references.map((ref) => ref.ref).join(",")}:${input.timeline?.keyframes.map((frame) => frame.at_ms).join(",")}`;
  const referenceOptions = input.references.filter((reference) => reference.roles.length > 0);
  const ownerCap = budget?.per_owner[capability.owner] ?? null;
  const amount = input.budget_cap.amount;
  const budgetIssue = amount !== null && (amount <= 0 || (ownerCap !== null && amount > ownerCap) || (!!budget && amount > budget.remaining));

  return <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
    <div className="space-y-5"><Panel title="创作输入" eyebrow={`${ownerLabel(capability.owner)} · ${capability.model_ref}`} actions={<Pill tone="neutral">页面会话草稿</Pill>}>
      <div className="space-y-5 p-5"><ModePicker capability={capability} value={mode} onChange={setMode} />
        <div className="grid gap-4 lg:grid-cols-2"><Field label="模型"><Select value={input.model_ref} onChange={(event) => update({ model_ref: event.target.value })}>{models.map((modelRef) => <option key={modelRef} value={modelRef}>{modelRef}</option>)}</Select></Field><Field label="变体预览数量" hint="仅生成确定性本地预览，不创建任务。"><Select value={String(input.variant_count)} onChange={(event) => update({ variant_count: Number(event.target.value) })}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 个变体</option>)}</Select></Field></div>
        <Field label={mode === "text_to_audio" ? "文本 / 台词" : mode === "text_to_text" ? "扩展提示" : "创作提示"} hint="提示词只保留在当前页面会话。"><Textarea value={input.prompt} onChange={(event) => update({ prompt: event.target.value })} maxLength={capability.limits.max_prompt_length || 10000} placeholder={mode === "text_to_audio" ? "输入需要合成的台词或旁白…" : "描述希望得到的画面、镜头、声音或文本…"} /></Field>
        <ReferenceTray capability={capability} references={input.references} artifacts={artifacts} onLocal={addLocalReference} onAddArtifact={addReference} onRemove={removeReference} onRole={(ref, role) => update({ references: input.references.map((item) => item.ref === ref ? { ...item, roles: item.roles.includes(role) ? item.roles.filter((current) => current !== role) : [...item.roles, role] } : item) })} />
        {mode === "keyframe_video" && <TimelineEditor capability={capability} input={input} referenceOptions={referenceOptions} onAdd={addKeyframe} onUpdate={updateKeyframe} onRemove={removeKeyframe} onTimeline={(timeline) => update({ timeline })} />}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="输出比例"><Select value={input.output.ratio || ""} onChange={(event) => update({ output: { ...input.output, ratio: event.target.value || undefined } })}><option value="">owner 默认</option>{(capability.output_constraints.ratios || []).map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</Select></Field><Field label="预算上限（CNY）" hint={budget ? `剩余 ${formatMoney(budget.remaining, "CNY")} · owner 上限 ${ownerCap === null ? "未提供" : formatMoney(ownerCap, "CNY")}` : "预算观察未提供"}><input type="number" min={0} step={0.5} value={amount ?? ""} onChange={(event) => update({ budget_cap: { amount: event.target.value === "" ? null : Number(event.target.value), currency: "CNY" } })} className="h-9 w-full rounded-control border border-line bg-panel px-3 text-[13px] tabular outline-none focus:border-focus focus:ring-3 focus:ring-focus/15" /></Field></div>
      </div>
    </Panel></div>
    <PreviewPanel capability={capability} input={input} validation={validation} previewCount={previewCount} previewSeed={previewSeed} budgetIssue={budgetIssue} />
  </div>;
}

function ModePicker({ capability, value, onChange }: { capability: ProviderCapabilityProjection; value: CreativeGenerationMode; onChange: (mode: CreativeGenerationMode) => void }) {
  return <div><div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium text-ink-soft">创作模式</span><span className="text-2xs text-muted">以 owner capability 为准</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{creativeGenerationModes.map((mode) => { const available = capability.input_modes.includes(mode); const kind = creativeModeModalities[mode]; const Icon = modalityIcon[kind]; return <button key={mode} type="button" disabled={!available} aria-pressed={value === mode} onClick={() => onChange(mode)} className={cx("flex min-h-16 flex-col items-start justify-between rounded-[10px] border px-3 py-2.5 text-left transition-colors", value === mode ? "border-primary bg-primary-soft text-primary" : "border-line bg-panel hover:border-line-strong", !available && "cursor-not-allowed opacity-45")}><span className="flex w-full items-center justify-between"><Icon className="size-4" /><span className="text-2xs font-mono">{available ? "可用" : "合同缺失"}</span></span><span className="text-[12px] font-medium">{creativeModeLabels[mode]}</span></button>; })}</div>{capability.input_modes.length === 0 && <InlineNotice tone="review" className="mt-3">当前 owner 尚未提供多模态输入合同，模式保持 needs_contract，不显示可用的提交状态。</InlineNotice>}</div>;
}

function ReferenceTray({ capability, references, artifacts, onLocal, onAddArtifact, onRemove, onRole }: { capability: ProviderCapabilityProjection; references: CreativeReference[]; artifacts: ResultEntry[]; onLocal: (event: ChangeEvent<HTMLInputElement>) => void; onAddArtifact: (reference: CreativeReference) => void; onRemove: (ref: string) => void; onRole: (ref: string, role: CreativeReferenceRole) => void }) {
  return <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[13px] font-semibold">参考素材托盘</h3><p className="text-2xs text-muted">本地文件只保留会话元数据；已有结果使用不透明 artifact 引用。</p></div><label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-panel px-3 text-[13px] font-medium hover:border-line-strong"><Plus className="size-3.5" />添加本地文件<input type="file" accept="image/*,audio/*,video/*" className="sr-only" onChange={onLocal} /></label></div>{references.length === 0 ? <div className="rounded-[10px] border border-dashed border-line-strong bg-panel-soft px-4 py-5 text-center text-[13px] text-muted">尚未选择参考素材</div> : <div className="space-y-2">{references.map((reference) => <div key={reference.ref} className="rounded-[10px] border border-line bg-panel-soft p-3"><div className="flex items-start gap-2"><FileImage className="mt-0.5 size-4 shrink-0 text-muted" /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{reference.name}</p><p className="mt-0.5 text-2xs text-muted">{reference.mime} · {reference.width && reference.height ? `${reference.width}×${reference.height}` : "尺寸未读取"} · {reference.source === "local" ? "本地会话" : "已有结果"} · {reference.access === "authorized" ? "已授权" : reference.access === "session" ? "会话临时" : "权限未知"}</p><div className="mt-2 flex flex-wrap gap-1.5">{capability.reference_roles.map((role) => <button key={role} type="button" onClick={() => onRole(reference.ref, role)} className={cx("rounded-chip border px-2 py-1 text-2xs", reference.roles.includes(role) ? "border-primary bg-primary-soft text-primary" : "border-line bg-panel text-muted hover:text-ink")}>{roleLabels[role]}</button>)}</div></div><Button size="icon-sm" variant="quiet" aria-label={`移除 ${reference.name}`} onClick={() => onRemove(reference.ref)}><X className="size-4" /></Button></div></div>)}</div>}<ArtifactPicker artifacts={artifacts} selected={references.map((reference) => reference.ref)} onPick={onAddArtifact} /></section>;
}

function ArtifactPicker({ artifacts, selected, onPick }: { artifacts: ResultEntry[]; selected: string[]; onPick: (reference: CreativeReference) => void }) {
  const candidates = artifacts.filter((entry) => resultAction(entry.task, "preview").enabled && !selected.includes(entry.result.ref || entry.key)).slice(0, 8);
  if (!candidates.length) return <p className="text-2xs text-muted">当前任务批次没有可授权预览的结果引用。</p>;
  return <div><p className="mb-2 text-2xs font-medium text-muted">已有结果引用</p><div className="grid gap-2 sm:grid-cols-2">{candidates.map((entry) => <button key={entry.key} type="button" onClick={() => onPick({ ref: entry.result.ref || entry.key, source: "artifact", name: entry.result.ref || entry.key, mime: entry.result.mime || "application/octet-stream", bytes: entry.result.bytes ?? null, width: entry.result.width, height: entry.result.height, duration_ms: entry.result.duration_ms, roles: [], access: "authorized" })} className="flex min-w-0 items-center gap-2 rounded-[9px] border border-line bg-panel px-2.5 py-2 text-left hover:border-line-strong"><span className="grid size-7 shrink-0 place-items-center rounded bg-panel-sunken"><FileImage className="size-3.5 text-muted" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium">{entry.result.ref || entry.key}</span><span className="block truncate text-2xs text-muted">{resultMeta(entry.result).join(" · ") || "媒体结果"}</span></span><span className="text-2xs text-muted">{ownerLabel(entry.task.locator.owner)}</span></button>)}</div></div>;
}

function TimelineEditor({ capability, input, referenceOptions, onAdd, onUpdate, onRemove, onTimeline }: { capability: ProviderCapabilityProjection; input: CreativeInputSpec; referenceOptions: CreativeReference[]; onAdd: () => void; onUpdate: (id: string, patch: Partial<CreativeTimelineKeyframe>) => void; onRemove: (id: string) => void; onTimeline: (timeline: NonNullable<CreativeInputSpec["timeline"]>) => void }) {
  const timeline = input.timeline || { duration_ms: 6000, keyframes: [], transition: "cut" as const };
  const supportsTimeline = capability.timeline_support?.enabled === true;
  return <section className="space-y-3 rounded-[10px] border border-line bg-panel-soft p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[13px] font-semibold">全时间线关键帧</h3><p className="text-2xs text-muted">时间轴 + 关键帧卡片；不引入多轨剪辑器。</p></div><Button size="sm" icon={<Plus className="size-3.5" />} onClick={onAdd} disabled={!supportsTimeline}>新增关键帧</Button></div>{!supportsTimeline ? <InlineNotice tone="review">当前 owner 未声明时间线合同，关键帧编辑保持 needs_contract。</InlineNotice> : <><div className="grid gap-3 sm:grid-cols-2"><Field label="输出时长（毫秒）"><input type="number" min={1} max={capability.limits.max_duration_ms || undefined} value={timeline.duration_ms} onChange={(event) => onTimeline({ ...timeline, duration_ms: Number(event.target.value) || 0 })} className="h-9 w-full rounded-control border border-line bg-panel px-3 text-[13px] tabular outline-none focus:border-focus focus:ring-3 focus:ring-focus/15" /></Field><Field label="转场" hint="只有 owner 明确声明时才可选择"><Select value={timeline.transition || "cut"} onChange={(event) => onTimeline({ ...timeline, transition: event.target.value as "cut" | "interpolate" })}>{(capability.timeline_support?.transitions || ["cut"]).map((transition) => <option key={transition} value={transition}>{transition === "cut" ? "直接切换" : "插值过渡"}</option>)}</Select></Field></div><div className="relative h-8 rounded-[8px] border border-line bg-panel px-2"><div className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded bg-primary/20" />{timeline.keyframes.map((frame) => <span key={frame.id} title={`${frame.at_ms}ms`} className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-primary shadow" style={{ left: `${timeline.duration_ms ? (frame.at_ms / timeline.duration_ms) * 100 : 0}%` }} />)}</div><div className="space-y-2">{timeline.keyframes.map((frame, index) => <KeyframeCard key={frame.id} frame={frame} index={index} timeline={timeline} referenceOptions={referenceOptions} onUpdate={onUpdate} onRemove={onRemove} />)}</div>{timeline.keyframes.length === 0 && <p className="text-2xs text-muted">关键帧视频默认需要首帧与尾帧。</p>}</>}</section>;
}

function KeyframeCard({ frame, index, timeline, referenceOptions, onUpdate, onRemove }: { frame: CreativeTimelineKeyframe; index: number; timeline: NonNullable<CreativeInputSpec["timeline"]>; referenceOptions: CreativeReference[]; onUpdate: (id: string, patch: Partial<CreativeTimelineKeyframe>) => void; onRemove: (id: string) => void }) {
  return <article className="rounded-[9px] border border-line bg-panel p-3"><div className="flex items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{index + 1}</span><div className="min-w-0 flex-1 space-y-2"><div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">关键帧 {index + 1}</span><Button size="icon-sm" variant="quiet" aria-label="删除关键帧" onClick={() => onRemove(frame.id)}><X className="size-3.5" /></Button></div><input type="range" min={0} max={timeline.duration_ms || 1} step={100} value={Math.max(0, Math.min(timeline.duration_ms, frame.at_ms))} onChange={(event) => onUpdate(frame.id, { at_ms: Number(event.target.value) })} className="w-full accent-[var(--primary)]" /><div className="flex items-center gap-2"><span className="text-2xs text-muted">时间</span><input type="number" min={0} max={timeline.duration_ms} value={frame.at_ms} onChange={(event) => onUpdate(frame.id, { at_ms: Number(event.target.value) || 0 })} className="h-8 w-28 rounded-control border border-line bg-panel px-2 text-xs tabular" /><span className="text-2xs text-muted">ms</span></div><Select value={frame.reference_refs[0] || ""} onChange={(event) => onUpdate(frame.id, { reference_refs: event.target.value ? [event.target.value] : [] })}><option value="">选择参考素材（可选）</option>{referenceOptions.map((reference) => <option key={reference.ref} value={reference.ref}>{reference.name}</option>)}</Select><input value={frame.prompt || ""} onChange={(event) => onUpdate(frame.id, { prompt: event.target.value })} placeholder="该关键帧的局部提示（可选）" className="h-8 w-full rounded-control border border-line bg-panel px-2.5 text-xs outline-none focus:border-focus" /></div></div></article>;
}

function PreviewPanel({ capability, input, validation, previewCount, previewSeed, budgetIssue }: { capability: ProviderCapabilityProjection; input: CreativeInputSpec; validation: ReturnType<typeof validateCreativeInput>; previewCount: number; previewSeed: string; budgetIssue: boolean }) {
  const roles = [...new Set(input.references.flatMap((reference) => reference.roles))];
  const summary: { label: string; value: string | number }[] = [
    { label: "模式", value: creativeModeLabels[input.generation_mode] },
    { label: "模型", value: input.model_ref || "未选择" },
    { label: "提示词", value: input.prompt.trim() ? `${input.prompt.trim().length} 字` : "未填写" },
    { label: "参考素材", value: input.references.length ? `${input.references.length} 个 · ${roles.map((role) => roleLabels[role]).join("、") || "未分配角色"}` : "无" },
    ...(input.timeline ? [{ label: "时间线", value: `${input.timeline.keyframes.length} 个关键帧 · ${(input.timeline.duration_ms / 1000).toFixed(1)} 秒` }] : []),
    { label: "输出", value: [input.output.ratio, input.output.resolution].filter(Boolean).join(" · ") || "owner 默认" },
    { label: "变体", value: `${previewCount} 个` },
    { label: "预算上限", value: formatMoney(input.budget_cap.amount, "CNY") ?? "未设置" },
  ];
  const hue = [...previewSeed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 0);
  const Icon = modalityIcon[capability.modality] || Sparkles;
  return <div className="space-y-5"><Panel title="合同与预览" eyebrow="本地确定性预览" actions={<Pill tone="neutral" icon={<LockKeyhole />}>不调用 Provider</Pill>}><div className="space-y-4 p-5">
    <div className="flex flex-wrap gap-2"><Pill tone={validation.valid ? "success" : "warning"} icon={validation.valid ? <Check /> : <CircleAlert />}>{validation.valid ? "输入合同通过" : `${validation.errors.length} 项需要修正`}</Pill><Pill tone="info">{previewCount} 个预览变体</Pill></div>
    {validation.errors.length > 0 && <InlineNotice tone="warning"><ul className="list-disc space-y-1 pl-4">{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul></InlineNotice>}
    {validation.warnings.length > 0 && <InlineNotice tone="info">{validation.warnings.join(" ")}</InlineNotice>}
    {budgetIssue && <InlineNotice tone="warning">预算上限必须大于 0，且不能超过剩余预算或 owner 上限。</InlineNotice>}
    <dl className="grid grid-cols-2 gap-2">{summary.map((item) => <Fact key={item.label} label={item.label} value={item.value} />)}</dl>
    <details className="rounded-[10px] border border-line bg-panel-soft"><summary className="cursor-pointer px-3 py-2 text-2xs font-medium text-muted">原始输入合同（JSON）</summary><pre className="max-h-64 overflow-auto border-t border-line px-3 py-3 font-mono text-2xs leading-5 text-ink-soft">{JSON.stringify({ ...input, references: input.references.map(({ ref, source, name, mime, roles: referenceRoles, access }) => ({ ref, source, name, mime, roles: referenceRoles, access })) }, null, 2)}</pre></details>
    <div className="grid grid-cols-2 gap-2">{Array.from({ length: previewCount }, (_, index) => <figure key={`${previewSeed}:${index}`} className="overflow-hidden rounded-[10px] border border-line bg-panel-soft">
      <div aria-hidden="true" className="grid aspect-video place-items-center text-white/85 [&>svg]:size-5" style={{ background: `linear-gradient(135deg, hsl(${(hue + index * 47) % 360} 32% 46%), hsl(${(hue + index * 47 + 60) % 360} 38% 30%))` }}><Icon /></div>
      <figcaption className="px-2.5 py-2"><span className="flex items-center justify-between gap-2 text-2xs font-medium text-ink">变体 {index + 1}<span className="font-normal text-faint">本地预览</span></span><span className="mt-0.5 block truncate text-2xs text-muted">{input.prompt.trim() || "等待提示词"}</span></figcaption>
    </figure>)}</div>
    <div className="border-t border-line pt-4"><Button variant="primary" disabled disabledReason="Provider 提交门默认关闭；需要 owner 独立授权" icon={<Sparkles className="size-4" />}>提交生成</Button><p className="mt-2 text-2xs text-muted">按钮保持不可用，不创建任务、不预留预算、不产生费用。</p></div>
  </div></Panel><Panel title="能力限制" eyebrow="owner 声明"><div className="p-5"><dl className="grid grid-cols-2 gap-2 text-[12px]"><Fact label="输入合同" value={capability.input_schema_ref || "未提供"} /><Fact label="参考角色" value={capability.reference_roles.length ? capability.reference_roles.map((role) => roleLabels[role]).join("、") : "未提供"} /><Fact label="最大参考数" value={capability.limits.max_references ?? "未提供"} /><Fact label="最大变体" value={capability.limits.max_variants ?? 4} /><Fact label="时间线" value={capability.timeline_support?.enabled ? `已声明 · 最多 ${capability.timeline_support.max_keyframes ?? "?"} 帧` : "未声明"} /><Fact label="提交门" value={capability.submit_gate === "owner_authorized" ? "owner 已授权" : "默认关闭"} /></dl>{capability.blocker && <InlineNotice tone="warning" className="mt-3">owner 阻塞：{reasonLabel(capability.blocker)}</InlineNotice>}</div></Panel></div>;
}

function Fact({ label, value }: { label: string; value: string | number }) { return <div className="rounded-[8px] bg-panel-soft px-2.5 py-2"><dt className="text-2xs text-muted">{label}</dt><dd className="mt-0.5 break-words font-mono text-2xs text-ink-soft">{value}</dd></div>; }
