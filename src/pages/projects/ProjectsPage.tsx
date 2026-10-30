import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Dialog } from "radix-ui";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Copy, Eye, FolderKanban, FolderPlus, Images, Link2, ListTodo, Pencil, Plug, Send, Unplug } from "../../icons";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { recentTarget, useRememberRecent } from "../../app/recent";
import { useTasks } from "../../app/tasks-context";
import { useObservationCache } from "../../app/observation-cache";
import { copyReference } from "../../shared/clipboard";
import { useMediaPreview } from "../../components/media-preview";
import { AssetPreviewStage } from "../assets/AssetsPage";
import {
  Button,
  ActionsContextMenu,
  ActionsMenu,
  DataTable,
  fillMainColumn,
  Dot,
  EmptyState,
  Facts,
  Field,
  InlineNotice,
  Input,
  KindBadge,
  MetricStrip,
  NoticeStack,
  PageToolbar,
  Panel,
  Pill,
  ReadStateView,
  SearchField,
  Select,
  SkeletonRows,
  StatCard,
  TabPanel,
  Tabs,
  TaskStatePill,
  ToggleGroup,
  Unknown,
  cx,
  kindLabel,
  ownerLabel,
  useToast,
  type Column,
  type ItemAction,
  type MediaKind,
} from "../../components/ui";
import { SourceStatusLine } from "../../components/SourceStatusLine";
import { api, type OwnerProjectRow, type ProjectMetadata, type TaskConnectionState, type TaskSnapshot } from "../../shared/api/control-center-client";
import type { SharedProject } from "../../shared/collaboration";
import { runAction, type ActionRunState } from "../../shared/action-runner";
import { formatFullTime, formatRelative } from "../../shared/read-model/format";
import { labelFrom } from "../../shared/read-model/labels";
import { readErrorMessage } from "../../shared/read-model/read-state";
import { collectResults, connectionStateLabel, connectionTone, resultAction, resultMeta, stageLabel, taskKind, type ResultEntry } from "../../shared/read-model/tasks";
import { taskNeedsReview } from "../../shared/read-model/review";
import { closeProjectTask, selectProjectResult, selectProjectTab, selectProjectTask } from "../../shared/read-model/project-navigation";
import { taskIsActive, taskNeedsAttention, taskStageLabels, taskStateLabels } from "../../task-observation";
import { AudioQueue, audioTrackFrom, useAudioPlayer } from "../../app/audio-player";
import { MediaViewer, visualSlides } from "../../components/MediaViewer";
import { TaskDetail, type TaskInspectorMode } from "../tasks/TaskDetail";
import SharedProjects from "./SharedProjects";
import { ConnectToolProjectDialog, DisconnectToolProjectDialog, type DisconnectTarget } from "./ToolProjectDialogs";

type Tab = "overview" | "tasks" | "assets" | "review" | "delivery";
type ProjectFilter = "all" | "hidden";
type ProjectAction = "open" | "rename" | "copy" | "tasks" | "toggle" | "share-new" | "share-add" | "disconnect";
type MetadataAction = "project.metadata.rename" | "project.metadata.hide" | "project.metadata.unhide";

const projectTabs: Tab[] = ["overview", "tasks", "assets", "review", "delivery"];
const listLimit = 50;
const readFailureStates = ["forbidden", "unavailable", "needs_contract", "unknown", "login_required"];

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
  /** The scope's default project for this tool. */
  pinned: boolean;
  /** Connections an administrator added here; only these can be disconnected. */
  registrations: OwnerProjectRow["registrations"];
  /** Shared projects (visible to this identity) that bind it. */
  used: number;
}

function ownerProjects(connections: TaskConnectionState[], rows: TaskSnapshot[], metadata: ProjectMetadata[], owned: OwnerProjectRow[] = [], shared: SharedProject[] = [], scopeId = ""): OwnerProject[] {
  const map = new Map<string, OwnerProject>();
  const ensure = (owner: string, project: string) => {
    const key = `${owner}:${project}`;
    const known = metadata.find((item) => item.owner === owner && item.project_ref === project);
    const entry = map.get(key) || {
      key,
      owner,
      project,
      connections: [],
      tasks: [],
      display_name: known?.display_name || "",
      display_label: known?.display_label || "未命名项目",
      hidden: known?.hidden === true,
      revision: known?.revision || 0,
      pinned: false,
      registrations: [],
      used: 0,
    };
    if (known) {
      entry.display_name = known.display_name;
      entry.display_label = known.display_label;
      entry.hidden = known.hidden;
      entry.revision = known.revision;
    }
    map.set(key, entry);
    return entry;
  };
  for (const connection of connections) ensure(connection.owner, connection.project).connections.push(connection);
  for (const task of rows) ensure(task.locator.owner, task.locator.project).tasks.push(task);
  // Tool projects of this scope without connections or loaded tasks still belong in the list.
  for (const row of owned) {
    const entry = ensure(row.owner, row.project_ref);
    entry.pinned ||= row.pinned;
    entry.registrations = row.registrations;
    // A name given for the same project in another scope of the tenant, when this scope has none.
    if (!entry.display_name && row.display_name) {
      entry.display_name = row.display_name;
      entry.display_label = row.display_name;
    }
  }
  for (const entry of map.values()) entry.used = shared.filter((p) => p.bindings.some((b) => b.owner === entry.owner && b.project_ref === entry.project && b.source_scope === scopeId)).length;
  // Grouped by tool, the default project first.
  return [...map.values()].sort((a, b) => a.owner.localeCompare(b.owner) || Number(b.pinned) - Number(a.pinned) || a.display_label.localeCompare(b.display_label) || a.project.localeCompare(b.project));
}

/** Unnamed projects are told apart by their owner project ref instead of repeating "未命名项目". */
function projectTitle(project: OwnerProject) {
  return project.display_name.trim() || project.project;
}

function ProjectSubtitle({ project }: { project: OwnerProject }) {
  return (
    <>
      <span className="font-medium text-ink-soft">{ownerLabel(project.owner)}</span>
      {" · "}
      {project.display_name.trim() ? project.project : "未设置本地名称"}
    </>
  );
}

function projectStats(project: OwnerProject) {
  return {
    active: project.tasks.filter(taskIsActive).length,
    attention: project.tasks.filter(taskNeedsAttention).length,
    results: collectResults(project.tasks).length,
    ready: project.connections.filter((connection) => connection.state === "ready").length,
    connections: project.connections.length,
  };
}
type ProjectStats = ReturnType<typeof projectStats>;

function tasksHref(project: OwnerProject, view?: "attention", filters: { q?: string; state?: string; stage?: string } = {}) {
  const query = new URLSearchParams({ owner: project.owner, project: project.project });
  if (view) query.set("view", view);
  if (filters.q) query.set("q", filters.q);
  if (filters.state) query.set("state", filters.state);
  if (filters.stage) query.set("stage", filters.stage);
  return `/tasks?${query.toString()}`;
}

const reviewStatusLabels: Record<string, string> = {
  pending_review: "待审阅",
  needs_review: "待审阅",
  waiting_review: "待审阅",
  in_review: "审阅中",
  reviewing: "审阅中",
  changes_requested: "需修改",
  rejected: "未通过",
  approved: "已通过",
};

function reviewStatusLabel(status: string) {
  return labelFrom(reviewStatusLabels, status).replace(/[_-]+/g, " ");
}

function stableProjectIdempotencyKey(scopeId: string, projectKey: string, action: string, revision: string) {
  let hash = 2166136261;
  for (const char of `${scopeId}|${projectKey}|${action}|${revision}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `project_metadata_${action.replaceAll(".", "-")}_${(hash >>> 0).toString(36)}`;
}

/** One list for the card's "更多操作" menu and its context menu. */
function projectActions(project: OwnerProject, onAction: (action: ProjectAction) => void): ItemAction[] {
  return [
    { id: "open", label: "打开项目", icon: <FolderKanban />, group: "open", run: () => onAction("open") },
    { id: "tasks", label: "查看项目任务", icon: <ListTodo />, group: "open", run: () => onAction("tasks") },
    { id: "rename", label: "重命名", icon: <Pencil />, group: "edit", run: () => onAction("rename") },
    { id: "copy", label: "复制项目引用", icon: <Copy />, group: "edit", run: () => onAction("copy") },
    { id: "share-new", label: "用它新建共享项目", icon: <FolderPlus />, group: "share", run: () => onAction("share-new") },
    { id: "share-add", label: "加入共享项目…", icon: <Link2 />, group: "share", run: () => onAction("share-add") },
    { id: "toggle", label: project.hidden ? "取消隐藏项目" : "隐藏项目", icon: <Eye />, group: "state", run: () => onAction("toggle") },
    ...(project.registrations.length ? [{ id: "disconnect", label: "断开接入", icon: <Unplug />, group: "state", tone: "danger" as const, run: () => onAction("disconnect") }] : []),
  ];
}

function RenameDialog({ project, open, onOpenChange, onSave, saving, error }: {
  project: OwnerProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => Promise<void>;
  saving: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(project?.display_name || "");
      setLocalError(null);
    }
  }, [open, project]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return setLocalError("项目名称不能为空");
    if (value.length > 80) return setLocalError("项目名称最多 80 个字符");
    setLocalError(null);
    await onSave(value);
  };
  return (
    <Dialog.Root
      open={open && !!project}
      onOpenChange={(next: boolean) => {
        if (!next) {
          setName("");
          setLocalError(null);
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 backdrop-blur-[1px]" style={{ background: "var(--scrim)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="pop-in fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line bg-panel p-5 text-ink shadow-float outline-none"
        >
          <Dialog.Title className="text-title-sm font-semibold">重命名项目</Dialog.Title>
          <Dialog.Description className="mt-1 text-body-sm text-muted">名称只保存在当前 Control Center 范围。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
            <Field label="项目名称" hint="最多 80 个字符">
              <Input autoFocus value={name} placeholder={project?.project || "项目名称"} maxLength={80} onChange={(event) => setName(event.target.value)} />
            </Field>
            {(localError || error) && <InlineNotice tone="warning">{localError || error}</InlineNotice>}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">取消</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={saving} icon={<Check className="size-3.5" />}>{saving ? "保存中" : "保存"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Catalog = "shared" | "tools";

/** One entry for both kinds of project: shared projects people work in, and the tool projects they draw on. */
export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const catalog: Catalog = params.get("catalog") === "owner" || params.get("project") ? "tools" : "shared";
  // Details carry their own way back; the switch only shows on the two lists.
  if (params.get("project")) return <OwnerProjectsPage />;
  if (params.get("sharedProject")) return <SharedProjects />;
  const select = (next: Catalog) => setParams((current) => {
    const value = new URLSearchParams(current);
    for (const key of ["catalog", "project", "tab", "task", "visibility", "q", "role", "owner", "hidden", "cursor"]) value.delete(key);
    if (next === "tools") value.set("catalog", "owner");
    return value;
  });
  return (
    <Tabs<Catalog> value={catalog} onChange={select} label="项目类型" listClassName="mb-4" options={[{ id: "shared", label: "共享项目" }, { id: "tools", label: "工具项目" }]}>
      <TabPanel value="shared">{catalog === "shared" && <SharedProjects />}</TabPanel>
      <TabPanel value="tools">{catalog === "tools" && <OwnerProjectsPage />}</TabPanel>
    </Tabs>
  );
}

function OwnerProjectsPage() {
  const { scope, scopeId, session, setScope } = useWorkspace();
  const tasks = useTasks();
  const notify = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const metadata = useScopedRead((currentScope, signal) => api.projectMetadata(currentScope, signal));
  const owned = useScopedRead((currentScope, signal) => api.ownerProjects(currentScope, signal));
  const shared = useScopedRead((_currentScope, signal) => api.sharedProjects({}, signal));
  // Tool projects belong to a personal or team scope; a shared project's scope only borrows them.
  const home = session?.scopes.find((s) => !s.id.startsWith("project_"));
  useEffect(() => { if (scopeId.startsWith("project_") && home) setScope(home.id); }, [scopeId, home?.id]);
  const projects = useMemo(
    () => ownerProjects(tasks.connections, tasks.rows, metadata.data?.rows || [], (owned.data?.rows || []).filter((row) => row.scope_id === scopeId), shared.data?.rows || [], scopeId),
    [tasks.connections, tasks.rows, metadata.data?.rows, owned.data?.rows, shared.data?.rows, scopeId],
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<DisconnectTarget | null>(null);
  const cache = useObservationCache();
  // Connections changed on the server: cached task reads describe the old set.
  const reloadToolProjects = () => { cache.clear(); owned.reload(); metadata.reload(); tasks.refresh(); };
  const filter = (params.get("visibility") === "hidden" ? "hidden" : "all") as ProjectFilter;
  const visibleProjects = projects.filter((project) => (filter === "hidden" ? project.hidden : !project.hidden));
  const stats = useMemo(() => new Map(projects.map((project) => [project.key, projectStats(project)])), [projects]);
  const selected = projects.find((project) => project.key === params.get("project")) || null;
  useRememberRecent(selected ? { key: `project:${selected.key}`, kind: "project", label: selected.display_name, meta: `${ownerLabel(selected.owner)} · 项目`, target: recentTarget("/projects", params) } : null);
  const [renameTarget, setRenameTarget] = useState<OwnerProject | null>(null);
  const [manualCopy, setManualCopy] = useState("");
  const [actionState, setActionState] = useState<ActionRunState>({ phase: "idle", preview: null, receipt: null, error: null });

  const open = (key: string | null, nextTab: Tab = "overview") => {
    const next = new URLSearchParams(params);
    for (const filterKey of ["taskQ", "taskState", "taskStage", "assetQ", "assetKind", "reviewQ", "reviewStatus"]) next.delete(filterKey);
    if (key) next.set("project", key);
    else {
      next.delete("project");
      next.delete("tab");
      next.delete("task");
    }
    if (key) setParams(selectProjectTab(next, nextTab));
    else setParams(next);
  };
  const navigateToTasks = (project: OwnerProject) => navigate(tasksHref(project));
  const setFilter = (nextFilter: ProjectFilter) => {
    const next = new URLSearchParams(params);
    if (nextFilter === "hidden") next.set("visibility", "hidden");
    else next.delete("visibility");
    next.delete("project");
    setParams(next, { replace: true });
  };

  const runMetadataAction = useCallback(async (project: OwnerProject, action: MetadataAction, input: Record<string, unknown> = {}) => {
    if (!scopeId || !session?.csrf) return;
    const expectedRevision = String(project.revision);
    const result = await runAction(
      api,
      {
        scope_id: scopeId,
        owner: "control-center",
        target_kind: "project",
        target_ref: project.key,
        action,
        expected_revision: expectedRevision,
        idempotency_key: stableProjectIdempotencyKey(scopeId, project.key, action, expectedRevision),
        input: { expected_revision: expectedRevision, ...input },
      },
      session.csrf,
      (phase) => setActionState((current) => ({ ...current, phase })),
    );
    setActionState(result);
    if (result.phase === "succeeded") {
      metadata.reload();
      notify(action === "project.metadata.rename" ? "项目名称已更新" : action === "project.metadata.hide" ? "项目已隐藏" : "项目已恢复", "success");
    } else notify(result.error || "项目操作未完成", "warning");
    return result;
  }, [metadata, notify, scopeId, session?.csrf]);

  const handleAction = useCallback(async (project: OwnerProject, action: ProjectAction) => {
    if (action === "open") return open(project.key);
    if (action === "tasks") return navigateToTasks(project);
    if (action === "share-new" || action === "share-add") {
      const query = new URLSearchParams({ bindOwner: project.owner, bindProject: project.project, bindScope: scopeId, bindTenant: scope?.tenant || "" });
      if (action === "share-new") query.set("bindNew", "1");
      return navigate(`/projects?${query.toString()}`);
    }
    if (action === "disconnect") {
      const registration = project.registrations[0];
      if (registration) setDisconnectTarget({ connectionId: registration.id, name: projectTitle(project), owner: project.owner, used: project.used });
      return;
    }
    if (action === "rename") {
      setActionState({ phase: "idle", preview: null, receipt: null, error: null });
      setRenameTarget(project);
      return;
    }
    if (action === "copy") {
      if (await copyReference(project.key)) {
        setManualCopy("");
        notify("项目引用已复制", "success");
      } else {
        setManualCopy(project.key);
        notify("浏览器未允许复制，请使用页面中的手动复制框。", "warning");
      }
      return;
    }
    await runMetadataAction(project, project.hidden ? "project.metadata.unhide" : "project.metadata.hide");
  }, [navigate, notify, runMetadataAction, scope?.tenant, scopeId]);

  const dialogs = scopeId && session?.csrf ? (
    <>
      <ConnectToolProjectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        templates={owned.data?.templates || []}
        scopeId={scopeId}
        csrf={session.csrf}
        onConnected={(label) => { setConnectOpen(false); reloadToolProjects(); notify(`已接入「${label}」`, "success"); }}
      />
      <DisconnectToolProjectDialog
        target={disconnectTarget}
        onOpenChange={(next) => { if (!next) setDisconnectTarget(null); }}
        scopeId={scopeId}
        csrf={session.csrf}
        onDisconnected={() => { const name = disconnectTarget?.name; setDisconnectTarget(null); if (selected) open(null); reloadToolProjects(); notify(`已断开「${name}」`, "success"); }}
      />
    </>
  ) : null;

  if (selected) {
    const rawTab = params.get("tab") as Tab | null;
    return (
      <>
        <ProjectDetail
          project={selected}
          tab={rawTab && projectTabs.includes(rawTab) ? rawTab : "overview"}
          selectedTaskKey={params.get("task")}
          onTab={(value) => open(selected.key, value)}
          onBack={() => open(null)}
          onTaskSelect={(taskKey) => setParams(selectProjectTask(params, taskKey))}
          onTaskClose={() => setParams(closeProjectTask(params), { replace: true })}
          onAction={(action) => void handleAction(selected, action)}
        />
        {dialogs}
      </>
    );
  }

  const shownStats = visibleProjects.map((project) => stats.get(project.key)).filter((item): item is ProjectStats => !!item);
  const totals = shownStats.reduce(
    (sum, item) => ({ active: sum.active + item.active, attention: sum.attention + item.attention, results: sum.results + item.results, ready: sum.ready + item.ready, connections: sum.connections + item.connections }),
    { active: 0, attention: 0, results: 0, ready: 0, connections: 0 },
  );
  const hiddenCount = projects.filter((project) => project.hidden).length;
  const taskReadFailed = projects.length === 0 && readFailureStates.includes(tasks.status);
  const metadataUnavailable = metadata.status !== "loading" && metadata.status !== "ready" && metadata.status !== "empty";

  return (
    <div className="page-enter space-y-5" data-page="projects">
      <h1 className="sr-only">工具项目</h1>
      <PageToolbar
        summary="当前范围能读取的 Eikona、Sonora 等工具里的项目，可以关联到多个共享项目。计数只含已加载的任务，不是工具里的全量统计。"
        actions={
          <>
            <ToggleGroup<ProjectFilter>
              label="项目可见性"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: "显示中", count: projects.length - hiddenCount },
                { id: "hidden", label: "已隐藏", count: hiddenCount },
              ]}
            />
            {owned.data?.can_register && <Button size="sm" variant="secondary" icon={<Plug className="size-4" />} onClick={() => setConnectOpen(true)}>接入工具项目</Button>}
          </>
        }
        metrics={shownStats.length > 0 && (
          <MetricStrip
            label="项目概况"
            items={[
              { label: "项目", value: visibleProjects.length },
              { label: "进行中", value: totals.active },
              { label: "需关注", value: totals.attention, tone: totals.attention > 0 ? "warning" : "neutral" },
              { label: "结果", value: totals.results },
              { label: "连接可读", value: `${totals.ready}/${totals.connections}`, tone: totals.ready < totals.connections ? "warning" : "neutral" },
            ]}
          />
        )}
        meta={
          <>
            {(scope?.owners || []).length > 0 && <span className="text-2xs text-muted">授权 owner</span>}
            {(scope?.owners || []).map((owner) => <Pill key={owner} size="sm" tone="info">{ownerLabel(owner)}</Pill>)}
            {tasks.observedAt && (
              <span className="inline-flex items-center gap-1.5 text-2xs text-muted">
                <Clock3 className="size-3.5" />任务观察于 {formatRelative(tasks.observedAt)}
              </span>
            )}
          </>
        }
      />
      <NoticeStack
        notices={[
          <SourceStatusLine key="source" noun="项目结果" />,
          metadataUnavailable && <InlineNotice key="metadata" tone="warning">本地项目名称暂不可读，暂按项目引用显示。{readErrorMessage(metadata.error)}</InlineNotice>,
        ]}
      />
      {manualCopy && <InlineNotice tone="warning">浏览器未允许复制，请手动选择项目引用：<input aria-label="手动复制 owner 项目引用" readOnly value={manualCopy} className="mt-2 w-full rounded border border-line bg-panel px-2 py-1 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} /></InlineNotice>}
      <section aria-label="工具项目">
        {tasks.status === "loading" && !projects.length ? (
          <Panel><SkeletonRows rows={3} /></Panel>
        ) : taskReadFailed ? (
          <Panel><ReadStateView status={tasks.status} error={tasks.error} onRetry={tasks.refresh} /></Panel>
        ) : visibleProjects.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<FolderKanban />}
              title={filter === "hidden" ? "当前范围没有已隐藏项目" : "当前范围还没有工具项目"}
              body={filter === "hidden" ? "隐藏项目会保留在当前范围，可随时恢复。" : owned.data?.can_register ? "用已配置的连接接入一个工具项目，之后就能在共享项目里关联它。" : "请管理员为这个范围配置工具连接。"}
              action={filter !== "hidden" && owned.data?.can_register ? <Button icon={<Plug className="size-4" />} onClick={() => setConnectOpen(true)}>接入工具项目</Button> : undefined}
            />
          </Panel>
        ) : (
          <div className="space-y-5">
            {[...new Set(visibleProjects.map((project) => project.owner))].map((owner) => {
              const group = visibleProjects.filter((project) => project.owner === owner);
              return (
                <section key={owner} aria-label={`${ownerLabel(owner)} 项目`} data-owner-group={owner}>
                  <h2 className="mb-2 flex items-center gap-2 text-body-sm font-semibold text-ink">{ownerLabel(owner)}<span className="tabular text-meta font-normal text-muted">{group.length} 个项目</span></h2>
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {group.map((project, index) => (
                      <ProjectCard
                        key={project.key}
                        project={project}
                        stats={stats.get(project.key) || projectStats(project)}
                        index={index}
                        onOpen={() => open(project.key)}
                        onAction={(action) => void handleAction(project, action)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>
      {dialogs}
      <RenameDialog
        project={renameTarget}
        open={!!renameTarget}
        onOpenChange={(next) => { if (!next) setRenameTarget(null); }}
        saving={actionState.phase === "previewing" || actionState.phase === "confirming"}
        error={actionState.phase === "conflict" ? "项目已被其他操作更新，请重新打开后再试。" : actionState.error}
        onSave={async (name) => {
          if (!renameTarget) return;
          const result = await runMetadataAction(renameTarget, "project.metadata.rename", { display_name: name });
          if (result?.phase === "succeeded") setRenameTarget(null);
        }}
      />
    </div>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <dt className="text-2xs text-muted">{label}</dt>
      <dd className={cx("tabular text-title-sm font-semibold", warn ? "text-warning" : "text-ink")}>{value}</dd>
    </div>
  );
}

function ConnectionSummary({ project }: { project: OwnerProject }) {
  const total = project.connections.length;
  if (!total) {
    return <span className="flex items-center gap-1.5"><Dot tone="neutral" />无直接连接配置</span>;
  }
  const ready = project.connections.filter((connection) => connection.state === "ready").length;
  const blocked = project.connections.find((connection) => connection.state !== "ready");
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Dot tone={blocked ? connectionTone(blocked.state) : "success"} />
      <span className="truncate">{ready}/{total} 连接可读{blocked ? ` · ${connectionStateLabel(blocked.state)}` : ""}</span>
    </span>
  );
}

function ProjectCard({ project, stats, index, onOpen, onAction }: { project: OwnerProject; stats: ProjectStats; index: number; onOpen: () => void; onAction: (action: ProjectAction) => void }) {
  return (
    <li className="stagger-in" style={{ "--i": index } as CSSProperties}>
      <ActionsContextMenu actions={projectActions(project, onAction)}>
          <article
            data-project={project.key}
            onClick={(event) => {
              // Menu items render in a portal yet still bubble here through React; only clicks on the card open it.
              if (!event.currentTarget.contains(event.target as Node)) return;
              if (!(event.target instanceof HTMLElement) || !event.target.closest("button")) onOpen();
            }}
            className="group flex h-full cursor-pointer flex-col gap-4 rounded-card border border-line bg-panel p-4 shadow-panel transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-raised"
          >
            <header className="flex items-start gap-2">
              <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <span className="grid size-10 shrink-0 place-items-center rounded-control bg-panel-sunken text-muted"><FolderKanban className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-ink">{projectTitle(project)}</span>
                  <span className="mt-0.5 block truncate text-meta text-muted"><ProjectSubtitle project={project} /></span>
                </span>
              </button>
              <ActionsMenu actions={projectActions(project, onAction)} label={`项目操作：${projectTitle(project)}`} />
            </header>
            <dl className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-control border border-line bg-panel-soft">
              <MiniStat label="进行中" value={stats.active} />
              <MiniStat label="需关注" value={stats.attention} warn={stats.attention > 0} />
              <MiniStat label="结果" value={stats.results} />
            </dl>
            {(project.pinned || project.registrations.length > 0 || project.used > 0) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {project.pinned && <Pill size="sm">默认项目</Pill>}
                {project.registrations.length > 0 && <Pill size="sm" tone="info">控制中心接入</Pill>}
                {project.used > 0 && <Pill size="sm" tone="success">用于 {project.used} 个共享项目</Pill>}
              </div>
            )}
            <footer className="mt-auto flex items-center justify-between gap-2 text-meta text-muted">
              <ConnectionSummary project={project} />
              <ArrowRight className="size-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5" />
            </footer>
          </article>
      </ActionsContextMenu>
    </li>
  );
}

function ProjectDetail({ project, tab, selectedTaskKey, onTab, onBack, onTaskSelect, onTaskClose, onAction }: {
  project: OwnerProject;
  tab: Tab;
  selectedTaskKey: string | null;
  onTab: (tab: Tab) => void;
  onBack: () => void;
  onTaskSelect: (taskKey: string) => void;
  onTaskClose: () => void;
  onAction: (action: ProjectAction) => void;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [inspectorMode, setInspectorMode] = useState<TaskInspectorMode>(() => typeof window !== "undefined" && window.localStorage.getItem("yeisme.control.tasks.inspector-mode") === "floating" ? "floating" : "fixed");
  const stats = useMemo(() => projectStats(project), [project]);
  const results = useMemo(() => collectResults(project.tasks), [project.tasks]);
  const review = useMemo(() => project.tasks.filter(taskNeedsReview), [project.tasks]);
  const selectedTask = selectedTaskKey ? project.tasks.find((task) => task.task_key === selectedTaskKey) || null : null;
  const preview = useMediaPreview({
    previewKey: params.get("preview"),
    urlParam: "preview",
    resolve: (key) => results.find((entry) => entry.key === key) || null,
    onPreviewKeyChange: (key, history) => {
      const next = new URLSearchParams(params);
      if (key) next.set("preview", key);
      else next.delete("preview");
      setParams(next, { replace: history === "replace" });
    },
  });
  const viewerSlides = useMemo(() => visualSlides(results), [results]);
  const navigateViewer = (key: string) => {
    const entry = results.find((item) => item.key === key);
    if (!entry) return;
    preview.open(entry, { source: "detail-sheet", autoplay: true, syncQuery: false });
    const next = new URLSearchParams(params);
    next.set("preview", key);
    if (params.get("result")) next.set("result", key);
    setParams(next, { replace: true });
  };
  const changeInspectorMode = useCallback((mode: TaskInspectorMode) => {
    setInspectorMode(mode);
    window.localStorage.setItem("yeisme.control.tasks.inspector-mode", mode);
  }, []);
  const closeTask = useCallback((open: boolean) => {
    if (!open) onTaskClose();
  }, [onTaskClose]);

  return (
    <div
      className={cx(!selectedTask && "page-enter", "space-y-5", selectedTask && inspectorMode === "fixed" && "min-[1280px]:pr-[var(--inspector-width)]")}
      data-page="project-detail"
    >
      <h1 className="sr-only">{projectTitle(project)}</h1>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-3.5" />}>全部项目</Button>
          <span aria-hidden="true" className="text-faint">/</span>
          <div className="min-w-0">
            <p className="truncate text-title-sm font-semibold text-ink">{projectTitle(project)}</p>
            <p className="truncate text-meta text-muted"><ProjectSubtitle project={project} /></p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="primary" onClick={() => navigate(tasksHref(project))} icon={<ListTodo className="size-3.5" />}>在任务中心打开</Button>
          <ActionsMenu actions={projectActions(project, onAction)} label={`项目操作：${projectTitle(project)}`} />
        </div>
      </header>
      <Tabs<Tab>
        value={tab}
        onChange={onTab}
        label="项目详情"
        className="space-y-4"
        options={[
          { id: "overview", label: "概览" },
          { id: "tasks", label: "任务", count: project.tasks.length },
          { id: "assets", label: "结果", count: results.length },
          { id: "review", label: "审阅", count: review.length },
          { id: "delivery", label: "交付" },
        ]}
      >
        <TabPanel value="overview">
          <OverviewTab project={project} stats={stats} reviewCount={review.length} onTab={onTab} onAttention={() => navigate(tasksHref(project, "attention"))} />
        </TabPanel>
        <TabPanel value="tasks">
          <TasksTab project={project} selectedTaskKey={selectedTaskKey} onSelect={onTaskSelect} />
        </TabPanel>
        <TabPanel value="assets">
          <AssetsTab project={project} results={results} selectedKey={params.get("result")} preview={preview} onSelect={(entry) => setParams(selectProjectResult(params, entry.key))} onClose={() => setParams(selectProjectResult(params, null))} onPreview={(entry) => { const next = selectProjectResult(params, entry.key); next.set("preview", entry.key); setParams(next); }} />
        </TabPanel>
        <TabPanel value="review">
          <ReviewTab tasks={review} />
        </TabPanel>
        <TabPanel value="delivery">
          <Panel>
            <EmptyState icon={<Send />} title="交付合同未提供" body="owner 尚未提供交付包、权限检查和发送合同；控制中心不会从任务或结果推导交付状态。" />
          </Panel>
        </TabPanel>
      </Tabs>
      <p className="flex items-start gap-2 text-meta text-muted">
        <Plug className="mt-0.5 size-3.5 shrink-0" />
        项目页只组合已授权的 owner 只读投影；新建项目、成员邀请和制作单元维护需要独立 owner 写合同。
      </p>
      {selectedTask && <TaskDetail task={selectedTask} open mode={inspectorMode} onModeChange={changeInspectorMode} preview={preview} onOpenChange={closeTask} />}
      <MediaViewer controller={preview} slides={viewerSlides} onNavigate={navigateViewer} onDetails={(key) => setParams(selectProjectResult(params, key), { replace: true })} />
      {selectedTaskKey && !selectedTask && (
        <InlineNotice tone="warning" className="items-center">
          <span>当前观察批次未找到该项目任务，未跳转到任务中心，也未使用演示数据补齐。</span>
          <Button size="sm" onClick={onTaskClose}>关闭</Button>
        </InlineNotice>
      )}
    </div>
  );
}

const statCardTop = "flex flex-col justify-start";

function OverviewTab({ project, stats, reviewCount, onTab, onAttention }: { project: OwnerProject; stats: ProjectStats; reviewCount: number; onTab: (tab: Tab) => void; onAttention: () => void }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard className={statCardTop} label="已加载任务" value={project.tasks.length} hint={`进行中 ${stats.active}`} icon={<ListTodo />} onClick={() => onTab("tasks")} />
        <StatCard className={statCardTop} label="需关注" value={stats.attention} hint="失败、受阻、结果未知、待审阅等" tone={stats.attention > 0 ? "warning" : "neutral"} icon={<CircleAlert />} onClick={onAttention} />
        <StatCard className={statCardTop} label="已加载结果" value={stats.results} icon={<Images />} onClick={() => onTab("assets")} />
        <StatCard className={statCardTop} label="待审阅" value={reviewCount} tone={reviewCount > 0 ? "review" : "neutral"} icon={<Eye />} onClick={() => onTab("review")} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="连接" actions={<span className="text-meta text-muted">{stats.ready}/{stats.connections} 可读</span>} bodyClassName="p-0">
          {project.connections.length ? (
            <ul className="divide-y divide-line">
              {project.connections.map((connection) => (
                <li key={connection.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium">{connection.label}</span>
                    <span className="block truncate text-meta text-muted">{connection.environment} · {connection.instance_id}</span>
                  </span>
                  <Pill size="sm" tone={connectionTone(connection.state)}>{connectionStateLabel(connection.state)}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<Plug />} title="没有直接的连接配置" body="该项目只在任务中出现。" />
          )}
        </Panel>
        <Panel title="项目事实">
          <div className="p-5">
            <Facts
              columns={2}
              items={[
                { label: "Owner", value: ownerLabel(project.owner) },
                { label: "项目引用", value: <span className="font-mono text-xs">{project.project}</span> },
                { label: "本地名称", value: project.display_name.trim() || <Unknown>未设置</Unknown> },
                { label: "制作进度", value: <Unknown>owner 未提供</Unknown> },
              ]}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function TruncationNote({ shown, total, noun, onOpenAll }: { shown: number; total: number; noun: string; onOpenAll?: () => void }) {
  if (total <= shown) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-meta text-muted">
      <span>仅显示前 {shown} 条，共 {total} 条已加载{noun}。</span>
      {onOpenAll && <Button size="sm" variant="ghost" onClick={onOpenAll}>在任务中心查看全部</Button>}
    </div>
  );
}

function TasksTab({ project, selectedTaskKey, onSelect }: { project: OwnerProject; selectedTaskKey: string | null; onSelect: (taskKey: string) => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const text = params.get("taskQ") || "";
  const state = params.get("taskState") || "";
  const stage = params.get("taskStage") || "";
  const patch = (key: string, value: string) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const filtered = project.tasks.filter((task) => (!state || task.state === state) && (!stage || task.stage === stage) && (!text || `${task.title} ${task.locator.task_ref}`.toLocaleLowerCase().includes(text.toLocaleLowerCase())));
  const selectedIndex = selectedTaskKey ? filtered.findIndex((task) => task.task_key === selectedTaskKey) : -1;
  const start = selectedIndex >= listLimit ? Math.floor(selectedIndex / listLimit) * listLimit : 0;
  const rows = filtered.slice(start, start + listLimit);
  const columns: Column<TaskSnapshot>[] = [
    {
      id: "task",
      header: "任务",
      className: fillMainColumn,
      cell: (task) => (
        <span className="flex min-w-0 items-center gap-3">
          <KindBadge kind={taskKind(task)} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-medium text-ink">{task.title}</span>
            <span className="block truncate text-meta text-muted @2xl:hidden">{stageLabel(task.stage)} · {formatRelative(task.updated_at || task.created_at)}</span>
          </span>
        </span>
      ),
    },
    { id: "stage", header: "阶段", priority: 2, cell: (task) => <span className="whitespace-nowrap text-body-sm text-ink-soft">{stageLabel(task.stage)}</span> },
    {
      id: "updated",
      header: "更新",
      priority: 2,
      cell: (task) => <span className="tabular whitespace-nowrap text-meta text-muted" title={formatFullTime(task.updated_at || task.created_at)}>{formatRelative(task.updated_at || task.created_at)}</span>,
    },
    { id: "state", header: "状态", align: "end", cell: (task) => <TaskStatePill state={task.state} /> },
  ];
  return (
    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
        <SearchField value={text} onChange={(value) => patch("taskQ", value)} label="搜索项目任务" placeholder="任务名称或引用" className="w-full sm:w-56" />
        <Select aria-label="任务状态" value={state} onChange={(event) => patch("taskState", event.target.value)} className="w-32"><option value="">全部状态</option>{[...new Set(project.tasks.map((task) => task.state))].map((item) => <option key={item} value={item}>{taskStateLabels[item] || item}</option>)}</Select>
        <Select aria-label="任务阶段" value={stage} onChange={(event) => patch("taskStage", event.target.value)} className="w-32"><option value="">全部阶段</option>{[...new Set(project.tasks.map((task) => task.stage))].map((item) => <option key={item} value={item}>{taskStageLabels[item] || item}</option>)}</Select>
      </div>
      <DataTable
        label="项目任务"
        columns={columns}
        rows={rows}
        rowKey={(task) => task.task_key || `${task.locator.owner}:${task.locator.task_ref}`}
        rowAttributes={(task) => ({ "data-task": task.locator.task_ref })}
        rowLabel={(task) => `打开任务 ${task.title}`}
        selectedKey={selectedTaskKey}
        onRowClick={(task) => { if (task.task_key) onSelect(task.task_key); }}
        empty={<EmptyState compact icon={<ListTodo />} title={project.tasks.length ? "没有符合条件的任务" : "当前批次没有该项目的任务"} />}
      />
      <TruncationNote shown={rows.length} total={filtered.length} noun="任务" onOpenAll={() => navigate(tasksHref(project, undefined, { q: text, state, stage }))} />
    </Panel>
  );
}

function AssetsTab({ project, results, selectedKey, preview, onSelect, onClose, onPreview }: { project: OwnerProject; results: ResultEntry[]; selectedKey: string | null; preview: ReturnType<typeof useMediaPreview>; onSelect: (entry: ResultEntry) => void; onClose: () => void; onPreview: (entry: ResultEntry) => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const text = params.get("assetQ") || "";
  const kind = params.get("assetKind") || "";
  const patch = (key: string, value: string) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const player = useAudioPlayer();
  const resultHref = (entry: ResultEntry) => `/projects?catalog=owner&project=${encodeURIComponent(project.key)}&tab=assets&result=${encodeURIComponent(entry.key)}`;
  const filtered = results.filter((entry) => (!kind || entry.kind === kind) && (!text || `${entry.result.name || ""} ${entry.task.title}`.toLocaleLowerCase().includes(text.toLocaleLowerCase())));
  const audioQueue = filtered.filter((entry) => entry.kind === "audio" && resultAction(entry.task, "preview").enabled).map((entry) => audioTrackFrom(entry, resultHref(entry)));
  const handlePreview = (entry: ResultEntry) => {
    onSelect(entry);
    if (entry.kind === "audio") {
      player.play(audioTrackFrom(entry, resultHref(entry)), audioQueue);
      return;
    }
    onPreview(entry);
  };
  const selected = results.find((entry) => entry.key === selectedKey) || null;
  const selectedIndex = selected ? filtered.indexOf(selected) : -1;
  const start = selectedIndex >= listLimit ? Math.floor(selectedIndex / listLimit) * listLimit : 0;
  const rows = filtered.slice(start, start + listLimit);
  const step = (direction: -1 | 1) => { const next = filtered[selectedIndex + direction]; if (next) onSelect(next); };
  const columns: Column<ResultEntry>[] = [
    {
      id: "result",
      header: "结果",
      className: fillMainColumn,
      cell: (entry) => (
        <span className="flex min-w-0 items-center gap-3">
          <KindBadge kind={entry.kind} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-medium text-ink">{entry.result.name || "未命名结果"}</span>
            <span className="block truncate text-meta text-muted @2xl:hidden">{entry.task.title}</span>
          </span>
        </span>
      ),
    },
    { id: "kind", header: "类型", priority: 2, cell: (entry) => <span className="whitespace-nowrap text-body-sm text-ink-soft">{kindLabel(entry.kind)}</span> },
    { id: "task", header: "所属任务", priority: 2, cell: (entry) => <span className="block max-w-[260px] truncate text-body-sm text-ink-soft" title={entry.task.title}>{entry.task.title}</span> },
    { id: "spec", header: "规格", priority: 3, cell: (entry) => <span className="whitespace-nowrap text-meta text-muted">{resultMeta(entry.result).join(" · ") || <Unknown>未提供</Unknown>}</span> },
    { id: "access", header: "预览", align: "end", cell: (entry) => resultAction(entry.task, "preview").enabled ? <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); handlePreview(entry); }}>{entry.kind === "audio" ? "播放" : "预览"}</Button> : <span className="text-2xs text-warning">{resultAction(entry.task, "preview").reason || "未授权"}</span> },
  ];
  return (
    <AudioQueue tracks={audioQueue}><div className="space-y-3">
      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SearchField value={text} onChange={(value) => patch("assetQ", value)} label="搜索项目结果" placeholder="结果或任务名称" className="w-full sm:w-56" />
          <Select aria-label="结果类型" value={kind} onChange={(event) => patch("assetKind", event.target.value)} className="w-32"><option value="">全部类型</option>{["image", "video", "audio", "text"].map((item) => <option key={item} value={item}>{kindLabel(item as MediaKind)}</option>)}</Select>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigate(`/assets?project=${encodeURIComponent(project.project)}`)}>在资源库查看</Button>
        </div>
        <DataTable
          label="项目结果"
          columns={columns}
          rows={rows}
          rowKey={(entry) => entry.key}
          rowLabel={(entry) => `查看 ${entry.result.name || "未命名结果"}`}
          selectedKey={selected?.key || null}
          onRowClick={onSelect}
          empty={<EmptyState compact icon={<Images />} title={results.length ? "没有符合条件的结果" : "当前批次没有该项目的结果"} />}
        />
        <TruncationNote shown={rows.length} total={filtered.length} noun="结果" />
      </Panel>
      {selectedKey && !selected && <InlineNotice tone="warning">当前观察批次没有这个结果，未跳转资源库。</InlineNotice>}
      {selected && <Panel title={selected.result.name || "未命名结果"} actions={<div className="flex gap-1"><Button size="sm" variant="ghost" disabled={selectedIndex <= 0} onClick={() => step(-1)}>上一项</Button><Button size="sm" variant="ghost" disabled={selectedIndex < 0 || selectedIndex >= filtered.length - 1} onClick={() => step(1)}>下一项</Button><Button size="sm" variant="ghost" onClick={onClose}>关闭</Button></div>}>
        <div className="space-y-3 p-4"><AssetPreviewStage entry={selected} preview={preview} />{!resultAction(selected.task, "preview").enabled && <p className="text-xs text-warning">{resultAction(selected.task, "preview").reason || "未授权"}</p>}</div>
      </Panel>}
    </div></AudioQueue>
  );
}

function ReviewTab({ tasks }: { tasks: TaskSnapshot[] }) {
  const [params, setParams] = useSearchParams();
  const text = params.get("reviewQ") || "";
  const status = params.get("reviewStatus") || "";
  const patch = (key: string, value: string) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const rows = tasks.filter((task) => (!status || (task.provider_recovery?.review_status || "") === status) && (!text || task.title.toLocaleLowerCase().includes(text.toLocaleLowerCase())));
  const columns: Column<TaskSnapshot>[] = [
    {
      id: "task",
      header: "任务",
      className: fillMainColumn,
      cell: (task) => (
        <span className="block min-w-0">
          <span className="block truncate text-body-sm font-medium text-ink">{task.title}</span>
          <span className="block truncate text-meta text-muted">{stageLabel(task.stage)} · {formatRelative(task.updated_at || task.created_at)}</span>
        </span>
      ),
    },
    {
      id: "review",
      header: "审阅结论",
      cell: (task) => task.provider_recovery?.review_status ? <Pill size="sm" tone="review">{reviewStatusLabel(task.provider_recovery.review_status)}</Pill> : <Unknown>owner 未提供</Unknown>,
    },
    { id: "state", header: "任务状态", align: "end", cell: (task) => <TaskStatePill state={task.state} /> },
  ];
  return (
    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
        <SearchField value={text} onChange={(value) => patch("reviewQ", value)} label="搜索审阅任务" placeholder="任务名称" className="w-full sm:w-56" />
        <Select aria-label="审阅结论" value={status} onChange={(event) => patch("reviewStatus", event.target.value)} className="w-36"><option value="">全部结论</option>{[...new Set(tasks.map((task) => task.provider_recovery?.review_status).filter((item): item is string => !!item))].map((item) => <option key={item} value={item}>{reviewStatusLabel(item)}</option>)}</Select>
      </div>
      <DataTable
        label="待审阅任务"
        columns={columns}
        rows={rows}
        rowKey={(task) => task.task_key || `${task.locator.owner}:${task.locator.task_ref}`}
        empty={<EmptyState compact title={tasks.length ? "没有符合条件的审阅记录" : "没有审阅相关记录"} body="只有 owner 返回待审阅状态或审阅结论时才会出现。" />}
      />
    </Panel>
  );
}
