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
import {
  ProviderRunManager,
  type ProviderRunRequest,
} from "./provider-live";
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
export function createApp(
  config: ServerConfig,
  deps: {
    auth?: SessionAuth;
    readers?: OwnerReaders;
    tasks?: TaskConnections;
    providers?: ProviderRunManager;
  } = {},
) {
  const auth = deps.auth || new SessionAuth(config),
    readers = deps.readers || new OwnerReaders(config),
    tasks = deps.tasks || new TaskConnections(config),
    providers = deps.providers || new ProviderRunManager(config),
    media = new MediaBridge(tasks),
    cursorKey = randomBytes(32);
  const scoped = (s: Session, id: string | null): ScopeBinding => {
    const p = auth.principal(s);
    const scope = p?.scopes.find((v) => v.id === id);
    if (!scope) throw new AuthError("scope_not_found", 404);
    return scope;
  };
  const fingerprint = (s: Session, scope: ScopeBinding, q: RequestQuery) =>
    createHash("sha256")
      .update(JSON.stringify([s.issuer, s.subject, scope, q]))
      .digest("hex");
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
        const result = await auth.personalLogin(r, body.key || body.password, body.username);
        return json({ ok: true }, 200, { "Set-Cookie": result.cookie });
      }
      if (r.method === "GET" && path === "/auth/methods")
        return json({
          personal: config.auth_mode === "personal" && !!config.personal,
          username_required: !!config.personal && ((config.personal.users?.length || 0) > 0 || config.personal.username !== undefined),
          key_required: !!config.personal && (config.personal.users?.length || 0) > 0,
          oidc: config.auth_mode !== "personal" && !!config.oidc,
          mode: "live",
          owners: owners.map((owner) => ({
            owner,
            configured: !!config.owners[owner],
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
        const b = await auth.callback(r);
        const h = new Headers({ Location: "/", "Cache-Control": "no-store" });
        h.append("Set-Cookie", b.cookie);
        h.append("Set-Cookie", b.clear);
        return new Response(null, { status: 302, headers: h });
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
          scopes: p.scopes.map(({ owners: bindings, ...scope }) => ({
            ...scope,
            owners: Object.keys(bindings),
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
          return json(await auth.createPersonalUser({ username: body.username, name: body.name, role: body.role, scope_ids: body.scope_ids }), 201);
        }
        const revoke = path.match(/^\/admin\/personal-users\/([^/]+)\/revoke$/);
        if (revoke && r.method === "POST") {
          auth.csrf(r, session);
          auth.revokePersonalUser(decodeURIComponent(revoke[1]));
          return json({ ok: true });
        }
        return json({ error: "operation_not_allowed" }, 405);
      }
      if (r.method === "POST" && path === "/auth/logout") {
        auth.csrf(r, session);
        auth.sessions.delete(session.id);
        return json({ ok: true }, 200, { "Set-Cookie": auth.cookie("", 0) });
      }
      const scope = scoped(session, url.searchParams.get("scope"));
      if (r.method === "GET" && path === "/services")
        return json(serviceDirectory(config, scope, session,
          session.personal && url.searchParams.get("observe") === "1" ? await tasks.observe(scope) : []));
      if (r.method === "GET" && path === "/capabilities")
        return json({ scope: scope.id, capabilities: await providers.capabilities(scope) });
      if (r.method === "GET" && path === "/usage")
        return json({
          scope: scope.id,
          rows: providers.usageRows(scope),
          budget: providers.budgetStatus(),
          coverage: { state: "partial", observed_at: new Date().toISOString(), reason: "仅包含已接入 Provider 回执；历史 owner 账本仍按来源读取" },
        });
      if (path === "/provider-runs" && r.method === "POST") {
        auth.csrf(r, session);
        const raw = await r.text();
        if (raw.length > 12000) throw new AuthError("invalid_provider_request", 400);
        let body: any;
        try { body = JSON.parse(raw); } catch { throw new AuthError("invalid_provider_request", 400); }
        const allowed = ["mode", "owner", "modality", "model_ref", "scope_id", "project_ref", "prompt", "budget_cap", "idempotency_key", "trace_ref"];
        if (!body || Object.keys(body).some((key) => !allowed.includes(key)) ||
          body.mode !== "live" || !["eikona", "scaena", "sonora"].includes(body.owner) ||
          !["image", "video", "audio"].includes(body.modality) ||
          typeof body.model_ref !== "string" || body.model_ref.length < 1 || body.model_ref.length > 200 ||
          typeof body.scope_id !== "string" || typeof body.project_ref !== "string" ||
          typeof body.prompt !== "string" || body.prompt.length < 1 || body.prompt.length > 10000 ||
          !body.budget_cap || body.budget_cap.currency !== "CNY" ||
          typeof body.budget_cap.amount !== "number" || !Number.isFinite(body.budget_cap.amount) ||
          typeof body.idempotency_key !== "string" ||
          (body.trace_ref !== undefined && typeof body.trace_ref !== "string"))
          throw new AuthError("invalid_provider_request", 400);
        const result = await providers.create(body as ProviderRunRequest, scope, session);
        return json(result, 202);
      }
      const providerRun = path.match(/^\/provider-runs\/([^/]+)(\/events|\/reconcile)?$/);
      if (providerRun) {
        const runRef = decodeURIComponent(providerRun[1]);
        const run = providers.get(runRef);
        if (!run || run.scope_id !== scope.id) throw new AuthError("run_not_found", 404);
        if (r.method === "GET" && !providerRun[2]) return json(run);
        if (r.method === "POST" && providerRun[2] === "/reconcile") {
          auth.csrf(r, session);
          return json(await providers.reconcile(runRef));
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
        if (!session.personal)
          throw new AuthError("personal_connection_required", 403);
        if (!["GET", "HEAD"].includes(r.method))
          throw new AuthError("operation_not_allowed", 405);
        return await media.read(
          path.slice("/media/".length),
          r,
          session,
          scope,
        );
      }
      if (
        path === "/connections" ||
        path === "/tasks" ||
        path.startsWith("/tasks/")
      ) {
        if (!session.personal)
          throw new AuthError("personal_connection_required", 403);
        if (r.method === "GET" && path === "/connections")
          return json({
            connections: await tasks.observe(scope),
          });
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
          return json({ ...page, rows: page.rows.map(permittedTask) });
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
          return json(permittedTask(await tasks.resolve(scope, target)));
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
          return json(
            await media.issue(
              session,
              scope,
              decodeURIComponent(artifact[1]),
              decodeURIComponent(artifact[2]),
              b.purpose as "preview" | "download",
            ),
          );
        }
        const t = path.match(
          /^\/tasks\/([^/]+)(\/events|\/cancel|\/cancel-receipt)?$/,
        );
        if (t) {
          const key = decodeURIComponent(t[1]);
          if (r.method === "GET" && !t[2])
            return json(permittedTask(await tasks.detail(key, scope)));
          if (r.method === "GET" && t[2] === "/events")
            return json(
              await tasks.events(
                key,
                scope,
                url.searchParams.get("cursor") || undefined,
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
            return json(
              await tasks.cancel(
                key,
                scope,
                b.expected_revision,
                b.idempotency_key,
              ),
            );
          }
        }
        return json({ error: "operation_not_allowed" }, 405);
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
        return json({ tenant: scope.tenant, sources: results });
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
          return json({
            sources: results,
            from: q.from,
            to: q.to,
            timezone: "Asia/Shanghai",
            complete: results.every((v) =>
              v.summary?.coverage?.every((c) => c.state === "complete"),
            ),
          });
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
        return json({
          rows,
          coverage: results.map((v) => v.coverage),
          page_scope: "per_source",
          next_cursor: Object.values(next).some(Boolean)
            ? sign({ fp, cursors: next, expires: Date.now() + 300000 })
            : undefined,
        });
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
          return json(await readers.detail(owner, id, session, scope));
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
          return json(
            await readers.content(
              owner,
              id,
              body.direction,
              body.purpose.trim(),
              session,
              scope,
            ),
          );
        }
      }
      return json({ error: "operation_not_allowed" }, 405);
    } catch (e) {
      return json(
        { error: e instanceof AuthError ? e.code : "source_unavailable" },
        e instanceof AuthError ? e.status : 503,
      );
    }
  };
}
