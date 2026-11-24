import { useEffect, useState } from "react";
import { useScopedRead } from "../../app/workspace";
import { useCollaborationAction } from "../../app/collaboration-action";
import { api } from "../../shared/api/control-center-client";
import type { SharedProject } from "../../shared/collaboration";
import { Button, InlineNotice, ReadStateView, SkeletonRows } from "../../components/ui";

/** Collection authority is independent from task/output bindings and never grants authoring. */
export function ProjectCollectionSource({ project, onChanged }: { project: SharedProject; onChanged: () => void }) {
  const admin = project.role === "project_admin";
  const binding = useScopedRead((_scope, signal) => api.projectCollectionBinding(project.id, signal), { key: `${project.id}|${project.revision}` });
  const options = useScopedRead((_scope, signal) => api.projectCollectionBindingOptions(project.id, signal), { key: `${project.id}|${project.revision}`, enabled: admin });
  const [selected, setSelected] = useState("");
  const action = useCollaborationAction(() => { binding.reload(); options.reload(); onChanged(); });
  useEffect(() => { setSelected(""); action.reset(); }, [project.id, project.revision]);
  const rows = options.data?.rows || [];
  const current = binding.data;
  const state = current?.availability;
  const labels = { connected: "来源可读取", binding_missing: "尚未绑定剧集来源", forbidden: "当前身份无来源权限", target_missing: "服务端未连接 Auctra", no_credential: "缺少可用来源凭据" };
  return <section className="space-y-3 rounded-card border border-line bg-panel p-4" aria-labelledby="project-collection-source">
    <h3 id="project-collection-source" className="text-body-sm font-semibold text-ink">剧集来源 · Auctra</h3>
    <p className="text-body-sm text-muted">独立于工具任务关联；每次读取使用当前访问者已有权限，不授予作品编辑权限。</p>
    <ReadStateView status={binding.status} error={binding.error} onRetry={binding.reload} skeleton={<SkeletonRows rows={1} />}>
      {current && <p className="text-body-sm text-ink">{labels[current.availability]}{current.binding ? ` · ${current.binding.project_ref}` : ""}</p>}
    </ReadStateView>
    {admin && current && <div className="flex flex-wrap items-center gap-2">
      <label className="min-w-0 text-body-sm text-muted">已有授权来源
        <select aria-label="Auctra 剧集来源" value={selected} onChange={(event) => { setSelected(event.target.value); action.reset(); }} className="ml-2 max-w-full rounded border border-line bg-panel px-2 py-1 text-ink">
          <option value="">请选择来源</option>
          {rows.map((row, index) => <option key={`${row.source_scope}:${row.project_ref}`} value={String(index)}>{row.project_ref} · {row.source_scope}</option>)}
        </select>
      </label>
      <Button size="sm" disabled={selected === "" || action.busy} onClick={() => void action.prepare("project.collection_binding.set", project.id, current.revision, { binding: rows[Number(selected)] }, project.id)}>预览绑定</Button>
      <Button size="sm" variant="ghost" disabled={state === "binding_missing" || action.busy} onClick={() => void action.prepare("project.collection_binding.set", project.id, current.revision, { binding: null }, project.id)}>预览解绑</Button>
    </div>}
    {admin && options.error && <InlineNotice tone="warning" actions={<Button size="sm" onClick={options.reload}>重试</Button>}>无法读取已有授权来源；请确认接口版本和项目权限。</InlineNotice>}
    {action.error && <InlineNotice tone="warning">变更未完成：{action.error}。请刷新项目后重试。</InlineNotice>}
    {action.preview && <InlineNotice tone="info" actions={<>
      <Button size="sm" variant="primary" disabled={action.busy || action.preview.availability !== "available"} onClick={() => void action.confirm()}>确认来源变更</Button>
      <Button size="sm" variant="ghost" disabled={action.busy} onClick={action.reset}>取消</Button>
    </>}>仅更新本项目的来源引用；变更后旧来源索引不再可见，需重新同步元数据。</InlineNotice>}
  </section>;
}
