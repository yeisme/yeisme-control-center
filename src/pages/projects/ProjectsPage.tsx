import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Dialog } from "radix-ui";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Copy, Eye, FolderKanban, Images, ListTodo, MoreHorizontal, Pencil, Plug, Send } from "../../icons";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { useMediaPreview } from "../../components/media-preview";
import {
  Button,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DataTable,
  Dot,
  EmptyState,
  Facts,
  Field,
  IconButton,
  InlineNotice,
  Input,
  KindBadge,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  MetricStrip,
  NoticeStack,
  PageToolbar,
  Panel,
  Pill,
  ReadStateView,
  SkeletonRows,
  StaleNotice,
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
} from "../../components/ui";
import { api, type ProjectMetadata, type TaskConnectionState, type TaskSnapshot } from "../../shared/api/control-center-client";
import { runAction, type ActionRunState } from "../../shared/action-runner";
import { formatFullTime, formatRelative } from "../../shared/read-model/format";
import { labelFrom } from "../../shared/read-model/labels";
import { readErrorMessage } from "../../shared/read-model/read-state";
import { collectResults, connectionStateLabel, connectionTone, resultMeta, stageLabel, taskKind, type ResultEntry } from "../../shared/read-model/tasks";
import { taskNeedsReview } from "../../shared/read-model/review";
import { closeProjectTask, selectProjectTab, selectProjectTask } from "../../shared/read-model/project-navigation";
import { taskIsActive, taskNeedsAttention } from "../../task-observation";
import { TaskDetail, type TaskInspectorMode } from "../tasks/TaskDetail";
import SharedProjects from "./SharedProjects";

type Tab = "overview" | "tasks" | "assets" | "review" | "delivery";
type ProjectFilter = "all" | "hidden";
type ProjectAction = "open" | "rename" | "copy" | "tasks" | "toggle";
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
}

function ownerProjects(connections: TaskConnectionState[], rows: TaskSnapshot[], metadata: ProjectMetadata[]): OwnerProject[] {
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
  return [...map.values()].sort((a, b) => a.display_label.localeCompare(b.display_label) || a.owner.localeCompare(b.owner) || a.project.localeCompare(b.project));
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

function tasksHref(project: OwnerProject, view?: "attention") {
  return `/tasks?owner=${encodeURIComponent(project.owner)}&project=${encodeURIComponent(project.project)}${view ? `&view=${view}` : ""}`;
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

type MenuItemComponent = (props: { children: ReactNode; icon?: ReactNode; onSelect?: () => void }) => ReactNode;
type MenuSeparatorComponent = () => ReactNode;

function ProjectMenuItems({ project, onAction, Item, Separator }: { project: OwnerProject; onAction: (action: ProjectAction) => void; Item: MenuItemComponent; Separator: MenuSeparatorComponent }) {
  return (
    <>
      <Item icon={<FolderKanban />} onSelect={() => onAction("open")}>打开项目</Item>
      <Item icon={<Pencil />} onSelect={() => onAction("rename")}>重命名</Item>
      <Item icon={<Copy />} onSelect={() => onAction("copy")}>复制项目引用</Item>
      <Item icon={<ListTodo />} onSelect={() => onAction("tasks")}>查看项目任务</Item>
      <Separator />
      <Item icon={<Eye />} onSelect={() => onAction("toggle")}>{project.hidden ? "取消隐藏项目" : "隐藏项目"}</Item>
    </>
  );
}

function ProjectMenus({ project, onAction }: { project: OwnerProject; onAction: (action: ProjectAction) => void }) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton label={`项目操作：${projectTitle(project)}`} icon={<MoreHorizontal className="size-4" />} onClick={(event) => event.stopPropagation()} />
      </MenuTrigger>
      <MenuContent>
        <ProjectMenuItems project={project} onAction={onAction} Item={MenuItem} Separator={MenuSeparator} />
      </MenuContent>
    </MenuRoot>
  );
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

export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const organizations = useScopedRead((_s, signal) => api.organizations(signal));
  if (params.has("shared") || params.has("sharedProject") || (params.get("catalog") !== "owner" && !!organizations.data?.rows.length)) return <SharedProjects />;
  return <><div className="mb-3 flex justify-end"><Button size="sm" variant="secondary" onClick={() => setParams({ shared: "1" })}>共享项目与分配</Button></div><OwnerProjectsPage /></>;
}

function OwnerProjectsPage() {
  const { scope, scopeId, session } = useWorkspace();
  const tasks = useTasks();
  const notify = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const metadata = useScopedRead((currentScope, signal) => api.projectMetadata(currentScope, signal));
  const projects = useMemo(() => ownerProjects(tasks.connections, tasks.rows, metadata.data?.rows || []), [tasks.connections, tasks.rows, metadata.data?.rows]);
  const filter = (params.get("visibility") === "hidden" ? "hidden" : "all") as ProjectFilter;
  const visibleProjects = projects.filter((project) => (filter === "hidden" ? project.hidden : !project.hidden));
  const stats = useMemo(() => new Map(projects.map((project) => [project.key, projectStats(project)])), [projects]);
  const selected = projects.find((project) => project.key === params.get("project")) || null;
  const [renameTarget, setRenameTarget] = useState<OwnerProject | null>(null);
  const [actionState, setActionState] = useState<ActionRunState>({ phase: "idle", preview: null, receipt: null, error: null });

  const open = (key: string | null, nextTab: Tab = "overview") => {
    const next = new URLSearchParams(params);
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
    if (action === "rename") {
      setActionState({ phase: "idle", preview: null, receipt: null, error: null });
      setRenameTarget(project);
      return;
    }
    if (action === "copy") {
      try {
        await navigator.clipboard.writeText(project.key);
        notify("项目引用已复制", "success");
      } catch {
        notify("无法复制项目引用", "warning");
      }
      return;
    }
    await runMetadataAction(project, project.hidden ? "project.metadata.unhide" : "project.metadata.hide");
  }, [notify, runMetadataAction]);

  if (selected) {
    const rawTab = params.get("tab") as Tab | null;
    return (
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
      <h1 className="sr-only">项目</h1>
      <PageToolbar
        summary="owner 项目连接。计数仅含已加载的任务批次，不是 owner 全量统计；制作进度 owner 未提供。"
        actions={
          <ToggleGroup<ProjectFilter>
            label="项目可见性"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: "显示中", count: projects.length - hiddenCount },
              { id: "hidden", label: "已隐藏", count: hiddenCount },
            ]}
          />
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
          tasks.status === "stale" && <StaleNotice key="stale" status={tasks.status} error={tasks.error} observedAt={tasks.observedAt} onRetry={tasks.refresh} />,
          metadataUnavailable && <InlineNotice key="metadata" tone="warning">本地项目名称暂不可读，暂按项目引用显示。{readErrorMessage(metadata.error)}</InlineNotice>,
        ]}
      />
      <section aria-label="owner 项目">
        {tasks.status === "loading" && !projects.length ? (
          <Panel><SkeletonRows rows={3} /></Panel>
        ) : taskReadFailed ? (
          <Panel><ReadStateView status={tasks.status} error={tasks.error} onRetry={tasks.refresh} /></Panel>
        ) : visibleProjects.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<FolderKanban />}
              title={filter === "hidden" ? "当前范围没有已隐藏项目" : "当前范围没有项目连接"}
              body={filter === "hidden" ? "隐藏项目会保留在当前范围，可随时恢复。" : "服务端尚未为该范围绑定 owner 项目。"}
            />
          </Panel>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.map((project, index) => (
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
        )}
      </section>
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
      <ContextMenuRoot>
        <ContextMenuTrigger asChild>
          <article
            data-project={project.key}
            onClick={(event) => {
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
              <ProjectMenus project={project} onAction={onAction} />
            </header>
            <dl className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-control border border-line bg-panel-soft">
              <MiniStat label="进行中" value={stats.active} />
              <MiniStat label="需关注" value={stats.attention} warn={stats.attention > 0} />
              <MiniStat label="结果" value={stats.results} />
            </dl>
            <footer className="mt-auto flex items-center justify-between gap-2 text-meta text-muted">
              <ConnectionSummary project={project} />
              <ArrowRight className="size-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5" />
            </footer>
          </article>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ProjectMenuItems project={project} onAction={onAction} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
        </ContextMenuContent>
      </ContextMenuRoot>
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
    resolve: (key) => results.find((entry) => entry.key === key) || null,
    onPreviewKeyChange: (key, history) => {
      const next = new URLSearchParams(params);
      if (key) next.set("preview", key);
      else next.delete("preview");
      setParams(next, { replace: history === "replace" });
    },
  });
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
          <ProjectMenus project={project} onAction={onAction} />
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
          <AssetsTab results={results} onOpen={(entry) => navigate(`/assets?result=${encodeURIComponent(entry.key)}`)} />
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
  const rows = project.tasks.slice(0, listLimit);
  const columns: Column<TaskSnapshot>[] = [
    {
      id: "task",
      header: "任务",
      className: "w-full max-w-0",
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
      <DataTable
        label="项目任务"
        columns={columns}
        rows={rows}
        rowKey={(task) => task.task_key || `${task.locator.owner}:${task.locator.task_ref}`}
        rowAttributes={(task) => ({ "data-task": task.locator.task_ref })}
        rowLabel={(task) => `打开任务 ${task.title}`}
        selectedKey={selectedTaskKey}
        onRowClick={(task) => { if (task.task_key) onSelect(task.task_key); }}
        empty={<EmptyState compact icon={<ListTodo />} title="当前批次没有该项目的任务" />}
      />
      <TruncationNote shown={rows.length} total={project.tasks.length} noun="任务" onOpenAll={() => navigate(tasksHref(project))} />
    </Panel>
  );
}

function AssetsTab({ results, onOpen }: { results: ResultEntry[]; onOpen: (entry: ResultEntry) => void }) {
  const rows = results.slice(0, listLimit);
  const columns: Column<ResultEntry>[] = [
    {
      id: "result",
      header: "结果",
      className: "w-full max-w-0",
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
    { id: "open", header: <span className="sr-only">在资源库打开</span>, align: "end", cell: () => <ArrowRight className="ml-auto size-4 text-faint" /> },
  ];
  return (
    <Panel bodyClassName="p-0">
      <DataTable
        label="项目结果"
        columns={columns}
        rows={rows}
        rowKey={(entry) => entry.key}
        rowLabel={(entry) => `在资源库打开 ${entry.result.name || "未命名结果"}`}
        onRowClick={onOpen}
        empty={<EmptyState compact icon={<Images />} title="当前批次没有该项目的结果" />}
      />
      <TruncationNote shown={rows.length} total={results.length} noun="结果" />
    </Panel>
  );
}

function ReviewTab({ tasks }: { tasks: TaskSnapshot[] }) {
  const columns: Column<TaskSnapshot>[] = [
    {
      id: "task",
      header: "任务",
      className: "w-full max-w-0",
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
      <DataTable
        label="待审阅任务"
        columns={columns}
        rows={tasks}
        rowKey={(task) => task.task_key || `${task.locator.owner}:${task.locator.task_ref}`}
        empty={<EmptyState compact title="没有审阅相关记录" body="只有 owner 返回待审阅状态或审阅结论时才会出现。" />}
      />
    </Panel>
  );
}
