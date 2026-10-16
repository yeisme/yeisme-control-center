import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.resolve("temp/delivery");
mkdirSync(output, { recursive: true });
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const files = [];
function walk(dir) {
  for (const entry of execFileSync("find", [dir, "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) {
    files.push({ path: entry, bytes: statSync(entry).size, sha256: sha256(entry) });
  }
}
for (const dir of ["dist", "dist-demo"]) if (statSafe(dir)) walk(dir);
if (statSafe("public/source.zip")) files.push({ path: "public/source.zip", bytes: statSync("public/source.zip").size, sha256: sha256("public/source.zip") });
const packages = new Map();
for (const section of ["dependencies", "devDependencies"]) for (const [name, version] of Object.entries(pkg[section] || {})) packages.set(name, String(version));
try {
  const tree = execFileSync("bun", ["pm", "ls", "--all"], { encoding: "utf8" });
  for (const line of tree.split("\n")) {
    const match = line.match(/^\s*[├└]──\s+(.+)@(\d[^\s]*)\s*$/);
    if (match) packages.set(match[1], match[2]);
  }
} catch {
  // Direct package metadata remains a valid minimal SBOM when the package tree is unavailable.
}
const spdx = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${pkg.name}-${pkg.version}`,
  documentNamespace: `https://yeisme.dev/spdx/${pkg.name}/${pkg.version}`,
  creationInfo: { created: new Date().toISOString(), creators: ["Tool: yeisme-control-center release-manifest"] },
  packages: [...packages].map(([name, version], index) => ({ SPDXID: `SPDXRef-Package-${index + 1}`, name, versionInfo: version, downloadLocation: "NOASSERTION", filesAnalyzed: false })),
};
writeFileSync(path.join(output, "sbom.spdx.json"), JSON.stringify(spdx, null, 2) + "\n", { mode: 0o600 });
const ownerEvidence = latestOwnerEvidence();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
const manifest = {
  schema_version: "yeisme.control_center_release.v1",
  name: pkg.name,
  version: pkg.version,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  working_tree_dirty: dirty,
  generated_at: new Date().toISOString(),
  private_package: pkg.private === true,
  files,
  sbom: { path: "temp/delivery/sbom.spdx.json", sha256: sha256(path.join(output, "sbom.spdx.json")), scope: "bun pm ls --all with package.json fallback" },
  real_provider_calls: false,
  real_owner_reads: ownerEvidence?.status === "passed",
  owner_read_evidence: ownerEvidence?.path || null,
  deployment_applied: false,
};
writeFileSync(path.join(output, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ status: "passed", manifest: "temp/delivery/release-manifest.json", sbom: "temp/delivery/sbom.spdx.json", files: files.length }));
function statSafe(file) { try { statSync(file); return true; } catch { return false; } }
function latestOwnerEvidence() {
  const parent = path.resolve("temp/integration-test-runs");
  if (!statSafe(parent)) return null;
  const candidates = readdirSync(parent)
    .filter((name) => name.startsWith("real-owner-read-"))
    .sort()
    .reverse();
  for (const name of candidates) {
    const summaryPath = path.join(parent, name, "summary.json");
    try {
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      if (summary?.status === "passed" && summary?.real_owner_reads === true && summary?.provider_calls === false && summary?.mutations === false)
        return { status: "passed", path: path.relative(root, summaryPath) };
    } catch {
      // Ignore incomplete evidence directories and keep the most recent complete pass.
    }
  }
  return null;
}
