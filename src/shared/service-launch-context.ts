/** Controlled hand-off contract. Only server-generated route data and opaque refs cross a service boundary. */
export const serviceLaunchContextSchemaVersion = "yeisme.service_launch_context.v1" as const;
export type ServiceLaunchRoute = "script" | "storyboard" | "director" | "breakdown" | "home";

const refPattern = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,200}$/;
const returnPathPattern = /^\/(?:[A-Za-z0-9._~-]+\/?)*$/;
const forbiddenKey = /(?:token|secret|password|credential|authorization|cookie|command|shell|tool|payload|path|file)/i;

export interface SafeLaunchTarget {
  origin: string;
  route: ServiceLaunchRoute;
  url: string;
}

export interface ServiceLaunchContext {
  schema_version: typeof serviceLaunchContextSchemaVersion;
  source: "control-center";
  service_id: string;
  scope_id: string;
  epoch: number;
  project_ref: string;
  route: ServiceLaunchRoute;
  return_path: string;
  safe_object_refs: string[];
  target?: SafeLaunchTarget;
}

export interface ServiceLaunchContextInput {
  service_id: string;
  scope_id: string;
  epoch: number;
  project_ref: string;
  route: ServiceLaunchRoute;
  return_path?: string;
  safe_object_refs?: string[];
  origin?: string;
  query?: Record<string, string | undefined>;
}

function validRef(value: unknown): value is string {
  return typeof value === "string" && refPattern.test(value) && !value.includes("..");
}

function validOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function safeRoute(route: unknown): ServiceLaunchRoute {
  return ["script", "storyboard", "director", "breakdown", "home"].includes(route as string) ? route as ServiceLaunchRoute : "home";
}

function safeQuery(query: Record<string, string | undefined> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(query || {}).slice(0, 16)) {
    if (!/^[a-z][a-z0-9_]{0,32}$/.test(key) || forbiddenKey.test(key) || !value || !validRef(value)) continue;
    result[key] = value;
  }
  return result;
}

/** Build a safe URL from a configured origin only. Arbitrary URLs and route fragments are rejected. */
export function safeLaunchTarget(origin: string | undefined, route: ServiceLaunchRoute, query?: Record<string, string | undefined>): SafeLaunchTarget | undefined {
  if (!validOrigin(origin)) return undefined;
  try {
    const url = new URL(origin);
    for (const [key, value] of Object.entries(safeQuery(query))) url.searchParams.set(key, value);
    url.hash = `/${safeRoute(route)}`;
    return { origin, route: safeRoute(route), url: url.href };
  } catch {
    return undefined;
  }
}

export function createServiceLaunchContext(input: ServiceLaunchContextInput): ServiceLaunchContext {
  const service_id = validRef(input.service_id) ? input.service_id : "unknown";
  const scope_id = validRef(input.scope_id) ? input.scope_id : "unknown";
  const project_ref = validRef(input.project_ref) ? input.project_ref : "unknown";
  const epoch = Number.isInteger(input.epoch) && input.epoch >= 0 ? input.epoch : 0;
  const return_path = typeof input.return_path === "string" && returnPathPattern.test(input.return_path) ? input.return_path : "/";
  const refs = [...new Set((input.safe_object_refs || []).filter(validRef))].slice(0, 16);
  const target = safeLaunchTarget(input.origin, input.route, { ...input.query, project: project_ref });
  return {
    schema_version: serviceLaunchContextSchemaVersion,
    source: "control-center",
    service_id,
    scope_id,
    epoch,
    project_ref,
    route: safeRoute(input.route),
    return_path,
    safe_object_refs: refs,
    ...(target ? { target } : {}),
  };
}

export function launchContextMatches(context: ServiceLaunchContext, expected: { service_id: string; scope_id: string; epoch: number; project_ref: string }): boolean {
  return context.service_id === expected.service_id && context.scope_id === expected.scope_id && context.epoch === expected.epoch && context.project_ref === expected.project_ref;
}

export function normalizeServiceLaunchContext(raw: unknown): ServiceLaunchContext {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createServiceLaunchContext({ service_id: "unknown", scope_id: "unknown", epoch: 0, project_ref: "unknown", route: "home" });
  const value = raw as Record<string, unknown>;
  const target = value.target && typeof value.target === "object" ? value.target as Record<string, unknown> : undefined;
  // Never accept a target URL supplied by a client; only an origin can be re-materialized by the server.
  return createServiceLaunchContext({
    service_id: String(value.service_id ?? "unknown"),
    scope_id: String(value.scope_id ?? "unknown"),
    epoch: typeof value.epoch === "number" ? value.epoch : 0,
    project_ref: String(value.project_ref ?? "unknown"),
    route: safeRoute(value.route),
    return_path: typeof value.return_path === "string" ? value.return_path : "/",
    safe_object_refs: Array.isArray(value.safe_object_refs) ? value.safe_object_refs.filter((item): item is string => typeof item === "string") : [],
    origin: typeof target?.origin === "string" ? target.origin : undefined,
  });
}
