import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useTasks } from "../../app/tasks-context";
import { AudioQueue, audioTrackFrom, type AudioTrack } from "../../app/audio-player";
import { AudioMiniWave, AudioPlayButton } from "../../components/AudioDock";
import { ActionsContextMenu, ActionsMenu, Button, Dot, EmptyState, InlineNotice, KindBadge, Pill, ReadStateView, SkeletonRows, TabPanel, Tabs, TaskStatePill, cx, ownerLabel, type ItemAction, type MediaKind } from "../../components/ui";
import { ArrowLeft, ArrowRight, Clapperboard, FolderKanban, ListTodo, Play, Sparkles, UsersRound } from "../../icons";
import { projectRoleLabels, type ProjectItem, type SharedProject } from "../../shared/collaboration";
import { connectionStateLabel, connectionTone, resultAction } from "../../shared/read-model/tasks";
import { resultDisplayName, taskFamilyLabel } from "../../shared/read-model/labels";
import { formatRelative } from "../../shared/read-model/format";
import { taskNeedsReview } from "../../shared/read-model/review";
import { ProductionLineView } from "../drama/ProductionLine";
import { ProductionTimePanel } from "../drama/ProductionTime";
import { ItemThumbnail, ProjectFiles } from "../assets/ProjectFiles";
import { ProjectConnections } from "./ProjectConnections";
import { ProjectCollectionSource } from "./ProjectCollectionSource";

export type ProjectHomeTab = "overview" | "assets" | "production" | "tasks" | "connections" | "members";
export const projectHomeTabs: { id: ProjectHomeTab; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "assets", label: "资产" },
  { id: "production", label: "制作" },
  { id: "tasks", label: "任务" },
  { id: "connections", label: "连接" },
  { id: "members", label: "成员" },
];
export type ProjectForm = "members" | "bindings" | "rename" | "policy";

/** The three kinds a project's outputs are counted by, in the order a drama is made: picture, then motion, then sound. */
const outputKinds = ["video", "audio", "image"] as const;
type OutputKind = typeof outputKinds[number];
const kindWords: Record<OutputKind, string> = { video: "视频", audio: "音频", image: "图像" };
/** A local directory page holds at most this many rows; beyond it the count says 「100+」 rather than a guess. */
const countLimit = 100;

const itemKind = (item: ProjectItem) => item.mime.split("/")[0] as MediaKind;
const itemName = (item: ProjectItem) => resultDisplayName({ name: item.name, kind: itemKind(item), at: item.created_at });
/** The overview shows a row of images, not a wall: two rows of three on a phone, one row of eight on a wide screen. */
export const imageLimit = { phone: 6, desktop: 8 } as const;
const newestFirst = (rows: ProjectItem[]) => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

/**
 * One shared project as a home: what it has made, by kind, where its production stands, the tools it reads and who
 * works in it. Every count comes from the project's own directory; a count the directory could not finish says so.
 */
export function ProjectHome({ project, actions, onBack, onManage, onChanged }: {
  project: SharedProject;
  actions: ItemAction[];
  onBack: () => void;
  onManage: (form: ProjectForm) => void;
  onChanged: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { scopeId } = useWorkspace();
  const tasks = useTasks();
  const raw = params.get("tab") as ProjectHomeTab | null;
  const tab: ProjectHomeTab = raw && projectHomeTabs.some((item) => item.id === raw) ? raw : "overview";
  const select = (next: ProjectHomeTab, extra: Record<string, string> = {}) => setParams((current) => {
    const value = new URLSearchParams(current);
    for (const key of ["tab", "kind", "folder", "batch", "q", "owner", "cursor", "source_cursor"]) value.delete(key);
    if (next !== "overview") value.set("tab", next);
    for (const [key, item] of Object.entries(extra)) value.set(key, item);
    return value;
  });
  const inScope = scopeId === project.id;
  const owners = [...new Set(project.bindings.map((binding) => binding.owner))];
  const ownerState = (owner: string) => {
    const states = inScope ? tasks.connections.filter((connection) => connection.owner === owner) : [];
    return states.length ? states.every((connection) => connection.state === "ready") ? "ready" : states.find((connection) => connection.state !== "ready")!.state : "not_checked";
  };
  const viewer = project.role === "viewer";
  const generate = () => navigate(`/creation?sharedProject=${encodeURIComponent(project.id)}`);
  return <div className="space-y-5" data-project-home={project.id}>
    <ActionsContextMenu actions={actions}>
      <header className="relative overflow-hidden rounded-card border border-line/80 bg-panel px-4 pb-3.5 pt-3 shadow-panel sm:px-5 sm:pb-4" data-shared-project-header>
        <Button variant="ghost" size="sm" className="-ml-2" icon={<ArrowLeft className="size-4" />} onClick={onBack}>全部项目</Button>
        <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="min-w-0 flex-[1_1_16rem]">
            <h2 className="truncate font-display text-[22px] font-semibold leading-tight text-ink sm:text-[26px]">{project.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Pill size="sm">{projectRoleLabels[project.role]}</Pill>
              {owners.map((owner) => {
                const state = ownerState(owner);
                return <span key={owner} data-project-tool={owner} className="inline-flex h-6 items-center gap-1.5 rounded-chip border border-line bg-panel-sunken px-2 text-2xs font-medium text-ink-soft" title={connectionStateLabel(state)}>
                  <Dot tone={state === "not_checked" ? "neutral" : connectionTone(state)} />{ownerLabel(owner)}<span className="sr-only">：{connectionStateLabel(state)}</span>
                </span>;
              })}
              {!owners.length && <span className="text-2xs text-muted">还没有关联工具</span>}
              <span className="inline-flex items-center gap-1 text-2xs text-muted"><UsersRound className="size-3.5" />{project.grants.length} 项授权</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            <Button size="sm" variant="secondary" icon={<Clapperboard className="size-4" />} onClick={() => navigate(`/drama?sharedProject=${encodeURIComponent(project.id)}`)}>进入制作线</Button>
            <Button size="sm" variant="primary" icon={<Sparkles className="size-4" />} disabled={viewer || !project.bindings.length} title={viewer ? "查看者不能生成" : !project.bindings.length ? "先在「连接」里关联工具项目" : undefined} onClick={generate}>新建生成批次</Button>
            <span className="max-sm:ml-auto"><ActionsMenu actions={actions} label={`项目操作：${project.name}`} /></span>
          </div>
        </div>
      </header>
    </ActionsContextMenu>
    <Tabs<ProjectHomeTab> value={tab} onChange={(next) => select(next)} label="项目内容" listClassName="mb-4 [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] sm:[mask-image:none]" options={projectHomeTabs}>
      <TabPanel value="overview">{tab === "overview" && <ProjectOverview project={project} onKind={(kind) => select("assets", { kind })} onTab={select} />}</TabPanel>
      <TabPanel value="assets">{tab === "assets" && <ProjectFiles project={project} />}</TabPanel>
      <TabPanel value="production">{tab === "production" && <ProjectProduction project={project} />}</TabPanel>
      <TabPanel value="tasks">{tab === "tasks" && <ProjectTasks />}</TabPanel>
      <TabPanel value="connections">{tab === "connections" && <div className="space-y-5"><ProjectCollectionSource project={project} onChanged={onChanged} /><ProjectConnections project={project} onManage={() => onManage("bindings")} onChanged={onChanged} /></div>}</TabPanel>
      <TabPanel value="members">{tab === "members" && <ProjectMembers project={project} onManage={project.role === "project_admin" ? () => onManage("members") : undefined} />}</TabPanel>
    </Tabs>
  </div>;
}

/** The project's directory by kind: one read that brings the owners' newest results in, then one local count per kind. */
function useKindCounts(project: SharedProject) {
  const sync = useScopedRead((_s, signal) => api.projectItems(project.id, { limit: 1 }, signal), { key: project.id });
  const synced = sync.status !== "loading";
  const video = useScopedRead((_s, signal) => api.projectItems(project.id, { kind: "video", local: "1", limit: countLimit }, signal), { key: `${project.id}|video|${sync.observedAt}`, enabled: synced });
  const audio = useScopedRead((_s, signal) => api.projectItems(project.id, { kind: "audio", local: "1", limit: countLimit }, signal), { key: `${project.id}|audio|${sync.observedAt}`, enabled: synced });
  const image = useScopedRead((_s, signal) => api.projectItems(project.id, { kind: "image", local: "1", limit: countLimit }, signal), { key: `${project.id}|image|${sync.observedAt}`, enabled: synced });
  return { sync, reads: { video, audio, image } };
}

export function kindCountText(page: { total: number; coverage: string; rows: unknown[] } | null | undefined) {
  if (!page) return "—";
  return page.coverage === "complete" ? String(page.total) : `${page.rows.length}+`;
}

function ProjectOverview({ project, onKind, onTab }: { project: SharedProject; onKind: (kind: OutputKind) => void; onTab: (tab: ProjectHomeTab) => void }) {
  const { scopeId } = useWorkspace();
  const tasks = useTasks();
  const { sync, reads } = useKindCounts(project);
  const waiting = scopeId === project.id ? tasks.rows.filter(taskNeedsReview).length : 0;
  const running = scopeId === project.id ? tasks.rows.filter((task) => ["queued", "running", "pending", "created"].includes(task.state)).length : 0;
  const navigate = useNavigate();
  if (!project.bindings.length) return <EmptyState icon={<FolderKanban />} title="先给项目关联工具" body="关联 Eikona、Scaena、Sonora 等工具里的项目之后，这里会按视频、音频、图像列出它们生产的内容。" action={<Button onClick={() => onTab("connections")}>去关联工具</Button>} />;
  return <div className="space-y-5">
    <div className="grid grid-cols-3 gap-2 sm:gap-3" data-project-kind-counts>
      {outputKinds.map((kind) => {
        const read = reads[kind];
        return <button key={kind} type="button" data-kind-count={kind} onClick={() => onKind(kind)} className="group flex min-w-0 items-center gap-2 rounded-card border border-line/80 bg-panel px-3 py-3 text-left sm:gap-4 sm:px-4 sm:py-4 shadow-panel transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-line-strong motion-reduce:hover:translate-y-0">
          <span className="max-sm:hidden"><KindBadge kind={kind} size="lg" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-meta text-muted">{kindWords[kind]}</span>
            <span className="block font-display text-[28px] font-semibold leading-none text-ink tabular" data-count={kindCountText(read.data)}>{read.status === "loading" ? "…" : kindCountText(read.data)}</span>
          </span>
          <ArrowRight className="size-4 text-muted max-sm:hidden transition-transform duration-150 group-hover:translate-x-0.5" />
        </button>;
      })}
    </div>
    {(waiting > 0 || running > 0) && <div className="flex flex-wrap gap-2">
      {waiting > 0 && <Button size="sm" variant="secondary" onClick={() => navigate("/review")}>{waiting} 项待你挑选</Button>}
      {running > 0 && <Button size="sm" variant="ghost" onClick={() => onTab("tasks")}>{running} 项正在运行</Button>}
    </div>}
    {sync.data && sync.data.coverage !== "complete" && <InlineNotice tone="neutral">有工具这次没有读完，计数只含已读到的成果；没读到的不算作零。</InlineNotice>}
    {sync.status !== "loading" && sync.status !== "ready" && sync.status !== "empty" && sync.status !== "stale" && <ReadStateView status={sync.status} error={sync.error} onRetry={sync.reload}><span /></ReadStateView>}
    <RecentVideos project={project} rows={newestFirst(reads.video.data?.rows || []).slice(0, 6)} loading={reads.video.status === "loading"} onMore={() => onKind("video")} />
    <RecentAudio project={project} rows={newestFirst(reads.audio.data?.rows || []).slice(0, 6)} loading={reads.audio.status === "loading"} onMore={() => onKind("audio")} />
    <RecentImages project={project} rows={newestFirst(reads.image.data?.rows || []).slice(0, imageLimit.desktop)} loading={reads.image.status === "loading"} onMore={() => onKind("image")} />
  </div>;
}

/** A section's title and its way to everything, on one line: the link sits on the title's center, not below it. */
function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="flex min-h-8 items-center justify-between gap-2">
    <h3 className="text-body-sm font-semibold text-ink">{title}</h3>
    {action}
  </div>;
}

function Shelf({ title, count, onMore, children, kind }: { title: string; count: number; onMore: () => void; children: ReactNode; kind: OutputKind }) {
  return <section aria-label={`最近的${title}`} data-recent={kind} className="space-y-2.5">
    <SectionHeader title={`最近的${title}`} action={count > 0 ? <Button size="sm" variant="ghost" className="-mr-2" onClick={onMore}>全部{title}<ArrowRight className="size-3.5" /></Button> : undefined} />
    {children}
  </section>;
}

function RecentVideos({ project, rows, loading, onMore }: { project: SharedProject; rows: ProjectItem[]; loading: boolean; onMore: () => void }) {
  return <Shelf title="视频" kind="video" count={rows.length} onMore={onMore}>
    {loading ? <SkeletonRows rows={1} /> : rows.length ? <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
      {rows.map((item) => <li key={item.id} className="w-[min(260px,70vw)] shrink-0 snap-start">
        <button type="button" onClick={onMore} aria-label={`查看视频 ${itemName(item)}`} className="group block w-full text-left">
          <span className="relative block aspect-video overflow-hidden rounded-tile border border-line/70 bg-panel-sunken">
            <ItemThumbnail project={project.id} item={item} />
            <span aria-hidden="true" className="absolute inset-0 grid place-items-center"><span className="grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-transform duration-150 group-hover:scale-105"><Play className="ml-0.5 size-4" fill="currentColor" /></span></span>
          </span>
          <span className="mt-1.5 block truncate text-body-sm font-medium text-ink">{itemName(item)}</span>
          <span className="block truncate text-2xs text-muted">{ownerLabel(item.owner)} · {formatRelative(item.created_at)}</span>
        </button>
      </li>)}
    </ul> : <p className="rounded-card border border-dashed border-line px-4 py-5 text-body-sm text-muted">还没有读到视频。</p>}
  </Shelf>;
}

function RecentImages({ project, rows, loading, onMore }: { project: SharedProject; rows: ProjectItem[]; loading: boolean; onMore: () => void }) {
  return <Shelf title="图像" kind="image" count={rows.length} onMore={onMore}>
    {loading ? <SkeletonRows rows={1} /> : rows.length ? <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 xl:grid-cols-8">
      {rows.map((item, index) => <li key={item.id} className={index >= imageLimit.phone ? "max-sm:hidden" : undefined}>
        <button type="button" onClick={onMore} aria-label={`查看图像 ${itemName(item)}`} className="block aspect-square w-full overflow-hidden rounded-tile border border-line/70 bg-panel-sunken transition-transform duration-150 hover:-translate-y-px motion-reduce:hover:translate-y-0">
          <ItemThumbnail project={project.id} item={item} />
        </button>
      </li>)}
    </ul> : <p className="rounded-card border border-dashed border-line px-4 py-5 text-body-sm text-muted">还没有读到图像。</p>}
  </Shelf>;
}

/** Audio rows play in place, one after another; each row reads its own task so the player gets a short-lived handle. */
function RecentAudio({ project, rows, loading, onMore }: { project: SharedProject; rows: ProjectItem[]; loading: boolean; onMore: () => void }) {
  const [tracks, setTracks] = useState<Record<string, AudioTrack>>({});
  useEffect(() => { setTracks({}); }, [project.id]);
  const queue = useMemo(() => rows.map((row) => tracks[row.id]).filter((track): track is AudioTrack => !!track), [rows, tracks]);
  return <Shelf title="音频" kind="audio" count={rows.length} onMore={onMore}>
    {loading ? <SkeletonRows rows={2} /> : rows.length ? <AudioQueue tracks={queue}>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line/80 bg-panel shadow-panel">
        {rows.map((item) => <AudioRow key={item.id} project={project} item={item} onTrack={(track) => setTracks((current) => current[item.id] === track ? current : { ...current, [item.id]: track })} />)}
      </ul>
    </AudioQueue> : <p className="rounded-card border border-dashed border-line px-4 py-5 text-body-sm text-muted">还没有读到音频。</p>}
  </Shelf>;
}

function AudioRow({ project, item, onTrack }: { project: SharedProject; item: ProjectItem; onTrack: (track: AudioTrack) => void }) {
  const task = useScopedRead((_s, signal) => api.projectItemTask(project.id, item.id, signal), { key: item.id });
  const artifact = task.data?.results.find((result) => result.ref === item.artifact_ref);
  const access = task.data ? resultAction(task.data, "preview") : null;
  const track = useMemo(() => task.data && artifact && access?.enabled ? audioTrackFrom({ key: item.id, task: task.data, result: artifact, kind: "audio" }, `/projects?sharedProject=${encodeURIComponent(project.id)}&tab=assets&kind=audio`) : null, [task.data, artifact, access?.enabled, item.id, project.id]);
  useEffect(() => { if (track) onTrack(track); }, [track]);
  const name = task.data ? resultDisplayName({ name: item.name, family: task.data.locator.task_family, kind: "audio", title: task.data.title, at: task.data.updated_at || item.created_at }) : itemName(item);
  return <li className="flex min-w-0 items-center gap-3 px-3 py-2.5" data-audio-row={item.id}>
    {track ? <AudioPlayButton track={track} iconOnly /> : <span className="grid size-8 shrink-0 place-items-center"><KindBadge kind="audio" size="sm" /></span>}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-body-sm font-medium text-ink">{name}</span>
      <span className="block truncate text-2xs text-muted">{ownerLabel(item.owner)}{task.data ? ` · ${taskFamilyLabel(task.data.locator.task_family)}` : ""} · {formatRelative(item.created_at)}{access && !access.enabled ? " · 未授权播放" : ""}</span>
    </span>
    <AudioMiniWave trackKey={item.id} bare durationMs={artifact?.duration_ms} className="hidden w-40 shrink-0 sm:flex" />
  </li>;
}

function ProjectProduction({ project }: { project: SharedProject }) {
  const { scopeId } = useWorkspace();
  const tasks = useTasks();
  const navigate = useNavigate();
  const production = useScopedRead((id, signal) => api.production(id, {}, signal), { key: project.id, enabled: scopeId === project.id });
  const dramaLink = `/drama?sharedProject=${encodeURIComponent(project.id)}`;
  if (scopeId !== project.id) return <SkeletonRows rows={3} />;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <p className="max-w-xl text-body-sm text-muted">这个项目的全部任务按七站排开。每一集自己的制作线和镜头板在「剧集」里。</p>
      <Button size="sm" variant="secondary" icon={<Clapperboard className="size-4" />} onClick={() => navigate(dramaLink)}>打开剧集</Button>
    </div>
    <ReadStateView status={production.status} error={production.error} onRetry={production.reload} skeleton={<SkeletonRows rows={3} />}>
      {production.data && <div className="space-y-4">
        <ProductionLineView line={production.data} tasks={tasks.rows} compact onHandOff={() => navigate(dramaLink)} onOpenResult={(key) => navigate(`/assets?result=${encodeURIComponent(key)}`)} onNavigate={navigate} />
        <ProductionTimePanel line={production.data} onOpenEpisode={(ref) => navigate(`${dramaLink}&studio=${encodeURIComponent(ref)}`)} />
      </div>}
    </ReadStateView>
  </div>;
}

function ProjectTasks() {
  const tasks = useTasks();
  const navigate = useNavigate();
  const rows = [...tasks.rows].sort((a, b) => (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "")).slice(0, 30);
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-body-sm text-muted">{tasks.rows.length ? `最近 ${rows.length} 项任务${tasks.rows.length > rows.length ? `（共读到 ${tasks.rows.length} 项）` : ""}` : "这个项目的任务"}</p>
      <Button size="sm" variant="ghost" icon={<ListTodo className="size-4" />} onClick={() => navigate("/tasks")}>在任务中心打开</Button>
    </div>
    <ReadStateView status={tasks.status} error={tasks.error} onRetry={tasks.refresh} skeleton={<SkeletonRows rows={4} />}>
      {rows.length ? <ul className="divide-y divide-line overflow-hidden rounded-card border border-line/80 bg-panel shadow-panel">
        {rows.map((task) => <li key={task.task_key}>
          <button type="button" data-project-task={task.task_key} onClick={() => navigate(`/tasks?task=${encodeURIComponent(task.task_key || "")}`)} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-panel-sunken">
            <TaskStatePill state={task.state} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-medium text-ink">{task.title}</span>
              <span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} · {taskFamilyLabel(task.locator.task_family)}</span>
            </span>
            <span className="shrink-0 text-2xs text-muted tabular">{formatRelative(task.updated_at || task.created_at)}</span>
          </button>
        </li>)}
      </ul> : <EmptyState compact icon={<ListTodo />} title="还没有任务" body="关联的工具里一有任务，就会出现在这里。" />}
    </ReadStateView>
  </div>;
}

function ProjectMembers({ project, onManage }: { project: SharedProject; onManage?: () => void }) {
  const members = useScopedRead((_s, signal) => api.collaborationMembers(project.organization_id, signal), { key: project.organization_id });
  const teams = useScopedRead((_s, signal) => api.collaborationTeams(project.organization_id, signal), { key: project.organization_id });
  const nameOf = (type: string, id: string) => type === "team" ? `${teams.data?.rows.find((team) => team.id === id)?.name || id}（团队）` : members.data?.rows.find((member) => member.id === id)?.name || id;
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-body-sm text-muted">团队和个人的授权取并集；工具自己的权限另行核验。</p>
      {onManage && <Button size="sm" variant="secondary" icon={<UsersRound className="size-4" />} onClick={onManage}>分配项目</Button>}
    </div>
    {project.grants.length ? <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {project.grants.map((grant) => {
        const name = nameOf(grant.subject_type, grant.subject_id);
        return <li key={`${grant.subject_type}:${grant.subject_id}`} className="flex min-w-0 items-center gap-3 rounded-card border border-line/80 bg-panel px-3 py-2.5">
          <span aria-hidden="true" className={cx("grid size-9 shrink-0 place-items-center rounded-full text-body-sm font-semibold", grant.subject_type === "team" ? "bg-kind-video-soft text-kind-video" : "bg-kind-audio-soft text-kind-audio")}>{name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-ink">{name}</span>
          <Pill size="sm">{projectRoleLabels[grant.role]}</Pill>
        </li>;
      })}
    </ul> : <EmptyState compact icon={<UsersRound />} title="只有你" body="把项目分配给组织里的成员或团队，他们就能在自己的控制中心里看到它。" />}
  </div>;
}

