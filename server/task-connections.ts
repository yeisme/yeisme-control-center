import { isIP } from "node:net";
import { clientOrigin } from "../src/task-links";
import {
  randomUUID,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { AuthError, boundedJSON, secret } from "./auth";
import type { ServerConfig, ScopeBinding, TaskConnection } from "./contracts";
import type {
  TaskSnapshot,
  TaskEvent,
  TaskPage,
  TaskConnectionState,
  ConnectionObservation,
  TaskChannelObservation,
  TaskReadChannel,
  TaskProviderRecovery,
} from "../src/task-observation";
import { normalizeCheckpoint, normalizeProcessObservation, normalizePromptObservation } from "../src/observation-contract";
import type { CoverageState } from "../src/request-visibility";
const actions = new Set([
  "control_center.capabilities",
  "control_center.tasks.list",
  "control_center.tasks.get",
  "control_center.tasks.events",
  "control_center.tasks.cancel",
  "control_center.tasks.cancel_receipt",
  "artifact.access",
  "control_center.tasks.artifact_access",
]);
const contentAction = (action: string) =>
  action === "artifact.access" ||
  action === "control_center.tasks.artifact_access";
const contractErrorCodes = new Set(["operation_not_allowed", "METHOD_NOT_ALLOWED", "NOT_SUPPORTED", "unsupported_operation"]);

function connectionStateFor(error: unknown): string {
  if (!(error instanceof AuthError)) return "source_unavailable";
  if (error.code.includes("contract") || error.code === "owner_action_contract_missing") return "needs_contract";
  if (error.code === "needs_authorization") return "needs_authorization";
  if (error.status === 403) return "forbidden";
  if (error.status === 429 || error.code === "source_busy") return error.code;
  return error.code || "source_unavailable";
}

function channelObservation(error: unknown): TaskChannelObservation {
  return {
    state: connectionStateFor(error),
    observed_at: new Date().toISOString(),
    ...(error instanceof AuthError ? { reason: error.code } : {}),
  };
}
function checkedURL(value: string, code: string) {
  try {
    return new URL(value);
  } catch {
    throw new AuthError(code, 403);
  }
}
export function connectionURL(c: TaskConnection) {
  const u = checkedURL(c.endpoint, "connection_endpoint_denied");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const privateIP =
    host === "::1" ||
    (isIP(host) === 4 &&
      (/^(127\.|10\.|192\.168\.)/.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)));
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !["https:", "http:"].includes(u.protocol) ||
    (u.protocol === "http:" && !(c.allow_private_http && privateIP))
  )
    throw new AuthError("connection_endpoint_denied", 403);
  return u;
}
const safeText = (v: unknown, max = 300) =>
  typeof v === "string" ? v.slice(0, max) : "";
const safeTime = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const observationCoverage = (v: unknown): CoverageState => {
  const allowed: CoverageState[] = ["complete", "partial", "pending", "unknown", "not_recorded", "forbidden", "unavailable", "expired", "integrity_failed", "needs_contract"];
  return typeof v === "string" && allowed.includes(v as CoverageState) ? v as CoverageState : "unknown";
};
const eventField = (value: unknown, key: string) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
function safeProviderRecovery(value: unknown): TaskProviderRecovery | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const rawState = typeof raw.state === "string" ? raw.state.toLowerCase() : "submission_unknown";
  const state: TaskProviderRecovery["state"] = rawState.includes("not_submitted") ? "not_submitted" : rawState.includes("rejected") || rawState.includes("invalid") ? "rejected_no_generation" : rawState.includes("generated") || rawState.includes("succeeded") || rawState.includes("completed") ? "generated" : rawState.includes("accepted") || rawState.includes("queued") || rawState.includes("running") || rawState.includes("pending") ? "accepted_pending" : rawState.includes("blocked") || rawState.includes("credential") || rawState.includes("disabled") ? "blocked" : "submission_unknown";
  const refs = raw.artifact_refs || raw.output_refs || raw.artifacts;
  return {
    state,
    native_state: safeText(raw.native_state || raw.provider_state || raw.status || raw.state, 100) || null,
    submission_ref: safeText(raw.submission_ref || raw.task_ref || raw.task_id, 512) || null,
    binding_id: safeText(raw.binding_id || raw.binding, 160) || null,
    error_code: safeText(raw.error_code || raw.code || raw.error, 160) || null,
    blocker: safeText(raw.blocker || raw.blocked_reason || raw.reason, 300) || null,
    safe_to_resubmit: typeof raw.safe_to_resubmit === "boolean" ? raw.safe_to_resubmit : null,
    review_status: safeText(raw.review_status, 100) || null,
    export_status: safeText(raw.export_status, 100) || null,
    artifact_refs: Array.isArray(refs) ? refs.flatMap((item) => { const ref = typeof item === "string" ? item : item && typeof item === "object" ? (item as Record<string, unknown>).ref || (item as Record<string, unknown>).artifact_ref : undefined; return typeof ref === "string" && ref.length <= 512 ? [ref] : []; }).slice(0, 50) : [],
  };
}
function safeThumbnail(value: unknown): TaskSnapshot["results"][number]["thumbnail"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    state: raw.state === "ready" || raw.state === "forbidden" || raw.state === "needs_contract" ? raw.state : "unavailable",
    ...(typeof raw.ref === "string" && raw.ref.length <= 512 ? { ref: raw.ref } : {}),
    ...(safeTime(raw.observed_at) ? { observed_at: safeTime(raw.observed_at) || undefined } : {}),
    ...(safeText(raw.reason, 200) ? { reason: safeText(raw.reason, 200) } : {}),
  };
}
export function safeTask(v: any, c: TaskConnection): TaskSnapshot {
  if (
    v?.schema_version !== "yeisme.task_observation.v1" ||
    v.locator?.owner !== c.owner ||
    v.locator?.project !== c.project ||
    typeof v.locator?.task_ref !== "string" ||
    !v.locator.task_ref ||
    v.locator.task_ref.length > 512
  )
    throw new AuthError("task_scope_mismatch", 403);
  const p = v.progress || {},
    kind = ["count", "percent"].includes(p.kind) ? p.kind : "indeterminate";
  const results = (Array.isArray(v.results) ? v.results : [])
    .slice(0, 100)
    .flatMap((a: unknown, index: number) => {
      if (!a || typeof a !== "object" || !("ref" in a)) return [];
      const value = a as Record<string, unknown>;
      const thumbnail = safeThumbnail(value.thumbnail);
      return typeof value.ref === "string" && value.ref.length <= 512
        ? [{
            ref: `artifact-${index}`,
            ...(typeof value.version === "string" && /^(sha256:)?[a-f0-9]{64}$/.test(value.version) ? { version: value.version } : {}),
            name: safeText(value.name),
            mime: safeText(value.mime, 100),
            bytes: count(value.bytes),
            state: safeText(value.state, 80),
            width: count(value.width) ?? undefined,
            height: count(value.height) ?? undefined,
            duration_ms: count(value.duration_ms) ?? undefined,
            ...(thumbnail ? { thumbnail } : {}),
          }]
        : [];
    });
  const allowedActions: TaskSnapshot["allowed_actions"] = (Array.isArray(v.allowed_actions) ? v.allowed_actions : [])
    .flatMap((a: unknown): TaskSnapshot["allowed_actions"] => {
      if (!a || typeof a !== "object" || !("action" in a)) return [];
      const action = a.action;
      if (action !== "cancel" && action !== "preview" && action !== "download") return [];
      const contentBlocked = action !== "cancel" && c.allow_content !== true;
      const reason = safeText("reason" in a ? a.reason : undefined, 200);
      const ownerResultAccessRequested = action !== "cancel" && c.allow_content === true && reason === "owner_result_access_requested";
      return [{
        action,
        enabled:
          (("enabled" in a && a.enabled === true) || ownerResultAccessRequested) &&
          (action !== "cancel" || c.allow_cancel === true) &&
          !contentBlocked,
        reason: contentBlocked
          ? "content_not_authorized"
          : reason,
      }];
    });
  if (c.allow_content === true && results.length > 0) {
    for (const action of ["preview", "download"] as const)
      if (!allowedActions.some((item) => item.action === action))
        allowedActions.push({ action, enabled: true, reason: "owner_result_access_requested" });
  }
  const providerRecovery = c.owner === "scaena" ? safeProviderRecovery(v.provider_recovery || v.recovery) : undefined;
  const process = normalizeProcessObservation(v.process);
  const promptCapture = normalizePromptObservation(v.prompt_capture);
  return {
    schema_version: "yeisme.task_observation.v1",
    locator: {
      owner: c.owner,
      instance_id: c.instance_id,
      project: c.project,
      task_family: safeText(v.locator.task_family, 80),
      task_ref: v.locator.task_ref,
    },
    title: safeText(v.title) || v.locator.task_ref,
    state: safeText(v.state, 60),
    native_state: safeText(v.native_state, 80),
    stage: safeText(v.stage, 80),
    revision: safeText(v.revision, 150),
    created_at: safeTime(v.created_at) || "",
    updated_at: safeTime(v.updated_at),
    started_at: safeTime(v.started_at),
    observed_at: new Date().toISOString(),
    progress: {
      kind,
      completed: count(p.completed),
      total: count(p.total),
      percent: count(p.percent) !== null && p.percent <= 100 ? p.percent : null,
    },
    source: safeText(v.source, 80),
    actor: typeof v.actor === "string" ? safeText(v.actor) : null,
    episode_ref:
      c.owner === "scaena"
        ? safeText(v.episode_ref, 512) || undefined
        : undefined,
    parent_ref:
      typeof v.parent_ref === "string" ? safeText(v.parent_ref, 512) : null,
    results,
    allowed_actions: allowedActions,
    coverage: v.coverage === "complete" ? "complete" : "partial",
    ...(providerRecovery ? { provider_recovery: providerRecovery } : {}),
    ...(process ? { process } : {}),
    ...(promptCapture ? { prompt_capture: promptCapture } : {}),
  };
}
function rawResultRef(value: unknown, index: number): string | undefined {
  if (!value || typeof value !== "object" || !("results" in value)) return undefined;
  const results = value.results;
  if (!Array.isArray(results)) return undefined;
  const result = results[index];
  if (!result || typeof result !== "object" || !("ref" in result)) return undefined;
  const ref = result.ref;
  return typeof ref === "string" && ref.length <= 512 ? ref : undefined;
}

export class TaskConnections {
  private key = randomBytes(32);
  private initialized = new Map<string, string>();
  private queues = new Map<string, Promise<unknown>>();
  private denied = new Set<string>();
  private contentDenied = new Set<string>();
  private pending = new Map<string, number>();
  private observations = new Map<string, ConnectionObservation>();
  private observing = new Map<string, Promise<ConnectionObservation>>();
  private channels = new Map<string, Partial<Record<TaskReadChannel, TaskChannelObservation>>>();
  constructor(
    private config: ServerConfig,
    private fetcher: typeof fetch = fetch,
  ) {}
  connections(scope: ScopeBinding) {
    return (this.config.connections || []).filter(
      (c) => c.enabled && scope.connection_ids?.includes(c.id),
    );
  }
  async observe(scope: ScopeBinding): Promise<TaskConnectionState[]> {
    return Promise.all(this.connections(scope).map(async c => ({
      id: c.id, owner: c.owner, instance_id: c.instance_id, label: c.label,
      environment: c.environment, project: c.project,
      ...await this.observeConnection(c),
    })));
  }
  private async observeConnection(c: TaskConnection) {
    const previous = this.observations.get(c.id);
    const project = (observation: ConnectionObservation) => {
      const runtime: ConnectionObservation = {
        ...observation,
        channels: { ...this.channels.get(c.id), ...observation.channels },
        content: c.allow_content !== true
          ? "not_requested"
          : this.contentDenied.has(c.id) ? "denied" : observation.content,
        ...(this.denied.has(c.id) ? {
          state: "needs_authorization", authorization: "denied" as const,
          last_success_at: null, task_families: [], reason: "needs_authorization",
        } : {}),
      };
      return { state: runtime.state, observed_at: runtime.last_success_at || "", channels: runtime.channels, runtime };
    };
    // The same fixed credential/project can be shared by authorized scopes;
    // only non-content connection facts are cached, never task rows or grants.
    if (!this.denied.has(c.id) && previous && Date.now() - Date.parse(previous.checked_at) < 15_000)
      return project(previous);
    let work = this.observing.get(c.id);
    if (!work) {
      work = (async (): Promise<ConnectionObservation> => {
        const value: ConnectionObservation = {
          state: "not_checked", checked_at: new Date().toISOString(),
          last_success_at: previous?.last_success_at || null,
          transport: "unknown", authorization: "unknown", contract: "unknown",
          task_families: [], content: c.allow_content === true ? "not_verified" : "not_requested",
          channels: { ...this.channels.get(c.id) },
        };
        try {
          const caps = await this.call(c, "control_center.capabilities", {});
          value.transport = "verified";
          if (caps?.schema_version !== "yeisme.task_observation.v1" ||
              !Array.isArray(caps.task_families) || caps.task_families.length > 32 ||
              !caps.task_families.every((v: unknown) => typeof v === "string" && /^[a-z0-9_-]{1,80}$/.test(v)))
            throw new AuthError("needs_contract", 422);
          value.contract = "supported";
          value.task_families = caps.task_families;
          this.setChannel(c, "connection", { state: "ready", observed_at: new Date().toISOString() });
          const page = await this.call(c, "control_center.tasks.list", { mode: "active", limit: 1 });
          if (!Array.isArray(page?.rows) || page.rows.length > 1)
            throw new AuthError("invalid_task_page", 503);
          for (const row of page.rows) safeTask(row, c);
          this.setChannel(c, "active", { state: "ready", observed_at: new Date().toISOString() });
          value.authorization = "verified";
          value.state = "ready";
          value.last_success_at = new Date().toISOString();
          if (c.allow_content === true) {
            value.content = caps.artifact_access === true
              ? "supported"
              : caps.artifact_access === false ? "unsupported" : "not_verified";
          }
        } catch (error) {
          this.setChannel(c, value.contract === "supported" ? "active" : "connection", channelObservation(error));
          value.state = connectionStateFor(error);
          value.reason = error instanceof AuthError ? error.code : "source_unavailable";
          if (this.denied.has(c.id) || value.state === "owner_action_denied") {
            value.authorization = "denied";
            value.state = "needs_authorization";
            value.last_success_at = null;
            value.task_families = [];
          }
          if (value.state === "needs_contract") value.contract = "unsupported";
        }
        value.channels = { ...this.channels.get(c.id), ...value.channels };
        this.observations.set(c.id, value);
        return value;
      })();
      this.observing.set(c.id, work);
    }
    try { return project(await work); }
    finally { if (this.observing.get(c.id) === work) this.observing.delete(c.id); }
  }
  private async wire(c: TaskConnection, body: unknown, protocol?: string, content = false) {
    const response = await this.fetcher(connectionURL(c), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(6000),
      headers: {
        Authorization: "Bearer " + secret(c.credential_ref),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(protocol ? { "MCP-Protocol-Version": protocol } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        (content ? this.contentDenied : this.denied).add(c.id);
        if (content) this.observations.delete(c.id);
      }
      throw new AuthError(
        response.status === 401 || response.status === 403
          ? content ? "content_not_authorized" : "needs_authorization"
          : response.status === 404 || response.status === 405
            ? "owner_action_contract_missing"
          : response.status === 429
            ? "source_rate_limited"
            : "source_unavailable",
        response.status === 401 || response.status === 403
          ? 403
          : response.status === 404 || response.status === 405
            ? 422
            : 503,
      );
    }
    return boundedJSON(response, 2 * 1024 * 1024);
  }
  async call(c: TaskConnection, action: string, args: Record<string, unknown>) {
    if (!actions.has(action)) throw new AuthError("owner_action_contract_missing", 422);
    if (contentAction(action) && c.allow_content !== true)
      throw new AuthError("content_not_authorized", 403);
    if (this.denied.has(c.id)) throw new AuthError("needs_authorization", 403);
    const pending = this.pending.get(c.id) || 0;
    if (pending >= 8) throw new AuthError("source_busy", 429);
    this.pending.set(c.id, pending + 1);
    const previous = this.queues.get(c.id) || Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        if (this.denied.has(c.id))
          throw new AuthError("needs_authorization", 403);
        let protocol = this.initialized.get(c.id);
        if (!protocol) {
          const id = randomUUID();
          const init = await this.wire(c, {
            jsonrpc: "2.0",
            id,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "yeisme-control-center", version: "0.1.0" },
            },
          });
          if (
            init.id !== id ||
            init.error ||
            !["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].includes(
              init.result?.protocolVersion,
            )
          )
            throw new AuthError("mcp_initialization_failed", 503);
          protocol = init.result.protocolVersion;
          this.initialized.set(c.id, protocol!);
        }
        const parameters =
          c.owner === "scaena"
            ? {
                ...(action === "control_center.tasks.cancel"
                  ? { idempotency_key: args.idempotency_key }
                  : {}),
                path: {
                  project_id: c.project,
                  ...(typeof args.task_ref === "string"
                    ? { task_ref: args.task_ref }
                    : {}),
                  ...(typeof args.artifact_ref === "string"
                    ? { artifact_ref: args.artifact_ref }
                    : {}),
                },
                query: Object.fromEntries(
                  Object.entries(args)
                    .filter(
                      ([k, v]) =>
                        v !== undefined &&
                        v !== "" &&
                        !["task_ref", "artifact_ref"].includes(k),
                    )
                    .map(([k, v]) => [k, String(v)]),
                ),
              }
            : { ...args, project_id: c.project };
        const id = randomUUID();
        const v = await this.wire(
          c,
          {
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: {
              name: c.owner + ".execute",
              arguments: { action, args: parameters },
            },
          },
          protocol,
          contentAction(action),
        );
        if (v.id !== id) throw new AuthError("invalid_mcp_response", 503);
        const rawToolCode = v.result?.structuredContent?.error?.code;
        const toolCode =
          rawToolCode === "REVISION_CONFLICT"
            ? "VERSION_CONFLICT"
            : rawToolCode === "CONSUMER_IDEMPOTENCY_CONFLICT"
              ? "IDEMPOTENCY_CONFLICT"
              : rawToolCode;
        if (contractErrorCodes.has(String(toolCode)))
          throw new AuthError("needs_contract", 422);
        if (
          [
            "AUTH_ACTION_DENIED",
            "FORBIDDEN",
            "AUTH_REQUIRED",
            "unauthenticated",
            "owner_action_denied",
          ].includes(toolCode)
        ) {
          if (contentAction(action)) {
            this.contentDenied.add(c.id);
            this.observations.delete(c.id);
            throw new AuthError("content_not_authorized", 403);
          }
          this.denied.add(c.id);
          throw new AuthError("needs_authorization", 403);
        }
        if (
          [
            "VERSION_CONFLICT",
            "IDEMPOTENCY_CONFLICT",
            "CANCEL_UNAVAILABLE",
          ].includes(toolCode)
        )
          throw new AuthError(toolCode.toLowerCase(), 409);
        if (v.error || v.result?.isError)
          throw new AuthError("needs_contract", 422);
        let result = v.result?.structuredContent;
        if (!result) {
          const block = v.result?.content?.find((b: any) => b.type === "text");
          try {
            const raw = block?.text || "";
            result = JSON.parse(raw.slice(raw.indexOf("{")));
          } catch {
            throw new AuthError("invalid_mcp_response", 503);
          }
        }
        if (result?.error) {
          if (contentAction(action)) {
            if (["AUTH_ACTION_DENIED", "FORBIDDEN", "AUTH_REQUIRED", "unauthenticated", "owner_action_denied"].includes(result.error.code)) {
              this.contentDenied.add(c.id);
              this.observations.delete(c.id);
              throw new AuthError("content_not_authorized", 403);
            }
            throw new AuthError("needs_contract", 422);
          }
          if (contractErrorCodes.has(String(result.error.code)))
            throw new AuthError("needs_contract", 422);
          throw new AuthError("owner_action_denied", 403);
        }
        if (result?.result !== undefined) {
          try {
            result =
              typeof result.result === "string"
                ? JSON.parse(result.result)
                : result.result;
          } catch {
            throw new AuthError("invalid_mcp_response", 503);
          }
        }
        if (result?.data !== undefined) result = result.data;
        if (c.owner === "sonora" && result?.projection !== undefined)
          result = result.projection;
        if (action === "artifact.access") {
          if (contentAction(action)) {
            this.contentDenied.delete(c.id);
            this.observations.delete(c.id);
          }
          return {
            projection: result,
            links: (v.result?.content || [])
              .filter(
                (b: any) =>
                  b.type === "resource_link" && typeof b.uri === "string",
              )
              .map((b: any) => b.uri),
          };
        }
        if (contentAction(action)) {
          this.contentDenied.delete(c.id);
          this.observations.delete(c.id);
        }
        return result;
      });
    this.queues.set(c.id, work);
    try {
      return await work;
    } finally {
      this.pending.set(c.id, (this.pending.get(c.id) || 1) - 1);
      if (this.queues.get(c.id) === work) this.queues.delete(c.id);
    }
  }
  private token(body: unknown) {
    const raw = Buffer.from(JSON.stringify(body)).toString("base64url");
    return (
      raw + "." + createHmac("sha256", this.key).update(raw).digest("base64url")
    );
  }
  private decode(raw: string) {
    if (raw.length > 4096) throw new AuthError("invalid_task_key", 400);
    const [b, m, ...rest] = raw.split(".");
    const mac = createHmac("sha256", this.key)
      .update(b || "")
      .digest("base64url");
    if (
      rest.length ||
      !m ||
      m.length !== mac.length ||
      !timingSafeEqual(Buffer.from(m), Buffer.from(mac))
    )
      throw new AuthError("task_not_found", 404);
    try {
      return JSON.parse(Buffer.from(b, "base64url").toString());
    } catch {
      throw new AuthError("invalid_task_key", 400);
    }
  }
  private project(v: any, c: TaskConnection, scope: ScopeBinding) {
    const task = safeTask(v, c);
    task.connection_id = c.id;
    if (c.owner === "scaena" && c.studio_origin && task.episode_ref) {
      const target = checkedURL(
        clientOrigin(c.studio_origin),
        "invalid_client_origin",
      );
      target.hash =
        "/work?" +
        new URLSearchParams({
          project: c.project,
          episode: task.episode_ref,
        }).toString();
      task.work_url = target.href;
    }
    task.task_key = this.token({
      scope: scope.id,
      c: c.id,
      ref: task.locator.task_ref,
      family: task.locator.task_family,
    });
    return task;
  }
  async resolve(
    scope: ScopeBinding,
    target: {
      connection: string;
      project: string;
      family: string;
      ref: string;
    },
  ) {
    const c = this.connections(scope).find(
      (c) => c.id === target.connection && c.project === target.project,
    );
    if (!c) throw new AuthError("task_not_found", 404);
    return this.detail(
      this.token({
        scope: scope.id,
        c: c.id,
        ref: target.ref,
        family: target.family,
      }),
      scope,
    );
  }
  locate(raw: string, scope: ScopeBinding) {
    const v = this.decode(raw),
      c = this.connections(scope).find((c) => c.id === v.c);
    if (!c || v.scope !== scope.id || typeof v.ref !== "string")
      throw new AuthError("task_not_found", 404);
    return { c, ref: v.ref as string, family: v.family as string };
  }
  async list(
    scope: ScopeBinding,
    mode: "active" | "history",
    cursors: Record<string, string> = {},
  ): Promise<TaskPage> {
    const continuation = Object.keys(cursors).length > 0;
    const result = await Promise.all(
      this.connections(scope)
        .filter((c) => !continuation || Object.hasOwn(cursors, c.id))
        .map(async (c) => {
          const coverage: TaskConnectionState = {
            id: c.id,
            owner: c.owner,
            instance_id: c.instance_id,
            label: c.label,
            environment: c.environment,
            project: c.project,
            state: "ready",
            observed_at: new Date().toISOString(),
          };
          try {
            let cursor: string | undefined;
            if (cursors[c.id]) {
              const p = this.decode(cursors[c.id]);
              if (
                p.c !== c.id ||
                p.scope !== scope.id ||
                p.mode !== mode ||
                p.exp < Date.now()
              )
                throw new AuthError("cursor_expired", 409);
              cursor = p.cursor;
            }
            const data = await this.call(c, "control_center.tasks.list", {
              mode,
              limit: 50,
              ...(cursor ? { cursor } : {}),
            });
            if (!Array.isArray(data?.rows) || data.rows.length > 50)
              throw new AuthError("invalid_task_page", 503);
            this.setChannel(c, mode, { state: "ready", observed_at: new Date().toISOString() });
            return {
              coverage,
              channels: this.channels.get(c.id),
              rows: data.rows.map((r: any) => this.project(r, c, scope)),
              cursor:
                typeof data.next_cursor === "string" && data.next_cursor
                  ? this.token({
                      c: c.id,
                      scope: scope.id,
                      mode,
                      cursor: data.next_cursor,
                      exp: Date.now() + 300_000,
                    })
                  : undefined,
            };
          } catch (e) {
            coverage.state = connectionStateFor(e);
            this.setChannel(c, mode, channelObservation(e));
            return { coverage: { ...coverage, channels: this.channels.get(c.id) }, rows: [], cursor: undefined };
          }
        }),
    );
    return {
      rows: result.flatMap((r) => r.rows),
      connections: result.map((r) => r.coverage),
      next_cursors: Object.fromEntries(
        result.filter((r) => r.cursor).map((r) => [r.coverage.id, r.cursor!]),
      ),
    };
  }
  async detail(raw: string, scope: ScopeBinding) {
    const { c, ref, family } = this.locate(raw, scope);
    let task: TaskSnapshot;
    try {
      task = this.project(
        await this.call(c, "control_center.tasks.get", {
          task_ref: ref,
          task_family: family,
        }),
        c,
        scope,
      );
      this.setChannel(c, "detail", { state: "ready", observed_at: new Date().toISOString() });
    } catch (error) {
      this.setChannel(c, "detail", channelObservation(error));
      throw error;
    }
    if (task.locator.task_ref !== ref || task.locator.task_family !== family)
      throw new AuthError("task_identity_mismatch", 403);
    return task;
  }
  async events(raw: string, scope: ScopeBinding, cursor?: string, after?: string) {
    const { c, ref, family } = this.locate(raw, scope);
    let r: any;
    try {
      r = await this.call(c, "control_center.tasks.events", {
        task_ref: ref,
        task_family: family,
        cursor,
        after_cursor: after,
        limit: 100,
      });
    } catch (error) {
      this.setChannel(c, "events", channelObservation(error));
      throw error;
    }
    if (!Array.isArray(r?.events) || typeof r.gap !== "boolean" || (r.next_cursor !== undefined && typeof r.next_cursor !== "string")) {
      const error = new AuthError("needs_contract", 422);
      this.setChannel(c, "events", channelObservation(error));
      throw error;
    }
    this.setChannel(c, "events", { state: "ready", observed_at: new Date().toISOString() });
    const observation = normalizeProcessObservation(r.observation || r.process);
    return {
      events: r.events.slice(0, 100).flatMap((e: unknown): TaskEvent[] => {
        const checkpoint = normalizeCheckpoint(e);
        if (!checkpoint) return [];
        return [{
          id: checkpoint.id,
          occurred_at: checkpoint.occurred_at,
          stage: checkpoint.stage,
          state: checkpoint.state,
          sequence: checkpoint.sequence,
          kind: checkpoint.kind,
          summary: checkpoint.summary,
          reason_code: checkpoint.reason_code,
          duration_ms: checkpoint.duration_ms,
          attempt_ref: checkpoint.attempt_ref,
          progress: checkpoint.progress,
          evidence_refs: checkpoint.evidence_refs,
          prompt_capture: checkpoint.prompt_capture,
        }];
      }),
      next_cursor: safeText(r.next_cursor, 2048) || undefined,
      resume_cursor: safeText(r.resume_cursor || r.next_after_cursor, 2048) || undefined,
      gap: r.gap,
      ...(observation ? { observation } : {}),
      coverage: observationCoverage(r.coverage),
      ...(safeText(r.reason, 300) ? { reason: safeText(r.reason, 300) } : {}),
      freshness: r.freshness === "fresh" || r.freshness === "stale" ? r.freshness : "unknown",
      observed_at: safeTime(r.observed_at) || new Date().toISOString(),
    };
  }
  async artifact(raw: string, scope: ScopeBinding, artifactRef: string, action: "preview" | "download" | "thumbnail" = "preview") {
    const { c } = this.locate(raw, scope);
    try {
      const result = await this.readArtifact(raw, scope, artifactRef, action);
      this.setChannel(c, "artifacts", { state: "ready", observed_at: new Date().toISOString() });
      return result;
    } catch (error) {
      this.setChannel(c, "artifacts", channelObservation(error));
      throw error;
    }
  }

  private async readArtifact(raw: string, scope: ScopeBinding, artifactRef: string, action: "preview" | "download" | "thumbnail") {
    const { c, ref, family } = this.locate(raw, scope);
    if (c.allow_content !== true) {
      const error = new AuthError("content_not_authorized", 403);
      throw error;
    }
    const task = await this.detail(raw, scope);
    const rawTask = await this.call(c, "control_center.tasks.get", { task_ref: ref, task_family: family });
    const rawResults = rawTask && typeof rawTask === "object" && "results" in rawTask && Array.isArray(rawTask.results)
      ? rawTask.results
      : [];
    const opaqueIndex = /^artifact-(\d+)$/.exec(artifactRef)?.[1];
    const artifactIndex = opaqueIndex === undefined
      ? rawResults.findIndex((item: unknown) => item && typeof item === "object" && "ref" in item && item.ref === artifactRef)
      : Number(opaqueIndex);
    let sourceRef = rawResultRef(rawTask, artifactIndex);
    const artifact = task.results.find((item) => item.ref === `artifact-${artifactIndex}`);
    if (!sourceRef || !artifact) throw new AuthError("artifact_not_found", 404);
    if (action === "thumbnail") {
      const rawThumbnail = (rawResults[artifactIndex] as { thumbnail?: { state?: string; ref?: string } })?.thumbnail;
      if (rawThumbnail?.state !== "ready" || !rawThumbnail.ref || rawThumbnail.ref === sourceRef || rawThumbnail.ref.length > 512) throw new AuthError("thumbnail_needs_contract", 422);
      sourceRef = rawThumbnail.ref;
    }
    const allowed = task.allowed_actions.find((item) => item.action === (action === "thumbnail" ? "preview" : action));
    if (allowed && !allowed.enabled && allowed.reason !== "owner_result_access_requested") throw new AuthError(allowed.reason || "content_not_authorized", 403);
    if (c.owner === "sonora" || c.owner === "scaena") {
      const grant = await this.call(c, "control_center.tasks.artifact_access", {
        task_ref: task.locator.task_ref,
        task_family: task.locator.task_family,
        artifact_ref: sourceRef,
      });
      if (
        grant?.schema_version !== c.owner + ".task_artifact_grant.v1" ||
        grant.artifact_ref !== sourceRef ||
        typeof grant.url !== "string"
      )
        throw new AuthError("media_needs_contract", 422);
      const url = checkedURL(grant.url, "media_address_denied");
      if (
        url.origin !== connectionURL(c).origin ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new AuthError("media_address_denied", 403);
      if (c.owner === "sonora") {
        if (
          !/^\/api\/v1\/artifact-access\/[a-f0-9]{32}$/.test(url.pathname) ||
          [...url.searchParams.keys()].join(",") !== "t" ||
          !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("t") || "")
        )
          throw new AuthError("media_address_denied", 403);
      } else {
        const parts = url.pathname.split("/").map(decodeURIComponent);
        const expected = [
          "",
          "api",
          "v1",
          "projects",
          c.project,
          "control-center",
          "tasks",
          task.locator.task_ref,
          "artifacts",
          sourceRef,
          "access-grants",
        ];
        if (
          parts.length !== 12 ||
          expected.some((p, i) => p !== parts[i]) ||
          !/^artifact-grant:[a-f0-9]{32}$/.test(parts[11]) ||
          [...url.searchParams.keys()].join(",") !== "task_family" ||
          url.searchParams.get("task_family") !== task.locator.task_family
        )
          throw new AuthError("media_address_denied", 403);
      }
      const expires = Date.parse(grant.expires_at);
      if (
        !Number.isFinite(expires) ||
        expires <= Date.now() ||
        expires > Date.now() + 125000
      )
        throw new AuthError("media_grant_expired", 410);
      return {
        url,
        expires,
        artifact: {
          ...artifact,
          mime: safeText(grant.mime, 100),
          bytes: count(grant.bytes),
        },
      };
    }
    if (action === "thumbnail" && sourceRef !== rawResultRef(rawTask, artifactIndex) + "#thumbnail") throw new AuthError("thumbnail_needs_contract", 422);
    const r = await this.call(c, "artifact.access", {
      artifact_uri: action === "thumbnail" ? rawResultRef(rawTask, artifactIndex) : sourceRef,
      ...(action === "thumbnail" ? { variant: "thumbnail" } : {}),
      confirm: true,
    });
    if (
      r?.projection?.schema_version !== "eikona.artifact_access_grant.v1" || (action === "thumbnail" && r.projection.variant !== "thumbnail") ||
      r.links?.length !== 1
    )
      throw new AuthError("media_needs_contract", 422);
    const url = checkedURL(r.links[0], "media_address_denied");
    if (
      url.origin !== connectionURL(c).origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !/^\/api\/v1\/artifact-access\/acc_[a-f0-9]{48}$/.test(url.pathname)
    )
      throw new AuthError("media_address_denied", 403);
    const expires = Date.parse(r.projection.expires_at);
    if (!Number.isFinite(expires) || expires <= Date.now())
      throw new AuthError("media_grant_expired", 410);
    return { url, expires, artifact: action === "thumbnail" ? { ...artifact, mime: "image/jpeg", bytes: null } : artifact };
  }
  mediaHeaders(raw: string, scope: ScopeBinding): Record<string, string> {
    const { c } = this.locate(raw, scope);
    if (c.allow_content !== true || this.contentDenied.has(c.id) || this.denied.has(c.id))
      throw new AuthError("content_not_authorized", 403);
    return c.owner !== "eikona"
      ? { Authorization: "Bearer " + secret(c.credential_ref) }
      : {};
  }

  private setChannel(c: TaskConnection, channel: TaskReadChannel, value: TaskChannelObservation) {
    const next = { ...(this.channels.get(c.id) || {}), [channel]: value };
    this.channels.set(c.id, next);
    const previous = this.observations.get(c.id);
    if (previous) this.observations.set(c.id, { ...previous, channels: next });
  }
  async cancel(
    raw: string,
    scope: ScopeBinding,
    revision: string,
    idempotencyKey: string,
    queryOnly = false,
  ) {
    const { c, ref, family } = this.locate(raw, scope);
    if (!c.allow_cancel) throw new AuthError("cancel_not_authorized", 403);
    if (!(
      (c.owner === "eikona" && family === "run") ||
      (c.owner === "sonora" && family === "local-job") ||
      (c.owner === "scaena" && family === "delegation")
    ))
      throw new AuthError("cancel_not_supported", 409);
    const result = await this.call(
      c,
      queryOnly
        ? "control_center.tasks.cancel_receipt"
        : "control_center.tasks.cancel",
      {
        task_ref: ref,
        task_family: family,
        expected_revision: revision,
        idempotency_key: idempotencyKey,
        confirm: !queryOnly,
      },
    );
    const task = this.project(result?.task, c, scope),
      receipt = result?.receipt;
    if (
      task.locator.task_ref !== ref ||
      task.locator.task_family !== family ||
      receipt?.schema_version !== "yeisme.task_cancel_receipt.v1" ||
      receipt.task_ref !== ref ||
      typeof receipt.ref !== "string" ||
      !receipt.ref ||
      receipt.ref.length > 512 ||
      ![
        "cancelled",
        "requested",
        "already_terminal",
        "not_supported",
        "unknown",
      ].includes(receipt.outcome) ||
      (!queryOnly && receipt.expected_revision !== revision)
    )
      throw new AuthError("invalid_cancel_receipt", 503);
    return {
      task,
      receipt: {
        schema_version: "yeisme.task_cancel_receipt.v1",
        ref: safeText(receipt.ref, 512),
        task_ref: ref,
        outcome: receipt.outcome,
        occurred_at: safeTime(receipt.occurred_at),
      },
    };
  }
}
