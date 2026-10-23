import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { hashPassword } from "../server/password";

const root = resolve(import.meta.dirname, "..");
const sourcePath = join(homedir(), ".config/yeisme-control-center/config.json");
const id = "real-owner-read-" + new Date().toISOString().replace(/[:.]/g, "-");
const evidence = resolve(root, "temp/integration-test-runs", id);
const privateDir = await mkdtemp("/tmp/yeisme-real-owner-read-");
const port = await findFreePort(Number(process.env.YEISME_OWNER_READ_PORT || 0));
const base = `http://127.0.0.1:${port}`;
const password = "real-owner-read-local-only";
const passwordRef = join(privateDir, "password");
const configRef = join(privateDir, "config.json");
let child: ReturnType<typeof spawn> | undefined;
let status: "passed" | "failed" = "failed";
let summary: Record<string, unknown> = { status, real_owner_reads: false, provider_calls: false, mutations: false };
let boundaryChecks: Record<string, number> = {};
const logs: string[] = [];

async function findFreePort(preferred: number): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(preferred, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  const selected = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (!selected) throw new Error("owner_read_port_unavailable");
  return selected;
}

await mkdir(join(evidence, "artifacts"), { recursive: true, mode: 0o700 });
await writeFile(join(evidence, "command.txt"), "bun run test:owner-live-read\n");
await writeFile(join(evidence, "env.json"), JSON.stringify({
  origin: base,
  port,
  owner_reads: ["capabilities", "tool-catalog", "tasks.list", "tasks.get", "tasks.events", "drama.episodes", "work-queue"],
  real_owner_reads: true,
  provider_calls: false,
  mutations: false,
  credentials_logged: false,
}, null, 2) + "\n");
await writeFile(join(evidence, "stdout.log"), "");
await writeFile(join(evidence, "stderr.log"), "");

function record(value: unknown) {
  logs.push(JSON.stringify(value));
}
async function waitForServer(output: { value: string }) {
  for (let i = 0; i < 80; i++) {
    if (output.value.includes("listening")) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("owner_read_server_start_timeout");
}
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { Origin: base, ...(init.headers || {}) },
  });
  let body: any = null;
  try { body = await response.json(); } catch { /* empty response */ }
  return { response, body };
}

try {
  const config = JSON.parse(await readFile(sourcePath, "utf8"));
  await writeFile(passwordRef, (await hashPassword(password)) + "\n", { mode: 0o600 });
  config.origin = base;
  config.bind = "127.0.0.1";
  config.port = port;
  config.personal = {
    ...config.personal,
    username: "owner-read-check",
    role: "admin",
    password_hash_ref: passwordRef,
    users: [],
  };
  await writeFile(configRef, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

  const output = { value: "" };
  child = spawn("bun", ["server/index.ts"], {
    cwd: root,
    env: { ...process.env, YEISME_CONTROL_CONFIG: configRef, YEISME_CONTROL_BIND: "127.0.0.1", YEISME_CONTROL_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => { output.value += String(chunk); });
  child.stderr?.on("data", (chunk) => { output.value += String(chunk); });
  await waitForServer(output);

  const login = await request("/api/control-center/v1/auth/personal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "owner-read-check", password }),
  });
  if (login.response.status !== 200) throw new Error("owner_read_login_failed");
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
  const session = await request("/api/control-center/v1/session", { headers: { Cookie: cookie } });
  if (session.response.status !== 200) throw new Error("owner_read_session_failed");
  const scope = session.body?.scopes?.[0]?.id;
  if (typeof scope !== "string" || !scope) throw new Error("owner_read_scope_missing");
  const authHeaders = { Cookie: cookie };
  const unauthenticated = await request("/api/control-center/v1/session");
  const invalidTask = await request(`/api/control-center/v1/tasks/not-a-valid-task?scope=${encodeURIComponent(scope)}`, { headers: authHeaders });
  boundaryChecks = { unauthenticated_session: unauthenticated.response.status, invalid_task: invalidTask.response.status };
  if (unauthenticated.response.status !== 401 || invalidTask.response.status !== 404)
    throw new Error(`owner_read_boundary_failed:${unauthenticated.response.status}/${invalidTask.response.status}`);
  const services = await request(`/api/control-center/v1/services?scope=${encodeURIComponent(scope)}&observe=1`, { headers: authHeaders });
  const connections = await request(`/api/control-center/v1/connections?scope=${encodeURIComponent(scope)}`, { headers: authHeaders });
  const active = await request(`/api/control-center/v1/tasks?scope=${encodeURIComponent(scope)}&mode=active`, { headers: authHeaders });
  const history = await request(`/api/control-center/v1/tasks?scope=${encodeURIComponent(scope)}&mode=history`, { headers: authHeaders });
  const capabilities = await request(`/api/control-center/v1/capabilities?scope=${encodeURIComponent(scope)}`, { headers: authHeaders });
  for (const [name, result] of Object.entries({ services, connections, active, history, capabilities })) {
    if (result.response.status !== 200) throw new Error(`owner_read_${name}_failed`);
  }
  const core = (connections.body?.connections || []).filter((item: any) => ["eikona", "scaena", "sonora"].includes(item.owner));
  if (core.length < 3 || core.some((item: any) => item.state !== "ready" || item.runtime?.transport !== "verified" || item.runtime?.authorization !== "verified" || item.runtime?.contract !== "supported"))
    throw new Error("owner_read_connection_not_ready");
  const activeRows = Array.isArray(active.body?.rows) ? active.body.rows : [];
  const historyRows = Array.isArray(history.body?.rows) ? history.body.rows : [];
  const ownerRows = Object.fromEntries(["eikona", "scaena", "sonora"].map((owner) => {
    const connectionsForOwner = core.filter((item: any) => item.owner === owner);
    return [owner, {
      connections: connectionsForOwner.map((item: any) => item.id),
      state: connectionsForOwner.every((item: any) => item.state === "ready") ? "ready" : "partial",
      task_rows_active: activeRows.filter((row: any) => row?.locator?.owner === owner).length,
      task_rows_history: historyRows.filter((row: any) => row?.locator?.owner === owner).length,
    }];
  }));
  const taskChecks: Record<string, unknown>[] = [];
  const csrf = typeof session.body?.csrf === "string" ? session.body.csrf : "";
  for (const owner of ["eikona", "scaena", "sonora"]) {
    const row = [...activeRows, ...historyRows].find((candidate: any) => candidate?.locator?.owner === owner && typeof candidate.task_key === "string");
    if (!row) {
      taskChecks.push({ owner, detail: "no_task_observed", events: "no_task_observed", artifact_access: "no_task_observed" });
      continue;
    }
    const taskBase = `/api/control-center/v1/tasks/${encodeURIComponent(row.task_key)}`;
    const taskPath = `${taskBase}?scope=${encodeURIComponent(scope)}`;
    const detail = await request(taskPath, { headers: authHeaders });
    const events = await request(`${taskBase}/events?scope=${encodeURIComponent(scope)}`, { headers: authHeaders });
    if (detail.response.status !== 200 || events.response.status !== 200)
      throw new Error(`owner_read_${owner}_task_detail_or_events_failed:${detail.response.status}/${events.response.status}:${detail.body?.error || ""}/${events.body?.error || ""}:key=${row.task_key.length}:${row.task_key.split(".").length}:connection=${row.connection_id || ""}`);
    let artifactAccess: string = "no_artifact";
    const artifact = Array.isArray(row.results) ? row.results.find((candidate: any) => candidate && typeof candidate.ref === "string") : undefined;
    const canPreview = Array.isArray(row.allowed_actions) && row.allowed_actions.some((action: any) => action.action === "preview" && action.enabled === true);
    if (artifact && canPreview && csrf) {
      const grant = await request(`${taskBase}/artifacts/${encodeURIComponent(artifact.ref)}/access?scope=${encodeURIComponent(scope)}`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ purpose: "preview" }),
      });
      artifactAccess = `${grant.response.status}:${grant.body?.error || "ok"}`;
      if (![200, 403, 404, 410, 422, 503].includes(grant.response.status))
        throw new Error(`owner_read_${owner}_artifact_access_failed:${artifactAccess}`);
    }
    taskChecks.push({ owner, detail: detail.response.status, events: events.response.status, artifact_access: artifactAccess, has_results: Boolean(artifact) });
  }
  const providerStates = Object.fromEntries((capabilities.body?.capabilities || []).map((item: any) => [item.owner, {
    state: item.state,
    readiness: item.readiness || item.state,
    submit_gate: item.submit_gate || "disabled_by_default",
    supports_live_submit: item.supports_live_submit === true,
    blocker: item.blocker || item.diagnostic?.blocker || null,
    diagnostic_code: item.diagnostic?.code || null,
    binding_count: Array.isArray(item.bindings) ? item.bindings.length : 0,
  }]));
  for (const [owner, projection] of Object.entries(providerStates) as Array<[string, any]>) {
    if (projection.submit_gate !== "disabled_by_default") throw new Error(`provider_submit_gate_open:${owner}`);
  }
  // Catalog discovery is read-only owner discovery; record counts and coverage only, never entry bodies.
  const catalog = await request(`/api/control-center/v1/tool-catalog?scope=${encodeURIComponent(scope)}`, { headers: authHeaders });
  if (catalog.response.status !== 200 && !(catalog.response.status === 405 && catalog.body?.error === "operation_not_allowed"))
    throw new Error(`tool_catalog_read_failed:${catalog.response.status}`);
  const toolCatalog = catalog.response.status === 200 ? {
    freshness: catalog.body?.freshness,
    coverage: (catalog.body?.coverage || []).map((item: any) => ({ owner: item.owner, state: item.state, reason: item.reason })),
    counts: { tools: catalog.body?.tools?.length || 0, actions: catalog.body?.actions?.length || 0, models: catalog.body?.models?.length || 0, channels: catalog.body?.channels?.length || 0 },
    latest_ready_models: (catalog.body?.models || []).filter((model: any) => model.status === "latest_ready").length,
  } : { status: "route_unavailable" };
  // Episode board and attention queue are read-only. Record counts, states and coverage only: never refs, titles or bodies.
  const taskEpisodeRefs = [...new Set([...activeRows, ...historyRows].map((row: any) => row?.episode_ref).filter((ref: unknown): ref is string => typeof ref === "string" && ref.length > 0 && ref.length <= 512 && ref === ref.trim() && !/[\x00-\x1f\x7f]/.test(ref)))].slice(0, 12);
  const dramaParams = new URLSearchParams({ scope });
  for (const ref of taskEpisodeRefs) dramaParams.append("episode_ref", ref);
  const dramaList = await request(`/api/control-center/v1/drama/episodes?${dramaParams}`, { headers: authHeaders });
  const queueRead = await request(`/api/control-center/v1/work-queue?scope=${encodeURIComponent(scope)}`, { headers: authHeaders });
  if (queueRead.response.status !== 200) throw new Error(`work_queue_read_failed:${queueRead.response.status}`);
  const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }), {});
  const dramaRows: any[] = Array.isArray(dramaList.body?.rows) ? dramaList.body.rows : [];
  const dramaBoard = dramaList.response.status === 200 ? {
    status: 200,
    universe: { bound: dramaList.body?.universe?.bound, coverage: dramaList.body?.universe?.coverage, reason: dramaList.body?.universe?.reason || null, total: dramaList.body?.universe?.total },
    task_episode_refs_offered: taskEpisodeRefs.length,
    rows: dramaRows.length,
    read_states: tally(dramaRows.map((row) => row.read)),
    rail_states: tally(dramaRows.flatMap((row) => (row.flow?.rail || []).map((node: any) => `${node.owner}:${node.state}`))),
    source_coverage: tally(dramaRows.flatMap((row) => (row.flow?.source_coverage || []).map((source: any) => `${source.owner}:${source.state}`))),
    queue_flow_items: (queueRead.body?.items || []).filter((item: any) => item.workflow_stage).length,
    queue_contract_gap_items: (queueRead.body?.items || []).filter((item: any) => item.object_kind === "creative_flow").length,
  } : { status: dramaList.response.status, route_unavailable: [404, 405].includes(dramaList.response.status), error: dramaList.body?.error || null };
  summary = {
    schema_version: "yeisme.integration_test_evidence.v1",
    status: "passed",
    layer: "system",
    real_owner_reads: true,
    provider_calls: false,
    mutations: false,
    owners: ownerRows,
    provider_discovery: providerStates,
    tool_catalog: toolCatalog,
    drama_board: dramaBoard,
    task_rows: { active: activeRows.length, history: historyRows.length },
    task_checks: taskChecks,
    boundary_checks: boundaryChecks,
    evidence: evidence,
  };
  await writeFile(join(evidence, "artifacts", "owner-read.json"), JSON.stringify({
    owners: ownerRows,
    connections: core.map((item: any) => ({ id: item.id, owner: item.owner, state: item.state, runtime: item.runtime })),
    task_rows: summary.task_rows,
    task_checks: taskChecks,
    boundary_checks: boundaryChecks,
    provider_discovery: providerStates,
    tool_catalog: toolCatalog,
    drama_board: dramaBoard,
  }, null, 2) + "\n");
  status = "passed";
  record({ status, owners: ownerRows, provider_discovery: providerStates, task_rows: summary.task_rows, task_checks: taskChecks });
} catch (error) {
  summary = { ...summary, error: error instanceof Error ? error.message : "owner_read_failed", evidence };
  record(summary);
} finally {
  child?.kill("SIGTERM");
  setTimeout(() => child?.kill("SIGKILL"), 500);
  await writeFile(join(evidence, "stdout.log"), logs.join("\n") + "\n");
  await writeFile(join(evidence, "stderr.log"), status === "passed" ? "" : JSON.stringify(summary) + "\n");
  await writeFile(join(evidence, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  if (status !== "passed")
    await writeFile(join(evidence, "artifacts", "result.json"), JSON.stringify({ status, boundary_checks: boundaryChecks, summary }, null, 2) + "\n");
  await rm(privateDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ ...summary, evidence }, null, 2));
if (status !== "passed") process.exitCode = 1;
