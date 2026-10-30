import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/control-center-client";
import { BatchGeneration } from "./BatchGeneration";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { ReadStateView, SkeletonRows } from "../../components/ui";

const guideTools = new Set(["eikona", "sonora", "scaena", "auctra"]);

/**
 * Shared-project batch generation, reached from the project page and batch notifications. The former
 * AI 创作 workbench is gone: outside a project scope its links land on 使用指南 (or on the project
 * page when a notification names one), so generation always goes through the owner CLI/MCP gates.
 */
export default function CreationPage() {
  const { scopeId, session, setScope } = useWorkspace();
  const [params] = useSearchParams();
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
    return <Navigate replace to={owner && guideTools.has(owner) ? `/guide?tool=${owner}` : "/guide"} />;
  }
  return <ReadStateView status={project.status} error={project.error} onRetry={project.reload} skeleton={<SkeletonRows rows={5} />}>{project.data && <BatchGeneration key={project.data.id} project={project.data} />}</ReadStateView>;
}
