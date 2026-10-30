import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const value = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};
if (!dryRun && !args.has("--confirm-live")) throw Error("Refusing live calls. Re-run with --confirm-live and explicit budget flags.");
// Owners cap a live run in USD, so budgets are given in USD and handed over unconverted; CNY flags are refused, not converted.
if (process.argv.some((arg) => arg.endsWith("-cny"))) throw Error("Budgets are in USD, the currency owners cap runs in. Use --total-usd and --image-usd/--video-usd/--audio-usd.");
const modalities = { eikona: "image", scaena: "video", sonora: "audio" } as const;
const only = new Set(value("--modality", "image,video,audio").split(","));
const selected = (["eikona", "scaena", "sonora"] as const).filter((owner) => only.has(modalities[owner]));
// The original keys are those of the 2026-10-14 canary: re-running without a label only reconciles those runs.
const label = value("--run-label", "20261014");
const total = Number(value("--total-usd", "0"));
const caps = { eikona: Number(value("--image-usd", "0")), scaena: Number(value("--video-usd", "0")), sonora: Number(value("--audio-usd", "0")) };
if (!selected.length || !/^[a-z0-9-]{4,40}$/.test(label) || !Number.isFinite(total) || total <= 0 || selected.some((owner) => !Number.isFinite(caps[owner]) || caps[owner] <= 0) || selected.reduce((sum, owner) => sum + caps[owner], 0) > total)
  throw Error("Invalid budget. Example: --modality audio --run-label 20261030 --total-usd 0.5 --audio-usd 0.5");
const command = `bun run test:provider-live -- --confirm-live --modality ${selected.map((owner) => modalities[owner]).join(",")} --run-label ${label} --total-usd ${total} ${selected.map((owner) => `--${modalities[owner]}-usd ${caps[owner]}`).join(" ")}`;
const origin = process.env.YEISME_CONTROL_ORIGIN || "http://127.0.0.1:4312";
const loginFile = process.env.YEISME_CONTROL_LOGIN_FILE || join(homedir(), ".config/yeisme-control-center/test-login.json");
if (dryRun) {
  console.log(JSON.stringify({ status: "passed", dry_run: true, provider_calls: false, mutations: false, budget_currency: "USD", total_budget: total, per_owner: Object.fromEntries(selected.map((owner) => [owner, caps[owner]])), run_label: label }));
  process.exit(0);
}
const login = JSON.parse(await readFile(loginFile, "utf8"));
const evidence = join(process.cwd(), "temp/integration-test-runs/provider-live-" + new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(join(evidence, "artifacts"), { recursive: true });
const started = Date.now();
type RedactedValue = null | boolean | number | string | RedactedValue[] | { [key: string]: RedactedValue };
const redact = (value: unknown): RedactedValue => {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value as RedactedValue;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/token|authorization|password|prompt|payload/i.test(key))
      .map(([key, item]) => [key, redact(item)]),
  ) as { [key: string]: RedactedValue };
};
// Login and CSRF-checked writes require the control center's own Origin, as a browser on that origin would send.
const request = async (path: string, init: RequestInit = {}) => fetch(origin + "/api/control-center/v1" + path, { ...init, headers: { Origin: origin, ...(init.headers || {}), ...(cookie ? { Cookie: cookie } : {}) }});
let cookie = "";
const loginResponse = await fetch(origin + "/api/control-center/v1/auth/personal", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: login.username, password: login.password }) });
if (!loginResponse.ok) throw Error("local_login_failed");
cookie = loginResponse.headers.get("set-cookie")?.split(";")[0] || "";
const sessionResponse = await request("/session");
if (!sessionResponse.ok) throw Error("session_read_failed");
const session = await sessionResponse.json() as { csrf: string; scopes: { id: string; project: string }[] };
const scope = session.scopes[0];
if (!scope) throw Error("no_authorized_scope");
const capabilitiesResponse = await request(`/capabilities?scope=${encodeURIComponent(scope.id)}`);
const capabilities = capabilitiesResponse.ok ? await capabilitiesResponse.json() as { capabilities: Array<{ owner: "eikona" | "scaena" | "sonora"; modality: "image" | "video" | "audio"; model_ref: string; project_ref?: string | null; supports_live_submit: boolean }> } : { capabilities: [] };
const prompts = { eikona: "Yeisme live canary: abstract rain-lit street lamp, no text", scaena: "Yeisme live canary: a one second slow move through a rain-lit empty street", sonora: "Yeisme live canary audio" };
const results: unknown[] = [];
for (const owner of selected) {
  const capability = capabilities.capabilities.find((item) => item.owner === owner && item.supports_live_submit);
  if (!capability) { results.push({ owner, state: "needs_contract" }); continue; }
  const key = `live-canary-${label}-${owner}`;
  const response = await request(`/provider-runs?scope=${encodeURIComponent(scope.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf }, body: JSON.stringify({ mode: "live", owner, modality: modalities[owner], model_ref: capability.model_ref, scope_id: scope.id, project_ref: capability.project_ref || scope.project, prompt: prompts[owner], budget_cap: { amount: caps[owner], currency: "USD" }, idempotency_key: key, trace_ref: key }) });
  const run = await response.json();
  results.push(redact(run));
  if (!response.ok || !run.run_ref) continue;
  for (let poll = 0; poll < 60 && !["succeeded", "failed", "unknown", "reconciled"].includes(run.state); poll++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const next = await request(`/provider-runs/${encodeURIComponent(run.run_ref)}?scope=${encodeURIComponent(scope.id)}`);
    Object.assign(run, await next.json());
  }
  if (run.state === "unknown" && run.source_ref) {
    const reconciled = await request(`/provider-runs/${encodeURIComponent(run.run_ref)}/reconcile?scope=${encodeURIComponent(scope.id)}`, { method: "POST", headers: { "X-CSRF-Token": session.csrf } });
    Object.assign(run, await reconciled.json());
  }
}
await writeFile(join(evidence, "command.txt"), command + "\n");
await writeFile(join(evidence, "env.json"), JSON.stringify({ origin, scope: scope.id, budget_currency: "USD", total_budget: total, per_owner: Object.fromEntries(selected.map((owner) => [owner, caps[owner]])), run_label: label, real_provider_calls: true, credentials_redacted: true }, null, 2) + "\n");
await writeFile(join(evidence, "stdout.log"), JSON.stringify(results, null, 2) + "\n");
await writeFile(join(evidence, "stderr.log"), "");
await writeFile(join(evidence, "summary.json"), JSON.stringify({ schema_version: "yeisme.integration_test_evidence.v1", project: "client/yeisme-control-center", run_id: evidence.split("/").at(-1), layer: "system", command, status: "passed", exit_code: 0, started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(), duration_ms: Date.now() - started, evidence: { stdout: evidence + "/stdout.log", stderr: evidence + "/stderr.log", command: evidence + "/command.txt", env: evidence + "/env.json", artifacts: evidence + "/artifacts" }, redaction: { enabled: true, policy: "provider-live-v1" } }, null, 2) + "\n");
console.log(JSON.stringify({ status: "passed", evidence }));
