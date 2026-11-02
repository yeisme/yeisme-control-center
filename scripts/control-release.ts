import { access, cp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadProbeCredentials, probeFileEnv, readbackVerdict, runLiveReadback, type ReadbackResult } from './live-readback';

const [candidateArg, proofArg, apply] = process.argv.slice(2);
if (!candidateArg || !proofArg || apply !== '--apply' || process.argv.length !== 5)
  throw Error('Usage: bun scripts/control-release.ts <candidate-run> <release-component-run> --apply');
const root = resolve(import.meta.dirname, '..'), runs = join(root, 'temp/integration-test-runs');
const candidate = resolve(candidateArg), proof = resolve(proofArg);
if (![candidate, proof].every(p => p.startsWith(runs + '/') && !p.slice(runs.length + 1).includes('/'))) throw Error('Evidence must be a direct local run directory.');
const summary = JSON.parse(await readFile(join(candidate, 'summary.json'), 'utf8'));
const verification = JSON.parse(await readFile(join(proof, 'summary.json'), 'utf8'));
const source = join(candidate, 'artifacts/control-center');
if (summary.status !== 'passed' || verification.status !== 'passed' || verification.release !== source) throw Error('Passing release-specific component evidence required.');
const checksums = Object.entries(summary.checksums as Record<string,string>).filter(([file]) => file.startsWith('control-center/'));
if (!checksums.some(([file]) => file === 'control-center/server.mjs') || !checksums.some(([file]) => file === 'control-center/dist/index.html')) throw Error('Incomplete release fingerprints.');
for (const [file, digest] of checksums) {
  if (file.includes('..') || createHash('sha256').update(await readFile(join(candidate, 'artifacts', file))).digest('hex') !== digest)
    throw Error('Candidate fingerprint mismatch.');
}
const state = join(homedir(), '.local/state/yeisme-control-center');
const manifestPath = join(state, 'deployment.json');
const originalManifest = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(originalManifest);
const httpsOrigin = manifest.origin.startsWith('https://');
const expectedOrigin = process.env.YEISME_CONTROL_ORIGIN;
if (!expectedOrigin || manifest.origin !== expectedOrigin || !manifest.release?.startsWith(join(state, 'releases/'))) throw Error('Unexpected deployment target. Set YEISME_CONTROL_ORIGIN to the approved HTTPS origin.');
const unitPath = join(homedir(), '.config/systemd/user/yeisme-control-center.service');
const originalUnit = await readFile(unitPath, 'utf8');
if (!originalUnit.includes('WorkingDirectory=' + manifest.release + '\n') || !originalUnit.includes(manifest.release + '/server.mjs')) throw Error('Running unit differs from release baseline.');
const publicCA = join(state, 'public/yeisme-control-center-root.crt');
const fingerprint = new X509Certificate(await readFile(publicCA)).fingerprint256;
if (fingerprint !== manifest.ca_fingerprint_sha256) throw Error('CA baseline mismatch.');
// Optional authenticated read-back (scripts/live-readback.ts): the verifier's credentials are read before anything changes, so an
// unusable probe file stops the command here instead of surfacing after the release is already live.
const probeFile = process.env[probeFileEnv];
const probe = probeFile ? loadProbeCredentials(probeFile) : undefined;
const id = 'control-release-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = join(runs, id), destination = join(state, 'releases', id);
await mkdir(join(evidence, 'artifacts'), { recursive: true });
await writeFile(join(evidence, 'command.txt'), `bun scripts/control-release.ts ${candidate} ${proof} --apply\n`);
await writeFile(join(evidence, 'env.json'), JSON.stringify({ origin: manifest.origin, owner_units_changed: false, credentials_changed: false, system_trust_changed: false }));
await writeFile(join(evidence, 'stdout.log'), ''); await writeFile(join(evidence, 'stderr.log'), '');
const env = { ...process.env, XDG_RUNTIME_DIR: '/run/user/' + process.getuid!(), DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/' + process.getuid!() + '/bus' };
function systemctl(...args: string[]) {
  const result = spawnSync('systemctl', ['--user', ...args], { env, stdio: 'pipe', timeout: 30000 });
  if (result.status !== 0) throw Error('Control center service operation failed.');
}
async function atomic(file: string, content: string) {
  const temporary = file + '.' + process.pid + '.tmp';
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}
function get(path: string) {
  const args = ['--silent', '--show-error', '--fail', '--max-time', '8'];
  if (manifest.origin.startsWith('https://')) args.push('--cacert', publicCA);
  args.push(manifest.origin + path);
  const result = spawnSync('curl', args, { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) throw Error('Trusted HTTPS readback failed.');
  return result.stdout;
}
let activated = false, changed = false, rolledBack = false, failure = '', readback: ReadbackResult | null = null;
try {
  await access(join(manifest.release, 'server.mjs'));
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  // Preserve the exact rollback unit outside the served dist directory.
  await writeFile(join(destination, 'previous-unit.service'), originalUnit, { mode: 0o600, flag: 'wx' });
  if (await readFile(unitPath, 'utf8') !== originalUnit || await readFile(manifestPath, 'utf8') !== originalManifest) throw Error('Deployment baseline changed during preparation.');
  await atomic(unitPath, originalUnit.split(manifest.release).join(destination)); changed = true;
  systemctl('daemon-reload'); systemctl('restart', 'yeisme-control-center.service');
  let ready = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    try { ready = JSON.parse(get('/api/control-center/v1/health')).status === 'ok'; } catch { /* bounded startup probe */ }
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) throw Error('Release health did not recover.');
  const html = get('/');
  if (html !== await readFile(join(destination, 'dist/index.html'), 'utf8')) throw Error('HTTPS assets differ from the candidate.');
  for (const [file, digest] of checksums.filter(([file]) => /dist\/assets\/.*\.(js|css)$/.test(file))) {
    const content = get('/' + file.slice('control-center/dist/'.length));
    if (createHash('sha256').update(content).digest('hex') !== digest) throw Error('Published asset fingerprint mismatch.');
  }
  if (probe) {
    // One login as the verifier. A 5xx means the release itself is unhealthy and takes the rollback path below; a refused login
    // (401, 429) or any other failed check marks the read-back failed and leaves the release in place for the operator to judge.
    try {
      readback = await runLiveReadback({ origin: manifest.origin, credentials: probe, ca: httpsOrigin ? await readFile(publicCA, 'utf8') : undefined });
    } catch {
      // The probe itself broke (not the service): recorded as a failed read-back, never as a reason to roll back.
      readback = { status: 'failed', failure: 'readback_unexpected_error', server_error: false, login_attempts: 0, transport: httpsOrigin ? 'https' : 'http', loopback: false, checks: [], observed_at: new Date().toISOString() };
    }
    await writeFile(join(evidence, 'readback.json'), JSON.stringify(readback, null, 2) + '\n');
    if (readbackVerdict(readback).rollback) { failure = 'authenticated_read_server_error'; throw Error('Authenticated read-back reached a server error.'); }
  }
  const authenticatedRead = readback ? readbackVerdict(readback).authenticated_read : false;
  const next = { ...manifest, release: destination, previous_release: manifest.release, activated: true,
    verified_at: new Date().toISOString(), evidence: id,
    verification: { transport: httpsOrigin ? 'https' : 'http', health: true, static_assets: true, authenticated_read: authenticatedRead, ...(readback && !authenticatedRead ? { authenticated_read_failure: readbackVerdict(readback).failure } : {}) },
    previous_verification: { release: manifest.release, evidence: manifest.evidence, verified_at: manifest.verified_at },
    source_commit: summary.source_commit ?? null, source_dirty: summary.dirty ?? null,
    component_evidence: proof, owner_configuration_changed: false };
  await atomic(manifestPath, JSON.stringify(next, null, 2) + '\n');
  activated = true;
} catch {
  process.exitCode = 1;
  if (changed) {
    try { await atomic(unitPath, originalUnit); systemctl('daemon-reload'); systemctl('restart', 'yeisme-control-center.service'); rolledBack = true; }
    catch { /* Report failed rollback without claiming recovery. */ }
  }
  await writeFile(join(evidence, 'stderr.log'), `Activation failed${failure ? ' (' + failure + ')' : ''}; rollback=${rolledBack}.\n`);
} finally {
  const result = { status: activated ? 'passed' : 'failed', release: destination, previous_release: manifest.release,
    origin: manifest.origin, activated, rolled_back: rolledBack, tls_verified: activated && httpsOrigin, transport_verified: activated,
    authenticated_read: activated && !!readback && readbackVerdict(readback).authenticated_read, authenticated_read_attempted: !!readback,
    ...(readback && !readbackVerdict(readback).authenticated_read ? { authenticated_read_failure: readbackVerdict(readback).failure } : {}), ...(failure ? { failure } : {}),
    source_commit: summary.source_commit ?? null, source_dirty: summary.dirty ?? null,
    owner_configuration_changed: false, credentials_changed: false, real_owner_reads: false, component_evidence: proof };
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(join(evidence, 'stdout.log'), `Control center activation=${activated}; owner configuration unchanged.\n`);
  console.log(JSON.stringify({ evidence, ...result }));
}
