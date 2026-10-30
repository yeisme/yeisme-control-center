import { Component, Suspense, useEffect, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import { ListPreferencesProvider } from "./list-preferences";
import { TaskObservationProvider } from "./tasks-context";
import { NotificationProvider } from "./notifications-context";
import { ObservationCacheProvider } from "./observation-cache";
import { AudioPlayerProvider } from "./audio-player";
import { RecentProvider } from "./recent";
import { routePage } from "./route-page";
import { claimChunkReload, isChunkLoadError, mayReloadForChunk } from "./chunk-recovery";
import { AuthLoading, AuthProblem, LoginScreen, PublicGuideRedirect } from "./auth";
import { dismissBootSplash } from "./boot-splash";
import { AppShell } from "../app-shell/AppShell";
import { ThemeProvider } from "../app-shell/theme";
import { pageFromPath, type WorkspacePage } from "../app-shell/navigation";
import { Button, EmptyState, SkeletonBlock, SkeletonRows, ToastProvider, TooltipProvider } from "../components/ui";
import { CopyProvider } from "./item-actions";
import { RefreshCw, Unplug } from "../icons";
import "../styles/app.css";

const loaders: Record<WorkspacePage, () => Promise<{ default: ComponentType }>> = {
  home: () => import("../pages/home/HomePage"),
  projects: () => import("../pages/projects/ProjectsPage"),
  drama: () => import("../pages/drama/DramaPage"),
  guide: () => import("../pages/guide/GuidePage"),
  creation: () => import("../pages/creation/CreationPage"),
  assets: () => import("../pages/assets/AssetsPage"),
  tasks: () => import("../pages/tasks/TasksPage"),
  reminders: () => import("../pages/reminders/RemindersPage"),
  requests: () => import("../pages/requests/RequestsPage"),
  review: () => import("../pages/review/ReviewPage"),
  services: () => import("../pages/services/ServicesPage"),
  capabilities: () => import("../pages/capabilities/CapabilityHub"),
  usage: () => import("../pages/usage/UsageAnalytics"),
  team: () => import("../pages/team/TeamPage"),
};

const pages = Object.fromEntries(Object.entries(loaders).map(([id, load]) => [id, routePage(load)])) as Record<WorkspacePage, ReturnType<typeof routePage>>;

/** Warms every page chunk after sign-in so navigation never waits on a network fetch. */
function usePrefetchPages(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const schedule = window.requestIdleCallback || ((callback: () => void) => window.setTimeout(callback, 600));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = schedule(() => { for (const page of Object.values(pages)) void page.preload().catch(() => {}); });
    return () => cancel(handle);
  }, [enabled]);
}

/** Page-shaped placeholder while a route chunk loads: toolbar, metric row and a list panel rise in turn. */
function PageSkeleton() {
  return <div aria-hidden="true" className="space-y-5">
    <div className="stagger-in flex items-center justify-between gap-4" style={{ "--i": 0 } as CSSProperties}><SkeletonBlock className="h-4 w-80 max-w-[60%]" /><SkeletonBlock className="h-8 w-28 rounded-control" /></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((index) => <SkeletonBlock key={index} className="stagger-in h-[76px] rounded-card" style={{ "--i": index + 1 } as CSSProperties} />)}</div>
    <div className="stagger-in rounded-card border border-line bg-panel" style={{ "--i": 5 } as CSSProperties}><SkeletonRows rows={6} /></div>
  </div>;
}

/**
 * A failed page chunk (network blip, redeploy) must not leave a blank screen. The browser remembers a failed module fetch
 * for the rest of the document's life, even one from the idle prefetch, so the page could only ever fail again: the
 * boundary reloads once by itself, keeping the skeleton up meanwhile, and shows the reload button when the browser is
 * offline or the chunk failed again within a minute.
 */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean; reloading: boolean }> {
  state = { failed: false, reloading: false };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, reloading: isChunkLoadError(error) && navigator.onLine !== false && sessionReloadAllowed() };
  }
  componentDidCatch() {
    if (!this.state.reloading) return;
    try {
      if (claimChunkReload(sessionStorage)) window.location.reload();
      else this.setState({ reloading: false });
    } catch {
      this.setState({ reloading: false });
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.reloading) return <PageSkeleton />;
    return <EmptyState icon={<Unplug />} title="页面加载失败" body="网络中断或客户端已更新，页面代码没有加载完成。" action={<Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => window.location.reload()}>重新加载</Button>} />;
  }
}

/** Storage can be unavailable (privacy settings); then the boundary never reloads by itself. */
function sessionReloadAllowed() {
  try {
    return mayReloadForChunk(sessionStorage);
  } catch {
    return false;
  }
}

function Workspace() {
  const { phase, scopeId, generation } = useWorkspace();
  const location = useLocation();
  usePrefetchPages(phase === "ready");
  useEffect(() => { if (phase !== "loading") dismissBootSplash(); }, [phase]);
  if (phase === "loading") return <AuthLoading />;
  if (phase === "login_required") return location.pathname === "/guide" ? <PublicGuideRedirect search={location.search} /> : <LoginScreen />;
  if (phase === "forbidden") return <AuthProblem kind="forbidden" />;
  if (phase === "offline") return <AuthProblem kind="offline" />;
  const page = pageFromPath(location.pathname);
  const Page = pages[page].Page;
  return <ObservationCacheProvider>
    <TaskObservationProvider>
      <NotificationProvider>
      <ListPreferencesProvider>
      <AudioPlayerProvider>
      <RecentProvider>
        <AppShell>
          <PageBoundary key={page}>
            <Suspense fallback={<PageSkeleton />}>
              {/* Keyed by scope+generation so every page-local state (selection, drafts, content) resets on scope or epoch change. */}
              <Page key={`${page}:${scopeId}:${generation}`} />
            </Suspense>
          </PageBoundary>
        </AppShell>
      </RecentProvider>
      </AudioPlayerProvider>
      </ListPreferencesProvider>
      </NotificationProvider>
    </TaskObservationProvider>
  </ObservationCacheProvider>;
}

export function App() {
  return <ThemeProvider>
    <TooltipProvider>
      <ToastProvider>
        <CopyProvider>
          <WorkspaceProvider>
            <Workspace />
          </WorkspaceProvider>
        </CopyProvider>
      </ToastProvider>
    </TooltipProvider>
  </ThemeProvider>;
}
