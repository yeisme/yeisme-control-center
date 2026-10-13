import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const origin = "http://10.10.1.101:7456",
  project = "yeisme-service-control-center",
  base = origin + "/api/projects/" + project;
const digest = (b) =>
  b === null ? null : createHash("sha256").update(b).digest("hex");
async function read(name) {
  const r = await fetch(
    base + "/raw/" + name.split("/").map(encodeURIComponent).join("/"),
    { signal: AbortSignal.timeout(20000) },
  );
  if (r.status === 404) return null;
  if (!r.ok) throw Error("Read failed: " + name);
  return Buffer.from(await r.arrayBuffer());
}
async function active() {
  const r = await fetch(origin + "/api/runs?projectId=" + project, {
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error("Cannot check active writers");
  const data = await r.json();
  if (
    (Array.isArray(data) ? data : data.runs || []).some((r) =>
      ["running", "queued"].includes(r.status),
    )
  )
    throw Error("Active writer detected");
}
const entries = new Map();
function walk(dir, prefix = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const source = path.join(dir, e.name),
      name = prefix + e.name;
    if (e.isDirectory()) walk(source, name + "/");
    else entries.set(name, source);
  }
}
walk("dist-demo");
for (const dir of ["src", "app", "docs", "tests", "scripts"])
  walk(dir, dir + "/");
for (const name of [
  "README.md",
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
])
  entries.set(name, name);
// Preflight the existing file API's bounded JSON transport before any upload.
for (const [name, file] of entries) {
  const payload = JSON.stringify({
    name,
    content: fs.readFileSync(file).toString("base64"),
    encoding: "base64",
    overwrite: true,
  });
  if (Buffer.byteLength(payload) > 1024 * 1024)
    throw Error("File exceeds publication transport limit: " + name);
}
const area = "temp/delivery";
fs.mkdirSync(area, { recursive: true });
const demoPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
demoPackage.name = "yeisme-service-control-center-design";
demoPackage.scripts = {
  ...demoPackage.scripts,
  build: "vite build --mode demo",
  dev: "vite --mode demo --host 127.0.0.1 --port 4298",
};
delete demoPackage.scripts.serve;
fs.writeFileSync(
  area + "/demo-package.json",
  JSON.stringify(demoPackage, null, 2) + "\n",
);
entries.set("package.json", area + "/demo-package.json");

if (process.argv.includes("--baseline")) {
  await active();
  const old = JSON.parse(
    fs.readFileSync(area + "/publish-receipt.json", "utf8"),
  );
  // Verify the previous release and every planned target, without printing their contents.
  const expected = {};
  for (let start = 0; start < old.files.length; start += 6) {
    await Promise.all(
      old.files.slice(start, start + 6).map(async (f) => {
        const actual = digest(await read(f.path));
        if (actual !== f.sha256)
          throw Error("Published baseline drift: " + f.path);
        expected[f.path] = actual;
      }),
    );
  }
  const names = [...entries.keys()];
  for (let start = 0; start < names.length; start += 6) {
    await Promise.all(
      names.slice(start, start + 6).map(async (name) => {
        expected[name] = digest(await read(name));
      }),
    );
  }
  await active();
  fs.writeFileSync(
    area + "/admincn-v7-baseline.json",
    JSON.stringify(
      { project, expected, checked_at: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(
    "Verified previous release and " + names.length + " publication targets.",
  );
} else if (process.argv.includes("--publish")) {
  const baseline = JSON.parse(
    fs.readFileSync(area + "/admincn-v7-baseline.json", "utf8"),
  );
  if (baseline.project !== project) throw Error("Wrong project");
  await active();
  const partialPath = area + "/admincn-v7-journal.json";
  if (fs.existsSync(partialPath)) {
    const partial = JSON.parse(fs.readFileSync(partialPath, "utf8"));
    if (partial.project !== project)
      throw Error("Wrong partial publication project");
    for (const file of partial.files || [])
      baseline.expected[file.path] = file.sha256;
  }
  const journal = [];
  for (const [name, file] of [...entries.entries()].sort(
    ([a], [b]) =>
      (a === "index.html") - (b === "index.html") || a.localeCompare(b),
  )) {
    const bytes = fs.readFileSync(file),
      hash = digest(bytes);
    if (!(name in baseline.expected)) throw Error("Unreviewed target " + name);
    const previous = digest(await read(name));
    if (previous === hash) {
      journal.push({ path: name, sha256: hash, unchanged: true });
      continue;
    }
    if (previous !== baseline.expected[name])
      throw Error("Concurrent change: " + name);
    if (name === "index.html") await active();
    const response = await fetch(base + "/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        content: bytes.toString("base64"),
        encoding: "base64",
        overwrite: previous !== null,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw Error("Write failed: " + name + " " + response.status);
    if (digest(await read(name)) !== hash)
      throw Error("Readback mismatch: " + name);
    journal.push({ path: name, sha256: hash });
    fs.writeFileSync(
      area + "/admincn-v7-journal.json",
      JSON.stringify(
        { project, status: "in_progress", files: journal },
        null,
        2,
      ),
    );
    if (journal.length % 20 === 0)
      console.log("Verified " + journal.length + " files");
  }
  fs.writeFileSync(
    area + "/publish-receipt.json",
    JSON.stringify(
      {
        project,
        revision: "admincn-v7",
        files: journal,
        index_last: true,
        real_data: false,
      },
      null,
      2,
    ),
  );
  console.log("Published and read back " + journal.length + " files.");
} else if (process.argv.includes("--verify")) {
  const receipt = JSON.parse(
    fs.readFileSync(area + "/publish-receipt.json", "utf8"),
  );
  for (let i = 0; i < receipt.files.length; i += 6)
    await Promise.all(
      receipt.files.slice(i, i + 6).map(async (f) => {
        if (digest(await read(f.path)) !== f.sha256)
          throw Error("Remote drift: " + f.path);
      }),
    );
  console.log("All remote files match the receipt.");
} else throw Error("Use --baseline, --publish or --verify.");
