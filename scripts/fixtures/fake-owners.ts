import { randomBytes } from "node:crypto";
import { buildRequests, buildWorld, png, taskRow, type RequestRow, type Scenario, type TaskSpec } from "./world";
import { eikonaChannels, eikonaModels, eikonaRuntimeCapabilities, providerTools, scaenaGuide, sonoraDiscovery } from "./provider-catalog";

export const observerToken = "fixture-observer-token";
export const providerToken = "fixture-provider-token";
export const delegationToken = "fixture-delegation-token";
/** Per-owner service credential accepted by the request/org APIs. */
export const serviceToken = "fixture-service-token";

export interface FakeOwnerOptions {
  port: number;
  /** Separate origins for eikona/sonora request APIs, which share the same path shape. */
  requestPorts: { eikona: number; sonora: number };
  scenario: Scenario;
  latencyMs: number;
  videoBytes: Buffer | null;
  scopes: { tenant: string; project: string }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (length: number) => randomBytes(length / 2).toString("hex");
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** One fake process plays every owner: task MCP, provider MCP, request/org HTTP APIs and media bytes. */
export function startFakeOwners(options: FakeOwnerOptions) {
  const world = buildWorld(options.scenario, options.videoBytes);
  const grants = new Map<string, { media: string; expires: number }>();
  const requestsByScope = new Map(options.scopes.map((scope) => [scope.project, buildRequests(options.scenario, scope.tenant, scope.project)]));
  const origin = `http://127.0.0.1:${options.port}`;
  /** Fixture-only owner catalog drift switch, toggled by GET /__fixture/catalog-revision?value=N. */
  let catalogRevision = 0;

  const lookup = (connection: string, ref: string) => world.tasks[connection]?.find((task) => task.ref === ref);

  function listTasks(connection: string, mode: string, cursor: string | undefined, limit: number) {
    const all = (world.tasks[connection] || []).filter((task) => {
      const active = ["queued", "running", "pending", "created"].includes(task.state);
      return mode === "active" ? active : !active;
    }).sort((a, b) => a.updatedMinutes - b.updatedMinutes);
    const start = cursor ? Number(cursor.replace("page-", "")) : 0;
    const page = all.slice(start, start + limit);
    const next = start + limit < all.length ? `page-${start + limit}` : undefined;
    return { rows: page.map(taskRow), ...(next ? { next_cursor: next } : {}) };
  }

  function grantFor(spec: TaskSpec, rawRef: string) {
    const result = spec.results?.find((item) => item.ref === rawRef);
    if (!result || result.media === "missing" || !world.media.has(result.media)) return null;
    const id = hex(32);
    grants.set(id, { media: result.media, expires: Date.now() + 110_000 });
    return { id, result };
  }

  async function taskMcp(connection: string, body: any) {
    if (body?.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
    const action = body?.params?.arguments?.action;
    const raw = body?.params?.arguments?.args || {};
    const owner = String(body?.params?.name || "").split(".")[0];
    // Scaena receives {path, query}; others receive flat args.
    const args = owner === "scaena" ? { ...(raw.query || {}), ...(raw.path || {}), idempotency_key: raw.idempotency_key } : raw;
    const reply = (data: unknown) => json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: owner === "sonora" ? { result: { data: { projection: data } } } : owner === "scaena" ? { data } : { result: { data } } } });
    if (options.scenario === "degraded" && owner === "scaena") return new Response("unavailable", { status: 503 });
    if (action === "control_center.capabilities") {
      const families = [...new Set((world.tasks[connection] || []).map((task) => task.family))];
      return reply({ schema_version: "yeisme.task_observation.v1", task_families: families.length ? families : ["run"], artifact_access: true });
    }
    if (action === "control_center.tasks.list") {
      const limit = Math.min(50, Number(args.limit) || 50);
      if (options.scenario === "degraded" && connection === "fx-eikona" && args.mode === "history" && args.cursor === "page-50") return reply({ rows: "malformed" });
      return reply(listTasks(connection, String(args.mode || "active"), args.cursor ? String(args.cursor) : undefined, limit));
    }
    const spec = args.task_ref ? lookup(connection, String(args.task_ref)) : undefined;
    if (action === "control_center.tasks.get") return spec ? reply(taskRow(spec)) : json({ jsonrpc: "2.0", id: body.id, result: { isError: true, structuredContent: { error: { code: "TASK_NOT_FOUND" } } } });
    if (action === "control_center.tasks.events") {
      if (!spec) return reply({ events: [], gap: true });
      const events = world.events(spec);
      if (owner === "sonora" && spec.state !== "running") return reply({ events: events.slice(0, 1), gap: true });
      const start = args.after_cursor ? Number(String(args.after_cursor).replace("ev-", "")) + 1 : args.cursor ? Number(String(args.cursor).replace("ev-", "")) : 0;
      const page = events.slice(start, start + 4);
      return reply({ events: page, gap: false, resume_cursor: page.length ? `ev-${start + page.length - 1}` : `ev-${Math.max(0, events.length - 1)}`, ...(start + 4 < events.length ? { next_cursor: `ev-${start + 4}` } : {}) });
    }
    if (action === "artifact.access" && owner === "eikona") {
      const ref = String(args.artifact_uri || "");
      const task = Object.values(world.tasks).flat().find((item) => item.results?.some((result) => result.ref === ref));
      const grant = task && grantFor(task, ref);
      if (!grant) return json({ jsonrpc: "2.0", id: body.id, result: { isError: true, structuredContent: { error: { code: "ARTIFACT_NOT_FOUND" } } } });
      const id48 = grant.id + hex(16);
      grants.set(id48, grants.get(grant.id)!);
      return json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { result: { data: { schema_version: "eikona.artifact_access_grant.v1", expires_at: new Date(Date.now() + 110_000).toISOString() } } }, content: [{ type: "resource_link", uri: `${origin}/api/v1/artifact-access/acc_${id48}` }] } });
    }
    if (action === "control_center.tasks.artifact_access" && spec) {
      const grant = grantFor(spec, String(args.artifact_ref || ""));
      if (!grant) return json({ jsonrpc: "2.0", id: body.id, result: { isError: true, structuredContent: { error: { code: "ARTIFACT_NOT_FOUND" } } } });
      const url = owner === "sonora"
        ? `${origin}/api/v1/artifact-access/${grant.id}?t=${randomBytes(32).toString("base64url").slice(0, 43)}`
        : `${origin}/api/v1/projects/${encodeURIComponent(spec.project)}/control-center/tasks/${encodeURIComponent(spec.ref)}/artifacts/${encodeURIComponent(grant.result.ref)}/access-grants/artifact-grant:${grant.id}?task_family=${encodeURIComponent(spec.family)}`;
      return reply({ schema_version: `${owner}.task_artifact_grant.v1`, artifact_ref: grant.result.ref, mime: grant.result.mime, bytes: grant.result.bytes, expires_at: new Date(Date.now() + 110_000).toISOString(), url });
    }
    return json({ jsonrpc: "2.0", id: body.id, result: { isError: true, structuredContent: { error: { code: "UNKNOWN_ACTION" } } } });
  }

  async function providerMcp(owner: string, body: any) {
    if (options.scenario === "degraded" && owner === "scaena") return new Response("unavailable", { status: 503 });
    if (body?.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
    if (body?.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body?.method === "tools/list") {
      const pages = providerTools(owner, catalogRevision);
      const page = Math.max(0, Number(String(body.params?.cursor || "page-0").replace("page-", "")) || 0);
      const tools = pages[page] || [];
      return json({ jsonrpc: "2.0", id: body.id, result: { tools, ...(page + 1 < pages.length ? { nextCursor: `page-${page + 1}` } : {}) } });
    }
    if (body?.method === "resources/read") {
      const uri = String(body.params?.uri || "");
      const documents: Record<string, unknown> = {
        "eikona://runtime/capabilities": eikonaRuntimeCapabilities(),
        "eikona://models/readiness": eikonaModels(catalogRevision),
        "eikona://channels": eikonaChannels(catalogRevision),
        "sonora://capabilities": sonoraDiscovery(),
        "scaena://video-tasks/guide": scaenaGuide(catalogRevision),
      };
      if (!uri.startsWith(owner + "://") || !(uri in documents)) return json({ jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "Resource not found" } });
      return json({ jsonrpc: "2.0", id: body.id, result: { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(documents[uri]) }] } });
    }
    if (body?.method === "tools/call") {
      const name = body.params?.name;
      const action = body.params?.arguments?.action;
      const data = name === "sonora.search"
        ? { results: [{ provider_id: "openai-tts", model_ref: "sonora/voice/openai-tts", voice_ref: "alloy" }, { provider_id: "openai-tts", voice_ref: "verse" }, { provider_id: "minimax-tts", model_ref: "sonora/voice/minimax-speech", voice_ref: "qingse" }] }
        : action === "getProjectMediaCapabilities" ? { state: "ready" }
        : action === "credential.status" ? { configured: true }
        : action === "doctor.run" ? { diagnostic_status: "success", configured: true }
        : { error: { code: "fixture_submit_disabled" } };
      return json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: data } });
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unknown" } });
  }

  const acceptDelegation = (header: string | null) =>
    header === `Bearer ${delegationToken}` || header === `Bearer ${serviceToken}`;

  function scopedRequests(url: URL, bodyText = "") {
    let project = url.searchParams.get("project_id") || "";
    // content:read carries the binding in the JSON body rather than the query string.
    if (!project && bodyText) try { project = JSON.parse(bodyText).project_id || ""; } catch { /* malformed body stays unscoped */ }
    return requestsByScope.get(project) || [];
  }

  function requestApi(owner: "eikona" | "sonora" | "scaena", url: URL, path: string, method: string, bodyText: string) {
    const wrap = (data: unknown) => json(owner === "sonora" ? data : { data });
    if (options.scenario === "degraded" && owner === "scaena") return new Response(null, { status: 503 });
    const rows = scopedRequests(url, bodyText).filter((row) => row.owner === owner);
    const from = Date.parse(url.searchParams.get("from") || "") || 0;
    const to = Date.parse(url.searchParams.get("to") || "") || Date.now();
    const inWindow = (row: RequestRow) => { const time = Date.now() - row.createdMinutes * 60_000; return time >= from && time <= to; };
    const state = url.searchParams.get("state");
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const filtered = rows.filter((row) => inWindow(row) && (!state || row.data.state === state) && (!search || JSON.stringify(row.data).toLowerCase().includes(search)));
    const coverage = { state: owner === "sonora" ? "partial" : "complete", observed_at: new Date().toISOString(), ...(owner === "sonora" ? { reason: "仅返回当前执行者的音频作业" } : {}) };
    const attachment = path.match(/\/requests\/([^/]+)\/attachments\/([^/]+)\/content:read$/);
    if (attachment && method === "POST") {
      const row = rows.find((item) => item.id === decodeURIComponent(attachment[1]));
      const target = row && Array.isArray(row.data.attachments)
        ? (row.data.attachments as { ref: string; mime?: string; name?: string }[]).find((a) => a.ref === decodeURIComponent(attachment[2]))
        : undefined;
      if (!row || !target) return new Response(null, { status: 404 });
      if ((target.mime || "").startsWith("text/"))
        return wrap({ state: "complete", receipt_ref: `att-${hex(8)}`, mime: target.mime, text: `${target.name || target.ref}\n\nowner 归档的业务附件文本：用于验证按需读取与审计先行。` });
      return wrap({ state: "complete", receipt_ref: `att-${hex(8)}`, mime: target.mime || "image/png", data: Buffer.from(png(24, 16, [30, 60, 90], [140, 190, 220])).toString("base64") });
    }
    const observation = path.match(/\/requests\/([^/]+)\/observations$/);
    if (observation && method === "GET") {
      const row = rows.find((item) => item.id === decodeURIComponent(observation[1]));
      const process = row?.data.process as any;
      if (!row || !process) return wrap({ events: [], gap: true, freshness: "unknown", observed_at: new Date().toISOString() });
      const after = Number(url.searchParams.get("after") || "-1");
      const events = Array.isArray(process.checkpoints) ? process.checkpoints.filter((event: any) => Number(event.sequence ?? 0) > after).slice(0, 50) : [];
      return wrap({ observation: process, events, gap: false, resume_cursor: events.length ? String(events[events.length - 1].sequence) : String(after), freshness: "fresh", observed_at: new Date().toISOString() });
    }
    if (path.endsWith("/summary")) {
      const count = (predicate: (row: RequestRow) => boolean) => ({ value: filtered.filter(predicate).length, state: coverage.state });
      return wrap({
        gateway: { value: null, state: "not_recorded" },
        generation: count((row) => row.data.kind === "generation"),
        operation: count((row) => row.data.kind === "operation"),
        attempts: { value: filtered.reduce((sum, row) => sum + ((row.data.attempts as unknown[])?.length || 0), 0), state: coverage.state },
        outputs: { value: filtered.reduce((sum, row) => sum + ((row.data.output_refs as unknown[])?.length || 0), 0), state: coverage.state },
        succeeded: count((row) => row.data.state === "succeeded"),
        failed: count((row) => row.data.state === "failed"),
        uploaded_files: { value: 0, state: coverage.state },
        uploaded_bytes: { value: null, state: "unknown" },
        referenced_assets: count((row) => ((row.data.attachments as unknown[])?.length || 0) > 0),
        coverage: [coverage],
      });
    }
    const content = path.match(/\/requests\/([^/]+)\/content:read$/);
    if (content && method === "POST") {
      let request: any = {};
      try { request = JSON.parse(bodyText || "{}"); } catch { /* malformed body reads as empty */ }
      const row = rows.find((item) => item.id === decodeURIComponent(content[1]));
      if (!row) return new Response(null, { status: 404 });
      // Eikona archives the generation prompt; Sonora archives the language-plan
      // lines (sonora-request-content-lines-v1). Scaena archives the delegation
      // prompt (scaena-request-content-archive-v1).
      const recorded = request.direction === "input" && owner !== "aigora";
      const text = owner === "sonora"
        ? `${row.data.title}\n\n雨停了，她还站在站台上。\n\n列车进站，灯光扫过她的侧脸。`
        : `${row.data.title}\n\n镜头：雨夜旧车站，冷色霓虹与暖色站台灯交错。人物从画面右侧进入，停在第三根立柱旁，雨丝在逆光中可见。\n\n画幅 16:10，保留左侧留白用于字幕。`;
      return wrap({ schema_version: "yeisme.business_content.v1", audience: "authorized_user", state: recorded ? "complete" : "not_recorded", ...(recorded ? { content_kind: "effective_business_input", text } : {}), receipt_ref: `receipt-${hex(12)}` });
    }
    const detail = path.match(/\/requests\/([^/]+)$/);
    if (detail && !detail[1].includes("summary")) {
      const row = rows.find((item) => item.id === decodeURIComponent(detail[1]));
      return row ? wrap(row.data) : new Response(null, { status: 404 });
    }
    const limit = Number(url.searchParams.get("limit")) || 25;
    const start = Number(url.searchParams.get("cursor") || 0);
    const sorted = filtered.sort((a, b) => a.createdMinutes - b.createdMinutes);
    const page = sorted.slice(start, start + limit);
    return wrap({ rows: page.map((row) => row.data), coverage, ...(start + limit < sorted.length ? { next_cursor: String(start + limit) } : {}) });
  }

  function aigoraApi(url: URL, path: string, method: string, bodyText: string) {
    if (path === "/operator/v1/control-center/scope") return json({ tenant: url.searchParams.get("tenant_id"), project: url.searchParams.get("project_id"), actor: url.searchParams.get("actor_id") });
    const rows = scopedRequests(url, bodyText).filter((row) => row.owner === "aigora");
    if (path === "/operator/v1/observability/requests/summary") {
      return json({ data: { total: { value: rows.length, state: "complete" }, by_outcome: { success: { value: rows.filter((row) => (row.data.request as any).outcome === "success").length, state: "complete" }, failure: { value: rows.filter((row) => (row.data.request as any).outcome === "failure").length, state: "complete" } }, as_of: new Date().toISOString() } });
    }
    const observation = path.match(/^\/operator\/v1\/request-traces\/([^/]+)\/observations$/);
    if (observation && method === "GET") {
      const row = rows.find((item) => item.id === decodeURIComponent(observation[1]));
      return row?.data.process ? json({ data: { observation: row.data.process, events: (row.data.process as any).checkpoints || [], gap: false, freshness: "fresh", observed_at: new Date().toISOString() } }) : json({ data: { events: [], gap: true, freshness: "unknown", observed_at: new Date().toISOString() } });
    }
    const archive = path.match(/^\/operator\/v1\/request-traces\/([^/]+)\/archive:read$/);
    if (archive && method === "POST") {
      const body = { messages: [{ role: "user", content: "把这段旁白改得更克制一些：雨停了，她还站在站台上。" }], choices: [{ message: { role: "assistant", content: "雨停了。她没有走，仍站在站台的灯下。" } }] };
      return json({ data: { content_base64: Buffer.from(JSON.stringify(body)).toString("base64"), truncated: false, receipt_ref: `gw-receipt-${hex(10)}` } });
    }
    const detail = path.match(/^\/operator\/v1\/observability\/requests\/([^/]+)$/);
    if (detail) {
      const row = rows.find((item) => item.id === decodeURIComponent(detail[1]));
      return row ? json({ data: { data: row.data } }) : new Response(null, { status: 404 });
    }
    if (path === "/operator/v1/observability/requests") return json({ data: rows.map((row) => row.data), meta: { coverage: "complete" } });
    const members = path.match(/^\/operator\/v1\/tenants\/([^/]+)\/members$/);
    if (members) return json({ data: [
      { id: "u-lin", display_name: "林舟", principal_type: "user", role: "producer", team_id: "rain-studio" },
      { id: "u-chen", display_name: "陈序", principal_type: "user", role: "creator", team_id: "rain-studio" },
      { id: "u-zhou", display_name: "周宁", principal_type: "user", role: "reviewer", team_id: "rain-studio" },
      { id: "svc-render", display_name: "render-bot", principal_type: "service_account", role: "automation", team_id: "platform" },
    ] });
    return new Response(null, { status: 404 });
  }

  function media(path: string, request: Request) {
    const match = path.match(/acc_([a-f0-9]{48})$|\/artifact-access\/([a-f0-9]{32})$|artifact-grant:([a-f0-9]{32})$/);
    const id = match?.[1] || match?.[2] || match?.[3];
    const grant = id ? grants.get(id) : undefined;
    if (!grant || grant.expires < Date.now()) return new Response(null, { status: 404 });
    if (!path.includes("acc_") && request.headers.get("authorization") !== `Bearer ${observerToken}`) return new Response(null, { status: 403 });
    const item = world.media.get(grant.media)!;
    const range = request.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), item.bytes.length - 1) : item.bytes.length - 1;
    if (start > end) return new Response(null, { status: 416 });
    return new Response(request.method === "HEAD" ? null : item.bytes.subarray(start, end + 1), {
      status: range ? 206 : 200,
      headers: { "Content-Type": item.mime, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${item.bytes.length}` } : {}) },
    });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    async fetch(request) {
      let url: URL;
      try { url = new URL(request.url); } catch { return new Response(null, { status: 400 }); }
      const path = url.pathname;
      const auth = request.headers.get("authorization");
      if (options.latencyMs) await sleep(options.latencyMs * (url.searchParams.get("project_id") === "coast-letters" || path.includes("coast") ? 3 : 1));
      if (path === "/__fixture/catalog-revision") {
        catalogRevision = Math.max(0, Math.min(1, Number(url.searchParams.get("value") || 0) || 0));
        return json({ catalog_revision: catalogRevision });
      }
      if (path.startsWith("/api/v1/artifact-access/") || path.includes("/access-grants/")) return media(path, request);
      const task = path.match(/^\/mcp\/([a-z0-9-]+)$/);
      if (task) {
        if (task[1] === "fx-eikona-denied" || auth !== `Bearer ${observerToken}`) return new Response(null, { status: 403 });
        return taskMcp(task[1], await request.json().catch(() => null));
      }
      const provider = path.match(/^\/provider\/(eikona|scaena|sonora)$/);
      if (provider) {
        if (auth !== `Bearer ${providerToken}`) return new Response(null, { status: 401 });
        return providerMcp(provider[1], await request.json().catch(() => null));
      }
      if (request.headers.get("authorization") !== `Bearer ${delegationToken}` && !acceptDelegation(request.headers.get("authorization"))) return new Response(null, { status: 401 });
      const bodyText = request.method === "POST" ? await request.text() : "";
      if (path.startsWith("/operator/v1/")) return aigoraApi(url, path, request.method, bodyText);
      const scaenaMembers = path.match(/^\/api\/v1\/projects\/([^/]+)\/members$/);
      if (scaenaMembers) return options.scenario === "degraded" ? new Response(null, { status: 503 }) : json({ data: [{ actor_id: "lin.zhou", role: "director" }, { actor_id: "chen.xu", role: "editor" }] });
      const scaenaRequests = path.match(/^\/api\/v1\/projects\/[^/]+\/control-center(\/requests.*)$/);
      if (scaenaRequests) return requestApi("scaena", url, scaenaRequests[1], request.method, bodyText);
      return new Response(null, { status: 404 });
    },
  });

  const ownerApi = (owner: "eikona" | "sonora", port: number) => Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      let url: URL;
      try { url = new URL(request.url); } catch { return new Response(null, { status: 400 }); }
      if (options.latencyMs) await sleep(options.latencyMs * (url.searchParams.get("project_id") === "coast-letters" ? 3 : 1));
      if (!acceptDelegation(request.headers.get("authorization"))) return new Response(null, { status: 401 });
      const path = url.pathname;
      if (path === "/api/v1/control-center/organization") {
        if (owner === "eikona") return new Response(null, { status: 404 });
        return json({ tenant: url.searchParams.get("tenant_id"), members: [{ id: "sonora-lin", name: "林舟", type: "human", role: "voice_director", team: "rain-studio", binding: "verified" }, { id: "sonora-bot", name: "tts-worker", type: "service", role: "renderer", team: "", binding: "unlinked" }] });
      }
      if (path.startsWith("/api/v1/control-center/requests")) return requestApi(owner, url, path.replace("/api/v1/control-center", ""), request.method, request.method === "POST" ? await request.text() : "");
      return new Response(null, { status: 404 });
    },
  });
  const eikonaApi = ownerApi("eikona", options.requestPorts.eikona);
  const sonoraApi = ownerApi("sonora", options.requestPorts.sonora);
  return {
    origin,
    origins: { eikona: `http://127.0.0.1:${options.requestPorts.eikona}`, sonora: `http://127.0.0.1:${options.requestPorts.sonora}` },
    world,
    stop: () => { server.stop(true); eikonaApi.stop(true); sonoraApi.stop(true); },
  };
}
