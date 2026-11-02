/**
 * Authenticated read-back of a running control center, as a personal viewer account (see scripts/live-readback.ts for what is
 * checked and for the probe file format). One login per run. Evidence lands in temp/integration-test-runs/<name>-<time>/ and
 * holds statuses and short codes only: no key, cookie, address or response body.
 *
 *   YEISME_RELEASE_PROBE_FILE=<0600 file> [YEISME_RELEASE_PROBE_USERNAME=<name>] bun scripts/verify-live-readback.ts [--name <label>]
 *
 * The target is the deployment's own origin: `YEISME_CONTROL_ORIGIN`, or the one recorded in its deployment manifest. An HTTPS
 * target is verified against the deployment's CA (`YEISME_RELEASE_CA_FILE`, or the public CA copy beside the manifest, or the
 * gateway CA the manifest records).
 * Exit code 0 when every check passed or is absent, 1 otherwise (including a probe file that cannot be used).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadProbeCredentials, probeFileEnv, ReadbackError, runLiveReadback, type ReadbackResult } from "./live-readback";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const nameAt = args.indexOf("--name");
const name = nameAt >= 0 ? args[nameAt + 1] : "live-readback";
if (args.some((arg, at) => arg !== "--name" && at !== nameAt + 1) || !/^[a-z0-9-]{3,40}$/.test(name || ""))
  throw Error("Usage: bun scripts/verify-live-readback.ts [--name <label>]");

const state = join(homedir(), ".local/state/yeisme-control-center");
const run = join(root, "temp/integration-test-runs", `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(join(run, "artifacts"), { recursive: true, mode: 0o700 });
await writeFile(join(run, "command.txt"), "bun scripts/verify-live-readback.ts\n");
await writeFile(join(run, "env.json"), JSON.stringify({ probe_file_configured: !!process.env[probeFileEnv], origin_from_env: !!process.env.YEISME_CONTROL_ORIGIN, real_owner_reads: false, provider_calls: false, mutations: false, credentials_logged: false }, null, 2) + "\n");

let result: ReadbackResult | undefined;
let failure = "";
try {
  const file = process.env[probeFileEnv];
  if (!file) throw new ReadbackError("probe_file_not_configured");
  const credentials = loadProbeCredentials(file);
  const manifest = (() => { try { return JSON.parse(readFileSync(join(state, "deployment.json"), "utf8")) as { origin?: string; ca_certificate?: string }; } catch { return {}; } })();
  const origin = process.env.YEISME_CONTROL_ORIGIN || manifest.origin;
  if (!origin) throw new ReadbackError("origin_not_configured");
  // The CA copy beside the manifest is what control-release trusts; the CA the gateway itself generated is the fallback.
  const caFile = [process.env.YEISME_RELEASE_CA_FILE, join(state, "public/yeisme-control-center-root.crt"), manifest.ca_certificate].find((file) => file && existsSync(file));
  const ca = origin.startsWith("https://") && caFile ? readFileSync(caFile, "utf8") : undefined;
  result = await runLiveReadback({ origin, credentials, ca });
  failure = result.failure ?? "";
} catch (error) {
  failure = error instanceof ReadbackError ? error.code : "readback_unexpected_error";
}

const status = result ? result.status : "failed";
const checks = Object.fromEntries((result?.checks ?? []).map((check) => [check.name, check.state]));
await writeFile(join(run, "artifacts/readback.json"), JSON.stringify(result ?? { status, failure }, null, 2) + "\n");
await writeFile(join(run, "stdout.log"), (result?.checks ?? []).map((check) => `${check.state.toUpperCase()} ${check.name}${check.http_status ? ` (${check.http_status})` : ""}${check.reason ? ` :: ${check.reason}` : ""}`).join("\n") + "\n");
await writeFile(join(run, "stderr.log"), failure ? failure + "\n" : "");
await writeFile(join(run, "summary.json"), JSON.stringify({ status, ...(failure ? { failure } : {}), server_error: result?.server_error ?? false, login_attempts: result?.login_attempts ?? 0, login_status: result?.login_status ?? null, transport: result?.transport ?? null, checks, real_owner_reads: false, provider_calls: false, mutations: false, credentials_logged: false }, null, 2) + "\n");
console.log(JSON.stringify({ evidence: run, status, ...(failure ? { failure } : {}), checks }));
process.exitCode = status === "passed" ? 0 : 1;
