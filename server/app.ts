import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { AuthError, SessionAuth } from "./auth";
import { OwnerReaders, owners } from "./owners";
import { TaskConnections } from "./task-connections";
import { MediaBridge } from "./media";
import { serviceDirectory } from "./service-directory";
import type { TaskSnapshot } from "../src/task-observation";
import type { ServerConfig, ScopeBinding, Session, Owner } from "./contracts";
import { AuditStore, auditActions, type AuditAction } from "./db/audit";
import { SessionStore } from "./db/session-store";
import { RunStore } from "./db/run-store";
import { ActionService, type PreviewRecord } from "./actions";
import type { ActionConfirmRequest, ActionPreviewRequest, ActionReceipt } from "../src/shared/action-contract";
import { createMemoryDB, type ControlDB } from "./db/client";
import { NotificationStore, attentionStates, type FailureFact } from "./notifications";
import {
  ProviderRunManager,
  type ProviderRunRequest,
} from "./provider-live";
import { AuctraCollectionReader } from "./auctra";
import { AuctraCollectionStore } from "./db/auctra-collection-store";
import { ProjectMetadataStore } from "./db/project-metadata-store";
import { buildWorkQueue, filterAndPageWorkQueue } from "./work-queue";
import { workQueueKinds } from "../src/shared/work-queue";
import { buildCreativeFlow } from "./creative-flow";
import { ScaenaStoryboardReader } from "./scaena-storyboard";
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

export function createApp(
  config: ServerConfig,
  deps: {
    auth?: SessionAuth;
    readers?: OwnerReaders;
    tasks?: TaskConnections;
    providers?: ProviderRunManager;
    auctra?: AuctraCollectionReader;
    scaenaStoryboard?: ScaenaStoryboardReader;
    db?: ControlDB;
  } = {},
) {
  const db = deps.db ?? createMemoryDB(),
    auth = deps.auth || new SessionAuth(config, undefined, new SessionStore(db)),
    readers = deps.readers || new OwnerReaders(config),
    tasks = deps.tasks || new TaskConnections(config),
    providers =
      deps.providers || new ProviderRunManager(config, undefined, new RunStore(db)),
    auctra = deps.auctra || new AuctraCollectionReader(config),
    scaenaStoryboard = deps.scaenaStoryboard || new ScaenaStoryboardReader(config),
    collectionStore = new AuctraCollectionStore(db),
    projectMetadata = new ProjectMetadataStore(db),
    audit = new AuditStore(db),
    notifications = new NotificationStore(db),
    media = new MediaBridge(tasks, undefined, audit),
    actions = new ActionService(),
    cursorKey = randomBytes(32);
  const scoped = (s: Session, id: string | null): ScopeBinding => {
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
  const readCreativeFlow = async (scope: ScopeBinding, session: Session, query: { episode_ref?: string; breakdown_ref?: string } = {}) => {
    const projectRef = scope.project;
    const auctraFlow = await auctra.creativeFlow(scope.id, scope, session, { episode_ref: query.episode_ref });
    const scaena = await scaenaStoryboard.snapshot(scope, session, query);
    return buildCreativeFlow({ scope: scope.id, project_ref: projectRef, ...(query.episode_ref ? { episode_ref: query.episode_ref } : {}), auctra_flow: auctraFlow, scaena });
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
  return async (r: Request): Promise<Response> => {
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
          Object.keys(body).some((k) => !["password", "key", "username"].includes(k))
        )
          throw new AuthError("invalid_login_request", 400);
        try {
          const result = await auth.personalLogin(r, body.key || body.password, body.username);
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
          audit.record(
            {
              actor: typeof body.username === "string" ? body.username : "owner",
              action: "auth.login",
              meta: { mode: "personal" },
            },
            e instanceof AuthError && e.status === 401 ? "denied" : "failed",
            auditError(e),
          );
          throw e;
        }
      }
      if (r.method === "GET" && path === "/auth/methods")
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
          scopes: p.scopes.map(({ owners: bindings, collection, ...scope }) => ({
            ...scope,
            owners: [...Object.keys(bindings), ...Object.keys(collection || {})],
          })),
          mode: "live",
          task_connections: session.personal === true,
        });
      }
      if (path === "/admin/personal-users" || path.startsWith("/admin/personal-users/")) {
        if (!session.personal || auth.role(session) !== "admin") throw new AuthError("control_center_admin_required", 403);
        if (r.method === "GET") return json({ users: auth.listPersonalUsers() });
        if (r.method === "POST") {
          auth.csrf(r, session);
          const raw = await r.text();
          if (raw.length > 4096) throw new AuthError("invalid_request", 400);
          let body;
          try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_request", 400); }
          if (!body || typeof body.username !== "string" || typeof body.name !== "string" || !["admin", "viewer"].includes(body.role) || !Array.isArray(body.scope_ids) || body.scope_ids.some((id: unknown) => typeof id !== "string") || Object.keys(body).some((key) => !["username", "name", "role", "scope_ids"].includes(key))) throw new AuthError("invalid_request", 400);
          const eventId = audit.begin({
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            action: "admin.user_created",
            targetRef: body.username,
          });
          try {
            const created = await auth.createPersonalUser({ username: body.username, name: body.name, role: body.role, scope_ids: body.scope_ids });
            audit.complete(eventId, "succeeded");
            return json(created, 201);
          } catch (e) {
            audit.complete(eventId, auditOutcome(e), auditError(e));
            throw e;
          }
        }
        const revoke = path.match(/^\/admin\/personal-users\/([^/]+)\/revoke$/);
        if (revoke && r.method === "POST") {
          auth.csrf(r, session);
          const username = decodeURIComponent(revoke[1]);
          const eventId = audit.begin({
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            action: "admin.user_revoked",
            targetRef: username,
          });
          try {
            auth.revokePersonalUser(username);
            audit.complete(eventId, "succeeded");
          } catch (e) {
            audit.complete(eventId, auditOutcome(e), auditError(e));
            throw e;
          }
          return json({ ok: true });
        }
        return methodNotAllowed(["GET", "POST"]);
      }
      if (r.method === "GET" && path === "/audit") {
        if (auth.role(session) !== "admin")
          throw new AuthError("control_center_admin_required", 403);
        const before = url.searchParams.get("before"),
          limit = Number(url.searchParams.get("limit") || 50),
          action = url.searchParams.get("action") || undefined;
        if (
          (before !== null && !/^\d{1,16}$/.test(before)) ||
          ![25, 50, 100].includes(limit) ||
          (action !== undefined &&
            !auditActions.includes(action as AuditAction))
        )
          throw new AuthError("invalid_query", 400);
        return json(
          audit.page({
            before: before ? Number(before) : undefined,
            limit,
            action,
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
      const scope = scoped(session, url.searchParams.get("scope"));
      if (r.method === "GET" && path === "/creative-flow") {
        const episode_ref = url.searchParams.get("episode_ref") || undefined;
        const breakdown_ref = url.searchParams.get("breakdown_ref") || undefined;
        for (const value of [episode_ref, breakdown_ref]) if (value && (value.length > 512 || /[\x00-\x1f]/.test(value))) throw new AuthError("invalid_reference", 400);
        return json(withEpoch(session, await readCreativeFlow(scope, session, { episode_ref, breakdown_ref })));
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
        const result = collectionStore.list(scope.id, {
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
        const localCoverage = collectionStore.coverage(scope.id);
        return json(withEpoch(session, { schema_version: "yeisme.auctra.collection.page.v1", owner: "auctra", scope: scope.id, observed_at: localCoverage.observed_at || new Date().toISOString(), coverage: config.collection?.auctra ? localCoverage.state : "unknown", rows: result.rows, total: result.total, ...(result.nextCursor !== undefined ? { next_cursor: String(result.nextCursor) } : {}) }));
      }
      const collectionRecordMatch = path.match(/^\/auctra\/collection\/records\/([^/]+)$/);
      if (r.method === "GET" && collectionRecordMatch) {
        return json(withEpoch(session, { schema_version: "yeisme.auctra.collection.record.v1", owner: "auctra", scope: scope.id, observed_at: new Date().toISOString(), record: collectionStore.get(scope.id, decodeURIComponent(collectionRecordMatch[1])) }));
      }
      if (r.method === "POST" && path === "/auctra/collection/sync") {
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 8192) throw new AuthError("invalid_request", 413);
        let body: { cursor?: string; updated_after?: string; limit?: number } = {};
        if (raw) {
          try { body = JSON.parse(raw) as typeof body; } catch { throw new AuthError("invalid_request", 400); }
        }
        const limit = Number(body.limit || url.searchParams.get("limit") || 100);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AuthError("invalid_query", 400);
        const eventId = audit.begin({ actor: session.issuer + "|" + session.subject, sessionId: session.id, scopeId: scope.id, action: "auctra.collection.sync", owner: "auctra", purpose: "metadata_collection" });
        try {
          const snapshot = await auctra.snapshot(scope.id, scope, session, { cursor: body.cursor || url.searchParams.get("cursor") || undefined, updated_after: body.updated_after || url.searchParams.get("updated_after") || undefined, limit });
          const fingerprint = createHash("sha256").update(JSON.stringify([config.collection?.auctra?.origin || "", scope.collection?.auctra?.project || ""])).digest("hex");
          const counts = snapshot.coverage === "complete" ? collectionStore.upsertSnapshot(scope.id, snapshot) : { inserted: 0, updated: 0, returned: 0, total: 0 };
          if (snapshot.coverage === "complete") collectionStore.saveCursor(scope.id, fingerprint, snapshot.next_cursor || "", createHash("sha256").update(JSON.stringify(snapshot.records)).digest("hex"), snapshot.coverage);
          audit.complete(eventId, snapshot.coverage === "complete" ? "succeeded" : "unavailable", snapshot.blocker);
          return json(withEpoch(session, { schema_version: "yeisme.auctra.collection.sync.v1", sync_ref: "sync_" + randomBytes(12).toString("hex"), scope: scope.id, coverage: snapshot.coverage, freshness: snapshot.freshness, observed_at: snapshot.observed_at, cursor: snapshot.next_cursor || null, counts, blocker: snapshot.blocker || null }), 200);
        } catch (e) {
          audit.complete(eventId, auditOutcome(e), auditError(e));
          throw e;
        }
      }
      const subject = session.issuer + "|" + session.subject;
      const failureOf = (task: TaskSnapshot): FailureFact => ({
        scope_id: scope.id,
        task_key: task.task_key || "",
        state: task.state,
        revision: task.revision || "",
        native_state: task.native_state || "",
        error_code: task.provider_recovery?.error_code || "",
        title: task.title,
        owner: task.locator.owner,
        project: task.locator.project,
      });
      if (path === "/notifications" || path.startsWith("/notifications/")) {
        // Reminder state is control-center data and follows the signed-in scope.
        const identity = { scopeId: scope.id, sessionId: session.id, subject };
        if (r.method === "GET" && path === "/notifications") {
          notifications.cleanup(scope.id, session.id, subject);
          const rows = notifications.list(scope.id, session.id, subject);
          return json(withEpoch(session, {
            rows,
            unread: rows.filter((row) => notifications.actionable(row)).length,
          }));
        }
        if (r.method === "POST" && path === "/notifications/sync") {
          auth.csrf(r, session);
          const raw = await r.text();
          if (raw.length > 512_000) throw new AuthError("invalid_request", 413);
          let body: { tasks?: TaskSnapshot[]; present_task_keys?: string[]; complete?: boolean };
          try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_request", 400); }
          if (!body || !Array.isArray(body.tasks) || body.tasks.length > 2000) throw new AuthError("invalid_request", 400);
          const observed = body.tasks.flatMap((task) => {
            if (!task || typeof task !== "object" || !task.locator || typeof task.locator !== "object") return [];
            if (!attentionStates.has(String(task.state || "")) || typeof task.task_key !== "string") return [];
            return [failureOf(task)];
          });
          const result = notifications.sync({
            ...identity,
            observed,
            presentTaskKeys: Array.isArray(body.present_task_keys) ? body.present_task_keys.filter((key) => typeof key === "string").slice(0, 4000) : undefined,
            complete: body.complete !== false,
          });
          const rows = notifications.list(scope.id, session.id, subject);
          return json(withEpoch(session, {
            ...result,
            rows,
            unread: rows.filter((row) => notifications.actionable(row)).length,
            owner_writes: 0,
          }));
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
          const result = notifications.bulk({ ...identity, action: body.action, ids: body.ids, all: body.all === true });
          return json({ ...result, task_states_changed: 0 });
        }
        if (r.method === "POST" && path === "/notifications/cleanup") {
          auth.csrf(r, session);
          const result = notifications.cleanup(scope.id, session.id, subject);
          return json({ ...result, task_states_changed: 0 });
        }
        const one = path.match(/^\/notifications\/([^/]+)\/(acknowledge|mute|archive|reopen)$/);
        if (one && r.method === "POST") {
          auth.csrf(r, session);
          const id = decodeURIComponent(one[1]);
          const action = one[2];
          if (action === "mute") {
            const raw = await r.text();
            let muteScope: "fingerprint" | "error_code" = "fingerprint";
            if (raw) {
              if (raw.length > 256) throw new AuthError("invalid_request", 400);
              let body: { scope?: string };
              try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_request", 400); }
              if (body?.scope === "error_code") muteScope = "error_code";
              else if (body?.scope && body.scope !== "fingerprint") throw new AuthError("invalid_request", 400);
            }
            return json({ ...notifications.mute(id, scope.id, session.id, subject, undefined, muteScope), task_states_changed: 0 });
          }
          const updated = action === "acknowledge"
            ? notifications.acknowledge(id, scope.id, session.id, subject)
            : action === "archive"
              ? notifications.archive(id, scope.id, session.id, subject)
              : notifications.reopen(id, scope.id, session.id, subject);
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
        if (raw.length > 16_384) throw new AuthError("invalid_action_request", 413);
        let body: ActionPreviewRequest;
        try { body = JSON.parse(raw) as ActionPreviewRequest; } catch { throw new AuthError("invalid_action_request", 400); }
        if (!body || body.scope_id !== scope.id || typeof body.owner !== "string" || typeof body.target_kind !== "string" || typeof body.target_ref !== "string" || typeof body.action !== "string" || typeof body.expected_revision !== "string" || typeof body.idempotency_key !== "string" || !body.input || typeof body.input !== "object") throw new AuthError("invalid_action_request", 400);
        const eventId = audit.begin({ actor: session.issuer + "|" + session.subject, sessionId: session.id, scopeId: scope.id, action: "actions.preview", owner: body.owner, targetRef: body.target_ref, meta: { action: body.action, target_kind: body.target_kind } });
        try {
          const preview = actions.preview(body);
          audit.complete(eventId, "succeeded");
          return json(withEpoch(session, preview));
        } catch (e) {
          audit.complete(eventId, auditOutcome(e), auditError(e));
          throw e;
        }
      }
      if (path === "/actions/confirm" && r.method === "POST") {
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 4096) throw new AuthError("invalid_action_request", 413);
        let body: ActionConfirmRequest;
        try { body = JSON.parse(raw) as ActionConfirmRequest; } catch { throw new AuthError("invalid_action_request", 400); }
        if (!body || body.scope_id !== scope.id || typeof body.preview_ref !== "string" || typeof body.preview_digest !== "string" || typeof body.idempotency_key !== "string") throw new AuthError("invalid_action_request", 400);
        const eventId = audit.begin({ actor: session.issuer + "|" + session.subject, sessionId: session.id, scopeId: scope.id, action: "actions.confirm", targetRef: body.preview_ref });
        try {
          const receipt = await actions.confirm(body, async (record: PreviewRecord): Promise<ActionReceipt> => {
            if (record.preview.availability !== "available") return ActionService.unavailable(record, record.preview.blockers[0] || "action_unavailable");
            const input = record.request.input;
            if (record.request.action === "task.cancel") {
              if (input.confirm !== true || typeof input.expected_revision !== "string") throw new AuthError("invalid_action_input", 400);
              const result = await tasks.cancel(record.request.target_ref, scope, input.expected_revision, record.request.idempotency_key, false);
              return { receipt_ref: "receipt_" + randomBytes(12).toString("hex"), action: record.request.action, owner: record.request.owner, target_ref: record.request.target_ref, state: result.receipt.outcome === "unknown" ? "unknown" : result.receipt.outcome === "cancelled" || result.receipt.outcome === "already_terminal" ? "succeeded" : "failed", owner_state: result.receipt.outcome, error_code: null, observed_at: result.receipt.occurred_at || new Date().toISOString(), operation_ref: result.receipt.ref, result_refs: [] };
            }
            if (record.request.action === "provider_runs.create") {
              const run = await providers.create(input as any, scope, session);
              return { receipt_ref: "receipt_" + randomBytes(12).toString("hex"), action: record.request.action, owner: record.request.owner, target_ref: record.request.target_ref, state: run.state === "unknown" ? "unknown" : run.state === "failed" ? "failed" : "submitted", owner_state: run.state, error_code: run.error_code || null, observed_at: run.observed_at, operation_ref: run.run_ref, result_refs: run.output_refs };
            }
            if (record.request.action === "provider_runs.reconcile") {
              if (typeof input.run_ref !== "string") throw new AuthError("invalid_action_input", 400);
              const run = await providers.reconcile(input.run_ref);
              return { receipt_ref: "receipt_" + randomBytes(12).toString("hex"), action: record.request.action, owner: record.request.owner, target_ref: record.request.target_ref, state: run.state === "unknown" ? "unknown" : run.state === "failed" ? "failed" : "succeeded", owner_state: run.state, error_code: run.error_code || null, observed_at: run.observed_at, operation_ref: run.run_ref, result_refs: run.output_refs };
            }
            if (record.request.owner === "control-center" && record.request.action.startsWith("collection.record.")) {
              const expected = String(input.expected_revision || "");
              const actor = session.issuer + "|" + session.subject;
              const recordRef = record.request.target_ref;
              const result = record.request.action === "collection.record.confirm"
                ? collectionStore.confirm(scope.id, recordRef, expected, actor)
                : record.request.action === "collection.record.archive"
                  ? collectionStore.archive(scope.id, recordRef, expected, actor)
                  : record.request.action === "collection.record.labels.set"
                    ? collectionStore.labels(scope.id, recordRef, expected, actor, Array.isArray(input.labels) ? input.labels.filter((value): value is string => typeof value === "string") : [])
                    : collectionStore.note(scope.id, recordRef, expected, actor, typeof input.note === "string" ? input.note : "");
              return { receipt_ref: "receipt_" + randomBytes(12).toString("hex"), action: record.request.action, owner: "control-center", target_ref: recordRef, state: "succeeded", owner_state: result.collection_state, error_code: null, observed_at: new Date().toISOString(), operation_ref: recordRef, result_refs: [recordRef] };
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
              return { receipt_ref: "receipt_" + randomBytes(12).toString("hex"), action: record.request.action, owner: "control-center", target_ref: record.request.target_ref, state: "succeeded", owner_state: result.hidden ? "hidden" : "visible", error_code: null, observed_at: new Date().toISOString(), operation_ref: record.request.target_ref, result_refs: [record.request.target_ref] };
            }
            if (record.request.action === "admin.user.create") {
              if (typeof input.username !== "string" || typeof input.name !== "string" || !["admin", "viewer"].includes(String(input.role)) || !Array.isArray(input.scope_ids)) throw new AuthError("invalid_action_input", 400);
              const created = await auth.createPersonalUser({ username: input.username, name: input.name, role: input.role as "admin" | "viewer", scope_ids: input.scope_ids.filter((value): value is string => typeof value === "string") });
              return { receipt_ref: "receipt_" + randomBytes(12).toString("hex"), action: record.request.action, owner: record.request.owner, target_ref: record.request.target_ref, state: "succeeded", owner_state: "created", error_code: null, observed_at: new Date().toISOString(), operation_ref: created.user.username, result_refs: [] };
            }
            if (record.request.action === "admin.user.revoke") {
              if (typeof input.username !== "string") throw new AuthError("invalid_action_input", 400);
              auth.revokePersonalUser(input.username);
              return { receipt_ref: "receipt_" + randomBytes(12).toString("hex"), action: record.request.action, owner: record.request.owner, target_ref: record.request.target_ref, state: "succeeded", owner_state: "revoked", error_code: null, observed_at: new Date().toISOString(), operation_ref: input.username, result_refs: [] };
            }
            return ActionService.unavailable(record, "owner_action_adapter_not_configured");
          });
          audit.complete(eventId, receipt.state === "succeeded" || receipt.state === "submitted" ? "succeeded" : receipt.state === "needs_contract" ? "unavailable" : "failed", receipt.error_code || undefined);
          if (receipt.action.startsWith("project.metadata.")) {
            audit.record({
              actor: session.issuer + "|" + session.subject,
              sessionId: session.id,
              scopeId: scope.id,
              action: "actions.confirm",
              owner: receipt.owner,
              targetRef: receipt.target_ref,
              meta: { action: receipt.action, state: receipt.state, owner_state: receipt.owner_state },
            }, receipt.state === "succeeded" ? "succeeded" : receipt.state === "needs_contract" ? "unavailable" : "failed", receipt.error_code || undefined);
          }
          return json(withEpoch(session, receipt), 202);
        } catch (e) {
          audit.complete(eventId, auditOutcome(e), auditError(e));
          throw e;
        }
      }
      const receiptMatch = path.match(/^\/actions\/receipts\/([^/]+)$/);
      if (receiptMatch && r.method === "GET") {
        const receipt = actions.receipt(decodeURIComponent(receiptMatch[1]), scope.id);
        audit.record({ actor: session.issuer + "|" + session.subject, sessionId: session.id, scopeId: scope.id, action: "actions.receipt_read", targetRef: receipt.receipt_ref, meta: { action: receipt.action } }, "succeeded");
        return json(withEpoch(session, receipt));
      }
      if (r.method === "GET" && path === "/services")
        return json(withEpoch(session, serviceDirectory(config, scope, session,
          session.personal && url.searchParams.get("observe") === "1" ? await tasks.observe(scope) : [])));
      if (r.method === "GET" && path === "/capabilities")
        return json(withEpoch(session, { scope: scope.id, capabilities: await providers.capabilities(scope) }));
      if (r.method === "GET" && path === "/usage")
        return json(withEpoch(session, {
          scope: scope.id,
          rows: providers.usageRows(scope),
          budget: providers.budgetStatus(),
          coverage: { state: "partial", observed_at: new Date().toISOString(), reason: "仅包含已接入 Provider 回执；历史 owner 账本仍按来源读取" },
        }));
      if (path === "/provider-runs" && r.method === "POST") {
        auth.csrf(r, session);
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
          !body.budget_cap || body.budget_cap.currency !== "CNY" ||
          typeof body.budget_cap.amount !== "number" || !Number.isFinite(body.budget_cap.amount) ||
          typeof body.idempotency_key !== "string" ||
          (body.trace_ref !== undefined && typeof body.trace_ref !== "string") || !creativeInputValid)
          throw new AuthError("invalid_provider_request", 400);
        const eventId = audit.begin({
          actor: session.issuer + "|" + session.subject,
          sessionId: session.id,
          scopeId: scope.id,
          action: "provider_runs.create",
          owner: body.owner,
          targetRef: body.idempotency_key,
          meta: { modality: body.modality, model_ref: body.model_ref, budget_amount: body.budget_cap.amount },
        });
        try {
          const result = await providers.create(body as ProviderRunRequest, scope, session);
          audit.complete(eventId, result.state === "failed" ? "failed" : "succeeded", result.error_code ?? undefined);
          return json(result, 202);
        } catch (e) {
          audit.complete(eventId, auditOutcome(e), auditError(e));
          throw e;
        }
      }
      const providerRun = path.match(/^\/provider-runs\/([^/]+)(\/events|\/reconcile)?$/);
      if (providerRun) {
        const runRef = decodeURIComponent(providerRun[1]);
        const run = providers.get(runRef);
        if (!run || run.scope_id !== scope.id) throw new AuthError("run_not_found", 404);
        if (r.method === "GET" && !providerRun[2]) return json(run);
        if (r.method === "POST" && providerRun[2] === "/reconcile") {
          auth.csrf(r, session);
          const eventId = audit.begin({
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            scopeId: scope.id,
            action: "provider_runs.reconcile",
            owner: run.owner,
            targetRef: runRef,
          });
          try {
            const reconciled = await providers.reconcile(runRef);
            audit.complete(eventId, "succeeded");
            return json(reconciled);
          } catch (e) {
            audit.complete(eventId, auditOutcome(e), auditError(e));
            throw e;
          }
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
        const [active, history, observed, creativeFlow] = await Promise.all([
          session.personal ? tasks.list(scope, "active") : Promise.resolve({ rows: [], connections: [], next_cursors: {} }),
          session.personal ? tasks.list(scope, "history") : Promise.resolve({ rows: [], connections: [], next_cursors: {} }),
          session.personal ? tasks.observe(scope) : Promise.resolve([]),
          readCreativeFlow(scope, session),
        ]);
        const taskRows = [...active.rows, ...history.rows].filter((task, index, rows) => rows.findIndex((candidate) => candidate.task_key === task.task_key) === index);
        const connections = observed.length ? observed : [...active.connections, ...history.connections].filter((connection, index, rows) => rows.findIndex((candidate) => candidate.id === connection.id) === index);
        const full = buildWorkQueue({
          scope,
          session,
          tasks: taskRows,
          connections,
          notifications: notifications.list(scope.id, session.id, subject),
          creativeFlow,
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
            !["preview", "download"].includes(b.purpose) ||
            Object.keys(b).some((k) => k !== "purpose")
          )
            throw new AuthError("invalid_request", 400);
          const eventId = audit.begin({
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            scopeId: scope.id,
            action: "tasks.artifact_access",
            targetRef: decodeURIComponent(artifact[2]),
            purpose: b.purpose,
          });
          try {
            const granted = await media.issue(
              session,
              scope,
              decodeURIComponent(artifact[1]),
              decodeURIComponent(artifact[2]),
              b.purpose as "preview" | "download",
            );
            audit.complete(eventId, "succeeded");
            return json(granted);
          } catch (e) {
            audit.complete(eventId, auditOutcome(e), auditError(e));
            throw e;
          }
        }
        const t = path.match(
          /^\/tasks\/([^/]+)(\/events|\/cancel|\/cancel-receipt)?$/,
        );
        if (t) {
          const key = decodeURIComponent(t[1]);
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
            const eventId = audit.begin({
              actor: session.issuer + "|" + session.subject,
              sessionId: session.id,
              scopeId: scope.id,
              action: "tasks.cancel",
              targetRef: key,
              meta: { expected_revision: b.expected_revision, idempotency_key: b.idempotency_key },
            });
            try {
              const result = await tasks.cancel(
                key,
                scope,
                b.expected_revision,
                b.idempotency_key,
              );
              audit.complete(eventId, "succeeded");
              return json(result);
            } catch (e) {
              audit.complete(eventId, auditOutcome(e), auditError(e));
              throw e;
            }
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
          id = decodeURIComponent(attachmentRead[2]),
          attachmentRef = decodeURIComponent(attachmentRead[3]);
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
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          throw new AuthError("invalid_content_request", 400);
        }
        if (
          !["input", "output"].includes(body.direction) ||
          typeof body.purpose !== "string" ||
          !body.purpose.trim() ||
          body.purpose.length > 200 ||
          Object.keys(body).some((k) => !["direction", "purpose"].includes(k))
        )
          throw new AuthError("invalid_content_request", 400);
        // Audit-first, same as text content: no owner call without a durable row.
        const eventId = audit.begin({
          actor: session.issuer + "|" + session.subject,
          sessionId: session.id,
          scopeId: scope.id,
          action: "requests.attachment_read",
          owner,
          targetRef: id + "#" + attachmentRef,
          purpose: body.purpose.trim(),
          meta: { direction: body.direction },
        });
        try {
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
            audit.complete(eventId, "succeeded");
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
          audit.complete(
            eventId,
            read.state === "forbidden" || read.state === "unavailable"
              ? "unavailable"
              : "succeeded",
          );
          return json({
            state: read.state,
            text: read.text,
            truncated: read.truncated,
            receipt_ref: read.receipt_ref,
            mime: read.mime,
          });
        } catch (e) {
          audit.complete(eventId, auditOutcome(e), auditError(e));
          throw e;
        }
      }
      const observationRead = path.match(
        /^\/requests\/(aigora|scaena|eikona|sonora)\/([^/]+)\/observations$/,
      );
      if (observationRead && r.method === "GET") {
        const owner = observationRead[1] as Owner;
        const id = decodeURIComponent(observationRead[2]);
        if (!id || id.length > 500 || /[\/\\\x00-\x1f]/.test(id))
          throw new AuthError("invalid_reference", 400);
        return json(withEpoch(session, await readers.observations(owner, id, url.searchParams.get("after") || undefined, session, scope)));
      }
      const match = path.match(
        /^\/requests\/(aigora|scaena|eikona|sonora)\/([^/]+)(\/content:read)?$/,
      );
      if (match) {
        const owner = match[1] as Owner,
          id = decodeURIComponent(match[2]);
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
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            throw new AuthError("invalid_content_request", 400);
          }
          if (
            !["input", "output"].includes(body.direction) ||
            typeof body.purpose !== "string" ||
            !body.purpose.trim() ||
            body.purpose.length > 200 ||
            Object.keys(body).some((k) => !["direction", "purpose"].includes(k))
          )
            throw new AuthError("invalid_content_request", 400);
          // Audit-first: the initiated row must be durable before any owner read.
          const eventId = audit.begin({
            actor: session.issuer + "|" + session.subject,
            sessionId: session.id,
            scopeId: scope.id,
            action: "requests.content_read",
            owner,
            targetRef: id,
            purpose: body.purpose.trim(),
            meta: { direction: body.direction },
          });
          try {
            const content = await readers.content(
              owner,
              id,
              body.direction,
              body.purpose.trim(),
              session,
              scope,
            );
            audit.complete(
              eventId,
              content.state === "forbidden" || content.state === "unavailable"
                ? "unavailable"
                : "succeeded",
            );
            return json(content);
          } catch (e) {
            audit.complete(eventId, auditOutcome(e), auditError(e));
            throw e;
          }
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
}
