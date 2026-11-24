import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type OwnerProjectTemplate, type TaskConnectionState } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { useCollaborationAction } from "../../app/collaboration-action";
import { ActionsMenu, Button, CopyRef, Dot, InlineNotice, Pill, ownerLabel, useToast } from "../../components/ui";
import { ArrowUpRight, BookOpen, Copy, Link2, Plug, Terminal, Unplug } from "../../icons";
import { copyReference } from "../../shared/clipboard";
import type { ProjectBinding, SharedProject } from "../../shared/collaboration";
import { connectionStateLabel, connectionTone } from "../../shared/read-model/tasks";
import { bindingKey, useToolProjectNames } from "./BindingPicker";
import { ConnectToolProjectDialog } from "./ToolProjectDialogs";

/**
 * The command that adds a new tool instance, with placeholders only: credentials are registered on the server with
 * this command and never typed into the browser.
 */
export const connectInstanceCommand = "bun scripts/personal-config.ts connect <config-file> <connection-id> <tool> https://<owner-host>/mcp <project-id> <key-dir>/<tool>-observer.key";

type BindingState = TaskConnectionState["state"] | "not_checked";

/**
 * Bindings grouped by tool, in the order each tool was first bound. A group's state is what its rows share: all read
 * fine, none read yet, or the first problem one of them has — so 「还没读过」 is said once, not on every row. A mixed
 * group says each row's own state too.
 */
export function groupBindings(bindings: ProjectBinding[], stateOf: (binding: ProjectBinding) => BindingState) {
  const groups: { owner: string; state: BindingState; mixed: boolean; rows: { binding: ProjectBinding; state: BindingState }[] }[] = [];
  for (const binding of bindings) {
    const row = { binding, state: stateOf(binding) };
    const group = groups.find((item) => item.owner === binding.owner);
    if (group) group.rows.push(row); else groups.push({ owner: binding.owner, state: row.state, mixed: false, rows: [row] });
  }
  for (const group of groups) {
    const states = group.rows.map((row) => row.state);
    group.mixed = states.some((state) => state !== states[0]);
    group.state = group.mixed ? states.find((state) => state !== "ready" && state !== "not_checked") || "not_checked" : states[0];
  }
  return groups;
}

const stateWord = (state: BindingState) => state === "not_checked" ? "还没读过" : connectionStateLabel(state);
const stateTone = (state: BindingState) => state === "not_checked" ? "neutral" : connectionTone(state);
const statePill = (state: BindingState) => state === "ready" ? "success" : state === "not_checked" ? "neutral" : "warning";

/** The reference an Agent or CLI passes to work inside this project. */
export const projectReference = (project: Pick<SharedProject, "id">) => `yeisme-project:${project.id}`;

/**
 * A project's wiring, in three honest parts: the tool projects it reads (and unbinding one), registering another
 * project from a connection that already exists, and what only the server can do — adding a tool instance with its
 * credential. Then how an Agent or CLI refers to this project.
 */
export function ProjectConnections({ project, onManage, onChanged }: { project: SharedProject; onManage: () => void; onChanged: () => void }) {
  const { session, scopeId } = useWorkspace();
  const tasks = useTasks();
  const toast = useToast();
  const navigate = useNavigate();
  const names = useToolProjectNames();
  const admin = project.role === "project_admin";
  const [removing, setRemoving] = useState<ProjectBinding | null>(null);
  const action = useCollaborationAction(() => { setRemoving(null); toast("已解除关联", "success"); onChanged(); });
  // Tool projects belong to a personal or team scope; registering one happens there, then it can be bound here.
  const home = session?.scopes.find((scope) => !scope.id.startsWith("project_"));
  const [templates, setTemplates] = useState<OwnerProjectTemplate[]>([]);
  const [canRegister, setCanRegister] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  useEffect(() => {
    if (!home || !admin) return;
    const abort = new AbortController();
    api.ownerProjects(home.id, abort.signal).then((page) => { if (!abort.signal.aborted) { setTemplates(page.templates || []); setCanRegister(!!page.can_register); } }).catch(() => { if (!abort.signal.aborted) setCanRegister(false); });
    return () => abort.abort();
  }, [home?.id, admin]);
  const stateOf = (binding: ProjectBinding): BindingState => {
    const states = scopeId === project.id ? tasks.connections.filter((connection) => connection.owner === binding.owner && connection.project === binding.project_ref) : [];
    return states.length ? states.every((connection) => connection.state === "ready") ? "ready" : states.find((connection) => connection.state !== "ready")!.state : "not_checked";
  };
  const unbind = (binding: ProjectBinding) => {
    setRemoving(binding);
    void action.prepare("project.bindings.set", project.id, project.revision, { bindings: project.bindings.filter((item) => bindingKey(item) !== bindingKey(binding)) });
  };
  const scopeLabels = new Map((session?.scopes || []).map((scope) => [scope.id, scope.label]));
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
    <section aria-labelledby="bound-tools" className="min-w-0 space-y-3" data-project-bindings>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="bound-tools" className="text-body-sm font-semibold text-ink">已关联的工具项目</h3>
        {admin && <div className="flex gap-2">
          {canRegister && home && <Button size="sm" variant="ghost" icon={<Plug className="size-4" />} onClick={() => setConnectOpen(true)}>登记新的工具项目</Button>}
          <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} onClick={onManage}>关联工具项目</Button>
        </div>}
      </div>
      {removing && <InlineNotice tone={action.error ? "warning" : "info"} actions={<>
        {action.preview && <Button size="sm" variant="primary" disabled={action.busy || action.preview.availability !== "available"} onClick={() => void action.confirm()}>确认解除</Button>}
        <Button size="sm" variant="ghost" onClick={() => { action.reset(); setRemoving(null); }}>取消</Button>
      </>}>
        {action.error ? `没能解除：${action.error === "revision_conflict" ? "项目刚被别人改过，刷新后再试" : action.error}` : action.preview ? `解除后，这个项目不再读取「${names.get(bindingKey(removing)) || removing.project_ref}」的任务和成果；工具里的内容不受影响。` : "正在核对变更…"}
      </InlineNotice>}
      {project.bindings.length ? <ul className="space-y-3">
        {groupBindings(project.bindings, stateOf).map((group) => <li key={group.owner} data-binding-group={group.owner} className="overflow-hidden rounded-card border border-line/80 bg-panel shadow-panel">
          <div className="flex min-w-0 items-center gap-2.5 border-b border-line/70 bg-panel-sunken/60 px-4 py-2.5">
            <Dot tone={stateTone(group.state)} />
            <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ink">{ownerLabel(group.owner)}<span className="ml-2 text-2xs font-normal text-muted">{group.rows.length} 个项目</span></span>
            <Pill size="sm" tone={statePill(group.state)}>{stateWord(group.state)}</Pill>
          </div>
          <ul className="divide-y divide-line">
            {group.rows.map(({ binding, state }) => {
              const key = bindingKey(binding);
              const name = names.get(key) || binding.project_ref;
              return <li key={key} data-binding={key} className="flex min-w-0 items-center gap-3 py-2.5 pl-4 pr-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-ink">{name}</span>
                  <span className="block truncate text-2xs text-muted"><span className="font-mono">{binding.project_ref}</span> · 来自{scopeLabels.get(binding.source_scope) || "其他范围"}</span>
                </span>
                {group.mixed && <Pill size="sm" tone={statePill(state)}>{stateWord(state)}</Pill>}
                {admin && <ActionsMenu label={`关联操作：${ownerLabel(binding.owner)} · ${name}`} actions={[{ id: "unbind", label: "解除关联", icon: <Unplug className="size-4" />, tone: "danger", disabled: action.busy, run: () => unbind(binding) }]} />}
              </li>;
            })}
          </ul>
        </li>)}
      </ul> : <div className="rounded-card border border-dashed border-line px-4 py-6 text-center">
        <p className="text-body-sm text-ink">还没有关联工具项目</p>
        <p className="mt-1 text-2xs text-muted">关联之后，这个项目就能读到工具里的任务和成果，也能新建生成批次。</p>
        {admin && <Button size="sm" className="mt-3" icon={<Link2 className="size-4" />} onClick={onManage}>关联工具项目</Button>}
      </div>}
      <p className="text-2xs text-muted">读取状态来自这个项目最近一次读取任务；工具自己的权限另行核验，这里不改它。</p>
    </section>
    <aside className="min-w-0 space-y-4">
      <section aria-labelledby="agent-access" className="rounded-card border border-line/80 bg-panel p-4 shadow-panel" data-project-agent-access>
        <h3 id="agent-access" className="flex items-center gap-2 text-body-sm font-semibold text-ink"><Terminal className="size-4" />Agent 与 CLI 接入</h3>
        <p className="mt-1 text-2xs text-muted">让 Agent 在这个项目里工作时，把项目引用交给它；客户端怎么连 MCP 网关见接入预设。</p>
        <CopyRef className="mt-3" value={projectReference(project)} label="项目引用" />
        <Button size="sm" variant="ghost" className="mt-2" icon={<ArrowUpRight className="size-3.5" />} onClick={() => navigate("/mcp-gateway")}>MCP 客户端接入预设</Button>
      </section>
      <section aria-labelledby="new-instance" className="rounded-card border border-line/80 bg-panel p-4 shadow-panel" data-project-new-instance>
        <h3 id="new-instance" className="flex items-center gap-2 text-body-sm font-semibold text-ink"><Plug className="size-4" />接入新的工具实例</h3>
        <p className="mt-1 text-2xs text-muted">新的工具地址和凭据只在服务器上用命令登记，浏览器不提交凭据。登记后，它的项目会出现在「关联工具项目」的候选里。</p>
        <code data-connect-command className="mt-3 block whitespace-pre-wrap break-all rounded-control bg-panel-sunken px-3 py-2 font-mono text-2xs text-ink-soft">{connectInstanceCommand}</code>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => void copyReference(connectInstanceCommand).then((ok) => toast(ok ? "已复制命令模板" : "没能复制，请手动选中命令", ok ? "success" : "warning")).catch(() => toast("没能复制，请手动选中命令", "warning"))}>复制命令</Button>
          <Button size="sm" variant="ghost" icon={<BookOpen className="size-3.5" />} onClick={() => navigate("/guide")}>看接入指南</Button>
        </div>
      </section>
    </aside>
    {connectOpen && home && session?.csrf && <ConnectToolProjectDialog
      open={connectOpen}
      onOpenChange={setConnectOpen}
      templates={templates}
      scopeId={home.id}
      csrf={session.csrf}
      onConnected={(label) => { setConnectOpen(false); toast(`已登记「${label}」，现在可以关联它`, "success"); onManage(); }}
    />}
  </div>;
}
