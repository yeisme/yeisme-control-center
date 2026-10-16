import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const files = [...new Set([...tracked, ...["dist", "dist-demo"].flatMap((dir) => {
  if (!existsSync(dir)) return [];
  return execFileSync("find", [dir, "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
})])];
const findings = [];
const rules = [
  { name: "private-host", pattern: /10\.10\.1\.101/g },
  { name: "retired-live-entry", pattern: /https?:\/\/[^\s`)'\"]+:(?:8443|51873)\b/g },
  { name: "bearer-secret", pattern: /Bearer\s+[A-Za-z0-9._~-]{24,}/g },
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];
for (const file of files) {
  if (/\.(png|jpg|jpeg|gif|woff2|zip|mp4|wav)$/i.test(file)) continue;
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }
  for (const rule of rules) {
    for (const match of content.matchAll(rule.pattern)) findings.push({ file: path.normalize(file), rule: rule.name, value: match[0].slice(0, 120) });
  }
}
if (findings.length) {
  console.error(JSON.stringify({ status: "failed", findings }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: "passed", files_scanned: files.length, findings: 0 }));
