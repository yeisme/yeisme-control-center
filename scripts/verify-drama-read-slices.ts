/** Local, provider-free read-slice evidence. Wraps the existing test/build tools. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runId = "drama-read-slices-" + new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(root, "temp/integration-test-runs", runId);
const commands = [
  ["bun", "run", "test", "--", "tests/episode-media-http.test.ts", "tests/episode-media-bridge.test.ts", "tests/media-bridge.test.ts", "tests/episode-media-route.test.ts", "tests/template-catalog.test.ts", "tests/episode-production.test.ts", "tests/production-line.test.ts"],
  ["bun", "run", "typecheck"],
  ["bun", "run", "build"],
];
const redact = (value: string) => value
  .replace(/\x1b\[[0-9;]*m/g, "")
  .replaceAll(root, "<project>")
  .replace(/\/(?:home|Users)\/[^\s\"'<>]+/g, "<private-path>")
  .replace(/https?:\/\/[^\s\"'<>]+/g, "<redacted-url>")
  .replace(/(authorization|cookie|token|api[_-]?key|password|secret)\s*[:=]\s*[^\s,}]+/gi, "$1=<redacted>");
await mkdir(join(dir, "artifacts"), { recursive: true, mode: 0o700 });
await writeFile(join(dir, "command.txt"), commands.map((cmd) => cmd.join(" ")).join("\n") + "\n");
await writeFile(join(dir, "env.json"), JSON.stringify({
  scenario: "episode-media-and-template-read-slices", owner_mode: "fake-port-only",
  real_owner_reads: false, provider_calls: false, deployment: false, race: false,
  environment_values: "not_collected",
}, null, 2) + "\n");
let stdout = "", stderr = "", exitCode = 0;
const checks: { command: string; exit_code: number; status: string }[] = [];
try {
  for (const cmd of commands) {
    const child = Bun.spawn(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    stdout += `\n$ ${cmd.join(" ")}\n${redact(out)}`;
    stderr += `\n$ ${cmd.join(" ")}\n${redact(err)}`;
    checks.push({ command: cmd.join(" "), exit_code: code, status: code === 0 ? "passed" : "failed" });
    if (code !== 0) { exitCode = code; break; }
  }
} catch {
  exitCode = 1;
  stderr += "Verification process failed to start.\n";
} finally {
  await writeFile(join(dir, "stdout.log"), stdout);
  await writeFile(join(dir, "stderr.log"), stderr);
  await writeFile(join(dir, "summary.json"), JSON.stringify({
    run_id: runId, status: exitCode === 0 ? "passed" : "failed", exit_code: exitCode,
    evidence_class: "local-component-fake-owner", checks,
    real_owner_mapping_verified: false, real_grant_verified: false,
    production_ready: false, deployed: false,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ evidence: `temp/integration-test-runs/${runId}`, status: exitCode === 0 ? "passed" : "failed", exit_code: exitCode }));
}
process.exitCode = exitCode;
