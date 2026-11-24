import { PromptCollectionStore, type PromptLink } from "./db/prompt-collection-store";
import { PromptRecipeStore, type PromptRecipeInput } from "./db/prompt-recipe-store";
import { promptOwners, type PromptOwner, type PromptQuery } from "../src/shared/prompt-library";
import { promptWrite } from "./prompt-library";
import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { AuthError, SessionAuth } from "./auth";
import { clientAddress } from "./client-address";
import { maxSecretBytes } from "./password";
import { OwnerReaders, owners } from "./owners";
import { TaskConnections, taskIdentityOf } from "./task-connections";
import { ConnectionCatalog, ownerProjectRef } from "./connection-catalog";
import { MediaBridge } from "./media";
import { readOnlyRequestAllowed } from "./read-only-policy";
import { collectionIndexScope } from "./collection-context";
import { projectCollectionRead } from "./project-collection-routes";
import { gatewayEventStream } from "./gateway-event-stream";
import type { EpisodeArtifactAccessPort } from "./episode-artifact-access";
import { serviceDirectory } from "./service-directory";
import type { TaskSnapshot } from "../src/task-observation";
import type { ServerConfig, ScopeBinding, Session, Owner } from "./contracts";
import { AuditStore, auditActions, type AuditAction, type AuditContext, type AuditOutcome } from "./db/audit";
import { SessionStore } from "./db/session-store";
import { RunStore } from "./db/run-store";
import { ActionService, type PreviewRecord } from "./actions";
import type { ActionConfirmRequest, ActionPreviewRequest, ActionReceipt } from "../src/shared/action-contract";
import { createMemoryDB, type ControlDB } from "./db/client";
import { NotificationStore, attentionStates, countsAsUnread, failureFact, livenessFact, snoozeDeadline } from "./notifications";
import { controlStateOf, taskSigningKey, type ControlState } from "./db/control-state";
import { rekeyNotifications } from "./db/notification-rekey";
import { ToolCatalogService } from "./tool-catalog";
import { ToolCatalogStore } from "./db/tool-catalog-store";
import {
  ProviderRunManager,
  type ProviderRunRequest,
} from "./provider-live";
import { AuctraCollectionReader, auctraConnection, collectionFingerprint } from "./auctra";
import { AuctraCollectionStore } from "./db/auctra-collection-store";
import { ProjectMetadataStore } from "./db/project-metadata-store";
import { GenerationBatches, parseBatchQuery } from "./generation-batches";
import { CollaborationService, identityOf } from "./collaboration";
import { isCollaborationAction, type DirectoryQuery, type GenerationBatch } from "../src/shared/collaboration";
import { buildWorkQueue, filterAndPageWorkQueue } from "./work-queue";
import { OpenToolService } from "./open-tools/service";
import { credentialStatuses, isPersonalAdmin } from "./credentials";
import { workQueueKinds } from "../src/shared/work-queue";
import { DramaService, dramaLimits, validDramaRef } from "./drama";
import { ProductionReader } from "./production";
import { EpisodeProductionReader } from "./episode-production";
import { TaskReviewReader } from "./task-review";
import { GatewayMonitorService, gatewayConnection } from "./gateway-monitor";
import { collectionSyncLimits, syncCollection } from "./auctra-sync";
import { ScaenaStoryboardReader } from "./scaena-storyboard";
import { observationStatus, type ObservationLoop } from "./observation-loop";
import { referenceBindingKinds, referenceBindingOwners, type ReferenceBindingAccessRequest, type ReferenceBindingSource } from "../src/shared/reference-bindings";
import type { PromptRecipeQuery, PromptRecipeUsePreview } from "../src/shared/prompt-recipes";
import {
  defaultRequestQuery,
  type RequestQuery,
  type Coverage,
} from "../src/request-visibility";
const prefix = "/api/control-center/v1";
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
/** A path segment, decoded. A malformed escape such as `%ZZ` is the caller's mistake, so it is a 400 and not a failure of the service. */
const pathParam = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new AuthError("invalid_request", 400);
  }
};
/** A request body that must be a JSON object. `null`, an array or a scalar is the caller's mistake: a 400 with `code`, never a TypeError. */
const jsonObject = <T extends object>(raw: string, code: string): T => {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AuthError(code, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthError(code, 400);
  return body as T;
};
const methodNotAllowed = (allowedMethods: string[]) =>
  json(
    {
      error: "operation_not_allowed",
      class: "invalid",
      allowed_methods: allowedMethods,
    },
    405,
    { Allow: allowedMethods.join(", ") },
  );
export function parseQuery(params: URLSearchParams): RequestQuery {
  const q = defaultRequestQuery();
  for (const k of [
    "from",
    "to",
    "search",
    "owner",
    "state",
    "input_type",
    "attachments",
    "outputs",
    "completeness",
  ] as const)
    if (params.has(k)) q[k] = params.get(k)!;
  if (params.has("limit")) q.limit = Number(params.get("limit"));
  if (
    !Number.isFinite(Date.parse(q.from)) ||
    !Number.isFinite(Date.parse(q.to)) ||
    Date.parse(q.from) > Date.parse(q.to) ||
    Date.parse(q.to) - Date.parse(q.from) > 7 * 86400000 ||
    ![25, 50, 100].includes(q.limit) ||
    q.search.length > 200 ||
    (q.owner !== "all" && !owners.includes(q.owner as Owner)) ||
    !["all", "yes", "no"].includes(q.attachments) ||
    !["all", "yes", "no"].includes(q.outputs) ||
    !["all", "text", "image", "audio", "video", "application"].includes(
      q.input_type,
    )
  )
    throw new AuthError("invalid_query", 400);
  return q;
}
/** Maps a machine error code onto the stable contract error class. */
export function errorClass(e: AuthError): string {
  if (e.status === 401) return "login_required";
  if (e.status === 403) return "forbidden";
  if (e.status === 404) return "not_found";
  if (e.status === 409) return "conflict";
  if (e.status === 429) return "rate_limited";
  if (e.status === 410) return "expired";
  if ([400, 405, 413, 422].includes(e.status)) return "invalid";
  return "unavailable";
}

/** What a process may hand to `createControlCenter`; everything is optional and defaults to the real thing. */
export interface ControlCenterDeps {
  auth?: SessionAuth;
  readers?: OwnerReaders;
  tasks?: TaskConnections;
  providers?: ProviderRunManager;
  auctra?: AuctraCollectionReader;
  scaenaStoryboard?: ScaenaStoryboardReader;
  openTools?: OpenToolService;
  /** Explicit owner-backed episode artifact authorization; absent means episode media access is unavailable. */
  episodeArtifacts?: EpisodeArtifactAccessPort;
  db?: ControlDB;
  /** Milliseconds since the epoch; the background loop reads time through it. */
  clock?: () => number;
}

/**
 * What the background observation loop (and any other process-level job) may use. It is the same objects the request
 * handler uses, so a background write and a browser request see one ledger, one connection cache and one config.
 */
export interface ControlServices {
  config: ServerConfig;
  db: ControlDB;
  /** Sessions and the personal accounts behind them; `server/personal-accounts.ts` reads the accounts from `config`. */
  auth: SessionAuth;
  tasks: TaskConnections;
  openTools: OpenToolService;
  notifications: NotificationStore;
  /** Small named values kept with the database, such as when background observation was first enabled. */
  state: ControlState;
  clock: () => number;
  /** Set by the process that runs the background loop (server/index.ts); `GET /observation/status` reads it. */
  observation?: ObservationLoop;
}

export function createControlCenter(config: ServerConfig, deps: ControlCenterDeps = {}) {
  const db = deps.db ?? createMemoryDB(),
    // Task keys stay valid across restarts: the signing key is kept with the database. If it cannot be stored, keys
    // are signed per process, as before.
    signingKey = (() => { try { return taskSigningKey(db); } catch { return randomBytes(32); } })(),
    auth = deps.auth || new SessionAuth(config, undefined, new SessionStore(db)),
    readers = deps.readers || new OwnerReaders(config),
    // Configured connections plus tool projects registered from the control center; one catalog for every reader.
    connectionCatalog = deps.tasks?.catalog ?? new ConnectionCatalog(config, db),
    tasks = deps.tasks || new TaskConnections(config, undefined, signingKey, connectionCatalog),
    providers =
      deps.providers || new ProviderRunManager(config, undefined, new RunStore(db)),
    auctra = deps.auctra || new AuctraCollectionReader(config),
    scaenaStoryboard = deps.scaenaStoryboard || new ScaenaStoryboardReader(config),
    collectionStore = new AuctraCollectionStore(db),
    promptCollectionsStore = new PromptCollectionStore(db),
    promptRecipesStore = new PromptRecipeStore(db),
    drama = new DramaService({ config, auctra, scaena: scaenaStoryboard, store: collectionStore }),
    episodeProduction = new EpisodeProductionReader({ tasks }),
    taskReviews = new TaskReviewReader({ tasks }),
    production = new ProductionReader({ drama, tasks, episodeProduction, taskReviews, clientOrigins: { muweave: config.clients?.muweave?.enabled === false ? undefined : config.clients?.muweave?.origin } }),
    projectMetadata = new ProjectMetadataStore(db),
    audit = new AuditStore(db),
    notifications = new NotificationStore(db),
    openTools = deps.openTools || new OpenToolService(config),
    catalog = new ToolCatalogService(providers, new ToolCatalogStore(db), openTools),
    media = new MediaBridge(tasks, undefined, audit, deps.episodeArtifacts),
    actions = new ActionService(db),
    collaboration = new CollaborationService(db, config, auth, connectionCatalog),
    generationBatches = new GenerationBatches(collaboration, readers, config),
    cursorKey = randomBytes(32);
  // One-time repair of reminders duplicated by earlier restarts; a no-op once its marker is set. A failed repair never
  // keeps the server from starting: it rolls back and runs again on the next start.
  try { rekeyNotifications(db, { key: signingKey }); } catch (error) { console.warn(`[control-center] reminder repair skipped: ${error instanceof Error ? error.message : "unknown"}`); }
  /**
   * Checks a tool-project registration and asks the owner once, through a throwaway connection that copies a
   * configured template. A refusal concerns only that throwaway connection; the template keeps working.
   */
  const checkToolProject = async (s: Session, scope: ScopeBinding, input: Record<string, unknown>) => {
    if (!s.personal || auth.role(s) !== "admin") throw new AuthError("control_center_admin_required", 403);
    if (scope.id.startsWith("project_")) throw new AuthError("owner_project_scope_required", 400);
    const template = connectionCatalog.configured().find((c) => c.id === input.template_connection_id && c.enabled && scope.connection_ids?.includes(c.id));
    if (!template) throw new AuthError("owner_project_template_not_found", 404);
    const project = typeof input.project_ref === "string" ? input.project_ref.trim() : "";
    if (!ownerProjectRef.test(project)) throw new AuthError("invalid_owner_project_ref", 400);
    const label = typeof input.label === "string" ? input.label.trim().slice(0, 80) : "";
    if (/[\x00-\x1f\x7f]/.test(label)) throw new AuthError("invalid_display_name", 400);
    if (connectionCatalog.forScope(scope).some((c) => c.owner === template.owner && c.project === project)) throw new AuthError("owner_project_already_connected", 409);
    try {
      await tasks.probe(connectionCatalog.probe(template, project));
    } catch (e) {
      const status = e instanceof AuthError ? e.status : 503;
      if (status === 401 || status === 403 || status === 404) throw new AuthError("owner_project_not_accessible", 403);
      if (status === 422) throw new AuthError("owner_project_contract_missing", 422);
      throw new AuthError("owner_project_unreachable", 503);
    }
    return { template, project, label };
  };
  const registeredIn = (s: Session, scope: ScopeBinding, id: unknown) => {
    if (!s.personal || auth.role(s) !== "admin") throw new AuthError("control_center_admin_required", 403);
    const found = connectionCatalog.registered().find((c) => c.id === id && c.scope_id === scope.id);
    if (!found) throw new AuthError("owner_project_not_found", 404);
    return found;
  };
  /** Collaboration actions carry their own project grants; every other action changes owner, Provider or account state and needs an admin. */
  const authorizeAction = (s: Session, action: string, actionScope?: ScopeBinding) => {
    if (action.startsWith("prompts.") && actionScope?.id.startsWith("project_")) { collaboration.project(s, actionScope.id, "creator"); return; }
    if (isCollaborationAction(action)) return;
    if (auth.role(s) !== "admin" || (action.startsWith("admin.") && !s.personal)) throw new AuthError("control_center_admin_required", 403);
  };
  const recipeProjectInScope = (scope: ScopeBinding, owner: PromptOwner, projectRef: string) =>
    scope.owners[owner]?.project === projectRef || scope.projects?.some((binding) => binding.owner === owner && binding.project_ref === projectRef) === true;
  const validateRecipeProject = (scope: ScopeBinding, owner: unknown, projectRef: unknown) => {
    if (!promptOwners.includes(owner as PromptOwner) || typeof projectRef !== "string" || !projectRef || !recipeProjectInScope(scope, owner as PromptOwner, projectRef)) throw new AuthError("scope_mismatch", 403);
  };
  const scoped = (s: Session, id: string | null): ScopeBinding => {
    if (id?.startsWith("project_")) return collaboration.scope(s, id);
    const p = auth.principal(s);
    const scope = p?.scopes.find((v) => v.id === id);
    if (!scope) throw new AuthError("scope_not_found", 404);
    return scope;
  };
  const fingerprint = (s: Session, scope: ScopeBinding, q: RequestQuery) =>
    createHash("sha256")
      .update(JSON.stringify([s.issuer, s.subject, s.epoch, scope, q]))
      .digest("hex");
  const withEpoch = <T extends object>(s: Session, body: T) => ({
    ...body,
    epoch: s.epoch,
  });
  const auditOutcome = (e: unknown): "denied" | "failed" | "unavailable" =>
    e instanceof AuthError && (e.status === 401 || e.status === 403)
      ? "denied"
      : e instanceof AuthError
        ? "failed"
        : "unavailable";
  const auditError = (e: unknown) =>
    e instanceof AuthError ? e.code : "source_unavailable";
  /**
   * Runs `work` between an "initiated" audit row and its outcome. Audit-first: when the initiated row cannot be
   * written, `work` never runs. A normal return records "succeeded" unless `work` calls `settle` to say otherwise (a
   * sync that stopped early, a read the owner refused); a throw records denied, failed or unavailable from the error.
   */
  const audited = async <T>(
    context: AuditContext,
    work: (settle: (outcome: Exclude<AuditOutcome, "initiated">, errorCode?: string) => void) => Promise<T> | T,
  ): Promise<T> => {
    const eventId = audit.begin(context);
    let outcome: Exclude<AuditOutcome, "initiated"> = "succeeded";
    let errorCode: string | undefined;
    try {
      const value = await work((next, code) => { outcome = next; errorCode = code; });
      audit.complete(eventId, outcome, errorCode);
      return value;
    } catch (e) {
      audit.complete(eventId, auditOutcome(e), auditError(e));
      throw e;
    }
  };
  const readCreativeFlow = (scope: ScopeBinding, session: Session, query: { episode_ref?: string; breakdown_ref?: string } = {}) => drama.flow(scope, session, query);
  /**
   * One reminder per batch and finished state, for every project member; its link opens that batch directly. Lists and
   * details announce only the changes they observed themselves, so paging back through old batches never re-announces them.
   */
  const batchEndings: Record<string, string> = { succeeded: "已完成", partial: "部分完成", failed: "失败" };
  const changed = (before: GenerationBatch[], after: GenerationBatch[]) => after.filter((batch, index) => batch.state !== before[index]?.state);
  const announceBatches = (projectID: string, rows: GenerationBatch[]) => {
    for (const batch of rows) {
      const ending = batchEndings[batch.state];
      if (!ending) continue;
      for (const recipient of collaboration.recipients(projectID)) notifications.event({ scope: projectID, recipient, event: batch.id + ":" + batch.state, category: "generation_batch", title: `批次「${batch.name}」${ending}`, path: `/creation?${new URLSearchParams({ sharedProject: projectID, batch: batch.id })}` });
    }
  };
  /** A new project, or a change to who shares one, is announced to every member once; the preview ref names the event. */
  const announceProject = (session: Session, record: PreviewRecord, result: string[]) => {
    const { action, target_ref } = record.request;
    if (action !== "project.create" && action !== "project.members.set" && action !== "project.update") return;
    const projectID = action === "project.create" ? result[0] : target_ref;
    const project = collaboration.project(session, projectID);
    for (const recipient of collaboration.recipients(projectID)) notifications.event({ scope: projectID, recipient, event: record.preview.preview_ref, category: "project_assignment", title: `项目「${project.name}」的共享设置已更新`, path: `/projects?sharedProject=${encodeURIComponent(projectID)}` });
  };

  const sign = (payload: any) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return (
      body +
      "." +
      createHmac("sha256", cursorKey).update(body).digest("base64url")
    );
  };
  const cursor = (
    raw: string | null,
    fp: string,
  ): Record<string, string | null> => {
    if (!raw) return {};
    if (raw.length > 16000) throw new AuthError("cursor_invalid", 400);
    const [b, m, ...rest] = raw.split(".");
    const mac = createHmac("sha256", cursorKey).update(b).digest("base64url");
    if (
      rest.length ||
      !m ||
      m.length !== mac.length ||
      !timingSafeEqual(Buffer.from(m), Buffer.from(mac))
    )
      throw new AuthError("cursor_invalid", 400);
    let p;
    try {
      p = JSON.parse(Buffer.from(b, "base64url").toString());
    } catch {
      throw new AuthError("cursor_invalid", 400);
    }
    if (p.fp !== fp || p.expires < Date.now())
      throw new AuthError("cursor_expired", 409);
    return p.cursors;
  };
  const failure = (owner: Owner, e: unknown): Coverage => ({
    owner,
    state:
      e instanceof AuthError && e.status === 403
        ? "forbidden"
        : e instanceof AuthError && e.code.includes("contract")
          ? "needs_contract"
          : "unavailable",
    observed_at: new Date().toISOString(),
    reason: e instanceof AuthError ? e.code : "source_unavailable",
  });
  const services: ControlServices = { config, db, auth, tasks, openTools, notifications, state: controlStateOf(db), clock: deps.clock ?? Date.now };
  /**
   * Refused sign-ins are the visitor's own text and anyone may send them, so they are written sparingly. The name is recorded
   * only when it is exactly a configured account (otherwise `(unknown)`: it may be a key pasted into the wrong box). A bucket of
   * the sign-in limits that a refusal filled is noted once, in the row of that refusal, and the attempts the full bucket then
   * turns away (429) are not written at all. Failures that need no wrong credential to trigger, such as a missing credential file,
   * are written at most once a minute per error code.
   */
  const loginAuditSeen = new Map<string, number>();
  const auditLogin = (username: string | undefined, e: unknown) => {
    const refused = e instanceof AuthError && e.status === 401;
    const actor = auth.auditName(username);
    for (const bucket of (e as { trips?: string[] }).trips ?? [])
      audit.record({ actor, action: "auth.login", meta: { mode: "personal", bucket } }, "denied", "login_rate_limited");
    if (e instanceof AuthError && e.status === 429) return;
    if (!refused) {
      const code = auditError(e);
      const now = Date.now();
      if (now - (loginAuditSeen.get(code) ?? -Infinity) < 60_000) return;
      loginAuditSeen.set(code, now);
    }
    audit.record({ actor, action: "auth.login", meta: { mode: "personal" } }, refused ? "denied" : "failed", auditError(e));
  };
  /** `info.peer` is the address of the connection the request arrived on, which only the server entry knows. */
  const handle = async (r: Request, info: { peer?: string } = {}): Promise<Response> => {
    try {
      const url = new URL(r.url),
        path = url.pathname.slice(prefix.length);
      if (!url.pathname.startsWith(prefix + "/"))
        return json({ error: "not_found" }, 404);
      if (
        (url.origin !== config.origin ||
          (r.headers.has("origin") && r.headers.get("origin") !== config.origin))
      )
        throw new AuthError("origin_denied", 403);
      if (config.read_only && !readOnlyRequestAllowed(r.method, path))
        throw new AuthError("read_only_run", 403);
      if (r.method === "GET" && path === "/health")
        return json({ status: "ok", service: "yeisme-control-center" });
      if (r.method === "POST" && path === "/auth/personal") {
        const raw = await r.text();
        if (raw.length > 2048)
          throw new AuthError("invalid_login_request", 400);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          throw new AuthError("invalid_login_request", 400);
        }
        if (
          !body ||
          (typeof body.password !== "string" && typeof body.key !== "string") ||
          (body.password !== undefined && typeof body.password !== "string") ||
          (body.key !== undefined && typeof body.key !== "string") ||
          (body.username !== undefined && (typeof body.username !== "string" || body.username.length > 80)) ||
          typeof body.remember !== "undefined" && typeof body.remember !== "boolean" ||
          Object.keys(body).some((k) => !["password", "key", "username", "remember"].includes(k))
        )
          throw new AuthError("invalid_login_request", 400);
        // A secret longer than a key or a password can be never matches anything, and the password check turns it away without any
        // work. It is not a guess at a credential, so it is refused here, before anything is counted: counted, it would let one
        // client fill the limits at no cost (the username is held to 80 characters above, the whole request to 2048).
        const secretValue: string = body.key || body.password;
        if (Buffer.byteLength(secretValue) > maxSecretBytes)
          throw new AuthError("invalid_login_request", 400);
        try {
          const result = await auth.personalLogin(r, secretValue, body.username, clientAddress(info.peer, r.headers.get("x-forwarded-for")), body.remember === true);
          audit.record(
            {
              actor: typeof body.username === "string" ? body.username : "owner",
              action: "auth.login",
              meta: { mode: "personal" },
            },
            "succeeded",
          );
          return json({ ok: true }, 200, { "Set-Cookie": result.cookie });
        } catch (e) {
          auditLogin(body.username, e);
          throw e;
        }
      }
      if (r.method === "POST" && path === "/auth/invite") {
        const raw = await r.text();
        if (raw.length > 2048) throw new AuthError("invalid_login_request", 400);
        const body = jsonObject<Record<string, unknown>>(raw, "invalid_login_request");
        if (typeof body.token !== "string" || !body.token.trim() || Object.keys(body).some((k) => k !== "token")) {
          throw new AuthError("invalid_login_request", 400);
        }
        if (Buffer.byteLength(body.token) > maxSecretBytes) {
          throw new AuthError("invalid_login_request", 400);
        }
        try {
          const redeemed = auth.redeemPersonalInvite(
            r,
            body.token,
            clientAddress(info.peer, r.headers.get("x-forwarded-for")),
          );
          audit.record(
            {
              actor: redeemed.invite.username,
              action: "auth.invite_redeemed",
              targetRef: redeemed.invite.id,
              meta: { mode: "invite" },
            },
            "succeeded",
          );
          return json({ ok: true, username: redeemed.invite.username }, 200, { "Set-Cookie": redeemed.cookie });
        } catch (e) {
          audit.record(
            {
              actor: "(invite)",
              action: "auth.invite_redeemed",
              meta: { mode: "invite" },
            },
            e instanceof AuthError && e.status === 403 ? "denied" : "failed",
            auditError(e),
          );
          throw e;
        }
      }
      if (r.method === "GET" && path === "/auth/methods") {
        // Whether the sign-in asks for a username and a key depends on the account list, which personal-config may have changed.
        auth.refreshPersonalUsers();
        return json({
          personal: config.auth_mode === "personal" && !!config.personal,
          username_required: !!config.personal && ((config.personal.users?.length || 0) > 0 || config.personal.username !== undefined),
          key_required: !!config.personal && (config.personal.users?.length || 0) > 0,
          oidc: config.auth_mode !== "personal" && !!config.oidc,
          mode: "live",
          owners: [...owners, ...(config.collection?.auctra ? ["auctra"] : [])].map((owner) => ({
            owner,
            configured: owner === "auctra" ? !!config.collection?.auctra : !!config.owners[owner as Owner],
          })),
        });
      }
      if (r.method === "GET" && path === "/auth/login") {
        const b = await auth.begin();
        return new Response(null, {
          status: 302,
          headers: {
            Location: b.url,
            "Set-Cookie": b.cookie,
            "Cache-Control": "no-store",
          },
        });
      }
      if (r.method === "GET" && path === "/auth/callback") {
        try {
          const b = await auth.callback(r);
          audit.record(
            { actor: "oidc:callback", action: "auth.login", meta: { mode: "oidc" } },
            "succeeded",
          );
          const h = new Headers({ Location: "/", "Cache-Control": "no-store" });
          h.append("Set-Cookie", b.cookie);
          h.append("Set-Cookie", b.clear);
          return new Response(null, { status: 302, headers: h });
        } catch (e) {
          audit.record(
            { actor: "oidc:callback", action: "auth.login", meta: { mode: "oidc" } },
            e instanceof AuthError && e.status === 403 ? "denied" : "failed",
            auditError(e),
          );
          throw e;
        }
      }
      const session = auth.current(r);
      if (r.method === "GET" && path === "/session") {
        const p = auth.principal(session)!;
        return json({
          name: session.name,
          username: session.personal ? session.subject : undefined,
          role: auth.role(session),
          identity: session.issuer + "|" + session.subject,
          csrf: session.csrf,
          epoch: session.epoch,
          scopes: [...p.scopes, ...collaboration.list(session).map((project) => collaboration.scope(session, project.id))].map(({ owners: bindings, collection, read_context: _context, ...scope }) => ({
            ...scope,
            owners: [...Object.keys(bindings), ...Object.keys(collection || {})],
          })),
          mode: "live",
          task_connections: session.personal === true,
          own_key: session.personal ? auth.ownKeyState(session) : undefined,
          collaboration_organizations: collaboration.organizations(session),
          shared_projects: collaboration.list(session),
        });
      }
      if (path === "/observation/status") {
        if (r.method !== "GET") return methodNotAllowed(["GET"]);
        // Background observation reads connection data with the server's own credentials, so, like tasks, only personal
        // sessions ask about it; any role may. This answers from memory and config and never calls an owner.
        if (!session.personal) throw new AuthError("personal_connection_required", 403);
        const wanted = url.searchParams.get("scope");
        const scopes = (auth.principal(session)?.scopes || []).filter((candidate) => !wanted || candidate.id === wanted);
        if (wanted && !scopes.length) throw new AuthError("scope_not_found", 404);
        return json(withEpoch(session, observationStatus(services, identityOf(session), scopes.map((candidate) => candidate.id), wanted ?? undefined)));
      }
      // A person resets their own key: any role, own account only, and only with the current key in hand.
      if (path === "/account/rotate-key") {
        if (r.method !== "POST") return methodNotAllowed(["POST"]);
        if (!session.personal) throw new AuthError("personal_connection_required", 403);
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 2048) throw new AuthError("invalid_request", 400);
        const body = jsonObject<Record<string, unknown>>(raw, "invalid_request");
        if (typeof body.current_key !== "string" || Object.keys(body).some((key) => key !== "current_key")) throw new AuthError("invalid_request", 400);
        const rotated = await audited({
          actor: session.issuer + "|" + session.subject,
          sessionId: session.id,
          action: "account.key_rotated",
          targetRef: session.subject,
        }, () => auth.rotateOwnKey(session, body.current_key as string));
        return json(rotated);
      }
      // Every account route is matched whole: the collection, one username, and its revoke, enable and rotate. Anything else under the prefix is unknown.
      const revoke = path.match(/^\/admin\/personal-users\/([^/]+)\/revoke$/);
      const userAction = path.match(/^\/admin\/personal-users\/([^/]+)\/(enable|rotate)$/);
      const userPath = path.match(/^\/admin\/personal-users\/([^/]+)$/);
      if (path === "/admin/personal-users" || revoke || path.startsWith("/admin/personal-users/")) {
        if (!session.personal || auth.role(session) !== "admin") throw new AuthError("control_center_admin_required", 403);
        if (path === "/admin/personal-users") {
          if (r.method === "GET") return json({ users: auth.listPersonalUsers(), management: auth.accountManagement(), scopes: auth.assignableScopes() });
          if (r.method !== "POST") return methodNotAllowed(["GET", "POST"]);
          auth.csrf(r, session);
          const raw = await r.text();
          if (raw.length > 4096) throw new AuthError("invalid_request", 400);
          const body = jsonObject<Record<string, any>>(raw, "invalid_request");
          if (
            typeof body.username !== "string" ||
            typeof body.name !== "string" ||
            !["admin", "viewer"].includes(body.role) ||
            !Array.isArray(body.scope_ids) ||
            body.scope_ids.some((id: unknown) => typeof id !== "string") ||
            (body.issue_invite_ttl_hours !== undefined && (typeof body.issue_invite_ttl_hours !== "number" || !Number.isFinite(body.issue_invite_ttl_hours))) ||
            Object.keys(body).some((key) => !["username", "name", "role", "scope_ids", "issue_invite_ttl_hours"].includes(key))
          ) throw new AuthError("invalid_request", 400);
          const actor = session.issuer + "|" + session.subject;
          const created = await audited({
            actor,
            sessionId: session.id,
            action: "admin.user_created",
            targetRef: body.username,
          }, async () => {
            if (auth.firstAccountLocksOutOwner()) throw new AuthError("owner_username_required", 409);
            const res = await auth.createPersonalUser({ username: body.username, name: body.name, role: body.role, scope_ids: body.scope_ids });
            if (body.issue_invite_ttl_hours !== undefined) {
              const issued = auth.createPersonalInvite({
                username: body.username,
                label: "首次加入邀请",
                ttlHours: body.issue_invite_ttl_hours,
                createdBy: session.subject,
              });
              audit.record({ actor, sessionId: session.id, action: "admin.invite_created", targetRef: issued.invite.id, meta: { username: body.username } }, "succeeded");
              return { ...res, invite: issued.invite, invite_token: issued.token };
            }
            return res;
          });
          return json(created, 201);
        }
        const actor = session.issuer + "|" + session.subject;
        if (userAction) {
          if (r.method !== "POST") return methodNotAllowed(["POST"]);
          auth.csrf(r, session);
          const username = pathParam(userAction[1]);
          if (userAction[2] === "enable") {
            await audited({ actor, sessionId: session.id, action: "admin.user_enabled", targetRef: username }, () => auth.enablePersonalUser(username));
            return json({ ok: true });
          }
          const rotated = await audited({ actor, sessionId: session.id, action: "admin.user_rotated", targetRef: username }, () => auth.rotatePersonalUserKey(username));
          // The new key is in this response and nowhere else: `json` marks it no-store, and nothing logs it.
          return json(rotated);
        }
        if (userPath) {
          if (r.method !== "PATCH") return methodNotAllowed(["PATCH"]);
          auth.csrf(r, session);
          const username = pathParam(userPath[1]);
          const raw = await r.text();
          if (raw.length > 4096) throw new AuthError("invalid_request", 400);
          const body = jsonObject<Record<string, any>>(raw, "invalid_request");
          if (typeof body.if_match !== "string" || Object.keys(body).some((key) => !["name", "role", "scope_ids", "if_match"].includes(key))
            || (body.name !== undefined && typeof body.name !== "string")
            || (body.role !== undefined && !["admin", "viewer"].includes(body.role))
            || (body.scope_ids !== undefined && (!Array.isArray(body.scope_ids) || body.scope_ids.some((id: unknown) => typeof id !== "string")))) throw new AuthError("invalid_request", 400);
          const changed = Object.keys(body).filter((key) => key !== "if_match").sort().join(",");
          const user = await audited({ actor, sessionId: session.id, action: "admin.user_updated", targetRef: username, meta: { fields: changed } }, () => auth.updatePersonalUser(session.subject, username, { name: body.name, role: body.role, scope_ids: body.scope_ids }, body.if_match));
          return json({ user });
        }
        if (!revoke) throw new AuthError("not_found", 404);
        if (r.method !== "POST") return methodNotAllowed(["POST"]);
        auth.csrf(r, session);
        const username = pathParam(revoke[1]);
        await audited({
          actor,
          sessionId: session.id,
          action: "admin.user_revoked",
          targetRef: username,
        }, () => auth.revokePersonalUser(username, session.subject));
        return json({ ok: true });
      }
      const inviteRevoke = path.match(/^\/admin\/personal-invites\/([^/]+)\/revoke$/);
      if (path === "/admin/personal-invites" || inviteRevoke || path.startsWith("/admin/personal-invites/")) {
        if (!session.personal || auth.role(session) !== "admin") throw new AuthError("control_center_admin_required", 403);
        const actor = session.issuer + "|" + session.subject;
        if (path === "/admin/personal-invites") {
          if (r.method === "GET") {
            const username = url.searchParams.get("username") || undefined;
            if (username !== undefined && username.length > 80) throw new AuthError("invalid_request", 400);
            return json({ invites: auth.listPersonalInvites(username) });
          }
          if (r.method !== "POST") return methodNotAllowed(["GET", "POST"]);
          auth.csrf(r, session);
          const raw = await r.text();
          if (raw.length > 2048) throw new AuthError("invalid_request", 400);
          const body = jsonObject<Record<string, unknown>>(raw, "invalid_request");
          if (
            typeof body.username !== "string" ||
            !body.username ||
            (body.label !== undefined && (typeof body.label !== "string" || body.label.length > 120)) ||
            (body.ttl_hours !== undefined && (typeof body.ttl_hours !== "number" || !Number.isFinite(body.ttl_hours))) ||
            Object.keys(body).some((k) => !["username", "label", "ttl_hours"].includes(k))
          ) {
            throw new AuthError("invalid_request", 400);
          }
          const created = await audited(
            { actor, sessionId: session.id, action: "admin.invite_created", targetRef: body.username },
            async () =>
              auth.createPersonalInvite({
                username: body.username as string,
                label: body.label as string | undefined,
                ttlHours: body.ttl_hours as number | undefined,
                createdBy: session.subject,
              }),
          );
          return json({ invite: created.invite, invite_token: created.token }, 201);
        }
        if (!inviteRevoke) throw new AuthError("not_found", 404);
        if (r.method !== "POST") return methodNotAllowed(["POST"]);
        auth.csrf(r, session);
        const inviteId = pathParam(inviteRevoke[1]);
        const revoked = await audited(
          { actor, sessionId: session.id, action: "admin.invite_revoked", targetRef: inviteId },
          async () => auth.revokePersonalInvite(inviteId),
        );
        return json({ invite: revoked });
      }
      if (r.method === "GET" && path === "/audit") {
        if (auth.role(session) !== "admin")
          throw new AuthError("control_center_admin_required", 403);
        const before = url.searchParams.get("before"),
          limit = Number(url.searchParams.get("limit") || 50),
          action = url.searchParams.get("action") || undefined,
          outcome = url.searchParams.get("outcome") || undefined,
          actor = url.searchParams.get("actor") || undefined,
          from = url.searchParams.get("from") || undefined,
          to = url.searchParams.get("to") || undefined;
        const day = /^\d{4}-\d{2}-\d{2}$/;
        if (
          (before !== null && !/^\d{1,16}$/.test(before)) ||
          ![25, 50, 100].includes(limit) ||
          (action !== undefined &&
            !auditActions.includes(action as AuditAction)) ||
          (outcome !== undefined && !["initiated", "succeeded", "denied", "failed", "unavailable"].includes(outcome)) ||
          (actor !== undefined && actor.length > 320) ||
          (from !== undefined && (!day.test(from) || Number.isNaN(Date.parse(from)))) ||
          (to !== undefined && (!day.test(to) || Number.isNaN(Date.parse(to))))
        )
          throw new AuthError("invalid_query", 400);
        return json(
          audit.page({
            before: before ? Number(before) : undefined,
            limit,
            action,
            outcome,
            actor,
            from,
            to,
          }),
        );
      }
      if (r.method === "POST" && path === "/auth/logout") {
        auth.csrf(r, session);
        audit.record(
          {
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            action: "auth.logout",
          },
          "succeeded",
        );
        auth.sessions.delete(session.id);
        return json({ ok: true }, 200, { "Set-Cookie": auth.cookie("", 0) });
      }
      if (r.method === "GET" && path === "/organizations") return json(withEpoch(session, { rows: collaboration.organizations(session), can_create: auth.role(session) === "admin" }));
      const orgRoute = path.match(/^\/organizations\/([^/]+)\/(members|teams|candidates|binding-options)$/);
      if (r.method === "GET" && orgRoute) {
        const org = pathParam(orgRoute[1]);
        if (orgRoute[2] === "candidates") return json(withEpoch(session, { rows: collaboration.candidates(session, org) }));
        if (orgRoute[2] === "binding-options") return json(withEpoch(session, { rows: collaboration.bindingOptions(session, org) }));
        const directory = collaboration.directory(session, org);
        return json(withEpoch(session, { rows: orgRoute[2] === "teams" ? directory.teams : directory.members }));
      }
      if (r.method === "GET" && path === "/projects") {
        const query = url.searchParams.get("q")?.trim().toLocaleLowerCase() || "";
        if (query.length > 200) throw new AuthError("invalid_query", 400);
        const rows = collaboration.list(session, url.searchParams.get("organization") || undefined).filter((p) => (!query || `${p.name} ${p.id}`.toLocaleLowerCase().includes(query)) && (url.searchParams.get("hidden") === "1" ? p.hidden : !p.hidden));
        return json(withEpoch(session, { rows, coverage: "complete", total: rows.length, next_cursor: null }));
      }
      const itemTask = path.match(/^\/projects\/([^/]+)\/items\/([^/]+)\/task$/);
      if (r.method === "GET" && itemTask) {
        const projectID = pathParam(itemTask[1]);
        const item = collaboration.item(session, projectID, pathParam(itemTask[2]));
        if (!item.source?.connection || !item.source.project || !item.source.family || !item.source.ref) throw new AuthError("item_source_unavailable", 409);
        return json(withEpoch(session, await tasks.resolve(collaboration.scope(session, projectID), item.source)));
      }
      const batchRoute = path.match(/^\/projects\/([^/]+)\/generation-batches\/([^/]+)$/);
      if (r.method === "GET" && batchRoute) {
        const projectID = pathParam(batchRoute[1]);
        const batchID = pathParam(batchRoute[2]);
        // A project the session cannot see and a batch that is not in it answer alike.
        let stored;
        try { stored = collaboration.batch(session, projectID, batchID); }
        catch (error) { if (error instanceof AuthError && (error.status === 403 || error.status === 404)) throw new AuthError("generation_batch_not_found", 404); throw error; }
        if (!stored) throw new AuthError("generation_batch_not_found", 404);
        const observed = await generationBatches.observeBatches(session, projectID, [stored]);
        announceBatches(projectID, changed([stored], observed.rows));
        return json(withEpoch(session, { batch: observed.rows[0], coverage: observed.sources.some((source) => source.state !== "ready") ? "partial" : "complete", observed_at: new Date().toISOString(), sources: observed.sources }));
      }
      const referenceBindingsRoute = path.match(/^\/projects\/([^/]+)\/reference-bindings$/);
      if (r.method === "GET" && referenceBindingsRoute) {
        const projectID = pathParam(referenceBindingsRoute[1]);
        const project = collaboration.project(session, projectID);
        const ownerParam = url.searchParams.get("owner") || "";
        const kindParam = url.searchParams.get("kind") || "";
        const q = url.searchParams.get("q") || "";
        const cursorValue = url.searchParams.get("cursor") || "";
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit ? Number(rawLimit) : 20;
        if (ownerParam && !referenceBindingOwners.includes(ownerParam as (typeof referenceBindingOwners)[number])) throw new AuthError("invalid_reference_owner", 400);
        if (kindParam && !referenceBindingKinds.includes(kindParam as (typeof referenceBindingKinds)[number])) throw new AuthError("invalid_reference_kind", 400);
        if (q.length > 200 || /[\x00-\x1f]/.test(q) || cursorValue.length > 1024 || /[\x00-\x1f]/.test(cursorValue) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AuthError("invalid_query", 400);
        const selectedOwners = ownerParam ? [ownerParam as (typeof referenceBindingOwners)[number]] : [...referenceBindingOwners];
        const sources = selectedOwners.flatMap<ReferenceBindingSource>((owner) => {
          const bindings = project.bindings.filter((binding) => binding.owner === owner);
          return bindings.length
            ? bindings.map((binding) => ({ owner, project_ref: binding.project_ref, state: "needs_contract" as const, reason: "reference_binding_contract_not_configured" }))
            : [{ owner, project_ref: null, state: "needs_contract" as const, reason: "reference_binding_project_not_bound" }];
        });
        return json(withEpoch(session, { schema_version: "yeisme.reference_binding.page.v1" as const, rows: [], next_cursor: null, coverage: "unknown" as const, availability: "needs_contract" as const, sources }));
      }
      const referenceBindingAccessRoute = path.match(/^\/projects\/([^/]+)\/reference-bindings\/([^/]+)\/access$/);
      if (r.method === "POST" && referenceBindingAccessRoute) {
        const projectID = pathParam(referenceBindingAccessRoute[1]);
        collaboration.project(session, projectID);
        const bindingRef = pathParam(referenceBindingAccessRoute[2]);
        if (!bindingRef || bindingRef.length > 512 || /[\\/\x00-\x1f]/.test(bindingRef)) throw new AuthError("invalid_reference", 400);
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 2048) throw new AuthError("invalid_reference_access", 400);
        const body = jsonObject<ReferenceBindingAccessRequest>(raw, "invalid_reference_access");
        if (Object.keys(body).some((key) => !["purpose", "expected_revision", "expected_digest"].includes(key)) || !["thumbnail", "preview"].includes(body.purpose) || typeof body.expected_revision !== "string" || !body.expected_revision || body.expected_revision.length > 160 || !/^sha256:[a-f0-9]{64}$/.test(body.expected_digest)) throw new AuthError("invalid_reference_access", 400);
        throw new AuthError("needs_contract", 422);
      }
      if (r.method === "GET") {
        const bindingRead = projectCollectionRead(path, session, collaboration);
        if (bindingRead) return json(withEpoch(session, bindingRead));
      }
      const sharedRoute = path.match(/^\/projects\/([^/]+)(?:\/(members|bindings|folders|items|generation-batches))?$/);
      if (r.method === "GET" && sharedRoute) {
        const projectID = pathParam(sharedRoute[1]);
        const project = collaboration.project(session, projectID);
        const kind = sharedRoute[2];
        if (!kind) return json(withEpoch(session, project));
        if (kind === "members") { collaboration.project(session, projectID, "project_admin"); return json(withEpoch(session, { rows: project.grants })); }
        if (kind === "bindings") return json(withEpoch(session, { rows: project.bindings }));
        if (kind === "folders") return json(withEpoch(session, { rows: collaboration.folders(session, projectID) }));
        if (kind === "generation-batches") {
          const query = parseBatchQuery(url.searchParams);
          // The cursor is bound to who reads, the session epoch, the project and its revision, and every filter.
          const fp = createHash("sha256").update(JSON.stringify([identityOf(session), session.epoch, projectID, project.revision, project.role, query])).digest("hex");
          const position = cursor(url.searchParams.get("cursor"), fp) as Record<string, string>;
          const after = position.created_at && position.id ? { created_at: position.created_at, id: position.id } : undefined;
          const page = collaboration.batchPage(session, projectID, query, after);
          const observed = await generationBatches.observeBatches(session, projectID, page.rows);
          announceBatches(projectID, changed(page.rows, observed.rows));
          return json(withEpoch(session, {
            rows: observed.rows,
            next_cursor: page.next ? sign({ fp, expires: Date.now() + 900000, cursors: page.next }) : null,
            total: page.total,
            coverage: observed.sources.some((source) => source.state !== "ready") ? "partial" : "complete",
            observed_at: new Date().toISOString(),
            sources: observed.sources,
          }));
        }
        const query = Object.fromEntries(url.searchParams.entries()) as DirectoryQuery;
        query.limit = Number(url.searchParams.get("limit") || 50);
        // Folder covers only paint rows already stored. They must not list or sync owner tasks.
        if (url.searchParams.get("local") === "1") {
          if (url.searchParams.has("source_cursor") || url.searchParams.has("cursor")) throw new AuthError("local_page_not_pageable", 400);
          delete query.local;
          const page = collaboration.items(session, projectID, query);
          // A truncated cover must not report the filtered table count as rows read.
          const truncated = page.next_cursor !== null;
          return json(withEpoch(session, { ...page, total: truncated ? page.rows.length : page.total, next_cursor: null, next_source_cursor: null, coverage: truncated ? "partial" : "complete", sources: [] }));
        }
        const projectScope = collaboration.scope(session, projectID);
        const sourceFP = createHash("sha256").update(JSON.stringify([identityOf(session), session.epoch, projectID, "item_sources"])).digest("hex");
        const sourceCursors = cursor(url.searchParams.get("source_cursor"), sourceFP) as Record<string, string>;
        const observed = await tasks.list(projectScope, "history", sourceCursors);
        collaboration.syncItems(session, projectID, observed.rows);
        const filterFP = createHash("sha256").update(JSON.stringify([identityOf(session), session.epoch, projectID, { ...query, cursor: undefined, source_cursor: undefined, local: undefined }])).digest("hex");
        query.cursor = cursor(url.searchParams.get("cursor"), filterFP).after || undefined;
        const page = collaboration.items(session, projectID, query);
        return json(withEpoch(session, { ...page, next_cursor: page.next_cursor ? sign({ fp: filterFP, expires: Date.now() + 900000, cursors: { after: page.next_cursor } }) : null, next_source_cursor: Object.keys(observed.next_cursors || {}).length ? sign({ fp: sourceFP, expires: Date.now() + 900000, cursors: observed.next_cursors }) : null, coverage: project.bindings.length > 0 && !Object.keys(projectScope.owners).length ? "unknown" : observed.connections.every((c) => c.state === "ready") && !Object.keys(observed.next_cursors || {}).length && !url.searchParams.has("source_cursor") ? "complete" : "partial", sources: observed.connections }));
      }
      const scope = scoped(session, url.searchParams.get("scope"));
      const collectionScope = collectionIndexScope(scope);
      if (path === "/prompt-collections" && r.method === "GET") return json(promptCollectionsStore.list(scope.id));
      if (path === "/prompts" && r.method === "GET") {
        const owner = url.searchParams.get("owner") || "all";
        if (owner !== "all" && !promptOwners.includes(owner as PromptOwner)) throw new AuthError("invalid_prompt_owner", 400);
        const query: PromptQuery = {};
        for (const key of ["q", "kind", "source", "tag", "archived", "cursor", "model", "from", "to"] as const) {
          const value = url.searchParams.get(key) || "";
          if (value.length > (key === "cursor" ? 1024 : 200) || /[\x00-\x1f]/.test(value)) throw new AuthError("invalid_query", 400);
          if (value) query[key] = value;
        }
        if (owner === "all" && query.cursor) throw new AuthError("prompt_cursor_requires_owner", 400);
        query.limit = 50;
        const selected = owner === "all" ? promptOwners : [owner as PromptOwner];
        const pages = await Promise.all(selected.map(async (source) => {
          try {
            const page = await readers.promptLibrary(source, session, scope, query);
            if (!("rows" in page)) throw new AuthError("prompt_contract_invalid", 502);
            return { rows: page.rows!, source: { owner: source, project: page.project, state: "ready", total: page.total, next_cursor: page.next_cursor, index_more: page.index_more, history_state: page.index_more ? "incomplete" as const : "complete" as const, can_write: page.can_write } };
          } catch (error) {
            const code = error instanceof AuthError ? error.code : "owner_unavailable";
            return { rows: [], source: { owner: source, state: error instanceof AuthError && error.status === 403 ? "forbidden" : code === "needs_contract" || code === "source_not_configured" ? "needs_contract" : "unavailable", history_state: code === "needs_contract" || code === "source_not_configured" ? "needs_contract" as const : "unknown" as const, reason: code } };
          }
        }));
        const collection = url.searchParams.get("collection");
        const links = collection ? promptCollectionsStore.list(scope.id).links.filter(link => link.collection_id === collection) : null;
        const rows = pages.flatMap(p => p.rows).filter(row => !links || links.some(link => link.owner === row.owner && link.project === row.project && link.id === row.id));
        return json(withEpoch(session, { rows: rows.sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)), sources: pages.map(p => p.source) }));
      }
      const promptReconcile = path.match(/^\/prompts\/operations\/([^/]+)\/reconcile$/);
      if (promptReconcile && r.method === "POST") {
        auth.csrf(r, session);
        const ref = pathParam(promptReconcile[1]), record = actions.record(ref, identityOf(session), scope.id);
        if (record.request.action !== "prompts.save" || !promptOwners.includes(record.request.owner as PromptOwner)) throw new AuthError("invalid_prompt_operation", 400);
        authorizeAction(session, record.request.action, scope);
        const result = await audited({ actor: identityOf(session), sessionId: session.id, scopeId: scope.id, action: "actions.receipt_read", owner: record.request.owner, targetRef: ref }, async () => readers.promptLibrary(record.request.owner as PromptOwner, session, scope, {}, "reconcile", record.request.idempotency_key));
        if (!("summary" in result) || !result.summary) return json({ state: "unknown", reason: "original_operation_not_observed", preview_ref: ref });
        return json(actions.reconcilePrompt(ref, scope.id, identityOf(session), result.summary.id));
      }
      const promptRead = path.match(/^\/prompts\/(eikona|sonora|scaena)\/([^/]+)\/(content:read|index)$/);
      if (promptRead && r.method === "POST") {
        auth.csrf(r, session);
        const owner = promptRead[1] as PromptOwner, id = pathParam(promptRead[2]), indexing = promptRead[3] === "index";
        const raw = await r.text();
        if (raw.length > 1024) throw new AuthError("invalid_content_request", 400);
        const body = jsonObject<{ version?: number }>(raw || "{}", "invalid_content_request");
        if (Object.keys(body).some(k => k !== "version") || (body.version !== undefined && (!Number.isInteger(body.version) || body.version < 1))) throw new AuthError("invalid_content_request", 400);
        const result = await audited({ actor: identityOf(session), sessionId: session.id, scopeId: scope.id, action: indexing ? "prompts.index" : "prompts.content_read", owner, targetRef: id, purpose: indexing ? "Index existing business prompts" : "Review prompt in library" }, async () => readers.promptLibrary(owner, session, scope, {}, indexing ? "index" : "content", indexing ? "" : id, { purpose: "Review prompt in library", version: body.version || 0 }));
        return json(result);
      }
      if (path === "/prompt-recipes" && r.method === "GET") {
        const owner = url.searchParams.get("owner") || undefined;
        const kind = url.searchParams.get("kind") || undefined;
        const state = url.searchParams.get("state") || undefined;
        const source = url.searchParams.get("source") || undefined;
        const tag = url.searchParams.get("tag") || undefined;
        const collection = url.searchParams.get("collection") || undefined;
        const q = url.searchParams.get("q") || undefined;
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit ? Number(rawLimit) : 20;
        if ((owner && !promptOwners.includes(owner as PromptOwner)) || (kind && !["image", "video", "speech", "music", "sfx"].includes(kind)) || (state && !["draft", "active", "archived", "superseded", "blocked"].includes(state)) || (source && !["history", "owner_asset", "manual", "catalog"].includes(source)) || (q && (q.length > 200 || /[\x00-\x1f]/.test(q))) || (tag && (tag.length > 80 || /[\x00-\x1f]/.test(tag))) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AuthError("invalid_prompt_recipe_query", 400);
        const query: PromptRecipeQuery = { ...(owner ? { owner: owner as PromptOwner } : {}), ...(kind ? { kind: kind as PromptRecipeQuery["kind"] } : {}), ...(state ? { state: state as PromptRecipeQuery["state"] } : {}), ...(source ? { source: source as PromptRecipeQuery["source"] } : {}), ...(tag ? { tag } : {}), ...(collection ? { collection } : {}), ...(q ? { q } : {}), limit };
        const fp = createHash("sha256").update(JSON.stringify([identityOf(session), session.epoch, scope.id, query])).digest("hex");
        const position = cursor(url.searchParams.get("cursor"), fp) as Record<string, string>;
        const page = promptRecipesStore.list(scope.id, query, position.updated_at && position.id ? { updated_at: position.updated_at, id: position.id } : undefined);
        return json(withEpoch(session, { schema_version: "yeisme.prompt_recipe.page.v1" as const, rows: page.rows, total: page.total, next_cursor: page.next ? sign({ fp, expires: Date.now() + 900000, cursors: page.next }) : null, coverage: "complete" as const }));
      }
      const recipeRoute = path.match(/^\/prompt-recipes\/([^/]+)$/);
      if (recipeRoute && r.method === "GET") {
        const recipe = promptRecipesStore.get(scope.id, pathParam(recipeRoute[1]));
        return json(withEpoch(session, { recipe }));
      }
      const recipeVersions = path.match(/^\/prompt-recipes\/([^/]+)\/versions$/);
      if (recipeVersions && r.method === "GET") return json(withEpoch(session, { rows: promptRecipesStore.versions(scope.id, pathParam(recipeVersions[1])) }));
      const recipeUse = path.match(/^\/prompt-recipes\/([^/]+)\/use-preview$/);
      if (recipeUse && r.method === "POST") {
        auth.csrf(r, session);
        const recipe = promptRecipesStore.get(scope.id, pathParam(recipeUse[1]));
        const raw = await r.text();
        if (raw.length > 2048) throw new AuthError("invalid_prompt_recipe_use", 400);
        const body = jsonObject<{ target_owner?: PromptOwner; target_project_ref?: string; expected_revision?: number }>(raw || "{}", "invalid_prompt_recipe_use");
        if (Object.keys(body).some((key) => !["target_owner", "target_project_ref", "expected_revision"].includes(key)) || !promptOwners.includes(body.target_owner as PromptOwner) || typeof body.target_project_ref !== "string" || !body.target_project_ref || !Number.isInteger(body.expected_revision)) throw new AuthError("invalid_prompt_recipe_use", 400);
        const result: PromptRecipeUsePreview = { schema_version: "yeisme.prompt_recipe.use_preview.v1", recipe_ref: recipe.recipe_ref, recipe_revision: recipe.revision, owner: recipe.owner, project_ref: recipe.project_ref, owner_version: recipe.source.owner_version || null, prompt_ref: recipe.source.owner_prompt_ref || null, source_digest: recipe.source.source_digest || null, availability: "available", blockers: [] };
        if (body.expected_revision !== recipe.revision) { result.availability = "blocked"; result.blockers.push("prompt_recipe_revision_conflict"); }
        if (body.target_owner !== recipe.owner || body.target_project_ref !== recipe.project_ref) { result.availability = "blocked"; result.blockers.push("prompt_recipe_scope_mismatch"); }
        if (!recipeProjectInScope(scope, recipe.owner, recipe.project_ref)) { result.availability = "blocked"; result.blockers.push("prompt_recipe_project_not_bound"); }
        if (recipe.owner === "scaena") { result.availability = "needs_contract"; result.blockers.push("owner_prompt_contract_missing"); }
        if (recipe.content_state !== "readable") { result.availability = recipe.content_state === "needs_contract" ? "needs_contract" : "blocked"; result.blockers.push(`prompt_recipe_content_${recipe.content_state}`); }
        if (!result.prompt_ref) { result.availability = "blocked"; result.blockers.push("prompt_recipe_source_ref_missing"); }
        if (!result.owner_version) { result.availability = "blocked"; result.blockers.push("prompt_recipe_source_version_missing"); }
        if (!result.source_digest) { result.availability = "blocked"; result.blockers.push("prompt_recipe_source_digest_missing"); }
        if (recipe.owner === "scaena" && !result.blockers.includes("prompt_recipe_revision_conflict") && !result.blockers.includes("prompt_recipe_scope_mismatch")) result.availability = "needs_contract";
        return json(withEpoch(session, result));
      }
      if (r.method === "GET" && path === "/creative-flow") {
        const episode_ref = url.searchParams.get("episode_ref") || undefined;
        const breakdown_ref = url.searchParams.get("breakdown_ref") || undefined;
        for (const value of [episode_ref, breakdown_ref]) if (value && (value.length > 512 || /[\x00-\x1f]/.test(value))) throw new AuthError("invalid_reference", 400);
        return json(withEpoch(session, await readCreativeFlow(scope, session, { episode_ref, breakdown_ref })));
      }
      if (r.method === "GET" && path === "/drama/episodes") {
        const limit = Number(url.searchParams.get("limit") || dramaLimits.defaultPage);
        const q = (url.searchParams.get("q") || "").trim();
        const readMode = url.searchParams.get("read");
        const order = url.searchParams.get("order");
        const requested = url.searchParams.getAll("episode_ref");
        if (!Number.isInteger(limit) || limit < 1 || limit > dramaLimits.maxPage || q.length > 200 || (readMode && readMode !== "all") || (order && order !== "recent" && order !== "natural") || requested.length > dramaLimits.maxExtra) throw new AuthError("invalid_query", 400);
        // Task episode refs are owner-supplied text. One malformed ref must cost that episode, not the whole list.
        const extra = [...new Set(requested.filter(validDramaRef))];
        const fp = createHash("sha256").update(JSON.stringify([session.id, session.epoch, scope, q, limit, order || "natural", extra, "drama_episodes.v1"])).digest("hex");
        const offset = Number(cursor(url.searchParams.get("cursor"), fp).offset || 0);
        if (!Number.isInteger(offset) || offset < 0) throw new AuthError("cursor_invalid", 400);
        const page = await drama.episodes(scope, session, { q, limit, offset, read: readMode === "all" ? "all" : undefined, order: order === "recent" ? "recent" : undefined, extra });
        const next = page.next_offset === undefined ? undefined : sign({ fp, cursors: { offset: String(page.next_offset) }, expires: Date.now() + 300_000 });
        return json(withEpoch(session, { ...page.body, ...(next ? { next_cursor: next } : {}) }));
      }
      if (r.method === "GET" && path === "/drama/episode") {
        const episodeRef = url.searchParams.get("episode_ref") || "";
        const scaenaRef = url.searchParams.get("scaena_episode_ref");
        if (!validDramaRef(episodeRef) || (scaenaRef !== null && !validDramaRef(scaenaRef))) throw new AuthError("invalid_reference", 400);
        return json(withEpoch(session, await drama.episode(scope, session, episodeRef, {
          ...(scaenaRef ? { scaena_episode_ref: scaenaRef } : {}),
          refresh: url.searchParams.get("refresh") === "1",
          clientOrigins: { muweave: config.clients?.muweave?.enabled === false ? undefined : config.clients?.muweave?.origin },
        })));
      }
      if (r.method === "GET" && path === "/production") {
        // One episode with episode_ref, the whole scope without; the same line the episode studio and project view draw.
        const episodeRef = url.searchParams.get("episode_ref");
        const scaenaRef = url.searchParams.get("scaena_episode_ref");
        const { line } = await production.read(scope, session, { ...(episodeRef !== null ? { episode_ref: episodeRef } : {}), ...(scaenaRef !== null ? { scaena_episode_ref: scaenaRef } : {}) });
        return json(withEpoch(session, line));
      }
      if (r.method === "GET" && path === "/episode-production") {
        // Scaena's stored production summary for one episode, through the scope's observer task connection. Read-only.
        const episodeRef = url.searchParams.get("episode_ref") || "";
        const scaenaRef = url.searchParams.get("scaena_episode_ref");
        if (!validDramaRef(episodeRef) || (scaenaRef !== null && !validDramaRef(scaenaRef))) throw new AuthError("invalid_reference", 400);
        if (!session.personal) return json(withEpoch(session, { state: "unavailable", reason: "personal_connection_required" }));
        return json(withEpoch(session, await episodeProduction.read(scope, episodeRef, scaenaRef || undefined, session)));
      }
      const episodeArtifactAccessRoute = path.match(/^\/episode-production\/artifacts\/([^/]+)\/access$/);
      if (episodeArtifactAccessRoute) {
        if (r.method !== "POST") return methodNotAllowed(["POST"]);
        if (!session.personal) throw new AuthError("personal_connection_required", 403);
        const artifactRef = pathParam(episodeArtifactAccessRoute[1]);
        if (!artifactRef || artifactRef.length > 512 || /[\/\\\x00-\x1f\x7f-\x9f]/.test(artifactRef)) throw new AuthError("invalid_reference", 400);
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 4096) throw new AuthError("invalid_request", 400);
        const body = jsonObject<Record<string, unknown>>(raw, "invalid_request");
        const allowed = ["episode_ref", "connection", "expected_revision", "digest", "purpose"];
        if (
          Object.keys(body).some((key) => !allowed.includes(key)) ||
          typeof body.episode_ref !== "string" || !validDramaRef(body.episode_ref) ||
          typeof body.connection !== "string" || !body.connection || body.connection.length > 512 ||
          typeof body.expected_revision !== "string" || !body.expected_revision || body.expected_revision.length > 512 ||
          typeof body.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(body.digest) ||
          !["preview", "download"].includes(body.purpose as string)
        ) throw new AuthError("invalid_request", 400);
        const connection = tasks.connections(scope).find((candidate) => candidate.id === body.connection && candidate.owner === "scaena" && candidate.enabled && candidate.allow_content !== false);
        if (!connection) throw new AuthError("connection_forbidden", 403);
        const target = {
          connection: connection.id,
          episode_ref: body.episode_ref,
          artifact_ref: artifactRef,
          expected_revision: body.expected_revision,
          digest: body.digest,
        } as const;
        const granted = await audited({
          actor: identityOf(session),
          sessionId: session.id,
          scopeId: scope.id,
          owner: connection.owner,
          targetRef: artifactRef,
          purpose: body.purpose as string,
          action: "episode.artifact_access",
        }, () => media.issueEpisode(session, scope, target, body.purpose as "preview" | "download"));
        return json(withEpoch(session, granted));
      }
      if (r.method === "GET" && path === "/task-reviews") {
        // Eikona's review decision and counts for up to ten of this scope's tasks, through each task's observer connection. Read-only.
        const keys = url.searchParams.getAll("task_key");
        if (!session.personal) return json(withEpoch(session, { reviews: {}, reason: "personal_connection_required" }));
        return json(withEpoch(session, { reviews: await taskReviews.readMany(scope, keys) }));
      }
      if (r.method === "GET" && path === "/owner-projects") {
        // Tool projects across every scope of this identity, with local names; no owner calls.
        const scopes = auth.principal(session)?.scopes || [];
        const names = scopes.flatMap((s) => projectMetadata.list(s.id).map((row) => ({ ...row, scope_id: s.id, tenant: s.tenant })));
        const registered = connectionCatalog.registered();
        const rows = scopes.flatMap((s) => collaboration.toolProjects(s).map((p) => {
          // A name given in this scope wins; otherwise one given for the same project in another scope of the tenant.
          const own = names.find((n) => n.scope_id === s.id && n.owner === p.owner && n.project_ref === p.project_ref);
          const other = names.filter((n) => n.tenant === s.tenant && n.owner === p.owner && n.project_ref === p.project_ref && n.display_name).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
          return { ...p, scope_id: s.id, scope_label: s.label, tenant: s.tenant, display_name: own?.display_name || other?.display_name || "", hidden: own?.hidden === true, revision: own?.revision || 0,
            registrations: registered.filter((c) => c.scope_id === s.id && c.owner === p.owner && c.project === p.project_ref).map((c) => ({ id: c.id, template_id: c.template_id, label: c.label })) };
        }));
        const admin = !!session.personal && auth.role(session) === "admin";
        const templates = admin && !scope.id.startsWith("project_") ? connectionCatalog.configured().filter((c) => c.enabled && scope.connection_ids?.includes(c.id)).map((c) => ({ id: c.id, owner: c.owner, label: c.label, project: c.project })) : [];
        return json(withEpoch(session, { schema_version: "yeisme.owner_projects.v1", scope: scope.id, rows, can_register: templates.length > 0, templates }));
      }
      if (r.method === "GET" && path === "/project-metadata") {
        return json(withEpoch(session, {
          schema_version: "yeisme.project_metadata.page.v1",
          scope: scope.id,
          observed_at: new Date().toISOString(),
          rows: projectMetadata.list(scope.id),
        }));
      }
      if (r.method === "GET" && path === "/auctra/collection") {
        const limit = Number(url.searchParams.get("limit") || 50);
        const cursor = url.searchParams.get("cursor");
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor && !/^\d+$/.test(cursor))) throw new AuthError("invalid_query", 400);
        const result = collectionStore.list(collectionScope, {
          recordKind: url.searchParams.get("record_kind") || undefined,
          collectionState: url.searchParams.get("collection_state") || undefined,
          sourceState: url.searchParams.get("source_state") || undefined,
          label: url.searchParams.get("label") || undefined,
          projectRef: url.searchParams.get("project_ref") || undefined,
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          limit,
          cursor: cursor ? Number(cursor) : 0,
        });
        const localCoverage = collectionStore.coverage(collectionScope);
        const connection = auctraConnection(config, scope, session);
        const lastSync = connection.state === "target_missing" || connection.state === "binding_missing" ? undefined : collectionStore.cursor(collectionScope, collectionFingerprint(config, scope));
        return json(withEpoch(session, {
          schema_version: "yeisme.auctra.collection.page.v1", owner: "auctra", scope: scope.id, observed_at: localCoverage.observed_at || new Date().toISOString(), coverage: config.collection?.auctra ? localCoverage.state : "unknown", rows: result.rows.map((row) => ({ ...row, scope: scope.id })), total: result.total, ...(result.nextCursor !== undefined ? { next_cursor: String(result.nextCursor) } : {}),
          connection,
          ...(lastSync ? { last_sync: { at: lastSync.lastSuccessAt, complete: lastSync.coverage !== "partial", ...(lastSync.reason ? { reason: lastSync.reason } : {}) } } : {}),
        }));
      }
      const collectionRecordMatch = path.match(/^\/auctra\/collection\/records\/([^/]+)$/);
      if (r.method === "GET" && collectionRecordMatch) {
        return json(withEpoch(session, { schema_version: "yeisme.auctra.collection.record.v1", owner: "auctra", scope: scope.id, observed_at: new Date().toISOString(), record: collectionStore.get(collectionScope, pathParam(collectionRecordMatch[1])) }));
      }
      if (r.method === "POST" && path === "/auctra/collection/sync") {
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 8192) throw new AuthError("invalid_request", 413);
        let body: { cursor?: string; updated_after?: string; limit?: number } = {};
        if (raw) body = jsonObject<typeof body>(raw, "invalid_request");
        // `limit` is the page size; one sync keeps reading pages until Auctra has none left or a sync limit stops it.
        const limit = Number(body.limit || url.searchParams.get("limit") || collectionSyncLimits.pageSize);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AuthError("invalid_query", 400);
        const result = await audited({ actor: session.issuer + "|" + session.subject, sessionId: session.id, scopeId: scope.id, action: "auctra.collection.sync", owner: "auctra", purpose: "metadata_collection" }, async (settle) => {
          const synced = await syncCollection({ reader: auctra, store: collectionStore, config }, scope, session, { cursor: body.cursor || url.searchParams.get("cursor") || undefined, updated_after: body.updated_after || url.searchParams.get("updated_after") || undefined, limit });
          // A sync that stored some pages succeeded as far as it got; the stop reason stays on the audit row.
          settle(synced.counts.returned || synced.complete ? "succeeded" : "unavailable", synced.blocker || undefined);
          return synced;
        });
        return json(withEpoch(session, { schema_version: "yeisme.auctra.collection.sync.v1", sync_ref: "sync_" + randomBytes(12).toString("hex"), scope: scope.id, ...result }), 200);
      }
      if (r.method === "POST" && path === "/auctra/authoring") {
        if (scope.id.startsWith("project_")) throw new AuthError("shared_collection_read_only", 403);
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 128 * 1024) throw new AuthError("invalid_request", 413);
        const body = jsonObject<{ operation_id?: string; args?: Record<string, unknown> }>(raw || "{}", "invalid_request");
        if (typeof body.operation_id !== "string" || !body.operation_id || !body.args || typeof body.args !== "object" || Array.isArray(body.args)) throw new AuthError("invalid_request", 400);
        const result = await auctra.authoring(body.operation_id, body.args, scope, session);
        return json(withEpoch(session, result), result.status === "success" ? 200 : 503);
      }
      const subject = session.issuer + "|" + session.subject;
      if (path === "/notifications" || path.startsWith("/notifications/")) {
        // Reminder state is control-center data and follows the signed-in scope.
        const identity = { scopeId: scope.id, sessionId: session.id, subject };
        // A project scope lists the reminders of every project in its organization; actions may target any of them.
        const reminderScopes = () => {
          const project = scope.id.startsWith("project_") ? collaboration.project(session, scope.id) : null;
          return project ? collaboration.list(session, project.organization_id).map((p) => p.id) : [scope.id];
        };
        const rowScope = (id: string) => {
          const owner = notifications.scopeOf(id, subject);
          if (!reminderScopes().includes(owner)) throw new AuthError("notification_not_found", 404);
          return owner;
        };
        const notificationPage = () => {
          const scopes = reminderScopes();
          const rows = scopes.flatMap((id) => notifications.list(id, session.id, subject)).sort((a, b) => b.first_seen_at.localeCompare(a.first_seen_at) || a.id.localeCompare(b.id));
          const limit = Number(url.searchParams.get("limit") || 50);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AuthError("invalid_query", 400);
          const query = { q: url.searchParams.get("q") || "", category: url.searchParams.get("category") || "", read: url.searchParams.get("read") || "" };
          if (query.q.length > 200) throw new AuthError("invalid_query", 400);
          const filtered = rows.filter((row) => row.title.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()) && (!query.category || query.category.split(",").includes(row.category || "failure")) && (!query.read || query.read.split(",").includes(countsAsUnread(row) ? "unread" : "read")));
          const fp = createHash("sha256").update(JSON.stringify([subject, session.epoch, scope.id, query, limit])).digest("hex");
          const offset = Number(cursor(url.searchParams.get("cursor"), fp).offset || 0);
          if (!Number.isInteger(offset) || offset < 0) throw new AuthError("invalid_query", 400);
          // Counted over every row, not the loaded page: handled, read, snoozed and recovered reminders never count.
          return { rows: filtered.slice(offset, offset + limit), unread: rows.filter((row) => countsAsUnread(row)).length, attention: rows.filter((row) => notifications.actionable(row)).length, total: filtered.length, next_cursor: offset + limit < filtered.length ? sign({ fp, expires: Date.now() + 900000, cursors: { offset: String(offset + limit) } }) : null };
        };
        const readMatch = path.match(/^\/notifications\/([^/]+)\/read$/);
        if (r.method === "POST" && readMatch) {
          auth.csrf(r, session);
          const id = pathParam(readMatch[1]);
          return json(withEpoch(session, { notification: notifications.read(id, rowScope(id), session.id, subject) }));
        }
        if (r.method === "GET" && path === "/notifications") {
          notifications.cleanup(scope.id, session.id, subject);
          return json(withEpoch(session, notificationPage()));
        }
        if (r.method === "POST" && path === "/notifications/sync") {
          auth.csrf(r, session);
          const raw = await r.text();
          if (raw.length > 512_000) throw new AuthError("invalid_request", 413);
          let body: { tasks?: TaskSnapshot[]; present_task_keys?: string[]; complete?: boolean };
          try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_request", 400); }
          if (!body || !Array.isArray(body.tasks) || body.tasks.length > 2000) throw new AuthError("invalid_request", 400);
          // The browser proposes keys only; display facts always come from a fresh owner read.
          if (body.tasks.length > 40) throw new AuthError("notification_sync_limit", 400);
          const verified: TaskSnapshot[] = [];
          let verificationComplete = true;
          for (const candidate of body.tasks) {
            if (!candidate || typeof candidate.task_key !== "string") continue;
            try { verified.push(await tasks.detail(candidate.task_key, scope)); } catch { verificationComplete = false; }
          }
          const nowMs = services.clock();
          const observed = verified.flatMap((task) => [
            ...(attentionStates.has(task.state) ? [failureFact(scope.id, task)] : []),
            ...(livenessFact(scope.id, task, nowMs) ? [livenessFact(scope.id, task, nowMs)!] : []),
          ]);
          // Open reminders whose task the browser now lists as not failing: confirm with the owner before marking them
          // recovered, so a stale page can never silence a failure. At most 20 extra owner reads per sync.
          const present = Array.isArray(body.present_task_keys) ? body.present_task_keys.filter((key) => typeof key === "string").slice(0, 4000) : [];
          const failing = new Set(body.tasks.filter((task) => attentionStates.has(String(task?.state || ""))).map((task) => taskIdentityOf(String(task?.task_key || ""))));
          const candidates = new Set(notifications.recoveryCandidates(scope.id, subject));
          const recovered: string[] = [];
          for (const key of present.filter((key) => candidates.has(taskIdentityOf(key)) && !failing.has(taskIdentityOf(key))).slice(0, 20)) {
            try {
              const task = await tasks.detail(key, scope);
              const live = livenessFact(scope.id, task, nowMs);
              if (live) observed.push(live);
              // Recovery of a prior failure is independent from the local
              // liveness reminder for a still-running task. The latter stays
              // open until a later owner read is fresh or terminal.
              if (!attentionStates.has(task.state)) recovered.push(failureFact(scope.id, task).task_identity);
            } catch { verificationComplete = false; }
          }
          const result = notifications.sync({
            ...identity,
            observed,
            presentTaskKeys: Array.isArray(body.present_task_keys) ? present : undefined,
            complete: false, // A browser page cannot establish complete owner coverage.
            recovered,
            now: new Date(nowMs).toISOString(),
          });
          return json(withEpoch(session, { ...result, ...notificationPage(), owner_writes: 0, verification_complete: verificationComplete }));
        }
        if (r.method === "POST" && path === "/notifications/bulk") {
          auth.csrf(r, session);
          const raw = await r.text();
          if (raw.length > 64_000) throw new AuthError("invalid_request", 400);
          let body: { action?: string; ids?: string[]; all?: boolean };
          try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_request", 400); }
          if (!body || (body.action !== "acknowledge" && body.action !== "archive" && body.action !== "mute") || (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string") || body.ids.length > 500))) {
            throw new AuthError("invalid_notification_action", 400);
          }
          if (body.all === true) return json({ ...notifications.bulk({ ...identity, action: body.action, all: true }), task_states_changed: 0 });
          // Rows can belong to sibling projects of the same organization; apply each group in its own scope.
          const byScope = new Map<string, string[]>();
          for (const id of body.ids || []) byScope.set(rowScope(id), [...(byScope.get(rowScope(id)) || []), id]);
          const updated = [...byScope].flatMap(([owner, ids]) => notifications.bulk({ ...identity, scopeId: owner, action: body.action as "acknowledge" | "archive" | "mute", ids }).updated);
          return json({ updated, owner_writes: 0, task_states_changed: 0 });
        }
        if (r.method === "POST" && path === "/notifications/cleanup") {
          auth.csrf(r, session);
          const result = notifications.cleanup(scope.id, session.id, subject);
          return json({ ...result, task_states_changed: 0 });
        }
        if (r.method === "GET" && path === "/notifications/mute-rules") {
          return json(withEpoch(session, { rows: notifications.muteRules(reminderScopes(), subject) }));
        }
        const ruleMatch = path.match(/^\/notifications\/mute-rules\/([^/]+)\/remove$/);
        if (r.method === "POST" && ruleMatch) {
          auth.csrf(r, session);
          return json({ ...notifications.removeMuteRule(pathParam(ruleMatch[1]), reminderScopes(), subject), task_states_changed: 0 });
        }
        const one = path.match(/^\/notifications\/([^/]+)\/(acknowledge|mute|archive|reopen|snooze)$/);
        if (one && r.method === "POST") {
          auth.csrf(r, session);
          const id = pathParam(one[1]);
          const action = one[2];
          const owner = rowScope(id);
          if (action === "mute") {
            const raw = await r.text();
            let muteScope: "fingerprint" | "task" | "error_code" = "fingerprint";
            if (raw) {
              if (raw.length > 256) throw new AuthError("invalid_request", 400);
              let body: { scope?: string };
              try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_request", 400); }
              if (body?.scope === "error_code" || body?.scope === "task") muteScope = body.scope;
              else if (body?.scope && body.scope !== "fingerprint") throw new AuthError("invalid_request", 400);
            }
            return json({ ...notifications.mute(id, owner, session.id, subject, undefined, muteScope), task_states_changed: 0 });
          }
          if (action === "snooze") {
            // `until` is an absolute time, at most 30 days ahead; the reminder stays unread but quiet until then.
            const raw = await r.text();
            if (raw.length > 256) throw new AuthError("invalid_request", 400);
            let body: { until?: unknown };
            try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_request", 400); }
            if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "until")) throw new AuthError("invalid_request", 400);
            const snoozed = notifications.snooze(id, owner, session.id, subject, snoozeDeadline(body.until));
            return json({ notification: snoozed, task_state: snoozed.task_state, task_states_changed: 0, owner_writes: 0 });
          }
          const updated = action === "acknowledge"
            ? notifications.acknowledge(id, owner, session.id, subject)
            : action === "archive"
              ? notifications.archive(id, owner, session.id, subject)
              : notifications.reopen(id, owner, session.id, subject);
          return json({ notification: updated, task_state: updated.task_state, task_states_changed: 0, owner_writes: 0 });
        }
        return methodNotAllowed(["GET", "POST"]);
      }
      if (r.method === "DELETE" && /^\/tasks\/[^/]+$/.test(path)) {
        throw new AuthError("task_delete_not_supported", 405);
      }
      if (r.method === "GET" && path === "/actions") {
        const owner = url.searchParams.get("owner") || undefined;
        return json(withEpoch(session, { scope: scope.id, actions: actions.list(owner) }));
      }
      if (path === "/actions/preview" && r.method === "POST") {
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 524288) throw new AuthError("invalid_action_request", 413);
        let body: ActionPreviewRequest;
        try { body = JSON.parse(raw) as ActionPreviewRequest; } catch { throw new AuthError("invalid_action_request", 400); }
        if (!body || body.scope_id !== scope.id || typeof body.owner !== "string" || typeof body.target_kind !== "string" || typeof body.target_ref !== "string" || typeof body.action !== "string" || typeof body.expected_revision !== "string" || typeof body.idempotency_key !== "string" || !body.input || typeof body.input !== "object") throw new AuthError("invalid_action_request", 400);
        const preview = await audited({ actor: session.issuer + "|" + session.subject, sessionId: session.id, scopeId: scope.id, action: "actions.preview", owner: body.owner, targetRef: body.target_ref, meta: { action: body.action, target_kind: body.target_kind } }, async () => {
          authorizeAction(session, body.action, scope);
          if (isCollaborationAction(body.action)) collaboration.authorize(session, body.action, body.target_ref, body.input);
          if (body.authorization_context !== undefined) throw new AuthError("invalid_action_request", 400);
          if (body.action === "project.collection_binding.set") {
            if (body.target_kind !== "project" || body.owner !== "control-center" || body.target_ref !== scope.id) throw new AuthError("scope_mismatch", 403);
            if (String(collaboration.project(session, scope.id).revision) !== body.expected_revision) throw new AuthError("revision_conflict", 409);
            body.authorization_context = collaboration.collectionBindingContext(session, body.target_ref, body.input.binding);
          }
          if (body.action === "generation.batch.create") body.input.items = await generationBatches.verify(session, body.target_ref, body.input.items);
          if (body.action === "provider_runs.create" && scope.id.startsWith("project_")) throw new AuthError("project_generation_use_batch_contract", 403);
          if (body.action === "prompts.save") {
            if (!promptOwners.includes(body.owner as PromptOwner)) throw new AuthError("invalid_prompt_owner", 400);
            const input = promptWrite(body.input, body.owner as PromptOwner);
            if (body.expected_revision !== String(input.expected_version) || body.target_ref !== (input.id || "new")) throw new AuthError("prompt_conflict", 409);
            body.input = { ...input };
          }
          if (body.action === "prompts.recipe.create" || body.action === "prompts.recipe.revise") {
            validateRecipeProject(scope, body.input.owner, body.input.project_ref);
          }
          if (body.action === "owner_project.connect") await checkToolProject(session, scope, body.input || {});
          if (body.action === "owner_project.disconnect") registeredIn(session, scope, body.input?.connection_id);
          return actions.preview(body, identityOf(session));
        });
        return json(withEpoch(session, preview));
      }
      if (path === "/actions/confirm" && r.method === "POST") {
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 4096) throw new AuthError("invalid_action_request", 413);
        let body: ActionConfirmRequest;
        try { body = JSON.parse(raw) as ActionConfirmRequest; } catch { throw new AuthError("invalid_action_request", 400); }
        if (!body || body.scope_id !== scope.id || typeof body.preview_ref !== "string" || typeof body.preview_digest !== "string" || typeof body.idempotency_key !== "string") throw new AuthError("invalid_action_request", 400);
        const receipt = await audited({ actor: session.issuer + "|" + session.subject, sessionId: session.id, scopeId: scope.id, action: "actions.confirm", targetRef: body.preview_ref }, async (settle) => {
          const original = actions.record(body.preview_ref, identityOf(session), scope.id);
          authorizeAction(session, original.request.action, scope);
          if (original.request.action === "prompts.recipe.create" || original.request.action === "prompts.recipe.revise") {
            validateRecipeProject(scope, original.request.input.owner, original.request.input.project_ref);
          }
          if (isCollaborationAction(original.request.action)) collaboration.authorize(session, original.request.action, original.request.target_ref, original.request.input);
          const local = original.request.action.startsWith("prompts.collection.") || original.request.action.startsWith("prompts.recipe.") || (isCollaborationAction(original.request.action) && !["generation.input.prepare", "generation.batch.submit", "generation.batch.reconcile"].includes(original.request.action));
          if (original.request.action === "generation.batch.create") original.request.input.items = await generationBatches.verify(session, original.request.target_ref, original.request.input.items);
          const done = local ? actions.confirmLocal(body, (record) => {
            if (record.request.action.startsWith("prompts.collection.")) {
              const input = record.request.input;
              if (record.request.action === "prompts.collection.set") {
                if (!Array.isArray(input.links) || typeof input.remove !== "boolean") throw new AuthError("invalid_collection_link", 400);
                for (const link of input.links as PromptLink[]) if (!link || !promptOwners.includes(link.owner) || scope.owners[link.owner]?.project !== link.project) throw new AuthError("scope_mismatch", 403);
              }
              const result = record.request.action === "prompts.collection.create" ? promptCollectionsStore.create(scope.id, input.name, record.request.idempotency_key) : promptCollectionsStore.set(scope.id, record.request.target_ref, input.links, input.remove === true);
              return ActionService.succeeded(record, { owner_state: "updated", result_refs: [result] });
            }
            if (record.request.action.startsWith("prompts.recipe.")) {
              const input = record.request.input;
              const result = record.request.action === "prompts.recipe.create"
                ? promptRecipesStore.create(scope.id, identityOf(session), input as unknown as PromptRecipeInput)
                : record.request.action === "prompts.recipe.revise"
                  ? promptRecipesStore.revise(scope.id, identityOf(session), record.request.target_ref, Number(input.expected_revision), input as unknown as PromptRecipeInput)
                  : promptRecipesStore.archive(scope.id, record.request.target_ref, Number(input.expected_revision));
              return ActionService.succeeded(record, { owner_state: "updated", result_refs: [result.recipe_ref] });
            }

            if (record.request.action === "project.collection_binding.set" && record.request.authorization_context !== collaboration.collectionBindingContext(session, record.request.target_ref, record.request.input.binding)) throw new AuthError("collection_binding_changed", 409);
            const result = collaboration.execute(session, record.request.action as import("../src/shared/collaboration").CollaborationAction, record.request.target_ref, record.request.expected_revision, record.request.input);
            announceProject(session, record, result);
            return ActionService.succeeded(record, { owner_state: "updated", result_refs: result });
          }, identityOf(session)) : await actions.confirm(body, async (record: PreviewRecord): Promise<ActionReceipt> => {
            if (record.preview.availability !== "available") return ActionService.unavailable(record, record.preview.blockers[0] || "action_unavailable");
            const input = record.request.input;
            if (record.request.action === "prompts.save") {
              const result = await readers.promptLibrary(record.request.owner as PromptOwner, session, scope, {}, "save", typeof input.id === "string" ? input.id : "", input, record.request.idempotency_key);
              if (!("summary" in result) || !result.summary) throw new AuthError("prompt_contract_invalid", 502);
              return ActionService.succeeded(record, { operation_ref: result.summary.id, owner_state: "saved", result_refs: [result.summary.id] });
            }
            if (record.request.action === "generation.input.prepare") {
              const items = await generationBatches.prepare(session, record.request.target_ref, input, record.request.idempotency_key);
              return ActionService.succeeded(record, { generation_items: items, result_refs: items.map((v) => v.input_ref) });
            }
            if (record.request.action === "generation.batch.submit" || record.request.action === "generation.batch.reconcile") {
              const batch = await generationBatches.operate(session, record.request.target_ref, String(input.batch_id), record.request.action === "generation.batch.submit");
              announceBatches(batch.project_id, [batch]);
              return ActionService.outcome(record, batch.state === "unknown" ? "unknown" : "succeeded", { error_code: batch.state === "unknown" ? "generation_reconcile_required" : null, owner_state: batch.state, operation_ref: batch.id, result_refs: [batch.id] });
            }
            if (isCollaborationAction(record.request.action)) {
              if (record.request.action === "generation.batch.create") input.items = await generationBatches.verify(session, record.request.target_ref, input.items);
              const result = collaboration.execute(session, record.request.action, record.request.target_ref, record.request.expected_revision, input);
              announceProject(session, record, result);
              return ActionService.succeeded(record, { owner_state: "updated", result_refs: result });
            }
            if (record.request.action === "task.cancel") {
              if (input.confirm !== true || typeof input.expected_revision !== "string") throw new AuthError("invalid_action_input", 400);
              const result = await tasks.cancel(record.request.target_ref, scope, input.expected_revision, record.request.idempotency_key, false);
              return ActionService.outcome(record, result.receipt.outcome === "unknown" ? "unknown" : result.receipt.outcome === "cancelled" || result.receipt.outcome === "already_terminal" ? "succeeded" : "failed", { owner_state: result.receipt.outcome, observed_at: result.receipt.occurred_at || undefined, operation_ref: result.receipt.ref });
            }
            if (record.request.action === "provider_runs.create") {
              if (scope.id.startsWith("project_")) throw new AuthError("project_generation_use_batch_contract", 403);
              const run = await providers.create(input as any, scope, session);
              return ActionService.outcome(record, run.state === "unknown" ? "unknown" : run.state === "failed" ? "failed" : "submitted", { owner_state: run.state, error_code: run.error_code || null, observed_at: run.observed_at, operation_ref: run.run_ref, result_refs: run.output_refs });
            }
            if (record.request.action === "provider_runs.reconcile") {
              if (typeof input.run_ref !== "string") throw new AuthError("invalid_action_input", 400);
              const run = await providers.reconcile(input.run_ref);
              return ActionService.outcome(record, run.state === "unknown" ? "unknown" : run.state === "failed" ? "failed" : "succeeded", { owner_state: run.state, error_code: run.error_code || null, observed_at: run.observed_at, operation_ref: run.run_ref, result_refs: run.output_refs });
            }
            if (record.request.owner === "control-center" && record.request.action.startsWith("collection.record.")) {
              if (scope.id.startsWith("project_")) collaboration.project(session, scope.id, "creator");
              const expected = String(input.expected_revision || "");
              const actor = session.issuer + "|" + session.subject;
              const recordRef = record.request.target_ref;
              const result = record.request.action === "collection.record.confirm"
                ? collectionStore.confirm(collectionScope, recordRef, expected, actor)
                : record.request.action === "collection.record.archive"
                  ? collectionStore.archive(collectionScope, recordRef, expected, actor)
                  : record.request.action === "collection.record.labels.set"
                    ? collectionStore.labels(collectionScope, recordRef, expected, actor, Array.isArray(input.labels) ? input.labels.filter((value): value is string => typeof value === "string") : [])
                    : collectionStore.note(collectionScope, recordRef, expected, actor, typeof input.note === "string" ? input.note : "");
              return ActionService.succeeded(record, { owner_state: result.collection_state, operation_ref: recordRef, result_refs: [recordRef] });
            }
            if (record.request.owner === "control-center" && record.request.action === "owner_project.connect") {
              // Checked again: time passed since the preview, and the owner may have changed its mind.
              const checked = await checkToolProject(session, scope, input);
              const connection = connectionCatalog.register({ scope, template: checked.template, project: checked.project, label: checked.label, actor: identityOf(session) });
              // The name typed while connecting becomes the project's local name, unless it already has one.
              if (checked.label && !projectMetadata.get(scope.id, checked.template.owner, checked.project)) {
                try { projectMetadata.rename(scope.id, checked.template.owner, checked.project, "0", checked.label, identityOf(session)); } catch { /* the connection stands; the name can be set later */ }
              }
              tasks.forget(connection);
              auth.sessions.bumpAll();
              return ActionService.succeeded(record, { owner_state: "connected", result_refs: [connection] });
            }
            if (record.request.owner === "control-center" && record.request.action === "owner_project.disconnect") {
              const found = registeredIn(session, scope, input.connection_id);
              connectionCatalog.disconnect(found.id, scope);
              tasks.forget(found.id);
              auth.sessions.bumpAll();
              return ActionService.succeeded(record, { owner_state: "disconnected", result_refs: [found.id] });
            }
            if (record.request.owner === "control-center" && record.request.action.startsWith("project.metadata.")) {
              const separator = record.request.target_ref.indexOf(":");
              if (separator <= 0 || separator === record.request.target_ref.length - 1) throw new AuthError("invalid_project_target", 400);
              const owner = record.request.target_ref.slice(0, separator);
              const projectRef = record.request.target_ref.slice(separator + 1);
              const expected = String(input.expected_revision || record.request.expected_revision || "");
              if (expected !== record.request.expected_revision) throw new AuthError("project_metadata_conflict", 409);
              const actor = session.issuer + "|" + session.subject;
              const result = record.request.action === "project.metadata.rename"
                ? projectMetadata.rename(scope.id, owner, projectRef, expected, input.display_name, actor)
                : record.request.action === "project.metadata.hide"
                  ? projectMetadata.hide(scope.id, owner, projectRef, expected, actor)
                  : projectMetadata.unhide(scope.id, owner, projectRef, expected, actor);
              return ActionService.succeeded(record, { owner_state: result.hidden ? "hidden" : "visible", operation_ref: record.request.target_ref, result_refs: [record.request.target_ref] });
            }
            if (record.request.action === "admin.user.revoke") {
              if (typeof input.username !== "string") throw new AuthError("invalid_action_input", 400);
              await auth.revokePersonalUser(input.username, session.subject);
              return ActionService.succeeded(record, { owner_state: "revoked", operation_ref: input.username });
            }
            return ActionService.unavailable(record, "owner_action_adapter_not_configured");
          }, identityOf(session));
          settle(done.state === "succeeded" || done.state === "submitted" ? "succeeded" : done.state === "needs_contract" ? "unavailable" : "failed", done.error_code || undefined);
          if (done.action.startsWith("project.metadata.")) {
            audit.record({
              actor: session.issuer + "|" + session.subject,
              sessionId: session.id,
              scopeId: scope.id,
              action: "actions.confirm",
              owner: done.owner,
              targetRef: done.target_ref,
              meta: { action: done.action, state: done.state, owner_state: done.owner_state },
            }, done.state === "succeeded" ? "succeeded" : done.state === "needs_contract" ? "unavailable" : "failed", done.error_code || undefined);
          }
          return done;
        });
        return json(withEpoch(session, receipt), 202);
      }
      const receiptMatch = path.match(/^\/actions\/receipts\/([^/]+)$/);
      if (receiptMatch && r.method === "GET") {
        const receipt = actions.receipt(pathParam(receiptMatch[1]), scope.id, identityOf(session));
        audit.record({ actor: session.issuer + "|" + session.subject, sessionId: session.id, scopeId: scope.id, action: "actions.receipt_read", targetRef: receipt.receipt_ref, meta: { action: receipt.action } }, "succeeded");
        return json(withEpoch(session, receipt));
      }
      if (r.method === "GET" && path === "/services") {
        const observe = session.personal && url.searchParams.get("observe") === "1";
        const [observations, projections] = await Promise.all([observe ? tasks.observe(scope) : [], observe ? openTools.projections(scope) : []]);
        return json(withEpoch(session, serviceDirectory(config, scope, session, observations, connectionCatalog.inScope(scope), { configured: openTools.inScope(scope), projections })));
      }
      if (path.startsWith("/gateway/")) {
        if (!session.personal) throw new AuthError("personal_connection_required", 403);
        const connection = gatewayConnection(config, scope);
        const monitor = new GatewayMonitorService(connection);
        if (r.method === "GET" && path === "/gateway/monitor") return json(withEpoch(session, await monitor.snapshot()));
        if (r.method === "GET" && path === "/gateway/sessions") return json(withEpoch(session, await monitor.sessions()));
        if (r.method === "GET" && path === "/gateway/calls") {
          const query = new URLSearchParams();
          for (const key of ["before", "limit", "state", "backend", "tool", "session_ref"]) { const value = url.searchParams.get(key); if (value) query.set(key, value.slice(0, 160)); }
          return json(withEpoch(session, await monitor.calls(query.toString())));
        }
        const callMatch = path.match(/^\/gateway\/calls\/([^/]+)$/);
        if (r.method === "GET" && callMatch) return json(withEpoch(session, await monitor.callDetail(pathParam(callMatch[1]))));
        if (r.method === "GET" && path === "/gateway/client-presets") return json(withEpoch(session, await monitor.presets()));
        if (r.method === "GET" && path === "/gateway/events") {
          const epoch = session.epoch;
          const upstream = await monitor.events(url.searchParams.get("after_seq") || r.headers.get("Last-Event-ID") || undefined, r.signal);
          const authorized = () => {
            try { const current = auth.current(r); return current.id === session.id && current.epoch === epoch && gatewayConnection(config, scoped(current, scope.id)) === connection; }
            catch { return false; }
          };
          return new Response(gatewayEventStream(upstream.body!, r.signal, authorized), { status: 200, headers: { "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" } });
        }
        if (path === "/gateway/plans") {
          if (r.method !== "POST") return methodNotAllowed(["POST"]);
          if (auth.role(session) !== "admin") throw new AuthError("control_center_admin_required", 403);
          auth.csrf(r, session);
          const body = jsonObject<Record<string, unknown>>(await r.text(), "invalid_gateway_plan");
          if (typeof body.action !== "string" || typeof body.target_ref !== "string" || typeof body.expected_revision !== "string" || typeof body.idempotency_key !== "string" || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) throw new AuthError("invalid_gateway_plan", 400);
          return json(withEpoch(session, await monitor.plan({ action: body.action, target_ref: body.target_ref, expected_revision: body.expected_revision, idempotency_key: body.idempotency_key, input: body.input })), 202);
        }
        const planMatch = path.match(/^\/gateway\/plans\/([^/]+)\/apply$/);
        if (r.method === "POST" && planMatch) {
          if (auth.role(session) !== "admin") throw new AuthError("control_center_admin_required", 403);
          auth.csrf(r, session);
          const body = jsonObject<Record<string, unknown>>(await r.text(), "invalid_gateway_apply");
          if (typeof body.plan_digest !== "string" || typeof body.idempotency_key !== "string" || (body.approval_id !== undefined && typeof body.approval_id !== "string")) throw new AuthError("invalid_gateway_apply", 400);
          return json(withEpoch(session, await monitor.apply(pathParam(planMatch[1]), body)), 202);
        }
        return methodNotAllowed(["GET", "POST"]);
      }
      if (r.method === "GET" && path === "/capabilities")
        return json(withEpoch(session, { scope: scope.id, capabilities: await providers.capabilities(scope) }));
      if (path === "/tool-catalog") {
        if (r.method !== "GET") return methodNotAllowed(["GET"]);
        return json(withEpoch(session, await catalog.snapshot(scope, { refresh: url.searchParams.get("refresh") === "1", openTools: !!session.personal })));
      }
      if (r.method === "GET" && path === "/usage")
        return json(withEpoch(session, {
          scope: scope.id,
          rows: providers.usageRows(scope),
          budget: providers.budgetStatus(),
          coverage: { state: "partial", observed_at: new Date().toISOString(), reason: "仅包含已接入 Provider 回执；历史 owner 账本仍按来源读取" },
        }));
      if (path === "/provider-runs" && r.method === "POST") {
        if (scope.id.startsWith("project_")) throw new AuthError("project_generation_use_batch_contract", 403);
        auth.csrf(r, session);
        authorizeAction(session, "provider_runs.create");
        const raw = await r.text();
        if (raw.length > 12000) throw new AuthError("invalid_provider_request", 400);
        let body: any;
        try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_provider_request", 400); }
        const allowed = ["mode", "owner", "modality", "model_ref", "scope_id", "project_ref", "prompt", "budget_cap", "idempotency_key", "trace_ref", "generation_mode", "references", "timeline", "output", "variant_count"];
        const creativeModes = new Set(["text_to_image", "image_to_image", "image_upscale", "text_to_video", "image_to_video", "keyframe_video", "text_to_audio", "text_to_text"]);
        const creativeInputValid = !!body &&
          (body.generation_mode === undefined || creativeModes.has(body.generation_mode)) &&
          (body.references === undefined || (Array.isArray(body.references) && body.references.length <= 16 && body.references.every((reference: any) => reference && typeof reference === "object" && typeof reference.ref === "string" && typeof reference.source === "string" && typeof reference.name === "string" && typeof reference.mime === "string" && Array.isArray(reference.roles)))) &&
          (body.timeline === undefined || (body.timeline && typeof body.timeline === "object" && Number.isFinite(body.timeline.duration_ms) && Array.isArray(body.timeline.keyframes) && body.timeline.keyframes.length <= 32)) &&
          (body.output === undefined || (body.output && typeof body.output === "object" && !Array.isArray(body.output))) &&
          (body.variant_count === undefined || (Number.isInteger(body.variant_count) && body.variant_count >= 1 && body.variant_count <= 4));
        if (!body || Object.keys(body).some((key) => !allowed.includes(key)) ||
          body.mode !== "live" || !["eikona", "scaena", "sonora"].includes(body.owner) ||
          !["image", "video", "audio"].includes(body.modality) ||
          typeof body.model_ref !== "string" || body.model_ref.length < 1 || body.model_ref.length > 200 ||
          typeof body.scope_id !== "string" || typeof body.project_ref !== "string" ||
          typeof body.prompt !== "string" || body.prompt.length < 1 || body.prompt.length > 10000 ||
          // The cap's currency is checked by the run manager, which knows the owners' cap currency.
          !body.budget_cap || typeof body.budget_cap.currency !== "string" ||
          typeof body.budget_cap.amount !== "number" || !Number.isFinite(body.budget_cap.amount) ||
          typeof body.idempotency_key !== "string" ||
          (body.trace_ref !== undefined && typeof body.trace_ref !== "string") || !creativeInputValid)
          throw new AuthError("invalid_provider_request", 400);
        const result = await audited({
          actor: session.issuer + "|" + session.subject,
          sessionId: session.id,
          scopeId: scope.id,
          action: "provider_runs.create",
          owner: body.owner,
          targetRef: body.idempotency_key,
          meta: { modality: body.modality, model_ref: body.model_ref, budget_amount: body.budget_cap.amount },
        }, async (settle) => {
          const created = await providers.create(body as ProviderRunRequest, scope, session);
          settle(created.state === "failed" ? "failed" : "succeeded", created.error_code ?? undefined);
          return created;
        });
        return json(result, 202);
      }
      const providerRun = path.match(/^\/provider-runs\/([^/]+)(\/events|\/reconcile)?$/);
      if (providerRun) {
        if (r.method === "POST") authorizeAction(session, "provider_runs.reconcile");
        const runRef = pathParam(providerRun[1]);
        const run = providers.get(runRef);
        if (!run || run.scope_id !== scope.id) throw new AuthError("run_not_found", 404);
        if (r.method === "GET" && !providerRun[2]) return json(run);
        if (r.method === "POST" && providerRun[2] === "/reconcile") {
          auth.csrf(r, session);
          const reconciled = await audited({
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            scopeId: scope.id,
            action: "provider_runs.reconcile",
            owner: run.owner,
            targetRef: runRef,
          }, () => providers.reconcile(runRef));
          return json(reconciled);
        }
        if (r.method === "GET" && providerRun[2] === "/events") {
          const encoder = new TextEncoder();
          let unsubscribe = () => {};
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              let closed = false;
              const close = () => {
                if (closed) return;
                closed = true;
                unsubscribe();
                if (heartbeat) clearInterval(heartbeat);
                try { controller.close(); } catch { /* client disconnected */ }
              };
              const send = (value: unknown, event = "provider-run") => {
                if (closed) return;
                try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); }
                catch { close(); }
              };
              send(run);
              if (["succeeded", "failed", "unknown", "reconciled"].includes(run.state)) return close();
              unsubscribe = providers.subscribe(runRef, (next) => {
                send(next);
                if (["succeeded", "failed", "unknown", "reconciled"].includes(next.state)) close();
              });
              heartbeat = setInterval(() => send({ run_ref: runRef, observed_at: new Date().toISOString() }, "heartbeat"), 15000);
              r.signal.addEventListener("abort", close, { once: true });
            },
            cancel() { unsubscribe(); if (heartbeat) clearInterval(heartbeat); },
          });
          return new Response(stream, {
            headers: {
              "Cache-Control": "no-cache, no-store",
              "Content-Type": "text/event-stream; charset=utf-8",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            },
          });
        }
      }
      const permittedTask = (task: TaskSnapshot): TaskSnapshot => auth.role(session) === "admin" ? task : ({
        ...task,
        allowed_actions: task.allowed_actions.map(action => action.action === "cancel"
          ? { ...action, enabled: false, reason: "control_center_admin_required" } : action),
      });
      if (path.startsWith("/media/")) {
        if (!["GET", "HEAD"].includes(r.method))
          return methodNotAllowed(["GET", "HEAD"]);
        // Upstream artifact handles still require a personal task connection;
        // in-memory attachment bytes are served for any authorized session.
        return await media.read(
          path.slice("/media/".length),
          r,
          session,
          scope,
        );
      }
      if (path === "/work-queue" && r.method === "GET") {
        const kind = url.searchParams.get("kind") || undefined;
        const owner = url.searchParams.get("owner") || undefined;
        const state = url.searchParams.get("state") || undefined;
        const workflow_stage = url.searchParams.get("workflow_stage") || undefined;
        const limitRaw = Number(url.searchParams.get("limit") || "50");
        if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) throw new AuthError("invalid_query", 400);
        if (kind && !workQueueKinds.includes(kind as (typeof workQueueKinds)[number])) throw new AuthError("invalid_query", 400);
        if (owner && (owner.length > 64 || !/^[a-z][a-z0-9-]*$/.test(owner))) throw new AuthError("invalid_query", 400);
        if (state && (state.length > 100 || !/^[a-z][a-z0-9_-]*$/.test(state))) throw new AuthError("invalid_query", 400);
        if (workflow_stage && !["screenplay", "director_plan", "creative_storyboard", "production_handoff", "production_breakdown"].includes(workflow_stage)) throw new AuthError("invalid_query", 400);
        const filters = { ...(kind ? { kind } : {}), ...(owner ? { owner } : {}), ...(state ? { state } : {}), ...(workflow_stage ? { workflow_stage } : {}) };
        const fp = createHash("sha256").update(JSON.stringify([session.id, session.epoch, scope.id, filters, limitRaw, "work_queue.v1"])).digest("hex");
        const cursorState = cursor(url.searchParams.get("cursor"), fp);
        const offset = cursorState.offset ? Number(cursorState.offset) : 0;
        if (!Number.isInteger(offset) || offset < 0) throw new AuthError("cursor_invalid", 400);
        const [active, history, observed, creativeFlow, openToolProjections] = await Promise.all([
          session.personal ? tasks.list(scope, "active") : Promise.resolve({ rows: [], connections: [], next_cursors: {} }),
          session.personal ? tasks.list(scope, "history") : Promise.resolve({ rows: [], connections: [], next_cursors: {} }),
          session.personal ? tasks.observe(scope) : Promise.resolve([]),
          drama.attentionFlows(scope, session),
          session.personal ? openTools.projections(scope) : Promise.resolve([]),
        ]);
        const taskRows = [...active.rows, ...history.rows].filter((task, index, rows) => rows.findIndex((candidate) => candidate.task_key === task.task_key) === index);
        const connections = observed.length ? observed : [...active.connections, ...history.connections].filter((connection, index, rows) => rows.findIndex((candidate) => candidate.id === connection.id) === index);
        const full = buildWorkQueue({
          scope,
          session,
          tasks: taskRows,
          connections,
          notifications: notifications.list(scope.id, session.id, subject),
          // The same rows the services page gives administrators, from the connection and tool readings just taken above.
          credentials: isPersonalAdmin(config, session) ? credentialStatuses(config, scope, { connections, scopeConnections: connectionCatalog.inScope(scope), openTools: openToolProjections }) : [],
          creativeFlows: creativeFlow.flows,
          flowSample: { checked: creativeFlow.checked, total: creativeFlow.total },
          openTools: openToolProjections,
          clientOrigins: { muweave: config.clients?.muweave?.enabled === false ? undefined : config.clients?.muweave?.origin },
        });
        const page = filterAndPageWorkQueue(full, filters, offset, limitRaw) as typeof full & { next_offset?: number };
        const nextCursor = page.next_offset === undefined
          ? undefined
          : sign({ fp, cursors: { offset: String(page.next_offset) }, expires: Date.now() + 300_000 });
        const { next_offset: _nextOffset, ...body } = page;
        return json(withEpoch(session, { ...body, ...(nextCursor ? { next_cursor: nextCursor } : {}) }));
      }
      if (
        path === "/connections" ||
        path === "/tasks" ||
        path.startsWith("/tasks/")
      ) {
        if (!session.personal)
          throw new AuthError("personal_connection_required", 403);
        if (r.method === "GET" && path === "/connections")
          return json(withEpoch(session, {
            connections: await tasks.observe(scope),
          }));
        if (r.method === "GET" && path === "/tasks") {
          const mode = url.searchParams.get("mode") || "active";
          if (!["active", "history"].includes(mode))
            throw new AuthError("invalid_query", 400);
          let cursors: Record<string, string> = {};
          const raw = url.searchParams.get("cursors");
          if (raw) {
            if (raw.length > 16000) throw new AuthError("invalid_query", 400);
            try {
              cursors = JSON.parse(raw);
            } catch {
              throw new AuthError("invalid_query", 400);
            }
            if (
              !cursors ||
              typeof cursors !== "object" ||
              Array.isArray(cursors) ||
              Object.values(cursors).some((v) => typeof v !== "string")
            )
              throw new AuthError("invalid_query", 400);
          }
          const page = await tasks.list(scope, mode as "active" | "history", cursors);
          return json(withEpoch(session, { ...page, rows: page.rows.map(permittedTask) }));
        }
        if (r.method === "GET" && path === "/tasks/resolve") {
          const target = {
            connection: url.searchParams.get("connection") || "",
            project: url.searchParams.get("project") || "",
            family: url.searchParams.get("family") || "",
            ref: url.searchParams.get("ref") || "",
          };
          if (Object.values(target).some((v) => !v || v.length > 512))
            throw new AuthError("invalid_query", 400);
          return json(withEpoch(session, permittedTask(await tasks.resolve(scope, target))));
        }
        const artifact = path.match(
          /^\/tasks\/([^/]+)\/artifacts\/([^/]+)\/access$/,
        );
        if (artifact && r.method === "POST") {
          auth.csrf(r, session);
          const raw = await r.text();
          if (raw.length > 100) throw new AuthError("invalid_request", 400);
          let b;
          try {
            b = JSON.parse(raw);
          } catch {
            throw new AuthError("invalid_request", 400);
          }
          if (
            !b ||
            !["preview", "download", "thumbnail"].includes(b.purpose) ||
            Object.keys(b).some((k) => k !== "purpose")
          )
            throw new AuthError("invalid_request", 400);
          const taskRef = pathParam(artifact[1]);
          const artifactRef = pathParam(artifact[2]);
          const granted = await audited({
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            scopeId: scope.id,
            action: "tasks.artifact_access",
            targetRef: artifactRef,
            purpose: b.purpose,
          }, () => media.issue(
            session,
            scope,
            taskRef,
            artifactRef,
            b.purpose as "preview" | "download" | "thumbnail",
          ));
          return json(granted);
        }
        const t = path.match(
          /^\/tasks\/([^/]+)(\/events|\/cancel|\/cancel-receipt|\/prompt:read)?$/,
        );
        if (t) {
          const key = pathParam(t[1]);
          if (r.method === "GET" && !t[2])
            return json(withEpoch(session, permittedTask(await tasks.detail(key, scope))));
          if (r.method === "GET" && t[2] === "/events")
            return json(
              withEpoch(
                session,
                await tasks.events(
                  key,
                  scope,
                  url.searchParams.get("cursor") || undefined,
                  url.searchParams.get("after") || undefined,
                ),
              ),
            );
          if (r.method === "GET" && t[2] === "/cancel-receipt") {
            const receiptKey = url.searchParams.get("idempotency_key") || "";
            if (!/^[-a-zA-Z0-9_]{16,100}$/.test(receiptKey))
              throw new AuthError("invalid_query", 400);
            return json(await tasks.cancel(key, scope, "", receiptKey, true));
          }
          if (r.method === "POST" && t[2] === "/prompt:read") {
            auth.csrf(r, session);
            const raw = await r.text();
            if (raw.length > 4096) throw new AuthError("invalid_request", 400);
            let b;
            try {
              b = JSON.parse(raw);
            } catch {
              throw new AuthError("invalid_request", 400);
            }
            if (
              !b ||
              typeof b.capture_ref !== "string" ||
              !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(b.capture_ref) ||
              typeof b.purpose !== "string" ||
              !b.purpose.trim() ||
              b.purpose.trim().length > 200 ||
              Object.keys(b).some((k) => !["capture_ref", "purpose"].includes(k))
            )
              throw new AuthError("invalid_request", 400);
            const result = await audited({
              actor: session.issuer + "|" + session.subject,
              sessionId: session.id,
              scopeId: scope.id,
              action: "tasks.prompt_read",
              targetRef: key,
              purpose: b.purpose.trim(),
            }, () => tasks.promptContent(key, scope, b.capture_ref, b.purpose.trim()));
            return json(result);
          }
          if (r.method === "POST" && t[2] === "/cancel") {
            auth.csrf(r, session);
            if (auth.role(session) !== "admin")
              throw new AuthError("control_center_admin_required", 403);
            const raw = await r.text();
            if (raw.length > 2048) throw new AuthError("invalid_request", 400);
            let b;
            try {
              b = JSON.parse(raw);
            } catch {
              throw new AuthError("invalid_request", 400);
            }
            if (
              !b ||
              b.confirm !== true ||
              typeof b.expected_revision !== "string" ||
              b.expected_revision.length > 150 ||
              typeof b.idempotency_key !== "string" ||
              !/^[-a-zA-Z0-9_]{16,100}$/.test(b.idempotency_key) ||
              Object.keys(b).some(
                (k) =>
                  !["confirm", "expected_revision", "idempotency_key"].includes(
                    k,
                  ),
              )
            )
              throw new AuthError("invalid_request", 400);
            const result = await audited({
              actor: session.issuer + "|" + session.subject,
              sessionId: session.id,
              scopeId: scope.id,
              action: "tasks.cancel",
              targetRef: key,
              meta: { expected_revision: b.expected_revision, idempotency_key: b.idempotency_key },
            }, () => tasks.cancel(
              key,
              scope,
              b.expected_revision,
              b.idempotency_key,
            ));
            return json(result);
          }
        }
        return methodNotAllowed(["GET", "POST"]);
      }
      if (r.method === "GET" && path === "/organization") {
        const results = await Promise.all(
          owners.map(async (owner) => {
            try {
              const data = await readers.organization(owner, session, scope);
              if (data.tenant !== scope.owners[owner]?.tenant)
                throw new AuthError("scope_mismatch", 403);
              return {
                owner,
                state: "complete",
                members: (Array.isArray(data.members) ? data.members : [])
                  .slice(0, 200)
                  .map((m: any) => ({
                    id: owner + ":" + String(m.id || "").slice(0, 200),
                    name: String(m.name || "").slice(0, 120),
                    type:
                      m.type === "service"
                        ? "service"
                        : m.type === "human"
                          ? "human"
                          : "unknown",
                    owner,
                    role: String(m.role || "").slice(0, 100),
                    team: String(m.team || "").slice(0, 120),
                    binding: m.binding === "verified" ? "verified" : "unlinked",
                  })),
              };
            } catch (e) {
              return { ...failure(owner, e), members: [] };
            }
          }),
        );
        return json(withEpoch(session, { tenant: scope.tenant, sources: results }));
      }
      if (
        r.method === "GET" &&
        (path === "/requests" || path === "/requests/summary")
      ) {
        const q = parseQuery(url.searchParams),
          targets = owners.filter((o) => q.owner === "all" || q.owner === o),
          fp = fingerprint(session, scope, q),
          previous = cursor(url.searchParams.get("cursor"), fp);
        if (path.endsWith("/summary")) {
          const results = await Promise.all(
            targets.map(async (owner) => {
              try {
                return {
                  owner,
                  summary: await readers.summary(owner, session, scope, q),
                };
              } catch (e) {
                return { owner, coverage: failure(owner, e) };
              }
            }),
          );
          // Keep source metrics separate: gateway calls and domain tasks are never summed into one total.
          return json(withEpoch(session, {
            sources: results,
            from: q.from,
            to: q.to,
            timezone: "Asia/Shanghai",
            complete: results.every((v) =>
              v.summary?.coverage?.every((c) => c.state === "complete"),
            ),
          }));
        }
        const results = await Promise.all(
          targets.map(async (owner) => {
            if (previous[owner] === null)
              return {
                owner,
                rows: [],
                coverage: {
                  owner,
                  state: "complete",
                  observed_at: new Date().toISOString(),
                } as Coverage,
                next_cursor: undefined,
              };
            try {
              return {
                owner,
                ...(await readers.list(
                  owner,
                  session,
                  scope,
                  q,
                  previous[owner] || undefined,
                )),
              };
            } catch (e) {
              return {
                owner,
                rows: [],
                coverage: failure(owner, e),
                next_cursor: undefined,
              };
            }
          }),
        );
        const rows = results
          .flatMap((v) => v.rows)
          .sort(
            (a, b) =>
              b.created_at.localeCompare(a.created_at) ||
              a.id.localeCompare(b.id),
          );
        const next = Object.fromEntries(
          results.map((v) => [v.owner, v.next_cursor || null]),
        );
        return json(withEpoch(session, {
          rows,
          coverage: results.map((v) => v.coverage),
          page_scope: "per_source",
          next_cursor: Object.values(next).some(Boolean)
            ? sign({ fp, cursors: next, expires: Date.now() + 300000 })
            : undefined,
        }));
      }
      const attachmentRead = path.match(
        /^\/requests\/(aigora|scaena|eikona|sonora)\/([^/]+)\/attachments\/([^/]+)\/content:read$/,
      );
      if (attachmentRead && r.method === "POST") {
        const owner = attachmentRead[1] as Owner,
          id = pathParam(attachmentRead[2]),
          attachmentRef = pathParam(attachmentRead[3]);
        if (
          !id ||
          id.length > 500 ||
          /[\/\\\x00-\x1f]/.test(id) ||
          !attachmentRef ||
          attachmentRef.length > 500 ||
          /[\/\\\x00-\x1f]/.test(attachmentRef)
        )
          throw new AuthError("invalid_reference", 400);
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 2048)
          throw new AuthError("invalid_content_request", 400);
        const body = jsonObject<Record<string, any>>(raw, "invalid_content_request");
        if (
          !["input", "output"].includes(body.direction) ||
          typeof body.purpose !== "string" ||
          !body.purpose.trim() ||
          body.purpose.length > 200 ||
          Object.keys(body).some((k) => !["direction", "purpose"].includes(k))
        )
          throw new AuthError("invalid_content_request", 400);
        // Audit-first, same as text content: no owner call without a durable row.
        return await audited({
          actor: session.issuer + "|" + session.subject,
          sessionId: session.id,
          scopeId: scope.id,
          action: "requests.attachment_read",
          owner,
          targetRef: id + "#" + attachmentRef,
          purpose: body.purpose.trim(),
          meta: { direction: body.direction },
        }, async (settle) => {
          const read = await readers.attachmentContent(
            owner,
            id,
            attachmentRef,
            body.direction,
            body.purpose.trim(),
            session,
            scope,
          );
          if (read.data) {
            const granted = media.issueBytes(
              session,
              scope,
              attachmentRef,
              read.mime!,
              read.data,
            );
            return json({
              state: "complete",
              mime: granted.mime,
              bytes: read.bytes,
              sha256: read.sha256,
              url: granted.url,
              expires_at: granted.expires_at,
              receipt_ref: read.receipt_ref,
            });
          }
          if (read.state === "forbidden" || read.state === "unavailable") settle("unavailable");
          return json({
            state: read.state,
            text: read.text,
            truncated: read.truncated,
            receipt_ref: read.receipt_ref,
            mime: read.mime,
          });
        });
      }
      const observationRead = path.match(
        /^\/requests\/(aigora|scaena|eikona|sonora)\/([^/]+)\/observations$/,
      );
      if (observationRead && r.method === "GET") {
        const owner = observationRead[1] as Owner;
        const id = pathParam(observationRead[2]);
        if (!id || id.length > 500 || /[\/\\\x00-\x1f]/.test(id))
          throw new AuthError("invalid_reference", 400);
        return json(withEpoch(session, await readers.observations(owner, id, url.searchParams.get("after") || undefined, session, scope)));
      }
      const match = path.match(
        /^\/requests\/(aigora|scaena|eikona|sonora)\/([^/]+)(\/content:read)?$/,
      );
      if (match) {
        const owner = match[1] as Owner,
          id = pathParam(match[2]);
        if (
          !id ||
          id.length > 500 ||
          /[\/\\\x00-\x1f]/.test(id) ||
          id === "." ||
          id === ".."
        )
          throw new AuthError("invalid_reference", 400);
        if (r.method === "GET" && !match[3])
          return json(withEpoch(session, await readers.detail(owner, id, session, scope)));
        if (r.method === "POST" && match[3]) {
          auth.csrf(r, session);
          const raw = await r.text();
          if (raw.length > 2048)
            throw new AuthError("invalid_content_request", 400);
          const body = jsonObject<Record<string, any>>(raw, "invalid_content_request");
          if (
            !["input", "output"].includes(body.direction) ||
            typeof body.purpose !== "string" ||
            !body.purpose.trim() ||
            body.purpose.length > 200 ||
            Object.keys(body).some((k) => !["direction", "purpose"].includes(k))
          )
            throw new AuthError("invalid_content_request", 400);
          // Audit-first: the initiated row must be durable before any owner read.
          const content = await audited({
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            scopeId: scope.id,
            action: "requests.content_read",
            owner,
            targetRef: id,
            purpose: body.purpose.trim(),
            meta: { direction: body.direction },
          }, async (settle) => {
            const read = await readers.content(
              owner,
              id,
              body.direction,
              body.purpose.trim(),
              session,
              scope,
            );
            if (read.state === "forbidden" || read.state === "unavailable") settle("unavailable");
            return read;
          });
          return json(content);
        }
      }
      return methodNotAllowed([]);
    } catch (e) {
      return json(
        e instanceof AuthError
          ? { error: e.code, class: errorClass(e) }
          : { error: "source_unavailable", class: "unavailable" },
        e instanceof AuthError ? e.status : 503,
      );
    }
  };
  return { handle, services };
}

/** The request handler alone, for callers that run no background work. */
export function createApp(config: ServerConfig, deps: ControlCenterDeps = {}) {
  return createControlCenter(config, deps).handle;
}
