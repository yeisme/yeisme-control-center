import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const full = process.argv[2] === "--full";
if (process.argv.length > (full ? 3 : 2)) throw new Error("Use no arguments or --full.");
const run = resolve("temp/integration-test-runs/daily-" + (full ? "local-gates-" : "backend-") + new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(resolve(run, "artifacts"), { recursive: true });
const commands = full ? [["run", "typecheck"], ["run", "test"], ["run", "build"]] : [["run", "test", "--", "tests/personal-auth.test.ts", "tests/personal-config.test.ts", "tests/service-directory.test.ts", "tests/server-security.test.ts", "tests/task-connections.test.ts"]];
await writeFile(resolve(run, "command.txt"), commands.map(args => "bun " + args.join(" ")).join("\n") + "\n");
await writeFile(resolve(run, "env.json"), JSON.stringify({ phase: full ? "INTEGRATION" : "BACKEND", temporary_credentials_only: true, real_owner_reads: false, race: false }, null, 2) + "\n");
let stdout = "", stderr = "", exitCode = 0;
const started = Date.now();
const results: { command: string; exit_code: number }[] = [];
for (const args of commands) {
  stdout += "$ bun " + args.join(" ") + "\n";
  exitCode = await new Promise<number>(done => {
    const child = spawn("bun", args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", () => { stderr += "Unable to start verification command.\n"; done(1); });
    child.on("close", (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
  results.push({ command: "bun " + args.join(" "), exit_code: exitCode });
  if (exitCode) break;
}
await writeFile(resolve(run, "stdout.log"), stdout);
await writeFile(resolve(run, "stderr.log"), stderr);
await writeFile(resolve(run, "summary.json"), JSON.stringify({ status: exitCode === 0 ? "passed" : "failed", exit_code: exitCode, duration_ms: Date.now() - started, results, real_owner_reads: false }, null, 2) + "\n");
console.log(stdout.slice(-6000));
if (stderr) console.error(stderr.slice(-6000));
console.log("Evidence: " + run);
process.exitCode = exitCode;
