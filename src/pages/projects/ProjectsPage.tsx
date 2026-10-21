import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Check, Copy, Eye, FolderKanban, Images, ListTodo, MoreHorizontal, Pencil, Plug, Send } from "../../icons";
import { Dialog } from "radix-ui";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { useMediaPreview } from "../../components/media-preview";
import { Button, Dot, EmptyState, Facts, Field, InlineNotice, Input, KindBadge, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, Panel, Pill, SegmentedTabs, SkeletonRows, TaskStatePill, Unknown, ContextMenuContent, ContextMenuItem, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger, cx, ownerLabel, useToast } from "../../components/ui";
import { api, type ProjectMetadata, type TaskConnectionState, type TaskSnapshot } from "../../shared/api/control-center-client";
import { runAction, type ActionRunState } from "../../shared/action-runner";
import { formatRelative } from "../../shared/read-model/format";
import { collectResults, connectionStateLabel, connectionTone, stageLabel, taskKind } from "../../shared/read-model/tasks";
import { reviewLabel, taskNeedsReview } from "../../shared/read-model/review";
import { closeProjectTask, selectProjectTab, selectProjectTask } from "../../shared/read-model/project-navigation";
import { taskIsActive, taskNeedsAttention } from "../../task-observation";
import { TaskDetail, type TaskInspectorMode } from "../tasks/TaskDetail";

type Tab = "overview" | "tasks" | "assets" | "review" | "delivery";
type ProjectFilter = "all" | "hidden";

interface OwnerProject {
  key: string;
  owner: string;
  project: string;
  connections: TaskConnectionState[];
  tasks: TaskSnapshot[];
  display_name: string;
  display_label: string;
  hidden: boolean;
  revision: number;
}

function ownerProjects(connections: TaskConnectionState[], rows: TaskSnapshot[], metadata: ProjectMetadata[]): OwnerProject[] {
  const map = new Map<string, OwnerProject>();
  const ensure = (owner: string, project: string) => {
    const key = `${owner}:${project}`;
    const known = metadata.find((item) => item.owner === owner && item.project_ref === project);
    const entry = map.get(key) || { key, owner, project, connections: [], tasks: [], display_name: known?.display_name || "", display_label: known?.display_label || "未命名项目", hidden: known?.hidden === true, revision: known?.revision || 0 };
    if (known) { entry.display_name = known.display_name; entry.display_label = known.display_label; entry.hidden = known.hidden; entry.revision = known.revision; }
    map.set(key, entry);
    return entry;
  };
  for (const connection of connections) ensure(connection.owner, connection.project).connections.push(connection);
  for (const task of rows) ensure(task.locator.owner, task.locator.project).tasks.push(task);
  return [...map.values()].sort((a, b) => a.display_label.localeCompare(b.display_label) || a.owner.localeCompare(b.owner) || a.project.localeCompare(b.project));
}

type ProjectAction = "open" | "rename" | "copy" | "tasks" | "toggle";

function stableProjectIdempotencyKey(scopeId: string, projectKey: string, action: string, revision: string) {
  let hash = 2166136261;
  for (const char of `${scopeId}|${projectKey}|${action}|${revision}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `project_metadata_${action.replaceAll(".", "-")}_${(hash >>> 0).toString(36)}`;
}

function ProjectMenuItems({ project, onAction, Item, Separator }: { project: OwnerProject; onAction: (action: ProjectAction) => void; Item: (props: { children: ReactNode; icon?: ReactNode; onSelect?: () => void }) => ReactNode; Separator: () => ReactNode }) {
  return <><Item icon={<FolderKanban />} onSelect={() => onAction("open")}>打开项目</Item><Item icon={<Pencil />} onSelect={() => onAction("rename")}>重命名</Item><Item icon={<Copy />} onSelect={() => onAction("copy")}>复制项目引用</Item><Item icon={<ListTodo />} onSelect={() => onAction("tasks")}>查看项目任务</Item><Separator /><Item icon={<Eye />} onSelect={() => onAction("toggle")}>{project.hidden ? "取消隐藏项目" : "隐藏项目"}</Item></>;
}

function ProjectMenus({ project, onAction }: { project: OwnerProject; onAction: (action: ProjectAction) => void }) {
  return <MenuRoot><MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`项目操作：${project.display_label}`} title="项目操作" onClick={(event) => event.stopPropagation()}><MoreHorizontal className="size-4" /></Button></MenuTrigger><MenuContent><ProjectMenuItems project={project} onAction={onAction} Item={({ children, icon, onSelect }) => <MenuItem icon={icon} onSelect={onSelect}>{children}</MenuItem>} Separator={() => <MenuSeparator />} /></MenuContent></MenuRoot>;
}

function RenameDialog({ project, open, onOpenChange, onSave, saving, error }: { project: OwnerProject | null; open: boolean; onOpenChange: (open: boolean) => void; onSave: (name: string) => Promise<void>; saving: boolean; error: string | null }) {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(project?.display_name || "");
      setLocalError(null);
    }
  }, [open, project]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return setLocalError("项目名称不能为空");
    if (value.length > 80) return setLocalError("项目名称最多 80 个字符");
    setLocalError(null);
    await onSave(value);
  };
  return <Dialog.Root open={open && !!project} onOpenChange={(next: boolean) => { if (!next) { setName(""); setLocalError(null); } onOpenChange(next); }}><Dialog.Portal><Dialog.Overlay className="fade-in fixed inset-0 z-40 backdrop-blur-[1px]" style={{ background: "var(--scrim)" }} /><Dialog.Content aria-describedby={undefined} className="pop-in fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line bg-panel p-5 text-ink shadow-float outline-none"><Dialog.Title className="text-[16px] font-semibold">重命名项目</Dialog.Title><Dialog.Description className="mt-1 text-[13px] text-muted">名称只保存在当前 Control Center 范围。</Dialog.Description><form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4"><Field label="项目名称" hint="最多 80 个字符"><Input autoFocus value={name} placeholder={project?.display_label || "未命名项目"} maxLength={80} onChange={(event) => setName(event.target.value)} /></Field>{(localError || error) && <InlineNotice tone="warning">{localError || error}</InlineNotice>}<div className="flex justify-end gap-2"><Dialog.Close asChild><Button type="button" variant="ghost">取消</Button></Dialog.Close><Button type="submit" variant="primary" disabled={saving} icon={<Check className="size-3.5" />}>{saving ? "保存中" : "保存"}</Button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export default function ProjectsPage() {
  const { scope, scopeId, session } = useWorkspace();
  const tasks = useTasks();
  const notify = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const metadata = useScopedRead((currentScope, signal) => api.projectMetadata(currentScope, signal));
  const projects = useMemo(() => ownerProjects(tasks.connections, tasks.rows, metadata.data?.rows || []), [tasks.connections, tasks.rows, metadata.data?.rows]);
  const filter = (params.get("visibility") === "hidden" ? "hidden" : "all") as ProjectFilter;
  const visibleProjects = projects.filter((project) => filter === "hidden" ? project.hidden : !project.hidden);
  const selected = projects.find((project) => project.key === params.get("project")) || null;
  const [renameTarget, setRenameTarget] = useState<OwnerProject | null>(null);
  const [actionState, setActionState] = useState<ActionRunState>({ phase: "idle", preview: null, receipt: null, error: null });
  const open = (key: string | null, nextTab: Tab = "overview") => { const next = new URLSearchParams(params); if (key) next.set("project", key); else { next.delete("project"); next.delete("tab"); next.delete("task"); } if (key) setParams(selectProjectTab(next, nextTab)); else setParams(next); };
  const navigateToTasks = (project: OwnerProject) => navigate(`/tasks?owner=${encodeURIComponent(project.owner)}&project=${encodeURIComponent(project.project)}`);
  const setFilter = (nextFilter: ProjectFilter) => { const next = new URLSearchParams(params); if (nextFilter === "hidden") next.set("visibility", "hidden"); else next.delete("visibility"); next.delete("project"); setParams(next, { replace: true }); };
  const runMetadataAction = useCallback(async (project: OwnerProject, action: "project.metadata.rename" | "project.metadata.hide" | "project.metadata.unhide", input: Record<string, unknown> = {}) => {
    if (!scopeId || !session?.csrf) return;
    const expectedRevision = String(project.revision);
    const result = await runAction(api, { scope_id: scopeId, owner: "control-center", target_kind: "project", target_ref: project.key, action, expected_revision: expectedRevision, idempotency_key: stableProjectIdempotencyKey(scopeId, project.key, action, expectedRevision), input: { expected_revision: expectedRevision, ...input } }, session.csrf, (phase) => setActionState((current) => ({ ...current, phase })));
    setActionState(result);
    if (result.phase === "succeeded") { metadata.reload(); notify(action === "project.metadata.rename" ? "项目名称已更新" : action === "project.metadata.hide" ? "项目已隐藏" : "项目已恢复", "success"); } else notify(result.error || "项目操作未完成", "warning");
    return result;
  }, [metadata, notify, scopeId, session?.csrf]);
  const handleAction = useCallback(async (project: OwnerProject, action: ProjectAction) => {
    if (action === "open") return open(project.key);
    if (action === "tasks") return navigateToTasks(project);
    if (action === "rename") { setActionState({ phase: "idle", preview: null, receipt: null, error: null }); setRenameTarget(project); return; }
    if (action === "copy") { try { await navigator.clipboard.writeText(project.key); notify("项目引用已复制", "success"); } catch { notify("无法复制项目引用", "warning"); } return; }
    await runMetadataAction(project, project.hidden ? "project.metadata.unhide" : "project.metadata.hide");
  }, [notify, runMetadataAction]);

  if (selected) return <ProjectDetail project={selected} tab={(params.get("tab") || "overview") as Tab} selectedTaskKey={params.get("task")} onTab={(value) => open(selected.key, value)} onBack={() => open(null)} onTaskSelect={(taskKey) => setParams(selectProjectTask(params, taskKey))} onTaskClose={() => setParams(closeProjectTask(params), { replace: true })} onAction={(action) => void handleAction(selected, action)} />;
  return <div className="page-enter space-y-5" data-page="projects"><h1 className="sr-only">项目</h1>{scope && <Panel bodyClassName="p-5"><div className="flex flex-wrap items-center gap-4"><span className="grid size-12 place-items-center rounded-[12px] bg-primary-soft text-primary"><Building2 className="size-6" /></span><div className="min-w-0 flex-1"><p className="text-2xs text-muted">当前授权范围</p><p className="truncate text-lg font-semibold">{scope.label}</p><p className="truncate text-[13px] text-muted">{[scope.tenant && `租户 ${scope.tenant}`, scope.team && `团队 ${scope.team}`, scope.project && `项目 ${scope.project}`].filter(Boolean).join(" · ") || scope.id}</p></div><div className="flex flex-wrap gap-1.5">{(scope.owners || []).map((owner) => <Pill key={owner} tone="info">{ownerLabel(owner)}</Pill>)}</div></div></Panel>}{metadata.status !== "loading" && metadata.status !== "ready" && metadata.status !== "empty" && <InlineNotice tone="warning">本地项目名称暂不可用（{metadata.error || "unknown"}），当前显示未命名项目。</InlineNotice>}<div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-1 rounded-[10px] border border-line bg-panel p-1" role="tablist" aria-label="项目可见性"><button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")} className={cx("rounded-[7px] px-3 py-1.5 text-[13px]", filter === "all" ? "bg-panel-sunken font-medium text-ink" : "text-muted hover:text-ink")}>全部</button><button type="button" role="tab" aria-selected={filter === "hidden"} onClick={() => setFilter("hidden")} className={cx("rounded-[7px] px-3 py-1.5 text-[13px]", filter === "hidden" ? "bg-panel-sunken font-medium text-ink" : "text-muted hover:text-ink")}>已隐藏</button></div><span className="text-2xs text-muted">{visibleProjects.length} 个项目</span></div><section className="space-y-3" aria-label="owner 项目"><h2 className="text-[15px] font-semibold">owner 项目连接</h2>{tasks.status === "loading" && !projects.length ? <Panel><SkeletonRows rows={3} /></Panel> : visibleProjects.length === 0 ? <Panel><EmptyState icon={<FolderKanban />} title={filter === "hidden" ? "当前范围没有已隐藏项目" : "当前范围没有项目连接"} body={filter === "hidden" ? "隐藏项目会保留在当前范围，可随时恢复。" : "服务端尚未为该范围绑定 owner 项目。"} /></Panel> : <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{visibleProjects.map((project, index) => { const results = collectResults(project.tasks).length; const active = project.tasks.filter(taskIsActive).length; const attention = project.tasks.filter(taskNeedsAttention).length; const ready = project.connections.filter((connection) => connection.state === "ready").length; const onAction = (action: ProjectAction) => void handleAction(project, action); return <li key={project.key} className="stagger-in" style={{ "--i": index } as React.CSSProperties}><ContextMenuRoot><ContextMenuTrigger asChild><article data-project={project.key} onClick={(event) => { if (!(event.target instanceof HTMLElement) || !event.target.closest("button")) open(project.key); }} className="group flex h-full flex-col rounded-card border border-line bg-panel p-4 text-left shadow-panel transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong"><div className="flex items-start gap-3"><button type="button" onClick={() => open(project.key)} className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-panel-sunken text-muted"><FolderKanban className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{project.display_label}</span><span className="block truncate text-2xs text-muted">{ownerLabel(project.owner)} · {project.project} · {project.connections.length} 个连接</span></span><ArrowRight className="mt-1 size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" /></button><ProjectMenus project={project} onAction={onAction} /></div><dl className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-[9px] bg-panel-soft px-2 py-2"><dt className="text-2xs text-muted">进行中</dt><dd className="text-base font-semibold tabular">{active}</dd></div><div className="rounded-[9px] bg-panel-soft px-2 py-2"><dt className="text-2xs text-muted">需关注</dt><dd className={cx("text-base font-semibold tabular", attention > 0 && "text-warning")}>{attention}</dd></div><div className="rounded-[9px] bg-panel-soft px-2 py-2"><dt className="text-2xs text-muted">结果</dt><dd className="text-base font-semibold tabular">{results}</dd></div></dl><div className="mt-3 flex items-center justify-between gap-2 text-2xs text-muted"><span className="flex items-center gap-1.5"><Dot tone={project.connections.length === 0 ? "neutral" : ready === project.connections.length ? "success" : "warning"} />{ready}/{project.connections.length} 连接可读</span><span>进度 <Unknown>未提供</Unknown></span></div></article></ContextMenuTrigger><ContextMenuContent><ProjectMenuItems project={project} onAction={onAction} Item={({ children, icon, onSelect }) => <ContextMenuItem icon={icon} onSelect={onSelect}>{children}</ContextMenuItem>} Separator={() => <ContextMenuSeparator />} /></ContextMenuContent></ContextMenuRoot></li>; })}</ul>}<p className="text-2xs text-muted">计数仅针对当前任务观察批次（“已加载”），不是 owner 的项目全量统计。</p></section><RenameDialog project={renameTarget} open={!!renameTarget} onOpenChange={(next) => { if (!next) setRenameTarget(null); }} saving={actionState.phase === "previewing" || actionState.phase === "confirming"} error={actionState.phase === "conflict" ? "项目已被其他操作更新，请重新打开后再试。" : actionState.error} onSave={async (name) => { if (!renameTarget) return; const result = await runMetadataAction(renameTarget, "project.metadata.rename", { display_name: name }); if (result?.phase === "succeeded") setRenameTarget(null); }} /></div>;
}

function ProjectDetail({ project, tab, selectedTaskKey, onTab, onBack, onTaskSelect, onTaskClose, onAction }: { project: OwnerProject; tab: Tab; selectedTaskKey: string | null; onTab: (tab: Tab) => void; onBack: () => void; onTaskSelect: (taskKey: string) => void; onTaskClose: () => void; onAction: (action: ProjectAction) => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [inspectorMode, setInspectorMode] = useState<TaskInspectorMode>(() => typeof window !== "undefined" && window.localStorage.getItem("yeisme.control.tasks.inspector-mode") === "floating" ? "floating" : "fixed");
  const results = collectResults(project.tasks);
  const review = project.tasks.filter(taskNeedsReview);
  const selectedTask = selectedTaskKey ? project.tasks.find((task) => task.task_key === selectedTaskKey) || null : null;
  const previewEntries = useMemo(() => collectResults(project.tasks), [project.tasks]);
  const preview = useMediaPreview({ previewKey: params.get("preview"), resolve: (key) => previewEntries.find((entry) => entry.key === key) || null, onPreviewKeyChange: (key, history) => { const next = new URLSearchParams(params); if (key) next.set("preview", key); else next.delete("preview"); setParams(next, { replace: history === "replace" }); } });
  const changeInspectorMode = useCallback((mode: TaskInspectorMode) => { setInspectorMode(mode); window.localStorage.setItem("yeisme.control.tasks.inspector-mode", mode); }, []);
  const closeTask = useCallback((open: boolean) => { if (!open) onTaskClose(); }, [onTaskClose]);
  return <div className={cx(!selectedTask && "page-enter", "space-y-5", selectedTask && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")} data-page="project-detail"><h1 className="sr-only">{project.display_label}</h1><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><Button size="sm" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-3.5" />}>全部项目</Button><span className="text-faint">/</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{project.display_label}</p><p className="truncate text-2xs text-muted">{ownerLabel(project.owner)} · {project.project}</p></div></div><div className="flex items-center gap-1"><Button size="sm" variant="primary" onClick={() => navigate(`/tasks?owner=${project.owner}&project=${encodeURIComponent(project.project)}`)} icon={<ListTodo className="size-3.5" />}>在任务中心打开</Button><ProjectMenus project={project} onAction={onAction} /></div></div><SegmentedTabs label="项目详情" value={tab} onChange={onTab} options={[{ id: "overview", label: "概览" }, { id: "tasks", label: "任务", count: project.tasks.length }, { id: "assets", label: "结果", count: results.length }, { id: "review", label: "审阅", count: review.length }, { id: "delivery", label: "交付" }]} />{tab === "overview" && <div className="grid gap-5 lg:grid-cols-2"><Panel title="连接"><ul className="divide-y divide-line">{project.connections.length ? project.connections.map((connection) => <li key={connection.id} className="flex items-center gap-3 px-5 py-3"><Dot tone={connectionTone(connection.state)} /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{connection.label}</span><span className="block truncate text-2xs text-muted">{connection.environment} · {connection.instance_id}</span></span><span className="text-2xs text-muted">{connectionStateLabel(connection.state)}</span></li>) : <li className="px-5 py-6 text-[13px] text-muted">该项目只在任务中出现，没有直接的连接配置。</li>}</ul></Panel><Panel title="项目事实"><div className="p-5"><Facts columns={2} items={[{ label: "Owner", value: ownerLabel(project.owner) }, { label: "项目引用", value: <span className="font-mono text-xs">{project.project}</span> }, { label: "本地名称", value: project.display_label }, { label: "已加载任务", value: project.tasks.length }, { label: "已加载结果", value: results.length }, { label: "制作进度", value: <Unknown>owner 未提供</Unknown> }]} /></div></Panel></div>}{tab === "tasks" && <Panel bodyClassName="p-0">{project.tasks.length ? <ul className="divide-y divide-line">{project.tasks.slice(0, 50).map((task) => <li key={task.task_key} data-task={task.locator.task_ref}><button type="button" onClick={() => task.task_key && onTaskSelect(task.task_key)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-panel-soft"><KindBadge kind={taskKind(task)} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{task.title}</span><span className="block truncate text-2xs text-muted">{stageLabel(task.stage)} · {formatRelative(task.updated_at || task.created_at)}</span></span><TaskStatePill state={task.state} /></button></li>)}</ul> : <EmptyState compact icon={<ListTodo />} title="当前批次没有该项目的任务" />}</Panel>}{tab === "assets" && <Panel bodyClassName="p-0">{results.length ? <ul className="divide-y divide-line">{results.slice(0, 50).map((entry) => <li key={entry.key}><button type="button" onClick={() => navigate(`/assets?result=${encodeURIComponent(entry.key)}`)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-panel-soft"><KindBadge kind={entry.kind} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{entry.result.name || "未命名结果"}</span><span className="block truncate text-2xs text-muted">{entry.task.title}</span></span><ArrowRight className="size-4 text-faint" /></button></li>)}</ul> : <EmptyState compact icon={<Images />} title="当前批次没有该项目的结果" />}</Panel>}{tab === "review" && <Panel bodyClassName="p-0">{review.length ? <ul className="divide-y divide-line">{review.map((task) => <li key={task.task_key} className="flex items-center gap-3 px-5 py-3"><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{task.title}</span><span className="block truncate text-2xs text-muted">审阅：{reviewLabel(task)}</span></span><TaskStatePill state={task.state} /></li>)}</ul> : <EmptyState compact title="没有审阅相关记录" body="只有 owner 返回 waiting_review 或审阅状态时才会出现。" />}</Panel>}{tab === "delivery" && <Panel><EmptyState icon={<Send />} title="交付合同未提供" body="owner 尚未提供交付包、权限检查和发送合同；控制中心不会从任务或结果推导交付状态。" /></Panel>}<InlineNotice tone="neutral" icon={<Plug />}>项目页只组合已授权的 owner 只读投影；新建项目、成员邀请和制作单元维护需要独立 owner 写合同。</InlineNotice>{selectedTask && <TaskDetail task={selectedTask} open mode={inspectorMode} onModeChange={changeInspectorMode} preview={preview} onOpenChange={closeTask} />}{selectedTaskKey && !selectedTask && <InlineNotice tone="warning" className="items-center"><span>当前观察批次未找到该项目任务，未跳转到任务中心，也未使用演示数据补齐。</span><Button size="sm" onClick={onTaskClose}>关闭</Button></InlineNotice>}</div>;
}
