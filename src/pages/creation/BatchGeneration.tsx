import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { useCollaborationAction } from "../../app/collaboration-action";
import { createIdempotencyKey } from "../../shared/action-runner";
import type { GenerationBatch, GenerationBatchItem, SharedProject } from "../../shared/collaboration";
import { Button, DetailSheet, EmptyState, Field, Input, InlineNotice, Panel, Pill, ReadStateView, Select, SkeletonRows, Textarea, ToggleGroup, ownerLabel } from "../../components/ui";
import { FilterBar } from "../../components/FilterBar";
import { ProjectFiles } from "../assets/ProjectFiles";
import { Plus, Sparkles, X } from "../../icons";

interface DraftRow { id: string; prompt: string; prompt_ref: string; model_ref: string; size: string; aspect: string; candidate_count: number; folder_id: string }
const draft = (): DraftRow => ({ id: crypto.randomUUID(), prompt: "", prompt_ref: "", model_ref: "", size: "", aspect: "", candidate_count: 1, folder_id: "" });
export function BatchGeneration({ project }: { project: SharedProject }) {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [owner, setOwner] = useState<"eikona" | "scaena">("eikona");
  const [rows, setRows] = useState<DraftRow[]>([draft()]);
  const [name, setName] = useState("创作批次");
  const [planned, setPlanned] = useState<GenerationBatchItem[]>([]);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<"prepare" | "save" | "submit" | "reconcile" | null>(null);
  const [batch, setBatch] = useState<GenerationBatch | null>(null);
  const capabilities = useScopedRead((scope, signal) => api.capabilities(scope, signal));
  const folders = useScopedRead((_scope, signal) => api.projectFolders(project.id, signal), { key: project.id });
  const batches = useScopedRead((_scope, signal) => api.generationBatches(project.id, signal), { key: `${project.id}|${tick}`, poll: (data) => data?.rows.some((b) => ["submitting", "running", "queued"].includes(b.state)) ? 5000 : null });
  const capability = capabilities.data?.capabilities.find((v) => v.owner === owner);
  const models = [...new Set([...(capability?.model_refs || []), ...(capability?.bindings.filter((v) => v.enabled).map((v) => v.model_ref) || [])])];
  const action = useCollaborationAction((receipt) => {
    if (receipt.generation_items) setPlanned(receipt.generation_items);
    setForm(null); setTick((n) => n + 1);
  });
  const update = (id: string, value: Partial<DraftRow>) => { setRows((list) => list.map((v) => v.id === id ? { ...v, ...value } : v)); setPlanned([]); action.reset(); };
  const active = mode === "single" ? rows.slice(0, 1) : rows;
  const canEdit = project.role !== "viewer";
  const total = planned.length && planned.every((v) => v.estimated_cost !== null && v.currency === project.currency) ? planned.reduce((sum, v) => sum + v.estimated_cost!, 0) : null;
  const blocked = !project.bindings.some((b) => b.owner === owner) ? "项目尚未绑定此来源" : owner === "scaena" ? "视频 owner 尚未提供固定输入与已知费用报价合同，普通提交已阻断" : !capability ? "无法读取 owner 参数" : !canEdit ? "查看者不能提交生成" : "";
  const prepare = async () => {
    action.reset(); setForm("prepare");
    await action.prepare("generation.input.prepare", project.id, project.revision, { owner, rows: active.map((row) => ({ id: row.id, ...(row.prompt_ref ? { prompt_ref: row.prompt_ref } : { prompt: row.prompt }), model_ref: row.model_ref || models[0] || "", size: row.size || capability?.output_constraints.resolutions?.[0] || "", aspect: row.aspect || capability?.output_constraints.ratios?.[0] || "", candidate_count: row.candidate_count, folder_id: row.folder_id || null, references: [] })) }, project.id);
  };
  return <div className="page-enter space-y-5" data-page="creation">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-lg font-semibold">{project.name} · 批量创作</h1><p className="text-sm text-muted">输入交给原 owner；费用、授权与固定计划通过后再确认生成。</p></div><ToggleGroup label="生成项模式" value={mode} onChange={(v) => { setMode(v); setPlanned([]); }} options={[{ id: "single", label: "单项" }, { id: "batch", label: "批量" }]} /></div>
    {action.error && !form && <InlineNotice tone="warning">{action.error}；请查询原操作，不要创建替代提交。</InlineNotice>}
    <Panel title="生成输入" actions={<Select aria-label="生成来源" value={owner} onChange={(e) => { setOwner(e.target.value as typeof owner); setPlanned([]); action.reset(); }}><option value="eikona">图片 · Eikona</option><option value="scaena">视频 · Scaena</option></Select>}>
      <div className="space-y-4 p-4"><Field label="批次名称"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        {blocked && <InlineNotice tone="warning">{blocked}</InlineNotice>}
        <ReadStateView status={capabilities.status} error={capabilities.error} onRetry={capabilities.reload} skeleton={<SkeletonRows rows={2} />}>
          {active.map((row, index) => <section key={row.id} className="space-y-3 rounded-control border border-line bg-panel-soft p-3" aria-label={`生成项 ${index + 1}`}><div className="flex items-center justify-between"><h3 className="text-sm font-medium">生成项 {index + 1}</h3>{mode === "batch" && rows.length > 1 && <Button size="icon-sm" variant="ghost" aria-label={`移除生成项 ${index + 1}`} onClick={() => { setRows((list) => list.filter((v) => v.id !== row.id)); setPlanned([]); }}><X className="size-4" /></Button>}</div>
            <Field label="提示词"><Textarea value={row.prompt} disabled={!!row.prompt_ref} placeholder="输入创作意图；owner 会保存为待审输入，不会自动接受提示词" onChange={(e) => update(row.id, { prompt: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="模型"><Select value={row.model_ref || models[0] || ""} onChange={(e) => update(row.id, { model_ref: e.target.value })}><option value="" disabled>来源未提供模型</option>{models.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field><Field label="候选数量"><Input type="number" min={1} max={Math.min(16, capability?.limits.max_variants || 16)} value={row.candidate_count} onChange={(e) => update(row.id, { candidate_count: Number(e.target.value) })} /></Field><Field label="输出尺寸"><Select value={row.size || capability?.output_constraints.resolutions?.[0] || ""} onChange={(e) => update(row.id, { size: e.target.value })}><option value="" disabled>来源未声明</option>{capability?.output_constraints.resolutions?.map((v) => <option key={v} value={v}>{v}</option>)}</Select></Field><Field label="输出比例"><Select value={row.aspect || capability?.output_constraints.ratios?.[0] || ""} onChange={(e) => update(row.id, { aspect: e.target.value })}><option value="" disabled>来源未声明</option>{capability?.output_constraints.ratios?.map((v) => <option key={v} value={v}>{v}</option>)}</Select></Field></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="目标文件夹"><Select value={row.folder_id} onChange={(e) => update(row.id, { folder_id: e.target.value })}><option value="">未整理</option>{folders.data?.rows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field><Field label="已审阅的 owner 提示词引用（可选）"><Input value={row.prompt_ref} placeholder="填写后使用原 owner 的固定版本" onChange={(e) => update(row.id, { prompt_ref: e.target.value })} /></Field></div>
            <p className="text-xs text-muted">参考素材须使用 owner 的不可变 binding；未取得绑定合同的本地文件不会作为已上传素材提交。</p>
          </section>)}
        </ReadStateView>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted">{active.length} 个生成项 · {active.reduce((sum, row) => sum + row.candidate_count, 0)} 个候选</span><div className="flex gap-2">{mode === "batch" && <Button size="sm" disabled={!canEdit || rows.length >= 50} icon={<Plus className="size-3.5" />} onClick={() => setRows((list) => [...list, draft()])}>添加生成项</Button>}<Button size="sm" variant="primary" disabled={!!blocked || action.busy || active.some((r) => !r.prompt.trim() && !r.prompt_ref.trim())} onClick={() => void prepare()}>预览输入交接</Button></div></div>
      </div>
    </Panel>
    {planned.length > 0 && <Panel title="固定计划"><div className="space-y-3 p-4"><p className="text-sm">预计费用：{total === null ? "未知或币种不匹配" : `${total.toFixed(4)} ${project.currency}`} · 项目累计额度 {project.budget_cap} {project.currency}</p>{planned.map((item, index) => <div key={item.id} className="flex flex-wrap gap-2 text-xs"><Pill tone={item.reason ? "warning" : "success"}>生成项 {index + 1} · {item.state}</Pill>{item.reason && <span>{item.reason}</span>}</div>)}<Button size="sm" onClick={() => { setForm("save"); void action.prepare("generation.batch.create", project.id, project.revision, { name, items: planned, idempotency_key: createIdempotencyKey("batch") }, project.id); }}>保存固定批次</Button></div></Panel>}
    <Panel title="项目批次"><div className="space-y-3 p-4"><FilterBar prefix="batchFilter" placeholder="搜索生成批次" facets={[{ key: "state", label: "状态", options: ["planned", "running", "partial", "succeeded", "unknown", "failed"].map((v) => ({ value: v, label: v })) }]} /><ReadStateView status={batches.status} error={batches.error} onRetry={batches.reload} skeleton={<SkeletonRows rows={3} />}><div className="divide-y divide-line">{batches.data?.rows.filter((b) => (!params.get("batchFilterq") || b.name.includes(params.get("batchFilterq")!)) && (!params.get("batchFilterstate") || params.get("batchFilterstate")!.split(",").includes(b.state))).map((b) => <article key={b.id} className="space-y-2 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{b.name} · {b.state}</h3><div className="flex gap-2"><Button size="sm" disabled={!canEdit || !project.generation_enabled || b.state !== "planned" || b.items.some((i) => !!i.reason || i.estimated_cost === null)} onClick={() => { setBatch(b); setForm("submit"); void action.prepare("generation.batch.submit", project.id, project.revision, { batch_id: b.id }, project.id); }}>确认生成</Button><Button size="sm" variant="secondary" disabled={!canEdit || b.state === "planned" || action.busy} onClick={() => { setBatch(b); setForm("reconcile"); void action.prepare("generation.batch.reconcile", project.id, project.revision, { batch_id: b.id }, project.id); }}>查询原操作</Button></div></div>{b.items.map((v, i) => <p key={v.id} className="break-words text-xs text-muted">{i + 1}. {ownerLabel(v.owner)} · {v.candidate_count} 个候选 · {v.state}{v.reason && ` · ${v.reason}`}</p>)}</article>)}</div>{!batches.data?.rows.length && <EmptyState compact title="暂无生成批次" body="保存计划后显示逐项状态；未知接收状态只查询原操作。" />}</ReadStateView></div></Panel>
    <ProjectFiles project={project} />
    <DetailSheet open={!!form} onOpenChange={(v) => { if (!v) setForm(null); }} title={form === "submit" ? "确认固定计划与费用" : form === "reconcile" ? "查询原操作" : form === "save" ? "保存固定批次" : "交接创作输入"} footer={<Button variant="primary" disabled={!action.preview || action.busy} onClick={() => void action.confirm()}>{action.busy ? "处理中…" : "确认"}</Button>}><div className="space-y-3"><InlineNotice>{form === "prepare" ? "创作输入交给 owner 保存，控制中心只保留引用与摘要。此步骤不会触发生成。" : form === "submit" ? `确认 ${batch?.items.length || 0} 项、${batch?.items.reduce((n, v) => n + v.candidate_count, 0) || 0} 个候选；输入摘要、费用、绑定与幂等键已固定。` : form === "reconcile" ? "只查询已确认的原操作，不重试提交。" : "目录引用随批次保存；成功结果按原任务归组。"}</InlineNotice>{action.error && <InlineNotice tone="warning">{action.error}</InlineNotice>}{!action.preview && action.busy && <SkeletonRows rows={2} />}{action.preview?.blockers.map((v) => <InlineNotice key={v} tone="warning">{v}</InlineNotice>)}</div></DetailSheet>
  </div>;
}
