import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  AudioLines,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  Cpu,
  Clock3,
  FolderKanban,
  Image,
  Images,
  LayoutDashboard,
  List,
  ListTodo,
  LoaderCircle,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  Sparkles,
  Sun,
  UsersRound,
  Video,
  Wallet,
  X,
} from "../icons";
import { accessTaskArtifact, loginWorkspace, readLiveTask, readLiveWorkspace, readProviderRun, readWorkspaceAuthMethods, readWorkspaceSession, type ProviderRunProjection, type ServiceConnectionObservation, type ServiceDirectoryEntry, type WorkspaceSession } from "../shared/api/control-center-client";
import { CapabilityHub } from "../pages/capabilities/CapabilityHub";
import { UsageAnalytics } from "../pages/usage/UsageAnalytics";
import type { AssetGroup, AssetKind, CapabilityCard, CreationTask, ProjectTab, TaskStatus, UsageFact, CapabilityRecord, WorkspacePage, WorkspaceProject, DeliveryPackage, ReviewDecision } from "../shared/types";
import { workspaceRouteManifest, projectTabManifest } from "../app-shell/navigation";
import { AppShell, type ShellSearchResult } from "../app-shell/AppShell";
import "../styles/app.css";

const workspaceIcons = { home: LayoutDashboard, projects: FolderKanban, creation: Sparkles, assets: Images, tasks: ListTodo, review: ClipboardCheck, capabilities: Cpu, usage: Wallet, team: UsersRound };
const navItems: { id: WorkspacePage; label: string; group: string; icon: typeof LayoutDashboard }[] = workspaceRouteManifest
  .filter((item) => item.id !== "team")
  .map((item) => ({ ...item, icon: workspaceIcons[item.id as keyof typeof workspaceIcons] || ListTodo }));

const statusMeta: Record<TaskStatus, { label: string; tone: string; icon: typeof Clock3 }> = {
  queued: { label: "排队中", tone: "neutral", icon: Clock3 },
  running: { label: "运行中", tone: "info", icon: LoaderCircle },
  succeeded: { label: "已完成", tone: "success", icon: CheckCircle2 },
  failed: { label: "失败", tone: "danger", icon: CircleAlert },
  unknown: { label: "结果未知", tone: "warning", icon: CircleAlert },
  waiting_review: { label: "待审阅", tone: "review", icon: ClipboardCheck },
};

const kindMeta: Record<AssetKind, { label: string; icon: typeof Image; tone: string }> = {
  image: { label: "图像", icon: Image, tone: "sage" },
  audio: { label: "音频", icon: AudioLines, tone: "violet" },
  video: { label: "视频", icon: Video, tone: "blue" },
  text: { label: "文本", icon: List, tone: "amber" },
};

const creationFields: Record<string, { key: string; label: string; type: "text" | "select" | "textarea" | "toggle"; options?: string[]; required?: boolean }[]> = {
  image: [
    { key: "prompt", label: "创作提示", type: "textarea", required: true },
    { key: "aspect", label: "画幅与方向", type: "select", options: ["9:16 竖屏", "16:9 横屏", "1:1 方形"], required: true },
    { key: "count", label: "候选数量", type: "select", options: ["2 个候选", "4 个候选"], required: true },
    { key: "referenceStrength", label: "参考强度", type: "select", options: ["轻微", "平衡", "严格"] },
    { key: "style", label: "构图／风格预设", type: "select", options: ["电影写实", "概念设计", "平面插画"] },
    { key: "seedLock", label: "固定种子", type: "toggle" },
  ],
  voice: [
    { key: "script", label: "文本／台词", type: "textarea", required: true },
    { key: "language", label: "语言", type: "select", options: ["中文普通话", "英语", "日语"], required: true },
    { key: "voice", label: "声线", type: "select", options: ["林舟 · 温和女声", "旁白 · 低沉男声"] },
    { key: "emotion", label: "情绪", type: "select", options: ["自然", "克制", "紧张", "温柔"] },
    { key: "speed", label: "语速", type: "select", options: ["0.9x", "1.0x", "1.1x"] },
  ],
  video: [
    { key: "prompt", label: "创作提示", type: "textarea", required: true },
    { key: "aspect", label: "画幅", type: "select", options: ["9:16 竖屏", "16:9 横屏", "1:1 方形"], required: true },
    { key: "duration", label: "时长", type: "select", options: ["4 秒", "6 秒", "8 秒"], required: true },
    { key: "camera", label: "镜头运动", type: "select", options: ["固定机位", "缓慢推进", "手持跟拍", "环绕" ] },
    { key: "motion", label: "运动强度", type: "select", options: ["轻", "中", "强"] },
    { key: "endReference", label: "结束参考图", type: "text" },
  ],
  script: [
    { key: "goal", label: "创作目标", type: "select", options: ["项目简介", "对白润色", "分镜描述", "宣传文案"], required: true },
    { key: "template", label: "模板", type: "select", options: ["电影项目卡", "三幕结构", "短视频标题" ] },
    { key: "tone", label: "语气", type: "select", options: ["克制专业", "情绪化", "轻松口语" ] },
    { key: "length", label: "长度", type: "select", options: ["短", "中", "长"] },
    { key: "output", label: "输出结构", type: "select", options: ["纯文本", "Markdown", "JSON 摘要"] },
  ],
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return <span className={`v18-status v18-status-${meta.tone}`}><Icon size={13} />{meta.label}</span>;
}

function KindIcon({ kind }: { kind: AssetKind }) {
  const meta = kindMeta[kind];
  const Icon = meta.icon;
  return <span className={`v18-kind-icon v18-kind-${meta.tone}`}><Icon size={18} /></span>;
}

function Progress({ value }: { value: number }) {
  return <div className="v18-progress" aria-label={`完成度 ${value}%`}><span style={{ width: `${value}%` }} /></div>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="v18-empty"><div className="v18-empty-mark"><Sparkles size={20} /></div><strong>{title}</strong><p>{body}</p>{action}</div>;
}

function liveTaskStatus(value: string): TaskStatus {
  if (["queued", "accepted", "pending"].includes(value)) return "queued";
  if (["running", "processing", "started"].includes(value)) return "running";
  if (["succeeded", "completed", "handoff_ready", "dry_run"].includes(value)) return "succeeded";
  if (["waiting_review"].includes(value)) return "waiting_review";
  if (["failed", "rejected", "cancelled", "canceled"].includes(value)) return "failed";
  return "unknown";
}

function liveCapabilityCard(row: any) {
  const modality = row.modality === "video" ? "video" : row.modality === "audio" ? "audio" : row.modality === "image" ? "image" : "text";
  return { id: row.id || `${row.owner}:${row.model_ref || row.name}`, label: row.name || row.model_ref || row.owner, description: row.state === "needs_configuration" ? "已登记，等待凭据或下游就绪" : row.state === "needs_contract" ? "下游能力合同尚未提供" : "Provider 能力目录已发现", kind: modality, owner: row.owner, accent: modality === "video" ? "blue" : modality === "audio" ? "violet" : modality === "image" ? "sage" : "amber" } as const;
}

function liveProjects(session: WorkspaceSession | null, selectedScopeId?: string) {
  return (session?.scopes || []).filter((scope) => !selectedScopeId || scope.id === selectedScopeId).map((scope) => ({
    id: scope.project || scope.id,
    name: scope.label || scope.project || scope.id,
    type: "授权项目",
    owner: session?.name || "当前用户",
    updated: "最近观察未知",
    progress: 0,
    units: [],
    members: [session?.name || "当前用户"],
  }));
}

function liveTasks(rows: any[]): CreationTask[] {
  return rows.map((task) => ({
    id: task.locator?.task_ref || task.task_key || task.title,
    title: task.title || task.locator?.task_ref || "未命名任务",
    capability: `${task.locator?.owner || "owner"} · ${task.locator?.task_family || "未提供模态"}`,
    projectId: task.locator?.project || "unknown",
    unitId: task.episode_ref || "未提供",
    status: liveTaskStatus(task.state),
    createdBy: task.actor || task.locator?.owner || "未知",
    updated: task.updated_at || task.observed_at || task.created_at || "未知",
    stage: task.stage || task.native_state || "执行阶段未提供",
    source: "live_projection",
    completeness: task.coverage === "complete" ? "complete" : task.coverage === "partial" ? "partial" : "unknown",
    resultAssetIds: (task.results || []).map((result: any) => `${task.locator?.task_ref || task.task_key}:${result.ref}`),
  }));
}

function liveAssets(rows: any[]): AssetGroup[] {
  return rows.flatMap((task) => (task.results || []).map((result: any) => {
    const mime = String(result.mime || "");
    const kind: AssetKind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : "text";
    const assetId = `${task.locator?.task_ref || task.task_key}:${result.ref}`;
    return {
      id: assetId,
      name: result.name || result.ref || "未命名结果",
      kind,
      projectId: task.locator?.project || "unknown",
      unitId: task.episode_ref || "未提供",
      rights: "来源合同支持内容读取；预览和下载仍需逐结果独立授权。",
      source: `${task.locator?.owner || "owner"} · ${task.locator?.task_ref || task.task_key || "未知任务"}`,
      versions: [{ id: result.ref, version: "artifact", label: result.name || result.ref || "artifact", state: "candidate", review: "pending", created: task.created_at || "未知", sourceTaskId: task.locator?.task_ref || task.task_key || "unknown", note: result.state || "来源未提供可预览媒体", contentState: "unknown", downloadable: false, downloadReason: "当前来源未提供可预览媒体" }],
    };
  }));
}

function liveUsage(rows: any[]): UsageFact[] {
  return rows.map((row: any, index) => ({
    id: row.source_ref || `usage-live-${index}`,
    createdAt: row.created_at || new Date(0).toISOString(),
    projectId: row.project_ref || "unknown",
    projectName: row.project_ref || "未知项目",
    member: row.owner || "未知",
    provider: row.owner || "未知",
    model: row.model_ref || "未知模型",
    modality: row.modality === "image" ? "图像" : row.modality === "video" ? "视频" : row.modality === "audio" ? "音频" : "未知",
    traceRef: row.trace_ref || "未知",
    sourceRef: row.source_ref || `unknown:${index}`,
    quantity: row.quantity ?? null,
    unit: row.unit || "未知",
    upstreamCost: row.upstream_cost ?? null,
    currency: row.currency === "USD" ? "USD" : "CNY",
    costState: ["confirmed", "estimated", "pending", "unknown"].includes(row.cost_state) ? row.cost_state : "unknown",
    status: row.status === "succeeded" || row.status === "failed" || row.status === "pending" ? row.status : "unknown",
    durationMs: row.duration_ms ?? null,
  }));
}

function normalizeWorkspacePath(path: string): WorkspacePage {
  const aliases: Record<string, WorkspacePage> = {
    "": "home",
    overview: "home",
    requests: "tasks",
    history: "tasks",
    provider_usage: "usage",
    services: "capabilities",
    members: "team",
    settings: "team",
    audit: "team",
    approvals: "review",
  };
  return aliases[path] || (navItems.some((item) => item.id === path) ? path as WorkspacePage : "home");
}

export function App() {
  const liveMode = true;
  const routerLocation = useLocation();
  const routerNavigate = useNavigate();
  const rawPath = routerLocation.pathname.replace(/^\//, "").split("/")[0] || "";
  const initialProjectRoute = (() => { const params = new URLSearchParams(routerLocation.search); return { id: params.get("project") || "unknown", tab: (params.get("tab") as ProjectTab) || "overview" }; })();
  const initialPage = normalizeWorkspacePath(rawPath);
  const [page, setPage] = useState<WorkspacePage>(initialPage);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("yeisme.v18.theme") === "dark");
  const [projectId, setProjectId] = useState(initialProjectRoute.id);
  const [projectDetail, setProjectDetail] = useState(Boolean(new URLSearchParams(routerLocation.search).get("project")));
  const [projectTab, setProjectTab] = useState<ProjectTab>(initialProjectRoute.tab);
  const [projectView, setProjectView] = useState<"grid" | "list">("grid");
  const [unitId, setUnitId] = useState("shot-03");
  const [projectsState, setProjectsState] = useState<WorkspaceProject[]>([]);
  const [capabilityCards, setCapabilityCards] = useState<CapabilityCard[]>([]);
  const [tasks, setTasks] = useState<CreationTask[]>([]);
  const [assets, setAssets] = useState<AssetGroup[]>([]);
  const [reviews, setReviews] = useState<ReviewDecision[]>([]);
  const [delivery, setDelivery] = useState<DeliveryPackage>({ id: "live", projectId: "", state: "missing", items: [] });
  const [capabilityCatalog, setCapabilityCatalog] = useState<CapabilityRecord[]>([]);
  const [services, setServices] = useState<ServiceDirectoryEntry[]>([]);
  const [connections, setConnections] = useState<ServiceConnectionObservation[]>([]);
  const [usage, setUsage] = useState<UsageFact[]>([]);
  const [apiState, setApiState] = useState<"loading" | "ready" | "offline">("loading");
  const [authState, setAuthState] = useState<"loading" | "login_required" | "forbidden" | "offline" | "ready">("loading");
  const [keyRequired, setKeyRequired] = useState(false);
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [scopeId, setScopeId] = useState("");
  const [loginError, setLoginError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedCapability, setSelectedCapability] = useState("image");
  const [reviewVersion, setReviewVersion] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<AssetKind | "all">("all");
  const [taskView, setTaskView] = useState<"all" | "running" | "history">(rawPath === "requests" ? "running" : rawPath === "history" ? "history" : "all");
  const [activeRun, setActiveRun] = useState<ProviderRunProjection | null>(null);
  const [runConnection, setRunConnection] = useState<"idle" | "sse" | "polling" | "closed">("idle");

  const applyLiveState = (state: Awaited<ReturnType<typeof readLiveWorkspace>>) => {
    const mappedTasks = liveTasks(state.tasks);
    const cards = state.capabilities.map(liveCapabilityCard);
    setCapabilityCards(cards);
    setSelectedCapability(cards[0]?.id || "");
    setCapabilityCatalog(state.capabilities.map((row: any) => ({
      id: row.id || `${row.owner}:${row.model_ref || row.name}`,
      category: row.kind === "mcp" || row.kind === "tool" ? row.kind : "model",
      name: row.name || row.model_ref || row.owner,
      description: row.description || "来源未提供描述",
      provider: row.provider || row.owner || "未知",
      version: row.version || "未知",
      modelRef: row.model_ref || row.name || "未知",
      modalities: row.modality ? [row.modality] : [],
      constraints: row.constraints ? Object.entries(row.constraints).map(([key, value]) => `${key}: ${String(value)}`) : [],
      metering: row.metering || "未知",
      readiness: row.state === "configured" ? "authorized" : row.state === "needs_contract" ? "needs_contract" : "configured",
      readinessLabel: row.state === "configured" ? "能力已发现" : row.state === "needs_contract" ? "待合同" : "待配置",
      accent: row.modality === "video" ? "blue" : row.modality === "audio" ? "violet" : "sage",
      owner: row.owner || "未知",
      successRate: row.quality?.success_rate ?? null,
      latencyMs: row.quality?.latency_ms ?? null,
      observedAt: row.observed_at || null,
      relatedProjects: row.project_refs || [],
      toolCount: Array.isArray(row.tools) ? row.tools.length : undefined,
    })));
    setTasks(mappedTasks);
    setAssets(liveAssets(state.tasks));
    setUsage(liveUsage(state.usage));
    setServices(state.services);
    setConnections(state.connections);
    setReviews([]);
    setDelivery({ id: "live", projectId: "", state: "missing", items: [] });
    setApiState("ready");
  };

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("yeisme.v18.theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const controller = new AbortController();
    readWorkspaceAuthMethods(controller.signal).then((value) => setKeyRequired(value.key_required === true)).catch(() => {});
    readWorkspaceSession(controller.signal).then((value) => {
      setSession(value);
      const initialScope = value.scopes[0]?.id || "";
      setScopeId(initialScope);
      setProjectsState(liveProjects(value, initialScope));
      setAuthState("ready");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      const code = error instanceof Error ? error.message : "control_center_unavailable";
      if (code === "login_required") setAuthState("login_required");
      else if (code.includes("forbidden")) setAuthState("forbidden");
      else setAuthState("offline");
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const nextPage = normalizeWorkspacePath(rawPath);
    setPage(nextPage);
    const params = new URLSearchParams(routerLocation.search);
    if (nextPage === "projects") {
      setProjectDetail(Boolean(params.get("project")));
      setProjectId(params.get("project") || "unknown");
      setProjectTab((params.get("tab") as ProjectTab) || "overview");
    } else {
      setProjectDetail(false);
    }
    if (rawPath === "requests" || rawPath === "history") setTaskView(rawPath === "requests" ? "running" : "history");
  }, [rawPath, routerLocation.search]);

  useEffect(() => {
    if (!session || !scopeId) return;
    const controller = new AbortController();
    setApiState("loading");
    setProjectsState(liveProjects(session, scopeId));
    readLiveWorkspace(scopeId, controller.signal).then(applyLiveState).catch(() => {
      if (!controller.signal.aborted) setApiState("offline");
    });
    return () => controller.abort();
  }, [session, scopeId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const fallbackProject = { id: "unknown", name: "当前授权范围", type: "范围未提供", owner: session?.name || "未知", updated: "未知", progress: 0, units: [], members: session?.name ? [session.name] : [] };
  const project = projectsState.find((item) => item.id === projectId) || projectsState[0] || fallbackProject;
  const visibleAssets = useMemo(() => assets.filter((asset) => {
      const matchesProject = asset.projectId === projectId || page === "assets";
    const matchesKind = filterKind === "all" || asset.kind === filterKind;
    const matchesSearch = !search || `${asset.name} ${asset.source}`.toLowerCase().includes(search.toLowerCase());
    return matchesProject && matchesKind && matchesSearch;
  }), [assets, filterKind, page, projectId, search]);
  const activeTask = tasks.find((task) => task.id === selectedTask);
  const activeAsset = assets.find((asset) => asset.id === selectedAsset);
  const adoptedCount = assets.filter((asset) => asset.versions.some((version) => version.state === "adopted")).length;
  const pendingReviews = reviews.filter((review) => review.state === "pending").length;
  const searchResults = useMemo<ShellSearchResult[]>(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const results: ShellSearchResult[] = [];
    workspaceRouteManifest.filter((item) => item.id !== "team").forEach((item) => {
      if (`${item.label} ${item.prompt}`.toLowerCase().includes(query)) results.push({ id: item.id, label: item.label, meta: `页面 · ${item.prompt}`, page: item.id });
    });
    projectsState.forEach((item) => {
      if (`${item.name} ${item.owner}`.toLowerCase().includes(query)) results.push({ id: item.id, label: item.name, meta: `${item.type} · ${item.owner}`, page: "projects" });
    });
    tasks.forEach((item) => {
      if (`${item.title} ${item.capability} ${item.id}`.toLowerCase().includes(query)) results.push({ id: item.id, label: item.title, meta: `任务 · ${item.capability}`, page: "tasks" });
    });
    assets.forEach((item) => {
      if (`${item.name} ${item.source} ${item.id}`.toLowerCase().includes(query)) results.push({ id: item.id, label: item.name, meta: `资源 · ${item.source}`, page: "assets" });
    });
    capabilityCatalog.forEach((item) => {
      if (`${item.name} ${item.provider} ${item.owner}`.toLowerCase().includes(query)) results.push({ id: item.id, label: item.name, meta: `能力 · ${item.provider}`, page: "capabilities" });
    });
    return results.slice(0, 8);
  }, [assets, capabilityCatalog, projectsState, search, tasks]);

  const notify = (message: string) => setToast(message);
  const navigate = (next: WorkspacePage) => {
    setPage(next);
    setMobileNav(false);
    setProjectDetail(false);
    setSelectedAsset(null);
    setSelectedTask(null);
    routerNavigate(next === "home" ? "/" : `/${next}`);
  };

  const selectSearchResult = (result: ShellSearchResult) => {
    setSearch("");
    if (result.page === "projects") openProject(result.id);
    else if (result.page === "assets") { navigate("assets"); setSelectedAsset(result.id); }
    else if (result.page === "tasks") { navigate("tasks"); setSelectedTask(result.id); }
    else navigate(result.page);
  };

  const changeScope = (nextScopeId: string) => {
    setScopeId(nextScopeId);
    setSelectedAsset(null);
    setSelectedTask(null);
  };

  const openProject = (id = projectId, tab: ProjectTab = "overview", replace = false) => {
    setProjectId(id);
    setProjectDetail(true);
    setProjectTab(tab);
    setPage("projects");
    const target = `/projects?project=${encodeURIComponent(id)}&tab=${tab}`;
    routerNavigate(target, { replace });
  };

  const changeProjectTab = (tab: ProjectTab) => openProject(projectId, tab);

  const createTaskDisabled = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    notify("项目创建和 Provider 提交等待正式 owner 合同");
  };

  const advanceTask = (taskId: string) => {
    const scope = scopeId;
    if (!scope) { notify("当前会话没有可用授权范围"); return; }
    readLiveTask(taskId, scope).then((row) => {
      const next = liveTasks([row])[0];
      if (next) setTasks((current) => current.map((task) => task.id === taskId ? next : task));
      notify("已查询原任务，未创建新 attempt");
    }).catch(() => notify("原任务查询失败，状态保持未知"));
  };

  const submitLiveCreation = async () => {
    notify("真实 Provider 提交等待正式 owner 合同");
  };

  useEffect(() => {
    if (!activeRun || !scopeId) { setRunConnection("idle"); return; }
    const scope = scopeId;
    const runRef = activeRun.run_ref;
    let source: EventSource | null = null;
    let poll: number | null = null;
    let closed = false;
    const terminal = (state: string) => ["succeeded", "failed", "unknown", "reconciled"].includes(state);
    const update = (next: ProviderRunProjection) => {
      if (closed || next.run_ref !== runRef) return;
      setActiveRun(next);
      if (terminal(next.state)) {
        if (poll !== null) window.clearInterval(poll);
        source?.close();
        setRunConnection("closed");
      }
    };
    try {
      source = new EventSource(`/api/control-center/v1/provider-runs/${encodeURIComponent(runRef)}/events?scope=${encodeURIComponent(scope)}`);
      setRunConnection("sse");
      source.onmessage = (event) => { try { update(JSON.parse(event.data) as ProviderRunProjection); } catch { /* malformed event remains observable through polling */ } };
      source.onerror = () => {
        source?.close();
        setRunConnection("polling");
        if (poll === null) poll = window.setInterval(() => void readProviderRun(scope, runRef).then(update).catch(() => {}), 5000);
      };
    } catch {
      setRunConnection("polling");
    }
    return () => {
      closed = true;
      source?.close();
      if (poll !== null) window.clearInterval(poll);
    };
  }, [activeRun?.run_ref, scopeId]);

  const chooseReviewVersion = (assetId: string, versionId: string) => setReviewVersion((current) => ({ ...current, [assetId]: versionId }));

  const approveReview = () => notify("真实审阅写入尚未接入；当前页面只读");
  const generateDelivery = () => notify("真实交付写入尚未接入；当前页面只读");

  const submitLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError("");
    try {
      await loginWorkspace(username, password, keyRequired);
      const next = await readWorkspaceSession();
      setSession(next);
      setScopeId(next.scopes[0]?.id || "");
      setAuthState("ready");
      setPassword("");
    } catch (error) {
      setLoginError(error instanceof Error && error.message === "invalid_credentials" ? "用户名或密码不正确" : "登录失败，请检查服务连接");
    }
  };

  if (authState === "loading") return <AuthLoading />;
  if (authState === "login_required") return <AuthGate username={username} password={password} error={loginError} onUsername={setUsername} onPassword={setPassword} onSubmit={submitLogin} />;
  if (authState === "forbidden") return <AuthStatePage title="当前身份无权访问" body="请切换到拥有该工作空间范围的账号。" action={<button className="v18-primary-button" onClick={() => window.location.reload()}>重新检查</button>} />;
  if (authState === "offline") return <AuthStatePage title="Workspace 服务暂不可达" body="请检查内网服务或稍后重试。" action={<button className="v18-primary-button" onClick={() => window.location.reload()}>重试连接</button>} />;

  return <>
    <AppShell
      session={session!}
      liveMode={liveMode}
      page={page}
      collapsed={collapsed}
      mobileNav={mobileNav}
      dark={dark}
      search={search}
      searchResults={searchResults}
      scopeId={scopeId}
      pendingReviews={pendingReviews}
      onSearch={setSearch}
      onSearchSelect={selectSearchResult}
      onScopeChange={changeScope}
      onNavigate={navigate}
      onToggleCollapsed={() => setCollapsed((value) => !value)}
      onToggleMobile={setMobileNav}
      onToggleDark={() => setDark((value) => !value)}
      onNotice={notify}
    >
      {page === "home" && <HomePage project={project} projects={projectsState} tasks={tasks} assets={assets} pendingReviews={pendingReviews} liveMode={liveMode} onProject={() => openProject(projectId)} onTasks={() => navigate("tasks")} onReview={() => navigate("review")} onAsset={(id) => { setSelectedAsset(id); navigate("assets"); }} />}
      {page === "projects" && <ProjectsPage projects={projectsState} project={project} detail={projectDetail} tab={projectTab} onTab={changeProjectTab} view={projectView} setView={setProjectView} onOpen={(id) => openProject(id)} onUnit={setUnitId} unitId={unitId} onCreation={() => navigate("creation")} assets={assets.filter((asset) => asset.projectId === projectId)} tasks={tasks.filter((task) => task.projectId === projectId)} reviews={reviews} delivery={delivery} liveMode={liveMode} />}
      {page === "creation" && <CreationPage project={project} capabilities={capabilityCards} capabilityCatalog={capabilityCatalog} liveMode={liveMode} unitId={unitId} selectedCapability={selectedCapability} setSelectedCapability={setSelectedCapability} onSubmit={createTaskDisabled} onLiveSubmit={submitLiveCreation} activeRun={activeRun} runConnection={runConnection} />}
      {page === "assets" && <AssetsPage assets={visibleAssets} filterKind={filterKind} setFilterKind={setFilterKind} onOpen={setSelectedAsset} liveMode={liveMode} />}
      {page === "tasks" && <TasksPage liveMode={liveMode} tasks={tasks.filter((task) => taskView === "all" || (taskView === "running" ? ["queued", "running", "unknown"].includes(task.status) : ["succeeded", "failed", "waiting_review"].includes(task.status)))} taskView={taskView} onView={setTaskView} projects={projectsState} onOpen={setSelectedTask} onAdvance={advanceTask} />}
      {page === "review" && <ReviewPage liveMode={liveMode} assets={assets} reviews={reviews} selected={reviewVersion} onSelect={chooseReviewVersion} onApprove={approveReview} onDelivery={() => navigate("delivery")} />}
      {page === "delivery" && <DeliveryPage delivery={delivery} assets={assets} onGenerate={generateDelivery} liveMode={liveMode} />}
      {page === "capabilities" && <CapabilityHub catalog={capabilityCatalog} services={services} connections={connections} />}
      {page === "usage" && <UsageAnalytics liveMode={liveMode} facts={usage} />}
      {page === "team" && <TeamPage liveMode={liveMode} usage={usage} />}
    </AppShell>
    {selectedAsset && activeAsset && <AssetInspector asset={activeAsset} csrf={session?.csrf || ""} liveMode={liveMode} scope={scopeId} onClose={() => setSelectedAsset(null)} onReview={() => { setSelectedAsset(null); navigate("review"); }} onDownload={(message) => notify(message)} />}
    {selectedTask && activeTask && <TaskInspector liveMode={liveMode} task={activeTask} onClose={() => setSelectedTask(null)} onAdvance={() => advanceTask(activeTask.id)} />}
    {toast && <div className="v18-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
  </>;
}
function AuthLoading() { return <div className="v18-auth-state"><div className="v18-auth-card"><LoaderCircle className="v18-spin" size={22} /><strong>正在检查 Workspace 登录状态…</strong></div></div>; }
function AuthStatePage({ title, body, action }: { title: string; body: string; action: ReactNode }) { return <div className="v18-auth-state"><div className="v18-auth-card"><div className="v18-empty-mark"><CircleAlert size={20} /></div><h1>{title}</h1><p>{body}</p>{action}</div></div>; }
function AuthGate({ username, password, error, onUsername, onPassword, onSubmit }: { username: string; password: string; error: string; onUsername: (value: string) => void; onPassword: (value: string) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <div className="v18-auth-state"><form className="v18-auth-card v18-auth-form" onSubmit={onSubmit}><div className="v18-brand-mark">Y</div><p className="v18-eyebrow">YEISME WORKSPACE</p><h1>进入团队工作空间</h1><p>输入控制中心账号或管理员分发的访问 Key，进入你的工作区。</p><label>用户名<input value={username} onChange={(event) => onUsername(event.target.value)} autoComplete="username" required /></label><label>个人访问凭据<input type="password" value={password} onChange={(event) => onPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="v18-auth-error" role="alert">{error}</p>}<button className="v18-primary-button" type="submit">登录 Workspace <ArrowRight size={16} /></button><small>凭据只通过同源登录请求发送，不写入浏览器持久化状态。</small></form></div>; }

function PageHeader({ eyebrow, title, body, action }: { eyebrow: string; title: string; body: string; action?: ReactNode }) {
  return <div className="v18-page-header"><div><p className="v18-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="v18-page-body">{body}</p></div>{action}</div>;
}

function HomePage({ project, projects, tasks, assets, pendingReviews, liveMode, onProject, onTasks, onReview, onAsset }: { project: WorkspaceProject; projects: WorkspaceProject[]; tasks: CreationTask[]; assets: AssetGroup[]; pendingReviews: number; liveMode: boolean; onProject: () => void; onTasks: () => void; onReview: () => void; onAsset: (id: string) => void }) {
  if (liveMode) return <LiveHomePage project={project} projects={projects} tasks={tasks} assets={assets} onProject={onProject} onTasks={onTasks} onAsset={onAsset} />;
  const running = tasks.filter((task) => ["running", "queued", "unknown"].includes(task.status)).length;
  return <div className="v18-page v18-page-enter" data-page="home">
    <PageHeader eyebrow="工作台" title="早上好，陈序。" body="继续完成今天最重要的制作决策。" action={<button className="v18-primary-button" onClick={() => onProject()}><ArrowRight size={16} />继续制作</button>} />
    <section className="v18-stat-grid"><button className="v18-stat-card" onClick={onProject}><span className="v18-stat-icon sage"><FolderKanban size={18} /></span><strong>03</strong><span>进行中项目</span><small>比昨天多 1 个更新</small></button><button className="v18-stat-card" onClick={onTasks}><span className="v18-stat-icon blue"><Activity size={18} /></span><strong>{String(running).padStart(2, "0")}</strong><span>运行中任务</span><small>其中 1 个结果未知</small></button><button className="v18-stat-card" onClick={onReview}><span className="v18-stat-icon amber"><ClipboardCheck size={18} /></span><strong>{String(pendingReviews).padStart(2, "0")}</strong><span>待我审阅</span><small>最早截止今天 16:00</small></button></section>
    <section className="v18-home-grid"><article className="v18-panel v18-continue-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">继续制作</p><h2>{project.name}</h2><p>{project.type} · {project.owner} 负责</p></div><button className="v18-quiet-button" onClick={onProject}>打开项目 <ArrowRight size={15} /></button></div><div className="v18-project-hero"><img src={project.cover} alt="雨夜重逢项目封面" /><div><div className="v18-project-meta"><span>{project.progress}% 完成</span><span>更新于 {project.updated}</span></div><Progress value={project.progress} /><h3>{project.units.find((unit) => unit.status === "in_progress")?.label}</h3><p>{project.units.find((unit) => unit.status === "in_progress")?.note}</p><button className="v18-primary-button small" onClick={onProject}>返回上次位置 <ArrowRight size={15} /></button></div></div></article><article className="v18-panel v18-attention-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">需要我处理</p><h2>制作阻塞</h2></div><button className="v18-icon-button"><MoreHorizontal size={18} /></button></div><div className="v18-attention-list"><button onClick={onReview}><span className="v18-attention-mark warning"><CircleAlert size={16} /></span><span><strong>镜头 03 · 回头视频</strong><small>结果未知 · 需要确认来源</small></span><ArrowRight size={15} /></button><button onClick={onReview}><span className="v18-attention-mark review"><ClipboardCheck size={16} /></span><span><strong>镜头 02 · 配音</strong><small>等待审阅 · 1 个候选版本</small></span><ArrowRight size={15} /></button><button onClick={onTasks}><span className="v18-attention-mark info"><Clock3 size={16} /></span><span><strong>3 个任务正在处理</strong><small>预计最晚 16:00 有结果</small></span><ArrowRight size={15} /></button></div></article></section>
    <section className="v18-panel v18-recent-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">最近资源</p><h2>刚刚产生的候选版本</h2></div><button className="v18-quiet-button" onClick={() => onAsset(assets[0].id)}>查看资源库 <ArrowRight size={15} /></button></div><div className="v18-recent-grid">{assets.slice(0, 3).map((asset) => <button key={asset.id} className="v18-recent-card" onClick={() => onAsset(asset.id)}><div className="v18-thumb"><AssetThumb asset={asset} /></div><div><span className="v18-card-kicker"><KindIcon kind={asset.kind} />{kindMeta[asset.kind].label}</span><strong>{asset.name}</strong><small>{asset.versions.length} 个版本 · {asset.source}</small></div></button>)}</div></section>
  </div>;
}

function LiveHomePage({ project, projects, tasks, assets, onProject, onTasks, onAsset }: { project: WorkspaceProject; projects: WorkspaceProject[]; tasks: CreationTask[]; assets: AssetGroup[]; onProject: () => void; onTasks: () => void; onAsset: (id: string) => void }) {
  const active = tasks.filter((task) => ["running", "queued", "unknown"].includes(task.status)).length;
  return <div className="v18-page v18-page-enter" data-page="home">
    <PageHeader eyebrow="工作台" title="真实只读工作台" body="当前页面只展示已授权范围和 owner 返回的事实。" action={<button className="v18-primary-button" onClick={onProject}><ArrowRight size={16} />查看项目范围</button>} />
    <section className="v18-stat-grid"><button className="v18-stat-card" onClick={onProject}><span className="v18-stat-icon sage"><FolderKanban size={18} /></span><strong>{String(projects.length).padStart(2, "0")}</strong><span>授权项目范围</span><small>项目目录合同未提供</small></button><button className="v18-stat-card" onClick={onTasks}><span className="v18-stat-icon blue"><Activity size={18} /></span><strong>{String(active).padStart(2, "0")}</strong><span>当前任务</span><small>{tasks.length ? "来自 owner 任务投影" : "来源未提供任务"}</small></button><button className="v18-stat-card" onClick={() => assets[0] && onAsset(assets[0].id)}><span className="v18-stat-icon amber"><Images size={18} /></span><strong>{String(assets.length).padStart(2, "0")}</strong><span>已读取资产</span><small>内容权限逐结果检查</small></button></section>
    <section className="v18-home-grid"><article className="v18-panel v18-continue-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">当前范围</p><h2>{project.name}</h2><p>{project.type} · {project.owner}</p></div><button className="v18-quiet-button" onClick={onProject}>打开范围 <ArrowRight size={15} /></button></div><div className="v18-project-hero"><div className="v18-project-cover-placeholder"><FolderKanban size={26} /><span>owner 未提供封面</span></div><div><div className="v18-project-meta"><span>进度未知</span><span>更新时间未提供</span></div><h3>制作单元未提供</h3><p>当前只读合同提供 scope 和任务投影，未提供项目制作进度。</p><button className="v18-primary-button small" onClick={onTasks}>查看任务 <ArrowRight size={15} /></button></div></div></article><article className="v18-panel v18-attention-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">需要核验</p><h2>数据边界</h2></div></div><div className="v18-attention-list"><div><span className="v18-attention-mark info"><CircleAlert size={16} /></span><span><strong>项目进度未提供</strong><small>不会从任务数量推导项目完成度</small></span></div><div><span className="v18-attention-mark warning"><CircleAlert size={16} /></span><span><strong>审阅与交付未接入</strong><small>owner 合同尚未提供正式写入</small></span></div><div><span className="v18-attention-mark info"><Clock3 size={16} /></span><span><strong>Provider 提交已关闭</strong><small>当前工作台只展示真实只读能力</small></span></div></div></article></section>
    <section className="v18-panel v18-recent-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">最近资源</p><h2>真实读取到的结果</h2></div><button className="v18-quiet-button" onClick={() => assets[0] && onAsset(assets[0].id)}>查看资源库 <ArrowRight size={15} /></button></div>{assets.length ? <div className="v18-recent-grid">{assets.slice(0, 3).map((asset) => <button key={asset.id} className="v18-recent-card" onClick={() => onAsset(asset.id)}><div className="v18-thumb"><AssetThumb asset={asset} /></div><div><span className="v18-card-kicker"><KindIcon kind={asset.kind} />{kindMeta[asset.kind].label}</span><strong>{asset.name}</strong><small>{asset.source}</small></div></button>)}</div> : <EmptyState title="当前没有可见资源" body="owner 未返回可读取的结果资产。" />}</section>
  </div>;
}

function ProjectsPage({ projects, project, detail, tab, onTab, view, setView, onOpen, onUnit, unitId, onCreation, assets, tasks, reviews, delivery, liveMode }: { projects: WorkspaceProject[]; project: WorkspaceProject; detail: boolean; tab: ProjectTab; onTab: (tab: ProjectTab) => void; view: "grid" | "list"; setView: (value: "grid" | "list") => void; onOpen: (id: string) => void; onUnit: (id: string) => void; unitId: string; onCreation: () => void; assets: AssetGroup[]; tasks: CreationTask[]; reviews: ReviewDecision[]; delivery: DeliveryPackage; liveMode: boolean }) {
  if (detail) {
    const tabs: { id: ProjectTab; label: string; count?: number }[] = [
      { id: "overview", label: projectTabManifest.overview.label }, { id: "units", label: projectTabManifest.units.label, count: project.units.length }, { id: "assets", label: projectTabManifest.assets.label, count: assets.length }, { id: "tasks", label: projectTabManifest.tasks.label, count: tasks.length }, { id: "review", label: projectTabManifest.review.label, count: reviews.filter((item) => item.state === "pending").length }, { id: "delivery", label: projectTabManifest.delivery.label },
    ];
    const detailUnavailable = liveMode && !project.units.length && !assets.length && !tasks.length;
    const tabPanel = tab === "units" ? <section className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">制作单元</p><h2>{liveMode ? "制作单元未提供" : "按镜头推进作品"}</h2></div><button className="v18-quiet-button" disabled={liveMode} onClick={onCreation}><Sparkles size={15} />{liveMode ? "创建已关闭" : "从当前单元创作"}</button></div>{liveMode && !project.units.length ? <EmptyState title="当前范围没有制作单元" body="owner 只读合同尚未提供项目制作单元。" /> : <div className="v18-unit-list">{project.units.map((unit) => <button key={unit.id} className={`v18-unit-row ${unit.id === unitId ? "selected" : ""}`} onClick={() => onUnit(unit.id)}><span className={`v18-unit-status ${unit.status}`}><span /></span><span><strong>{unit.label}</strong><small>{unit.note}</small></span><span className="v18-unit-progress">{unit.progress}%</span><ArrowRight size={15} /></button>)}</div>}</section> : tab === "assets" ? <section className="v18-panel v18-project-tab-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">项目资产</p><h2>这个作品引用的媒体</h2></div><button className="v18-quiet-button" disabled={liveMode}>打开资源库 <ArrowRight size={15} /></button></div>{assets.length ? <div className="v18-project-assets">{assets.map((asset) => <div className="v18-project-asset" key={asset.id}><div className="v18-project-asset-thumb"><AssetThumb asset={asset} /></div><div><strong>{asset.name}</strong><small>{asset.source} · {asset.versions.length} 个版本</small></div><span className="v18-muted">{asset.versions.some((version) => version.state === "adopted") ? "已采用" : "候选"}</span></div>)}</div> : <EmptyState title="当前项目没有可见资产" body="owner 未提供项目级资产关联。" />}</section> : tab === "tasks" ? <section className="v18-panel v18-project-tab-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">项目任务</p><h2>机器执行进度</h2></div><button className="v18-quiet-button" disabled={liveMode} onClick={onCreation}>创建任务</button></div>{tasks.length ? <div className="v18-project-task-list">{tasks.map((task) => <div className="v18-project-task" key={task.id}><KindIcon kind={task.capability.includes("图像") ? "image" : task.capability.includes("配音") ? "audio" : task.capability.includes("视频") ? "video" : "text"} /><span><strong>{task.title}</strong><small>{task.stage}</small></span><StatusBadge status={task.status} /></div>)}</div> : <EmptyState title="当前项目没有任务记录" body="owner 未提供项目级任务关联。" />}</section> : tab === "review" ? <section className="v18-panel v18-project-tab-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">项目审阅</p><h2>团队决策摘要</h2></div><button className="v18-primary-button small" disabled={liveMode} onClick={() => onTab("delivery")}>查看交付 <ArrowRight size={15} /></button></div>{liveMode && !reviews.length ? <EmptyState title="审阅数据未提供" body="owner 合同尚未提供项目审阅记录。" /> : <div className="v18-health-list"><div><span>待审阅</span><strong>{reviews.filter((item) => item.state === "pending").length}</strong></div><div><span>已通过</span><strong>{reviews.filter((item) => item.state === "approved").length}</strong></div><div><span>修改要求</span><strong className="danger-text">{reviews.filter((item) => item.state === "changes_requested").length}</strong></div><div><span>采用版本</span><strong>{assets.filter((asset) => asset.versions.some((version) => version.state === "adopted")).length}</strong></div></div>}</section> : tab === "delivery" ? <section className="v18-panel v18-project-tab-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">项目交付</p><h2>{liveMode ? "交付数据未提供" : `${delivery.items.filter((item) => item.included).length} / ${delivery.items.length} 项已固定`}</h2></div><span className="v18-status v18-status-warning"><CircleAlert size={13} />{liveMode ? "未接入" : delivery.state === "ready" ? "可以交付" : "仍有缺失"}</span></div>{liveMode ? <EmptyState title="交付合同未提供" body="当前工作台不会从任务或资产推导交付状态。" /> : <div className="v18-delivery-list">{delivery.items.map((item) => { const asset = assets.find((candidate) => candidate.id === item.assetId); return <div className={`v18-delivery-row ${item.included ? "included" : ""}`} key={item.assetId}><span className="v18-delivery-check">{item.included ? <Check size={15} /> : <CircleAlert size={15} />}</span><KindIcon kind={asset?.kind || "text"} /><span><strong>{asset?.name}</strong><small>{item.included ? "已加入交付包" : "缺少采用版本"}</small></span><span className="v18-delivery-state">{item.included ? "已加入" : "缺失"}</span></div>; })}</div>}</section> : <section className="v18-detail-grid"><article className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">制作单元</p><h2>当前制作位置</h2></div><button className="v18-quiet-button" disabled={liveMode} onClick={() => onTab("units")}>全部单元 <ArrowRight size={15} /></button></div>{project.units.length ? <div className="v18-unit-list">{project.units.map((unit) => <button key={unit.id} className={`v18-unit-row ${unit.id === unitId ? "selected" : ""}`} onClick={() => onUnit(unit.id)}><span className={`v18-unit-status ${unit.status}`}><span /></span><span><strong>{unit.label}</strong><small>{unit.note}</small></span><span className="v18-unit-progress">{unit.progress}%</span><ArrowRight size={15} /></button>)}</div> : <EmptyState title="制作单元未提供" body="当前授权范围没有项目制作单元合同。" />}</article><article className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">生产摘要</p><h2>项目健康度</h2></div><span className="v18-status v18-status-warning"><CircleAlert size={13} />{liveMode ? "数据不完整" : "可继续"}</span></div><div className="v18-health-list"><div><span>已采用版本</span><strong>{liveMode ? "未知" : assets.filter((asset) => asset.versions.some((version) => version.state === "adopted")).length}</strong></div><div><span>待审阅候选</span><strong>{liveMode ? "未知" : reviews.filter((item) => item.state === "pending").length}</strong></div><div><span>阻塞项</span><strong className="danger-text">{liveMode ? "未知" : project.units.filter((unit) => unit.status === "blocked").length}</strong></div><div><span>{liveMode ? "成本" : "演示成本"}</span><strong>{liveMode ? "未知" : "¥ 28.40"}</strong></div></div><div className="v18-contract-note"><CircleAlert size={15} /><span>{liveMode ? "项目健康度、成本和审阅合同尚未提供。" : "正式用量和交付权限仍等待 owner 合同。"}</span></div></article></section>;
    return <div className="v18-page v18-page-enter" data-page="project-detail"><PageHeader eyebrow={`项目 / ${project.name}`} title={project.name} body={projectTabManifest.overview.prompt} action={<button className="v18-primary-button" onClick={onCreation}><Sparkles size={16} />进入 AI 创作</button>} /><div className="v18-project-summary">{project.cover ? <img src={project.cover} alt="项目封面" /> : <div className="v18-project-cover-placeholder"><FolderKanban size={26} /><span>来源未提供封面</span></div>}<div><div className="v18-project-summary-top"><span className="v18-pill">{project.type}</span><span className="v18-muted">最近更新 {project.updated}</span></div><h2>{project.name}</h2><p>{project.units.length ? "镜头、任务、版本和团队决策摘要都挂在这个项目下。" : "当前授权范围未提供制作单元或项目封面。"}</p><div className="v18-member-row">{project.members.map((member) => <span key={member} className="v18-member-avatar">{member.slice(0, 1)}</span>)}<span className="v18-muted">{project.members.length} 位成员</span></div></div><div className="v18-summary-progress"><strong>{project.progress ? `${project.progress}%` : "未知"}</strong><span>制作进度</span><Progress value={project.progress} /></div></div><div className="v18-tab-bar" role="tablist" aria-label="项目详情"><div className="v18-tab-scroll">{tabs.map((item) => <button key={item.id} role="tab" data-project-tab={item.id} aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => onTab(item.id)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div></div><div role="tabpanel" aria-labelledby={`project-tab-${tab}`}>{tabPanel}</div></div>;
  }
  return <div className="v18-page v18-page-enter" data-page="projects"><PageHeader eyebrow="制作空间" title="项目" body="围绕作品组织制作单元、成员和全部成果。" action={<button className="v18-primary-button" disabled><Plus size={16} />新建项目</button>} /><div className="v18-toolbar"><div className="v18-filter-tabs"><button className="active">全部项目 <span>{String(projects.length).padStart(2, "0")}</span></button><button>我负责的</button><button>已归档</button></div><div className="v18-toolbar-actions"><button className={`v18-icon-button ${view === "grid" ? "selected" : ""}`} aria-label="卡片视图" onClick={() => setView("grid")}><Images size={17} /></button><button className={`v18-icon-button ${view === "list" ? "selected" : ""}`} aria-label="列表视图" onClick={() => setView("list")}><List size={17} /></button><button className="v18-filter-button"><ChevronDown size={15} />最近更新</button></div></div>{projects.length ? view === "grid" ? <div className="v18-project-grid">{projects.map((item) => <button key={item.id} className="v18-project-card" data-project={item.id} onClick={() => onOpen(item.id)}><div className="v18-project-card-cover">{item.cover ? <img src={item.cover} alt="" /> : <div className="v18-project-cover-placeholder"><FolderKanban size={24} /><span>封面未提供</span></div>}<span className="v18-project-card-type">{item.type}</span><span className="v18-project-card-arrow"><ArrowRight size={16} /></span></div><div className="v18-project-card-copy"><div><strong>{item.name}</strong><span>{item.owner} 负责</span></div><Progress value={item.progress} /><div className="v18-project-card-footer"><span>{item.progress ? `${item.progress}% 完成` : "进度未知"}</span><span>{item.updated}</span></div></div></button>)}</div> : <div className="v18-list-table"><div className="v18-list-head"><span>项目</span><span>负责人</span><span>进度</span><span>更新</span><span /></div>{projects.map((item) => <button key={item.id} className="v18-list-row" onClick={() => onOpen(item.id)}><span>{item.cover ? <img src={item.cover} alt="" /> : <span className="v18-list-placeholder"><FolderKanban size={17} /></span>}<strong>{item.name}</strong></span><span>{item.owner}</span><span><Progress value={item.progress} /></span><span>{item.updated}</span><ArrowRight size={16} /></button>)}</div> : <EmptyState title="当前范围没有项目" body="项目目录尚未提供真实记录。" />}</div>;
}

function CreationPage({ project, capabilities: availableCapabilities, capabilityCatalog, liveMode, unitId, selectedCapability, setSelectedCapability, onSubmit, onLiveSubmit, activeRun, runConnection }: { project: WorkspaceProject; capabilities: CapabilityCard[]; capabilityCatalog: CapabilityRecord[]; liveMode: boolean; unitId: string; selectedCapability: string; setSelectedCapability: (value: string) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>, payload: Record<string, string | boolean>) => void; onLiveSubmit: (payload: { owner: "eikona" | "scaena" | "sonora"; modality: "image" | "video" | "audio"; modelRef: string; prompt: string; budget: number; projectRef: string }) => Promise<void>; activeRun: ProviderRunProjection | null; runConnection: "idle" | "sse" | "polling" | "closed" }) {
  const unit = project.units.find((item) => item.id === unitId) || project.units[0];
  const [drafts, setDrafts] = useState<Record<string, Record<string, string | boolean>>>({});
  const config = creationFields[selectedCapability] || creationFields.image;
  const draft = drafts[selectedCapability] || {};
  const update = (key: string, value: string | boolean) => setDrafts((current) => ({ ...current, [selectedCapability]: { ...(current[selectedCapability] || {}), [key]: value } }));
  const capability = availableCapabilities.find((item) => item.id === selectedCapability) || availableCapabilities[0];
  const liveCapability = capabilityCatalog.find((item) => item.id === selectedCapability);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const valueFor = (field: (typeof config)[number]) => draft[field.key] ?? field.options?.[0] ?? "";
    const missing = config.find((field) => field.required && !(field.key === "prompt" && !liveMode) && !String(valueFor(field)).trim());
    if (missing) { update("_error", `${missing.label}不能为空`); return; }
    update("_error", "");
    const payload = { ...draft, ...Object.fromEntries(config.map((field) => [field.key, valueFor(field)])), capability: capability.id, projectId: project.id, unitId: unit.id };
    if (liveMode) {
      update("_error", "真实 Provider 提交当前关闭；此页面只显示能力和参数合同。");
      return;
    }
    onSubmit(event, payload);
  };
  if (!capability) return <div className="v18-page v18-page-enter" data-page="creation"><PageHeader eyebrow="AI 创作" title="把想法变成下一版素材。" body="当前授权范围没有你想完成什么？。" /><EmptyState title="能力待合同" body="owner manifest 或授权合同尚未提供，暂不显示可提交表单。" /></div>;
  return <div className="v18-page v18-page-enter" data-page="creation"><PageHeader eyebrow="AI 创作" title="把想法变成下一版素材。" body="按创作目标选择能力，结果会先进入项目候选区，等待团队决定。" /><div className="v18-creation-layout"><section className="v18-panel v18-capability-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">选择能力</p><h2>你想完成什么？</h2></div><span className="v18-muted">{availableCapabilities.length} 项{liveMode ? "已观察能力" : "演示能力"}</span></div><div className="v18-capability-grid">{availableCapabilities.map((item) => { const Icon = kindMeta[item.kind].icon; return <button type="button" key={item.id} className={`v18-capability-card ${selectedCapability === item.id ? "selected" : ""}`} onClick={() => setSelectedCapability(item.id)}><span className={`v18-capability-icon ${item.accent}`}><Icon size={21} /></span><strong>{item.label}</strong><span>{item.description}</span><small>{item.owner} · {liveMode ? "真实目录" : "演示接入"}</small>{selectedCapability === item.id && <Check className="v18-capability-check" size={17} />}</button>; })}</div></section><form className="v18-panel v18-creation-form" id="creation-form" onSubmit={submit}><div className="v18-panel-heading"><div><p className="v18-eyebrow">{capability.label} · 创作设置</p><h2>绑定制作上下文</h2></div><span className="v18-demo-inline">{liveMode ? "只读合同预览" : "不会产生真实费用"}</span></div><label>项目<select value={project.id} disabled><option value={project.id}>{project.name}</option></select></label><label>制作单元<select value={unit?.id || "unknown"} disabled><option value={unit?.id || "unknown"}>{unit?.label || "未提供"}</option></select></label><label>输出名称<input value={String(draft.outputName || `${unit?.label || "任务"} · ${capability.label}`)} onChange={(event) => update("outputName", event.target.value)} /></label><label>参考资源<div className="v18-reference-field"><span className="v18-reference-thumb" /><span><strong>当前项目授权资源</strong><small>{liveMode ? "来源未提供可预览媒体" : "项目资产 · 已授权预览"}</small></span><button type="button" aria-label="移除参考资源"><X size={15} /></button></div></label>{config.map((field) => <label key={field.key}>{field.label}{field.type === "select" ? <select value={String(draft[field.key] || field.options?.[0] || "")} onChange={(event) => update(field.key, event.target.value)}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : field.type === "textarea" ? <textarea value={String(draft[field.key] || "")} placeholder={field.key === "script" ? "输入台词、旁白或文本素材…" : "描述你希望得到的结果…"} onChange={(event) => update(field.key, event.target.value)} /> : field.type === "toggle" ? <button type="button" role="switch" aria-checked={draft[field.key] === true} className={`v18-form-switch ${draft[field.key] === true ? "on" : ""}`} onClick={() => update(field.key, draft[field.key] !== true)}><span />{draft[field.key] === true ? "已开启" : "未开启"}</button> : <input value={String(draft[field.key] || "")} onChange={(event) => update(field.key, event.target.value)} />}</label>)}<details className="v18-parameter-summary"><summary>查看提交参数摘要</summary><pre>{JSON.stringify({ project: project.name, unit: unit?.label || "unknown", capability: capability.label, ...draft }, null, 2)}</pre></details>{draft._error && <p className="v18-auth-error" role="alert">{String(draft._error)}</p>}<div className="v18-contract-note"><CircleAlert size={15} /><span>{liveMode ? "真实 Provider 提交已关闭；此页面只展示能力和参数合同。" : "正式提交需要 owner 提供授权、可恢复和费用回执。本按钮只推进演示状态。"}</span></div><button className="v18-primary-button v18-submit-button" type="submit"><Sparkles size={16} />{liveMode ? "查看提交合同" : "创建演示任务"} <ArrowRight size={16} /></button></form>{activeRun && <ProviderRunWorkspace run={activeRun} connection={runConnection} />}</div></div>;
}

function ProviderRunWorkspace({ run, connection }: { run: ProviderRunProjection; connection: "idle" | "sse" | "polling" | "closed" }) {
  const labels: Record<string, string> = { accepted: "已接收", queued: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", unknown: "结果未知", reconciling: "核对中", reconciled: "已核对" };
  return <aside className="v18-panel v18-run-workspace" aria-label="Provider 实时回执"><div className="v18-panel-heading"><div><p className="v18-eyebrow">实时回执</p><h2>{labels[run.state] || "未知状态"}</h2></div><span className={`v18-status ${run.state === "succeeded" ? "v18-status-success" : run.state === "failed" ? "v18-status-danger" : "v18-status-warning"}`}>{connection === "sse" ? "SSE 已连接" : connection === "polling" ? "轮询中" : connection === "closed" ? "事件已结束" : "等待连接"}</span></div><dl className="v18-run-facts"><div><dt>Run</dt><dd>{run.run_ref}</dd></div><div><dt>Trace</dt><dd>{run.trace_ref}</dd></div><div><dt>Owner</dt><dd>{run.owner}</dd></div><div><dt>成本状态</dt><dd>{run.cost_state || "未知"}</dd></div><div><dt>上游成本</dt><dd>{run.upstream_cost == null ? "未知" : `${run.currency} ${run.upstream_cost.toFixed(2)}`}</dd></div><div><dt>结果</dt><dd>{run.output_refs.length ? run.output_refs.join("、") : "尚未提供"}</dd></div></dl>{run.error_code && <p className="v18-auth-error" role="alert">{run.error_code}</p>}<p className="v18-contract-note"><CircleAlert size={15} />结果未知时只查询原任务，不自动重试。</p></aside>;
}

function AssetsPage({ assets, filterKind, setFilterKind, onOpen, liveMode }: { assets: AssetGroup[]; filterKind: AssetKind | "all"; setFilterKind: (value: AssetKind | "all") => void; onOpen: (id: string) => void; liveMode: boolean }) {
  return <div className="v18-page v18-page-enter" data-page="assets"><PageHeader eyebrow="资源库" title="所有成果，都有来处。" body="跨项目查找素材、版本、来源任务和当前采用状态。" action={<button className="v18-primary-button" disabled={liveMode} title={liveMode ? "真实只读模式不允许导入" : undefined}><Plus size={16} />{liveMode ? "导入关闭" : "导入演示素材"}</button>} /><div className="v18-asset-toolbar"><div className="v18-filter-tabs"><button className={filterKind === "all" ? "active" : ""} onClick={() => setFilterKind("all")}>全部 <span>{assets.length}</span></button>{(Object.keys(kindMeta) as AssetKind[]).map((kind) => <button key={kind} className={filterKind === kind ? "active" : ""} onClick={() => setFilterKind(kind)}>{kindMeta[kind].label}</button>)}</div><button className="v18-filter-button"><span />更多筛选 <ChevronDown size={15} /></button></div>{assets.length ? <div className="v18-asset-grid">{assets.map((asset, index) => <button key={asset.id} className="v18-asset-card" data-asset={asset.id} style={{ "--v18-delay": `${Math.min(index, 5) * 35}ms` } as CSSProperties} onClick={() => onOpen(asset.id)}><div className="v18-asset-preview"><AssetThumb asset={asset} /><span className="v18-asset-kind-label"><KindIcon kind={asset.kind} />{kindMeta[asset.kind].label}</span><span className="v18-asset-more"><MoreHorizontal size={17} /></span></div><div className="v18-asset-card-copy"><div className="v18-asset-title-row"><strong>{asset.name}</strong><span className={`v18-asset-state ${asset.versions.some((version) => version.state === "adopted") ? "adopted" : ""}`}>{asset.versions.some((version) => version.state === "adopted") ? "已采用" : `${asset.versions.length} 个版本`}</span></div><p>{asset.source}</p><small>{asset.rights}</small></div></button>)}</div> : <EmptyState title="没有匹配的资源" body={liveMode ? "owner 未返回当前范围可读取的结果资产。" : "试试切换类型或清除筛选条件。"} action={filterKind !== "all" ? <button className="v18-quiet-button" onClick={() => setFilterKind("all")}>清除筛选</button> : undefined} />}</div>;
}

function AssetThumb({ asset }: { asset: AssetGroup }) {
  const version = asset.versions.find((item) => item.state === "adopted") || asset.versions[asset.versions.length - 1];
  if (!version) return <div className="v18-generated-thumb slate"><KindIcon kind={asset.kind} /><strong>未知</strong><span>来源未提供版本</span></div>;
  if (asset.kind === "image" && version.preview) return <img src={version.preview} alt="" />;
  const liveUnavailable = version.contentState !== "available";
  return <div className={`v18-generated-thumb ${kindMeta[asset.kind].tone}`}><KindIcon kind={asset.kind} /><strong>{liveUnavailable ? "未知" : asset.kind === "audio" ? "00:08" : asset.kind === "video" ? "00:04" : "TXT"}</strong><span>{liveUnavailable ? "来源未提供可预览媒体" : version.label}</span></div>;
}

function TasksPage({ liveMode, tasks, taskView, onView, projects, onOpen, onAdvance }: { liveMode: boolean; tasks: CreationTask[]; taskView: "all" | "running" | "history"; onView: (value: "all" | "running" | "history") => void; projects: WorkspaceProject[]; onOpen: (id: string) => void; onAdvance: (id: string) => void }) {
  return <div className="v18-page v18-page-enter" data-page="tasks"><PageHeader eyebrow="任务中心" title="看见生产进度，也看见不确定性。" body={liveMode ? "任务状态来自 owner 只读投影；结果未知时只查询原任务。" : "任务状态描述机器执行；团队决策在审阅与交付中完成。"} action={<button className="v18-primary-button" onClick={() => onView("running")}><Plus size={16} />查看正在请求</button>} /><div className="v18-task-summary"><div><span>全部任务</span><strong>{tasks.length}</strong></div><div><span>执行中</span><strong>{tasks.filter((task) => task.status === "running").length}</strong></div><div><span>结果未知</span><strong className="warning-text">{tasks.filter((task) => task.status === "unknown").length}</strong></div><div><span>待审阅</span><strong>{tasks.filter((task) => task.status === "waiting_review").length}</strong></div></div><div className="v18-panel v18-task-panel"><div className="v18-table-toolbar"><div className="v18-filter-tabs"><button className={taskView === "all" ? "active" : ""} onClick={() => onView("all")}>全部</button><button className={taskView === "running" ? "active" : ""} onClick={() => onView("running")}>正在请求</button><button className={taskView === "history" ? "active" : ""} onClick={() => onView("history")}>历史任务</button></div><button className="v18-filter-button"><ChevronDown size={15} />最近更新</button></div><div className="v18-task-table">{tasks.length ? tasks.map((task) => { const queryOnly = liveMode && task.status !== "unknown"; return <div className="v18-task-row" data-task={task.id} key={task.id}><button className="v18-task-main" onClick={() => onOpen(task.id)}><span className="v18-task-kind"><KindIcon kind={task.capability.includes("图像") ? "image" : task.capability.includes("音频") || task.capability.includes("配音") ? "audio" : task.capability.includes("视频") ? "video" : "text"} /></span><span><strong>{task.title}</strong><small>{task.capability} · {task.createdBy} · {task.updated}</small></span></button><span className="v18-task-project">{projects.find((project) => project.id === task.projectId)?.name || task.projectId || "未知项目"}</span><StatusBadge status={task.status} /><span className="v18-task-stage">{task.stage}</span><button className="v18-task-next" disabled={queryOnly} title={queryOnly ? "真实只读任务不允许推进状态" : undefined} aria-label={task.status === "unknown" ? `查询 ${task.title} 原任务` : `推进 ${task.title} 状态`} onClick={() => onAdvance(task.id)}>{task.status === "unknown" ? <Search size={16} /> : <ArrowRight size={15} />}</button></div>; }) : <EmptyState title="当前视图没有任务" body={liveMode ? "owner 未提供符合条件的任务记录。" : "来源未提供符合条件的任务记录。"} />}</div></div></div>;
}

function ReviewPage({ liveMode, assets, reviews, selected, onSelect, onApprove, onDelivery }: { liveMode: boolean; assets: AssetGroup[]; reviews: ReviewDecision[]; selected: Record<string, string>; onSelect: (assetId: string, versionId: string) => void; onApprove: (assetId: string) => void; onDelivery: () => void }) {
  const [commentAsset, setCommentAsset] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [savedComments, setSavedComments] = useState<Record<string, string>>({});
  const pending = reviews.filter((review) => review.state !== "approved");
  const saveComment = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!commentAsset || !commentDraft.trim()) return; setSavedComments((current) => ({ ...current, [commentAsset]: commentDraft.trim() })); setCommentDraft(""); setCommentAsset(null); };
  return <div className="v18-page v18-page-enter" data-page="review"><PageHeader eyebrow="审阅与交付" title="让团队决定，哪一版可以继续。" body={liveMode ? "当前只展示 owner 已提供的审阅事实；写入合同尚未接入。" : "生成完成只是开始；审阅、采用和交付分别留下清晰事实。"} action={<button className="v18-primary-button" onClick={onDelivery}><Send size={16} />查看交付清单</button>} /><div className="v18-review-layout"><section className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">待我审阅</p><h2>{pending.length ? `${pending.length} 个候选版本` : liveMode ? "审阅数据未提供" : "审阅队列已清空"}</h2></div><span className="v18-muted">{liveMode ? "owner 合同" : "审阅负责人 · 当前用户"}</span></div>{pending.length ? <div className="v18-review-list">{pending.map((review) => { const asset = assets.find((item) => item.id === review.assetId); if (!asset) return null; const chosen = selected[asset.id] || asset.versions[0]?.id; return <article className="v18-review-card" data-review={asset.id} key={asset.id}><div className="v18-review-card-head"><div><span className="v18-card-kicker"><KindIcon kind={asset.kind} />{kindMeta[asset.kind].label}</span><h3>{asset.name}</h3><p>{review.note}</p></div><span className="v18-status v18-status-review"><ClipboardCheck size={13} />需要决定</span></div><div className="v18-version-compare">{asset.versions.map((version) => <button key={version.id} data-version={version.id} className={`v18-version-option ${chosen === version.id ? "selected" : ""}`} onClick={() => onSelect(asset.id, version.id)}><div className="v18-version-media">{version.preview ? <img src={version.preview} alt="" /> : <div className={`v18-generated-thumb ${kindMeta[asset.kind].tone}`}><KindIcon kind={asset.kind} /><strong>{version.duration || "候选"}</strong></div>}<span>{version.version}</span></div><div><strong>{version.label}</strong><small>{version.note}</small></div></button>)}</div><div className="v18-review-actions"><button className="v18-quiet-button" disabled={liveMode} onClick={() => { setCommentAsset(asset.id); setCommentDraft(savedComments[asset.id] || ""); }}>{liveMode ? "意见写入关闭" : savedComments[asset.id] ? "编辑修改意见" : "提出修改意见"}</button><button className="v18-primary-button small" disabled={liveMode} data-action="approve-review" onClick={() => onApprove(asset.id)}><Check size={15} />{liveMode ? "采用关闭" : `采用 ${asset.versions.find((version) => version.id === chosen)?.version}`}</button></div>{commentAsset === asset.id && <form className="v18-comment-composer" onSubmit={saveComment}><label>修改意见<textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="记录团队对当前候选版本的具体意见…" autoFocus /></label><div><button type="button" className="v18-quiet-button" onClick={() => setCommentAsset(null)}>取消</button><button type="submit" className="v18-primary-button small" disabled={!commentDraft.trim()}>保存演示意见</button></div></form>}{savedComments[asset.id] && <p className="v18-saved-comment">演示意见：{savedComments[asset.id]}</p>}</article>; })}</div> : <EmptyState title={liveMode ? "审阅合同未提供" : "没有待审阅版本"} body={liveMode ? "owner 尚未返回可读取的审阅记录，不会使用演示数据填充。" : "新的候选版本会在任务完成后出现在这里。"} />}</section><aside className="v18-panel v18-review-side"><div className="v18-panel-heading"><div><p className="v18-eyebrow">审阅原则</p><h2>四种事实分开记录</h2></div></div><div className="v18-review-principles"><div><span className="principle-dot machine" /><strong>执行完成</strong><small>机器已返回结果</small></div><div><span className="principle-dot team" /><strong>审阅通过</strong><small>团队认可当前候选</small></div><div><span className="principle-dot adopted" /><strong>正式采用</strong><small>指定版本进入项目主线</small></div><div><span className="principle-dot delivery" /><strong>可交付</strong><small>清单完整且权限明确</small></div></div><div className="v18-contract-note"><CircleAlert size={15} /><span>{liveMode ? "审阅写入和交付包创建等待正式 owner 合同。" : "演示采用只更新本地 demo API，不写入真实 owner。"}</span></div></aside></div></div>;
}

function DeliveryPage({ delivery, assets, onGenerate, liveMode }: { delivery: DeliveryPackage; assets: AssetGroup[]; onGenerate: () => void; liveMode: boolean }) {
  const complete = delivery.items.filter((item) => item.included).length;
  return <div className="v18-page v18-page-enter" data-page="delivery"><PageHeader eyebrow="审阅与交付 / 交付清单" title="固定成果，准备交给下一环节。" body={liveMode ? "当前工作台只展示 owner 已提供的交付合同。" : "交付只包含明确采用的版本，并保留权限和缺失项。"} action={<button className="v18-primary-button" data-action="generate-delivery" disabled={liveMode} onClick={onGenerate}><Send size={16} />{liveMode ? "交付关闭" : "生成演示清单"}</button>} /><div className="v18-delivery-layout"><section className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">{liveMode ? "当前授权范围" : "雨夜重逢 · 交付包 v1"}</p><h2>{liveMode ? "交付数据未提供" : `${complete} / ${delivery.items.length} 项已固定`}</h2></div><span className="v18-status v18-status-warning"><CircleAlert size={13} />{liveMode ? "未接入" : delivery.state === "ready" ? "可以交付" : "仍有缺失"}</span></div>{liveMode ? <EmptyState title="交付合同未提供" body="不会从任务或资产数量推导交付状态，也不会发送真实文件。" /> : <div className="v18-delivery-list">{delivery.items.map((item) => { const asset = assets.find((candidate) => candidate.id === item.assetId); const adopted = asset?.versions.find((version) => version.state === "adopted"); return <div key={item.assetId} className={`v18-delivery-row ${item.included ? "included" : ""}`}><span className="v18-delivery-check">{item.included ? <Check size={15} /> : <CircleAlert size={15} />}</span><KindIcon kind={asset?.kind || "text"} /><span><strong>{asset?.name}</strong><small>{adopted ? `${adopted.version} · ${adopted.label}` : "尚未选择采用版本"}</small></span><span className="v18-delivery-state">{item.included ? "已加入" : "缺失"}</span></div>; })}</div>}</section><aside className="v18-panel v18-delivery-side"><div className="v18-panel-heading"><div><p className="v18-eyebrow">交付摘要</p><h2>{liveMode ? "等待正式合同" : "下一步"}</h2></div></div><div className="v18-delivery-summary"><div><span>项目</span><strong>{liveMode ? "未知" : "雨夜重逢"}</strong></div><div><span>交付对象</span><strong>{liveMode ? "未知" : "Scaena 片段工作台"}</strong></div><div><span>权限检查</span><strong className="warning-text">等待正式合同</strong></div><div><span>版本锁定</span><strong>{liveMode ? "未知" : delivery.state === "ready" ? "已完成" : "未完成"}</strong></div></div><div className="v18-contract-note"><CircleAlert size={15} /><span>{liveMode ? "owner 尚未提供交付权限和发送合同。" : "演示清单不会上传、复制或发送任何真实文件。"}</span></div></aside></div></div>;
}

function TeamPage({ liveMode, usage }: { liveMode: boolean; usage: UsageFact[] }) {
  const members = [{ name: "林舟", role: "项目负责人", initials: "林", tone: "sage" }, { name: "陈序", role: "创作人员 · 当前用户", initials: "陈", tone: "blue" }, { name: "周宁", role: "审阅负责人", initials: "周", tone: "violet" }];
  if (liveMode) return <div className="v18-page v18-page-enter" data-page="team"><PageHeader eyebrow="团队与设置" title="团队与权限" body="当前页面只展示正式合同返回的成员、权限和用量事实。" action={<button className="v18-primary-button" disabled title="真实只读模式不允许邀请成员"><Plus size={16} />邀请关闭</button>} /><div className="v18-team-grid"><section className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">成员</p><h2>成员数据未提供</h2></div><span className="v18-muted">未知</span></div><EmptyState title="团队成员合同未接入" body="不会使用演示成员填充当前授权范围。" /></section><section className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">工作空间用量</p><h2>真实用量观察</h2></div><Wallet size={19} /></div>{usage.length ? <div className="v18-usage-breakdown">{usage.map((item) => <span key={item.id}><i className="sage-dot" />{item.provider} · {item.modality} · {item.upstreamCost == null ? "成本未知" : `${item.currency} ${item.upstreamCost.toFixed(2)}`}</span>)}</div> : <EmptyState title="用量数据未提供" body="owner 尚未返回可读用量合同。" />}<div className="v18-contract-note"><CircleAlert size={15} /><span>当前页面不推导预算、成本或成员权限。</span></div></section></div><section className="v18-panel v18-state-gallery"><div className="v18-panel-heading"><div><p className="v18-eyebrow">状态组件</p><h2>每一种不确定性都应该可见</h2></div></div><div className="v18-state-grid"><div><StatusBadge status="unknown" /><span>成员数据未提供</span></div><div><span className="v18-status v18-status-danger"><CircleAlert size={13} />无权限</span><span>保持原始边界</span></div><div><span className="v18-status v18-status-neutral"><Clock3 size={13} />未接入</span><span>等待正式合同</span></div></div></section></div>;
  return <div className="v18-page v18-page-enter" data-page="team"><PageHeader eyebrow="团队与设置" title="让每个人知道自己该推进什么。" body="业务角色只用于工作空间体验，正式权限仍由组织与各 owner 合同决定。" action={<button className="v18-primary-button"><Plus size={16} />邀请成员</button>} /><div className="v18-team-grid"><section className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">成员</p><h2>Rain Studio</h2></div><span className="v18-muted">3 位成员</span></div><div className="v18-member-list">{members.map((member) => <div className="v18-member-row-card" key={member.name}><span className={`v18-large-avatar ${member.tone}`}>{member.initials}</span><span><strong>{member.name}</strong><small>{member.role}</small></span><button className="v18-icon-button" aria-label={`${member.name} 更多操作`}><MoreHorizontal size={17} /></button></div>)}</div></section><section className="v18-panel"><div className="v18-panel-heading"><div><p className="v18-eyebrow">工作空间用量</p><h2>内部预算观察</h2></div><Wallet size={19} /></div><div className="v18-usage-number"><strong>¥ 28.40</strong><span>/ ¥ 120.00 演示预算</span></div><Progress value={24} /><div className="v18-usage-breakdown"><span><i className="sage-dot" />图像 ¥ 12.80</span><span><i className="violet-dot" />音频 ¥ 8.40</span><span><i className="blue-dot" />视频 ¥ 7.20</span></div><div className="v18-contract-note"><CircleAlert size={15} /><span>这里只展示内部预算观察；真实用量与成本需要 owner 使用量合同。</span></div></section></div><section className="v18-panel v18-state-gallery"><div className="v18-panel-heading"><div><p className="v18-eyebrow">状态组件</p><h2>每一种不确定性都应该可见</h2></div></div><div className="v18-state-grid"><div><StatusBadge status="running" /><span>正在获取最新数据</span></div><div><StatusBadge status="unknown" /><span>不要推断为失败</span></div><div><span className="v18-status v18-status-danger"><CircleAlert size={13} />无权限</span><span>保持原始边界</span></div><div><span className="v18-status v18-status-neutral"><Clock3 size={13} />未接入</span><span>等待正式合同</span></div></div></section></div>;
}

function AssetInspector({ asset, csrf, scope, liveMode, onClose, onReview, onDownload }: { asset: AssetGroup; csrf: string; scope: string; liveMode: boolean; onClose: () => void; onReview: () => void; onDownload: (message: string) => void }) {
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewAsset = async (version: AssetGroup["versions"][number]) => {
    if (!liveMode) { onDownload("演示资源只提供静态预览；真实媒体需要 live 结果句柄"); return; }
    setPreviewBusy(true);
    try {
      const grant = await accessTaskArtifact(version.sourceTaskId, version.id, scope, "preview", csrf);
      setPreview({ url: grant.url, mime: grant.mime });
    } catch (error) {
      onDownload(error instanceof Error && error.message === "login_required" ? "登录已过期，请重新登录" : "当前结果暂无预览授权或来源未提供媒体");
    } finally { setPreviewBusy(false); }
  };
  const download = async (version: AssetGroup["versions"][number]) => {
    if (version.contentState !== "available" || version.downloadable !== true) { onDownload(version.downloadReason || "当前版本不可下载"); return; }
    try {
      const grant = await accessTaskArtifact(version.sourceTaskId, version.id, scope, "download", csrf);
      const anchor = document.createElement("a");
      anchor.href = grant.url;
      anchor.download = grant.filename || `${asset.id}-${version.version}`;
      anchor.click();
      onDownload("下载已开始，版本状态保持不变");
    } catch (error) { onDownload(error instanceof Error && error.message === "login_required" ? "登录已过期，请重新登录" : "下载权限或演示句柄不可用"); }
  };
  const media = preview ? (preview.mime.startsWith("image/") ? <img src={preview.url} alt={asset.name} /> : preview.mime.startsWith("video/") ? <video src={preview.url} controls /> : preview.mime.startsWith("audio/") ? <audio src={preview.url} controls /> : null) : null;
  return <aside className="v18-inspector" role="dialog" aria-label={`${asset.name} 资源详情`}><div className="v18-inspector-head"><div><p className="v18-eyebrow">资源详情</p><h2>{asset.name}</h2></div><button className="v18-icon-button" aria-label="关闭资源详情" onClick={onClose}><X size={18} /></button></div><div className="v18-inspector-media">{media || <AssetThumb asset={asset} />}</div><div className="v18-inspector-facts"><div><span>类型</span><strong>{kindMeta[asset.kind].label}</strong></div><div><span>来源任务</span><strong>{asset.source}</strong></div><div><span>关联项目</span><strong>{asset.projectId}</strong></div><div><span>使用权利</span><strong>{asset.rights}</strong></div></div><div className="v18-inspector-section"><div className="v18-inspector-section-head"><strong>版本</strong><span>{asset.versions.length} 个候选</span></div>{asset.versions.map((version) => <div className="v18-inspector-version" key={version.id}><span className={`v18-version-dot ${version.state}`} /><span><strong>{version.version} · {version.label}</strong><small>{version.note}</small></span><span className="v18-version-actions"><span className="v18-muted">{version.state === "adopted" ? "已采用" : version.review === "pending" ? "待审阅" : "候选"}</span><button className="v18-download-button" disabled={previewBusy} title="获取逐结果预览句柄" onClick={() => void previewAsset(version)}>预览</button><button className="v18-download-button" disabled={version.contentState !== "available" || version.downloadable !== true} title={version.downloadReason || "下载演示资产"} onClick={() => void download(version)}>下载</button></span></div>)}</div><button className="v18-primary-button v18-full-button" onClick={onReview}><ClipboardCheck size={16} />打开审阅</button></aside>;
}

function TaskInspector({ liveMode, task, onClose, onAdvance }: { liveMode: boolean; task: CreationTask; onClose: () => void; onAdvance: () => void }) {
  const queryOnly = liveMode && task.status !== "unknown";
  return <aside className="v18-inspector" role="dialog" aria-label={`${task.title} 任务详情`}><div className="v18-inspector-head"><div><p className="v18-eyebrow">任务详情</p><h2>{task.title}</h2></div><button className="v18-icon-button" aria-label="关闭任务详情" onClick={onClose}><X size={18} /></button></div><div className="v18-task-inspector-status"><StatusBadge status={task.status} /><strong>{task.stage}</strong><small>最后更新 {task.updated}</small></div><div className="v18-timeline"><div className="done"><span><Check size={13} /></span><div><strong>已创建</strong><small>{liveMode ? "owner 任务投影" : "当前用户 · 演示入口"}</small></div></div><div className={task.status === "queued" ? "current" : "done"}><span>{task.status === "queued" ? <Clock3 size={13} /> : <Check size={13} />}</span><div><strong>进入执行队列</strong><small>不代表 Provider 已接受</small></div></div><div className={task.status === "running" ? "current" : task.status === "queued" ? "" : "done"}><span>{task.status === "running" ? <LoaderCircle size={13} /> : task.status === "queued" ? <Clock3 size={13} /> : <Check size={13} />}</span><div><strong>执行与结果</strong><small>{task.completeness === "unknown" ? "结果待确认" : "结果引用可见"}</small></div></div><div className={task.status === "waiting_review" ? "current" : ""}><span><ClipboardCheck size={13} /></span><div><strong>进入审阅</strong><small>团队决策单独记录</small></div></div></div><div className="v18-inspector-facts"><div><span>所属项目</span><strong>{task.projectId || "未知"}</strong></div><div><span>制作单元</span><strong>{task.unitId || "未知"}</strong></div><div><span>来源</span><strong>{liveMode ? "live_projection" : "design_fixture"}</strong></div><div><span>完整性</span><strong>{task.completeness === "complete" ? "完整" : task.completeness === "partial" ? "部分数据" : "结果未知"}</strong></div></div><button className="v18-primary-button v18-full-button" disabled={queryOnly || task.status === "waiting_review"} title={queryOnly ? "真实只读任务不允许推进状态" : undefined} onClick={onAdvance}><ArrowRight size={16} />{liveMode ? "查询原任务" : "推进演示状态"}</button></aside>;
}

