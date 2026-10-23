import { Component, lazy, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import { ListPreferencesProvider } from "./list-preferences";
import { TaskObservationProvider } from "./tasks-context";
import { NotificationProvider } from "./notifications-context";
import { ObservationCacheProvider } from "./observation-cache";
import { AuthLoading, AuthProblem, LoginScreen } from "./auth";
import { AppShell } from "../app-shell/AppShell";
import { ThemeProvider } from "../app-shell/theme";
import { pageFromPath, type WorkspacePage } from "../app-shell/navigation";
import { Button, EmptyState, SkeletonRows, ToastProvider, TooltipProvider } from "../components/ui";
import { RefreshCw, Unplug } from "../icons";
import "../styles/app.css";

const loaders: Record<WorkspacePage, () => Promise<{ default: ComponentType }>> = {
  home: () => import("../pages/home/HomePage"),
  projects: () => import("../pages/projects/ProjectsPage"),
  drama: () => import("../pages/drama/DramaPage"),
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
const pages = Object.fromEntries(Object.entries(loaders).map(([id, load]) => [id, lazy(load)])) as unknown as Record<WorkspacePage, ComponentType>;

/** Warms every page chunk after sign-in so navigation never waits on a network fetch. */
function usePrefetchPages(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const schedule = window.requestIdleCallback || ((callback: () => void) => window.setTimeout(callback, 600));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = schedule(() => { for (const load of Object.values(loaders)) void load().catch(() => {}); });
    return () => cancel(handle);
  }, [enabled]);
}

/** A failed page chunk (network blip, redeploy) must not leave a blank screen; retry reloads the bundle. */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <EmptyState icon={<Unplug />} title="页面加载失败" body="网络中断或客户端已更新，页面代码没有加载完成。" action={<Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => window.location.reload()}>重新加载</Button>} />;
  }
}

function Workspace() {
  const { phase, scopeId, generation } = useWorkspace();
  const location = useLocation();
  usePrefetchPages(phase === "ready");
  if (phase === "loading") return <AuthLoading />;
  if (phase === "login_required") return <LoginScreen />;
  if (phase === "forbidden") return <AuthProblem kind="forbidden" />;
  if (phase === "offline") return <AuthProblem kind="offline" />;
  const page = pageFromPath(location.pathname);
  const Page = pages[page];
  return <ObservationCacheProvider>
    <TaskObservationProvider>
      <NotificationProvider>
      <ListPreferencesProvider>
        <AppShell>
          <PageBoundary key={page}>
            <Suspense fallback={<SkeletonRows rows={6} />}>
              {/* Keyed by scope+generation so every page-local state (selection, drafts, content) resets on scope or epoch change. */}
              <Page key={`${page}:${scopeId}:${generation}`} />
            </Suspense>
          </PageBoundary>
        </AppShell>
      </ListPreferencesProvider>
      </NotificationProvider>
    </TaskObservationProvider>
  </ObservationCacheProvider>;
}

export function App() {
  return <ThemeProvider>
    <TooltipProvider>
      <ToastProvider>
        <WorkspaceProvider>
          <Workspace />
        </WorkspaceProvider>
      </ToastProvider>
    </TooltipProvider>
  </ThemeProvider>;
}
