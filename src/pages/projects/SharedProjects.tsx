import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, errorCode } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useCollaborationAction } from "../../app/collaboration-action";
import { Button, Checkbox, CopyRef, DetailSheet, EmptyState, Field, Input, InlineNotice, MenuContent, MenuItem, MenuRoot, MenuTrigger, PageToolbar, Panel, Pill, ReadStateView, Select, SkeletonRows, useToast } from "../../components/ui";
import { ArrowLeft, FolderKanban, MoreHorizontal, Plus } from "../../icons";
import { FilterBar } from "../../components/FilterBar";
import { copyReference } from "../../shared/clipboard";
import { projectRoleLabels, type CollaborationMember, type CollaborationOrganization, type CollaborationTeam, type ProjectBinding, type ProjectGrant, type ProjectRole, type SharedProject } from "../../shared/collaboration";
import { ProjectFiles } from "../assets/ProjectFiles";

type Form = "organization" | "project" | "rename" | "members" | "bindings" | "policy" | null;
export default function SharedProjects() {
  const { scopeId, session, setScope } = useWorkspace(); const navigate = useNavigate(); const toast = useToast();
  const [params, setParams] = useSearchParams(); const [tick, setTick] = useState(0); const [form, setForm] = useState<Form>(null);
  const organizations = useScopedRead((_s, signal) => api.organizations(signal), { key: String(tick) });
  const detail = useScopedRead((_s, signal) => api.sharedProject(params.get("sharedProject")!, signal), { enabled: !!params.get("sharedProject"), key: `${params.get("sharedProject")}|${tick}` });
  const org = detail.data?.organization_id || params.get("organization") || organizations.data?.rows[0]?.id || "";
  const q = params.get("q") || "";
  const listing = useScopedRead((_s, signal) => api.sharedProjects({ organization: org || undefined, q, hidden: params.get("hidden") || "" }, signal), { key: [org, q, params.get("hidden"), tick].join("|") });
  const project = params.get("sharedProject") ? detail.data : null;
  useEffect(() => { if (project && scopeId !== project.id) setScope(project.id); }, [project?.id, scopeId]);
  const [target, setTarget] = useState<SharedProject | null>(null); const [name, setName] = useState(""); const [teamID, setTeamID] = useState(""); const [adminID, setAdminID] = useState(""); const [sourceScope, setSourceScope] = useState("");
  const [grants, setGrants] = useState<ProjectGrant[]>([]); const [bindings, setBindings] = useState<ProjectBinding[]>([]);
  const [generation, setGeneration] = useState(false); const [currency, setCurrency] = useState<"CNY" | "USD">("CNY");
  const [budget, setBudget] = useState("0"); const [manualCopy, setManualCopy] = useState("");
  const [directory, setDirectory] = useState<{ members: CollaborationMember[]; teams: CollaborationTeam[] }>({ members: [], teams: [] }); const [options, setOptions] = useState<ProjectBinding[]>([]); const [optionsError, setOptionsError] = useState("");
  const action = useCollaborationAction((receipt) => { setForm(null); setTick((v) => v + 1); toast("已保存", "success"); if (receipt.action === "project.create") setParams((current) => { const next = new URLSearchParams(current); next.set("sharedProject", receipt.result_refs[0]); return next; }); });
  const patch = (key: string, value: string | null) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; });
  const openForm = (next: Form, p?: SharedProject) => { action.reset(); setForm(next); setTarget(p || null); setName(p?.name || ""); setGrants(p?.grants || []); setBindings(p?.bindings || []); setGeneration(p?.generation_enabled || false); setCurrency(p?.currency || "CNY"); setTeamID(p?.team_id || ""); setAdminID(""); setBudget(String(p?.budget_cap || 0)); setOptionsError(""); };
  useEffect(() => {
    if (!org || !form) return;
    const abort = new AbortController();
    Promise.all([api.collaborationMembers(org, abort.signal), api.collaborationTeams(org, abort.signal)]).then(([m, t]) => { if (!abort.signal.aborted) setDirectory({ members: m.rows, teams: t.rows }); }).catch((e) => { if (!abort.signal.aborted) setOptionsError(errorCode(e)); });
    if (form === "bindings" || form === "project") api.bindingOptions(org, abort.signal).then((v) => setOptions(v.rows)).catch((e) => { if (!abort.signal.aborted) setOptionsError(errorCode(e)); });
    return () => abort.abort();
  }, [org, form]);
  const copy = async (p: SharedProject, link = false) => {
    const value = link ? `${window.location.origin}${window.location.pathname}#/projects?shared=1&sharedProject=${encodeURIComponent(p.id)}` : `yeisme-project:${p.id}`;
    if (await copyReference(value)) toast(link ? "项目链接已复制" : "项目引用已复制", "success"); else setManualCopy(value);
  };
  const prepare = () => {
    if (form === "organization") return action.prepare("organization.create", "new", 0, { name, source_scope: sourceScope || session?.scopes.find((s) => !s.id.startsWith("project_"))?.id || scopeId });
    if (form === "project") return action.prepare("project.create", org, 0, { name, bindings, ...(adminID ? { admin_member_id: adminID } : {}), ...(teamID ? { team_id: teamID } : {}) });
    if (!target) return;
    if (form === "rename") return action.prepare("project.update", target.id, target.revision, { name });
    if (form === "members") return action.prepare("project.members.set", target.id, target.revision, { grants });
    if (form === "bindings") return action.prepare("project.bindings.set", target.id, target.revision, { bindings });
    if (form === "policy") return action.prepare("project.update", target.id, target.revision, { generation_enabled: generation, budget_cap: Number(budget), currency });
  };
  const orgAdmin = organizations.data?.rows.find((o) => o.id === org)?.role === "admin";
  const menu = (p: SharedProject) => <MenuRoot><MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`项目操作：${p.name}`}><MoreHorizontal className="size-4" /></Button></MenuTrigger><MenuContent>
    <MenuItem onSelect={() => patch("sharedProject", p.id)}>打开项目</MenuItem>
    {p.role === "project_admin" && <><MenuItem onSelect={() => openForm("members", p)}>分配项目</MenuItem><MenuItem onSelect={() => openForm("rename", p)}>重命名</MenuItem><MenuItem onSelect={() => openForm("bindings", p)}>关联 owner 项目</MenuItem><MenuItem onSelect={() => openForm("policy", p)}>生成权限与额度</MenuItem></>}
    <MenuItem onSelect={() => void copy(p)}>复制项目引用</MenuItem><MenuItem onSelect={() => void copy(p, true)}>复制项目链接</MenuItem>
    <MenuItem onSelect={() => { setScope(p.id); navigate("/tasks"); }}>查看项目任务</MenuItem>
    {p.role === "project_admin" && <MenuItem onSelect={() => { setTarget(p); setForm("rename"); setName(p.name); void action.prepare("project.update", p.id, p.revision, { hidden: !p.hidden }); }}>{p.hidden ? "取消隐藏" : "隐藏项目"}</MenuItem>}
  </MenuContent></MenuRoot>;
  return <div className="page-enter space-y-4" data-page="shared-projects">
    <h1 className="sr-only">共享项目</h1>
    <PageToolbar summary="共享项目 · 分配给组织成员与团队" actions={<>
      <Button variant="ghost" size="sm" onClick={() => { patch("catalog", "owner"); patch("shared", null); patch("sharedProject", null); }}>owner 连接</Button>
      {organizations.data?.can_create && <Button size="sm" variant="secondary" onClick={() => openForm("organization")}>创建组织</Button>}
      {orgAdmin && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => openForm("project")}>创建项目</Button>}
    </>} />
    {manualCopy && <InlineNotice tone="warning">浏览器未允许复制，请手动选择：<input aria-label="手动复制项目引用" readOnly value={manualCopy} className="mt-2 w-full rounded border border-line bg-panel px-2 py-1 font-mono text-xs" onFocus={(e) => e.target.select()} /></InlineNotice>}
    <ReadStateView status={organizations.status} error={organizations.error} onRetry={organizations.reload} skeleton={<SkeletonRows rows={3} />}>
      {organizations.data?.rows.length === 0 ? <EmptyState icon={<FolderKanban />} title="创建第一个协作组织" body="项目、团队和成员按组织隔离。可先创建空项目，再关联已获准的 owner 项目。" action={organizations.data?.can_create ? <Button onClick={() => openForm("organization")}>创建组织</Button> : undefined} /> : <>
        <div className="flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2 text-sm">组织<Select value={org} onChange={(e) => { patch("organization", e.target.value); patch("sharedProject", null); }}>{organizations.data?.rows.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></label><Button size="sm" variant="ghost" onClick={() => navigate(`/team?organization=${org}&tab=collaboration`)}>管理成员与团队</Button></div>
        {project ? <>
          <div className="flex items-center gap-3"><Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => patch("sharedProject", null)}>项目列表</Button><h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{project.name}</h2>{menu(project)}</div>
          <div className="flex flex-wrap items-center gap-2"><Pill>{projectRoleLabels[project.role]}</Pill><CopyRef value={project.id} label="项目引用" /><Button size="sm" variant="primary" disabled={project.role === "viewer"} onClick={() => { setScope(project.id); navigate(`/creation?sharedProject=${project.id}`); }}>创建生成批次</Button></div>
          {!project.bindings.length && <InlineNotice tone="info">项目尚未关联 owner。项目成员与文件夹可以管理；生成和成果读取等待关联。</InlineNotice>}
          <ProjectFiles project={project} />
        </> : <>
          <FilterBar placeholder="搜索共享项目" facets={[{ key: "hidden", label: "可见性", options: [{ value: "1", label: "已隐藏" }] }]} />
          <ReadStateView status={listing.status} error={listing.error} onRetry={listing.reload} skeleton={<SkeletonRows rows={4} />}>
            <div className="divide-y divide-line rounded-control border border-line bg-panel">{listing.data?.rows.map((p) => <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <FolderKanban className="size-5 shrink-0 text-muted" /><button className="min-w-0 flex-1 text-left" onClick={() => patch("sharedProject", p.id)}><span className="block truncate font-medium">{p.name}</span><span className="text-xs text-muted">{p.bindings.length} 个 owner · {projectRoleLabels[p.role]}</span></button>{menu(p)}
            </div>)}{!listing.data?.rows.length && <EmptyState compact title={q ? "没有匹配的项目" : "暂无共享项目"} body="创建项目后，可分配给本组织成员或团队。" />}</div>
          </ReadStateView>
        </>}
      </>}
    </ReadStateView>
    <DetailSheet open={form !== null} onOpenChange={(v) => { if (!v) setForm(null); }} title={form ? ({ organization: "创建组织", project: "创建共享项目", rename: "项目设置", members: "分配项目", bindings: "关联 owner 项目", policy: "生成权限与额度" } as const)[form] : "项目"} description="操作只影响控制中心协作数据；owner 业务权限独立核验。" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)}>取消</Button>{action.preview ? <Button variant="primary" disabled={action.busy || action.preview.availability !== "available"} onClick={() => void action.confirm()}>确认保存</Button> : <Button variant="primary" disabled={action.busy || !!optionsError || (["organization", "project", "rename"].includes(form || "") && !name.trim())} onClick={() => void prepare()}>预览变更</Button>}</div>}>
      <div className="space-y-4" onChangeCapture={action.reset}>
        {action.error && <InlineNotice tone="warning">{action.error === "revision_conflict" ? "项目已被更新。输入已保留，请重新读取版本后核对变更。" : action.error}</InlineNotice>}
        {action.error === "revision_conflict" && target && <Button size="sm" onClick={() => void api.sharedProject(target.id).then((next) => { setTarget(next); action.reset(); }).catch((e) => setOptionsError(errorCode(e)))}>读取最新版本，保留当前输入</Button>}
        {optionsError && <InlineNotice tone="warning">候选读取失败：{optionsError}</InlineNotice>}
        {form === "organization" && <Field label="组织授权来源"><Select value={sourceScope || session?.scopes.find((s) => !s.id.startsWith("project_"))?.id || ""} onChange={(e) => setSourceScope(e.target.value)}>{session?.scopes.filter((s) => !s.id.startsWith("project_")).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>}
        {["organization", "project", "rename"].includes(form || "") && <Field label="名称" hint="最多 80 个字符"><Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>}
        {form === "project" && <Field label="所属团队"><Select value={teamID} onChange={(e) => setTeamID(e.target.value)}><option value="">组织直属</option>{directory.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
        {form === "project" && <Field label="初始项目管理员"><Select value={adminID} onChange={(e) => setAdminID(e.target.value)}><option value="">当前管理员</option>{directory.members.filter((m) => m.status === "active").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>}
        {form === "members" && <><p className="text-xs text-muted">团队与个人授权取有效权限并集。取消选择将移除该授权。</p>{[...directory.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.name, type: "member" as const })), ...directory.teams.map((t) => ({ id: t.id, name: `${t.name}（团队）`, type: "team" as const }))].map((subject) => { const grant = grants.find((g) => g.subject_type === subject.type && g.subject_id === subject.id); return <div key={subject.id} className="flex items-center gap-2"><Checkbox label={subject.name} checked={!!grant} onChange={() => { action.reset(); setGrants((current) => grant ? current.filter((g) => g !== grant) : [...current, { subject_type: subject.type, subject_id: subject.id, role: "viewer" }]); }} /><span className="min-w-0 flex-1 truncate text-sm">{subject.name}</span><Select aria-label={`${subject.name}项目角色`} disabled={!grant} value={grant?.role || "viewer"} onChange={(e) => setGrants((current) => current.map((g) => g === grant ? { ...g, role: e.target.value as ProjectRole } : g))}>{Object.entries(projectRoleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>; })}</>}
        {(form === "bindings" || form === "project") && <>{options.map((b) => <label key={`${b.source_scope}:${b.owner}`} className="flex items-center gap-2 rounded-control border border-line p-3 text-sm"><Checkbox checked={bindings.some((v) => v.owner === b.owner && v.source_scope === b.source_scope)} label={`${b.owner} ${b.project_ref}`} onChange={() => { action.reset(); setBindings((current) => current.some((v) => v.owner === b.owner && v.source_scope === b.source_scope) ? current.filter((v) => v.owner !== b.owner) : [...current.filter((v) => v.owner !== b.owner), b]); }} />{b.owner} · {b.project_ref}</label>)}{!options.length && !optionsError && <InlineNotice>当前身份没有可绑定的 owner 项目。</InlineNotice>}</>}
        {form === "policy" && <><label className="flex items-center gap-2 text-sm"><Checkbox label="允许项目创作者生成" checked={generation} onChange={() => { action.reset(); setGeneration(!generation); }} />允许项目创作者生成</label><Field label="预算币种"><Select value={currency} onChange={(e) => setCurrency(e.target.value as "CNY" | "USD")}><option value="CNY">CNY</option><option value="USD">USD</option></Select></Field><Field label="项目累计生成费用上限"><Input type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field><InlineNotice>owner 生成开关与费用核验仍须通过；本设置不会开启部署中的付费调用。</InlineNotice></>}
      </div>
      {action.preview && <InlineNotice tone="info" className="mt-4">变更已校验。{form === "members" ? `新增 ${grants.filter((g) => !target?.grants.some((v) => v.subject_type === g.subject_type && v.subject_id === g.subject_id)).length} 项，移除 ${target?.grants.filter((g) => !grants.some((v) => v.subject_type === g.subject_type && v.subject_id === g.subject_id)).length || 0} 项，角色变化 ${grants.filter((g) => target?.grants.some((v) => v.subject_type === g.subject_type && v.subject_id === g.subject_id && v.role !== g.role)).length} 项。` : "确认后保存当前变更。"}</InlineNotice>}
    </DetailSheet>
  </div>;
}
