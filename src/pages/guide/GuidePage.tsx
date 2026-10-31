import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, isRouteUnavailable } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { useObservationCache } from "../../app/observation-cache";
import { toolCatalogCacheKey, type ToolCatalog } from "../../shared/tool-catalog";
import { GuideContent, type GuideCatalog } from "./GuideContent";
import { appGuidePath, parseAppGuide } from "./guide-location";
import type { GuideNavigator } from "./GuideNav";

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

/** The guide inside the workspace: chapters and pages live in the hash route, `#/guide/<chapter>/<page>?…`. */
export default function GuidePage() {
  const navigate = useNavigate();
  const route = useLocation();
  const read = useCatalog();
  const location = useMemo(() => parseAppGuide(route.pathname, new URLSearchParams(route.search)), [route.pathname, route.search]);
  const nav: GuideNavigator = {
    hrefFor: (to) => `#${appGuidePath(to)}`,
    go: (to, options) => navigate(appGuidePath(to), { replace: options?.replace }),
  };
  const catalog: GuideCatalog = { status: read.status === "loading" ? "loading" : read.data?.catalog ? "ready" : "unavailable", catalog: read.data?.catalog ?? null };
  return <GuideContent
    location={location}
    nav={nav}
    catalog={catalog}
    link={{ label: "查看已发现的工具", onClick: () => navigate("/capabilities?tab=tools") }}
  />;
}
