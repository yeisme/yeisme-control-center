import { useEffect, useMemo, useState } from "react";
import { api, errorCode } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { createIdempotencyKey } from "../../shared/action-runner";
import type { ActionPreview, ActionPreviewRequest, ActionReceipt } from "../../shared/action-contract";
import { Button, DetailSheet, Field, InlineNotice, Input, Select, cx } from "../../components/ui";
import { Check } from "../../icons";
import type { BindingOption, CollaborationMember, CollaborationOrganization, CollaborationTeam, ProjectBinding } from "../../shared/collaboration";
import { BindingPicker, bindingSummary, useToolProjectNames } from "./BindingPicker";

export type WizardStep = "name" | "tools" | "people" | "review";
/** The organization a first project is created in when there is none yet. */
export const defaultOrganizationName = "我的工作室";

/**
 * The steps a new project walks through. Without an organization the tools and people steps have nothing to choose
 * from yet: the project is created bare in a new organization, then wired from its 连接 tab.
 */
export function wizardSteps(hasOrganization: boolean): WizardStep[] {
  return hasOrganization ? ["name", "tools", "people", "review"] : ["name", "review"];
}
const stepLabels: Record<WizardStep, string> = { name: "名称", tools: "关联工具", people: "成员", review: "确认" };

const succeeded = (receipt: ActionReceipt) => receipt.state === "succeeded" || receipt.state === "submitted";

/**
 * Creates a project in one sheet: name, the tool projects it reads, who runs it, then one confirmation. Every write is
 * the existing preview/confirm action; when the person has no organization yet, one is created first, and the review
 * says so.
 */
export function NewProjectWizard({ open, onOpenChange, organizations, organization, canCreateOrganization, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizations: CollaborationOrganization[];
  /** The organization the list is showing; the default when the person administers it. */
  organization: string;
  canCreateOrganization: boolean;
  onCreated: (projectId: string, bound: boolean) => void;
}) {
  const { session, scopeId, refresh } = useWorkspace();
  const names = useToolProjectNames();
  const adminOrgs = organizations.filter((item) => item.role === "admin");
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [bindings, setBindings] = useState<ProjectBinding[]>([]);
  const [teamID, setTeamID] = useState("");
  const [adminID, setAdminID] = useState("");
  const [step, setStep] = useState<WizardStep>("name");
  const [options, setOptions] = useState<BindingOption[]>([]);
  const [directory, setDirectory] = useState<{ members: CollaborationMember[]; teams: CollaborationTeam[] }>({ members: [], teams: [] });
  const [readError, setReadError] = useState("");
  const [preview, setPreview] = useState<{ request: ActionPreviewRequest; preview: ActionPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // An organization made by this confirmation; a retry after the project step failed starts from it.
  const [madeOrg, setMadeOrg] = useState("");
  const home = session?.scopes.find((scope) => !scope.id.startsWith("project_"));
  const steps = wizardSteps(!!org);
  const index = steps.indexOf(step);
  useEffect(() => {
    if (!open) return;
    setOrg(adminOrgs.some((item) => item.id === organization) ? organization : adminOrgs[0]?.id || "");
    setName(""); setBindings([]); setTeamID(""); setAdminID(""); setStep("name"); setPreview(null); setError(""); setReadError(""); setMadeOrg("");
  }, [open]);
  useEffect(() => {
    if (!open || !org) return;
    const abort = new AbortController();
    setOptions([]); setDirectory({ members: [], teams: [] }); setBindings([]); setTeamID(""); setAdminID("");
    Promise.all([api.bindingOptions(org, abort.signal), api.collaborationMembers(org, abort.signal), api.collaborationTeams(org, abort.signal)])
      .then(([o, m, t]) => { if (!abort.signal.aborted) { setOptions(o.rows); setDirectory({ members: m.rows, teams: t.rows }); setReadError(""); } })
      .catch((e) => { if (!abort.signal.aborted) setReadError(errorCode(e)); });
    return () => abort.abort();
  }, [open, org]);
  const projectInput = () => ({ name: name.trim(), bindings, ...(adminID ? { admin_member_id: adminID } : {}), ...(teamID ? { team_id: teamID } : {}) });
  const request = (action: "organization.create" | "project.create", target: string, input: Record<string, unknown>): ActionPreviewRequest => ({
    scope_id: scopeId, owner: "control-center", target_kind: "organization", target_ref: target, action, expected_revision: "0", idempotency_key: createIdempotencyKey("collaboration"), input,
  });
  const run = async (next: ActionPreviewRequest, checked?: ActionPreview) => {
    if (!session) throw new Error("session_expired");
    const verdict = checked || await api.previewAction(next, session.csrf);
    if (verdict.availability !== "available") throw new Error(verdict.blockers[0] || verdict.availability);
    const receipt = await api.confirmAction({ scope_id: next.scope_id, preview_ref: verdict.preview_ref, preview_digest: verdict.preview_digest, idempotency_key: next.idempotency_key }, session.csrf);
    if (!succeeded(receipt) || !receipt.result_refs[0]) throw new Error(receipt.error_code || receipt.state);
    return receipt.result_refs[0];
  };
  // The review checks the first write before anything is saved; a project in a new organization is checked once the
  // organization exists, inside the same confirmation.
  const review = async () => {
    if (!session) return;
    setStep("review"); setBusy(true); setError(""); setPreview(null);
    const next = org ? request("project.create", org, projectInput()) : request("organization.create", "new", { name: defaultOrganizationName, source_scope: home?.id || scopeId });
    try { setPreview({ request: next, preview: await api.previewAction(next, session.csrf) }); } catch (e) { setError(errorCode(e)); } finally { setBusy(false); }
  };
  const create = async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      if (org) { onCreated(await run(preview.request, preview.preview), bindings.length > 0); return; }
      const created = madeOrg || await run(preview.request, preview.preview);
      setMadeOrg(created);
      const project = await run(request("project.create", created, { name: name.trim(), bindings: [] }));
      onCreated(project, false);
    } catch (e) {
      setError(e instanceof Error && !("status" in e) ? e.message : errorCode(e));
    } finally { setBusy(false); refresh(); }
  };
  const back = () => { setPreview(null); setError(""); setStep(steps[Math.max(0, index - 1)]); };
  const forward = () => { const next = steps[index + 1]; if (next === "review") void review(); else setStep(next); };
  const noOrganization = !org;
  const blocked = noOrganization && !canCreateOrganization;
  const teamName = directory.teams.find((team) => team.id === teamID)?.name;
  const adminName = directory.members.find((member) => member.id === adminID)?.name;
  const scopeLabels = useMemo(() => new Map((session?.scopes || []).map((scope) => [scope.id, scope.label])), [session?.scopes]);
  return <DetailSheet
    open={open}
    onOpenChange={onOpenChange}
    title="新建项目"
    description="项目把工具里的任务和成果收在一起；工具自己的权限另行核验。"
    returnFocus="[data-new-project]"
    footer={<div className="flex items-center justify-between gap-2">
      <Button variant="ghost" onClick={index > 0 ? back : () => onOpenChange(false)} disabled={busy}>{index > 0 ? "上一步" : "取消"}</Button>
      {step === "review"
        ? <Button variant="primary" data-wizard-create disabled={busy || !preview || preview.preview.availability !== "available"} onClick={() => void create()}>{busy ? "正在创建…" : "创建项目"}</Button>
        : <Button variant="primary" data-wizard-next disabled={busy || blocked || (step === "name" && !name.trim())} onClick={forward}>下一步</Button>}
    </div>}
  >
    <div className="space-y-5" data-new-project-wizard data-wizard-step={step}>
      <ol className="flex items-center gap-2" aria-label="步骤">
        {steps.map((item, at) => <li key={item} aria-current={item === step ? "step" : undefined} className={cx("flex items-center gap-1.5 text-2xs font-medium", at <= index ? "text-ink" : "text-muted")}>
          <span className={cx("inline-flex size-5 items-center justify-center rounded-full border text-[11px]", at < index ? "border-accent bg-accent text-accent-ink" : at === index ? "border-ink text-ink" : "border-line")}>{at < index ? <Check className="size-3" /> : at + 1}</span>
          {stepLabels[item]}
          {at < steps.length - 1 && <span aria-hidden="true" className="ml-1 h-px w-5 bg-line" />}
        </li>)}
      </ol>
      {readError && <InlineNotice tone="warning">候选读取失败：{readError}</InlineNotice>}
      {step === "name" && <>
        <Field label="项目名称" hint="最多 80 个字符，之后可以改"><Input autoFocus value={name} maxLength={80} placeholder="例如：第一季 · 雨夜" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !blocked) forward(); }} /></Field>
        {adminOrgs.length > 1 && <Field label="所属组织"><Select value={org} onChange={(e) => setOrg(e.target.value)}>{adminOrgs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>}
        {noOrganization && (blocked
          ? <InlineNotice tone="warning">你还不是任何组织的管理员，不能新建项目。请让管理员把你加为组织管理员，或分配一个已有项目。</InlineNotice>
          : <InlineNotice>你还没有组织。创建时会先建一个组织「{defaultOrganizationName}」，项目放在它下面；之后可以在「成员与管理」里改名和加人。</InlineNotice>)}
      </>}
      {step === "tools" && <>
        <p className="text-body-sm text-ink-soft">选这个项目要读的工具项目。可以先跳过，之后在项目的「连接」里关联。</p>
        {!readError && <BindingPicker options={options} value={bindings} names={names} scopeLabels={scopeLabels} onChange={setBindings} />}
      </>}
      {step === "people" && <>
        <p className="text-body-sm text-ink-soft">默认只有你能管理它。更细的成员角色，创建后在「成员」里分配。</p>
        <Field label="所属团队"><Select value={teamID} onChange={(e) => setTeamID(e.target.value)}><option value="">组织直属</option>{directory.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select></Field>
        <Field label="项目管理员"><Select value={adminID} onChange={(e) => setAdminID(e.target.value)}><option value="">我</option>{directory.members.filter((member) => member.status === "active").map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></Field>
      </>}
      {step === "review" && <>
        <dl className="divide-y divide-line rounded-card border border-line bg-panel" data-wizard-summary>
          {noOrganization && <div className="flex gap-3 px-4 py-3"><dt className="w-20 shrink-0 text-2xs text-muted">新组织</dt><dd className="text-body-sm text-ink">{defaultOrganizationName}</dd></div>}
          <div className="flex gap-3 px-4 py-3"><dt className="w-20 shrink-0 text-2xs text-muted">项目</dt><dd className="min-w-0 truncate text-body-sm font-medium text-ink">{name.trim()}</dd></div>
          {!noOrganization && <div className="flex gap-3 px-4 py-3"><dt className="w-20 shrink-0 text-2xs text-muted">工具</dt><dd className="text-body-sm text-ink">{bindingSummary(bindings)}</dd></div>}
          {!noOrganization && <div className="flex gap-3 px-4 py-3"><dt className="w-20 shrink-0 text-2xs text-muted">成员</dt><dd className="text-body-sm text-ink">{teamName ? `${teamName} · ` : ""}管理员：{adminName || "我"}</dd></div>}
        </dl>
        {busy && !preview && <p className="text-2xs text-muted" role="status">正在核对…</p>}
        {preview && !error && <InlineNotice tone={preview.preview.availability === "available" ? "info" : "warning"}>
          <span data-wizard-preview>{preview.preview.availability !== "available" ? `现在不能创建：${preview.preview.blockers[0] || preview.preview.availability}` : noOrganization ? "已核对。将创建 2 项：组织和项目。确认后打开项目，去「连接」里关联工具。" : "已核对。确认后创建项目并打开它。"}</span>
        </InlineNotice>}
        {error && <InlineNotice tone="warning">没能创建：{error}{madeOrg ? "。组织已建好，可以重试创建项目。" : ""}</InlineNotice>}
      </>}
    </div>
  </DetailSheet>;
}
