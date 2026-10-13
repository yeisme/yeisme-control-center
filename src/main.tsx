import { demoInvestigation, demoRead } from "./demo-investigation";
import { RequestBody, RequestContent } from "./request-content";
import {
  AppShell,
  navigation,
  SectionNavigation,
  requestDetailTabs,
} from "./app-shell";
import { DropdownMenu } from "./ui";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { animated, useSpring, useReducedMotion } from "@react-spring/web";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bell,
  BookOpen,
  Box,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronLeft,
  Info,
  Eye,
  MoreHorizontal,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Command,
  Database,
  ExternalLink as LinkIcon,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Layers,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Terminal,
  Users,
  Wallet,
  X,
} from "./icons";
import {
  services as baseServices,
  projects,
  initialOperations,
  assets,
  initialApprovals,
  serviceById,
  projectName,
  labels,
  frameURL,
  type Page,
  type Role,
  type Env,
  type Scenario,
  type Service,
  type Operation,
  type Asset,
  type Approval,
} from "./data";
import {
  actionFor,
  canWrite,
  charges,
  confirmedTotals,
  launchContext,
  mutateOperation,
  scopedOperations,
  uniqueCharges,
  validateConnection,
} from "./domain";
import {
  Badge,
  Button,
  Empty,
  ExternalLink,
  Field,
  Modal,
  Pick,
  SearchBox,
} from "./ui";
import {
  ObjectBrowser,
  QuickLook,
  ServiceGlyph,
  FolderArtwork,
  ViewSwitcher,
  SortMenu,
  finderSpring,
  type BrowserItem,
} from "./finder";
import {
  sortObjects,
  pushBrowse,
  moveBrowse,
  type FinderSelection,
  type BrowseSnapshot,
  type BrowseHistory,
  type ViewMode,
  type SortOrder,
} from "./finder-state";
import "./style.css";
import "./finder.css";
import "./workspace.css";
import "./admin.css";
import {
  RightWorkspace,
  WorkspaceEditor,
  FormSection,
  PanelNotice,
  DraftGuard,
  CopyReference,
  WorkspaceActions,
} from "./workspace";
import {
  configDefault,
  configDraft,
  configChanged,
  validateConfig,
  parseConfig,
  validateConnect,
  type FieldErrors,
  type ConfigDraft,
} from "./workspace-state";

import { OverviewDashboard } from "./overview-dashboard";
import { ScopePicker } from "./scope-picker";
import { SettingsPage } from "./settings-page";
import { AnalyticsPage, RequestsPage } from "./activity-pages";
import { OrganizationPage, type OrganizationState } from "./organization-page";
import {
  AdminPanel,
  AdminTabs,
  DataTable,
  PageActions,
  Kpis,
} from "./admin-ui";
import {
  defaultQuery,
  inScope,
  legacyFacts,
  requestFixtures,
  memberFixtures,
  tenants,
  teams,
  statistics,
  type ManagementScope,
  type HistoryQuery,
  type RequestFact,
} from "./admin-state";
import { AssetLibrary, type LibraryNotice } from "./asset-library";
import { AssetDetail } from "./asset-detail";
import { NotificationCenter } from "./notification-center";
import {
  emptyAssetFilters,
  filterLibraryAssets,
  initialAssetLibrary,
} from "./asset-library-state";
import "./asset-library.css";
import "./components/ui/ui.css";
import "./layout.css";

const nav = navigation as {
  id: Page;
  label: string;
  icon: typeof Activity;
  group: string;
}[];
const scenarios: { value: Scenario; label: string }[] = [
  { value: "normal", label: "正常场景" },
  { value: "offline", label: "服务不可达" },
  { value: "auth", label: "认证失效" },
  { value: "permission", label: "权限不足" },
  { value: "capability", label: "能力缺失" },
  { value: "stale", label: "快照过期" },
  { value: "partial", label: "批量部分失败" },
  { value: "empty", label: "空工作空间" },
  { value: "conflict", label: "配置版本冲突" },
  { value: "save_error", label: "配置保存失败" },
];
type Selection = FinderSelection;
type Audit = {
  id: string;
  title: string;
  owner: string;
  project: string;
  env: Env;
  detail: string;
  time: string;
  outcome: string;
};
const initialAudit: Audit[] = [
  {
    id: "demo:receipt-039",
    title: "视频提交结果待确认",
    owner: "scaena",
    project: "rain",
    env: "main",
    detail: "原请求 demo:scaena:video-039 · 连接中断后未重新提交",
    time: "14:32:08",
    outcome: "unknown",
  },
  {
    id: "demo:receipt-012",
    title: "声音权利检查未通过",
    owner: "sonora",
    project: "rain",
    env: "main",
    detail: "缺少用途授权 · Provider 未执行",
    time: "14:28:46",
    outcome: "blocked",
  },
  {
    id: "demo:receipt-086",
    title: "图像候选进入审阅",
    owner: "eikona",
    project: "rain",
    env: "main",
    detail: "候选版本 v3 · 尚未生产采用",
    time: "14:26:12",
    outcome: "succeeded",
  },
];
const readPreference = (key: string, fallback: string) => {
  try {
    return localStorage.getItem("yeisme-control-center.ui." + key) || fallback;
  } catch {
    return fallback;
  }
};
const savePreference = (key: string, value: string) => {
  try {
    localStorage.setItem("yeisme-control-center.ui." + key, value);
  } catch {
    /* UI preference storage is optional. */
  }
};
export function DemoApp() {
  const [requestTab, setRequestTab] = useState("概况");
  const [management, setManagement] = useState<{
    perspective: ManagementScope["perspective"];
    tenant: string;
    team: string;
  }>({ perspective: "team", tenant: "studio", team: "all" });
  const [historical, setHistorical] = useState(requestFixtures);
  const [organization, setOrganization] = useState<OrganizationState>({
    members: memberFixtures,
    archived: [],
    quotas: {},
    events: [],
  });
  const [historyQuery, setHistoryQuery] = useState<HistoryQuery>({
    ...defaultQuery,
  });
  const [activityTab, setActivityTab] = useState("queue");
  const [auditID, setAuditID] = useState<string | null>(null);
  const [adminDirty, setAdminDirty] = useState(false);
  const [library, setLibrary] = useState(initialAssetLibrary);
  const [assetFilters, setAssetFilters] = useState({ ...emptyAssetFilters });
  const [notices, setNotices] = useState<LibraryNotice[]>([]);
  const noticeSequence = useRef(0);
  const adminDiscard = useRef<(() => void) | undefined>(undefined);
  const [initial, setLaunch] = useState(() =>
    launchContext(location.hash || "#/overview"),
  );
  const [page, setPage] = useState<Page>(initial.page),
    [env, setEnv] = useState<Env>(initial.env),
    [project, setProject] = useState(initial.project),
    [role, setRole] = useState<Role>("admin"),
    [scenario, setScenario] = useState<Scenario>("normal");
  const [theme, setTheme] = useState(() => readPreference("theme", "light")),
    [collapsed, setCollapsed] = useState(
      () => readPreference("collapsed", "false") === "true",
    ),
    [mobileNav, setMobileNav] = useState(false);
  const [services, setServices] = useState(baseServices),
    [operations, setOperations] = useState(initialOperations),
    [approvals, setApprovals] = useState(initialApprovals),
    [audit, setAudit] = useState(initialAudit);
  const [selection, setSelection] = useState<Selection>(
      initial.sourceTask
        ? { kind: "external", id: initial.sourceTask }
        : initial.service && serviceById(initial.service)
          ? { kind: "service", id: initial.service }
          : null,
    ),
    [serviceTab, setServiceTab] = useState("概况");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [checked, setChecked] = useState<string[]>([]),
    [toast, setToast] = useState(""),
    [pending, setPending] = useState("");
  const [searchOpen, setSearchOpen] = useState(false),
    [globalQuery, setGlobalQuery] = useState(""),
    [connectOpen, setConnectOpen] = useState(false),
    [configOpen, setConfigOpen] = useState(false),
    [decision, setDecision] = useState<{ kind: string; id: string } | null>(
      null,
    ),
    [ack, setAck] = useState(false);
  const [configs, setConfigs] = useState<
      Record<
        string,
        {
          concurrency: number;
          timeout: number;
          profile: string;
          revision: number;
        }
      >
    >({}),
    [draft, setDraft] = useState<ConfigDraft>(configDraft(configDefault)),
    [configStep, setConfigStep] = useState("edit"),
    [formError, setFormError] = useState(""),
    [configService, setConfigService] = useState("scaena");
  const [connect, setConnect] = useState({
      service: "eikona",
      name: "",
      ref: "connection://lan/eikona",
      credential: "credentialctl://team/eikona-read",
      step: 0,
    }),
    [batchResult, setBatchResult] = useState<
      { id: string; ok: boolean; reason: string }[] | null
    >(null),
    [decisionNote, setDecisionNote] = useState("");
  const [detailRead, setDetailRead] = useState<"ready" | "loading" | "error">(
    "ready",
  );
  const detailReadTarget = useRef(selection?.id);
  detailReadTarget.current = selection?.id;
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [leaveOpen, setLeaveOpen] = useState(false),
    [workspaceHidden, setWorkspaceHidden] = useState(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const [receipt, setReceipt] = useState<{
    title: string;
    ref: string;
    details: { label: string; value: string }[];
    target: Selection;
    tab?: string;
  } | null>(null);
  const [configBase, setConfigBase] = useState(configDefault);
  const editorActive = configOpen || connectOpen || !!decision;
  const originalDirty = configOpen
    ? configChanged(draft, configBase)
    : connectOpen
      ? !!(
          connect.name.trim() ||
          connect.step ||
          connect.ref !== "connection://lan/" + connect.service ||
          connect.credential !==
            "credentialctl://team/" + connect.service + "-read"
        )
      : !!decision && (ack || !!decisionNote.trim());
  const dirty = originalDirty || adminDirty;
  const resetEditor = () => {
    setAuditID(null);
    adminDiscard.current?.();
    setAdminDirty(false);
    setConfigOpen(false);
    setConnectOpen(false);
    setDecision(null);
    setReceipt(null);
    setBatchResult(null);
    setFieldErrors({});
    setFormError("");
    setAck(false);
    setDecisionNote("");
    setWorkspaceHidden(false);
  };
  const guard = (action: () => void) => {
    if (pending && editorActive) {
      notify("操作正在处理，可收起工作区；完成后仍可查看原操作回执。");
      return;
    }
    if (dirty) {
      pendingNavigation.current = () => {
        resetEditor();
        action();
      };
      setLeaveOpen(true);
      return;
    }
    resetEditor();
    action();
  };
  useEffect(() => {
    const leaving = (e: BeforeUnloadEvent) => {
      if (dirty && !pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", leaving);
    return () => removeEventListener("beforeunload", leaving);
  }, [dirty, pending]);
  const busyRef = useRef(new Set<string>()),
    scopeRef = useRef(0),
    focusRef = useRef<HTMLElement | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(!!selection),
    [demoOpen, setDemoOpen] = useState(false);
  const [quickId, setQuickId] = useState<string | null>(null),
    [quickOrigin, setQuickOrigin] = useState<{ x: number; y: number } | null>(
      null,
    );
  const [views, setViews] = useState<Record<string, ViewMode>>(() => ({
    projects:
      readPreference("view.projects", "icons") === "list" ? "list" : "icons",
    assets:
      readPreference("view.assets", "icons") === "list" ? "list" : "icons",
  }));
  const [sorts, setSorts] = useState<Record<string, SortOrder>>({});
  const [viewport, setViewport] = useState(innerWidth);
  const mainRef = useRef<HTMLElement | null>(null);
  const browse = useRef<BrowseHistory>({
    entries: [
      {
        page,
        env,
        project,
        query: "",
        filter: "all",
        selection,
        scroll: 0,
        inspector: !!selection,
      },
    ],
    index: 0,
  });
  const [, updateHistory] = useState(0);
  const reduced = useReducedMotion();
  const rail = collapsed && viewport >= 768;
  const sidebarMotion = useSpring({
    width: viewport < 768 ? 288 : rail ? 48 : 232,
    config: finderSpring,
    immediate: !!reduced,
  });
  useEffect(() => {
    const resize = () => setViewport(innerWidth);
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);
  const view = views[page] || "list";
  const sort = sorts[page] || "name-asc";
  const setView = (value: ViewMode) => {
    setViews((v) => ({ ...v, [page]: value }));
    savePreference("view." + page, value);
  };
  const snapshot = (): BrowseSnapshot => ({
    page,
    env,
    project,
    query,
    filter,
    selection,
    scroll: window.scrollY,
    inspector: inspectorOpen,
  });
  const managementScope: ManagementScope = {
    ...management,
    actor: "yeisme",
    env,
    project,
    role,
  };
  const managementKey = `${management.perspective}:${management.tenant}:${management.team}:${env}:${role}:${scenario}`;
  const scopeKey = `${managementKey}:${project}:${scopeRef.current}`;
  const facts = useMemo(
    () => [...legacyFacts(operations), ...historical],
    [operations, historical],
  );
  const requestRows =
    scenario === "empty"
      ? []
      : facts.filter((r) => inScope(managementScope, r));
  const availableProjects = projects.filter(
    (p) =>
      (management.tenant === "studio" || management.tenant === "all") &&
      (management.team === "all" ||
        (p.id === "research"
          ? management.team === "research"
          : management.team === "production")),
  );
  const updateFact = (row: RequestFact, next?: RequestFact) => {
    if (!canWrite(role, scenario)) return;
    setHistorical((v) =>
      next
        ? v.some((r) => r.id === next.id)
          ? v
          : [next, ...v]
        : v.map((r) => (r.id === row.id ? row : r)),
    );
  };
  const changeManagement = (
    kind: "perspective" | "tenant" | "team",
    value: string,
  ) => {
    invalidate();
    setProject("all");
    setHistoryQuery({ ...defaultQuery });
    setManagement((m) => ({
      ...m,
      [kind]: value,
      ...(kind === "tenant" ? { team: "all" } : {}),
      ...(kind === "perspective" && value !== "platform" && m.tenant === "all"
        ? { tenant: "studio", team: "all" }
        : {}),
    }));
    browse.current = {
      entries: [
        {
          ...snapshot(),
          project: "all",
          selection: null,
          inspector: false,
          query: "",
          filter: "all",
          scroll: 0,
        },
      ],
      index: 0,
    };
    writeHash(page, "all");
  };
  const notify = (text: string) => {
    setToast(text);
    const warning = /失败|不允许|不能|冲突|不可|已不存在/.test(text);
    const notice: LibraryNotice = {
      id: "notice-" + ++noticeSequence.current,
      title: warning ? "操作需要留意" : "工作空间动态",
      text,
      tone: warning ? "warning" : "success",
    };
    setNotices((items) => [notice, ...items].slice(0, 50));
  };
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    savePreference("theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    savePreference("collapsed", String(collapsed));
  }, [collapsed]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const invalidate = (resetLibrary = true) => {
    scopeRef.current++;
    if (resetLibrary) {
      setLibrary(initialAssetLibrary());
      setNotices([]);
    }
    setAssetFilters({ ...emptyAssetFilters });
    setDetailRead("ready");
    setHistoryQuery({ ...defaultQuery });
    pendingNavigation.current = null;
    setLeaveOpen(false);
    resetEditor();
    setDraft(configDraft(configDefault));
    setConnect({
      service: "eikona",
      name: "",
      ref: "connection://lan/eikona",
      credential: "credentialctl://team/eikona-read",
      step: 0,
    });
    setQuickId(null);
    setInspectorOpen(false);
    setSelection(null);
    setChecked([]);
    setQuery("");
    setFilter("all");
    setConfigOpen(false);
    setConnectOpen(false);
    setDecision(null);
    setBatchResult(null);
    setSearchOpen(false);
    setGlobalQuery("");
    setPending("");
    setFormError("");
    setToast("");
  };
  const changeScope = (
    kind: "env" | "project" | "role" | "scenario",
    value: string,
  ) => {
    invalidate();
    if (kind === "env") setEnv(value as Env);
    if (kind === "project") setProject(value);
    if (kind === "role") {
      setRole(value as Role);
      if (value !== "admin")
        setManagement({
          perspective: value === "viewer" ? "personal" : "team",
          tenant: "studio",
          team: "all",
        });
    }
    if (kind === "scenario") setScenario(value as Scenario);
    const next: BrowseSnapshot = {
      page,
      env: kind === "env" ? (value as Env) : env,
      project: kind === "project" ? value : project,
      query: "",
      filter: "all",
      selection: null,
      scroll: 0,
      inspector: false,
    };
    browse.current =
      kind === "project"
        ? pushBrowse(browse.current, snapshot(), next)
        : { entries: [next], index: 0 };
    updateHistory((v) => v + 1);
    writeHash(next.page, next.project, next.env);
    window.scrollTo(0, 0);
  };
  function writeHash(p: Page, targetProject: string, targetEnv = env) {
    const q = new URLSearchParams({ env: targetEnv, project: targetProject });
    if (initial.source) {
      q.set("source", "frame");
      if (initial.sourceProject) q.set("source_project", initial.sourceProject);
      if (initial.sourceTask) q.set("source_task", initial.sourceTask);
      if (initial.sourceShot) q.set("source_shot", initial.sourceShot);
      q.set("return_page", initial.returnPage);
    }
    history.replaceState(null, "", `#/${p}?${q}`);
  }
  const goNow = (p: Page, s?: Selection, targetProject = project) => {
    const next: BrowseSnapshot = {
      page: p,
      env,
      project: targetProject,
      query: "",
      filter: "all",
      selection: s || null,
      scroll: 0,
      inspector: !!s,
    };
    browse.current = pushBrowse(browse.current, snapshot(), next);
    updateHistory((v) => v + 1);
    if (targetProject !== project) invalidate();
    setPage(p);
    setDetailRead("ready");
    setProject(targetProject);
    setQuery("");
    setFilter("all");
    setChecked([]);
    setSelection(s || null);
    setInspectorOpen(!!s);
    setQuickId(null);
    setServiceTab("概况");
    setMobileNav(false);
    setSearchOpen(false);
    writeHash(p, targetProject);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  };
  const go = (p: Page, s?: Selection, targetProject = project) =>
    guard(() => goNow(p, s, targetProject));
  const travelNow = (delta: number) => {
    const moved = moveBrowse(browse.current, snapshot(), delta);
    if (!moved) return;
    invalidate(
      moved.snapshot.project !== project || moved.snapshot.env !== env,
    );
    browse.current = moved.history;
    updateHistory((v) => v + 1);
    const n = moved.snapshot;
    setPage(n.page);
    setProject(n.project);
    setQuery(n.query);
    setFilter(n.filter);
    setSelection(n.selection);
    setInspectorOpen(n.inspector);
    setServiceTab("概况");
    writeHash(n.page, n.project);
    requestAnimationFrame(() => window.scrollTo(0, n.scroll));
  };
  const travel = (delta: number) => guard(() => travelNow(delta));
  const travelRef = useRef(travel);
  travelRef.current = travel;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        ["ArrowLeft", "ArrowRight"].includes(event.key) &&
        !document.querySelector('[role="dialog"],[role="alertdialog"]')
      ) {
        event.preventDefault();
        travelRef.current(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  const hashNavigation = useRef<() => void>(() => {});
  hashNavigation.current = () => {
    const c = launchContext(location.hash),
      requested = location.hash;
    const apply = () => {
      setLaunch(c);
      invalidate(c.env !== env || c.project !== project);
      setPage(c.page);
      setEnv(c.env);
      setProject(c.project);
      const selected: Selection = c.sourceTask
        ? { kind: "external", id: c.sourceTask }
        : c.service
          ? { kind: "service", id: c.service }
          : null;
      setSelection(selected);
      setInspectorOpen(!!selected);
      browse.current = {
        entries: [
          {
            page: c.page,
            env: c.env,
            project: c.project,
            query: "",
            filter: "all",
            selection: selected,
            scroll: 0,
            inspector: !!selected,
          },
        ],
        index: 0,
      };
      updateHistory((v) => v + 1);

      history.replaceState(null, "", requested);
    };
    if (c.env !== env || c.project !== project) {
      apply();
      return;
    }
    writeHash(page, project, env);
    guard(apply);
  };
  useEffect(() => {
    const changed = () => hashNavigation.current();
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  const choose = (s: Selection) => {
    if (s?.id === selection?.id) return;
    guard(() => {
      setSelection(s);
      setDetailRead("ready");
      setServiceTab("概况");
    });
  };
  const select = (s: Selection) =>
    guard(() => {
      focusRef.current = document.activeElement as HTMLElement;
      setSelection(s);
      setInspectorOpen(true);
      setDetailRead("ready");
      setServiceTab("概况");
    });
  const closeInspector = () => {
    if (pending) {
      setWorkspaceHidden(true);
      setInspectorOpen(false);
      return;
    }
    guard(() => {
      setInspectorOpen(false);
    });
  };
  const returnDetail = () => {
    resetEditor();
    setInspectorOpen(!!selection);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          ".workspace-footer button:not(:disabled),.workspace-heading h2",
        )
        ?.focus(),
    );
  };
  const openDecision = (kind: string, id: string) =>
    guard(() => {
      setDecision({ kind, id });
      setInspectorOpen(true);
      setAck(false);
      setDecisionNote("");
      setFieldErrors({});
    });
  const openConnect = () =>
    guard(() => {
      focusRef.current = document.activeElement as HTMLElement;
      setConnect({
        service: "eikona",
        name: "",
        ref: "connection://lan/eikona",
        credential: "credentialctl://team/eikona-read",
        step: 0,
      });
      setConnectOpen(true);
      setInspectorOpen(true);
    });
  const writable = canWrite(role, scenario),
    adminWritable = canWrite(role, scenario, true);
  const scope = project === "all" ? "全部项目" : projectName(project);
  const scoped = scopedOperations(operations, env, project, scenario).filter(
    (o) => requestRows.some((r) => r.id === o.id),
  );
  const scopedAssets =
    scenario === "empty" || env === "staging"
      ? []
      : assets.filter(
          (a) =>
            (project === "all" || a.project === project) &&
            availableProjects.some((p) => p.id === a.project) &&
            (management.perspective !== "personal" ||
              scoped.some((o) => o.asset === a.id)),
        );
  const scopedApprovals =
    scenario === "empty" || env === "staging"
      ? []
      : approvals.filter(
          (a) =>
            (project === "all" || a.project === project) &&
            availableProjects.some((p) => p.id === a.project) &&
            (management.perspective !== "personal" ||
              scoped.some((o) => o.id === a.operation)),
        );
  const scopedServices =
    scenario === "empty" || management.tenant === "north"
      ? []
      : services.filter(
          (s) =>
            (s.env || "main") === env &&
            (project === "all" ||
              s.projectRefs?.includes(project) ||
              projects.find((p) => p.id === project)?.owners.includes(s.id)),
        );
  const scopedAudit =
    scenario === "empty"
      ? []
      : audit.filter(
          (a) =>
            a.env === env &&
            (project === "all" || a.project === project) &&
            availableProjects.some((p) => p.id === a.project) &&
            (management.perspective !== "personal" ||
              scoped.some((o) => o.owner === a.owner)),
        );
  const task =
    selection?.kind === "task"
      ? scoped.find((t) => t.id === selection.id)
      : undefined;
  const service =
    selection?.kind === "service"
      ? scopedServices.find((s) => s.id === selection.id)
      : undefined;
  const asset =
    selection?.kind === "asset"
      ? scopedAssets.find((a) => a.id === selection.id)
      : undefined;
  const approval =
    selection?.kind === "approval"
      ? scopedApprovals.find((a) => a.id === selection.id)
      : undefined;
  const record = (
    title: string,
    owner: string,
    projectId: string,
    detail: string,
    outcome = "succeeded",
  ) =>
    setAudit((v) => [
      {
        id: "demo:receipt-" + Date.now(),
        title,
        owner,
        project: projectId,
        env,
        detail,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        outcome,
      },
      ...v,
    ]);
  const run = async (key: string, fn: () => void, admin = false) => {
    if (!canWrite(role, scenario, admin)) {
      notify("当前身份或服务状态不允许此操作。");
      return;
    }
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    setPending(key);
    const version = scopeRef.current;
    try {
      await new Promise((r) => setTimeout(r, 450));
      if (version !== scopeRef.current) return;
      fn();
    } finally {
      busyRef.current.delete(key);
      if (version === scopeRef.current) setPending("");
    }
  };
  const perform = (op: Operation, action: string) =>
    run(op.id, () => {
      if (action === "retry") {
        const child = {
          ...op,
          id: op.id + "-attempt-" + (op.attempt + 1),
          parent: op.id,
          attempt: op.attempt + 1,
          state: "queued" as const,
          native: "queued",
          reason: "已创建一次经批准的新尝试；保留原失败任务。",
          cost: "估算上限 $0.05",
        };
        if (operations.some((x) => x.id === child.id)) {
          setSelection({ kind: "task", id: child.id });
          setDecision(null);
          notify("已找到同一次批准的新尝试，没有重复创建。");
          return;
        }
        setOperations((v) => [child, ...v]);
        setSelection({ kind: "task", id: child.id });
        record(
          "新尝试已批准",
          op.owner,
          op.project,
          child.id + " · 原任务 " + op.id,
        );
        notify("演示：新尝试已排队，原失败任务已保留。");
      } else {
        setOperations((v) =>
          v.map((t) => (t.id === op.id ? mutateOperation(t, action) : t)),
        );
        record(
          action === "reconcile" ? "原请求结果已恢复" : "任务取消已确认",
          op.owner,
          op.project,
          op.id,
        );
        notify(
          action === "reconcile"
            ? "已恢复同一个任务的结果，没有重新生成。"
            : "演示任务已取消。",
        );
      }
      if (action === "retry" || action === "cancel")
        setReceipt({
          title: action === "retry" ? "新尝试已批准" : "取消结果已确认",
          ref:
            action === "retry" ? op.id + "-attempt-" + (op.attempt + 1) : op.id,
          target: {
            kind: "task",
            id:
              action === "retry"
                ? op.id + "-attempt-" + (op.attempt + 1)
                : op.id,
          },
          details: [
            { label: "原任务", value: op.id },
            {
              label: "费用",
              value: action === "retry" ? "估算上限 $0.05" : op.cost,
            },
            { label: "状态", value: action === "retry" ? "已排队" : "已取消" },
          ],
        });
      setDecision(null);
      setAck(false);
    });
  const decide = () => {
    if (!decision) return;
    const op = scoped.find((x) => x.id === decision.id);
    if (op) {
      perform(op, decision.kind);
      return;
    }
    const a = scopedApprovals.find((x) => x.id === decision.id);
    if (!a) return;
    run(a.id, () => {
      setApprovals((v) =>
        v.map((x) =>
          x.id === a.id
            ? {
                ...x,
                status: decision.kind === "approve" ? "approved" : "rejected",
              }
            : x,
        ),
      );
      if (a.operation && a.type === "结果审阅" && decision.kind === "approve")
        setOperations((v) =>
          v.map((o) =>
            o.id === a.operation
              ? {
                  ...o,
                  state: "succeeded",
                  native: "review_accepted",
                  reason: "演示审阅已接受；生产采用仍是独立决定。",
                }
              : o,
          ),
        );
      record(
        decision.kind === "approve" ? "审阅批准" : "审阅拒绝",
        a.owner,
        a.project,
        a.title + " · " + (decisionNote || "已确认指定版本"),
      );
      notify("演示决定已记录，实际授权仍由 owner 执行。");
      setReceipt({
        title:
          decision.kind === "approve" ? "审阅决定已批准" : "审阅决定已拒绝",
        ref: a.id,
        target: { kind: "approval", id: a.id },
        details: [
          { label: "对应对象", value: a.title },
          { label: "决定范围", value: projectName(a.project) },
          {
            label: "结果",
            value: decision.kind === "approve" ? "已批准" : "已拒绝",
          },
          { label: "说明", value: decisionNote || "已确认指定版本" },
        ],
      });
      setDecision(null);
      setAck(false);
      setDecisionNote("");
    });
  };
  const download = (
    name: string,
    text: string,
    mime = "text/markdown;charset=utf-8",
  ) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openConfig = (id: string) =>
    guard(() => {
      const value = configs[id] || configDefault;
      setConfigService(id);
      setConfigBase(value);
      setDraft(configDraft(value));
      setConfigStep("edit");
      setFormError("");
      setFieldErrors({});
      setConfigOpen(true);
      setInspectorOpen(true);
    });
  const submitConfig = () => {
    const value = parseConfig(draft);
    if (!value || !configChanged(draft, configBase)) return;
    run(
      "config:" + configService,
      () => {
        if (scenario === "save_error") {
          setFormError("保存失败。演示草稿与原配置已保留，请恢复连接后重试。");
          return;
        }
        const current = configs[configService] || {
          concurrency: 4,
          timeout: 90,
          profile: "balanced",
          revision: 1,
        };
        if (scenario === "conflict" && draft.revision === 1) {
          setConfigs((v) => ({
            ...v,
            [configService]: { ...current, revision: 2, concurrency: 6 },
          }));
          setFormError(
            "配置版本冲突：服务端已更新到 r2。先读取新版本，草稿不会丢失。",
          );
          return;
        }
        if (current.revision !== draft.revision) {
          setFormError("配置版本已变化，请读取新版本后再次预览。");
          return;
        }
        setConfigs((v) => ({
          ...v,
          [configService]: { ...value, revision: draft.revision + 1 },
        }));
        record(
          "配置更新并回读",
          configService,
          project === "all" ? "rain" : project,
          `r${draft.revision} → r${draft.revision + 1} · 并发 ${draft.concurrency}`,
        );
        setConfigOpen(false);
        setReceipt({
          title: "配置已更新并回读",
          ref: "demo:config:" + configService + ":r" + (draft.revision + 1),
          target: { kind: "service", id: configService },
          tab: "配置",
          details: [
            { label: "有效版本", value: "r" + (draft.revision + 1) },
            { label: "并发上限", value: String(value.concurrency) },
            { label: "请求超时", value: value.timeout + " 秒" },
            { label: "模型配置引用", value: value.profile },
          ],
        });
        notify(`演示配置已回读为 r${draft.revision + 1}；未修改远程服务。`);
      },
      true,
    );
  };
  const refresh = () => {
    if (!selection) {
      notify("已读取演示快照；没有探测真实服务或调用 Provider。");
      return;
    }
    const epoch = scopeRef.current,
      target = selection.id;
    setDetailRead("loading");
    setTimeout(() => {
      if (epoch !== scopeRef.current || detailReadTarget.current !== target)
        return;
      setDetailRead(scenario === "offline" ? "error" : "ready");
      notify(
        scenario === "offline"
          ? "读取失败，保留最后快照。"
          : "已读取演示快照；没有探测真实服务或调用 Provider。",
      );
    }, 320);
  };
  const stateBanner =
    scenario === "offline"
      ? "服务连接中断，当前显示最后一次快照。写操作暂不可用。"
      : scenario === "auth"
        ? "服务认证已失效。联系管理员修复授权，当前不接受写操作。"
        : scenario === "permission"
          ? "当前范围授权不足。写操作已关闭，以下为受限演示视图。"
          : scenario === "stale"
            ? "快照已过期 · 最近检查 13:12。以下内容不代表实时状态。"
            : scenario === "capability"
              ? "部分能力尚未接入。相关操作显示所需合同与恢复入口。"
              : "";
  const focusError = (errors: FieldErrors) => {
    setFieldErrors(errors);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('.right-workspace [aria-invalid="true"]')
        ?.focus(),
    );
  };
  const blurConfig = (name: string) =>
    setFieldErrors((e) => ({
      ...e,
      [name]: validateConfig(draft)[name] || "",
    }));
  const changeDraft = (
    name: "concurrency" | "timeout" | "profile",
    value: string,
  ) => {
    setDraft((d) => ({ ...d, [name]: value }));
    setFieldErrors((e) => ({ ...e, [name]: "" }));
    setFormError("");
  };
  const changeConnection = (
    name: "name" | "ref" | "credential",
    value: string,
  ) => {
    setConnect((c) => ({ ...c, [name]: value }));
    setFieldErrors((e) => ({ ...e, [name]: "" }));
    setFormError("");
  };
  const advanceConfig = () => {
    const errors = validateConfig(draft);
    if (Object.keys(errors).length) {
      focusError(errors);
      return;
    }
    if (!configChanged(draft, configBase)) return;
    setFieldErrors({});
    setFormError("");
    setConfigStep("preview");
  };
  const advanceConnection = () => {
    const errors = validateConnect(connect, connect.step);
    if (Object.keys(errors).length) {
      focusError(errors);
      return;
    }
    setFieldErrors({});
    setFormError("");
    if (connect.step < 2) {
      setConnect((c) => ({ ...c, step: c.step + 1 }));
      return;
    }
    run(
      "connect",
      () => {
        const original = serviceById(connect.service)!;
        const id = original.id + "-design-" + Date.now();
        setServices((v) => [
          ...v,
          {
            ...original,
            id,
            name: connect.name.trim(),
            env,
            projectRefs:
              project === "all" ? projects.map((p) => p.id) : [project],
            connectionRef: connect.ref,
            credentialRef: connect.credential,
            status: "needs_contract",
            latency: null,
          },
        ]);
        record(
          "接入演示实例",
          connect.service,
          project === "all" ? "rain" : project,
          connect.ref + " · 待真实认证",
        );
        setConnectOpen(false);
        setSelection({ kind: "service", id });
        setServiceTab("概况");
        setReceipt({
          title: "演示实例已保存",
          ref: id,
          target: { kind: "service", id },
          details: [
            { label: "实例名称", value: connect.name.trim() },
            { label: "连接引用", value: connect.ref },
            { label: "接入状态", value: "待真实认证与能力接线" },
          ],
        });
        notify("演示实例已保存为待接入，未连接真实服务。");
      },
      true,
    );
  };
  const submitDecision = () => {
    const errors: FieldErrors = {};
    if (decision?.kind === "reject" && !decisionNote.trim())
      errors.reason = "请填写拒绝原因。";
    if (!ack)
      errors.ack =
        "请确认影响范围" +
        (decision?.kind === "retry" ? "与可能产生的新费用" : "") +
        "。";
    if (Object.keys(errors).length) {
      focusError(errors);
      return;
    }
    setFieldErrors({});
    decide();
  };
  const currentNav = nav.find((n) => n.id === page)!;
  const status = (s: Service) =>
    scenario === "offline" && s.kind === "remote"
      ? "unknown"
      : scenario === "auth" && s.kind === "remote"
        ? "blocked"
        : scenario === "capability" && s.kind === "remote"
          ? "needs_contract"
          : s.status;
  const filteredTasks = sortObjects(
    scoped.map((t) => ({
      ...t,
      name: t.title,
      status: t.state,
      updated: t.time,
    })),
    sort,
  ).filter(
    (t) =>
      (filter === "all" || t.state === filter) &&
      `${t.title}${t.id}${t.owner}`.toLowerCase().includes(query.toLowerCase()),
  );
  const projectItems: BrowserItem[] =
    scenario === "empty" || env === "staging"
      ? []
      : availableProjects
          .filter(
            (p) =>
              (project === "all" || p.id === project) && p.name.includes(query),
          )
          .map((p) => ({
            id: p.id,
            kind: "project",
            name: p.name,
            type: p.type,
            subtitle: p.subtitle,
            count: `${scoped.filter((t) => t.project === p.id).length} 项任务 · ${scopedAssets.filter((a) => a.project === p.id).length} 项资产`,
            detail: p.subtitle,
          }));
  const assetItems: BrowserItem[] = filterLibraryAssets(
    scopedAssets,
    library,
    assetFilters,
    filter,
    query,
  ).map((a) => ({
    id: a.id,
    kind: "asset",
    name: a.name,
    type: a.type,
    subtitle: `${serviceById(a.owner)?.name} · ${a.version}`,
    status: a.state,
    image: a.image ? "./media/" + a.image : undefined,
    detail:
      a.type === "音频"
        ? "审听媒体待接入。当前展示版本、来源与交接信息，不提供模拟播放。"
        : `${a.source} · ${a.handoff}`,
    owner: a.owner,
  }));
  const visibleServices = sortObjects(
    scopedServices.map((s) => ({ ...s, type: s.group })),
    sort,
  ).filter(
    (s) =>
      (filter === "all" || s.group === filter) &&
      `${s.name}${s.description}${s.capabilities.join("")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const browseItems: BrowserItem[] =
    page === "projects"
      ? sortObjects(projectItems, sort)
      : page === "assets"
        ? sortObjects(assetItems, sort)
        : page === "services"
          ? visibleServices.map((s) => ({
              id: s.id,
              kind: "service" as const,
              name: s.name,
              type: s.group,
              subtitle: s.description,
              status: labels[status(s)] || status(s),
              service: s.id,
              detail: s.gap,
            }))
          : page === "tasks"
            ? filteredTasks.map((t) => ({
                id: t.id,
                kind: "task" as const,
                name: t.title,
                type: serviceById(t.owner)?.name || t.owner,
                subtitle: projectName(t.project),
                status: labels[t.state],
                detail: t.reason,
                updated: t.time,
              }))
            : [];
  const visibleIds = browseItems.map((i) => i.id).join("|");
  useEffect(() => {
    if (
      selection &&
      selection.kind ===
        (
          {
            projects: "project",
            assets: "asset",
            services: "service",
            tasks: "task",
          } as Partial<Record<Page, string>>
        )[page] &&
      !browseItems.some((i) => i.id === selection?.id)
    ) {
      setSelection(null);
      setQuickId(null);
      setInspectorOpen(false);
    }
  }, [visibleIds, page]);
  const quickItem = browseItems.find((i) => i.id === quickId) || null;
  const selectedItem = browseItems.find((i) => i.id === selection?.id) || null;
  const quick = (item: BrowserItem, rect?: DOMRect) => {
    choose({ kind: item.kind, id: item.id });
    rect ||= document
      .querySelector<HTMLElement>(`[data-object-id="${CSS.escape(item.id)}"]`)
      ?.getBoundingClientRect();
    setQuickOrigin(
      rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null,
    );
    setQuickId(item.id);
  };
  const openItem = (item: BrowserItem) => {
    setQuickId(null);
    if (item.kind === "project") go("tasks", undefined, item.id);
    else select({ kind: item.kind, id: item.id });
  };
  const cycleQuick = (delta: number) => {
    const index = browseItems.findIndex((i) => i.id === quickId);
    const item =
      browseItems[Math.max(0, Math.min(browseItems.length - 1, index + delta))];
    if (item) {
      setQuickId(item.id);
      choose({ kind: item.kind, id: item.id });
    }
  };
  const browserProps = {
    items: browseItems,
    view,
    selected: selection?.id || null,
    onSelect: (i: BrowserItem) => choose({ kind: i.kind, id: i.id }),
    onOpen: openItem,
    onQuickLook: quick,
    onInfo: (i: BrowserItem) => select({ kind: i.kind, id: i.id }),
    label: page === "projects" ? "项目浏览器" : "资产浏览器",
  };
  const renderTaskTable = (rows: Operation[], compact = false) => (
    <DataTable
      id={"queue." + managementKey + (compact ? ".compact" : "")}
      label="任务列表"
      presentation={compact ? "embedded" : "page"}
      rows={rows}
      selection={checked}
      onSelection={setChecked}
      onOpen={(t) => select({ kind: "task", id: t.id })}
      filters={
        compact ? undefined : (
          <>
            <SearchBox
              value={query}
              onChange={setQuery}
              label="搜索任务"
              placeholder="搜索任务或引用"
            />
            <Pick
              label="任务状态"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "全部状态" },
                ...[
                  "unknown",
                  "failed",
                  "running",
                  "queued",
                  "waiting_review",
                  "succeeded",
                  "cancelled",
                ].map((s) => ({ value: s, label: labels[s] })),
              ]}
            />
          </>
        )
      }
      actions={
        compact
          ? undefined
          : () => (
              <Button
                disabled={!writable || !!pending || editorActive}
                onClick={() =>
                  run("batch", () => {
                    const results = checked.map((id) => {
                      const t = scoped.find((o) => o.id === id)!;
                      const ok = t.state === "unknown";
                      if (ok)
                        setOperations((v) =>
                          v.map((o) =>
                            o.id === id ? mutateOperation(o, "reconcile") : o,
                          ),
                        );
                      return {
                        id,
                        ok,
                        reason: ok
                          ? "原任务结果已恢复；没有重发"
                          : "此任务不支持原结果对账，保留原状态",
                      };
                    });
                    setBatchResult(results);
                    record(
                      "批量对账完成",
                      "scaena",
                      project === "all" ? "rain" : project,
                      `${results.filter((r) => r.ok).length} 成功 / ${results.filter((r) => !r.ok).length} 未处理`,
                      "partial",
                    );
                  })
                }
              >
                查询原结果
              </Button>
            )
      }
      columns={[
        {
          id: "title",
          label: "任务 / 所属项目",
          primary: true,
          value: (t) => t.title,
          render: (t) => (
            <>
              <button
                className="entity-link"
                onClick={() => select({ kind: "task", id: t.id })}
              >
                {t.title}
              </button>
              <div className="cell-meta">
                {projectName(t.project)} · <code>{t.id.split(":").at(-1)}</code>
              </div>
            </>
          ),
        },
        {
          id: "owner",
          label: "服务",
          value: (t) => serviceById(t.owner)?.name || t.owner,
        },
        {
          id: "state",
          label: "状态",
          value: (t) => labels[t.state],
          render: (t) => <Badge state={t.state} />,
        },
        { id: "time", label: "最近更新", value: (t) => t.time },
      ]}
    />
  );
  const Section = ({
    title,
    children,
    action,
  }: {
    title: string;
    children: React.ReactNode;
    action?: React.ReactNode;
  }) => (
    <section className="section">
      <div className="section-header">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
  const activeCount = scoped.filter(
    (t) => t.state === "running" || t.state === "queued",
  ).length;
  let content: React.ReactNode;
  if (page === "overview")
    content = (
      <>
        <div className="overview-grid">
          <Section
            title="现在需要关注"
            action={
              <Button
                variant="ghost small"
                onClick={() => {
                  go("tasks");
                  setFilter("unknown");
                }}
              >
                查看全部
                <ArrowRight size={14} />
              </Button>
            }
          >
            <div className="attention-list">
              {scoped
                .filter((t) => ["unknown", "failed"].includes(t.state))
                .slice(0, 3)
                .map((t) => (
                  <button
                    key={t.id}
                    className="attention-row"
                    onClick={() => select({ kind: "task", id: t.id })}
                  >
                    <span className={"attention-icon " + t.state}>
                      {t.state === "unknown" ? (
                        <Clock3 size={18} />
                      ) : (
                        <CircleAlert size={18} />
                      )}
                    </span>
                    <span>
                      <strong>{t.title}</strong>
                      <p>{t.reason}</p>
                      <small>
                        {serviceById(t.owner)?.name} · {projectName(t.project)}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              {!scoped.some((t) => ["unknown", "failed"].includes(t.state)) && (
                <Empty
                  title="当前没有待处理异常"
                  description="新异常会出现在当前范围内。"
                />
              )}
            </div>
          </Section>
          <Section
            title="核心服务"
            action={
              <Button variant="ghost small" onClick={() => go("services")}>
                管理服务
                <ArrowRight size={14} />
              </Button>
            }
          >
            <div className="service-pulse">
              {scopedServices
                .filter((s) => ["scaena", "eikona", "sonora"].includes(s.id))
                .map((s) => (
                  <button
                    className="pulse-row"
                    key={s.id}
                    onClick={() => {
                      select({ kind: "service", id: s.id });
                    }}
                  >
                    <span>
                      <strong>{s.name}</strong>
                      <small>{s.description.split("、")[0]}</small>
                    </span>
                    <Badge state={status(s)} />
                  </button>
                ))}
              {!visibleServices.length && (
                <Empty
                  title="尚未接入服务"
                  description="选择主环境查看设计样例。"
                />
              )}
            </div>
            <div className="section-foot">
              <span className="muted">最近快照 14:35</span>
              <button className="text-button" onClick={refresh}>
                <RefreshCw size={13} />
                刷新
              </button>
            </div>
          </Section>
        </div>
        <Section
          title="任务动态"
          action={
            <Button variant="ghost small" onClick={() => go("tasks")}>
              全部任务
              <ArrowRight size={14} />
            </Button>
          }
        >
          {renderTaskTable(scoped.slice(0, 5), true)}
        </Section>
        <Section
          title="继续你的项目"
          action={
            <Button variant="ghost small" onClick={() => go("projects")}>
              项目目录
              <ArrowRight size={14} />
            </Button>
          }
        >
          <div className="project-shortcuts">
            {availableProjects
              .filter((p) => project === "all" || p.id === project)
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    go("projects", undefined, p.id);
                  }}
                >
                  <span className="project-initial">
                    <FolderOpen size={20} />
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.type}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
          </div>
        </Section>
      </>
    );
  else if (page === "projects")
    content = (
      <>
        <div className="browser-caption">
          <span>项目文件夹</span>
          <span>双击打开 · 空格快速查看</span>
        </div>
        <ObjectBrowser key={scopeKey + page} {...browserProps} />
        {!browseItems.length && (
          <Empty
            title="当前范围没有项目"
            description="调整范围或搜索条件以查看项目。"
          />
        )}
        <section className="workspace-shortcuts">
          <div className="browser-caption">
            <span>专业工作台</span>
            <span>在新标签页打开</span>
          </div>
          {services
            .filter((s) => s.kind === "workspace")
            .map((s) => (
              <div className="workspace-shortcut" key={s.id}>
                <ServiceGlyph id={s.id} />
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.description}</small>
                </span>
                {s.entry && (
                  <ExternalLink href={s.entry}>打开工作台</ExternalLink>
                )}
              </div>
            ))}
        </section>
      </>
    );
  else if (page === "services")
    content = (
      <>
        <div className="toolbar">
          <Pick
            label="服务分组"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "全部分组" },
              ...Array.from(new Set(services.map((s) => s.group))).map((g) => ({
                value: g,
                label: g,
              })),
            ]}
          />
          <Button
            variant="primary"
            disabled={!adminWritable}
            onClick={openConnect}
          >
            <Plus size={16} />
            接入服务
          </Button>
        </div>
        <DataTable
          id={"services." + managementKey}
          label="服务列表"
          rows={visibleServices}
          onOpen={(s) => select({ kind: "service", id: s.id })}
          columns={[
            {
              id: "name",
              label: "服务 / 工具",
              primary: true,
              value: (s) => s.name,
              render: (s) => (
                <div className="service-identity">
                  <ServiceGlyph id={s.id} />
                  <span>
                    <button
                      className="entity-link"
                      aria-label={"管理 " + s.name}
                      onClick={() => select({ kind: "service", id: s.id })}
                    >
                      {s.name}
                    </button>
                    <small>{s.description}</small>
                  </span>
                </div>
              ),
            },
            { id: "group", label: "能力领域", value: (s) => s.group },
            {
              id: "status",
              label: "当前状态",
              value: (s) => labels[status(s)] || status(s),
              render: (s) => (
                <Badge
                  state={status(s)}
                  label={s.kind === "workspace" ? "设计工作台" : undefined}
                />
              ),
            },
            {
              id: "latency",
              label: "连接延迟",
              numeric: true,
              value: (s) =>
                s.latency === null || scenario === "offline"
                  ? "—"
                  : s.latency + " ms",
            },
            {
              id: "capability",
              label: "可管理范围",
              value: (s) =>
                s.kind === "remote"
                  ? "公开能力投影"
                  : s.kind === "local"
                    ? "本地工具"
                    : "工作台入口",
            },
          ]}
        />
        <p className="footnote">
          连接、认证、可执行能力与真实调用证据分别核验。所有状态为设计样例。
        </p>
      </>
    );
  else if (page === "tasks") content = <>{renderTaskTable(filteredTasks)}</>;
  else if (page === "assets")
    content = (
      <AssetLibrary
        key={scopeKey}
        assets={scopedAssets}
        {...browserProps}
        state={library}
        setState={setLibrary}
        filters={assetFilters}
        setFilters={(value) =>
          dirty ? guard(() => setAssetFilters(value)) : setAssetFilters(value)
        }
        type={filter}
        setType={(value) =>
          dirty ? guard(() => setFilter(value)) : setFilter(value)
        }
        query={query}
        clearQuery={() => (dirty ? guard(() => setQuery("")) : setQuery(""))}
        clearFilters={() =>
          guard(() => {
            setFilter("all");
            setAssetFilters({ ...assetFilters, owner: "all", status: "all" });
            setQuery("");
          })
        }
        writable={writable}
        scenario={scenario}
        notify={notify}
        guard={guard}
        onDirty={(value, discard) => {
          setAdminDirty(value);
          adminDiscard.current = discard;
        }}
      />
    );
  else if (page === "approvals")
    content = (
      <>
        <div className="toolbar">
          <div className="segmented">
            {["all", "pending", "approved", "rejected"].map((s) => (
              <button
                key={s}
                className={filter === s ? "active" : ""}
                onClick={() => setFilter(s)}
              >
                {s === "all" ? "全部决定" : labels[s]}
              </button>
            ))}
          </div>
          <span className="muted">批准结果、批准费用与生产采用各自独立</span>
        </div>
        <Section title="等待明确的决定">
          <div className="approval-list">
            {scopedApprovals
              .filter((a) => filter === "all" || a.status === filter)
              .map((a) => (
                <button
                  key={a.id}
                  className="approval-row"
                  onClick={() => select({ kind: "approval", id: a.id })}
                >
                  <span className="approval-icon">
                    <ClipboardCheck size={20} />
                  </span>
                  <span>
                    <strong>{a.title}</strong>
                    <p>{a.detail}</p>
                    <small>
                      {a.type} · {serviceById(a.owner)?.name} ·{" "}
                      {projectName(a.project)}
                    </small>
                  </span>
                  <Badge state={a.status} />
                  <ChevronRight size={16} />
                </button>
              ))}
          </div>
          {!scopedApprovals.length && <Empty title="当前没有待批准事项" />}
        </Section>
      </>
    );
  else if (page === "usage") {
    const rows =
        env === "staging" ||
        scenario === "empty" ||
        management.tenant === "north" ||
        management.perspective === "personal"
          ? []
          : uniqueCharges(
              charges.filter(
                (c) =>
                  (project === "all" || c.project === project) &&
                  availableProjects.some((p) => p.id === c.project),
              ),
            ),
      total = confirmedTotals(rows);
    content = (
      <>
        <div className="toolbar">
          <span className="muted">演示账单 · 当前项目范围</span>
          <Pick
            label="费用状态"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "全部费用状态" },
              { value: "confirmed", label: "已确认" },
              { value: "estimated", label: "估算" },
              { value: "pending", label: "待结算" },
              { value: "unknown", label: "未知" },
            ]}
          />
        </div>
        <div className="cost-summary">
          <div>
            <span>已确认 · 人民币</span>
            <strong>¥ {total.CNY.toFixed(2)}</strong>
            <p>同一账单引用只计一次</p>
          </div>
          <div>
            <span>已确认 · 美元</span>
            <strong>$ {total.USD.toFixed(2)}</strong>
            <p>保持原币种，不推算汇率</p>
          </div>
          <div>
            <span>尚未确认</span>
            <strong>
              {rows.filter((r) => r.state !== "confirmed").length}
              <small> 项</small>
            </strong>
            <p>估算、待结算和未知不计入已确认费用</p>
          </div>
        </div>
        <DataTable
          id={"receipts." + scopeKey}
          label="费用明细"
          rows={rows
            .filter((r) => filter === "all" || r.state === filter)
            .map((r) => ({ ...r, id: r.ref }))}
          onOpen={() => go("audit")}
          columns={[
            {
              id: "source",
              label: "费用来源",
              primary: true,
              value: (r) => r.ref,
              render: (r) => (
                <>
                  <strong>{serviceById(r.owner)?.name}</strong>
                  <div className="cell-meta">
                    <code>{r.ref}</code>
                  </div>
                </>
              ),
            },
            {
              id: "project",
              label: "项目",
              value: (r) => projectName(r.project),
            },
            {
              id: "state",
              label: "确认状态",
              value: (r) => r.state,
              render: (r) => <Badge state={r.state} />,
            },
            {
              id: "amount",
              label: "金额",
              numeric: true,
              value: (r) =>
                ["pending", "unknown"].includes(r.state)
                  ? "—"
                  : `${r.currency === "CNY" ? "¥" : "$"} ${r.amount.toFixed(2)}`,
            },
          ]}
        />

        <div className="notice">
          <Wallet size={18} />
          <span>
            Scaena 中引用的 Eikona
            费用已按同一账单引用去重。费用缺失不等于免费。
          </span>
        </div>
      </>
    );
  } else if (page === "audit")
    content = (
      <>
        <div className="toolbar">
          <Button
            onClick={() =>
              download(
                "脱敏诊断证据.md",
                "# 设计原型 · 脱敏诊断证据\n\n仅包含演示对象，无真实请求参数或凭据。\n\n" +
                  scopedAudit
                    .map(
                      (a) =>
                        `- ${a.time} ${a.title} / ${a.owner}\n  ${a.detail}`,
                    )
                    .join("\n"),
              )
            }
          >
            <ArrowDownToLine size={15} />
            导出证据
          </Button>
        </div>
        <div className="audit-layout">
          <Section title="操作与事件">
            <DataTable
              id={"audit." + scopeKey}
              label="审计记录"
              rows={scopedAudit.filter((a) =>
                `${a.title}${a.detail}`.includes(query),
              )}
              onOpen={(a) => {
                setInspectorOpen(false);
                setAuditID(a.id);
              }}
              columns={[
                {
                  id: "title",
                  label: "操作与回执",
                  primary: true,
                  value: (a) => a.title,
                  render: (a) => (
                    <>
                      <strong>{a.title}</strong>
                      <div className="cell-meta">{a.id}</div>
                    </>
                  ),
                },
                {
                  id: "owner",
                  label: "权限来源",
                  value: (a) => serviceById(a.owner)?.name || a.owner,
                },
                { id: "time", label: "时间", value: (a) => a.time },
                {
                  id: "result",
                  label: "结果",
                  value: (a) => a.outcome,
                  render: (a) => <Badge state={a.outcome} />,
                },
              ]}
            />
          </Section>
          <Section title="诊断路径">
            <div className="diagnostic-path">
              {[
                {
                  label: "连接与认证",
                  text: "能否访问目标实例及授权范围",
                  icon: Globe,
                },
                {
                  label: "能力与权限",
                  text: "动作是否有公开合同与执行权限",
                  icon: LockKeyhole,
                },
                {
                  label: "原任务与回执",
                  text: "优先查询原 ID，避免重复执行",
                  icon: ListTodo,
                },
                {
                  label: "结果与交接",
                  text: "查看资产版本、证据和采用状态",
                  icon: Layers,
                },
              ].map((x, i) => (
                <div key={x.label}>
                  <span>{i + 1}</span>
                  <div>
                    <strong>{x.label}</strong>
                    <p>{x.text}</p>
                  </div>
                  <x.icon size={18} />
                </div>
              ))}
            </div>
            <div className="section-foot">
              <Button onClick={() => go("services")}>
                检查服务
                <ArrowRight size={14} />
              </Button>
            </div>
          </Section>
        </div>
      </>
    );
  else
    content = (
      <SettingsPage
        theme={theme}
        setTheme={setTheme}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        onConnections={() =>
          go("services", { kind: "service", id: "credentialctl" })
        }
      />
    );

  if (page === "tasks")
    content = (
      <RequestsPage
        key={scopeKey}
        rows={requestRows}
        scope={managementScope}
        queue={content}
        tab={activityTab}
        setTab={setActivityTab}
        onPending={() => go("approvals")}
        query={historyQuery}
        setQuery={setHistoryQuery}
        onLegacy={(id) => {
          setActivityTab("queue");
          select({ kind: "task", id });
        }}
        onChange={updateFact}
        writable={writable}
      />
    );
  if (page === "usage")
    content = (
      <AnalyticsPage
        key={scopeKey}
        rows={requestRows}
        scope={managementScope}
        legacyCosts={content}
        onDrill={(q) => {
          setHistoryQuery(q);
          setActivityTab("history");
          go("tasks");
        }}
      />
    );
  if (page === "members")
    content = (
      <OrganizationPage
        key={scopeKey}
        scope={managementScope}
        store={organization}
        setStore={setOrganization}
        rows={requestRows}
        scenario={scenario}
        onMemberHistory={(actor) => {
          setHistoryQuery({ ...defaultQuery, actor });
          setActivityTab("history");
          go("tasks");
        }}
        onTenant={(tenant) => changeManagement("tenant", tenant)}
        onDirty={(dirty, discard) => {
          setAdminDirty(dirty);
          adminDiscard.current = discard;
        }}
      />
    );
  if (page === "overview")
    content = (
      <OverviewDashboard
        rows={requestRows}
        onHistory={(query) => {
          setHistoryQuery(query || { ...defaultQuery });
          setActivityTab("history");
          go("tasks");
        }}
        onAssets={() => go("assets")}
      >
        {content}
      </OverviewDashboard>
    );

  function inspector() {
    if (selection?.kind === "project") {
      const p = availableProjects.find((p) => p.id === selection.id);
      if (!p) return null;
      return (
        <>
          <div className="project-inspector-preview">
            <FolderArtwork />
          </div>
          <p>{p.subtitle}</p>
          <h3 className="inspector-section-label">信息</h3>
          <dl className="details">
            <dt>所在环境</dt>
            <dd>内网主环境</dd>
            <dt>任务</dt>
            <dd>{scoped.filter((t) => t.project === p.id).length} 项</dd>
            <dt>资产</dt>
            <dd>{scopedAssets.filter((a) => a.project === p.id).length} 项</dd>
            <dt>工作位置</dt>
            <dd>由专业工作台保留</dd>
          </dl>
          <h3 className="inspector-section-label">关联服务</h3>
          <div className="inspector-services">
            {p.owners.map((id) => (
              <button
                key={id}
                onClick={() => go("services", { kind: "service", id }, p.id)}
              >
                <ServiceGlyph id={id} />
                <span>{serviceById(id)?.name}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <div className="button-row">
            <Button onClick={() => go("tasks", undefined, p.id)}>
              查看项目任务
            </Button>
            <Button onClick={() => go("assets", undefined, p.id)}>
              查看资产
            </Button>
            {p.entry && <ExternalLink href={p.entry}>进入工作台</ExternalLink>}
          </div>
        </>
      );
    }
    if (task) {
      const action = actionFor(task);
      return (
        <>
          <div
            className={"notice " + (task.state === "unknown" ? "warning" : "")}
          >
            <CircleAlert size={17} />
            <span>{task.reason}</span>
          </div>
          {requestTab === "概况" && (
            <dl className="details">
              <dt>所属项目</dt>
              <dd>{projectName(task.project)}</dd>
              <dt>执行服务</dt>
              <dd>
                <button
                  className="text-button"
                  onClick={() => select({ kind: "service", id: task.owner })}
                >
                  {serviceById(task.owner)?.name}
                  <ArrowUpRight size={13} />
                </button>
              </dd>
              <dt>原任务引用</dt>
              <dd>
                <CopyReference value={task.id} />
              </dd>
              <dt>原生状态</dt>
              <dd>
                <code>{task.native}</code>
              </dd>
              <dt>尝试次数</dt>
              <dd>{task.attempt}</dd>
              <dt>费用状态</dt>
              <dd>{task.cost}</dd>
              {task.parent && (
                <>
                  <dt>原失败任务</dt>
                  <dd>
                    <button
                      className="text-button"
                      onClick={() => select({ kind: "task", id: task.parent! })}
                    >
                      {task.parent}
                    </button>
                  </dd>
                </>
              )}
            </dl>
          )}
          {requestTab === "执行" && (
            <>
              <h3>执行时间线</h3>
              <div className="mini-timeline">
                <div>
                  <Check size={14} />
                  <span>请求准备与授权检查</span>
                </div>
                <div>
                  <Check size={14} />
                  <span>创建原操作 · {task.time}</span>
                </div>
                <div>
                  <Clock3 size={14} />
                  <span>{task.reason}</span>
                </div>
              </div>
            </>
          )}
          {task.asset && (
            <Button
              onClick={() => go("assets", { kind: "asset", id: task.asset! })}
            >
              <Layers size={16} />
              查看关联资产
            </Button>
          )}
          {task.native === "rights_blocked" && (
            <p className="section-note">
              需由 Sonora 补充声音使用许可。当前没有可执行的重试权限。
            </p>
          )}
          {scenario === "capability" && (
            <p className="form-error">
              原结果恢复能力尚未接线：needs_contract。
            </p>
          )}
          {!writable && (
            <p className="section-note">
              <LockKeyhole size={14} /> 当前身份或服务状态不允许写操作。
            </p>
          )}
        </>
      );
    }
    if (service) {
      const config = configs[service.id] || {
        concurrency: 4,
        timeout: 90,
        profile: "balanced",
        revision: 1,
      };
      return (
        <>
          <div role="tabpanel" aria-label={serviceTab}>
            {serviceTab === "概况" ? (
              <>
                <dl className="details">
                  <dt>所在环境</dt>
                  <dd>{env === "main" ? "内网主环境" : "隔离测试环境"}</dd>
                  <dt>服务形态</dt>
                  <dd>
                    {service.kind === "remote"
                      ? "远程服务"
                      : service.kind === "local"
                        ? "本地工具"
                        : "专业工作台"}
                  </dd>
                  <dt>版本</dt>
                  <dd>{service.version}</dd>
                  <dt>最近观察</dt>
                  <dd>
                    {scenario === "stale"
                      ? "13:12 · 已过期"
                      : "14:35 · 演示快照"}
                  </dd>
                  <dt>维护 owner</dt>
                  <dd>
                    <CopyReference value={service.owner} />
                  </dd>
                </dl>
                <h3>可管理能力</h3>
                <div className="capability-list">
                  {service.capabilities.map((c) => (
                    <div key={c}>
                      <Check size={15} />
                      <span>{c}</span>
                      <small>设计投影</small>
                    </div>
                  ))}
                </div>
                <div className="button-row">
                  <Button
                    onClick={() => {
                      go("tasks");
                      setQuery(service.id);
                    }}
                  >
                    相关任务
                  </Button>
                  <Button
                    onClick={() => {
                      go("assets");
                      setQuery(service.id);
                    }}
                  >
                    资产与交接
                  </Button>
                </div>
                {service.entry && (
                  <ExternalLink href={service.entry}>
                    打开专业控制台
                  </ExternalLink>
                )}
              </>
            ) : serviceTab === "连接与能力" ? (
              <>
                <div className="health-layers">
                  {[
                    {
                      title: "传输连接",
                      value:
                        scenario === "offline"
                          ? "unknown"
                          : service.kind === "remote"
                            ? "healthy"
                            : "local",
                      text:
                        service.kind === "remote"
                          ? "连接引用：" +
                            (service.connectionRef ||
                              "connection://lan/" + service.id)
                          : "本地工具不推断远程连通性",
                    },
                    {
                      title: "认证与范围",
                      value: scenario === "auth" ? "blocked" : "healthy",
                      text: "当前项目与角色范围 · 设计示例",
                    },
                    {
                      title: "执行能力",
                      value:
                        scenario === "capability"
                          ? "needs_contract"
                          : "waiting_review",
                      text: "管理操作需要逐项确认 owner 合同",
                    },
                    {
                      title: "真实执行证据",
                      value: "needs_contract",
                      text: "未在本原型执行真实调用",
                    },
                  ].map((l) => (
                    <div key={l.title}>
                      <span>
                        <strong>{l.title}</strong>
                        <small>{l.text}</small>
                      </span>
                      <Badge state={l.value} />
                    </div>
                  ))}
                </div>
                <p className="section-note">
                  检查不会调用付费 Provider，也不把配置状态提升为真实执行成功。
                </p>
              </>
            ) : serviceTab === "配置" ? (
              <>
                <div className="config-version">
                  <span>有效配置 · 演示</span>
                  <code>r{config.revision}</code>
                </div>
                <dl className="details">
                  <dt>并发上限</dt>
                  <dd>{config.concurrency}</dd>
                  <dt>超时</dt>
                  <dd>{config.timeout} 秒</dd>
                  <dt>模型配置引用</dt>
                  <dd>{config.profile}</dd>
                  <dt>凭据</dt>
                  <dd>credentialctl 安全引用</dd>
                </dl>
                <p className="section-note">
                  所有配置变更都先预览影响，再确认并回读。此处不提供密钥输入。
                </p>
              </>
            ) : serviceTab === "访问" ? (
              <>
                <div className="notice">
                  <LockKeyhole size={17} />
                  <span>
                    控制中心角色与服务授权取交集。当前：
                    {
                      {
                        admin: "管理员",
                        operator: "操作员",
                        viewer: "只读成员",
                      }[role]
                    }
                    。
                  </span>
                </div>
                <dl className="details">
                  <dt>项目范围</dt>
                  <dd>{scope}</dd>
                  <dt>凭据来源</dt>
                  <dd>credentialctl</dd>
                  <dt>配置状态</dt>
                  <dd>演示引用已配置</dd>
                  <dt>可见内容</dt>
                  <dd>任务、资产与脱敏证据</dd>
                  <dt>管理操作</dt>
                  <dd>
                    {adminWritable ? "演示模式可修改配置" : "不允许修改配置"}
                  </dd>
                </dl>
                <div className="contract-gap">
                  <strong>访问密钥管理待接线</strong>
                  <p>
                    签发、轮换与撤销须由 {service.name}{" "}
                    提供受控公开合同；不在此处创建或导出真实密钥。
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="contract-gap">
                  <strong>接口交接缺口</strong>
                  <code>needs_contract</code>
                  <p>{service.gap}</p>
                </div>
                <Button
                  onClick={() => {
                    go("audit");
                    setQuery(service.id);
                  }}
                >
                  打开服务诊断
                  <ArrowUpRight size={15} />
                </Button>
                <p className="section-note">
                  查询路径、授权与观测来源在接口交接清单中分别记录。
                </p>
              </>
            )}
          </div>
        </>
      );
    }
    if (asset)
      return (
        <AssetDetail
          key={scopeKey + asset.id}
          asset={asset}
          state={library}
          setState={setLibrary}
          writable={writable}
          scenario={scenario}
          notify={notify}
          guard={guard}
          onTask={(id) => go("tasks", { kind: "task", id })}
          onReviews={() => go("approvals")}
          onDirty={(value, discard) => {
            setAdminDirty(value);
            adminDiscard.current = discard;
          }}
        />
      );
    if (approval)
      return (
        <>
          <p>{approval.detail}</p>
          <dl className="details">
            <dt>决定范围</dt>
            <dd>{projectName(approval.project)}</dd>
            <dt>领域 owner</dt>
            <dd>{serviceById(approval.owner)?.name}</dd>
            <dt>影响</dt>
            <dd>仅作用于本条决定，其他项目与版本保持独立。</dd>
          </dl>
          {approval.operation && (
            <Button
              onClick={() =>
                go("tasks", { kind: "task", id: approval.operation! })
              }
            >
              查看原任务
            </Button>
          )}
          {["rights-voice", "review-music"].includes(approval.id) && (
            <p className="form-error">缺少真实权利或审听证据，当前不能批准。</p>
          )}
        </>
      );
    if (selection?.kind === "external")
      return (
        <>
          <h3>诊断上下文已接收</h3>
          <dl className="details">
            <dt>原项目</dt>
            <dd>
              <code>{initial.sourceProject || "未提供"}</code>
            </dd>
            <dt>原任务</dt>
            <dd>
              <CopyReference value={selection.id} />
            </dd>
            <dt>原镜头</dt>
            <dd>
              <code>{initial.sourceShot || "未提供"}</code>
            </dd>
          </dl>
          <div className="notice">
            <CircleAlert size={17} />
            <span>
              此引用来自片场的本地演示任务，尚未绑定正式 owner
              操作。不会自动匹配同名任务或创建生成请求。
            </span>
          </div>
          <Button onClick={() => go("services")}>查看服务与接口缺口</Button>
        </>
      );
    return null;
  }
  const serviceTabs = () => (
    <div className="detail-tabs" role="tablist" aria-label="服务详情标签">
      {["概况", "连接与能力", "配置", "访问", "诊断"].map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={serviceTab === t}
          tabIndex={serviceTab === t ? 0 : -1}
          onKeyDown={(e) => {
            const names = ["概况", "连接与能力", "配置", "访问", "诊断"];
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? 4
                  : (names.indexOf(t) + (e.key === "ArrowRight" ? 1 : 4)) % 5;
            setServiceTab(names[next]);
            (
              e.currentTarget.parentElement?.children[next] as HTMLElement
            )?.focus();
          }}
          onClick={() => setServiceTab(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
  const detailFooter = () => {
    if (task) {
      const action = actionFor(task);
      return (
        <div className="inspector-actions">
          {action === "reconcile" && (
            <Button
              variant="primary"
              disabled={!writable || !!pending || scenario === "capability"}
              onClick={() => perform(task, "reconcile")}
            >
              {pending === task.id ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              查询原结果
            </Button>
          )}
          {action === "retry" && (
            <Button
              variant="primary"
              disabled={!writable || !!pending}
              onClick={() => openDecision("retry", task.id)}
            >
              批准新的尝试
            </Button>
          )}
          {action === "cancel" && (
            <Button
              disabled={!writable || !!pending}
              onClick={() => openDecision("cancel", task.id)}
            >
              取消任务
            </Button>
          )}
          <Button
            onClick={() => {
              go("audit");
              setQuery(task.id);
            }}
          >
            查看诊断
            <ArrowUpRight size={15} />
          </Button>
        </div>
      );
    }
    if (approval)
      return (
        <div className="inspector-actions">
          <Button
            variant="primary"
            disabled={
              !writable ||
              approval.status !== "pending" ||
              approval.id === "rights-voice" ||
              approval.id === "review-music"
            }
            onClick={() => openDecision("approve", approval.id)}
          >
            批准此项
          </Button>
          <Button
            disabled={!writable || approval.status !== "pending"}
            onClick={() => openDecision("reject", approval.id)}
          >
            拒绝并说明
          </Button>
        </div>
      );
    if (service)
      return (
        <WorkspaceActions
          secondary={[
            {
              label: "打开服务诊断",
              action: () => {
                go("audit");
                setQuery(service.id);
              },
            },
            {
              label: "相关任务",
              action: () => {
                go("tasks");
                setQuery(service.id);
              },
            },
          ]}
        >
          {serviceTab === "配置" ? (
            <Button
              variant="primary"
              disabled={
                !adminWritable ||
                service.kind !== "remote" ||
                scenario === "capability"
              }
              onClick={() => openConfig(service.id)}
            >
              <SlidersHorizontal size={15} />
              编辑演示配置
            </Button>
          ) : (
            <Button onClick={refresh}>
              <RefreshCw size={15} />
              检查演示连接
            </Button>
          )}
        </WorkspaceActions>
      );
    return (
      <span className="workspace-footer-note">
        固定引用 · 领域数据由 owner 维护
      </span>
    );
  };
  const selectedProject =
    selection?.kind === "project"
      ? availableProjects.find((p) => p.id === selection.id)
      : undefined;
  const decisionObject = decision
    ? scoped.find((t) => t.id === decision.id) ||
      scopedApprovals.find((a) => a.id === decision.id)
    : undefined;
  const decisionTask = decisionObject
    ? scoped.find(
        (t) =>
          t.id ===
          ("operation" in decisionObject
            ? decisionObject.operation
            : decisionObject.id),
      )
    : undefined;
  const decisionAsset = decisionTask?.asset
    ? scopedAssets.find((a) => a.id === decisionTask.asset)
    : undefined;
  const decisionVersion =
    decisionAsset?.version ||
    (decisionTask ? "原尝试 " + decisionTask.attempt : "未提供版本证据");
  const decisionCost =
    decision?.kind === "retry"
      ? "新的尝试：估算上限 $0.05"
      : decisionTask?.cost || "未提供费用证据";
  const workspaceTitle = receipt
    ? receipt.title
    : batchResult
      ? "批量处理结果"
      : configOpen
        ? `${serviceById(configService)?.name || "服务"} · 配置变更`
        : connectOpen
          ? "接入服务"
          : decision
            ? {
                retry: "批准新的尝试",
                cancel: "取消任务",
                reject: "拒绝并说明",
                approve: "确认批准",
              }[decision.kind] || "确认操作"
            : service?.name ||
              task?.title ||
              asset?.name ||
              approval?.title ||
              selectedProject?.name ||
              (selection?.kind === "external" ? "片场诊断上下文" : "简介");
  const workspaceSubtitle = receipt
    ? "操作结果 · 设计回执"
    : batchResult
      ? "批量操作回执"
      : editorActive
        ? "编辑工作区"
        : service
          ? "服务实例"
          : task
            ? "任务与操作"
            : asset
              ? "资产与固定版本"
              : approval
                ? approval.type
                : selectedProject
                  ? "项目文件夹"
                  : "对象信息";
  const workspaceIcon =
    receipt || batchResult ? (
      <CheckCheck size={22} />
    ) : configOpen ? (
      <ServiceGlyph id={configService} />
    ) : connectOpen ? (
      <ServiceGlyph id={connect.service} />
    ) : service ? (
      <ServiceGlyph id={service.id} />
    ) : task ? (
      <ListTodo size={22} />
    ) : asset ? (
      <Layers size={22} />
    ) : selectedProject ? (
      <FolderOpen size={22} />
    ) : (
      <Info size={22} />
    );
  const workspaceStatus = receipt ? (
    <Badge state="succeeded" label="演示操作完成" />
  ) : pending ? (
    <Badge state="running" />
  ) : batchResult ? (
    <Badge
      state={batchResult.some((r) => !r.ok) ? "waiting_review" : "succeeded"}
      label={batchResult.some((r) => !r.ok) ? "部分完成" : "全部完成"}
    />
  ) : editorActive ? (
    <Badge
      state="waiting_review"
      label={configStep === "preview" || decision ? "等待确认" : "编辑草稿"}
    />
  ) : service ? (
    <Badge state={status(service)} />
  ) : task ? (
    <Badge state={task.state} />
  ) : asset ? (
    <Badge state="healthy" label={asset.version} />
  ) : approval ? (
    <Badge state={approval.status} />
  ) : undefined;
  const finishReceipt = () => {
    const result = receipt;
    resetEditor();
    if (result?.target) setSelection(result.target);
    setServiceTab(result?.tab || "概况");
    setInspectorOpen(!!result?.target || !!selection);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          ".workspace-footer button:not(:disabled),.workspace-heading h2",
        )
        ?.focus(),
    );
  };
  const decisionFooter = (
    <>
      <Button disabled={!!pending} onClick={() => guard(returnDetail)}>
        返回
      </Button>
      <Button
        variant="primary"
        disabled={
          !writable ||
          !!pending ||
          !ack ||
          (decision?.kind === "reject" && !decisionNote.trim())
        }
        onClick={submitDecision}
      >
        {pending ? (
          <>
            <LoaderCircle size={15} className="spin" />
            正在处理…
          </>
        ) : (
          "确认操作"
        )}
      </Button>
    </>
  );
  const workspaceContent = receipt ? (
    <WorkspaceEditor
      busy={!!pending}
      footer={
        <Button variant="primary" onClick={finishReceipt}>
          {receipt.tab === "配置" ? "返回配置" : "返回详情"}
          <ArrowRight size={15} />
        </Button>
      }
    >
      <div className="receipt-summary">
        <span>
          <CheckCheck size={25} />
        </span>
        <h3>{receipt.title}</h3>
        <p>结果已在本次演示中回读。真实执行仍由 owner 提供合同与证据。</p>
      </div>
      <FormSection title="操作回执">
        <dl className="details">
          <dt>操作引用</dt>
          <dd>
            <CopyReference value={receipt.ref} />
          </dd>
          {receipt.details.map((d) => (
            <React.Fragment key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </FormSection>
      <PanelNotice title="原记录已保留">
        可返回对象继续查看配置、任务或审阅上下文。此操作未调用真实服务。
      </PanelNotice>
    </WorkspaceEditor>
  ) : batchResult ? (
    <WorkspaceEditor
      busy={!!pending}
      footer={
        <>
          <Button
            onClick={() => {
              setBatchResult(null);
              setInspectorOpen(!!selection);
            }}
          >
            完成
          </Button>
          <Button
            onClick={() =>
              download(
                "批量结果.md",
                "# 设计演示 · 批量结果\n\n" +
                  batchResult.map((r) => `- ${r.id}: ${r.reason}`).join("\n"),
              )
            }
          >
            <ArrowDownToLine size={15} />
            导出逐项结果
          </Button>
        </>
      }
    >
      <PanelNotice
        title={`${batchResult.filter((r) => r.ok).length} 项成功 · ${batchResult.filter((r) => !r.ok).length} 项未处理`}
      >
        每个任务分别核验能力，未处理项保留原状态。
      </PanelNotice>
      {batchResult.map((r) => (
        <div className="batch-result" key={r.id}>
          <Badge
            state={r.ok ? "succeeded" : "blocked"}
            label={r.ok ? "成功" : "未处理"}
          />
          <div>
            <CopyReference value={r.id} />
            <p>{r.reason}</p>
          </div>
        </div>
      ))}
    </WorkspaceEditor>
  ) : connectOpen ? (
    <WorkspaceEditor
      busy={!!pending}
      onSubmit={advanceConnection}
      footer={
        <>
          <Button disabled={!!pending} onClick={() => guard(returnDetail)}>
            取消
          </Button>
          {connect.step > 0 && (
            <Button
              disabled={!!pending}
              onClick={() => {
                setFieldErrors({});
                setFormError("");
                setConnect((c) => ({ ...c, step: c.step - 1 }));
              }}
            >
              上一步
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!adminWritable || !!pending}
            onClick={advanceConnection}
          >
            {pending ? (
              <>
                <LoaderCircle size={15} className="spin" />
                正在保存…
              </>
            ) : connect.step === 2 ? (
              "保存演示实例"
            ) : connect.step === 1 ? (
              "检查引用"
            ) : (
              "下一步"
            )}
          </Button>
        </>
      }
    >
      <ol className="form-steps">
        {["服务与范围", "连接引用", "检查与确认"].map((label, i) => (
          <li
            key={label}
            aria-current={i === connect.step ? "step" : undefined}
            className={i <= connect.step ? "active" : ""}
          >
            <span>{i < connect.step ? <Check size={12} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {connect.step === 0 ? (
        <>
          <FormSection
            title="服务实例"
            description="为已有服务添加一个可识别的演示连接。"
          >
            <Field label="服务类型" required>
              <Pick
                label="接入服务类型"
                value={connect.service}
                disabled={!!pending}
                onChange={(v) => {
                  setConnect((c) => ({
                    ...c,
                    service: v,
                    ref: "connection://lan/" + v,
                    credential: "credentialctl://team/" + v + "-read",
                  }));
                  setFieldErrors({});
                }}
                options={baseServices
                  .filter((s) => s.kind === "remote")
                  .map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Field
              label="实例名称"
              required
              hint="使用能区分用途或工作室的名称。"
              error={fieldErrors.name}
            >
              <input
                id="connection-name"
                aria-label="实例名称"
                value={connect.name}
                onChange={(e) => changeConnection("name", e.target.value)}
                onBlur={() =>
                  setFieldErrors((e) => ({
                    ...e,
                    name: validateConnect(connect, 0).name || "",
                  }))
                }
                placeholder="例如：Eikona · 工作室实例"
              />
            </Field>
          </FormSection>
          <FormSection title="生效范围">
            <div className="form-scope-grid">
              <div>
                <small>环境</small>
                <strong>
                  {env === "main" ? "内网主环境" : "隔离测试环境"}
                </strong>
              </div>
              <div>
                <small>项目</small>
                <strong>{scope}</strong>
              </div>
            </div>
            <p className="field-description">
              范围来自当前工作空间。更换范围会清理此草稿。
            </p>
          </FormSection>
        </>
      ) : connect.step === 1 ? (
        <>
          <FormSection
            title="连接与授权"
            description="填写由服务 owner 管理的引用。"
          >
            <Field
              label="连接引用"
              required
              hint="服务器维护的固定引用，不接受任意网址。"
              error={fieldErrors.ref}
            >
              <input
                id="connection-ref"
                aria-label="连接引用"
                value={connect.ref}
                onChange={(e) => changeConnection("ref", e.target.value)}
                onBlur={() =>
                  setFieldErrors((e) => ({
                    ...e,
                    ref: validateConnect(connect, 1).ref || "",
                  }))
                }
                spellCheck={false}
              />
            </Field>
            <Field
              label="凭据引用"
              required
              hint="仅填写 credentialctl 引用，不填写 Key、Token 或密码。"
              error={fieldErrors.credential}
            >
              <input
                id="connection-credential"
                aria-label="凭据引用"
                value={connect.credential}
                onChange={(e) => changeConnection("credential", e.target.value)}
                onBlur={() =>
                  setFieldErrors((e) => ({
                    ...e,
                    credential: validateConnect(connect, 1).credential || "",
                  }))
                }
                spellCheck={false}
              />
            </Field>
          </FormSection>
          <PanelNotice title="此步骤只检查引用格式">
            连接可达、认证成功和执行能力需要由 owner 分别核验。
          </PanelNotice>
        </>
      ) : (
        <>
          <FormSection title="接入摘要">
            <dl className="details">
              <dt>实例名称</dt>
              <dd>{connect.name}</dd>
              <dt>服务</dt>
              <dd>{serviceById(connect.service)?.name}</dd>
              <dt>连接引用</dt>
              <dd>
                <CopyReference value={connect.ref} />
              </dd>
              <dt>凭据引用</dt>
              <dd>
                <CopyReference value={connect.credential} />
              </dd>
            </dl>
          </FormSection>
          <div className="health-layers">
            <div>
              <strong>引用格式</strong>
              <Badge state="healthy" label="通过" />
            </div>
            <div>
              <strong>认证与范围</strong>
              <Badge state="waiting_review" label="待真实验证" />
            </div>
            <div>
              <strong>管理能力</strong>
              <Badge state="needs_contract" label="待接口接线" />
            </div>
          </div>
          <PanelNotice title="将保存为待接入">
            不会建立真实连接，也不将此实例标记为服务就绪。
          </PanelNotice>
        </>
      )}
    </WorkspaceEditor>
  ) : configOpen ? (
    <WorkspaceEditor
      busy={!!pending}
      onSubmit={() =>
        configStep === "edit" ? advanceConfig() : submitConfig()
      }
      footer={
        <>
          <span className="editor-save-state">
            {dirty ? "有未保存的修改" : "当前没有变更"}
          </span>
          <Button
            disabled={!!pending}
            onClick={() =>
              configStep === "edit"
                ? guard(returnDetail)
                : setConfigStep("edit")
            }
          >
            {configStep === "edit" ? "取消" : "返回修改"}
          </Button>
          <Button
            variant="primary"
            disabled={
              !adminWritable || !!pending || !configChanged(draft, configBase)
            }
            onClick={() =>
              configStep === "edit" ? advanceConfig() : submitConfig()
            }
          >
            {pending.startsWith("config:") ? (
              <>
                <LoaderCircle size={15} className="spin" />
                正在保存…
              </>
            ) : configStep === "edit" ? (
              "预览变更"
            ) : (
              "确认变更并回读"
            )}
          </Button>
        </>
      }
    >
      <div className="form-edit-context">
        <span className="context-service">
          <ServiceGlyph id={configService} />
          {serviceById(configService)?.name}
        </span>
        <span>
          基于版本 <code>r{draft.revision}</code>
        </span>
      </div>
      {configStep === "edit" ? (
        <>
          <FormSection
            title="执行限制"
            description="调整此服务接受后续任务时使用的限制。"
          >
            <div className="field-grid">
              <Field
                label="并发上限"
                required
                hint="1–16 个并发任务"
                error={fieldErrors.concurrency}
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="16"
                  step="1"
                  id="config-concurrency"
                  aria-label="并发上限"
                  value={draft.concurrency}
                  onChange={(e) => changeDraft("concurrency", e.target.value)}
                  onBlur={() => blurConfig("concurrency")}
                />
              </Field>
              <Field
                label="请求超时"
                required
                hint="10–600 秒"
                error={fieldErrors.timeout}
              >
                <input
                  id="config-timeout"
                  type="number"
                  inputMode="numeric"
                  min="10"
                  max="600"
                  step="1"
                  aria-label="请求超时"
                  aria-invalid={!!fieldErrors.timeout}
                  value={draft.timeout}
                  onChange={(e) => changeDraft("timeout", e.target.value)}
                  onBlur={() => blurConfig("timeout")}
                />
              </Field>
            </div>
          </FormSection>
          <FormSection
            title="模型配置"
            description="模型能力与配置内容仍由服务 owner 维护。"
          >
            <Field label="模型配置引用">
              <Pick
                label="模型配置引用"
                value={draft.profile}
                onChange={(v) => changeDraft("profile", v)}
                options={[
                  { value: "balanced", label: "balanced · 均衡配置" },
                  { value: "quality", label: "quality · 质量优先" },
                ]}
              />
            </Field>
          </FormSection>
          <PanelNotice title="仅影响后续任务">
            已接受的任务继续使用原版本。本轮保存为演示配置，不修改远程服务。
          </PanelNotice>
        </>
      ) : (
        <>
          <PanelNotice title="确认以下配置变更">
            影响 {serviceById(configService)?.name}{" "}
            的后续任务；已接受的任务保持原版本。
          </PanelNotice>
          <FormSection title="变更预览">
            <div className="config-diff">
              <div className="diff-head">
                <span>配置项</span>
                <span>当前值</span>
                <span />
                <span>新值</span>
              </div>
              {[
                {
                  name: "并发上限",
                  old: String(configBase.concurrency),
                  next: String(Number(draft.concurrency)),
                },
                {
                  name: "请求超时",
                  old: configBase.timeout + " 秒",
                  next: Number(draft.timeout) + " 秒",
                },
                {
                  name: "模型配置",
                  old: configBase.profile,
                  next: draft.profile,
                },
              ]
                .filter((r) => r.old !== r.next)
                .map((row) => (
                  <div key={row.name}>
                    <span>{row.name}</span>
                    <del>{row.old}</del>
                    <ArrowRight size={14} />
                    <strong>{row.next}</strong>
                  </div>
                ))}
            </div>
          </FormSection>
          <div className="form-scope-grid">
            <div>
              <small>预期版本</small>
              <strong>
                r{draft.revision} → r{draft.revision + 1}
              </strong>
            </div>
            <div>
              <small>生效范围</small>
              <strong>{scope}</strong>
            </div>
          </div>
        </>
      )}
      {formError && (
        <PanelNotice title={formError} tone="error">
          {formError.includes("版本") ? (
            <Button
              onClick={() => {
                const current = configs[configService] || configDefault;
                setConfigBase(current);
                setDraft((d) => ({ ...d, revision: current.revision }));
                setConfigStep("edit");
                setFormError("");
                setFieldErrors({});
                notify("已读取新版本并保留草稿，请重新预览变更。");
              }}
            >
              读取新版本并保留草稿
            </Button>
          ) : (
            <p>输入已保留。可返回修改，或恢复后重新确认本次变更。</p>
          )}
        </PanelNotice>
      )}
    </WorkspaceEditor>
  ) : decision ? (
    <WorkspaceEditor onSubmit={submitDecision} footer={decisionFooter}>
      <FormSection title="本次操作">
        <dl className="details">
          <dt>对应对象</dt>
          <dd>{decisionObject?.title || decision.id}</dd>
          <dt>原始引用</dt>
          <dd>
            <CopyReference value={decision.id} />
          </dd>
          <dt>范围</dt>
          <dd>
            {decisionObject ? projectName(decisionObject.project) : scope}
          </dd>
          <dt>版本 / 尝试</dt>
          <dd>{decisionVersion}</dd>
          <dt>费用状态</dt>
          <dd>{decisionCost}</dd>
          <dt>影响</dt>
          <dd>
            {decision.kind === "retry"
              ? "创建新的尝试，原失败任务保留"
              : "仅作用于当前对象和指定版本"}
          </dd>
        </dl>
      </FormSection>
      <PanelNotice
        title={
          decision.kind === "retry"
            ? "新的尝试可能产生费用"
            : decision.kind === "cancel"
              ? "已发生的费用不会撤销"
              : "确认当前对象与版本"
        }
        tone={
          decision.kind === "retry" || decision.kind === "cancel"
            ? "warning"
            : "info"
        }
      >
        {decision.kind === "retry"
          ? "演示费用上限 $0.05；结果以 owner 回执为准。"
          : decision.kind === "cancel"
            ? "取消结果需要回读确认，不撤销已经完成的工作。"
            : "审阅决定不替代其他服务的生产采用。"}
      </PanelNotice>
      {decision.kind === "reject" && (
        <FormSection title="拒绝说明">
          <Field
            label="拒绝原因"
            required
            error={fieldErrors.reason}
            hint="说明需要补充的证据或修改，以便后续恢复。"
          >
            <textarea
              id="decision-reason"
              aria-label="拒绝原因"
              value={decisionNote}
              onChange={(e) => {
                setDecisionNote(e.target.value);
                setFieldErrors((v) => ({ ...v, reason: "" }));
              }}
              onBlur={() =>
                setFieldErrors((v) => ({
                  ...v,
                  reason: decisionNote.trim() ? "" : "请填写拒绝原因。",
                }))
              }
              placeholder="例如：补充声音使用许可后重新提交审阅。"
            />
          </Field>
        </FormSection>
      )}
      <label className="confirmation-field">
        <input
          type="checkbox"
          aria-invalid={!!fieldErrors.ack}
          checked={ack}
          onChange={(e) => {
            setAck(e.target.checked);
            setFieldErrors((v) => ({ ...v, ack: "" }));
          }}
        />
        <span>
          我已确认影响范围
          {decision.kind === "retry" ? "与可能产生的新费用" : ""}
          <small>仅确认本条演示操作。</small>
        </span>
      </label>
      {fieldErrors.ack && (
        <p className="field-error" role="alert">
          {fieldErrors.ack}
        </p>
      )}
    </WorkspaceEditor>
  ) : (
    <>
      {scenario === "stale" && (
        <PanelNotice title="快照已过期" tone="warning">
          最近观察 13:12，内容不代表实时状态。
        </PanelNotice>
      )}
      {scenario === "offline" && (
        <PanelNotice title="服务连接中断" tone="error">
          保留最近快照，恢复连接后可重新读取；当前写操作不可用。
        </PanelNotice>
      )}
      {(scenario === "auth" ||
        scenario === "permission" ||
        role === "viewer") && (
        <PanelNotice
          title={scenario === "auth" ? "认证已失效" : "当前为只读视图"}
          tone="warning"
        >
          可查看已有状态与证据，管理操作需要 owner 授权。
        </PanelNotice>
      )}
      {scenario === "capability" && (
        <PanelNotice title="部分能力尚未接线">
          相关操作需要先补充公开管理合同。
        </PanelNotice>
      )}
      {detailRead === "error" && (
        <PanelNotice title="读取失败 · 保留最近快照" tone="error">
          可再次读取同一对象，未自动提交任何写操作。
        </PanelNotice>
      )}
      {detailRead === "loading" ? (
        <div
          className="workspace-skeleton"
          role="status"
          aria-label="正在读取对象"
        >
          <span />
          <span />
          <span />
          <span />
          <span />
          <p>正在读取演示快照…</p>
        </div>
      ) : selection ? (
        task && requestTab === "内容" ? (
          <RequestBody
            key={scopeKey + task.id + requestTab}
            record={demoInvestigation(legacyFacts([task])[0])}
            read={demoRead}
          />
        ) : (
          inspector()
        )
      ) : (
        <div className="inspector-empty">
          <Info size={34} />
          <h3>选择一个对象</h3>
          <p>在这里查看预览、属性和可用操作。</p>
        </div>
      )}
    </>
  );

  const returnFrame = () => {
    window.close();
    setTimeout(() => {
      location.href = frameURL + "#/" + initial.returnPage;
    }, 200);
  };
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        跳到主要内容
      </a>
      <AppShell
        demo
        page={page}
        collapsed={rail}
        mobile={mobileNav}
        onCollapse={() => setCollapsed((v) => !v)}
        onMobile={setMobileNav}
        onNavigate={(id) => go(id as Page)}
        onSearch={() => setSearchOpen(true)}
        identity={"demo:" + role}
        scope={
          <ScopePicker
            summary={`${management.perspective === "personal" ? "个人 · " : management.perspective === "platform" ? "平台 · " : ""}${tenants.find((t) => t.id === management.tenant)?.name || "全部授权租户"} / ${scope}`}
            environment={env === "main" ? "主环境" : "测试环境"}
          >
            <Pick
              label="管理视角"
              value={management.perspective}
              onChange={(v) => changeManagement("perspective", v)}
              options={[
                ...(role === "admin"
                  ? [{ value: "platform", label: "平台" }]
                  : []),
                ...(role !== "viewer"
                  ? [{ value: "team", label: "团队" }]
                  : []),
                { value: "personal", label: "个人" },
              ]}
            />
            <Pick
              label="租户范围"
              value={management.tenant}
              onChange={(v) => changeManagement("tenant", v)}
              options={[
                ...(management.perspective === "platform"
                  ? [{ value: "all", label: "全部租户" }]
                  : []),
                ...tenants
                  .filter((t) => role === "admin" || t.id === "studio")
                  .map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            <Pick
              label="团队范围"
              value={management.team}
              onChange={(v) => changeManagement("team", v)}
              options={[
                { value: "all", label: "全部团队" },
                ...teams
                  .filter(
                    (t) =>
                      management.tenant === "all" ||
                      t.tenant === management.tenant,
                  )
                  .map((t) => ({ value: t.id, label: t.name })),
              ]}
            />

            <Pick
              label="项目范围"
              value={project}
              onChange={(v) => changeScope("project", v)}
              options={[
                { value: "all", label: "全部项目" },
                ...availableProjects.map((p) => ({
                  value: p.id,
                  label: p.name,
                })),
              ]}
            />

            <Pick
              label="环境"
              value={env}
              onChange={(v) => changeScope("env", v)}
              options={[
                { value: "main", label: "内网主环境" },
                { value: "staging", label: "隔离测试环境" },
              ]}
            />
          </ScopePicker>
        }
        actions={
          <>
            {" "}
            <NotificationCenter
              key={scopeKey}
              notices={[
                ...notices,
                ...scopedAssets
                  .filter((a) => a.state.startsWith("待"))
                  .map((a): LibraryNotice => ({
                    id: "asset-" + a.id,
                    title:
                      a.type === "音频"
                        ? "声音产物等待审听"
                        : "视觉产物等待审阅",
                    text: a.name + " · " + a.version + "。" + a.handoff,
                    asset: a.id,
                    tone: "info",
                  })),
              ]}
              onOpenAsset={(id) =>
                guard(() => {
                  setAssetFilters({ ...emptyAssetFilters });
                  goNow("assets", { kind: "asset", id });
                })
              }
              toast={toast}
              onDismissToast={() => setToast("")}
            />
            <button
              className="finder-tool theme-tool"
              aria-label="切换主题"
              title="切换主题"
              onClick={() =>
                setTheme(
                  document.documentElement.dataset.theme === "dark"
                    ? "light"
                    : "dark",
                )
              }
            >
              {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button
              className="finder-tool refresh-tool"
              aria-label="刷新"
              title="刷新快照"
              onClick={refresh}
            >
              <RefreshCw size={17} />
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="account-trigger" aria-label="账户菜单">
                  <span>Y</span>
                  <i />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="admin-menu"
                  align="end"
                  sideOffset={8}
                >
                  <DropdownMenu.Label>Yeisme · 演示账户</DropdownMenu.Label>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    disabled={browse.current.index === 0}
                    onSelect={() => travel(-1)}
                  >
                    后退 <span>Alt ←</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    disabled={
                      browse.current.index >= browse.current.entries.length - 1
                    }
                    onSelect={() => travel(1)}
                  >
                    前进 <span>Alt →</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    onSelect={() => go("members")}
                  >
                    组织与成员
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    onSelect={() => go("settings")}
                  >
                    个人设置
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    onSelect={() => setDemoOpen(true)}
                  >
                    身份与状态演练
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        }
        footer={
          <>
            <a href={frameURL} target="_blank" rel="noopener noreferrer">
              <Box size={16} />
              <span>片场工作台</span>
              <ArrowUpRight size={14} />
            </a>
            <button
              className="demo-trigger"
              aria-label="设计演示"
              onClick={() => setDemoOpen(true)}
            >
              <span className="demo-dot" />
              <span>设计演示</span>
              <MoreHorizontal size={15} />
            </button>
          </>
        }
      >
        <div id="notification-feedback" />
        {initial.source && (
          <div className="source-banner">
            <span>
              来自片场 · {initial.sourceProject || "当前项目"}
              {initial.sourceTask ? " · 已保留原任务引用" : ""}
            </span>
            <button onClick={returnFrame}>
              返回创作位置
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {stateBanner && (
          <div className="global-notice" role="status">
            <CircleAlert size={17} />
            {stateBanner}
          </div>
        )}
        <div className="content-layout">
          <main
            className={"main finder-page page-" + page}
            id="main-content"
            tabIndex={-1}
            ref={mainRef}
          >
            <h1 className="sr-only finder-location" tabIndex={-1}>
              {currentNav.label}
            </h1>
            {["projects", "assets", "services", "audit"].includes(page) && (
              <div className="browser-toolbar">
                {["projects", "assets", "services", "tasks", "audit"].includes(
                  page,
                ) ? (
                  <SearchBox
                    value={query}
                    onChange={(value) =>
                      page === "assets" && dirty
                        ? guard(() => setQuery(value))
                        : setQuery(value)
                    }
                    label={
                      (
                        {
                          projects: "搜索项目",
                          assets: "搜索资产",
                          services: "搜索服务",
                          tasks: "搜索任务",
                          audit: "搜索审计记录",
                        } as Partial<Record<Page, string>>
                      )[page] || "搜索"
                    }
                    placeholder="搜索"
                  />
                ) : null}{" "}
                <div className="browser-toolbar-end">
                  <div className="finder-tools">
                    {["projects", "assets"].includes(page) && (
                      <ViewSwitcher value={view} onChange={setView} />
                    )}
                    {["projects", "assets"].includes(page) && (
                      <SortMenu
                        value={sort}
                        onChange={(v) => setSorts((s) => ({ ...s, [page]: v }))}
                        options={[
                          { value: "name-asc", label: "名称 A → Z" },
                          { value: "name-desc", label: "名称 Z → A" },
                          ...(page === "tasks"
                            ? [
                                {
                                  value: "updated" as SortOrder,
                                  label: "最近更新",
                                },
                              ]
                            : [{ value: "type" as SortOrder, label: "种类" }]),
                          ...(page !== "projects"
                            ? [
                                {
                                  value: "status" as SortOrder,
                                  label: "状态",
                                },
                              ]
                            : []),
                        ]}
                      />
                    )}
                    {["projects", "assets"].includes(page) && (
                      <>
                        <span className="tool-separator" />
                        <button
                          className="finder-tool"
                          aria-label="快速查看"
                          title="快速查看 · 空格"
                          disabled={!selectedItem}
                          onClick={() => selectedItem && quick(selectedItem)}
                        >
                          <Eye size={19} />
                        </button>
                        <button
                          className={
                            "finder-tool " + (inspectorOpen ? "active" : "")
                          }
                          aria-label="显示简介"
                          title="显示简介"
                          aria-pressed={inspectorOpen}
                          onClick={() => {
                            if (inspectorOpen) closeInspector();
                            else {
                              focusRef.current =
                                document.activeElement as HTMLElement;
                              setWorkspaceHidden(false);
                              setInspectorOpen(true);
                            }
                          }}
                        >
                          <Info size={19} />
                        </button>
                      </>
                    )}
                  </div>{" "}
                </div>
              </div>
            )}
            <SectionNavigation
              page={page}
              onNavigate={(id) => go(id as Page)}
            />
            {page === "approvals" && (
              <div className="page-tabs-row">
                <Button variant="ghost" onClick={() => go("tasks")}>
                  返回请求
                </Button>
                <span className="muted">待处理事项</span>
              </div>
            )}
            {content}
            <footer className="app-footer">
              <span>Yeisme · 设计演示 · 非实时数据</span>
              <button onClick={() => go("settings")}>
                文档与交接 <ArrowUpRight size={13} />
              </button>
            </footer>
          </main>
          <RightWorkspace
            key={scopeKey}
            open={
              (inspectorOpen || editorActive || !!receipt || !!batchResult) &&
              !workspaceHidden
            }
            editing={editorActive || !!receipt || !!batchResult}
            title={workspaceTitle}
            subtitle={workspaceSubtitle}
            icon={workspaceIcon}
            status={workspaceStatus}
            tabs={
              !editorActive && !receipt && !batchResult && service ? (
                serviceTabs()
              ) : !editorActive && !receipt && !batchResult && task ? (
                <AdminTabs
                  value={requestTab}
                  onChange={setRequestTab}
                  items={requestDetailTabs}
                />
              ) : undefined
            }
            footer={
              !editorActive && !receipt && !batchResult
                ? detailFooter()
                : undefined
            }
            stage={
              pending
                ? "submitting"
                : receipt || batchResult
                  ? "receipt"
                  : configOpen
                    ? configStep
                    : editorActive
                      ? "edit"
                      : "detail"
            }
            context={`${env === "main" ? "内网主环境" : "隔离测试环境"} / ${scope} / ${{ admin: "管理员", operator: "操作员", viewer: "只读成员" }[role]}`}
            objectKey={
              configOpen
                ? "config:" + configService
                : connectOpen
                  ? "connect"
                  : decision?.id || selection?.id || "none"
            }
            close={closeInspector}
            back={
              editorActive && !pending ? () => guard(returnDetail) : undefined
            }
          >
            {workspaceContent}
          </RightWorkspace>
        </div>
        {workspaceHidden && (editorActive || receipt) && (
          <button
            className="workspace-resume"
            onClick={() => {
              setWorkspaceHidden(false);
              setInspectorOpen(true);
            }}
          >
            {pending ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <CheckCheck size={15} />
            )}{" "}
            {pending ? "操作处理中 · 恢复工作区" : "查看操作回执"}
            <ArrowRight size={14} />
          </button>
        )}
      </AppShell>
      {auditID && scopedAudit.some((a) => a.id === auditID) && (
        <AdminPanel
          open
          editing={false}
          title={scopedAudit.find((a) => a.id === auditID)!.title}
          subtitle="诊断与操作回执"
          objectKey={auditID}
          stage="审计详情"
          context="设计演示 · 脱敏证据"
          close={() => setAuditID(null)}
        >
          <div className="detail-section">
            <CopyReference value={auditID} />
            <p>{scopedAudit.find((a) => a.id === auditID)!.detail}</p>
            <Badge state={scopedAudit.find((a) => a.id === auditID)!.outcome} />
            <PanelNotice title="证据边界">
              此回执只证明演示中的操作结果，不包含真实请求参数或凭据。
            </PanelNotice>
          </div>
        </AdminPanel>
      )}
      <QuickLook
        key={"quick-" + scopeKey}
        item={quickItem}
        origin={quickOrigin}
        close={() => setQuickId(null)}
        previous={() => cycleQuick(-1)}
        next={() => cycleQuick(1)}
        open={() => quickItem && openItem(quickItem)}
      />
      <Modal
        open={demoOpen}
        close={() => setDemoOpen(false)}
        title="设计演示"
        description="切换样例状态与成员视角。所有操作仅发生在此原型中。"
      >
        <div className="simulation-bar">
          <span>
            <Monitor size={14} />
            原型演练
          </span>
          <Pick
            label="状态演练"
            value={scenario}
            onChange={(v) => changeScope("scenario", v)}
            options={scenarios}
          />
          <Pick
            label="身份演练"
            value={role}
            onChange={(v) => changeScope("role", v)}
            options={[
              { value: "admin", label: "管理员" },
              { value: "operator", label: "操作员" },
              { value: "viewer", label: "只读成员" },
            ]}
          />
          <span className="simulation-note">
            仅改变演示状态 · 不调用真实服务
          </span>
          <button
            className="text-button"
            onClick={() => {
              invalidate();
              setOperations(initialOperations);
              setApprovals(initialApprovals);
              setAudit(initialAudit);
              setConfigs({});
              setServices(baseServices);
              setHistorical(requestFixtures);
              setOrganization({
                members: memberFixtures,
                archived: [],
                quotas: {},
                events: [],
              });
              setScenario("normal");
              notify("本次演示已重置，外部服务与片场数据保持原样。");
            }}
          >
            重置演示
          </button>
        </div>
      </Modal>
      <Modal
        open={searchOpen}
        close={() => setSearchOpen(false)}
        title="搜索与跳转"
        description="搜索页面、服务或当前范围的任务。"
      >
        <SearchBox
          value={globalQuery}
          onChange={setGlobalQuery}
          label="全局搜索"
          placeholder="输入服务、页面或任务名称…"
        />
        <div className="search-results">
          {nav
            .filter((n) => n.label.includes(globalQuery))
            .map((n) => (
              <button key={n.id} onClick={() => go(n.id)}>
                <n.icon size={17} />
                <span>{n.label}</span>
                <small>页面</small>
              </button>
            ))}
          {scopedServices
            .filter((s) =>
              s.name.toLowerCase().includes(globalQuery.toLowerCase()),
            )
            .slice(0, 8)
            .map((s) => (
              <button
                key={s.id}
                onClick={() => go("services", { kind: "service", id: s.id })}
              >
                <Server size={17} />
                <span>{s.name}</span>
                <small>服务</small>
              </button>
            ))}
          {globalQuery &&
            scoped
              .filter((t) => t.title.includes(globalQuery))
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => go("tasks", { kind: "task", id: t.id })}
                >
                  <ListTodo size={17} />
                  <span>{t.title}</span>
                  <small>任务</small>
                </button>
              ))}
        </div>
      </Modal>
      <DraftGuard
        open={leaveOpen}
        cancel={() => {
          setLeaveOpen(false);
          pendingNavigation.current = null;
        }}
        discard={() => {
          setLeaveOpen(false);
          const action = pendingNavigation.current;
          pendingNavigation.current = null;
          action?.();
        }}
      />
    </>
  );
}

const demoMode =
  (import.meta as unknown as { env: { MODE: string } }).env.MODE === "demo" ||
  new URLSearchParams(location.search).get("mode") === "demo";
if (demoMode) createRoot(document.getElementById("root")!).render(<DemoApp />);
else
  import("./live-app").then(({ LiveApp }) =>
    createRoot(document.getElementById("root")!).render(<LiveApp />),
  );
