import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { hashPassword } from "../server/password";
import { runLiveReadback, type ReadbackResult } from "./live-readback";

const candidate = resolve(process.argv[2] || "");
if (!candidate || !candidate.startsWith(resolve("temp/integration-test-runs") + "/") || !existsSync(join(candidate, "artifacts/control-center/server.mjs")))
  throw new Error("Usage: bun scripts/verify-release-component.ts <intranet-candidate-run>");
const run = resolve("temp/integration-test-runs/release-component-" + new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(join(run, "artifacts"), { recursive: true, mode: 0o700 });
await writeFile(join(run, "command.txt"), `bun scripts/verify-release-component.ts ${candidate}\n`);
await writeFile(join(run, "env.json"), JSON.stringify({ candidate, real_owner_reads: false, credentials_logged: false, background_observation: "off" }, null, 2));
// 4313 belongs to the development preview and is never the default; set YEISME_RELEASE_VERIFY_PORT when 4380 is taken.
const port = Number(process.env.YEISME_RELEASE_VERIFY_PORT || 4380);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid_verification_port");
const origin = `http://127.0.0.1:${port}`;
const isolated = await mkdtemp(join(tmpdir(), "yeisme-release-component-"));
const config = join(isolated, "config.json");
let child: ChildProcess | null = null;
let tail = "";
let status = "failed";
let readback: ReadbackResult | undefined;
let failure = "";
const request = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(origin + path, { headers: { Origin: origin } });
      return { status: response.status, type: response.headers.get("content-type") || "", body: await response.text() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("candidate_health_timeout");
};
try {
  const configSource = JSON.parse(await readFile(join(process.env.HOME || "", ".config/yeisme-control-center/config.json"), "utf8"));
  configSource.origin = origin;
  configSource.port = port;
  // Never open the live database: the candidate gets a fresh one beside the isolated config. Migrating real data is
  // rehearsed separately on a copy, and happens for real only when the release is activated.
  delete configSource.database;
  // The copy still names the real owner credentials, so the candidate must not read any owner on its own: observation is off
  // here as well as by YEISME_CONTROL_BACKGROUND=off below.
  configSource.observation = { ...configSource.observation, enabled: false };
  // A throwaway viewer for the read-back, in this copy only: its key exists in memory and as a digest in the temp directory
  // that is removed at the end. The live configuration is read, never written.
  if (!configSource.personal || !Array.isArray(configSource.personal.scope_ids) || !configSource.personal.scope_ids.length) throw new Error("candidate_probe_account_unavailable");
  const probe = { username: "release-candidate-probe", key: "yk_live_" + randomBytes(32).toString("base64url") };
  const digest = join(isolated, "probe.digest");
  await writeFile(digest, (await hashPassword(probe.key)) + "\n", { mode: 0o600 });
  configSource.personal.users = [...(configSource.personal.users || []), { username: probe.username, name: "Release candidate probe", role: "viewer", key_hash_ref: digest, scope_ids: configSource.personal.scope_ids, enabled: true, created_at: new Date().toISOString() }];
  await writeFile(config, JSON.stringify(configSource, null, 2), { mode: 0o600 });
  // Never grade a foreign server: if anything already answers here, the candidate cannot bind and the checks would hit it instead.
  const busy = await fetch(origin + "/api/control-center/v1/health", { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
  if (busy) throw new Error("verification_port_in_use");
  child = spawn(process.execPath, [join(candidate, "artifacts/control-center/server.mjs")], {
    cwd: join(candidate, "artifacts/control-center"),
    env: { ...process.env, YEISME_CONTROL_CONFIG: config, YEISME_CONTROL_BACKGROUND: "off" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Drained so a chatty server never blocks on a full pipe; only the end is kept, for the evidence of a failure.
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => { tail = (tail + chunk).slice(-4000); });
  const health = await request("/api/control-center/v1/health");
  const methods = await request("/api/control-center/v1/auth/methods");
  if (health.status !== 200 || methods.status !== 200) throw new Error("candidate_http_contract_failed");
  const parsed = JSON.parse(methods.body);
  if (parsed.key_required !== true || parsed.username_required !== true || parsed.oidc !== false) throw new Error("candidate_key_auth_contract_failed");
  // The guide is public: it must open with no session cookie, and be the guide rather than the sign-in shell.
  const guide = await request("/guide.html");
  if (guide.status !== 200 || !guide.body.includes("使用指南")) throw new Error("candidate_public_guide_failed");
  // Its recorded samples ship with it, as media rather than the HTML fallback.
  const sample = await request("/guide/showcase/eikona-gpt-1.webp");
  if (sample.status !== 200 || sample.type !== "image/webp") throw new Error("candidate_guide_samples_failed");
  // Only the served entries are reachable: a source archive or the internal docs are not, whether or not a build left them behind.
  for (const hidden of ["/source.zip", "/docs/README.md"]) {
    const answer = await request(hidden);
    if (answer.status !== 404) throw new Error("candidate_unserved_file_reachable");
  }
  // The viewer read-back against the candidate: one login, no owner reads.
  readback = await runLiveReadback({ origin, credentials: probe });
  await writeFile(join(run, "readback.json"), JSON.stringify(readback, null, 2) + "\n");
  if (readback.status !== "passed") throw new Error("candidate_readback_failed:" + (readback.failure ?? "unknown"));
  status = "passed";
  await writeFile(join(run, "stdout.log"), "candidate health, username+key auth contract, public guide and its samples, unserved files refused, and the viewer read-back passed\n");
  await writeFile(join(run, "stderr.log"), "");
} catch (error) {
  failure = error instanceof Error ? error.message : "candidate_verification_failed";
  await writeFile(join(run, "stdout.log"), "");
  await writeFile(join(run, "stderr.log"), failure + "\n");
  if (tail) await writeFile(join(run, "candidate-output-tail.log"), tail);
} finally {
  child?.kill("SIGTERM");
  await rm(isolated, { recursive: true, force: true });
  const checks = Object.fromEntries((readback?.checks ?? []).map((check) => [check.name, check.state]));
  await writeFile(join(run, "summary.json"), JSON.stringify({ status, ...(failure ? { failure: failure.split(":")[0] } : {}), release: join(candidate, "artifacts/control-center"), candidate, port, readback: readback ? { status: readback.status, ...(readback.failure ? { failure: readback.failure } : {}), checks } : null, background_observation: "off", real_owner_reads: false, credentials_logged: false }, null, 2));
  console.log(JSON.stringify({ evidence: run, status, release: join(candidate, "artifacts/control-center") }));
  if (status !== "passed") process.exitCode = 1;
}
