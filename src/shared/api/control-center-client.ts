export const controlCenterPrefix = "/api/control-center/v1";

export interface ServiceConnectionObservation {
  id: string;
  owner: "eikona" | "scaena" | "sonora" | string;
  instance_id: string;
  label: string;
  environment: string;
  project: string;
  state: string;
  observed_at: string;
  runtime?: {
    state: string;
    checked_at: string;
    last_success_at: string | null;
    transport: "verified" | "unknown";
    authorization: "verified" | "denied" | "unknown";
    contract: "supported" | "unsupported" | "unknown";
    content: "not_requested" | "not_verified" | "supported" | "unsupported" | "denied";
    reason?: string;
  };
}

export interface ServiceDirectoryEntry {
  id: string;
  name: string;
  kind: string;
  purpose: string;
  integration: string;
  gap: string;
  configuration: "configured" | "not_configured" | "needs_contract";
  observation: "not_checked" | string;
  connections: ServiceConnectionObservation[];
}

export class ControlCenterApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = "ControlCenterApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ControlCenterApiError("invalid_control_center_response", response.status || 502);
  }
  if (!response.ok) throw new ControlCenterApiError((body as { error?: string })?.error || "control_center_unavailable", response.status);
  return body as T;
}

export interface WorkspaceSession {
  name: string;
  username?: string;
  role: string;
  csrf: string;
  scopes: { id: string; label: string; tenant?: string; project?: string; environment?: string; owners?: string[] }[];
}
export type Session = WorkspaceSession;
export type Scope = WorkspaceSession["scopes"][number];

export interface WorkspaceAuthMethods {
  personal?: boolean;
  username_required?: boolean;
  key_required?: boolean;
}

export async function readWorkspaceAuthMethods(signal?: AbortSignal) {
  return readJson<WorkspaceAuthMethods>(await fetch("/api/control-center/v1/auth/methods", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  }));
}

export interface ProviderRunProjection {
  run_ref: string;
  owner: "eikona" | "scaena" | "sonora";
  modality: "image" | "video" | "audio";
  model_ref: string;
  project_ref: string;
  trace_ref: string;
  source_ref: string | null;
  state: string;
  output_refs: string[];
  upstream_cost: number | null;
  currency: string;
  cost_state: string;
  observed_at: string;
  error_code: string | null;
}

export async function readWorkspaceSession(signal?: AbortSignal) {
  return readJson<WorkspaceSession>(await fetch("/api/control-center/v1/session", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  }));
}

type LiveTask = {
  title: string;
  state: string;
  stage?: string;
  created_at: string;
  updated_at?: string | null;
  observed_at?: string;
  source?: string;
  actor?: string | null;
  coverage?: "complete" | "partial";
  locator: { owner: string; project: string; task_family: string; task_ref: string };
  episode_ref?: string;
  results?: { ref: string; name: string; mime: string; bytes: number | null; state: string; width?: number; height?: number; duration_ms?: number }[];
};

export async function readLiveWorkspace(scope: string, signal?: AbortSignal) {
  const query = `?scope=${encodeURIComponent(scope)}`;
  const [capabilities, usage, active, history, services, connections] = await Promise.all([
    readJson<{ capabilities?: any[] }>(await fetch(`/api/control-center/v1/capabilities${query}`, { credentials: "same-origin", cache: "no-store", signal })),
    readJson<{ rows?: any[] }>(await fetch(`/api/control-center/v1/usage${query}`, { credentials: "same-origin", cache: "no-store", signal })),
    readJson<{ rows?: LiveTask[] }>(await fetch(`/api/control-center/v1/tasks?mode=active${query}`, { credentials: "same-origin", cache: "no-store", signal })),
    readJson<{ rows?: LiveTask[] }>(await fetch(`/api/control-center/v1/tasks?mode=history${query}`, { credentials: "same-origin", cache: "no-store", signal })),
    readJson<{ services?: ServiceDirectoryEntry[] }>(await fetch(`/api/control-center/v1/services${query}&observe=1`, { credentials: "same-origin", cache: "no-store", signal })).catch(() => ({ services: [] })),
    readJson<{ connections?: ServiceConnectionObservation[] }>(await fetch(`/api/control-center/v1/connections${query}`, { credentials: "same-origin", cache: "no-store", signal })).catch(() => ({ connections: [] })),
  ]);
  return {
    capabilities: capabilities.capabilities || [],
    usage: usage.rows || [],
    tasks: [...(active.rows || []), ...(history.rows || [])],
    services: services.services || [],
    connections: connections.connections || [],
  };
}

export async function readLiveTask(taskRef: string, scope: string, signal?: AbortSignal) {
  return readJson<any>(await fetch(`/api/control-center/v1/tasks/${encodeURIComponent(taskRef)}?scope=${encodeURIComponent(scope)}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  }));
}

export async function readProviderRun(scope: string, runRef: string, signal?: AbortSignal) {
  return readJson<ProviderRunProjection>(await fetch(`/api/control-center/v1/provider-runs/${encodeURIComponent(runRef)}?scope=${encodeURIComponent(scope)}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  }));
}

export async function accessTaskArtifact(taskRef: string, artifactRef: string, scope: string, purpose: "preview" | "download", csrf: string) {
  return readJson<{ url: string; mime: string; expires_at: string; filename?: string }>(await fetch(`/api/control-center/v1/tasks/${encodeURIComponent(taskRef)}/artifacts/${encodeURIComponent(artifactRef)}/access?scope=${encodeURIComponent(scope)}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ purpose }),
  }));
}

export async function loginWorkspace(username: string, secretValue: string, keyRequired = false) {
  return readJson<{ ok: true }>(await fetch("/api/control-center/v1/auth/personal", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, ...(keyRequired ? { key: secretValue } : { password: secretValue }) }),
  }));
}

