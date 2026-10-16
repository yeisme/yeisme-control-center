import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const archive = path.resolve("public/source.zip");
const run = "source-admincn-" + new Date().toISOString().replace(/[:.]/g, "-");
const directory = path.resolve("temp/integration-test-runs", run);
fs.mkdirSync(path.join(directory, "artifacts"), { recursive: true });
const sha = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
const commands = [
  ["bun", "install", "--frozen-lockfile"],
  ["bun", "run", "typecheck"],
  ["bun", "run", "test"],
  ["bun", "run", "build"],
];
fs.writeFileSync(
  path.join(directory, "command.txt"),
  "node scripts/verify-source.mjs\n" +
    commands.map((c) => c.join(" ")).join("\n") +
    "\n",
);
fs.writeFileSync(
  path.join(directory, "env.json"),
  JSON.stringify(
    {
      node: process.version,
      source_archive_sha256: sha,
      isolated_source: true,
    },
    null,
    2,
  ) + "\n",
);
let stdout = "",
  stderr = "",
  code = 0;
const unpack = spawnSync(
  "python3",
  [
    "-c",
    "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
    archive,
    path.join(directory, "artifacts"),
  ],
  { encoding: "utf8" },
);
if (unpack.status !== 0) {
  code = unpack.status || 1;
  stderr += unpack.stderr || String(unpack.error);
}
const results = [];
const extractedRoot = path.join(directory, "artifacts");
const projectRoot = fs.existsSync(path.join(extractedRoot, "yeisme-service-control-center"))
  ? path.join(extractedRoot, "yeisme-service-control-center")
  : extractedRoot;
if (!code)
  for (const command of commands) {
    const r = spawnSync(command[0], command.slice(1), {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024,
    });
    stdout += "\n" + command.join(" ") + "\n" + (r.stdout || "");
    stderr += r.stderr || "";
    results.push({ command: command.join(" "), exit_code: r.status });
    if (r.status !== 0) {
      code = r.status || 1;
      break;
    }
  }
fs.writeFileSync(path.join(directory, "stdout.log"), stdout);
fs.writeFileSync(path.join(directory, "stderr.log"), stderr);
const summary = {
  run_id: run,
  design_revision: "admincn-v5",
  status: code ? "failed" : "passed",
  source_archive_sha256: sha,
  commands: results,
  archive_bytes: fs.statSync(archive).size,
};
fs.writeFileSync(
  path.join(directory, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify({ ...summary, evidence: directory }));
process.exitCode = code;
