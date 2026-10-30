/**
 * Runs the provider canary against a private instance of this checkout that uses a copy of the real configuration, so the
 * paid path is accepted on the code under review without publishing or touching the deployed service. The instance gets
 * a temporary login, and its database is a persistent canary ledger outside the repository: a `--run-label` that already
 * ran is answered from the ledger and never submitted again. Flags pass through to `scripts/test-provider-live.ts`, e.g.
 *
 *   bun scripts/run-provider-canary.ts --confirm-live --modality audio --run-label 20261030 --total-usd 0.5 --audio-usd 0.5
 *
 * `--sonora-voice <ref>` points the private copy at another Sonora voice (for example one whose provider Sonora has a
 * credential for) and is recorded in the evidence. Afterwards each Sonora output is fetched once through the owner's
 * `artifact.access` and decoded with ffprobe; the evidence keeps the decoded facts, never the token or the capability link.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { secret } from "../server/auth";
import { hashPassword } from "../server/password";

const root = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const voiceAt = argv.indexOf("--sonora-voice");
const sonoraVoice = voiceAt >= 0 ? argv[voiceAt + 1] : undefined;
if (voiceAt >= 0 && !/^sonora:\/\/voice\/[a-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(sonoraVoice || "")) throw Error("--sonora-voice takes a voice ref such as sonora://voice/fish-audio/zh-hero");
const args = voiceAt >= 0 ? [...argv.slice(0, voiceAt), ...argv.slice(voiceAt + 2)] : argv;
if (!args.includes("--confirm-live") && !args.includes("--dry-run")) throw Error("Pass the canary's flags: --confirm-live (or --dry-run) with USD budgets.");
const state = join(homedir(), ".local/state/yeisme-control-center");
const ledger = process.env.YEISME_CANARY_DB || join(state, "provider-canary.sqlite");
const real = JSON.parse(await readFile(join(homedir(), ".config/yeisme-control-center/config.json"), "utf8"));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function freePort() {
  const probe = createServer();
  await new Promise<void>((done, fail) => { probe.once("error", fail); probe.listen(0, "127.0.0.1", () => done()); });
  const address = probe.address();
  await new Promise<void>((done) => probe.close(() => done()));
  if (!address || typeof address !== "object") throw Error("canary_port_unavailable");
  return address.port;
}

function run(command: string, argv: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string }>((done) => {
    const child = spawn(command, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.once("exit", (code) => done({ code, stdout }));
  });
}

/** One owner tool call over the provider's MCP endpoint, the same way the control center's provider adapter makes it. */
async function ownerTool(owner: "sonora", name: string, toolArgs: Record<string, unknown>) {
  const connection = real.providers?.[owner];
  if (!connection?.endpoint) throw Error(`${owner}_provider_not_configured`);
  const token = connection.credential_ref ? secret(connection.credential_ref) : process.env[connection.credential_env || ""] || "";
  if (!token) throw Error(`${owner}_provider_credential_missing`);
  let protocol = "2025-06-18";
  const rpc = async (method: string, params?: unknown, notification = false) => {
    const id = randomUUID();
    const response = await fetch(connection.endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": protocol },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
    });
    if (notification) { await response.body?.cancel(); return null; }
    if (!response.ok) throw Error(`${owner}_http_${response.status}`);
    return response.json() as Promise<any>;
  };
  const init = await rpc("initialize", { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "yeisme-control-center-canary", version: "0.1.0" } });
  protocol = init?.result?.protocolVersion || protocol;
  await rpc("notifications/initialized", undefined, true);
  return rpc("tools/call", { name, arguments: toolArgs });
}

const extension: Record<string, string> = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "audio/opus": "opus", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac" };

/** Fetches each Sonora output once and decodes it; a result that does not decode fails the acceptance. */
async function decodeSonoraOutputs(evidence: string) {
  const runs = JSON.parse(await readFile(join(evidence, "stdout.log"), "utf8")) as { owner?: string; state?: string; output_refs?: string[] }[];
  const decoded: Record<string, unknown>[] = [];
  for (const runEntry of runs.filter((entry) => entry.owner === "sonora")) {
    for (const [index, ref] of (runEntry.output_refs || []).entries()) {
      const fact: Record<string, unknown> = { owner: "sonora", output_ref: ref, run_state: runEntry.state };
      try {
        const reply = await ownerTool("sonora", "sonora.execute", { action: "artifact.access", args: { artifact_ref: ref, public_base_url: new URL(real.providers.sonora.endpoint).origin } });
        const error = reply?.error || reply?.result?.structuredContent?.error;
        if (error) throw Error(String(error.code || error.message || "artifact_access_failed").slice(0, 120));
        const audio = (reply?.result?.content || []).find((item: { type?: string }) => item?.type === "audio");
        fact.link_returned = (reply?.result?.content || []).some((item: { type?: string }) => item?.type === "resource_link");
        if (!audio?.data) throw Error("audio_not_inlined");
        const file = join(evidence, "artifacts", `sonora-${index + 1}.${extension[audio.mimeType] || "bin"}`);
        await writeFile(file, Buffer.from(audio.data, "base64"));
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_name,sample_rate,channels", "-of", "json", file], { encoding: "utf8" });
        const info = JSON.parse(probe.stdout || "{}");
        const stream = info.streams?.[0] || {};
        Object.assign(fact, { mime: audio.mimeType, bytes: Buffer.from(audio.data, "base64").length, format: info.format?.format_name, codec: stream.codec_name, sample_rate: Number(stream.sample_rate) || null, channels: stream.channels || null, duration_s: Number(info.format?.duration) || null });
        fact.decodes = probe.status === 0 && Number(info.format?.duration) > 0 && Number(stream.sample_rate) > 0;
      } catch (error) {
        Object.assign(fact, { decodes: false, error: (error as Error).message });
      }
      decoded.push(fact);
    }
  }
  await writeFile(join(evidence, "artifacts", "decode.json"), JSON.stringify(decoded, null, 2) + "\n");
  return decoded;
}

const dir = await mkdtemp("/tmp/yeisme-provider-canary-");
let server: ChildProcess | undefined;
try {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const password = randomBytes(18).toString("base64url");
  await mkdir(state, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "password"), (await hashPassword(password)) + "\n", { mode: 0o600 });
  const providers = sonoraVoice ? { ...real.providers, sonora: { ...real.providers.sonora, model_refs: [sonoraVoice] } } : real.providers;
  const config = { ...real, origin, bind: "127.0.0.1", port, providers, database: { path: ledger }, personal: { ...real.personal, username: "provider-canary", role: "admin", password_hash_ref: join(dir, "password"), users: [] } };
  await writeFile(join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await writeFile(join(dir, "login.json"), JSON.stringify({ username: "provider-canary", password }), { mode: 0o600 });
  let log = "";
  server = spawn("bun", ["server/index.ts"], { cwd: root, env: { ...process.env, YEISME_CONTROL_CONFIG: join(dir, "config.json"), YEISME_CONTROL_BIND: "127.0.0.1", YEISME_CONTROL_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout!.on("data", (chunk) => { log += chunk; });
  server.stderr!.on("data", (chunk) => { log += chunk; });
  for (let i = 0; !log.includes("listening"); i += 1) {
    if (i > 160 || server.exitCode !== null) throw Error("canary_server_start_failed");
    await sleep(250);
  }
  const canary = await run("bun", ["scripts/test-provider-live.ts", ...args], { YEISME_CONTROL_ORIGIN: origin, YEISME_CONTROL_LOGIN_FILE: join(dir, "login.json") });
  if (canary.code !== 0) throw Error("canary_failed");
  const evidence = (JSON.parse(canary.stdout.trim().split("\n").at(-1) || "{}") as { evidence?: string }).evidence;
  if (evidence) {
    await writeFile(join(evidence, "artifacts", "overrides.json"), JSON.stringify({ private_instance: true, ledger: "~/.local/state/yeisme-control-center/provider-canary.sqlite", sonora_voice: sonoraVoice || null }, null, 2) + "\n");
    const decoded = await decodeSonoraOutputs(evidence);
    console.log(JSON.stringify({ decoded: decoded.map(({ output_ref: _ref, ...fact }) => fact) }));
    if (decoded.some((fact) => !fact.decodes)) process.exitCode = 1;
  }
} finally {
  server?.kill("SIGTERM");
  await sleep(500);
  await rm(dir, { recursive: true, force: true });
}
