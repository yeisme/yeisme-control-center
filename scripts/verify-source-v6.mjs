import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
const id = "source-v7-" + new Date().toISOString().replace(/[:.]/g, "-"),
  root = path.resolve("temp/integration-test-runs/" + id),
  area = path.join(root, "artifacts/source");
fs.mkdirSync(area, { recursive: true });
const zip = fs.readFileSync("public/source.zip");
for (const [name, bytes] of Object.entries(unzipSync(zip))) {
  const target = path.resolve(area, name);
  if (!target.startsWith(area + path.sep)) throw Error("Unsafe archive path");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
const commands = [
  ["bun", ["install", "--frozen-lockfile"]],
  ["bun", ["run", "typecheck"]],
  ["bun", ["run", "test"]],
  ["bun", ["run", "build"]],
  ["bun", ["run", "build:demo"]],
];
fs.writeFileSync(
  root + "/command.txt",
  commands.map(([c, a]) => c + " " + a.join(" ")).join("\n"),
);
fs.writeFileSync(
  root + "/env.json",
  JSON.stringify({
    node: process.version,
    isolated_source: true,
    real_service_calls: false,
  }),
);
let failed = false;
for (const [c, args] of commands) {
  const r = spawnSync(c, args, { cwd: area, encoding: "utf8" });
  fs.appendFileSync(root + "/stdout.log", r.stdout || "");
  fs.appendFileSync(root + "/stderr.log", r.stderr || "");
  console.log(c + " " + args.join(" ") + ": " + r.status);
  if (r.status !== 0) {
    failed = true;
    break;
  }
}
const summary = {
  status: failed ? "failed" : "passed",
  design_revision: "admincn-v7",
  source_archive_sha256: createHash("sha256").update(zip).digest("hex"),
  commands: commands.map(([c, a]) => [c, ...a].join(" ")),
  evidence: root,
};
fs.writeFileSync(root + "/summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
process.exitCode = failed ? 1 : 0;

if (!failed) {
  fs.writeFileSync(
    "public/source-integrity.json",
    JSON.stringify(
      {
        ...summary,
        evidence: path.relative(process.cwd(), root),
        real_service_reads: false,
      },
      null,
      2,
    ),
  );
  const taskFile =
    "openspec/changes/unify-admincn-six-entry-workspace/tasks.md";
  fs.writeFileSync(
    taskFile,
    fs.readFileSync(taskFile, "utf8").replace("- [ ] 3.3", "- [x] 3.3"),
  );
}
