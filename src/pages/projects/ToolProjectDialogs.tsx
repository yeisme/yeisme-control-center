import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Button, Field, InlineNotice, Input, Select, ownerLabel } from "../../components/ui";
import { Check, Plug } from "../../icons";
import { api, type OwnerProjectTemplate } from "../../shared/api/control-center-client";
import { createIdempotencyKey, runAction, type ActionRunState } from "../../shared/action-runner";

/** Same rule as the server: owner project refs as owners issue them. */
const projectRefPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;

const errors: Record<string, string> = {
  owner_project_not_accessible: "工具拒绝了这个项目：所选连接的凭据没有覆盖它。请在工具侧给该凭据授权这个项目，或换一个连接。",
  owner_project_contract_missing: "这个工具没有提供任务读取接口，暂时无法接入。",
  owner_project_unreachable: "暂时连不上这个工具，请稍后再试。",
  owner_project_already_connected: "这个项目已经接入，不需要重复接入。",
  invalid_owner_project_ref: "项目引用格式不对：只能包含字母、数字和 . _ : / @ -，以字母或数字开头，最长 160 个字符。",
  owner_project_template_not_found: "所选连接已不可用，请刷新页面后重试。",
  owner_project_not_found: "这个接入已经不存在，可能已被断开。",
  control_center_admin_required: "只有管理员可以接入或断开工具项目。",
  invalid_display_name: "本地名称包含不支持的字符。",
};

export function toolProjectError(code: string | null) {
  return code ? errors[code] || `操作未完成：${code}` : "操作未完成";
}

const idle: ActionRunState = { phase: "idle", preview: null, receipt: null, error: null };

function Shell({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 backdrop-blur-[1px]" style={{ background: "var(--scrim)" }} />
        <Dialog.Content className="pop-in fixed left-1/2 top-1/2 z-50 w-[min(480px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line bg-panel p-5 text-ink shadow-float outline-none">
          <Dialog.Title className="text-title-sm font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-body-sm text-muted">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Reads another project of a tool with a configured connection's credential, after the tool confirms it covers it. */
export function ConnectToolProjectDialog({ open, onOpenChange, templates, scopeId, csrf, onConnected }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: OwnerProjectTemplate[];
  scopeId: string;
  csrf: string;
  onConnected: (label: string) => void;
}) {
  const [template, setTemplate] = useState("");
  const [projectRef, setProjectRef] = useState("");
  const [label, setLabel] = useState("");
  const [state, setState] = useState<ActionRunState>(idle);
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTemplate(templates[0]?.id || "");
    setProjectRef("");
    setLabel("");
    setState(idle);
    setLocal(null);
  }, [open, templates]);
  const chosen = templates.find((t) => t.id === template);
  const busy = state.phase === "previewing" || state.phase === "confirming";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ref = projectRef.trim();
    if (!chosen) return setLocal("请选择一个连接。");
    if (!projectRefPattern.test(ref)) return setLocal(errors.invalid_owner_project_ref);
    if (/[\x00-\x1f\x7f]/.test(label)) return setLocal(errors.invalid_display_name);
    setLocal(null);
    const result = await runAction(api, {
      scope_id: scopeId,
      owner: "control-center",
      target_kind: "owner_project",
      target_ref: `${chosen.owner}:${ref}`,
      action: "owner_project.connect",
      expected_revision: "0",
      idempotency_key: createIdempotencyKey("owner_project_connect"),
      input: { template_connection_id: chosen.id, project_ref: ref, label: label.trim() },
    }, csrf, (phase) => setState((current) => ({ ...current, phase })));
    setState(result);
    if (result.phase === "succeeded") onConnected(label.trim() || ref);
  };
  return (
    <Shell open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title="接入工具项目" description="用已配置连接的凭据读取同一工具里的另一个项目。接入前会先请工具确认凭据覆盖这个项目，不会在工具里创建或修改项目。">
      <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4" data-connect-tool-project>
        <Field label="使用的连接" hint="新项目沿用这个连接的地址与凭据">
          <Select value={template} onChange={(event) => { setTemplate(event.target.value); setState(idle); }}>
            {templates.map((t) => <option key={t.id} value={t.id}>{`${ownerLabel(t.owner)} · ${t.label}（默认项目 ${t.project}）`}</option>)}
          </Select>
        </Field>
        <Field label="项目引用" hint="工具里的项目 ID，可在该工具的项目列表或命令输出里找到">
          <Input autoFocus value={projectRef} maxLength={160} placeholder="例如 studio-2" onChange={(event) => { setProjectRef(event.target.value); setState(idle); }} className="font-mono" />
        </Field>
        <Field label="本地名称（可选）" hint="只保存在控制中心，最多 80 个字符">
          <Input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <InlineNotice tone="neutral">接入的项目只读：可以查看任务和成果，不能取消任务。</InlineNotice>
        {(local || (state.error && state.phase !== "succeeded")) && <InlineNotice tone="warning" role="alert">{local || toolProjectError(state.error)}</InlineNotice>}
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild><Button type="button" variant="ghost" disabled={busy}>取消</Button></Dialog.Close>
          <Button type="submit" variant="primary" disabled={busy || !chosen || !projectRef.trim()} icon={busy ? <Plug className="size-3.5" /> : <Check className="size-3.5" />}>{busy ? "正在向工具确认…" : "校验并接入"}</Button>
        </div>
      </form>
    </Shell>
  );
}

export interface DisconnectTarget { connectionId: string; name: string; owner: string; used: number }

/** Stops reading a tool project an administrator connected here; the tool keeps the project and its data. */
export function DisconnectToolProjectDialog({ target, onOpenChange, scopeId, csrf, onDisconnected }: {
  target: DisconnectTarget | null;
  onOpenChange: (open: boolean) => void;
  scopeId: string;
  csrf: string;
  onDisconnected: () => void;
}) {
  const [state, setState] = useState<ActionRunState>(idle);
  useEffect(() => { if (target) setState(idle); }, [target]);
  const busy = state.phase === "previewing" || state.phase === "confirming";
  const run = async () => {
    if (!target) return;
    const result = await runAction(api, {
      scope_id: scopeId,
      owner: "control-center",
      target_kind: "owner_project",
      target_ref: target.connectionId,
      action: "owner_project.disconnect",
      expected_revision: "0",
      idempotency_key: createIdempotencyKey("owner_project_disconnect"),
      input: { connection_id: target.connectionId },
    }, csrf, (phase) => setState((current) => ({ ...current, phase })));
    setState(result);
    if (result.phase === "succeeded") onDisconnected();
  };
  const used = target?.used ? `；${target.used} 个共享项目里对它的关联会停止读取` : "";
  return (
    <Shell open={!!target} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title={`断开「${target?.name || ""}」？`} description={`断开后控制中心不再读取这个${target ? ownerLabel(target.owner) : ""}项目的任务和成果${used}。工具里的项目和数据不受影响，之后可以重新接入。`}>
      {state.error && state.phase !== "succeeded" && <InlineNotice tone="warning" role="alert" className="mt-4">{toolProjectError(state.error)}</InlineNotice>}
      <div className="mt-5 flex justify-end gap-2">
        <Dialog.Close asChild><Button type="button" variant="ghost" disabled={busy}>取消</Button></Dialog.Close>
        <Button type="button" variant="danger" disabled={busy} onClick={() => void run()}>{busy ? "正在断开…" : "断开"}</Button>
      </div>
    </Shell>
  );
}
