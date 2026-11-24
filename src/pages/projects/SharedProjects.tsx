import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, errorCode } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useCollaborationAction } from "../../app/collaboration-action";
import { ActionsContextMenu, ActionsMenu, Button, Checkbox, DetailSheet, EmptyState, Field, Input, InlineNotice, PageToolbar, ReadStateView, Select, SkeletonRows, ownerLabel, useToast, type ItemAction } from "../../components/ui";
import { Copy, Eye, FolderKanban, Link2, ListTodo, Pencil, Plus, Sparkles, UsersRound, Wallet } from "../../icons";
import { FilterBar } from "../../components/FilterBar";
import { copyReference } from "../../shared/clipboard";
import { maxProjectBindings, projectRoleLabels, type BindingOption, type CollaborationMember, type CollaborationTeam, type ProjectBinding, type ProjectGrant, type ProjectRole, type SharedProject } from "../../shared/collaboration";
import { BindingPicker, bindingKey, useToolProjectNames } from "./BindingPicker";
import { NewProjectTile, SharedProjectCard } from "./SharedProjectCard";
import { ProjectHome } from "./ProjectHome";
import { NewProjectWizard } from "./NewProjectWizard";

type Form = "organization" | "project" | "rename" | "members" | "bindings" | "policy" | null;
export default function SharedProjects() {
  const { scopeId, session, setScope } = useWorkspace(); const navigate = useNavigate(); const toast = useToast();
  const [params, setParams] = useSearchParams(); const [tick, setTick] = useState(0); const [form, setForm] = useState<Form>(null);
  const organizations = useScopedRead((_s, signal) => api.organizations(signal), { key: String(tick) });
  const detail = useScopedRead((_s, signal) => api.sharedProject(params.get("sharedProject")!, signal), { enabled: !!params.get("sharedProject"), key: `${params.get("sharedProject")}|${tick}` });
  const org = detail.data?.organization_id || params.get("organization") || organizations.data?.rows[0]?.id || "";
  const q = params.get("q") || "";
  const hidden = params.get("hidden") || "";
  const listing = useScopedRead((_s, signal) => api.sharedProjects({ organization: org || undefined, q, hidden }, signal), { key: [org, q, hidden, tick].join("|") });
  const project = params.get("sharedProject") ? detail.data : null;
  useEffect(() => { if (project && scopeId !== project.id) setScope(project.id); }, [project?.id, scopeId]);
  const [target, setTarget] = useState<SharedProject | null>(null); const [name, setName] = useState(""); const [teamID, setTeamID] = useState(""); const [adminID, setAdminID] = useState(""); const [sourceScope, setSourceScope] = useState("");
  const [grants, setGrants] = useState<ProjectGrant[]>([]); const [bindings, setBindings] = useState<ProjectBinding[]>([]);
  const [generation, setGeneration] = useState(false); const [currency, setCurrency] = useState<"CNY" | "USD">("CNY");
  const [budget, setBudget] = useState("0"); const [manualCopy, setManualCopy] = useState("");
  const [directory, setDirectory] = useState<{ members: CollaborationMember[]; teams: CollaborationTeam[] }>({ members: [], teams: [] }); const [options, setOptions] = useState<BindingOption[]>([]); const names = useToolProjectNames(); const [optionsError, setOptionsError] = useState("");
  const action = useCollaborationAction((receipt) => { setForm(null); setTick((v) => v + 1); toast("已保存", "success"); if (receipt.action === "project.create") setParams((current) => { const next = new URLSearchParams(current); next.set("sharedProject", receipt.result_refs[0]); return next; }); });
  const patch = (key: string, value: string | null) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; });
  const selectOrganization = (value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set("organization", value);
    for (const key of ["sharedProject", "role", "owner", "cursor"]) next.delete(key);
    return next;
  }, { replace: true });
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
    if (await copyReference(value)) { setManualCopy(""); toast(link ? "项目链接已复制" : "项目引用已复制", "success"); }
    else { setManualCopy(value); toast("浏览器未允许复制，请使用页面中的手动复制框。", "warning"); }
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
  const [wizard, setWizard] = useState(false);
  const canWizard = !!organizations.data && (organizations.data.rows.some((o) => o.role === "admin") || (!organizations.data.rows.length && organizations.data.can_create));
  // A tool project handed over from the tool-projects page, to bind to an existing shared project or a new one.
  const pending: ProjectBinding | null = params.get("bindOwner") && params.get("bindProject") && params.get("bindScope") ? { owner: params.get("bindOwner")!, project_ref: params.get("bindProject")!, source_scope: params.get("bindScope")!, connection_ids: [] } : null;
  const pendingTenantOk = !pending || !params.get("bindTenant") || organizations.data?.rows.find((o) => o.id === org)?.source_tenant === params.get("bindTenant");
  const clearPending = () => setParams((current) => { const next = new URLSearchParams(current); for (const key of ["bindOwner", "bindProject", "bindScope", "bindTenant", "bindNew"]) next.delete(key); return next; }, { replace: true });
  const bindTo = (p?: SharedProject) => { if (!pending) return; openForm(p ? "bindings" : "project", p); setBindings([...(p?.bindings || []), pending]); clearPending(); };
  const pendingBound = (p: SharedProject) => !!pending && p.bindings.some((b) => bindingKey(b) === bindingKey(pending));
  useEffect(() => { if (pending && params.get("bindNew") === "1" && orgAdmin && pendingTenantOk) bindTo(); }, [pending?.project_ref, orgAdmin, pendingTenantOk]);
  // One list for the row's "更多操作" menu, its context menu and the detail header.
  const actions = (p: SharedProject): ItemAction[] => {
    const admin = p.role === "project_admin";
    return [
      { id: "open", label: "打开项目", icon: <FolderKanban />, group: "open", run: () => patch("sharedProject", p.id) },
      { id: "tasks", label: "查看项目任务", icon: <ListTodo />, group: "open", run: () => { setScope(p.id); navigate("/tasks"); } },
      ...(p.role !== "viewer" ? [{ id: "generate", label: "创建生成批次", icon: <Sparkles />, group: "open", run: () => { setScope(p.id); navigate(`/creation?sharedProject=${p.id}`); } }] : []),
      ...(admin ? [
        { id: "members", label: "分配项目", icon: <UsersRound />, group: "manage", run: () => openForm("members", p) },
        { id: "rename", label: "重命名", icon: <Pencil />, group: "manage", run: () => openForm("rename", p) },
        { id: "bindings", label: "关联工具项目", icon: <Link2 />, group: "manage", run: () => openForm("bindings", p) },
        { id: "policy", label: "生成权限与额度", icon: <Wallet />, group: "manage", run: () => openForm("policy", p) },
      ] : []),
      { id: "copy", label: "复制项目引用", icon: <Copy />, group: "copy", run: () => void copy(p) },
      { id: "copy-link", label: "复制项目链接", icon: <Link2 />, group: "copy", run: () => void copy(p, true) },
      ...(admin ? [{ id: "toggle", label: p.hidden ? "取消隐藏" : "隐藏项目", icon: <Eye />, group: "state", run: () => { setTarget(p); setForm("rename"); setName(p.name); void action.prepare("project.update", p.id, p.revision, { hidden: !p.hidden }); } }] : []),
    ];
  };
  const menu = (p: SharedProject) => <ActionsMenu actions={actions(p)} label={`项目操作：${p.name}`} />;
  return <div className="page-enter space-y-4" data-page="shared-projects">
    <h1 className="sr-only">项目</h1>
    {!project && <PageToolbar summary="项目 · 资产、产出、制作线和工具连接都在项目里" actions={<>
      {organizations.data?.can_create && !!organizations.data.rows.length && <Button size="sm" variant="ghost" onClick={() => openForm("organization")}>创建组织</Button>}
      {canWizard && !!organizations.data?.rows.length && <Button size="sm" variant="primary" data-new-project icon={<Plus className="size-4" />} onClick={() => setWizard(true)}>新建项目</Button>}
    </>} />}
    {manualCopy && <InlineNotice tone="warning">浏览器未允许复制，请手动选择：<input aria-label="手动复制项目引用" readOnly value={manualCopy} className="mt-2 w-full rounded border border-line bg-panel px-2 py-1 font-mono text-xs" onFocus={(e) => e.target.select()} /></InlineNotice>}
    <ReadStateView status={organizations.status} error={organizations.error} onRetry={organizations.reload} skeleton={<SkeletonRows rows={3} />}>
      {organizations.data?.rows.length === 0 ? <EmptyState icon={<FolderKanban />} title="新建第一个项目" body="项目把工具里的任务和成果收在一起：有哪些资产、做出了哪些视频和音频，打开项目就能看到。" action={organizations.data?.can_create ? <Button data-new-project icon={<Plus className="size-4" />} onClick={() => setWizard(true)}>新建项目</Button> : undefined} /> : <>
        {!project && <div className="flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2 text-sm">组织<Select value={org} onChange={(e) => selectOrganization(e.target.value)}>{organizations.data?.rows.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></label><Button size="sm" variant="ghost" onClick={() => navigate(`/admin?tab=organizations&organization=${encodeURIComponent(org)}`)}>管理成员与团队</Button></div>}
        {pending && !project && <InlineNotice tone={pendingTenantOk ? "info" : "warning"} actions={<>{orgAdmin && pendingTenantOk && <Button size="sm" variant="primary" onClick={() => bindTo()}>用它新建共享项目</Button>}<Button size="sm" variant="ghost" onClick={clearPending}>取消</Button></>}>
          {pendingTenantOk ? `选择要关联「${ownerLabel(pending.owner)} · ${pending.project_ref}」的共享项目，或用它新建一个。` : `当前组织的授权来源不包含「${ownerLabel(pending.owner)} · ${pending.project_ref}」，请切换组织。`}
        </InlineNotice>}
        {project ? <ProjectHome
          project={project}
          actions={actions(project)}
          onBack={() => setParams((current) => { const next = new URLSearchParams(current); for (const key of ["sharedProject", "tab", "kind", "folder", "batch"]) next.delete(key); return next; })}
          onManage={(next) => openForm(next, project)}
          onChanged={() => setTick((v) => v + 1)}
        /> : <>
          <FilterBar placeholder="搜索项目" facets={[{ key: "hidden", label: "可见性", options: [{ value: "1", label: "已隐藏" }] }, { key: "role", label: "项目角色", options: Object.entries(projectRoleLabels).map(([value, label]) => ({ value, label })) }, { key: "owner", label: "工具", options: [...new Set((listing.data?.rows || []).flatMap((item) => item.bindings.map((binding) => binding.owner)))].map((value) => ({ value, label: ownerLabel(value) })) }]} />
          <ReadStateView status={listing.status} error={listing.error} onRetry={listing.reload} skeleton={<SkeletonRows rows={4} />}>
            {(() => {
              const ready = listing.status === "ready" || listing.status === "stale";
              const rows = ready ? (listing.data?.rows || []).filter((p) => (!params.get("role") || params.get("role")!.split(",").includes(p.role)) && (!params.get("owner") || p.bindings.some((binding) => params.get("owner")!.split(",").includes(binding.owner)))) : [];
              const filtered = Boolean(q || params.get("role") || params.get("owner"));
              const emptyBody = filtered ? "尝试清除搜索、角色或工具筛选。" : hidden === "1" ? "隐藏项目会保留在当前组织，可随时取消隐藏。" : "创建项目后，可分配给本组织成员或团队。";
              return <>
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="项目">
                  {rows.map((p) => <li key={p.id} className="min-w-0"><ActionsContextMenu actions={actions(p)}><SharedProjectCard
                    project={p}
                    onOpen={() => patch("sharedProject", p.id)}
                    menu={menu(p)}
                    extra={pending && pendingTenantOk && p.role === "project_admin" ? <Button size="sm" variant="secondary" disabled={pendingBound(p) || p.bindings.length >= maxProjectBindings} onClick={() => bindTo(p)}>{pendingBound(p) ? "已关联" : "关联到这里"}</Button> : undefined}
                  /></ActionsContextMenu></li>)}
                  {rows.length > 0 && !filtered && hidden !== "1" && orgAdmin && <li className="min-w-0"><NewProjectTile onClick={() => setWizard(true)} /></li>}
                </ul>
                {ready && !rows.length && <EmptyState compact title={filtered ? "没有匹配的项目" : hidden === "1" ? "暂无已隐藏项目" : "还没有项目"} body={emptyBody} action={!filtered && hidden !== "1" && orgAdmin ? <Button icon={<Plus className="size-4" />} onClick={() => setWizard(true)}>新建项目</Button> : undefined} />}
              </>;
            })()}
          </ReadStateView>
        </>}
      </>}
    </ReadStateView>
    <DetailSheet open={form !== null} onOpenChange={(v) => { if (!v) setForm(null); }} title={form ? ({ organization: "创建组织", project: "创建共享项目", rename: "项目设置", members: "分配项目", bindings: "关联工具项目", policy: "生成权限与额度" } as const)[form] : "项目"} description="操作只影响控制中心协作数据；owner 业务权限独立核验。" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)}>取消</Button>{action.preview ? <Button variant="primary" disabled={action.busy || action.preview.availability !== "available"} onClick={() => void action.confirm()}>确认保存</Button> : <Button variant="primary" disabled={action.busy || !!optionsError || (["organization", "project", "rename"].includes(form || "") && !name.trim())} onClick={() => void prepare()}>预览变更</Button>}</div>}>
      <div className="space-y-4" onChangeCapture={action.reset}>
        {action.error && <InlineNotice tone="warning">{action.error === "revision_conflict" ? "项目已被更新。输入已保留，请重新读取版本后核对变更。" : action.error}</InlineNotice>}
        {action.error === "revision_conflict" && target && <Button size="sm" onClick={() => void api.sharedProject(target.id).then((next) => { setTarget(next); action.reset(); }).catch((e) => setOptionsError(errorCode(e)))}>读取最新版本，保留当前输入</Button>}
        {optionsError && <InlineNotice tone="warning">候选读取失败：{optionsError}</InlineNotice>}
        {form === "organization" && <Field label="组织授权来源"><Select value={sourceScope || session?.scopes.find((s) => !s.id.startsWith("project_"))?.id || ""} onChange={(e) => setSourceScope(e.target.value)}>{session?.scopes.filter((s) => !s.id.startsWith("project_")).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>}
        {["organization", "project", "rename"].includes(form || "") && <Field label="名称" hint="最多 80 个字符"><Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>}
        {form === "project" && <Field label="所属团队"><Select value={teamID} onChange={(e) => setTeamID(e.target.value)}><option value="">组织直属</option>{directory.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
        {form === "project" && <Field label="初始项目管理员"><Select value={adminID} onChange={(e) => setAdminID(e.target.value)}><option value="">当前管理员</option>{directory.members.filter((m) => m.status === "active").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>}
        {form === "members" && <><p className="text-xs text-muted">团队与个人授权取有效权限并集。取消选择将移除该授权。</p>{[...directory.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.name, type: "member" as const })), ...directory.teams.map((t) => ({ id: t.id, name: `${t.name}（团队）`, type: "team" as const }))].map((subject) => { const grant = grants.find((g) => g.subject_type === subject.type && g.subject_id === subject.id); return <div key={subject.id} className="flex items-center gap-2"><Checkbox label={subject.name} checked={!!grant} onChange={() => { action.reset(); setGrants((current) => grant ? current.filter((g) => g !== grant) : [...current, { subject_type: subject.type, subject_id: subject.id, role: "viewer" }]); }} /><span className="min-w-0 flex-1 truncate text-sm">{subject.name}</span><Select aria-label={`${subject.name}项目角色`} disabled={!grant} value={grant?.role || "viewer"} onChange={(e) => setGrants((current) => current.map((g) => g === grant ? { ...g, role: e.target.value as ProjectRole } : g))}>{Object.entries(projectRoleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>; })}</>}
        {(form === "bindings" || form === "project") && !optionsError && <BindingPicker options={options} value={bindings} names={names} scopeLabels={new Map((session?.scopes || []).map((s) => [s.id, s.label]))} onChange={(next) => { action.reset(); setBindings(next); }} />}
        {form === "policy" && <><label className="flex items-center gap-2 text-sm"><Checkbox label="允许项目创作者生成" checked={generation} onChange={() => { action.reset(); setGeneration(!generation); }} />允许项目创作者生成</label><Field label="预算币种"><Select value={currency} onChange={(e) => setCurrency(e.target.value as "CNY" | "USD")}><option value="CNY">CNY</option><option value="USD">USD</option></Select></Field><Field label="项目累计生成费用上限"><Input type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field><InlineNotice>owner 生成开关与费用核验仍须通过；本设置不会开启部署中的付费调用。</InlineNotice></>}
      </div>
      {action.preview && <InlineNotice tone="info" className="mt-4">变更已校验。{form === "members" ? `新增 ${grants.filter((g) => !target?.grants.some((v) => v.subject_type === g.subject_type && v.subject_id === g.subject_id)).length} 项，移除 ${target?.grants.filter((g) => !grants.some((v) => v.subject_type === g.subject_type && v.subject_id === g.subject_id)).length || 0} 项，角色变化 ${grants.filter((g) => target?.grants.some((v) => v.subject_type === g.subject_type && v.subject_id === g.subject_id && v.role !== g.role)).length} 项。` : "确认后保存当前变更。"}</InlineNotice>}
    </DetailSheet>
    {organizations.data && <NewProjectWizard
      open={wizard}
      onOpenChange={setWizard}
      organizations={organizations.data.rows}
      organization={org}
      canCreateOrganization={organizations.data.can_create}
      onCreated={(id, bound) => { setWizard(false); setTick((v) => v + 1); toast("项目已创建", "success"); setParams((current) => { const next = new URLSearchParams(current); next.set("sharedProject", id); next.delete("organization"); if (!bound) next.set("tab", "connections"); else next.delete("tab"); return next; }); }}
    />}
  </div>;
}
