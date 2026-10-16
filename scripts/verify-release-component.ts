import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const candidate = resolve(process.argv[2] || "");
if (!candidate || !candidate.startsWith(resolve("temp/integration-test-runs") + "/") || !existsSync(join(candidate, "artifacts/control-center/server.mjs")))
  throw new Error("Usage: bun scripts/verify-release-component.ts <intranet-candidate-run>");
const run = resolve("temp/integration-test-runs/release-component-" + new Date().toISOString().replace(/[:.]/g, "-"));
await (await import("node:fs/promises")).mkdir(join(run, "artifacts"), { recursive: true, mode: 0o700 });
await writeFile(join(run, "command.txt"), `bun scripts/verify-release-component.ts ${candidate}\n`);
await writeFile(join(run, "env.json"), JSON.stringify({ candidate, real_owner_reads: false, credentials_logged: false }, null, 2));
const configSource = JSON.parse(await readFile(join(process.env.HOME || "", ".config/yeisme-control-center/config.json"), "utf8"));
const isolated = await mkdtemp(join(tmpdir(), "yeisme-release-component-"));
const config = join(isolated, "config.json");
configSource.origin = "http://127.0.0.1:4313";
configSource.port = 4313;
await writeFile(config, JSON.stringify(configSource, null, 2), { mode: 0o600 });
const child = spawn(process.execPath, [join(candidate, "artifacts/control-center/server.mjs")], {
  cwd: join(candidate, "artifacts/control-center"),
  env: { ...process.env, YEISME_CONTROL_CONFIG: config },
  stdio: ["ignore", "pipe", "pipe"],
});
const request = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:4313" + path, { headers: { Origin: "http://127.0.0.1:4313" } });
      return { status: response.status, body: await response.text() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("candidate_health_timeout");
};
let status = "failed";
try {
  const health = await request("/api/control-center/v1/health");
  const methods = await request("/api/control-center/v1/auth/methods");
  if (health.status !== 200 || methods.status !== 200) throw new Error("candidate_http_contract_failed");
  const parsed = JSON.parse(methods.body);
  if (parsed.key_required !== true || parsed.username_required !== true || parsed.oidc !== false) throw new Error("candidate_key_auth_contract_failed");
  status = "passed";
  await writeFile(join(run, "stdout.log"), "candidate health and username+key auth contract passed\n");
  await writeFile(join(run, "stderr.log"), "");
} catch (error) {
  await writeFile(join(run, "stdout.log"), "");
  await writeFile(join(run, "stderr.log"), (error instanceof Error ? error.message : "candidate_verification_failed") + "\n");
} finally {
  child.kill("SIGTERM");
  await rm(isolated, { recursive: true, force: true });
  await writeFile(join(run, "summary.json"), JSON.stringify({ status, release: join(candidate, "artifacts/control-center"), candidate, real_owner_reads: false, credentials_logged: false }, null, 2));
  console.log(JSON.stringify({ evidence: run, status, release: join(candidate, "artifacts/control-center") }));
  if (status !== "passed") process.exitCode = 1;
}
