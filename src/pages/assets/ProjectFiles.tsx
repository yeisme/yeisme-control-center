import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useCollaborationAction } from "../../app/collaboration-action";
import { Button, Checkbox, CopyRef, DetailSheet, EmptyState, Field, Input, InlineNotice, Panel, ReadStateView, Select, SkeletonRows, ToggleGroup, kindOf, ownerLabel } from "../../components/ui";
import { FolderClosed, Plus, ArrowLeft, Images } from "../../icons";
import { FilterBar } from "../../components/FilterBar";
import { TaskThumbnail } from "../../components/TaskThumbnail";
import { InlineMediaPreview, useMediaPreview, type PreviewTarget } from "../../components/media-preview";
import type { ProjectItem, SharedProject } from "../../shared/collaboration";

export function ProjectFiles({ project }: { project: SharedProject }) {
  const { scopeId, setScope } = useWorkspace(); const [params, setParams] = useSearchParams();
  const [tick, setTick] = useState(0); const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<ProjectItem | null>(null); const [checked, setChecked] = useState<string[]>([]);
  const [treeOpen, setTreeOpen] = useState(false); const [previewError, setPreviewError] = useState("");
  const [form, setForm] = useState<"create" | "rename" | "move" | null>(null); const [name, setName] = useState(""); const [destination, setDestination] = useState("");
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null); const [previewKey, setPreviewKey] = useState<string | null>(null);
  const batchRows = useScopedRead((_s, signal) => api.generationBatches(project.id, signal), { key: `${project.id}|${tick}`, poll: (data) => data?.rows.some((b) => ["running", "queued", "submitting"].includes(b.state)) ? 5000 : null });
  const folder = params.get("folder") || ""; const batch = params.get("batch") || "";
  const folders = useScopedRead((_s, signal) => api.projectFolders(project.id, signal), { key: `${project.id}|${tick}` });
  const signature = ["q", "owner", "kind", "state", "from", "to", "folder", "batch", "cursor"].map((key) => params.get(key) || "").join("|");
  const files = useScopedRead((_s, signal) => api.projectItems(project.id, Object.fromEntries(["q", "owner", "kind", "state", "from", "to", "folder", "batch", "cursor", "source_cursor"].map((key) => [key, params.get(key) || undefined])), signal), { key: `${project.id}|${signature}|${params.get("source_cursor")}|${tick}|${batchRows.data?.rows.map((b) => `${b.id}:${b.revision}`).join(",")}` });
  const action = useCollaborationAction(() => { setForm(null); setChecked([]); setTick((n) => n + 1); });
  const preview = useMediaPreview({ previewKey, resolve: useCallback((key: string) => previewTarget?.key === key ? previewTarget : null, [previewTarget]), onPreviewKeyChange: useCallback((key: string | null) => setPreviewKey(key), []) });
  const selectedTask = useScopedRead((_s, signal) => api.projectItemTask(project.id, selected!.id, signal), { enabled: !!selected, key: selected?.id || "" });
  const patch = (values: Record<string, string | null>) => setParams((current) => { const next = new URLSearchParams(current); for (const [key, value] of Object.entries(values)) if (value) next.set(key, value); else next.delete(key); next.delete("cursor"); return next; });
  const currentFolder = folders.data?.rows.find((f) => f.id === folder);
  const children = folders.data?.rows.filter((f) => f.parent_id === (folder && !["unfiled"].includes(folder) ? folder : null)) || [];
  const rows = files.data?.rows || [];
  const canEdit = project.role !== "viewer";
  const folderPath = useMemo(() => { const result = []; let current = currentFolder; const seen = new Set<string>(); while (current && !seen.has(current.id)) { seen.add(current.id); result.unshift(current); current = folders.data?.rows.find((f) => f.id === current!.parent_id); } return result; }, [currentFolder, folders.data]);
  if (scopeId !== project.id) return <Panel title="项目成果"><Button onClick={() => setScope(project.id)}>进入项目范围查看成果</Button></Panel>;
  const openPreview = async (item: ProjectItem) => {
    setPreviewError("");
    const task = await api.projectItemTask(project.id, item.id);
    const artifact = task.results.find((a) => a.ref === item.artifact_ref);
    if (!artifact) { setPreviewError("成果已缺失或版本已变化，请刷新目录。"); return; }
    const target: PreviewTarget = { key: item.id, task, result: artifact, kind: kindOf(artifact.mime) };
    setPreviewTarget(target); setPreviewKey(item.id); preview.open(target, { source: "asset-card", autoplay: false, syncQuery: false });
  };
  return <section className="space-y-3" aria-label="项目文件浏览器">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">项目成果</h3><div className="flex gap-2"><ToggleGroup label="成果显示方式" value={view} onChange={setView} options={[{ id: "grid", label: "网格" }, { id: "list", label: "列表" }]} />{canEdit && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => { setForm("create"); setName(""); action.reset(); }}>新建文件夹</Button>}</div></div>
    {previewError && <InlineNotice tone="warning">{previewError}</InlineNotice>}
    <Button size="sm" variant="secondary" className="lg:hidden" onClick={() => setTreeOpen(true)}>浏览目录</Button>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
      <nav aria-label="成果目录" className="hidden space-y-1 self-start rounded-control border border-line bg-panel p-2 lg:block">
        <Button variant={!folder && !batch ? "secondary" : "ghost"} size="sm" className="shrink-0 lg:w-full lg:justify-start" onClick={() => patch({ folder: null, batch: null, kind: null })}>全部成果</Button>
        <Button variant={folder === "unfiled" ? "secondary" : "ghost"} size="sm" className="shrink-0 lg:w-full lg:justify-start" onClick={() => patch({ folder: "unfiled", batch: null })}>未整理</Button>
        {[{ id: "image", label: "图片" }, { id: "video", label: "视频" }, { id: "audio", label: "音频" }].map((type) => <Button key={type.id} variant="ghost" size="sm" className="shrink-0 lg:w-full lg:justify-start" onClick={() => patch({ kind: type.id, folder: null, batch: null })}>{type.label}</Button>)}
        <p className="px-2 pt-2 text-xs text-muted">按生成批次</p>{batchRows.data?.rows.map((b) => <Button key={b.id} variant={batch === b.id ? "secondary" : "ghost"} size="sm" className="w-full justify-start" onClick={() => patch({ batch: b.id, folder: null })}><span className="truncate">{b.name} · {b.items.reduce((n, i) => n + i.candidate_count, 0)} 项</span></Button>)}
        <p className="px-2 pt-2 text-xs text-muted">我的整理</p>
        {(folders.data?.rows || []).map((f) => <Button key={f.id} variant={folder === f.id ? "secondary" : "ghost"} size="sm" className="shrink-0 lg:w-full lg:justify-start" onClick={() => patch({ folder: f.id, batch: null })}><FolderClosed className="size-3.5 shrink-0" /><span className="truncate">{f.name}</span></Button>)}
      </nav>
      <div className="min-w-0 space-y-3">
        <nav aria-label="文件夹路径" className="flex flex-wrap items-center gap-1 text-sm"><Button variant="ghost" size="sm" onClick={() => patch({ folder: null, batch: null })}>成果</Button>{folderPath.map((f) => <span key={f.id}>/ <button className="hover:underline" onClick={() => patch({ folder: f.id })}>{f.name}</button></span>)}{folder === "unfiled" && " / 未整理"}{currentFolder && canEdit && <Button size="sm" variant="ghost" onClick={() => { action.reset(); setForm("rename"); setName(currentFolder.name); }}>重命名文件夹</Button>}</nav>
        <FilterBar placeholder="搜索成果名称" dates facets={[{ key: "kind", label: "类型", options: [{ value: "image", label: "图片" }, { value: "video", label: "视频" }, { value: "audio", label: "音频" }] }, { key: "owner", label: "来源", options: project.bindings.map((b) => ({ value: b.owner, label: ownerLabel(b.owner) })) }]} />
        {files.data?.coverage !== "complete" && <InlineNotice tone="neutral">成果目录来自 owner 可读取的任务投影；当前覆盖不完整，未返回的成果不计为零。</InlineNotice>}
        {checked.length > 0 && canEdit && <Button size="sm" onClick={() => { action.reset(); setForm("move"); }}>移动 {checked.length} 项引用</Button>}
        <ReadStateView status={files.status} error={files.error} onRetry={() => { if (files.error?.includes("cursor")) patch({ cursor: null, source_cursor: null }); else files.reload(); }} skeleton={<SkeletonRows rows={5} />}>
          {children.length > 0 && !params.get("q") && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children.map((f) => <button key={f.id} className="flex min-w-0 items-center gap-2 rounded-control border border-line bg-panel px-3 py-4 text-left text-sm hover:bg-panel-soft" onClick={() => setSelected(null)} onDoubleClick={() => patch({ folder: f.id })} onKeyDown={(e) => { if (e.key === "Enter") patch({ folder: f.id }); }}><FolderCover project={project.id} folder={f.id} /><span className="truncate">{f.name}</span></button>)}</div>}
          <div className={view === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" : "divide-y divide-line rounded-control border border-line"}>
            {rows.map((item) => <article key={item.id} className={view === "grid" ? "min-w-0 rounded-control border border-line bg-panel p-2" : "flex min-w-0 items-center gap-3 bg-panel p-3"}>
              <button className={view === "grid" ? "block aspect-[4/3] w-full overflow-hidden rounded-control bg-panel-soft" : "size-12 shrink-0"} aria-label={`查看成果 ${item.name}`} onClick={() => setSelected(item)}><ItemThumbnail project={project.id} item={item} /></button>
              <button className="block min-w-0 flex-1 py-2 text-left" onClick={() => setSelected(item)}><span className="block truncate text-sm font-medium">{item.name}</span><span className="text-xs text-muted">{ownerLabel(item.owner)} · {({ image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[item.mime.split("/")[0]] || "文件"}</span></button>
              <div className="flex items-center justify-between gap-1">{canEdit && <Checkbox label={`选择 ${item.name}`} checked={checked.includes(item.id)} onChange={(v) => setChecked((list) => v ? [...list, item.id] : list.filter((id) => id !== item.id))} />}<Button size="sm" variant="ghost" onClick={() => { setSelected(item); void openPreview(item).catch((error) => setPreviewError(error instanceof Error ? error.message : "预览暂不可用")); }}>预览</Button></div>
            </article>)}
          </div>
          {!rows.length && !children.length && <EmptyState icon={<Images />} title="当前目录没有可显示的成果" body="生成结果会按原任务引用归入目录；缺少授权或来源暂不可用时保留明确状态。" />}
          {files.data?.next_source_cursor && <Button size="sm" variant="secondary" onClick={() => setParams((p) => { const next = new URLSearchParams(p); next.set("source_cursor", files.data!.next_source_cursor!); next.delete("cursor"); return next; })}>继续读取来源成果</Button>}
          {files.data?.next_cursor && <Button variant="secondary" size="sm" onClick={() => setParams((p) => { const next = new URLSearchParams(p); next.set("cursor", files.data!.next_cursor!); return next; })}>下一页</Button>}
        </ReadStateView>
      </div>
    </div>
    <DetailSheet open={treeOpen} onOpenChange={setTreeOpen} title="成果目录"><div className="grid gap-2"><Button onClick={() => { patch({ folder: null, batch: null, kind: null }); setTreeOpen(false); }}>全部成果</Button><Button onClick={() => { patch({ folder: "unfiled", batch: null }); setTreeOpen(false); }}>未整理</Button>{["image", "video", "audio"].map((kind) => <Button key={kind} variant="ghost" onClick={() => { patch({ folder: null, batch: null, kind }); setTreeOpen(false); }}>{({ image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[kind]}</Button>)}{batchRows.data?.rows.map((b) => <Button key={b.id} variant="ghost" onClick={() => { patch({ batch: b.id, folder: null }); setTreeOpen(false); }}>{b.name}</Button>)}{folders.data?.rows.map((f) => <Button key={f.id} variant="ghost" onClick={() => { patch({ folder: f.id, batch: null }); setTreeOpen(false); }}>{f.name}</Button>)}</div></DetailSheet>
    <DetailSheet open={!!selected} onOpenChange={(v) => { if (!v) { preview.close(); setSelected(null); } }} title={selected?.name || "成果详情"}>
      {selected && <div className="space-y-4"><CopyRef value={selected.artifact_ref} label="成果引用" /><p className="text-xs text-muted">{selected.mime} · {ownerLabel(selected.owner)}</p><ReadStateView status={selectedTask.status} error={selectedTask.error} onRetry={selectedTask.reload} skeleton={<SkeletonRows rows={2} />}><Button onClick={() => void openPreview(selected).catch((error) => setPreviewError(error instanceof Error ? error.message : "预览暂不可用"))}>预览 / 播放</Button></ReadStateView><InlineMediaPreview controller={preview} /><div className="flex justify-between"><Button variant="ghost" disabled={rows.findIndex((v) => v.id === selected.id) <= 0} onClick={() => { preview.close(); setSelected(rows[rows.findIndex((v) => v.id === selected.id) - 1]); }}>上一项</Button><Button variant="ghost" disabled={rows.findIndex((v) => v.id === selected.id) >= rows.length - 1} onClick={() => { preview.close(); setSelected(rows[rows.findIndex((v) => v.id === selected.id) + 1]); }}>下一项</Button></div></div>}
    </DetailSheet>
    <DetailSheet open={!!form} onOpenChange={(v) => { if (!v) setForm(null); }} title={form === "move" ? "移动成果引用" : form === "rename" ? "重命名文件夹" : "新建文件夹"} footer={<Button disabled={action.busy} variant="primary" onClick={() => action.preview ? void action.confirm() : void action.prepare(form === "move" ? "item.move" : form === "rename" ? "folder.rename" : "folder.create", project.id, project.revision, form === "move" ? { folder_id: destination || null, item_ids: checked } : form === "rename" ? { name, folder_id: folder, folder_revision: String(currentFolder?.revision) } : { name, parent_id: currentFolder?.id || null }, project.id)}>{action.preview ? "确认保存" : "预览变更"}</Button>}>
      {form === "move" ? <Field label="目标文件夹"><Select value={destination} onChange={(e) => { action.reset(); setDestination(e.target.value); }}><option value="">未整理</option>{folders.data?.rows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field> : <Field label="文件夹名称"><Input value={name} maxLength={80} onChange={(e) => { action.reset(); setName(e.target.value); }} /></Field>}
      {action.error && <InlineNotice tone="warning">{action.error}</InlineNotice>}{action.preview && <InlineNotice tone="info" className="mt-3">只修改控制中心的目录或成果引用。</InlineNotice>}
    </DetailSheet>
  </section>;
}
function ItemThumbnail({ project, item }: { project: string; item: ProjectItem }) {
  const host = useRef<HTMLSpanElement>(null); const [visible, setVisible] = useState(false);
  useEffect(() => { if (!host.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; } const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "160px" }); observer.observe(host.current); return () => observer.disconnect(); }, []);
  const task = useScopedRead((_s, signal) => api.projectItemTask(project, item.id, signal), { key: item.id, enabled: visible });
  const artifact = task.data?.results.find((r) => r.ref === item.artifact_ref);
  return <span ref={host} className="block size-full">{task.data && artifact ? <TaskThumbnail task={task.data} result={artifact} size="lg" className="size-full" /> : <span className="grid size-full place-items-center text-muted"><Images className="size-6" /></span>}</span>;
}

function FolderCover({ project, folder }: { project: string; folder: string }) {
  const files = useScopedRead((_s, signal) => api.projectItems(project, { folder, limit: 4 }, signal), { key: `${project}|cover|${folder}` });
  return <span className="grid size-12 shrink-0 grid-cols-2 overflow-hidden rounded-control border border-line bg-panel-soft">{files.data?.rows.length ? files.data.rows.map((item) => <ItemThumbnail key={item.id} project={project} item={item} />) : <FolderClosed className="col-span-2 m-auto size-7 text-muted" />}</span>;
}
