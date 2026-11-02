/**
 * I1 (backend scope): full-chain contract integration against isolated fake
 * owners. Boots the real app handler in-process with the fixture owner world
 * and asserts login -> scope -> services -> tasks -> media -> requests ->
 * audit -> epoch invariants end to end. Evidence lands in
 * temp/integration-test-runs/contract-integration-<run-id>/.
 */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { hashPassword } from "../server/password";
import { createControlCenter } from "../server/app";
import { SessionAuth } from "../server/auth";
import { AuditStore } from "../server/db/audit";
import { SessionStore } from "../server/db/session-store";
import { createMemoryDB, type ControlDB } from "../server/db/client";
import { taskNotifications } from "../server/db/schema";
import { createObservationLoop } from "../server/observation-loop";
import { credentialReminders } from "../server/observation-credentials";
import {
  delegationToken,
  observerToken,
  providerToken,
  serviceToken,
  startFakeOwners,
} from "./fixtures/fake-owners";
import type { ServerConfig, TaskConnection } from "../server/contracts";
import { openToolToken } from "./fixtures/fake-open-tools";

const root = path.resolve(import.meta.dirname, "..");
const ownerPort = Number(process.env.CONTRACT_OWNER_PORT || 4330);
const apiPort = Number(process.env.CONTRACT_API_PORT || 4331);
const origin = `http://127.0.0.1:${apiPort}`;
const username = "contract-admin";
const password = "contract-integration-local-only";
const runId = "contract-integration-" + new Date().toISOString().replace(/[:.]/g, "-");
const evidence = join(root, "temp/integration-test-runs", runId);
const checks: { name: string; status: "passed" | "failed"; error?: string }[] = [];

await fs.mkdir(join(evidence, "artifacts"), { recursive: true, mode: 0o700 });
await writeFile(join(evidence, "command.txt"), "bun run test:contract-integration\n");
await writeFile(join(evidence, "env.json"), JSON.stringify({
  origin,
  fake_owner_origin: `http://127.0.0.1:${ownerPort}`,
  scenario: "rich",
  real_owner_reads: false,
  provider_calls: false,
  mutations: false,
}, null, 2) + "\n");
await writeFile(join(evidence, "stdout.log"), "");
await writeFile(join(evidence, "stderr.log"), "");

const expectRow = (rows: { target_ref: string | null }[], target: string) => {
  if (!rows.some((row) => row.target_ref === target))
    throw new assert.AssertionError({ message: `audit row missing for ${target}` });
};
const check = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    checks.push({ name, status: "passed" });
  } catch (error) {
    checks.push({ name, status: "failed", error: (error as Error).message });
  }
};

const temp = await mkdtemp("/tmp/yeisme-contract-");
const passwordRef = join(temp, "password");
const observerRef = join(temp, "observer");
const serviceRef = join(temp, "service-credential");
await writeFile(passwordRef, (await hashPassword(password)) + "\n", { mode: 0o600 });
await writeFile(observerRef, observerToken + "\n", { mode: 0o600 });
await writeFile(serviceRef, serviceToken + "\n", { mode: 0o600 });
const openToolRef = join(temp, "open-tool");
await writeFile(openToolRef, openToolToken + "\n", { mode: 0o600 });

const scopeIds = ["contract-a"];
const owners = startFakeOwners({
  port: ownerPort,
  requestPorts: { eikona: ownerPort + 1, sonora: ownerPort + 2 },
  scenario: "rich",
  latencyMs: 0,
  videoBytes: null,
  scopes: [{ id: scopeIds[0], tenant: "rain-studio", project: "rain-reunion", label: "Contract", connections: ["fx-eikona", "fx-sonora", "fx-anatomia", "fx-anatomia-locked"] }],
});

const connection = (id: string, owner: TaskConnection["owner"], project: string, extra: Partial<TaskConnection> = {}): TaskConnection => ({
  id, owner, project, label: id, instance_id: "contract", environment: "fixture",
  endpoint: `${owners.origin}/mcp/${id}`, credential_ref: observerRef, enabled: true,
  allow_private_http: true, allow_content: true, ...extra,
});
const audience = (owner: string) => `fixture-${owner}`;
const config: ServerConfig = {
  origin, port: apiPort, bind: "127.0.0.1",
  auth_mode: "personal",
  // A second personal login, shared into one project and then suspended, proves a revoked reader is cut off mid-paging.
  personal: { name: "Contract Admin", username, role: "admin", password_hash_ref: passwordRef, scope_ids: scopeIds, users: [{ username: "contract-viewer", name: "Contract Viewer", role: "viewer", key_hash_ref: passwordRef, scope_ids: scopeIds }] },
  principals: [{
    issuer: "fixture", subject: username, name: "Contract Admin",
    scopes: scopeIds.map((id) => ({
      id, tenant: "rain-studio", team: "rain-studio", project: "rain-reunion", label: "Contract scope",
      connection_ids: ["fx-eikona", "fx-sonora", "fx-anatomia", "fx-anatomia-locked"],
      owners: Object.fromEntries(["aigora", "eikona", "scaena", "sonora"].map((owner) => [owner, { tenant: "rain-studio", project: "rain-reunion", actor: username, audience: audience(owner) }])),
      collection: { auctra: { tenant: "rain-studio", project: "rain-reunion", actor: username, audience: audience("auctra") } },
      open_tools: ["drivebridge" as const, "gateway" as const],
    })),
  }],
  owners: {
    aigora: { origin: owners.origin, audience: audience("aigora"), credential_ref: serviceRef },
    scaena: { origin: owners.origin, audience: audience("scaena"), credential_ref: serviceRef },
    eikona: { origin: owners.origins.eikona, audience: audience("eikona"), credential_ref: serviceRef },
    sonora: { origin: owners.origins.sonora, audience: audience("sonora"), credential_ref: serviceRef },
  },
  collection: { auctra: { origin: owners.origin, audience: audience("auctra"), credential_ref: serviceRef, enabled: true } },
  clients: { muweave: { origin: "http://127.0.0.1:4399", enabled: true } },
  // Background observation is configured but never started here: the checks run one cycle by hand.
  observation: { enabled: true },
  open_tools: {
    // DriveBridge's token was issued to run out in three days, so the credential lifecycle has something to remind about.
    drivebridge: { endpoint: `${owners.origin}/drivebridge`, credential_ref: openToolRef, credential_expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), allow_private_http: true, enabled: true },
    gateway: { endpoint: `${owners.origin}/gateway`, credential_ref: openToolRef, allow_private_http: true, enabled: true },
  },
  connections: [
    connection("fx-eikona", "eikona", "rain-reunion"),
    connection("fx-sonora", "sonora", "rain-reunion"),
    connection("fx-anatomia", "anatomia", "rain-reunion", { allow_cancel: true }),
    // The same Anatomia project read by a connection that was never allowed content: frames stay closed.
    connection("fx-anatomia-locked", "anatomia", "rain-reunion", { allow_content: false }),
  ],
  providers: Object.fromEntries((["eikona", "scaena", "sonora"] as const).map((owner) => [owner, {
    owner, endpoint: `${owners.origin}/provider/${owner}`, credential_env: "YEISME_CONTRACT_PROVIDER_TOKEN", enabled: true,
    ...(owner === "scaena" ? { project: "rain-reunion" } : {}),
  }])),
};
process.env.YEISME_CONTRACT_PROVIDER_TOKEN = providerToken;

const db: ControlDB = createMemoryDB();
const auth = new SessionAuth(config, undefined, new SessionStore(db));
const audit = new AuditStore(db);
const { handle: app, services } = createControlCenter(config, { db, auth });
const loop = createObservationLoop(services, { log: () => undefined, credentials: credentialReminders(services) });
services.observation = loop;

let cookie = "";
let csrf = "";
// The session's epoch as the first read reports it. It starts above every earlier session's (so it is a time-sized number,
// not 1), stays put while nothing changes, and rises by one for each bump.
let epoch = 0;
const call = async (pathname: string, method = "GET", body?: unknown, withAuth = true) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: origin };
  if (withAuth && cookie) headers.Cookie = cookie;
  if (method !== "GET" && csrf) headers["X-CSRF-Token"] = csrf;
  const response = await app(
    new Request(origin + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined }),
  );
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const entry of setCookie) {
    const match = entry.match(/^yeisme_session=([^;]+)/);
    if (match) cookie = "yeisme_session=" + match[1];
  }
  let json: any = null;
  try { json = await response.json(); } catch { /* non-JSON (media bytes) */ }
  return { response, json };
};

try {
  await check("auth methods expose personal login only", async () => {
    const { json } = await call("/api/control-center/v1/auth/methods", "GET", undefined, false);
    assert.equal(json.personal, true);
    assert.equal(json.oidc, false);
  });

  await check("personal login issues a session cookie", async () => {
    const { response } = await call("/api/control-center/v1/auth/personal", "POST", { username, password }, false);
    assert.equal(response.status, 200);
    assert.ok(cookie);
  });

  // Service-credential channel: the personal session stays token-free; owner
  // reads ride the per-owner credential_ref like a real intranet deployment.
  const sessionId = cookie.replace(/^yeisme_session=/, "");

  await check("session exposes epoch, csrf and server-derived scope", async () => {
    const { json } = await call("/api/control-center/v1/session");
    assert.ok(Number.isSafeInteger(json.epoch) && json.epoch >= 1, `epoch ${json.epoch}`);
    epoch = json.epoch;
    assert.equal(json.role, "admin");
    assert.equal(json.scopes[0].id, scopeIds[0]);
    assert.equal(json.scopes[0].owners.length, 5);
    csrf = json.csrf;
    assert.ok(csrf);
  });

  await check("unauthenticated session reads stay 401", async () => {
    const response = await app(new Request(origin + "/api/control-center/v1/session"));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).class, "login_required");
  });

  await check("forged scopes are rejected before any owner call", async () => {
    const { response, json } = await call("/api/control-center/v1/tasks?scope=forged");
    assert.equal(response.status, 404);
    assert.equal(json.error, "scope_not_found");
  });

  await check("services propagate live connection coverage without secrets", async () => {
    const { json } = await call(`/api/control-center/v1/services?scope=${scopeIds[0]}&observe=1`);
    const eikona = json.services.find((v: { id: string }) => v.id === "eikona");
    assert.equal(eikona.configuration, "configured");
    assert.equal(eikona.coverage.state, "complete");
    assert.ok(eikona.observed_at);
    const serialized = JSON.stringify(json);
    assert.equal(serialized.includes("credential_ref"), false);
    assert.equal(serialized.includes(observerToken), false);
  });

  await check("task list returns owner rows with epoch echo", async () => {
    const { json } = await call(`/api/control-center/v1/tasks?mode=active&scope=${scopeIds[0]}`);
    assert.equal(json.epoch, epoch);
    const refs = json.rows.map((row: { locator: { task_ref: string } }) => row.locator.task_ref);
    assert.ok(refs.includes("run-2410-active"));
    assert.ok(json.connections.some((c: { state: string }) => c.state === "ready"));
  });

  const history = await call(`/api/control-center/v1/tasks?mode=history&scope=${scopeIds[0]}`);
  const reviewTask = history.json.rows.find((row: { locator: { task_ref: string } }) => row.locator.task_ref === "run-2398-review");
  const taskKey = reviewTask?.task_key as string | undefined;

  await check("task detail keeps identity and revision bound to the signed key", async () => {
    assert.ok(taskKey);
    const { json } = await call(`/api/control-center/v1/tasks/${encodeURIComponent(taskKey!)}?scope=${scopeIds[0]}`);
    assert.equal(json.locator.task_ref, "run-2398-review");
    assert.ok(json.revision);
    assert.equal(json.epoch, epoch);
  });

  await check("task events page with an explicit gap flag", async () => {
    const { json } = await call(`/api/control-center/v1/tasks/${encodeURIComponent(taskKey!)}/events?scope=${scopeIds[0]}`);
    assert.ok(Array.isArray(json.events));
    assert.equal(json.gap, false);
    assert.ok(json.events.some((event: { kind?: string }) => event.kind));
    assert.ok(json.resume_cursor);
  });

  let mediaHandle: { url: string; mime: string } | undefined;
  await check("artifact access issues a short-lived same-origin media handle", async () => {
    const { response, json } = await call(
      `/api/control-center/v1/tasks/${encodeURIComponent(taskKey!)}/artifacts/artifact-0/access?scope=${scopeIds[0]}`,
      "POST", { purpose: "preview" },
    );
    assert.equal(response.status, 200);
    assert.equal(json.mime, "image/png");
    assert.ok(json.url.startsWith("/api/control-center/v1/media/"));
    mediaHandle = json;
  });

  await check("media handle streams owner bytes with reauthorization and no-store", async () => {
    const response = await app(new Request(origin + mediaHandle!.url, { headers: { Cookie: cookie } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const bytes = await response.arrayBuffer();
    assert.ok(bytes.byteLength > 100);
    const head = await app(new Request(origin + mediaHandle!.url, { method: "HEAD", headers: { Cookie: cookie } }));
    assert.equal(head.status, 200);
  });

  let requestCursor: string | undefined;
  await check("request list keeps per-source coverage and a signed cursor", async () => {
    const { json } = await call(`/api/control-center/v1/requests?scope=${scopeIds[0]}`);
    assert.ok(json.rows.length > 0);
    const eikora = json.coverage.find((c: { owner: string }) => c.owner === "eikona");
    assert.equal(eikora.state, "complete");
    // A cursor only exists when the source paginates; its absence is valid.
    requestCursor = json.next_cursor;
  });

  await check("request summary stays separate from page batches", async () => {
    const { json } = await call(`/api/control-center/v1/requests/summary?scope=${scopeIds[0]}`);
    const eikora = json.sources.find((s: { owner: string }) => s.owner === "eikona");
    assert.ok(eikora.summary.generation.value > 0);
  });

  const eikonaRow = (await call(`/api/control-center/v1/requests?scope=${scopeIds[0]}`)).json.rows
    .find((row: { owner: string }) => row.owner === "eikona");

  await check("request detail projects the owner row verbatim", async () => {
    const { json } = await call(`/api/control-center/v1/requests/eikona/${encodeURIComponent(eikonaRow.id)}?scope=${scopeIds[0]}`);
    assert.equal(json.id, eikonaRow.id);
    assert.equal(json.owner, "eikona");
  });

  await check("request observations expose prompt capture without raw content", async () => {
    const { response, json } = await call(`/api/control-center/v1/requests/eikona/${encodeURIComponent(eikonaRow.id)}/observations?scope=${scopeIds[0]}`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(json.events));
    assert.ok(json.events.some((event: { kind?: string }) => event.kind === "prompt_capture"));
    assert.equal(json.observation.prompt_capture.state, "captured");
    assert.equal(JSON.stringify(json).includes("镜头："), false);
  });

  await check("content:read is audited first and returns business text only", async () => {
    const { response, json } = await call(
      `/api/control-center/v1/requests/eikona/${encodeURIComponent(eikonaRow.id)}/content:read?scope=${scopeIds[0]}`,
      "POST", { direction: "input", purpose: "contract integration check" },
    );
    assert.equal(response.status, 200);
    assert.equal(json.state, "complete");
    assert.ok(json.text.includes("镜头"));
    const audited = audit.page({ limit: 10, action: "requests.content_read" }).rows;
    assert.equal(audited.length, 1);
    assert.equal(audited[0].outcome, "succeeded");
    assert.equal(audited[0].target_ref, eikonaRow.id);
  });

  await check("binary attachment reads flow through a short-lived bytes handle", async () => {
    const imageRow = (await call(`/api/control-center/v1/requests?scope=${scopeIds[0]}`)).json.rows
      .find((row: { id: string; attachments?: { ref: string; mime: string }[] }) =>
        (row.attachments || []).some((a) => a.mime === "image/png"));
    assert.ok(imageRow, "fixture world should include an image attachment row");
    const ref = imageRow.attachments[0].ref;
    const { response, json } = await call(
      `/api/control-center/v1/requests/eikona/${encodeURIComponent(imageRow.id)}/attachments/${encodeURIComponent(ref)}/content:read?scope=${scopeIds[0]}`,
      "POST", { direction: "input", purpose: "contract integration attachment check" },
    );
    assert.equal(response.status, 200);
    assert.equal(json.state, "complete");
    assert.equal(json.mime, "image/png");
    assert.ok(json.url.startsWith("/api/control-center/v1/media/"));
    const media = await app(new Request(origin + json.url, { headers: { Cookie: cookie } }));
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/png");
    assert.ok((await media.arrayBuffer()).byteLength > 50);
    const audited = audit.page({ limit: 10, action: "requests.attachment_read" }).rows;
    expectRow(audited, imageRow.id + "#" + ref);
  });

  await check("text attachments return inline business text", async () => {
    const textRow = (await call(`/api/control-center/v1/requests?scope=${scopeIds[0]}`)).json.rows
      .find((row: { attachments?: { ref: string; mime: string }[] }) =>
        (row.attachments || []).some((a) => a.mime === "text/plain"));
    assert.ok(textRow, "fixture world should include a text attachment row");
    const ref = textRow.attachments[0].ref;
    const { response, json } = await call(
      `/api/control-center/v1/requests/eikona/${encodeURIComponent(textRow.id)}/attachments/${encodeURIComponent(ref)}/content:read?scope=${scopeIds[0]}`,
      "POST", { direction: "input", purpose: "contract integration text attachment check" },
    );
    assert.equal(response.status, 200);
    assert.ok(json.text.includes("owner 归档的业务附件文本"));
    assert.equal(json.url, undefined);
  });

  await check("sonora business text reads through the service-credential lane", async () => {
    const sonoraRow = (await call(`/api/control-center/v1/requests?scope=${scopeIds[0]}`)).json.rows
      .find((row: { owner: string }) => row.owner === "sonora");
    assert.ok(sonoraRow);
    const { response, json } = await call(
      `/api/control-center/v1/requests/sonora/${encodeURIComponent(sonoraRow.id)}/content:read?scope=${scopeIds[0]}`,
      "POST", { direction: "input", purpose: "contract integration sonora text check" },
    );
    assert.equal(response.status, 200);
    assert.equal(json.state, "complete");
    assert.ok(json.text.includes("雨停了"));
  });

  await check("tool catalog projects read-only owner discovery without secrets", async () => {
    const { response, json } = await call(`/api/control-center/v1/tool-catalog?scope=${scopeIds[0]}`);
    assert.equal(response.status, 200);
    assert.equal(json.schema_version, "yeisme.tool_catalog.v1");
    assert.deepEqual(json.servers.map((server: { owner: string; coverage: string }) => `${server.owner}:${server.coverage}`), ["eikona:readable", "scaena:readable", "sonora:readable", "gateway:readable", "aigora:needs_contract", "auctra:needs_contract"]);
    assert.equal(json.tools.filter((tool: { owner: string }) => tool.owner === "eikona").length, 3, "paginated tools/list was followed");
    assert.ok(json.models.some((model: { status: string }) => model.status === "historical"));
    assert.ok(json.actions.some((action: { name: string; risk: string }) => action.name === "music.generate" && action.risk === "paid_external"));
    assert.deepEqual(json.changes, []);
    const body = JSON.stringify(json);
    for (const secret of [providerToken, observerToken, serviceToken, delegationToken, openToolToken]) assert.equal(body.includes(secret), false);
    const { json: capabilities } = await call(`/api/control-center/v1/capabilities?scope=${scopeIds[0]}`);
    const video = capabilities.capabilities.find((row: { owner: string }) => row.owner === "scaena");
    assert.deepEqual(video.input_modes, ["text_to_video", "image_to_video", "keyframe_video"]);
    assert.equal(video.submit_gate, "disabled_by_default");
  });

  await check("tool catalog records owner drift after the baseline and rejects writes", async () => {
    await fetch(`${owners.origin}/__fixture/catalog-revision?value=1`);
    const { json } = await call(`/api/control-center/v1/tool-catalog?scope=${scopeIds[0]}&refresh=1`);
    assert.equal(json.refresh.forced, true);
    const changes = json.changes.map((change: { owner: string; kind: string; entry_id: string; change: string }) => `${change.owner}:${change.kind}:${change.entry_id}:${change.change}`);
    assert.ok(changes.includes("eikona:model:black-forest/flux-2-pro@openrouter:added"), changes.join(","));
    assert.ok(changes.includes("eikona:channel:legacy-gateway:removed"), changes.join(","));
    const { json: throttled } = await call(`/api/control-center/v1/tool-catalog?scope=${scopeIds[0]}&refresh=1`);
    assert.equal(throttled.refresh.throttled, true);
    const { response } = await call(`/api/control-center/v1/tool-catalog?scope=${scopeIds[0]}`, "POST", {});
    assert.equal(response.status, 405);
    await fetch(`${owners.origin}/__fixture/catalog-revision?value=0`);
  });

  await check("anatomia: breakdowns list with stages, frames open through a bound grant, and cancellation is refused", async () => {
    const active = await call(`/api/control-center/v1/tasks?mode=active&scope=${scopeIds[0]}`);
    const running = active.json.rows.find((row: { locator: { owner: string; task_ref: string }; connection_id: string }) => row.locator.owner === "anatomia" && row.connection_id === "fx-anatomia");
    assert.equal(running?.locator.task_family, "decompose");
    assert.deepEqual(running.progress, { kind: "count", completed: 2, total: 5, percent: null });
    const done = await call(`/api/control-center/v1/tasks?mode=history&scope=${scopeIds[0]}`);
    const rows = done.json.rows.filter((row: { connection_id: string }) => row.connection_id === "fx-anatomia");
    assert.deepEqual(rows.map((row: { locator: { task_ref: string }; state: string }) => `${row.locator.task_ref}:${row.state}`).sort(), ["operation:an-0871:partial", "operation:an-0899:unknown", "operation:an-0902:succeeded"]);
    const breakdown = rows.find((row: { locator: { task_ref: string } }) => row.locator.task_ref === "operation:an-0902");
    assert.equal(breakdown.results.length, 3);
    const events = await call(`/api/control-center/v1/tasks/${encodeURIComponent(breakdown.task_key)}/events?scope=${scopeIds[0]}`);
    assert.deepEqual(events.json.events.map((event: { kind: string }) => event.kind).sort(), ["artifact_ready", "provider_running", "provider_running", "request_received"]);
    const access = await call(`/api/control-center/v1/tasks/${encodeURIComponent(breakdown.task_key)}/artifacts/artifact-1/access?scope=${scopeIds[0]}`, "POST", { purpose: "preview" });
    assert.equal(access.response.status, 200);
    assert.equal(access.json.mime, "image/png");
    const bytes = await app(new Request(origin + access.json.url, { headers: { Cookie: cookie } }));
    assert.equal(bytes.status, 200);
    assert.equal(bytes.headers.get("content-type"), "image/png");
    assert.equal(new Uint8Array(await bytes.arrayBuffer())[1], 0x50);
    const locked = done.json.rows.find((row: { connection_id: string; locator: { task_ref: string } }) => row.connection_id === "fx-anatomia-locked" && row.locator.task_ref === "operation:an-0902");
    const refused = await call(`/api/control-center/v1/tasks/${encodeURIComponent(locked.task_key)}/artifacts/artifact-0/access?scope=${scopeIds[0]}`, "POST", { purpose: "preview" });
    assert.equal(refused.response.status, 403);
    assert.equal(refused.json.error, "content_not_authorized");
    const cancel = await call(`/api/control-center/v1/tasks/${encodeURIComponent(running.task_key)}/cancel?scope=${scopeIds[0]}`, "POST", { confirm: true, expected_revision: running.revision, idempotency_key: "anatomia-cancel-check-0001" });
    assert.equal(cancel.response.status, 409);
    assert.equal(cancel.json.error, "cancel_not_supported");
  });

  await check("anatomia: a grant that points anywhere but its own grant route is refused", async () => {
    await fetch(`${owners.origin}/__fixture/anatomia-grant?mode=query`);
    try {
      const { json } = await call(`/api/control-center/v1/tasks?mode=history&scope=${scopeIds[0]}`);
      const breakdown = json.rows.find((row: { connection_id: string; locator: { task_ref: string } }) => row.connection_id === "fx-anatomia" && row.locator.task_ref === "operation:an-0902");
      const access = await call(`/api/control-center/v1/tasks/${encodeURIComponent(breakdown.task_key)}/artifacts/artifact-2/access?scope=${scopeIds[0]}`, "POST", { purpose: "preview" });
      assert.equal(access.response.status, 403);
      assert.equal(access.json.error, "media_address_denied");
    } finally {
      await fetch(`${owners.origin}/__fixture/anatomia-grant?mode=normal`);
    }
  });

  await check("open tools: services carry DriveBridge and Gateway readings without paths, addresses or owner text", async () => {
    const { json } = await call(`/api/control-center/v1/services?scope=${scopeIds[0]}&observe=1`);
    const drive = json.services.find((v: { id: string }) => v.id === "drivebridge");
    const gateway = json.services.find((v: { id: string }) => v.id === "gateway");
    assert.equal(drive.integration, "operation_projection");
    assert.equal(drive.open_tool.state, "ready");
    assert.equal(drive.open_tool.coverage.state, "partial");
    assert.deepEqual(drive.open_tool.operations.attention.map((run: { ref: string; label: string }) => `${run.ref}:${run.label}`), ["op_fx_failed:导出", "op_fx_interrupted:上传"]);
    assert.equal(gateway.open_tool.state, "ready");
    assert.deepEqual(gateway.open_tool.backends.map((backend: { id: string; state: string; tool_count: number }) => `${backend.id}:${backend.state}:${backend.tool_count}`), ["eikona:ready:2", "sonora:ready:1", "blender:disabled:0"]);
    assert.equal(gateway.open_tool.usage.calls, 1204);
    const body = JSON.stringify(json);
    for (const leaked of ["/fixture/", "permission denied", "files.fixture.invalid", "eikona.fixture.invalid", "sonora.fixture.invalid", "SONORA_FIXTURE_TOKEN", "backend-leak.example.test", "upstream 502", openToolToken, "credential_ref", owners.origin]) assert.equal(body.includes(leaked), false, leaked);
  });

  await check("open tools: the work queue raises failed runs and reports both tools as sources", async () => {
    const { json } = await call(`/api/control-center/v1/work-queue?scope=${scopeIds[0]}&kind=operation_failure`);
    assert.deepEqual(json.items.map((item: { owner: string; title: string }) => `${item.owner}:${item.title}`).sort(), ["drivebridge:DriveBridge 上传失败", "drivebridge:DriveBridge 导出失败", "gateway:MCP Gateway 工具调用失败"]);
    const sources = json.coverage.sources.map((source: { owner: string; state: string }) => `${source.owner}:${source.state}`);
    assert.ok(sources.includes("drivebridge:partial"), sources.join(","));
    assert.ok(sources.includes("gateway:complete"), sources.join(","));
  });

  await check("open tools: the catalog lists the Gateway's tools and none is callable", async () => {
    const { json } = await call(`/api/control-center/v1/tool-catalog?scope=${scopeIds[0]}`);
    assert.deepEqual(json.tools.filter((tool: { owner: string }) => tool.owner === "gateway").map((tool: { name: string }) => tool.name), ["eikona_search", "eikona_execute", "sonora_execute", "gateway_tools_search"]);
    assert.equal(json.actions.some((action: { owner: string }) => action.owner === "gateway"), false);
  });

  // Background observation (W3): no browser sync has been made on this server so far, so every failure reminder below
  // was opened by the loop alone.
  let cycle: Awaited<ReturnType<typeof loop.runCycle>> | undefined;
  await check("observation: a background cycle opens failure and operation reminders for the admin with no session, and none for the viewer", async () => {
    const before = owners.hits();
    cycle = await loop.runCycle();
    assert.ok(cycle.calls <= 40, `calls ${cycle.calls}`);
    assert.ok(cycle.reminders_opened >= 4, `opened ${cycle.reminders_opened}`);
    assert.deepEqual(cycle.errors, {});
    // Only task owners behind connections and the two open tools were read: no Provider, no Auctra, no request API.
    const delta = Object.fromEntries(Object.entries(owners.hits()).map(([key, n]) => [key, n - (before[key] || 0)]).filter(([, n]) => (n as number) > 0));
    for (const key of Object.keys(delta)) assert.ok(key.startsWith("mcp/fx-") || key === "drivebridge" || key === "gateway", `unexpected owner traffic: ${key}`);
    // The budget counts the requests the owners really got: MCP handshakes and every request of an open-tool reading included.
    const requests = Object.values(delta).reduce((sum, n) => sum + (n as number), 0);
    assert.equal(requests, cycle.calls, `the cycle reported ${cycle.calls} calls and the owners got ${requests} requests`);
    assert.ok(requests <= 40, `requests ${requests}`);
    for (const key of ["mcp/fx-sonora", "mcp/fx-anatomia", "mcp/fx-anatomia-locked"]) assert.ok(delta[key] >= 2 && delta[key] <= 3, `${key} was read ${delta[key]} times`);
    // fx-eikona keeps 119 finished tasks, three pages of history: page 1 of both lists, then the rolling read took pages 2 and 3.
    assert.equal(delta["mcp/fx-eikona"], 4, `mcp/fx-eikona was read ${delta["mcp/fx-eikona"]} times`);
    // The open tools were read a moment ago by the checks above and are served from the service's own cache.
    const { json } = await call(`/api/control-center/v1/notifications?scope=${scopeIds[0]}&limit=100`);
    const failures = json.rows.filter((row: { category: string }) => row.category === "failure").map((row: { title: string; owner: string }) => `${row.owner}:${row.title}`);
    assert.ok(failures.includes("eikona:站台 · 人群背景（高分辨率）"), failures.join(" | "));
    assert.ok(failures.includes("anatomia:视频问答：参考片-雨夜.mp4"), failures.join(" | "));
    const operations = json.rows.filter((row: { category: string }) => row.category === "operation");
    assert.deepEqual(operations.map((row: { title: string }) => row.title).sort(), ["DriveBridge 上传失败", "DriveBridge 导出失败", "MCP Gateway 工具调用失败"]);
    for (const row of operations) assert.equal(row.target_path, "/services");
    // Written by the loop under its own session; the browser never synced.
    const ledger = db.select().from(taskNotifications).all().filter((row) => row.category === "failure" || row.category === "operation");
    assert.ok(ledger.length > 0 && ledger.every((row) => row.sessionId === "background" && row.subject === "yeisme:personal|" + username), "reminders were not all written by the loop for the admin");
    // The viewer has the same scope and receives nothing.
    const login = await app(new Request(origin + "/api/control-center/v1/auth/personal", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "contract-viewer", password }) }));
    assert.equal(login.status, 200);
    const viewerCookie = "yeisme_session=" + login.headers.getSetCookie().map((entry) => entry.match(/^yeisme_session=([^;]+)/)?.[1]).find(Boolean);
    const viewerRows = await app(new Request(origin + `/api/control-center/v1/notifications?scope=${scopeIds[0]}`, { headers: { Origin: origin, Cookie: viewerCookie } }));
    assert.deepEqual((await viewerRows.json()).rows, []);
  });

  await check("observation: opening those reminders neither duplicates on a second cycle nor turns operation reminders into task failures in the work queue", async () => {
    const again = await loop.runCycle();
    assert.equal(again.reminders_opened, 0);
    const { json } = await call(`/api/control-center/v1/work-queue?scope=${scopeIds[0]}&kind=task_failure&limit=100`);
    for (const item of json.items) assert.ok(!/DriveBridge|MCP Gateway/.test(item.title), `operation reminder surfaced as a task: ${item.title}`);
  });

  await check("observation: /observation/status answers without calling an owner and carries no address, path or key", async () => {
    const before = owners.hits();
    const { response, json } = await call(`/api/control-center/v1/observation/status?scope=${scopeIds[0]}`);
    assert.equal(response.status, 200);
    assert.deepEqual(owners.hits(), before);
    assert.equal(json.schema_version, "yeisme.observation_status.v1");
    assert.deepEqual([json.enabled, json.running, json.recipient, json.interval_minutes, json.open_tools_every], [true, false, true, 10, 3]);
    assert.deepEqual([json.config_valid, json.scope, json.observed], [true, scopeIds[0], true]);
    assert.ok(json.last_cycle.calls > 0 && json.last_cycle.calls <= 40);
    assert.ok(json.last_cycle.pages_read > 0 && json.last_cycle.pages_read <= json.last_cycle.calls, `pages ${json.last_cycle.pages_read}`);
    assert.ok(json.last_cycle.scan_incomplete >= 0 && json.last_cycle.connections_read === 4, `connections ${json.last_cycle.connections_read}`);
    assert.ok(json.last_cycle.started_at && json.last_cycle.finished_at);
    assert.equal(json.epoch, epoch);
    const body = JSON.stringify(json);
    for (const leaked of [owners.origin, temp, observerRef, observerToken, serviceToken, openToolToken, "credential_ref", "站台"]) assert.equal(body.includes(leaked), false, leaked);
    // A viewer may read it too, and is not a recipient.
    const login = await app(new Request(origin + "/api/control-center/v1/auth/personal", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "contract-viewer", password }) }));
    const viewerCookie = "yeisme_session=" + login.headers.getSetCookie().map((entry) => entry.match(/^yeisme_session=([^;]+)/)?.[1]).find(Boolean);
    const viewer = await app(new Request(origin + `/api/control-center/v1/observation/status?scope=${scopeIds[0]}`, { headers: { Origin: origin, Cookie: viewerCookie } }));
    assert.equal(viewer.status, 200);
    assert.equal((await viewer.json()).recipient, false);
    assert.equal(JSON.stringify(owners.hits()), JSON.stringify(before));
    assert.equal((await app(new Request(origin + "/api/control-center/v1/observation/status", { headers: { Origin: origin } }))).status, 401);
  });

  // Credential reminders (W3 finish): worked out from memory in the same cycle, so the request count asserted above
  // (the owners' own count equals the cycle's `calls`, 40 at most) already holds with the credential step on.
  await check("observation: the token that is running out is one credential reminder, written by the loop in the same cycle", async () => {
    const { json } = await call(`/api/control-center/v1/notifications?scope=${scopeIds[0]}&limit=100`);
    const credentials = json.rows.filter((row: { category: string }) => row.category === "credential");
    assert.deepEqual(credentials.map((row: { title: string }) => row.title), ["DriveBridge · 即将到期（7 天内）"]);
    assert.equal(credentials[0].failure_fingerprint, "credential:open_tool:drivebridge:expiring:7d");
    assert.deepEqual([credentials[0].session_id, credentials[0].target_path, credentials[0].owner, credentials[0].state, credentials[0].recovered_at], ["background", "/services", "drivebridge", "unread", null]);
    for (const leaked of [openToolRef, openToolToken, owners.origin, temp]) assert.equal(JSON.stringify(credentials).includes(leaked), false, leaked);
  });

  await check("work queue: the same token is one credential_renewal item, linked to the credentials and the renewal steps", async () => {
    const { json } = await call(`/api/control-center/v1/work-queue?scope=${scopeIds[0]}&kind=credential_renewal`);
    assert.deepEqual(json.items.map((item: { source_ref: string; state: string; priority: string }) => `${item.source_ref}:${item.state}:${item.priority}`), ["open_tool:drivebridge:expiring:normal"]);
    const [item] = json.items;
    assert.deepEqual(item.safe_links.map((link: { target: string; ref: string }) => `${link.target}:${link.ref}`), ["services:open_tool:drivebridge", "guide:guide-renew-drivebridge"]);
    assert.equal(item.credential.days_left, 3);
    for (const leaked of [openToolRef, openToolToken, owners.origin, temp, "credential_ref"]) assert.equal(JSON.stringify(json).includes(leaked), false, leaked);
  });

  await check("reminders: snoozing sets a reminder aside until a time and reopening brings it back, with no owner call; a bad time or no CSRF token is refused", async () => {
    const list = async () => (await call(`/api/control-center/v1/notifications?scope=${scopeIds[0]}&limit=100`)).json as { unread: number; rows: { id: string; category: string; state: string; snoozed_until: string | null }[] };
    const before = owners.hits();
    const start = await list();
    const reminder = start.rows.find((row) => row.category === "credential")!;
    const path = `/api/control-center/v1/notifications/${reminder.id}/snooze?scope=${scopeIds[0]}`;
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const bare = await app(new Request(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify({ until }) }));
    assert.equal(bare.status, 403);
    const tooFar = await call(path, "POST", { until: new Date(Date.now() + 31 * 86_400_000).toISOString() });
    assert.deepEqual([tooFar.response.status, tooFar.json.error], [400, "invalid_snooze_until"]);
    const snoozed = await call(path, "POST", { until });
    assert.equal(snoozed.response.status, 200);
    assert.deepEqual([snoozed.json.notification.state, snoozed.json.notification.snoozed_until, snoozed.json.owner_writes, snoozed.json.task_states_changed], ["unread", until, 0, 0]);
    const during = await list();
    assert.equal(during.unread, start.unread - 1);
    assert.equal(during.rows.find((row) => row.id === reminder.id)!.snoozed_until, until);
    const again = await call(path, "POST", { until: new Date(Date.now() + 7_200_000).toISOString() });
    assert.equal(again.response.status, 200, "a later snooze replaces the earlier one");
    const reopened = await call(`/api/control-center/v1/notifications/${reminder.id}/reopen?scope=${scopeIds[0]}`, "POST", {});
    assert.equal(reopened.response.status, 200);
    assert.deepEqual([reopened.json.notification.state, reopened.json.notification.snoozed_until], ["unread", null]);
    assert.equal((await list()).unread, start.unread);
    const archived = await call(`/api/control-center/v1/notifications/${reminder.id}/archive?scope=${scopeIds[0]}`, "POST", {});
    assert.equal(archived.response.status, 200);
    const refused = await call(path, "POST", { until });
    assert.deepEqual([refused.response.status, refused.json.error], [409, "notification_not_snoozable"]);
    await call(`/api/control-center/v1/notifications/${reminder.id}/reopen?scope=${scopeIds[0]}`, "POST", {});
    // Reminder actions change the control center's own ledger and nothing at any owner.
    assert.deepEqual(owners.hits(), before);
  });

  await check("observation: when the token is renewed the reminder is recovered by the next cycle, still with no owner request of its own", async () => {
    (config.open_tools!.drivebridge as { credential_expires_at?: string }).credential_expires_at = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const before = owners.hits();
    const next = await loop.runCycle();
    assert.equal(next.reminders_recovered, 1);
    assert.equal(next.reminders_opened, 0);
    const requests = Object.entries(owners.hits()).reduce((sum, [key, n]) => sum + (n - (before[key] || 0)), 0);
    assert.equal(requests, next.calls, `the cycle reported ${next.calls} calls and the owners got ${requests} requests`);
    const { json } = await call(`/api/control-center/v1/notifications?scope=${scopeIds[0]}&limit=100`);
    const credential = json.rows.find((row: { category: string }) => row.category === "credential");
    assert.ok(credential.recovered_at, "the credential reminder is marked recovered");
    const queue = await call(`/api/control-center/v1/work-queue?scope=${scopeIds[0]}&kind=credential_renewal`);
    assert.deepEqual(queue.json.items, []);
  });

  await check("episode board: explicit Auctra sync, then rails built from live Auctra + Scaena reads", async () => {
    // A two-record page size forces several pages; Auctra sorts oldest first, so a one-page sync would drop the newest episodes.
    const sync = await call(`/api/control-center/v1/auctra/collection/sync?scope=${scopeIds[0]}`, "POST", { limit: 2 });
    assert.equal(sync.response.status, 200);
    assert.equal(sync.json.coverage, "complete");
    assert.equal(sync.json.complete, true);
    assert.ok(sync.json.pages >= 2, `pages=${sync.json.pages}`);
    assert.equal(sync.json.cursor, null);
    const { response, json } = await call(`/api/control-center/v1/drama/episodes?scope=${scopeIds[0]}&read=all`);
    assert.equal(response.status, 200);
    assert.equal(json.schema_version, "yeisme.drama_episodes.v1");
    assert.deepEqual(json.rows.map((row: { episode_ref: string }) => row.episode_ref), ["ep-01", "ep-02", "ep-03"], "only screenplay units are episodes");
    const state = (ref: string, stage: string) => json.rows.find((row: { episode_ref: string }) => row.episode_ref === ref).flow.rail.find((node: { stage: string }) => node.stage === stage).state;
    assert.equal(state("ep-01", "production_breakdown"), "accepted");
    assert.equal(state("ep-02", "creative_storyboard"), "waiting_review");
    assert.equal(state("ep-02", "production_breakdown"), "not_started", "Scaena has nothing for ep-02 yet");
    assert.equal(state("ep-03", "production_handoff"), "stale");
    assert.equal(json.universe.bound, true);
    assert.equal(json.universe.complete, true);
    assert.equal(json.universe.can_sync, true);
    const page = await call(`/api/control-center/v1/auctra/collection?scope=${scopeIds[0]}`);
    assert.equal(page.json.connection.state, "connected");
    assert.equal(page.json.last_sync.complete, true);
  });

  await check("episode detail: head breakdown outline is structure only, and Scaena's own episode ref can be named", async () => {
    const { json } = await call(`/api/control-center/v1/drama/episode?scope=${scopeIds[0]}&episode_ref=ep-01`);
    assert.equal(json.outline.head_breakdown_ref, "bd-ep01-v3");
    assert.equal(json.outline.older_attempts, 2);
    assert.equal(json.outline.scene_count, 3);
    assert.equal(json.outline.shot_count, 11);
    const body = JSON.stringify(json);
    for (const forbidden of ["action_summary", "content_ref", "representation_ref", "media_type", "Authorization", "Bearer", serviceToken, delegationToken, observerToken]) assert.equal(body.includes(forbidden), false, forbidden);
    const plain = await call(`/api/control-center/v1/drama/episode?scope=${scopeIds[0]}&episode_ref=ep-03`);
    assert.equal(plain.json.outline, undefined);
    const named = await call(`/api/control-center/v1/drama/episode?scope=${scopeIds[0]}&episode_ref=ep-03&scaena_episode_ref=${encodeURIComponent("episode:03")}`);
    assert.equal(named.json.scaena_episode_overridden, true);
    assert.equal(named.json.rail.find((node: { stage: string }) => node.stage === "production_breakdown").state, "in_progress");
  });

  await check("work queue reads flows only for known episodes and reports real attention", async () => {
    const { json } = await call(`/api/control-center/v1/work-queue?scope=${scopeIds[0]}`);
    const flow = json.items.filter((item: { workflow_stage?: string }) => item.workflow_stage).map((item: { workflow_stage: string; kind: string }) => `${item.workflow_stage}:${item.kind}`).sort();
    assert.deepEqual(flow, ["creative_storyboard:review_required", "production_handoff:service_blocked"]);
    assert.equal(json.items.some((item: { title: string }) => item.title === "剧本到分镜流程暂不可读"), false);
  });

  await check("episode board rejects malformed references and unknown scopes", async () => {
    assert.equal((await call(`/api/control-center/v1/drama/episode?scope=${scopeIds[0]}`)).response.status, 400);
    assert.equal((await call(`/api/control-center/v1/drama/episode?scope=${scopeIds[0]}&episode_ref=${encodeURIComponent("a\nb")}`)).response.status, 400);
    assert.equal((await call(`/api/control-center/v1/drama/episodes?scope=forged`)).response.status, 404);
    assert.equal((await call(`/api/control-center/v1/drama/episodes?scope=${scopeIds[0]}`, "POST", {})).response.status, 405);
  });

  await check("audit trail is admin-readable and redacted", async () => {
    const { response, json } = await call("/api/control-center/v1/audit?limit=25");
    assert.equal(response.status, 200);
    assert.ok(json.rows.some((row: { action: string }) => row.action === "requests.content_read"));
    assert.equal(JSON.stringify(json).includes(delegationToken), false);
  });

  await check("epoch bump invalidates stale cursors and echoes a new epoch", async () => {
    auth.sessions.bumpAll();
    const { json } = await call("/api/control-center/v1/session");
    assert.equal(json.epoch, epoch + 1);
    epoch = json.epoch;
    if (requestCursor) {
      const { response } = await call(`/api/control-center/v1/requests?scope=${scopeIds[0]}&cursor=${encodeURIComponent(requestCursor)}`);
      assert.equal(response.status, 409);
    }
    const { json: tasks } = await call(`/api/control-center/v1/tasks?mode=active&scope=${scopeIds[0]}`);
    assert.equal(tasks.epoch, epoch);
  });

  // Tool projects (T2). After the epoch check: connecting and disconnecting bump the session epoch.
  let connected = "", twoProjects = "", twoProjectsOrg = "";
  const act = async (action: string, kind: string, target: string, input: Record<string, unknown>, scope = scopeIds[0], expected = "0") => {
    const key = `contract_${action.replaceAll(".", "_")}_${Math.random().toString(36).slice(2, 12)}`;
    const preview = await call(`/api/control-center/v1/actions/preview?scope=${scope}`, "POST", { scope_id: scope, owner: "control-center", target_kind: kind, target_ref: target, action, expected_revision: expected, idempotency_key: key, input });
    if (preview.response.status !== 200) return preview;
    return call(`/api/control-center/v1/actions/confirm?scope=${scope}`, "POST", { scope_id: scope, preview_ref: preview.json.preview_ref, preview_digest: preview.json.preview_digest, idempotency_key: key });
  };
  await check("a refused tool project is reported in the preview and leaves the template connection readable", async () => {
    const refused = await act("owner_project.connect", "owner_project", "eikona:rain-private", { template_connection_id: "fx-eikona", project_ref: "rain-private" });
    assert.equal(refused.response.status, 403);
    assert.equal(refused.json.error, "owner_project_not_accessible");
    const { json } = await call(`/api/control-center/v1/connections?scope=${scopeIds[0]}`);
    assert.equal(json.connections.find((c: { id: string }) => c.id === "fx-eikona")?.state, "ready");
  });
  await check("a covered tool project connects through preview and confirm and is read without a restart", async () => {
    const result = await act("owner_project.connect", "owner_project", "eikona:rain-bts", { template_connection_id: "fx-eikona", project_ref: "rain-bts", label: "片场花絮" });
    assert.equal(result.response.status, 202);
    assert.equal(result.json.owner_state, "connected");
    connected = result.json.result_refs[0];
    const { json: tasks } = await call(`/api/control-center/v1/tasks?mode=history&scope=${scopeIds[0]}`);
    const row = tasks.rows.find((t: { locator: { task_ref: string } }) => t.locator.task_ref === "run-b-01");
    assert.ok(row, "connected project task missing");
    assert.equal(row.locator.project, "rain-bts");
    const { json: listed } = await call(`/api/control-center/v1/owner-projects?scope=${scopeIds[0]}`);
    const entry = listed.rows.find((r: { project_ref: string }) => r.project_ref === "rain-bts");
    assert.equal(entry?.registered, true);
    assert.equal(entry?.registrations[0]?.id, connected);
    const serialized = JSON.stringify(listed);
    for (const secret of [observerRef, observerToken, "credential_ref", "endpoint"]) assert.ok(!serialized.includes(secret), `owner projects leak ${secret}`);
  });
  await check("a shared project binds two Eikona projects of one scope and reads both", async () => {
    const org = await act("organization.create", "organization", "new", { name: "Contract Studio", source_scope: scopeIds[0] });
    assert.equal(org.response.status, 202);
    const orgID = org.json.result_refs[0];
    twoProjectsOrg = orgID;
    const { json: options } = await call(`/api/control-center/v1/organizations/${orgID}/binding-options?scope=${scopeIds[0]}`);
    const eikona = options.rows.filter((o: { owner: string }) => o.owner === "eikona").map(({ owner, project_ref, source_scope, connection_ids }: Record<string, unknown>) => ({ owner, project_ref, source_scope, connection_ids }));
    assert.deepEqual(eikona.map((o: { project_ref: string }) => o.project_ref).sort(), ["rain-bts", "rain-reunion"]);
    const project = await act("project.create", "organization", orgID, { name: "两个图像项目", bindings: eikona });
    assert.equal(project.response.status, 202);
    const projectID = project.json.result_refs[0];
    twoProjects = projectID;
    const { json: tasks } = await call(`/api/control-center/v1/tasks?mode=history&scope=${projectID}`);
    const projects = new Set(tasks.rows.filter((t: { locator: { owner: string } }) => t.locator.owner === "eikona").map((t: { locator: { project: string } }) => t.locator.project));
    assert.deepEqual([...projects].sort(), ["rain-bts", "rain-reunion"]);
  });
  await check("batches of two bound Eikona projects page on the server and are each observed in their own project", async () => {
    const base = `/api/control-center/v1/projects/${twoProjects}`;
    const run = async (action: string, input: Record<string, unknown>) => {
      const { json: shared } = await call(`${base}?scope=${twoProjects}`);
      const key = `contract_${action.replaceAll(".", "_")}_${Math.random().toString(36).slice(2, 12)}`;
      const preview = await call(`/api/control-center/v1/actions/preview?scope=${twoProjects}`, "POST", { scope_id: twoProjects, owner: "control-center", target_kind: "project", target_ref: twoProjects, action, expected_revision: String(shared.revision), idempotency_key: key, input });
      assert.equal(preview.response.status, 200, `${action} preview ${JSON.stringify(preview.json)}`);
      const receipt = await call(`/api/control-center/v1/actions/confirm?scope=${twoProjects}`, "POST", { scope_id: twoProjects, preview_ref: preview.json.preview_ref, preview_digest: preview.json.preview_digest, idempotency_key: key });
      assert.equal(receipt.json.state, "succeeded", `${action} ${JSON.stringify(receipt.json)}`);
      return receipt.json;
    };
    await run("project.update", { generation_enabled: true, budget_cap: 5, currency: "USD" });
    const batches: Record<string, string> = {};
    for (const [name, target] of [["花絮 A", "rain-bts"], ["正片 A", "rain-reunion"], ["花絮 B", "rain-bts"]]) {
      const prepared = await run("generation.input.prepare", { owner: "eikona", rows: [{ id: "row", prompt: `${name} 定妆`, model_ref: "fixture/image", size: "1024x1024", aspect: "1:1", candidate_count: 1, folder_id: null, references: [], project_ref: target }] });
      assert.equal(prepared.generation_items[0].project_ref, target);
      batches[name] = (await run("generation.batch.create", { name, items: prepared.generation_items, idempotency_key: `contract_batch_${Math.random().toString(36).slice(2, 12)}` })).result_refs[0];
    }
    for (const name of ["花絮 A", "正片 A"]) await run("generation.batch.submit", { batch_id: batches[name] });
    // Newest first, two to a page, with a signed cursor that only works under the filters it was issued for.
    const first = await call(`${base}/generation-batches?scope=${twoProjects}&limit=2`);
    assert.deepEqual(first.json.rows.map((b: { name: string }) => b.name), ["花絮 B", "正片 A"]);
    assert.equal(first.json.total, 3);
    const second = await call(`${base}/generation-batches?scope=${twoProjects}&limit=2&cursor=${encodeURIComponent(first.json.next_cursor)}`);
    assert.deepEqual(second.json.rows.map((b: { name: string }) => b.name), ["花絮 A"]);
    assert.equal(second.json.next_cursor, null);
    assert.equal((await call(`${base}/generation-batches?scope=${twoProjects}&limit=2&q=${encodeURIComponent("花絮")}&cursor=${encodeURIComponent(first.json.next_cursor)}`)).response.status, 409);
    assert.deepEqual((await call(`${base}/generation-batches?scope=${twoProjects}&q=${encodeURIComponent("花絮")}`)).json.rows.map((b: { name: string }) => b.name), ["花絮 B", "花絮 A"]);
    // Each page read Eikona only for its own live batch, in that batch's project, and both finished.
    const sources = (page: { sources: { project_ref: string; state: string }[] }) => page.sources.map((s) => `${s.project_ref}:${s.state}`);
    assert.deepEqual(sources(first.json), ["rain-reunion:ready"]);
    assert.deepEqual(sources(second.json), ["rain-bts:ready"]);
    assert.deepEqual([first.json.rows[1].state, second.json.rows[0].state], ["succeeded", "succeeded"]);
    // A finished batch needs no owner read when opened directly.
    const detail = await call(`${base}/generation-batches/${batches["花絮 A"]}?scope=${twoProjects}`);
    assert.deepEqual([detail.json.batch.state, detail.json.coverage, detail.json.sources.length], ["succeeded", "complete", 0]);
    // Each finished batch is announced once, with a link that opens it in its project.
    await call(`${base}/generation-batches?scope=${twoProjects}`);
    const { json: reminders } = await call(`/api/control-center/v1/notifications?scope=${twoProjects}`);
    const finished = reminders.rows.filter((r: { category: string }) => r.category === "generation_batch");
    assert.deepEqual(finished.map((r: { title: string }) => r.title).sort(), ["批次「正片 A」已完成", "批次「花絮 A」已完成"]);
    for (const reminder of finished) assert.match(reminder.target_path, new RegExp(`^/creation\\?sharedProject=${twoProjects}&batch=batch_`));
    assert.equal((await call(`${base}/generation-batches/batch_missing?scope=${twoProjects}`)).response.status, 404);
  });
  await check("a reader suspended while paging batches gets the same 404 as someone never shared in", async () => {
    const viewer = async (pathname: string) => {
      const response = await app(new Request(origin + pathname, { headers: { Origin: origin, ...(viewerCookie ? { Cookie: viewerCookie } : {}) } }));
      return { status: response.status, json: await response.json().catch(() => null) };
    };
    let viewerCookie = "";
    const login = await app(new Request(origin + "/api/control-center/v1/auth/personal", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "contract-viewer", password }) }));
    assert.equal(login.status, 200);
    viewerCookie = "yeisme_session=" + login.headers.getSetCookie().map((entry) => entry.match(/^yeisme_session=([^;]+)/)?.[1]).find(Boolean);
    const base = `/api/control-center/v1/projects/${twoProjects}`;
    assert.equal((await viewer(`${base}/generation-batches?scope=${twoProjects}&limit=2`)).status, 404);
    const member = await act("organization.member.set", "organization", twoProjectsOrg, { identity: "yeisme:personal|contract-viewer", role: "member", status: "active" });
    assert.equal(member.response.status, 202, JSON.stringify(member.json));
    const { json: shared } = await call(`${base}?scope=${twoProjects}`);
    const key = `contract_grant_${Math.random().toString(36).slice(2, 12)}`;
    const preview = await call(`/api/control-center/v1/actions/preview?scope=${twoProjects}`, "POST", { scope_id: twoProjects, owner: "control-center", target_kind: "project", target_ref: twoProjects, action: "project.members.set", expected_revision: String(shared.revision), idempotency_key: key, input: { grants: [...shared.grants, { subject_type: "member", subject_id: member.json.result_refs[0], role: "viewer" }] } });
    assert.equal((await call(`/api/control-center/v1/actions/confirm?scope=${twoProjects}`, "POST", { scope_id: twoProjects, preview_ref: preview.json.preview_ref, preview_digest: preview.json.preview_digest, idempotency_key: key })).json.state, "succeeded");
    const page = await viewer(`${base}/generation-batches?scope=${twoProjects}&limit=2`);
    assert.equal(page.status, 200);
    assert.ok(page.json.next_cursor);
    const { json: members } = await call(`/api/control-center/v1/organizations/${twoProjectsOrg}/members?scope=${scopeIds[0]}`);
    const row = members.rows.find((m: { identity: string }) => m.identity === "yeisme:personal|contract-viewer");
    const suspend = await act("organization.member.set", "organization", twoProjectsOrg, { identity: row.identity, role: "member", status: "suspended" }, scopeIds[0], String(row.revision));
    assert.equal(suspend.response.status, 202, JSON.stringify(suspend.json));
    const revoked = await viewer(`${base}/generation-batches?scope=${twoProjects}&limit=2&cursor=${encodeURIComponent(page.json.next_cursor)}`);
    const opened = await viewer(`${base}/generation-batches/${page.json.rows[0].id}?scope=${twoProjects}`);
    assert.deepEqual([revoked.status, opened.status], [404, 404]);
    assert.deepEqual([revoked.json, opened.json].map((body) => JSON.stringify(body).includes(page.json.rows[0].name)), [false, false]);
  });
  await check("a personal viewer can read but cannot run admin or paid actions", async () => {
    const login = await app(new Request(origin + "/api/control-center/v1/auth/personal", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "contract-viewer", password }) }));
    assert.equal(login.status, 200);
    const cookie = "yeisme_session=" + login.headers.getSetCookie().map((entry) => entry.match(/^yeisme_session=([^;]+)/)?.[1]).find(Boolean);
    const as = async (pathname: string, body?: unknown) => {
      const response = await app(new Request(origin + pathname, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
      return { status: response.status, json: await response.json().catch(() => null) };
    };
    let csrf = "";
    const session = await as("/api/control-center/v1/session");
    assert.equal(session.status, 200);
    assert.equal(session.json.role, "viewer");
    csrf = session.json.csrf;
    const scope = scopeIds[0];
    const attempts = [
      { owner: "control-center", target_kind: "personal_user", target_ref: "user:contract-admin", action: "admin.user.revoke", input: { username } },
      { owner: "eikona", target_kind: "task", target_ref: "eikona:task-1", action: "task.cancel", input: { reason: "contract" } },
    ];
    for (const attempt of attempts) {
      const refused = await as(`/api/control-center/v1/actions/preview?scope=${scope}`, { scope_id: scope, expected_revision: "0", idempotency_key: `contract_viewer_${attempt.action.replace(/\W/g, "_")}`, ...attempt });
      assert.deepEqual([refused.status, refused.json?.error], [403, "control_center_admin_required"], attempt.action);
    }
    const run = await as(`/api/control-center/v1/provider-runs?scope=${scope}`, { owner: "eikona", modality: "image", prompt: "contract" });
    assert.deepEqual([run.status, run.json?.error], [403, "control_center_admin_required"]);
  });
  await check("only connected tool projects can be disconnected, and the template keeps working", async () => {
    const configured = await act("owner_project.disconnect", "owner_project", "fx-eikona", { connection_id: "fx-eikona" });
    assert.equal(configured.response.status, 404);
    const removed = await act("owner_project.disconnect", "owner_project", connected, { connection_id: connected });
    assert.equal(removed.response.status, 202);
    const { json: tasks } = await call(`/api/control-center/v1/tasks?mode=history&scope=${scopeIds[0]}`);
    assert.ok(!tasks.rows.some((t: { locator: { project: string } }) => t.locator.project === "rain-bts"), "disconnected project still read");
    assert.ok(tasks.rows.some((t: { locator: { project: string } }) => t.locator.project === "rain-reunion"), "template connection stopped reading");
  });
} finally {
  owners.stop();
  const failed = checks.filter((c) => c.status === "failed");
  const summary = {
    status: failed.length ? "failed" : "passed",
    real_owner_reads: false,
    provider_calls: false,
    mutations: false,
    checks_total: checks.length,
    checks_failed: failed.length,
    scenario: "rich",
  };
  await writeFile(join(evidence, "summary.json"), JSON.stringify({ ...summary, checks }, null, 2) + "\n");
  await writeFile(join(evidence, "artifacts", "checks.json"), JSON.stringify(checks, null, 2) + "\n");
  await writeFile(join(evidence, "stdout.log"), checks.map((c) => `${c.status === "passed" ? "PASS" : "FAIL"} ${c.name}${c.error ? " :: " + c.error : ""}`).join("\n") + "\n");
  console.log(`contract integration: ${summary.status} (${checks.length - failed.length}/${checks.length} checks)`);
  console.log(`evidence: ${evidence}`);
  process.exit(failed.length ? 1 : 0);
}
