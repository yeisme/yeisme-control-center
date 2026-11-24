import { useEffect } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/control-center-client";
import { BatchGeneration } from "./BatchGeneration";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { Button, EmptyState, ReadStateView, SkeletonRows } from "../../components/ui";
import { FolderKanban, Sparkles } from "../../icons";

const guideTools = new Set(["eikona", "sonora", "scaena", "auctra"]);

/**
 * Shared-project batch generation, reached from its tab, the project page and batch notifications. Outside a project
 * scope it asks which project to generate in; an old tool link (`?owner=`) still lands on 使用指南, and a notification
 * that names a project opens that project. Generation always goes through the owner CLI/MCP gates.
 */
export default function CreationPage() {
  const { scopeId, session, setScope } = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // A batch reminder names its project: open that project here, keeping `?batch=`, whatever scope was current.
  const shared = params.get("sharedProject");
  const reachable = !!shared && !!session?.scopes.some((scope) => scope.id === shared);
  const switching = reachable && shared !== scopeId;
  useEffect(() => { if (switching) setScope(shared!); }, [switching, shared, setScope]);
  const inProject = scopeId.startsWith("project_") && !switching;
  const project = useScopedRead((_scope, signal) => api.sharedProject(scopeId, signal), { enabled: inProject, key: scopeId });
  if (switching) return <SkeletonRows rows={5} />;
  if (!inProject) {
    if (shared) return <Navigate replace to={`/projects?${new URLSearchParams({ shared: "1", sharedProject: shared })}`} />;
    const owner = params.get("owner");
    if (owner) return <Navigate replace to={guideTools.has(owner) ? `/guide?tool=${owner}` : "/guide"} />;
    const projects = (session?.scopes || []).filter((scope) => scope.id.startsWith("project_"));
    return <div className="page-enter" data-page="creation" data-creation-pick>
      <EmptyState
        icon={<Sparkles />}
        title="批量生成在项目里进行"
        body="选一个项目：生成用它关联的工具、额度和成员权限。单个任务请用工具自己的 CLI 或 MCP。"
        action={<div className="flex flex-wrap justify-center gap-2">
          {projects.slice(0, 6).map((scope) => <Button key={scope.id} size="sm" variant="secondary" data-creation-project={scope.id} icon={<FolderKanban className="size-4" />} onClick={() => setScope(scope.id)}>{scope.label}</Button>)}
          <Button size="sm" variant={projects.length ? "ghost" : "primary"} onClick={() => navigate("/projects")}>{projects.length ? "全部项目" : "去新建项目"}</Button>
        </div>}
      />
    </div>;
  }
  return <ReadStateView status={project.status} error={project.error} onRetry={project.reload} skeleton={<SkeletonRows rows={5} />}>{project.data && <BatchGeneration key={project.data.id} project={project.data} />}</ReadStateView>;
}
