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
const startServer = (options: { config?: string; env?: Record<string, string> } = {}) => new Promise<{ child: ReturnType<typeof spawn>; output: () => string }>((resolve, reject) => {
  const child = spawn("bun", ["server/index.ts"], {
    cwd: root as string,
    env: { ...process.env, YEISME_CONTROL_CONFIG: options.config ?? configRef, ...options.env },
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
/** SIGTERM, then how the process left: its exit code (null when a signal killed it) and whether it had to be killed. */
const terminate = (child: ReturnType<typeof spawn>, signal: NodeJS.Signals = "SIGTERM") =>
  new Promise<{ code: number | null; killed: boolean }>((resolve) => {
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, 5000);
    child.once("exit", (code) => { clearTimeout(timer); resolve({ code, killed }); });
    child.kill(signal);
  });
const waitFor = async (condition: () => boolean, label: string, ms = 3000) => {
  const until = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
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
// A new session's epoch starts above every earlier session's, so it is a time-sized number and not 1; it must then stay put.
let epoch = 0;
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

  await check("refused sign-ins are counted per client address in the real process, the forwarding header is believed from the local proxy, and an oversized secret is not counted", async () => {
    // The connection is from 127.0.0.1, the proxy's place, so the last entry of X-Forwarded-For is the client, as behind the TLS front.
    const attempt = (client: string, secret: string) => request("/api/control-center/v1/auth/personal", {
      method: "POST", headers: { "X-Forwarded-For": client }, body: JSON.stringify({ username, password: secret }),
    });
    // Five wrong passwords for the administrator from one address (a real check each) fill that account's allowance for that address.
    for (let i = 0; i < 5; i++) assert.equal((await attempt("198.51.100.1", `wrong-password-${i}`)).response.status, 401, `refusal ${i + 1}`);
    const limited = await attempt("198.51.100.1", password);
    assert.equal(limited.response.status, 429);
    assert.equal(limited.json!.error, "login_rate_limited");
    // The same account from another address is untouched: the address counted is the one the proxy named, not the connection's.
    assert.equal((await attempt("198.51.100.2", password)).response.status, 200);
    // A secret over 1024 bytes is not a guess at a credential: 400, never counted, so no flood of them can lock anyone out.
    for (let i = 0; i < 30; i++) {
      const oversized = await attempt("198.51.100.3", "x".repeat(1100 + i));
      assert.equal(oversized.response.status, 400, `oversized ${i + 1}`);
      assert.equal(oversized.json!.error, "invalid_login_request");
    }
    assert.equal((await attempt("198.51.100.3", password)).response.status, 200);
  });

  await check("session reads expose a stable epoch", async () => {
    const { response, json } = await request("/api/control-center/v1/session", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.ok(Number.isSafeInteger(json!.epoch) && (json!.epoch as number) >= 1, `epoch ${json!.epoch}`);
    epoch = json!.epoch as number;
    const again = await request("/api/control-center/v1/session", { headers: { Cookie: cookie } });
    assert.equal(again.json!.epoch, epoch);
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

  await check("the task signing key survives restarts and duplicated reminders are repaired once on start", async () => {
    // Simulates the first start of this release on a database written by older releases: one failure seen
    // under two signatures, handled under the first and reopened as unread under the second.
    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath);
    const key = (db.prepare("select value from control_state where name = 'task_signing_key'").get() as { value: string } | null)?.value;
    assert.ok(key, "signing key persisted on first start");
    db.run("delete from control_state where name = 'notifications_rekey_v1'");
    const identity = Buffer.from(JSON.stringify({ scope: "boot-scope", c: "boot-c", ref: "run-1", family: "run" })).toString("base64url");
    for (const [id, signature, state] of [["n-old", "sig-a", "acknowledged"], ["n-new", "sig-b", "unread"]]) {
      db.run(`insert into task_notifications (id, scope_id, session_id, subject, task_key, failure_fingerprint, state, first_seen_at, last_seen_at) values ('${id}', 'boot-scope', '', 'boot|user', '${identity}.${signature}', '${["boot-scope", identity + "." + signature, "failed", "r1", "failed", ""].join("\u001f")}', '${state}', '2026-10-27T08:00:00Z', '2026-10-27T10:27:31Z')`);
    }
    db.close();
    const restarted = await startServer();
    try {
      const after = new Database(dbPath, { readonly: true });
      const states = after.prepare("select state from task_notifications where scope_id = 'boot-scope' order by id").all() as { state: string }[];
      assert.deepEqual(states.map((row) => row.state), ["acknowledged", "acknowledged"]);
      assert.equal((after.prepare("select value from control_state where name = 'task_signing_key'").get() as { value: string }).value, key);
      assert.ok(after.prepare("select value from control_state where name = 'notifications_rekey_v1'").get());
      after.close();
    } finally {
      await stopServer(restarted.child);
    }
  });

  await check("sessions survive a restart from the sqlite file", async () => {
    const third = await startServer();
    try {
      const { response, json } = await request("/api/control-center/v1/session", { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.equal(json!.epoch, epoch);
      assert.equal(json!.username, username);
    } finally {
      await stopServer(third.child);
    }
  });

  await check("background observation starts only when configured and is not started by YEISME_CONTROL_BACKGROUND=off", async () => {
    const base = JSON.parse(await fs.readFile(configRef, "utf8"));
    const observed = join(temp, "config-observed.json");
    await writeFile(observed, JSON.stringify({ ...base, observation: { enabled: true, interval_minutes: 5 } }, null, 2) + "\n", { mode: 0o600 });
    const status = async () => {
      const { response, json } = await request("/api/control-center/v1/observation/status?scope=boot-scope", { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      return json!;
    };
    // Not configured: the loop does not exist, and the server says so.
    const plain = await startServer();
    try {
      assert.deepEqual(Object.fromEntries(Object.entries(await status()).filter(([key]) => ["enabled", "running", "next_run_at", "last_cycle", "recipient"].includes(key))), { enabled: false, running: false, next_run_at: null, last_cycle: null, recipient: true });
      assert.equal(plain.output().includes("background observation"), false);
    } finally {
      await stopServer(plain.child);
    }
    // Configured: it runs, its first cycle is scheduled, and SIGTERM stops it before the process exits cleanly.
    const on = await startServer({ config: observed });
    try {
      await waitFor(() => on.output().includes("background observation on: every 5 min"), "the start message");
      const body = await status();
      assert.deepEqual([body.enabled, body.running, body.interval_minutes, body.open_tools_every], [true, true, 5, 3]);
      assert.ok(Date.parse(String(body.next_run_at)) - Date.now() > 30_000 && Date.parse(String(body.next_run_at)) - Date.now() <= 80_000, "the first cycle is about a minute away");
      assert.equal(body.last_cycle, null);
    } finally {
      const left = await terminate(on.child);
      assert.deepEqual(left, { code: 0, killed: false });
      const log = on.output();
      const closed = log.indexOf("no longer accepting connections (SIGTERM)");
      const stopped = log.indexOf("background observation stopped (SIGTERM)");
      assert.ok(stopped >= 0, "the loop was not stopped before exit");
      assert.ok(closed >= 0 && closed < stopped, "the server must stop accepting connections before the loop is stopped");
    }
    // A malformed observation block is logged by code and treated as off; it never makes the status route fail.
    const invalid = join(temp, "config-invalid-observation.json");
    await writeFile(invalid, JSON.stringify({ ...base, observation: { enabled: true, interval_minutes: 0, recipients: "not-a-list" } }, null, 2) + "\n", { mode: 0o600 });
    const broken = await startServer({ config: invalid });
    try {
      await waitFor(() => broken.output().includes("background observation is off: the observation block in the config is invalid (observation_interval_out_of_range, observation_recipients_invalid)"), "the invalid block message");
      const body = await status();
      assert.deepEqual([body.enabled, body.config_valid, body.running, body.next_run_at, body.last_cycle], [false, false, false, null, null]);
      assert.equal(broken.output().includes("background observation on"), false);
      assert.equal(broken.output().includes("not-a-list"), false, "the log must name the problem, never the value");
    } finally {
      await stopServer(broken.child);
    }
    // Configured but switched off for this process, as the release candidate check does.
    const off = await startServer({ config: observed, env: { YEISME_CONTROL_BACKGROUND: "off" } });
    try {
      await waitFor(() => off.output().includes("switched off by YEISME_CONTROL_BACKGROUND=off"), "the switched-off message");
      const body = await status();
      assert.deepEqual([body.enabled, body.running, body.next_run_at], [true, false, null]);
      assert.equal(off.output().includes("background observation on"), false);
    } finally {
      await stopServer(off.child);
    }
  });

  // The credential wiring in server/index.ts, in the real process: the first cycle is a minute (and up to 15 s) after
  // the start, so this is the one check here that waits for it.
  await check("background observation reminds about a credential that is running out, in the real process, with no owner to call", async () => {
    const base = JSON.parse(await fs.readFile(configRef, "utf8"));
    const key = join(temp, "boot-owner.key");
    await writeFile(key, "boot-owner-key\n", { mode: 0o600 });
    const config = join(temp, "config-credentials.json");
    // Nothing listens at the connection's endpoint: the cycle can only find out what the file, the record and the config say.
    await writeFile(config, JSON.stringify({
      ...base,
      observation: { enabled: true, interval_minutes: 5 },
      connections: [{ id: "boot-eikona", owner: "eikona", instance_id: "boot", label: "Boot Eikona", environment: "boot", endpoint: "http://127.0.0.1:9/mcp", credential_ref: key, credential_expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), project: "boot-project", enabled: true, allow_private_http: true }],
      principals: [{ ...base.principals[0], scopes: [{ ...base.principals[0].scopes[0], connection_ids: ["boot-eikona"] }] }],
    }, null, 2) + "\n", { mode: 0o600 });
    const running = await startServer({ config });
    try {
      const reminders = async () => (await request("/api/control-center/v1/notifications?scope=boot-scope", { headers: { Cookie: cookie } })).json as { rows: { category: string; title: string; failure_fingerprint: string; session_id: string; target_path: string }[] };
      const until = Date.now() + 110_000;
      let found: Awaited<ReturnType<typeof reminders>>["rows"] = [];
      while (Date.now() < until && !(found = (await reminders()).rows.filter((row) => row.category === "credential")).length) await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.equal(found.length, 1, "no credential reminder after the first cycle");
      assert.deepEqual([found[0].title, found[0].failure_fingerprint, found[0].session_id, found[0].target_path], ["Boot Eikona · 即将到期（7 天内）", "credential:connection:boot-eikona:expiring:7d", "background", "/services"]);
      const { json } = await request("/api/control-center/v1/observation/status?scope=boot-scope", { headers: { Cookie: cookie } });
      const cycle = json!.last_cycle as { reminders_opened: number; errors: Record<string, number> };
      assert.equal(cycle.reminders_opened, 1);
      assert.equal(running.output().includes(key), false, "the log must not name the credential file");
    } finally {
      await stopServer(running.child);
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
