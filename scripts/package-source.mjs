import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
const files = {};
// Historical visual specifications remain on the preview; the archive includes all
// implementation, tests, assets, current contracts and licenses.
const historical = new Set([
  "docs/design.md",
  "docs/precision-design.md",
  "docs/right-workspace.md",
  "docs/admincn-design.md",
]);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (
      entry.isFile() &&
      !/source\.zip$/.test(p) &&
      !historical.has(p.replaceAll(path.sep, "/"))
    )
      files[p.replaceAll(path.sep, "/")] = new Uint8Array(fs.readFileSync(p));
  }
}
for (const dir of [
  "src",
  "app",
  "server",
  "docs",
  "tests",
  "scripts",
  "openspec",
  "public/media",
])
  if (fs.existsSync(dir)) walk(dir);
for (const file of [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  ".gitignore",
])
  files[file] = new Uint8Array(fs.readFileSync(file));
fs.mkdirSync("public/media", { recursive: true });
const zip = zipSync(files, { level: 9 });
fs.writeFileSync("public/source.zip", zip);
fs.mkdirSync("temp/delivery", { recursive: true });
const manifest = {
  revision: "admincn-v7",
  files: Object.keys(files).length,
  source_sha256: createHash("sha256").update(zip).digest("hex"),
  real_data_included: false,
  historical_visual_docs: [...historical],
};
fs.writeFileSync(
  "temp/delivery/source.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest));
