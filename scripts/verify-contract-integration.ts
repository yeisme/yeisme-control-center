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
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { AuditStore } from "../server/db/audit";
import { SessionStore } from "../server/db/session-store";
import { createMemoryDB, type ControlDB } from "../server/db/client";
import {
  delegationToken,
  observerToken,
  providerToken,
  serviceToken,
  startFakeOwners,
} from "./fixtures/fake-owners";
import type { ServerConfig, TaskConnection } from "../server/contracts";

const root = path.resolve(import.meta.dirname, "..");
const ownerPort = Number(process.env.CONTRACT_OWNER_PORT || 4330);
const apiPort = 4331;
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

const scopeIds = ["contract-a"];
const owners = startFakeOwners({
  port: ownerPort,
  requestPorts: { eikona: ownerPort + 1, sonora: ownerPort + 2 },
  scenario: "rich",
  latencyMs: 0,
  videoBytes: null,
  scopes: [{ id: scopeIds[0], tenant: "rain-studio", project: "rain-reunion", label: "Contract", connections: ["fx-eikona", "fx-sonora"] }],
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
  personal: { name: "Contract Admin", username, role: "admin", password_hash_ref: passwordRef, scope_ids: scopeIds, users: [] },
  principals: [{
    issuer: "fixture", subject: username, name: "Contract Admin",
    scopes: scopeIds.map((id) => ({
      id, tenant: "rain-studio", team: "rain-studio", project: "rain-reunion", label: "Contract scope",
      connection_ids: ["fx-eikona", "fx-sonora"],
      owners: Object.fromEntries(["aigora", "eikona", "scaena", "sonora"].map((owner) => [owner, { tenant: "rain-studio", project: "rain-reunion", actor: username, audience: audience(owner) }])),
      collection: { auctra: { tenant: "rain-studio", project: "rain-reunion", actor: username, audience: audience("auctra") } },
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
  connections: [connection("fx-eikona", "eikona", "rain-reunion"), connection("fx-sonora", "sonora", "rain-reunion")],
  providers: Object.fromEntries((["eikona", "scaena", "sonora"] as const).map((owner) => [owner, {
    owner, endpoint: `${owners.origin}/provider/${owner}`, credential_env: "YEISME_CONTRACT_PROVIDER_TOKEN", enabled: true,
    ...(owner === "scaena" ? { project: "rain-reunion" } : {}),
  }])),
};
process.env.YEISME_CONTRACT_PROVIDER_TOKEN = providerToken;

const db: ControlDB = createMemoryDB();
const auth = new SessionAuth(config, undefined, new SessionStore(db));
const audit = new AuditStore(db);
const app = createApp(config, { db, auth });

let cookie = "";
let csrf = "";
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
    assert.equal(json.epoch, 1);
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
    assert.equal(json.epoch, 1);
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
    assert.equal(json.epoch, 1);
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
    assert.deepEqual(json.servers.map((server: { owner: string; coverage: string }) => `${server.owner}:${server.coverage}`), ["eikona:readable", "scaena:readable", "sonora:readable", "aigora:needs_contract", "gateway:needs_contract", "auctra:needs_contract"]);
    assert.equal(json.tools.filter((tool: { owner: string }) => tool.owner === "eikona").length, 3, "paginated tools/list was followed");
    assert.ok(json.models.some((model: { status: string }) => model.status === "historical"));
    assert.ok(json.actions.some((action: { name: string; risk: string }) => action.name === "music.generate" && action.risk === "paid_external"));
    assert.deepEqual(json.changes, []);
    const body = JSON.stringify(json);
    for (const secret of [providerToken, observerToken, serviceToken, delegationToken]) assert.equal(body.includes(secret), false);
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

  await check("episode board: explicit Auctra sync, then rails built from live Auctra + Scaena reads", async () => {
    const sync = await call(`/api/control-center/v1/auctra/collection/sync?scope=${scopeIds[0]}`, "POST", {});
    assert.equal(sync.response.status, 200);
    assert.equal(sync.json.coverage, "complete");
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
    assert.equal(json.epoch, 2);
    if (requestCursor) {
      const { response } = await call(`/api/control-center/v1/requests?scope=${scopeIds[0]}&cursor=${encodeURIComponent(requestCursor)}`);
      assert.equal(response.status, 409);
    }
    const { json: tasks } = await call(`/api/control-center/v1/tasks?mode=active&scope=${scopeIds[0]}`);
    assert.equal(tasks.epoch, 2);
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
