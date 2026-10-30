import { useNavigate, useSearchParams } from "react-router-dom";
import { api, isRouteUnavailable } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { useObservationCache } from "../../app/observation-cache";
import { toolCatalogCacheKey, type ToolCatalog } from "../../shared/tool-catalog";
import { GuideContent, type GuideCatalog } from "./GuideContent";

/** Live catalog for the proof line and per-tool status; the guide copy never waits on it. */
function useCatalog() {
  const cache = useObservationCache();
  return useScopedRead<{ catalog: ToolCatalog | null }>(async (scope, signal) => {
    const cached = cache.peek<ToolCatalog>(toolCatalogCacheKey);
    if (cached && !cached.stale) return { catalog: cached.data };
    try {
      const catalog = await api.toolCatalog(scope, {}, signal);
      cache.put(toolCatalogCacheKey, catalog, 5 * 60_000, 30 * 60_000);
      return { catalog };
    } catch (error) {
      if (!isRouteUnavailable(error) && !signal.aborted) return { catalog: cached?.data || null };
      return { catalog: null };
    }
  });
}

export default function GuidePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const read = useCatalog();
  const write = (key: "tool" | "client", value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };
  const catalog: GuideCatalog = { status: read.status === "loading" ? "loading" : read.data?.catalog ? "ready" : "unavailable", catalog: read.data?.catalog ?? null };
  return <GuideContent
    toolId={params.get("tool")}
    client={params.get("client") === "codex" ? "codex" : "claude"}
    onTool={(id) => write("tool", id)}
    onClient={(id) => write("client", id)}
    catalog={catalog}
    link={{ label: "查看已发现的工具", onClick: () => navigate("/capabilities?tab=tools") }}
  />;
}
