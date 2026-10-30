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
// Generic shapes only: the rules themselves are public, so they never name a real host.
const rules = [
  { name: "private-host", pattern: /10\.10\.1\.101/g },
  { name: "private-ipv4", pattern: /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g },
  // A real account's home directory; one-letter names are test fixtures.
  { name: "home-path", pattern: /(?:\/home\/[a-z][a-z0-9_-]+\/|\/Users\/[A-Za-z][A-Za-z0-9_-]+\/)/g },
  // In an address or a user@host, so property names such as `this.internal` in built code do not count.
  { name: "internal-host", pattern: /(?:https?:\/\/|@)[a-z0-9.-]+\.(?:lan|internal|intranet|corp)\b/gi },
  { name: "retired-live-entry", pattern: /https?:\/\/[^\s`)'\"]+:(?:8443|51873)\b/g },
  { name: "bearer-secret", pattern: /Bearer\s+[A-Za-z0-9._~-]{24,}/g },
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];
for (const file of files) {
  if (/\.(png|jpg|jpeg|gif|webp|woff2|zip|mp4|webm|wav|mp3|m4a)$/i.test(file)) continue;
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
