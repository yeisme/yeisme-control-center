/**
 * Repeatedly verifies the production boot path that vitest cannot cover: the
 * real `bun server/index.ts` process on bun:sqlite with file persistence,
 * boot auto-migration, audit durability, 0600 file hygiene, session survival
 * across restarts, and interrupted-run recovery to unknown. Evidence lands in
 * temp/integration-test-runs/server-boot-<run-id>/.
 */
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = import.meta.dirname + "/..";
const port = 4340;
const base = "http://127.0.0.1:4340";
const username = "boot-admin";
const password = "server-boot-local-only";
const runId = "server-boot-" + new Date().toISOString().replace(/[:.]/g, "-");
const evidence = join(root as string, "temp/integration-test-runs", runId);
const checks: { name: string; status: "passed" | "failed"; error?: string }[] = [];
const check = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); checks.push({ name, status: "passed" }); }
  catch (error) { checks.push({ name, status: "failed", error: (error as Error).message }); }
};

await fs.mkdir(join(evidence, "artifacts"), { recursive: true, mode: 0o700 });
await writeFile(join(evidence, "command.txt"), "bun run test:server-boot\n");
await writeFile(join(evidence, "env.json"), JSON.stringify({
  origin: base,
  runtime: "bun",
  driver: "bun:sqlite",
  real_owner_reads: false,
  provider_calls: false,
  mutations: false,
}, null, 2) + "\n");

const { hashPassword } = await import("../server/password.js");
const temp = await mkdtemp("/tmp/yeisme-boot-");
const passwordRef = join(temp, "password");
const configRef = join(temp, "config.json");
const dbPath = join(temp, "control-center.sqlite");
await writeFile(passwordRef, (await hashPassword(password)) + "\n", { mode: 0o600 });
await writeFile(configRef, JSON.stringify({
  origin: base, port, bind: "127.0.0.1",
  auth_mode: "personal",
  personal: { name: "Boot Admin", username, role: "admin", password_hash_ref: passwordRef, scope_ids: ["boot-scope"], users: [] },
  principals: [{ issuer: "yeisme:personal", subject: username, name: "Boot Admin", role: "admin", scopes: [{ id: "boot-scope", tenant: "boot", team: "boot", project: "boot-project", label: "Boot", owners: {} }] }],
  owners: {}, connections: [],
  database: { path: dbPath },
}, null, 2) + "\n", { mode: 0o600 });

const logs: string[] = [];
const startServer = () => new Promise<{ child: ReturnType<typeof spawn>; output: () => string }>((resolve, reject) => {
  const child = spawn("bun", ["server/index.ts"], {
    cwd: root as string,
    env: { ...process.env, YEISME_CONTROL_CONFIG: configRef },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    logs.push(chunk.toString());
    if (output.includes("listening on")) resolve({ child, output: () => output });
  };
  child.stdout!.on("data", append);
  child.stderr!.on("data", append);
  child.on("exit", (code) => reject(new Error(`server exited early with code ${code}: ${output}`)));
  setTimeout(() => reject(new Error(`server start timeout: ${output}`)), 20000);
});
const stopServer = (child: ReturnType<typeof spawn>) =>
  new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
  });
const request = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(base + path, {
    ...init,
    headers: { Origin: base, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  let json: unknown = null;
  try { json = await response.json(); } catch { /* non-JSON */ }
  return { response, json: json as Record<string, unknown> | null };
};

let first: Awaited<ReturnType<typeof startServer>>;
let cookie = "";
try {
  first = await startServer();
  await check("boots on bun:sqlite with file persistence and health", async () => {
    const { response, json } = await request("/api/control-center/v1/health");
    assert.equal(response.status, 200);
    assert.equal(json!.service, "yeisme-control-center");
    assert.ok(first.output().includes(`persistence: ${dbPath}`));
  });

  await check("personal login works on the real HTTP edge", async () => {
    const { response } = await request("/api/control-center/v1/auth/personal", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.getSetCookie().find((v) => v.startsWith("yeisme_session="));
    assert.ok(setCookie);
    cookie = setCookie!.split(";")[0];
  });

  await check("session reads expose epoch 1", async () => {
    const { response, json } = await request("/api/control-center/v1/session", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal(json!.epoch, 1);
  });

  await check("migrations, sessions and durable audit land in the sqlite file with 0600", async () => {
    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
    for (const expected of ["sessions", "audit_events", "provider_runs", "usage_events", "idempotency_keys"])
      assert.ok(tables.some((t) => t.name === expected), `missing table ${expected}`);
    const sessions = db.prepare("select count(*) as n from sessions").get() as { n: number };
    assert.ok(sessions.n >= 1);
    const logins = db.prepare("select count(*) as n from audit_events where action = 'auth.login' and outcome = 'succeeded'").get() as { n: number };
    assert.ok(logins.n >= 1);
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const mode = (await stat(dbPath + suffix)).mode & 0o777;
      assert.equal(mode, 0o600, `${dbPath + suffix} mode ${mode.toString(8)}`);
    }
  });

  await check("interrupted provider runs recover as unknown without resubmission", async () => {
    await stopServer(first.child);
    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath);
    db.run(
      "insert into provider_runs (run_ref, owner, modality, model_ref, scope_id, project_ref, trace_ref, state, output_refs, currency, cost_state, observed_at, created_at, evidence_refs, connection_state, budget_reserved) values ('run_boot_test','eikona','image','m','boot-scope','boot-project','t','running','[]','CNY','unknown','2026-10-16T00:00:00Z','2026-10-16T00:00:00Z','[]','configured',1.5)",
    );
    db.close();
    const second = await startServer();
    try {
      assert.ok(second.output().includes("recovered 1 interrupted provider run(s) as unknown"));
      const { response, json } = await request("/api/control-center/v1/provider-runs/run_boot_test?scope=boot-scope", { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.equal(json!.state, "unknown");
      assert.equal(json!.error_code, "server_restarted");
    } finally {
      await stopServer(second.child);
    }
  });

  await check("sessions survive a restart from the sqlite file", async () => {
    const third = await startServer();
    try {
      const { response, json } = await request("/api/control-center/v1/session", { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.equal(json!.epoch, 1);
      assert.equal(json!.username, username);
    } finally {
      await stopServer(third.child);
    }
  });
} catch (error) {
  checks.push({ name: "boot harness", status: "failed", error: (error as Error).message });
  if (first) await stopServer(first.child).catch(() => {});
} finally {
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  const failed = checks.filter((c) => c.status === "failed");
  await writeFile(join(evidence, "summary.json"), JSON.stringify({
    status: failed.length ? "failed" : "passed",
    real_owner_reads: false,
    provider_calls: false,
    mutations: false,
    checks_total: checks.length,
    checks_failed: failed.length,
  }, null, 2) + "\n");
  await writeFile(join(evidence, "artifacts", "checks.json"), JSON.stringify(checks, null, 2) + "\n");
  await writeFile(join(evidence, "artifacts", "server-logs.txt"), logs.join(""));
  await writeFile(join(evidence, "stdout.log"), checks.map((c) => `${c.status === "passed" ? "PASS" : "FAIL"} ${c.name}${c.error ? " :: " + c.error : ""}`).join("\n") + "\n");
  await writeFile(join(evidence, "stderr.log"), "");
  console.log(`server boot: ${failed.length ? "failed" : "passed"} (${checks.length - failed.length}/${checks.length} checks)`);
  console.log(`evidence: ${evidence}`);
  process.exit(failed.length ? 1 : 0);
}
