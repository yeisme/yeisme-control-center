import type { PromptPage, PromptQuery, PromptContent, PromptOwner } from "../prompt-library";
import type { TaskConnectionState, TaskEvent, TaskPage, TaskPromptContent, TaskSnapshot } from "../../task-observation";
import type { ProcessObservation, ProcessCheckpoint, PromptCaptureObservation } from "../../observation-contract";
import type { ServiceDirectoryEntry } from "../../service-directory";
import type { CredentialStatus } from "../credentials";
import type { AttachmentRead, ContentRead, Coverage, CoverageState, Owner, RequestProjection, RequestQuery, RequestSummary } from "../../request-visibility";
import type { ControlCenterErrorClass } from "../types";
import { signalStaleSession, staleSessionCode } from "./session-signals";
import type { ActionConfirmRequest, ActionDescriptor, ActionPreview, ActionPreviewRequest, ActionReceipt } from "../action-contract";
import type { WorkQueueFilters, WorkQueueResponse } from "../work-queue";
import type { CreativeFlowProjection } from "../creative-flow";
import type { DramaEpisodeDetail, DramaEpisodesResponse, DramaSourceState } from "../drama";
import type { ProductionLine } from "../production-line";
import type { EpisodeProductionRead } from "../episode-production";
import type { TaskReviewRead } from "../task-review";
import type { CreativeCapabilityContract, CreativeInputSpec } from "../creative-input";
import type { ToolCatalog } from "../tool-catalog";
import type { BindingOption, CollaborationMember, CollaborationOrganization, CollaborationTeam, DirectoryPage, DirectoryQuery, GenerationBatch, GenerationBatchDetail, GenerationBatchPage, GenerationBatchQuery, ProjectFolder, ProjectItem, ProjectItemPage, SharedProject } from "../collaboration";
import type { ReferenceBindingAccessRequest, ReferenceBindingGrant, ReferenceBindingPage } from "../reference-bindings";
import type { PromptRecipePage, PromptRecipeQuery, PromptRecipeSummary, PromptRecipeUsePreview, PromptRecipeVersion } from "../prompt-recipes";
import type { GatewayCallDetail, GatewayClientPreset, GatewayMonitorSnapshot, GatewayAgentSession, GatewayCall, GatewayTelemetry, GatewayPlan } from "../gateway-monitor";

export const controlCenterPrefix = "/api/control-center/v1";
export type { TaskConnectionState, TaskEvent, TaskPage, TaskPromptContent, TaskSnapshot, ServiceDirectoryEntry, AttachmentRead, ContentRead, Coverage, CoverageState, Owner, RequestProjection, RequestQuery, RequestSummary, ProcessObservation, ProcessCheckpoint, PromptCaptureObservation, ActionConfirmRequest, ActionDescriptor, ActionPreview, ActionPreviewRequest, ActionReceipt, WorkQueueFilters, WorkQueueResponse, CreativeFlowProjection, CreativeCapabilityContract, CreativeInputSpec };
export type { ReferenceBindingAccessRequest, ReferenceBindingGrant, ReferenceBindingPage } from "../reference-bindings";
export type { PromptRecipePage, PromptRecipeQuery, PromptRecipeSummary, PromptRecipeUsePreview, PromptRecipeVersion } from "../prompt-recipes";
export type { GatewayCallDetail, GatewayClientPreset, GatewayMonitorSnapshot, GatewayAgentSession, GatewayCall, GatewayTelemetry, GatewayPlan } from "../gateway-monitor";

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

async function readJson<T>(response: Response, sentCsrf: string | null = null): Promise<T> {
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
    // The page's token is not the cookie's session's any more (another tab signed in as someone else): the workspace reads the session again.
    if (code === staleSessionCode) signalStaleSession(sentCsrf);
    const allowedMethods = Array.isArray((envelope as { allowed_methods?: unknown })?.allowed_methods)
      ? (envelope as { allowed_methods: unknown[] }).allowed_methods.filter((method): method is string => typeof method === "string")
      : undefined;
    throw new ControlCenterApiError(code, response.status, declared ?? classForStatus(response.status), allowedMethods ? { allowedMethods } : {});
  }
  return body as T;
}

type Query = Record<string, string | number | string[] | undefined | null>;

function url(path: string, query: Query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) for (const item of value) { if (item !== "") params.append(key, item); }
    else if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return controlCenterPrefix + path + (search ? "?" + search : "");
}

async function get<T>(path: string, query: Query, signal?: AbortSignal): Promise<T> {
  return readJson<T>(await fetch(url(path, query), { credentials: "same-origin", cache: "no-store", signal }));
}

async function patch<T>(path: string, query: Query, body: unknown, csrf: string | null, signal?: AbortSignal): Promise<T> {
  return readJson<T>(await fetch(url(path, query), {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(body),
  }), csrf);
}

async function post<T>(path: string, query: Query, body: unknown, csrf: string | null, signal?: AbortSignal): Promise<T> {
  return readJson<T>(await fetch(url(path, query), {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(body),
  }), csrf);
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
  /** `available` when the person can reset their own key here; otherwise why not (`legacy_owner_managed_by_cli`, ...). */
  own_key?: string;
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
  /** The owner project this scope binds; a live run must name it. */
  project_ref?: string | null;
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
  /** The currency owners cap a live run in; amounts here are never converted. */
  currency: string;
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
  key_rotated_at?: string;
  /** The name is listed more than once in the configuration, so every entry of it is off until the file is corrected. */
  duplicate?: boolean;
  /** What an edit sends back as `if_match`; a change made meanwhile is refused instead of overwritten. */
  version?: string;
}

/** Whether the web may manage accounts, why not, and the configuration's own owner account (command line only). */
export interface AccountManagement {
  enabled: boolean;
  reason: string | null;
  legacy_owner: { username: string; name: string; role: "admin" | "viewer" } | null;
  /** The owner has no username yet, so a first account would lock it out: the web refuses to create one until it has. */
  needs_owner_username?: boolean;
}

/** A scope an account can be given (the configuration's, not a shared project's). */
export interface AssignableScope { id: string; label: string; tenant?: string; project?: string }

export interface PersonalInviteView {
  id: string;
  username: string;
  label: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  state: "pending" | "consumed" | "expired" | "revoked";
}

export interface AuditQuery { before?: number; action?: string; outcome?: string; actor?: string; from?: string; to?: string }

export type TaskNotificationState = "unread" | "acknowledged" | "muted" | "snoozed" | "archived";
export type TaskNotificationPriority = "normal" | "low" | "history";

export interface TaskNotification {
  category?: string;
  read_at?: string | null;
  target_path?: string | null;
  /** Unsigned half of the task key; stays the same across server restarts. */
  task_identity?: string;
  /** Set when a fresh owner read showed the task is no longer failing. */
  recovered_at?: string | null;
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
  next_cursor?: string | null;
  total?: number;
  rows: TaskNotification[];
  /** Unread reminders over every row, not just this page (see `countsAsUnread`). */
  unread: number;
  /** Fresh unread failures shown on Home, over every row. */
  attention?: number;
}

/** `GET /observation/status`: counts and times only, never an address, a path, a key or a reminder's text. */
export interface ObservationStatus extends Epoch {
  schema_version: "yeisme.observation_status.v1";
  enabled: boolean;
  config_valid: boolean;
  running: boolean;
  interval_minutes: number;
  open_tools_every: number;
  scope: string | null;
  /** Someone receives background reminders for the scope asked about. */
  observed: boolean;
  /** The signed-in account is one of them. */
  recipient: boolean;
  next_run_at: string | null;
  last_cycle: null | {
    started_at: string;
    finished_at: string;
    calls: number;
    pages_read: number;
    pages_skipped: number;
    reminders_opened: number;
    reminders_recovered: number;
    connections_read: number;
    connections_skipped: number;
    scan_incomplete: number;
    open_tools_read: boolean;
    errors: Record<string, number>;
  };
}

export interface NotificationMuteRule {
  id: string;
  scope_id: string;
  kind: "task" | "error_code";
  owner: string;
  key: string;
  label: string;
  created_at: string;
}

export interface ServicesResponse extends Epoch {
  schema_version?: string;
  services: ServiceDirectoryEntry[];
  /** Personal administrators only; absent for other sessions and from servers that predate it. */
  credentials?: CredentialStatus[];
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
  /** Configuration-only connection state; absent from servers that predate it. */
  connection?: { state: DramaSourceState; reason?: string; project_ref?: string };
  /** The last sync that stored anything; `complete` is false when it stopped before Auctra's last page. */
  last_sync?: { at: string; complete: boolean; reason?: string };
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
  /** Absent from servers that predate paging; such a server read one page only. */
  pages?: number;
  complete?: boolean;
}
export interface AuctraAuthoringResponse extends Epoch {
  schema_version: "yeisme.auctra.authoring.v1";
  operation_id: string;
  status: "success" | "failed";
  data?: Record<string, unknown>;
  error?: { code: string; retryable?: boolean; blocker?: string; next_action?: string };
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

/** A tool project one scope reads: pinned in the scope, or the project of one of its connections. */
export interface OwnerProjectRow {
  owner: string;
  project_ref: string;
  connection_ids: string[];
  pinned: boolean;
  registered: boolean;
  scope_id: string;
  scope_label: string;
  tenant: string;
  display_name: string;
  hidden: boolean;
  revision: number;
  /** Connections an administrator added from the control center; only these can be disconnected. */
  registrations: { id: string; template_id: string; label: string }[];
}

export interface OwnerProjectTemplate {
  id: string;
  owner: string;
  label: string;
  project: string;
}

export interface OwnerProjectsPage extends Epoch {
  schema_version: "yeisme.owner_projects.v1";
  scope: string;
  rows: OwnerProjectRow[];
  can_register: boolean;
  templates: OwnerProjectTemplate[];
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
  reconcilePrompt: (scope: string, preview: string, csrf: string) => post<{state: string}>(`/prompts/operations/${encodeURIComponent(preview)}/reconcile`, {scope}, {}, csrf),
  promptCollections: (scope: string, signal?: AbortSignal) => get<{ collections: {id: string; name: string}[]; links: {collection_id: string; owner: string; project: string; id: string}[] }>("/prompt-collections", {scope}, signal),
  prompts: (scope: string, query: PromptQuery = {}, signal?: AbortSignal) => get<PromptPage>("/prompts", { scope, ...query }, signal),
  promptContent: (scope: string, owner: PromptOwner, id: string, version: number, csrf: string, signal?: AbortSignal) => post<PromptContent>(`/prompts/${owner}/${encodeURIComponent(id)}/content:read`, { scope }, { version }, csrf, signal),
  indexPrompts: (scope: string, owner: PromptOwner, csrf: string, signal?: AbortSignal) => post<{ index_more?: boolean; history_state?: "complete" | "incomplete" | "unknown" | "needs_contract" }>(`/prompts/${owner}/history/index`, { scope }, {}, csrf, signal),
  promptRecipes: (scope: string, query: PromptRecipeQuery = {}, signal?: AbortSignal) => get<PromptRecipePage>("/prompt-recipes", { scope, ...query }, signal),
  promptRecipe: (scope: string, recipe: string, signal?: AbortSignal) => get<{ recipe: PromptRecipeSummary } & Epoch>(`/prompt-recipes/${encodeURIComponent(recipe)}`, { scope }, signal),
  promptRecipeVersions: (scope: string, recipe: string, signal?: AbortSignal) => get<{ rows: PromptRecipeVersion[] } & Epoch>(`/prompt-recipes/${encodeURIComponent(recipe)}/versions`, { scope }, signal),
  promptRecipeUsePreview: (scope: string, recipe: string, body: { target_owner: PromptOwner; target_project_ref: string; expected_revision: number }, csrf: string, signal?: AbortSignal) => post<PromptRecipeUsePreview>(`/prompt-recipes/${encodeURIComponent(recipe)}/use-preview`, { scope }, body, csrf, signal),

  organizations: (signal?: AbortSignal) => get<{ rows: CollaborationOrganization[]; can_create: boolean }>("/organizations", {}, signal),
  collaborationMembers: (organization: string, signal?: AbortSignal) => get<{ rows: CollaborationMember[] }>(`/organizations/${encodeURIComponent(organization)}/members`, {}, signal),
  collaborationTeams: (organization: string, signal?: AbortSignal) => get<{ rows: CollaborationTeam[] }>(`/organizations/${encodeURIComponent(organization)}/teams`, {}, signal),
  collaborationCandidates: (organization: string, signal?: AbortSignal) => get<{ rows: { identity: string; name: string }[] }>(`/organizations/${encodeURIComponent(organization)}/candidates`, {}, signal),
  bindingOptions: (organization: string, signal?: AbortSignal) => get<{ rows: BindingOption[] }>(`/organizations/${encodeURIComponent(organization)}/binding-options`, {}, signal),
  sharedProjects: (query: { organization?: string; q?: string; hidden?: string } = {}, signal?: AbortSignal) => get<DirectoryPage<SharedProject>>("/projects", query, signal),
  sharedProject: (id: string, signal?: AbortSignal) => get<SharedProject>(`/projects/${encodeURIComponent(id)}`, {}, signal),
  projectCollectionBinding: (project: string, signal?: AbortSignal) => get<import("../collaboration").ProjectCollectionBindingView>(`/projects/${encodeURIComponent(project)}/collection-binding`, {}, signal),
  projectCollectionBindingOptions: (project: string, signal?: AbortSignal) => get<import("../collaboration").ProjectCollectionBindingOptions>(`/projects/${encodeURIComponent(project)}/collection-binding-options`, {}, signal),
  projectFolders: (project: string, signal?: AbortSignal) => get<{ rows: ProjectFolder[] }>(`/projects/${encodeURIComponent(project)}/folders`, {}, signal),
  projectItemTask: (project: string, item: string, signal?: AbortSignal) => get<TaskSnapshot & Epoch>(`/projects/${encodeURIComponent(project)}/items/${encodeURIComponent(item)}/task`, {}, signal),
  projectItems: (project: string, query: DirectoryQuery = {}, signal?: AbortSignal) => get<ProjectItemPage>(`/projects/${encodeURIComponent(project)}/items`, { ...query }, signal),
  generationBatches: (project: string, query: GenerationBatchQuery = {}, signal?: AbortSignal) => get<GenerationBatchPage>(`/projects/${encodeURIComponent(project)}/generation-batches`, query, signal),
  generationBatch: (project: string, batch: string, signal?: AbortSignal) => get<GenerationBatchDetail>(`/projects/${encodeURIComponent(project)}/generation-batches/${encodeURIComponent(batch)}`, {}, signal),
  referenceBindings: (project: string, query: { owner?: "eikona" | "scaena"; kind?: "image" | "video"; q?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal) => get<ReferenceBindingPage>(`/projects/${encodeURIComponent(project)}/reference-bindings`, query, signal),
  referenceBindingAccess: (project: string, binding: string, body: ReferenceBindingAccessRequest, csrf: string, signal?: AbortSignal) => post<ReferenceBindingGrant>(`/projects/${encodeURIComponent(project)}/reference-bindings/${encodeURIComponent(binding)}/access`, {}, body, csrf, signal),
  readNotification: (scope: string, id: string, csrf: string) => post<{ notification: TaskNotification }>(`/notifications/${encodeURIComponent(id)}/read`, { scope }, {}, csrf),
  authMethods: (signal?: AbortSignal) => get<AuthMethods>("/auth/methods", {}, signal),
  session: (signal?: AbortSignal) => get<WorkspaceSession>("/session", {}, signal),
  login: (input: { username?: string; secret: string; keyRequired: boolean; remember?: boolean }) =>
    post<{ ok: true }>("/auth/personal", {}, { ...(input.username ? { username: input.username } : {}), ...(input.keyRequired ? { key: input.secret } : { password: input.secret }), ...(input.remember ? { remember: true } : {}) }, null),
  redeemInvite: (token: string) =>
    post<{ ok: true; username: string }>("/auth/invite", {}, { token }, null),
  logout: (csrf: string) => post<{ ok: true }>("/auth/logout", {}, {}, csrf),

  services: (scope: string, signal?: AbortSignal) => get<ServicesResponse>("/services", { scope, observe: 1 }, signal),
  auctraCollection: (scope: string, query: { record_kind?: string; collection_state?: string; source_state?: string; label?: string; project_ref?: string; from?: string; to?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal) => get<AuctraCollectionPage>("/auctra/collection", { scope, ...query }, signal),
  projectMetadata: (scope: string, signal?: AbortSignal) => get<ProjectMetadataPage>("/project-metadata", { scope }, signal),
  ownerProjects: (scope: string, signal?: AbortSignal) => get<OwnerProjectsPage>("/owner-projects", { scope }, signal),
  auctraCollectionRecord: (scope: string, recordRef: string, signal?: AbortSignal) => get<{ record: AuctraCollectionRecord } & Epoch>("/auctra/collection/records/" + encodeURIComponent(recordRef), { scope }, signal),
  syncAuctraCollection: (scope: string, body: { cursor?: string; updated_after?: string; limit?: number }, csrf: string, signal?: AbortSignal) => post<AuctraCollectionSyncReceipt>("/auctra/collection/sync", { scope }, body, csrf, signal),
  auctraAuthoring: (scope: string, body: { operation_id: string; args: Record<string, unknown> }, csrf: string, signal?: AbortSignal) => post<AuctraAuthoringResponse>("/auctra/authoring", { scope }, body, csrf, signal),
  connections: (scope: string, signal?: AbortSignal) => get<{ connections: TaskConnectionState[] } & Epoch>("/connections", { scope }, signal),
  capabilities: (scope: string, signal?: AbortSignal) => get<{ scope?: string; capabilities: ProviderCapabilityProjection[] } & Epoch>("/capabilities", { scope }, signal),
  gatewayMonitor: (scope: string, signal?: AbortSignal) => get<GatewayMonitorSnapshot & Epoch>("/gateway/monitor", { scope }, signal),
  gatewaySessions: (scope: string, signal?: AbortSignal) => get<{ sessions: GatewayAgentSession[]; epoch?: number }>("/gateway/sessions", { scope }, signal),
  gatewayCalls: (scope: string, query: { before?: string; limit?: number; state?: string; backend?: string; tool?: string; session_ref?: string } = {}, signal?: AbortSignal) => get<{ calls: GatewayCall[]; epoch?: number }>("/gateway/calls", { scope, ...query }, signal),
  gatewayCall: (scope: string, callRef: string, signal?: AbortSignal) => get<GatewayCallDetail & Epoch>(`/gateway/calls/${encodeURIComponent(callRef)}`, { scope }, signal),
  gatewayPresets: (scope: string, signal?: AbortSignal) => get<{ presets: GatewayClientPreset[]; epoch?: number }>("/gateway/client-presets", { scope }, signal),
  gatewayEventsUrl: (scope: string, afterSeq?: string) => url("/gateway/events", { scope, after_seq: afterSeq }),
  gatewayPlan: (scope: string, body: { action: string; target_ref: string; expected_revision: string; idempotency_key: string; input: Record<string, unknown> }, csrf: string) => post<GatewayPlan>("/gateway/plans", { scope }, body, csrf),
  gatewayApply: (scope: string, planRef: string, body: { plan_digest: string; idempotency_key: string; approval_id?: string }, csrf: string) => post<GatewayPlan>(`/gateway/plans/${encodeURIComponent(planRef)}/apply`, { scope }, body, csrf),
  toolCatalog: (scope: string, options: { refresh?: boolean } = {}, signal?: AbortSignal) => get<ToolCatalog & Epoch>("/tool-catalog", { scope, refresh: options.refresh ? 1 : undefined }, signal),
  usage: (scope: string, signal?: AbortSignal) => get<UsageProjection>("/usage", { scope }, signal),
  actions: (scope: string, owner?: string, signal?: AbortSignal) => get<{ scope: string; actions: ActionDescriptor[] } & Epoch>("/actions", { scope, owner }, signal),
  workQueue: (scope: string, filters: WorkQueueFilters = {}, cursor?: string, limit = 50, signal?: AbortSignal) => get<WorkQueueResponse>("/work-queue", { scope, ...filters, cursor, limit }, signal),
  creativeFlow: (scope: string, query: { episode_ref?: string; breakdown_ref?: string } = {}, signal?: AbortSignal) => get<CreativeFlowProjection & Epoch>("/creative-flow", { scope, ...query }, signal),
  dramaEpisodes: (scope: string, query: { q?: string; limit?: number; cursor?: string; read?: "all"; order?: "recent"; episode_ref?: string[] } = {}, signal?: AbortSignal) => get<DramaEpisodesResponse>("/drama/episodes", { scope, ...query }, signal),
  dramaEpisode: (scope: string, episodeRef: string, options: { scaena_episode_ref?: string; refresh?: boolean } = {}, signal?: AbortSignal) => get<DramaEpisodeDetail>("/drama/episode", { scope, episode_ref: episodeRef, scaena_episode_ref: options.scaena_episode_ref, refresh: options.refresh ? 1 : undefined }, signal),
  /** The seven-station line: one episode with `episode_ref`, the whole scope without. The same structure the studio draws. */
  production: (scope: string, options: { episode_ref?: string; scaena_episode_ref?: string } = {}, signal?: AbortSignal) => get<ProductionLine & Epoch>("/production", { scope, episode_ref: options.episode_ref, scaena_episode_ref: options.scaena_episode_ref }, signal),
  taskReviews: (scope: string, taskKeys: string[], signal?: AbortSignal) => get<{ reviews: Record<string, TaskReviewRead>; reason?: string } & Epoch>("/task-reviews", { scope, task_key: taskKeys }, signal),
  episodeProduction: (scope: string, episodeRef: string, options: { scaena_episode_ref?: string } = {}, signal?: AbortSignal) => get<EpisodeProductionRead & Epoch>("/episode-production", { scope, episode_ref: episodeRef, scaena_episode_ref: options.scaena_episode_ref }, signal),
  previewAction: (input: ActionPreviewRequest, csrf: string, signal?: AbortSignal) => post<ActionPreview>("/actions/preview", { scope: input.scope_id }, input, csrf, signal),
  confirmAction: (input: ActionConfirmRequest, csrf: string, signal?: AbortSignal) => post<ActionReceipt>("/actions/confirm", { scope: input.scope_id }, input, csrf, signal),
  actionReceipt: (scope: string, receiptRef: string, signal?: AbortSignal) => get<ActionReceipt & Epoch>("/actions/receipts/" + encodeURIComponent(receiptRef), { scope }, signal),

  notifications: (scope: string, signal?: AbortSignal, cursor?: string, q?: string) => get<NotificationPage>("/notifications", { scope, cursor, ...(q ? { q } : {}) }, signal),
  syncNotifications: (scope: string, body: { tasks: Pick<TaskSnapshot, "task_key" | "state" | "revision" | "native_state" | "title" | "locator" | "provider_recovery">[]; present_task_keys: string[]; complete: boolean }, csrf: string, signal?: AbortSignal) =>
    post<NotificationPage & { inserted: string[]; touched: string[]; staled: string[]; owner_writes: number; verification_complete: boolean }>("/notifications/sync", { scope }, body, csrf, signal),
  acknowledgeNotification: (scope: string, id: string, csrf: string) =>
    post<{ notification: TaskNotification; task_states_changed: number; owner_writes: number }>("/notifications/" + encodeURIComponent(id) + "/acknowledge", { scope }, {}, csrf),
  muteNotification: (scope: string, id: string, csrf: string, muteScope: "fingerprint" | "task" | "error_code" = "fingerprint") =>
    post<{ updated: string[]; rule: NotificationMuteRule | null; owner_writes: number; task_states_changed: number }>("/notifications/" + encodeURIComponent(id) + "/mute", { scope }, { scope: muteScope }, csrf),
  archiveNotification: (scope: string, id: string, csrf: string) =>
    post<{ notification: TaskNotification; task_states_changed: number }>("/notifications/" + encodeURIComponent(id) + "/archive", { scope }, {}, csrf),
  reopenNotification: (scope: string, id: string, csrf: string) =>
    post<{ notification: TaskNotification; task_states_changed: number }>("/notifications/" + encodeURIComponent(id) + "/reopen", { scope }, {}, csrf),
  /** Quiet until `until` (RFC 3339, in the future, within 30 days); the reminder stays unread and counts again after it. */
  snoozeNotification: (scope: string, id: string, until: string, csrf: string) =>
    post<{ notification: TaskNotification; task_states_changed: number; owner_writes: number }>("/notifications/" + encodeURIComponent(id) + "/snooze", { scope }, { until }, csrf),
  observationStatus: (scope: string, signal?: AbortSignal) => get<ObservationStatus>("/observation/status", { scope }, signal),
  bulkNotifications: (scope: string, body: { action: "acknowledge" | "archive" | "mute"; ids?: string[]; all?: boolean }, csrf: string) =>
    post<{ updated: string[]; owner_writes: number; task_states_changed: number }>("/notifications/bulk", { scope }, body, csrf),
  muteRules: (scope: string, signal?: AbortSignal) => get<{ rows: NotificationMuteRule[] } & Epoch>("/notifications/mute-rules", { scope }, signal),
  removeMuteRule: (scope: string, id: string, csrf: string) =>
    post<{ removed: string; task_states_changed: number }>("/notifications/mute-rules/" + encodeURIComponent(id) + "/remove", { scope }, {}, csrf),
  cleanupNotifications: (scope: string, csrf: string) =>
    post<{ demoted: number; deleted_tasks: number; owner_writes: number; task_states_changed: number }>("/notifications/cleanup", { scope }, {}, csrf),

  tasks: (scope: string, mode: "active" | "history", cursors?: Record<string, string>, signal?: AbortSignal) =>
    get<TaskPage & Epoch>("/tasks", { scope, mode, cursors: cursors && Object.keys(cursors).length ? JSON.stringify(cursors) : undefined }, signal),
  task: (scope: string, taskKey: string, signal?: AbortSignal) => get<TaskSnapshot & Epoch>("/tasks/" + encodeURIComponent(taskKey), { scope }, signal),
  resolveTask: (scope: string, target: { connection: string; project: string; family: string; ref: string }, signal?: AbortSignal) =>
    get<TaskSnapshot & Epoch>("/tasks/resolve", { scope, ...target }, signal),
  taskEvents: (scope: string, taskKey: string, cursor?: string, signal?: AbortSignal, after?: string) =>
    get<TaskEventsPage>("/tasks/" + encodeURIComponent(taskKey) + "/events", { scope, cursor, after }, signal),
  taskPromptContent: (scope: string, taskKey: string, captureRef: string, purpose: string, csrf: string, signal?: AbortSignal) =>
    post<TaskPromptContent>("/tasks/" + encodeURIComponent(taskKey) + "/prompt:read", { scope }, { capture_ref: captureRef, purpose }, csrf, signal),
  artifactAccess: (scope: string, taskKey: string, artifactRef: string, purpose: "preview" | "download" | "thumbnail", csrf: string, signal?: AbortSignal) =>
    post<ArtifactGrant>(`/tasks/${encodeURIComponent(taskKey)}/artifacts/${encodeURIComponent(artifactRef)}/access`, { scope }, { purpose }, csrf, signal),

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
  personalUsers: (signal?: AbortSignal) => get<{ users: PersonalUserView[]; management?: AccountManagement; scopes?: AssignableScope[] }>("/admin/personal-users", {}, signal),
  createPersonalUser: (body: { username: string; name: string; role: "admin" | "viewer"; scope_ids: string[]; issue_invite_ttl_hours?: number }, csrf: string) => post<{ user: PersonalUserView; access_key: string; invite?: PersonalInviteView; invite_token?: string }>("/admin/personal-users", {}, body, csrf),
  personalInvites: (username?: string, signal?: AbortSignal) => get<{ invites: PersonalInviteView[] }>("/admin/personal-invites", { username }, signal),
  createPersonalInvite: (body: { username: string; label?: string; ttl_hours?: number }, csrf: string) => post<{ invite: PersonalInviteView; invite_token: string }>("/admin/personal-invites", {}, body, csrf),
  revokePersonalInvite: (id: string, csrf: string) => post<{ invite: PersonalInviteView }>(`/admin/personal-invites/${encodeURIComponent(id)}/revoke`, {}, {}, csrf),
  rotatePersonalUser: (username: string, csrf: string) => post<{ access_key: string }>(`/admin/personal-users/${encodeURIComponent(username)}/rotate`, {}, {}, csrf),
  enablePersonalUser: (username: string, csrf: string) => post<{ ok: true }>(`/admin/personal-users/${encodeURIComponent(username)}/enable`, {}, {}, csrf),
  revokePersonalUser: (username: string, csrf: string) => post<{ ok: true }>(`/admin/personal-users/${encodeURIComponent(username)}/revoke`, {}, {}, csrf),
  updatePersonalUser: (username: string, body: { name?: string; role?: "admin" | "viewer"; scope_ids?: string[]; if_match: string }, csrf: string) => patch<{ user: PersonalUserView }>(`/admin/personal-users/${encodeURIComponent(username)}`, {}, body, csrf),
  /** The signed-in person's own key; they sign in again with the new one. */
  rotateOwnKey: (currentKey: string, csrf: string) => post<{ access_key: string }>("/account/rotate-key", {}, { current_key: currentKey }, csrf),
  auditPage: (query: AuditQuery = {}, signal?: AbortSignal) => get<AuditPage>("/audit", { limit: 50, ...query }, signal),
};
