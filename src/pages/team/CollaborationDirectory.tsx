import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { useCollaborationAction } from "../../app/collaboration-action";
import { Button, Checkbox, DetailSheet, EmptyState, Field, Input, InlineNotice, Panel, ReadStateView, Select, SkeletonRows } from "../../components/ui";
import { FilterBar, matchesFacet } from "../../components/FilterBar";
import type { CollaborationMember, CollaborationTeam } from "../../shared/collaboration";

export function CollaborationDirectory() {
  const [params, setParams] = useSearchParams(); const [tick, setTick] = useState(0);
  const organizations = useScopedRead((_s, signal) => api.organizations(signal), { key: String(tick) });
  const organization = params.get("organization") || organizations.data?.rows[0]?.id || "";
  const members = useScopedRead((_s, signal) => api.collaborationMembers(organization, signal), { enabled: !!organization, key: `${organization}|${tick}` });
  const teams = useScopedRead((_s, signal) => api.collaborationTeams(organization, signal), { enabled: !!organization, key: `${organization}|${tick}` });
  const admin = organizations.data?.rows.find((o) => o.id === organization)?.role === "admin";
  const candidates = useScopedRead((_s, signal) => api.collaborationCandidates(organization, signal), { enabled: !!organization && admin, key: `${organization}|${tick}` });
  const [form, setForm] = useState<"member" | "team" | "team-members" | null>(null); const [target, setTarget] = useState<CollaborationMember | null>(null); const [team, setTeam] = useState<CollaborationTeam | null>(null);
  const [identity, setIdentity] = useState(""); const [role, setRole] = useState("member"); const [status, setStatus] = useState("active"); const [name, setName] = useState(""); const [ids, setIds] = useState<string[]>([]);
  const action = useCollaborationAction(() => { setForm(null); setTick((v) => v + 1); });
  const visible = (members.data?.rows || []).filter((m) => matchesFacet(m.role, params.get("role") || "") && matchesFacet(m.status, params.get("memberState") || "") && `${m.name} ${m.identity}`.toLocaleLowerCase().includes((params.get("q") || "").toLocaleLowerCase()));
  const openMember = (member?: CollaborationMember) => { action.reset(); setForm("member"); setTarget(member || null); setIdentity(member?.identity || ""); setRole(member?.role || "member"); setStatus(member?.status || "active"); };
  return <section className="space-y-4" aria-label="控制中心协作组织">
    <InlineNotice tone="neutral">这里管理控制中心的项目分配成员。各 owner 的组织成员在“成员”页签独立读取，仍需组织身份委托。</InlineNotice>
    {!organizations.data?.rows.length ? <EmptyState title="尚未加入协作组织" body="管理员可在项目页创建组织，或通过迁移命令导入明确的现有授权。" /> : <>
      <div className="flex flex-wrap items-center gap-2"><Select aria-label="协作组织" value={organization} onChange={(e) => setParams({ tab: "collaboration", organization: e.target.value })}>{organizations.data?.rows.map((o) => <option value={o.id} key={o.id}>{o.name}</option>)}</Select>{admin && <><Button size="sm" onClick={() => openMember()}>添加已有账号</Button><Button size="sm" onClick={() => { action.reset(); setName(""); setForm("team"); }}>创建团队</Button></>}</div>
      <FilterBar placeholder="搜索协作成员" facets={[{ key: "role", label: "角色", options: [{ value: "admin", label: "组织管理员" }, { value: "member", label: "成员" }] }, { key: "memberState", label: "状态", options: [{ value: "active", label: "有效" }, { value: "suspended", label: "已暂停" }] }]} />
      <ReadStateView status={members.status} error={members.error} onRetry={members.reload} skeleton={<SkeletonRows rows={3} />}><Panel title="控制中心成员" bodyClassName="p-0"><ul className="divide-y divide-line">{visible.map((m) => <li key={m.id} className="flex items-center gap-3 p-4"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{m.name}</span><span className="block truncate text-xs text-muted">{m.identity} · {m.role === "admin" ? "组织管理员" : "成员"} · {m.status === "active" ? "有效" : "已暂停"}</span></span>{admin && <Button size="sm" variant="ghost" onClick={() => openMember(m)}>编辑</Button>}</li>)}</ul>{!visible.length && <EmptyState compact title="没有匹配的成员" body="调整筛选条件。" />}</Panel></ReadStateView>
      <ReadStateView status={teams.status} error={teams.error} onRetry={teams.reload} skeleton={<SkeletonRows rows={2} />}><Panel title="团队" bodyClassName="p-0"><ul className="divide-y divide-line">{teams.data?.rows.map((t) => <li key={t.id} className="flex items-center gap-3 p-4"><span className="min-w-0 flex-1 text-sm">{t.name}<span className="ml-2 text-xs text-muted">{t.member_ids.length} 名成员</span></span>{admin && <Button size="sm" variant="ghost" onClick={() => { action.reset(); setTeam(t); setIds(t.member_ids); setForm("team-members"); }}>管理成员</Button>}</li>)}</ul>{!teams.data?.rows.length && <EmptyState compact title="暂无团队" body="团队可被整体分配到项目。" />}</Panel></ReadStateView>
    </>}
    <DetailSheet open={!!form} onOpenChange={(v) => { if (!v) setForm(null); }} title={form === "team" ? "创建团队" : form === "team-members" ? "团队成员" : "组织成员"} footer={<Button variant="primary" disabled={action.busy} onClick={() => action.preview ? void action.confirm() : void action.prepare(form === "team" ? "team.create" : form === "team-members" ? "team.members.set" : "organization.member.set", organization, form === "team-members" ? team!.revision : target?.revision || 0, form === "team" ? { name } : form === "team-members" ? { team_id: team!.id, member_ids: ids } : { identity, role, status })}>{action.preview ? "确认保存" : "预览变更"}</Button>}>
      <div className="space-y-4" onChangeCapture={action.reset}>
        {form === "member" && <><Field label="已有账号"><Select aria-label="已有账号" value={identity} disabled={!!target} onChange={(e) => setIdentity(e.target.value)}><option value="">选择账号</option>{candidates.data?.rows.map((c) => <option key={c.identity} value={c.identity}>{c.name} · {c.identity}</option>)}</Select></Field><Field label="组织角色"><Select value={role} onChange={(e) => setRole(e.target.value)}><option value="member">成员</option><option value="admin">组织管理员</option></Select></Field><Field label="成员状态"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">有效</option><option value="suspended">暂停访问</option></Select></Field></>}
        {form === "team" && <Field label="团队名称"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>}
        {form === "team-members" && members.data?.rows.map((m) => <label key={m.id} className="flex items-center gap-2 text-sm"><Checkbox label={m.name} disabled={m.status !== "active" && !ids.includes(m.id)} checked={ids.includes(m.id)} onChange={(v) => { action.reset(); setIds((current) => v ? [...current, m.id] : current.filter((id) => id !== m.id)); }} />{m.name}{m.status !== "active" && "（已暂停，仅可移除）"}</label>)}
        {action.error && <InlineNotice tone="warning">{action.error === "last_organization_admin" ? "必须保留至少一名有效的组织管理员。" : action.error}</InlineNotice>}
        {action.preview && <InlineNotice tone="info">请确认当前成员与权限变更。暂停访问会立即生效。</InlineNotice>}
      </div>
    </DetailSheet>
  </section>;
}
