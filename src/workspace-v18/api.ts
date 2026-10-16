import type { WorkspaceV18State } from "./types";

const prefix = "/api/control-center/v1/workspace-v18";

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("invalid_workspace_v18_response");
  }
  if (!response.ok) throw new Error((body as { error?: string })?.error || "workspace_v18_unavailable");
  return body as T;
}

export async function readWorkspaceV18(signal?: AbortSignal) {
  return readJson<WorkspaceV18State>(await fetch(`${prefix}/state`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  }));
}

export async function writeWorkspaceV18(path: string, body: unknown, csrf?: string) {
  return readJson<WorkspaceV18State>(await fetch(`${prefix}${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(body),
  }));
}

export interface WorkspaceSession {
  name: string;
  username?: string;
  role: string;
  csrf: string;
  scopes: { id: string; label: string; tenant?: string; project?: string; environment?: string; owners?: string[] }[];
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
  const [capabilities, usage, active, history] = await Promise.all([
    readJson<{ capabilities?: any[] }>(await fetch(`/api/control-center/v1/capabilities${query}`, { credentials: "same-origin", cache: "no-store", signal })),
    readJson<{ rows?: any[] }>(await fetch(`/api/control-center/v1/usage${query}`, { credentials: "same-origin", cache: "no-store", signal })),
    readJson<{ rows?: LiveTask[] }>(await fetch(`/api/control-center/v1/tasks?mode=active${query}`, { credentials: "same-origin", cache: "no-store", signal })).catch(() => ({ rows: [] })),
    readJson<{ rows?: LiveTask[] }>(await fetch(`/api/control-center/v1/tasks?mode=history${query}`, { credentials: "same-origin", cache: "no-store", signal })).catch(() => ({ rows: [] })),
  ]);
  return { capabilities: capabilities.capabilities || [], usage: usage.rows || [], tasks: [...(active.rows || []), ...(history.rows || [])] };
}

export async function submitProviderRun(input: {
  scope_id: string;
  project_ref: string;
  owner: "eikona" | "scaena" | "sonora";
  modality: "image" | "video" | "audio";
  model_ref: string;
  prompt: string;
  budget_cap: { amount: number; currency: "CNY" };
  idempotency_key: string;
  trace_ref: string;
}, csrf: string) {
  return readJson<ProviderRunProjection>(await fetch("/api/control-center/v1/provider-runs", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ mode: "live", ...input }),
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

export async function loginWorkspace(username: string, key: string) {
  return readJson<{ ok: true }>(await fetch("/api/control-center/v1/auth/personal", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, key }),
  }));
}

export async function downloadWorkspaceAsset(assetId: string, versionId: string, csrf: string) {
  return readJson<{ url: string; expires_at: string; filename?: string }>(await fetch(`${prefix}/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/access`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ purpose: "download" }),
  }));
}
