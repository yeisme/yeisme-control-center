import { useState } from "react";
import { RadioGroup } from "radix-ui";
import { Button, Checkbox, DetailSheet, Field, Input, cx } from "../../components/ui";
import type { AssignableScope, PersonalUserView } from "../../shared/api/control-center-client";
import { draftProblem, roleHints, roleLabels, type AccountDraft } from "../../shared/accounts";

/**
 * New account in two steps (fill in, then check), or an existing one's name, role and scopes. Creating hands the key to
 * `KeyRevealDialog`; nothing here ever holds a key.
 */
export function AccountForm({ open, initial, scopes, taken, busy, error, onCancel, onSubmit }: {
  open: boolean;
  initial: PersonalUserView | null;
  scopes: readonly AssignableScope[];
  /** Usernames already in use, the configuration's owner included. */
  taken: readonly string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (draft: AccountDraft) => void;
}) {
  const creating = !initial;
  const [draft, setDraft] = useState<AccountDraft>(() => initial ? { username: initial.username, name: initial.name, role: initial.role, scope_ids: initial.scope_ids } : { username: "", name: "", role: "viewer", scope_ids: scopes.length === 1 ? [scopes[0].id] : [], issue_invite_ttl_hours: 168 });
  const [step, setStep] = useState<"fill" | "check">("fill");
  const problem = draftProblem(draft, taken, creating);
  const scopeLabel = (id: string) => scopes.find((scope) => scope.id === id)?.label || id;
  const footer = step === "fill" || !creating
    ? <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-2xs text-warning" role="status">{error || (problem && draft.username ? problem : "")}</span>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={onCancel}>取消</Button>
        {creating
          ? <Button variant="primary" disabled={!!problem} disabledReason={problem || undefined} onClick={() => setStep("check")}>下一步：核对</Button>
          : <Button variant="primary" disabled={!!problem || busy} disabledReason={problem || undefined} onClick={() => onSubmit(draft)}>{busy ? "正在保存…" : "保存修改"}</Button>}
      </div>
    </div>
    : <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-2xs text-warning" role="status">{error}</span>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={() => setStep("fill")}>返回修改</Button>
        <Button variant="primary" disabled={busy} onClick={() => onSubmit(draft)}>{busy ? "正在创建…" : "创建账号并生成 Key"}</Button>
      </div>
    </div>;
  return <DetailSheet open={open} onOpenChange={(next) => { if (!next) onCancel(); }} eyebrow={creating ? "新建账号" : "编辑账号"} title={creating ? (step === "fill" ? "谁要用控制中心？" : "核对一下") : `@${initial.username}`} description={creating ? "登录用用户名和访问 Key，没有密码。创建后 Key 只显示一次。" : "改显示名、角色和范围。访问 Key 在账号列表里单独重置。"} footer={footer}>
    {step === "fill" || !creating ? <div className="space-y-5" data-account-form>
      {creating && <Field label="用户名" hint="登录时填的名字，创建后不能改">
        <Input autoFocus value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value.trim() })} placeholder="例如 lin.zhou" autoComplete="off" spellCheck={false} aria-label="用户名" />
      </Field>}
      <Field label="显示名" hint="界面和审计里显示的名字">
        <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如 林舟" aria-label="显示名" />
      </Field>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink-soft">角色</legend>
        <RadioGroup.Root value={draft.role} onValueChange={(role) => setDraft({ ...draft, role: role as AccountDraft["role"] })} aria-label="角色" className="grid gap-2 sm:grid-cols-2">
          {(["viewer", "admin"] as const).map((role) => <RadioGroup.Item key={role} value={role} className={cx("rounded-[14px] border p-3 text-left outline-none transition-[border-color,background-color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:ring-focus/20", draft.role === role ? "border-primary bg-primary-soft/60" : "border-line hover:border-line-strong")}>
            <span className="block text-body-sm font-semibold text-ink">{roleLabels[role]}</span>
            <span className="mt-0.5 block text-2xs text-muted">{roleHints[role]}</span>
          </RadioGroup.Item>)}
        </RadioGroup.Root>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink-soft">能看哪些范围</legend>
        <div className="space-y-1.5">
          {scopes.map((scope) => {
            const checked = draft.scope_ids.includes(scope.id);
            return <label key={scope.id} className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-panel-soft">
              <Checkbox checked={checked} label={scope.label} onChange={() => setDraft({ ...draft, scope_ids: checked ? draft.scope_ids.filter((id) => id !== scope.id) : [...draft.scope_ids, scope.id] })} />
              <span className="min-w-0 flex-1"><span className="block truncate text-body-sm text-ink">{scope.label}</span><span className="block truncate text-2xs text-muted">{[scope.tenant, scope.project].filter(Boolean).join(" / ") || scope.id}</span></span>
            </label>;
          })}
        </div>
      </fieldset>
      {creating && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-line bg-panel-soft/60 p-3">
          <Checkbox
            checked={draft.issue_invite_ttl_hours !== undefined}
            label="同时生成一次性免密直连链接"
            onChange={(checked) => setDraft({ ...draft, issue_invite_ttl_hours: checked ? 168 : undefined })}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm font-medium text-ink">同时生成一次性免密直连链接（7 天有效）</span>
            <span className="mt-0.5 block text-2xs text-muted">生成带 ?token= 的专属链接，受邀人点击即免输密码进入创作台，首次打开后自动单次失效防转发。</span>
          </span>
        </label>
      )}
    </div> : <dl className="divide-y divide-line rounded-[14px] border border-line" data-account-check>
      {[["用户名", <span className="font-mono">{draft.username}</span>], ["显示名", draft.name.trim()], ["角色", roleLabels[draft.role]], ["范围", draft.scope_ids.map(scopeLabel).join("、")], ...(draft.issue_invite_ttl_hours ? [["免密邀请", "同步签发 7 天有效的一次性直连链接"]] : [])].map(([label, value]) => <div key={String(label)} className="flex gap-4 px-4 py-3 text-body-sm"><dt className="w-20 shrink-0 text-muted">{label}</dt><dd className="min-w-0 break-words text-ink">{value}</dd></div>)}
    </dl>}
  </DetailSheet>;
}
