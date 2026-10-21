import type { TaskConnectionState, TaskEvent, TaskPage, TaskSnapshot } from "../../task-observation";
import type { ProcessObservation, ProcessCheckpoint, PromptCaptureObservation } from "../../observation-contract";
import type { ServiceDirectoryEntry } from "../../service-directory";
import type { AttachmentRead, ContentRead, Coverage, CoverageState, Owner, RequestProjection, RequestQuery, RequestSummary } from "../../request-visibility";
import type { ControlCenterErrorClass } from "../types";
import type { ActionConfirmRequest, ActionDescriptor, ActionPreview, ActionPreviewRequest, ActionReceipt } from "../action-contract";
import type { WorkQueueFilters, WorkQueueResponse } from "../work-queue";
import type { CreativeFlowProjection } from "../creative-flow";
import type { CreativeCapabilityContract, CreativeInputSpec } from "../creative-input";
import type { ToolCatalog } from "../tool-catalog";

export const controlCenterPrefix = "/api/control-center/v1";
export type { TaskConnectionState, TaskEvent, TaskPage, TaskSnapshot, ServiceDirectoryEntry, AttachmentRead, ContentRead, Coverage, CoverageState, Owner, RequestProjection, RequestQuery, RequestSummary, ProcessObservation, ProcessCheckpoint, PromptCaptureObservation, ActionConfirmRequest, ActionDescriptor, ActionPreview, ActionPreviewRequest, ActionReceipt, WorkQueueFilters, WorkQueueResponse, CreativeFlowProjection, CreativeCapabilityContract, CreativeInputSpec };

/** Attachment read result: text inline, or bytes behind a short-lived handle. */
export interface AttachmentReadResult extends AttachmentRead {
  url?: string;
  expires_at?: string;
}

export class ControlCenterApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly errorClass: ControlCenterErrorClass,
    public readonly details: { allowedMethods?: string[] } = {},
  ) {
    super(code);
    this.name = "ControlCenterApiError";
  }
}

export function classForStatus(status: number): ControlCenterErrorClass {
  if (status === 401) return "login_required";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 410) return "expired";
  if (status === 429) return "rate_limited";
  if ([400, 405, 413, 422].includes(status)) return "invalid";
  return "unavailable";
}

const errorClasses = new Set<ControlCenterErrorClass>(["login_required", "forbidden", "not_found", "conflict", "invalid", "rate_limited", "expired", "unavailable"]);

export function errorCode(error: unknown): string {
  return error instanceof ControlCenterApiError ? error.code : isAbort(error) ? "aborted" : "control_center_unavailable";
}

export function errorClassOf(error: unknown): ControlCenterErrorClass {
  return error instanceof ControlCenterApiError ? error.errorClass : "unavailable";
}

/** An older control-center server that predates a route answers 404 or a 405 with no allowed methods. */
export function isRouteUnavailable(error: unknown) {
  return error instanceof ControlCenterApiError && (error.status === 404 || (error.status === 405 && (error.details.allowedMethods?.length ?? 0) === 0));
}

export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ControlCenterApiError("invalid_control_center_response", response.status || 502, "unavailable");
  }
  if (!response.ok) {
    const envelope = body as { error?: unknown; class?: unknown };
    const code = typeof envelope?.error === "string" ? envelope.error : "control_center_unavailable";
    const declared = typeof envelope?.class === "string" && errorClasses.has(envelope.class as ControlCenterErrorClass) ? envelope.class as ControlCenterErrorClass : null;
    const allowedMethods = Array.isArray((envelope as { allowed_methods?: unknown })?.allowed_methods)
      ? (envelope as { allowed_methods: unknown[] }).allowed_methods.filter((method): method is string => typeof method === "string")
      : undefined;
    throw new ControlCenterApiError(code, response.status, declared ?? classForStatus(response.status), allowedMethods ? { allowedMethods } : {});
  }
  return body as T;
}

type Query = Record<string, string | number | undefined | null>;

function url(path: string, query: Query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  const search = params.toString();
  return controlCenterPrefix + path + (search ? "?" + search : "");
}

async function get<T>(path: string, query: Query, signal?: AbortSignal): Promise<T> {
  return readJson<T>(await fetch(url(path, query), { credentials: "same-origin", cache: "no-store", signal }));
}

async function post<T>(path: string, query: Query, body: unknown, csrf: string | null, signal?: AbortSignal): Promise<T> {
  return readJson<T>(await fetch(url(path, query), {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(body),
  }));
}

/** Server echo of the session epoch; absent on servers that predate the epoch contract. */
export type Epoch = { epoch?: number };

export interface AuthMethods {
  personal?: boolean;
  username_required?: boolean;
  key_required?: boolean;
  oidc?: boolean;
  mode?: string;
  owners?: { owner: string; configured: boolean }[];
}

export interface SessionScope {
  id: string;
  tenant?: string;
  team?: string;
  project?: string;
  label: string;
  connection_ids?: string[];
  owners?: string[];
}

export interface WorkspaceSession {
  name: string;
  username?: string;
  role: string;
  identity?: string;
  csrf: string;
  epoch?: number;
  scopes: SessionScope[];
  mode?: string;
  task_connections?: boolean;
}

export type ProviderReadiness = "configured" | "needs_configuration" | "needs_contract" | "forbidden" | "unavailable" | "stale" | "observed";
export interface ProviderBinding {
  binding_id: string;
  model_ref: string;
  enabled: boolean;
  default?: boolean;
  duration_seconds?: number;
  resolution?: string;
  ratio?: string;
  output_format?: string;
  requires_reference?: boolean;
  disabled_reason?: string | null;
}
export interface ProviderDiagnostic {
  status: ProviderReadiness;
  code: string | null;
  configured: boolean | null;
  blocker: string | null;
  observed_at: string;
}
export interface ProviderCapabilityProjection {
  id: string;
  owner: "eikona" | "scaena" | "sonora";
  modality: "image" | "video" | "audio";
  name: string;
  model_ref: string;
  state: "configured" | "needs_configuration" | "needs_contract";
  readiness: ProviderReadiness;
  transport: "mcp";
  supports_live_submit: boolean;
  submit_gate: "disabled_by_default" | "owner_authorized";
  provider_refs: string[];
  model_refs: string[];
  voice_refs: string[];
  bindings: ProviderBinding[];
  diagnostic: ProviderDiagnostic | null;
  blocker: string | null;
  observed_at: string;
  input_modes: CreativeCapabilityContract["input_modes"];
  reference_roles: CreativeCapabilityContract["reference_roles"];
  timeline_support: CreativeCapabilityContract["timeline_support"];
  output_constraints: CreativeCapabilityContract["output_constraints"];
  input_schema_ref: string | null;
  limits: CreativeCapabilityContract["limits"];
}

export interface UsageEvent {
  source_ref: string;
  trace_ref: string;
  owner: "eikona" | "scaena" | "sonora";
  model_ref: string;
  modality: "image" | "video" | "audio";
  quantity: number | null;
  unit: string;
  upstream_cost: number | null;
  currency: string;
  cost_state: "confirmed" | "estimated" | "unknown";
  status: string;
  project_ref: string;
  created_at: string;
}
export interface UsageBudget {
  total: number;
  reserved: number;
  remaining: number;
  per_owner: Record<string, number>;
}
export interface UsageProjection extends Epoch {
  scope?: string;
  rows: UsageEvent[];
  budget?: UsageBudget;
  coverage?: { state: CoverageState; observed_at?: string; reason?: string };
}

export interface TaskEventsPage extends Epoch {
  events: TaskEvent[];
  observation?: ProcessObservation;
  coverage?: CoverageState;
  reason?: string;
  next_cursor?: string;
  resume_cursor?: string;
  gap: boolean;
  freshness?: "fresh" | "stale" | "unknown";
  observed_at?: string;
}

export interface RequestObservationsPage extends Epoch {
  observation?: ProcessObservation;
  events: ProcessCheckpoint[];
  next_cursor?: string;
  resume_cursor?: string;
  gap: boolean;
  freshness?: "fresh" | "stale" | "unknown";
  observed_at?: string;
}

export interface ArtifactGrant {
  url: string;
  mime: string;
  expires_at: string;
  filename?: string;
}

export interface RequestPage extends Epoch {
  rows: RequestProjection[];
  coverage: Coverage[];
  page_scope: string;
  next_cursor?: string;
}

export type RequestSummarySource = { owner: Owner; summary: RequestSummary; coverage?: undefined } | { owner: Owner; coverage: Coverage; summary?: undefined };
export interface RequestSummaryResponse extends Epoch {
  sources: RequestSummarySource[];
  from: string;
  to: string;
  timezone: string;
  complete: boolean;
}

export interface OrganizationMember {
  id: string;
  name: string;
  type: "human" | "service" | "unknown";
  owner: Owner;
  role: string;
  team: string;
  binding: "verified" | "unlinked";
}
export interface OrganizationSource {
  owner: Owner;
  state: CoverageState;
  observed_at?: string;
  reason?: string;
  members: OrganizationMember[];
}
export interface OrganizationProjection extends Epoch {
  tenant: string;
  sources: OrganizationSource[];
}

export interface AuditRow {
  id: number;
  occurred_at: string;
  actor: string;
  session_id: string | null;
  scope_id: string | null;
  action: string;
  owner: string | null;
  target_ref: string | null;
  purpose: string | null;
  outcome: string;
  error_code: string | null;
  meta: Record<string, string | number | boolean | null> | null;
}
export interface AuditPage {
  rows: AuditRow[];
  next_before: number | null;
}

export interface PersonalUserView {
  username: string;
  name: string;
  role: "admin" | "viewer";
  scope_ids: string[];
  enabled: boolean;
  created_at?: string;
}

export type TaskNotificationState = "unread" | "acknowledged" | "muted" | "snoozed" | "archived";
export type TaskNotificationPriority = "normal" | "low" | "history";

export interface TaskNotification {
  id: string;
  scope_id: string;
  task_key: string;
  task_revision: string;
  failure_fingerprint: string;
  state: TaskNotificationState;
  priority: TaskNotificationPriority;
  presence: "live" | "stale";
  task_state: string;
  native_state: string;
  title: string;
  owner: string;
  project: string;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  muted_at: string | null;
  archived_at: string | null;
  snoozed_until: string | null;
  last_error_code: string;
  reopened: boolean;
}

export interface NotificationPage extends Epoch {
  rows: TaskNotification[];
  unread: number;
}

export interface ServicesResponse extends Epoch {
  schema_version?: string;
  services: ServiceDirectoryEntry[];
}

export type AuctraCollectionCoverage = "complete" | "partial" | "needs_contract" | "forbidden" | "unavailable" | "unknown" | "stale";
export interface AuctraCollectionRecord {
  record_ref: string;
  record_kind: string;
  project_ref: string;
  work_ref?: string;
  unit_ref?: string;
  candidate_ref?: string;
  review_ref?: string;
  version_ref?: string;
  run_ref?: string;
  kind?: string;
  title?: string;
  status?: string;
  source_revision?: string;
  source_digest?: string;
  created_at?: string;
  updated_at?: string;
  evidence_refs?: string[];
  collection_state: "active" | "confirmed" | "archived";
  source_state: "fresh" | "stale" | "unknown";
  metadata_revision: number;
  labels: string[];
  note: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
  first_seen_at: string;
  last_seen_at: string;
}
export interface AuctraCollectionPage extends Epoch {
  schema_version: "yeisme.auctra.collection.page.v1";
  owner: "auctra";
  scope: string;
  observed_at: string;
  coverage: AuctraCollectionCoverage;
  rows: AuctraCollectionRecord[];
  total: number;
  next_cursor?: string;
}
export interface AuctraCollectionSyncReceipt extends Epoch {
  schema_version: "yeisme.auctra.collection.sync.v1";
  sync_ref: string;
  scope: string;
  coverage: AuctraCollectionCoverage;
  freshness: "fresh" | "stale" | "unknown";
  observed_at: string;
  cursor: string | null;
  counts: { inserted: number; updated: number; returned: number; total: number };
  blocker: string | null;
}

export interface ProjectMetadata {
  owner: string;
  project_ref: string;
  display_name: string;
  display_label: string;
  hidden: boolean;
  revision: number;
  updated_at: string;
  updated_by: string;
}

export interface ProjectMetadataPage extends Epoch {
  schema_version: "yeisme.project_metadata.page.v1";
  scope: string;
  observed_at: string;
  rows: ProjectMetadata[];
}

export function requestParams(query: RequestQuery): Query {
  return {
    from: query.from,
    to: query.to,
    search: query.search || undefined,
    owner: query.owner,
    state: query.state,
    input_type: query.input_type,
    attachments: query.attachments,
    outputs: query.outputs,
    completeness: query.completeness,
    limit: query.limit,
    cursor: query.cursor,
  };
}

export const api = {
  authMethods: (signal?: AbortSignal) => get<AuthMethods>("/auth/methods", {}, signal),
  session: (signal?: AbortSignal) => get<WorkspaceSession>("/session", {}, signal),
  login: (input: { username?: string; secret: string; keyRequired: boolean }) =>
    post<{ ok: true }>("/auth/personal", {}, { ...(input.username ? { username: input.username } : {}), ...(input.keyRequired ? { key: input.secret } : { password: input.secret }) }, null),
  logout: (csrf: string) => post<{ ok: true }>("/auth/logout", {}, {}, csrf),

  services: (scope: string, signal?: AbortSignal) => get<ServicesResponse>("/services", { scope, observe: 1 }, signal),
  auctraCollection: (scope: string, query: { record_kind?: string; collection_state?: string; source_state?: string; label?: string; project_ref?: string; from?: string; to?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal) => get<AuctraCollectionPage>("/auctra/collection", { scope, ...query }, signal),
  projectMetadata: (scope: string, signal?: AbortSignal) => get<ProjectMetadataPage>("/project-metadata", { scope }, signal),
  auctraCollectionRecord: (scope: string, recordRef: string, signal?: AbortSignal) => get<{ record: AuctraCollectionRecord } & Epoch>("/auctra/collection/records/" + encodeURIComponent(recordRef), { scope }, signal),
  syncAuctraCollection: (scope: string, body: { cursor?: string; updated_after?: string; limit?: number }, csrf: string, signal?: AbortSignal) => post<AuctraCollectionSyncReceipt>("/auctra/collection/sync", { scope }, body, csrf, signal),
  connections: (scope: string, signal?: AbortSignal) => get<{ connections: TaskConnectionState[] } & Epoch>("/connections", { scope }, signal),
  capabilities: (scope: string, signal?: AbortSignal) => get<{ scope?: string; capabilities: ProviderCapabilityProjection[] } & Epoch>("/capabilities", { scope }, signal),
  toolCatalog: (scope: string, options: { refresh?: boolean } = {}, signal?: AbortSignal) => get<ToolCatalog & Epoch>("/tool-catalog", { scope, refresh: options.refresh ? 1 : undefined }, signal),
  usage: (scope: string, signal?: AbortSignal) => get<UsageProjection>("/usage", { scope }, signal),
  actions: (scope: string, owner?: string, signal?: AbortSignal) => get<{ scope: string; actions: ActionDescriptor[] } & Epoch>("/actions", { scope, owner }, signal),
  workQueue: (scope: string, filters: WorkQueueFilters = {}, cursor?: string, limit = 50, signal?: AbortSignal) => get<WorkQueueResponse>("/work-queue", { scope, ...filters, cursor, limit }, signal),
  creativeFlow: (scope: string, query: { episode_ref?: string; breakdown_ref?: string } = {}, signal?: AbortSignal) => get<CreativeFlowProjection & Epoch>("/creative-flow", { scope, ...query }, signal),
  previewAction: (input: ActionPreviewRequest, csrf: string, signal?: AbortSignal) => post<ActionPreview>("/actions/preview", { scope: input.scope_id }, input, csrf, signal),
  confirmAction: (input: ActionConfirmRequest, csrf: string, signal?: AbortSignal) => post<ActionReceipt>("/actions/confirm", { scope: input.scope_id }, input, csrf, signal),
  actionReceipt: (scope: string, receiptRef: string, signal?: AbortSignal) => get<ActionReceipt & Epoch>("/actions/receipts/" + encodeURIComponent(receiptRef), { scope }, signal),

  notifications: (scope: string, signal?: AbortSignal) => get<NotificationPage>("/notifications", { scope }, signal),
  syncNotifications: (scope: string, body: { tasks: Pick<TaskSnapshot, "task_key" | "state" | "revision" | "native_state" | "title" | "locator" | "provider_recovery">[]; present_task_keys: string[]; complete: boolean }, csrf: string, signal?: AbortSignal) =>
    post<NotificationPage & { inserted: string[]; touched: string[]; staled: string[]; owner_writes: number }>("/notifications/sync", { scope }, body, csrf, signal),
  acknowledgeNotification: (scope: string, id: string, csrf: string) =>
    post<{ notification: TaskNotification; task_states_changed: number; owner_writes: number }>("/notifications/" + encodeURIComponent(id) + "/acknowledge", { scope }, {}, csrf),
  muteNotification: (scope: string, id: string, csrf: string, muteScope: "fingerprint" | "error_code" = "fingerprint") =>
    post<{ updated: string[]; owner_writes: number; task_states_changed: number }>("/notifications/" + encodeURIComponent(id) + "/mute", { scope }, { scope: muteScope }, csrf),
  archiveNotification: (scope: string, id: string, csrf: string) =>
    post<{ notification: TaskNotification; task_states_changed: number }>("/notifications/" + encodeURIComponent(id) + "/archive", { scope }, {}, csrf),
  reopenNotification: (scope: string, id: string, csrf: string) =>
    post<{ notification: TaskNotification; task_states_changed: number }>("/notifications/" + encodeURIComponent(id) + "/reopen", { scope }, {}, csrf),
  bulkNotifications: (scope: string, body: { action: "acknowledge" | "archive" | "mute"; ids?: string[]; all?: boolean }, csrf: string) =>
    post<{ updated: string[]; owner_writes: number; task_states_changed: number }>("/notifications/bulk", { scope }, body, csrf),
  cleanupNotifications: (scope: string, csrf: string) =>
    post<{ demoted: number; deleted_tasks: number; owner_writes: number; task_states_changed: number }>("/notifications/cleanup", { scope }, {}, csrf),

  tasks: (scope: string, mode: "active" | "history", cursors?: Record<string, string>, signal?: AbortSignal) =>
    get<TaskPage & Epoch>("/tasks", { scope, mode, cursors: cursors && Object.keys(cursors).length ? JSON.stringify(cursors) : undefined }, signal),
  task: (scope: string, taskKey: string, signal?: AbortSignal) => get<TaskSnapshot & Epoch>("/tasks/" + encodeURIComponent(taskKey), { scope }, signal),
  resolveTask: (scope: string, target: { connection: string; project: string; family: string; ref: string }, signal?: AbortSignal) =>
    get<TaskSnapshot & Epoch>("/tasks/resolve", { scope, ...target }, signal),
  taskEvents: (scope: string, taskKey: string, cursor?: string, signal?: AbortSignal, after?: string) =>
    get<TaskEventsPage>("/tasks/" + encodeURIComponent(taskKey) + "/events", { scope, cursor, after }, signal),
  artifactAccess: (scope: string, taskKey: string, artifactRef: string, purpose: "preview" | "download", csrf: string) =>
    post<ArtifactGrant>("/tasks/" + encodeURIComponent(taskKey) + "/artifacts/" + encodeURIComponent(artifactRef) + "/access", { scope }, { purpose }, csrf),

  requests: (scope: string, query: RequestQuery, signal?: AbortSignal) => get<RequestPage>("/requests", { scope, ...requestParams(query) }, signal),
  requestSummary: (scope: string, query: RequestQuery, signal?: AbortSignal) => get<RequestSummaryResponse>("/requests/summary", { scope, ...requestParams({ ...query, cursor: undefined }) }, signal),
  request: (scope: string, owner: Owner, id: string, signal?: AbortSignal) => get<RequestProjection & Epoch>("/requests/" + owner + "/" + encodeURIComponent(id), { scope }, signal),
  requestObservations: (scope: string, owner: Owner, id: string, after?: string, signal?: AbortSignal) =>
    get<RequestObservationsPage>("/requests/" + owner + "/" + encodeURIComponent(id) + "/observations", { scope, after }, signal),
  requestContent: (scope: string, owner: Owner, id: string, direction: "input" | "output", purpose: string, csrf: string, signal?: AbortSignal) =>
    post<ContentRead>("/requests/" + owner + "/" + encodeURIComponent(id) + "/content:read", { scope }, { direction, purpose }, csrf, signal),
  requestAttachment: (scope: string, owner: Owner, id: string, attachmentRef: string, direction: "input" | "output", purpose: string, csrf: string, signal?: AbortSignal) =>
    post<AttachmentReadResult>("/requests/" + owner + "/" + encodeURIComponent(id) + "/attachments/" + encodeURIComponent(attachmentRef) + "/content:read", { scope }, { direction, purpose }, csrf, signal),

  organization: (scope: string, signal?: AbortSignal) => get<OrganizationProjection>("/organization", { scope }, signal),
  audit: (before?: number, signal?: AbortSignal) => get<AuditPage>("/audit", { before, limit: 50 }, signal),
  personalUsers: (signal?: AbortSignal) => get<{ users: PersonalUserView[] }>("/admin/personal-users", {}, signal),
};
