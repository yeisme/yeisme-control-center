import { access, cp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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
if (manifest.origin !== 'https://10.10.1.101:8443' || !manifest.release?.startsWith(join(state, 'releases/'))) throw Error('Unexpected deployment target.');
const unitPath = join(homedir(), '.config/systemd/user/yeisme-control-center.service');
const originalUnit = await readFile(unitPath, 'utf8');
if (!originalUnit.includes('WorkingDirectory=' + manifest.release + '\n') || !originalUnit.includes(manifest.release + '/server.mjs')) throw Error('Running unit differs from release baseline.');
const publicCA = join(state, 'public/yeisme-control-center-root.crt');
const fingerprint = new X509Certificate(await readFile(publicCA)).fingerprint256;
if (fingerprint !== manifest.ca_fingerprint_sha256) throw Error('CA baseline mismatch.');
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
  const result = spawnSync('curl', ['--silent', '--show-error', '--fail', '--max-time', '8', '--cacert', publicCA, manifest.origin + path], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) throw Error('Trusted HTTPS readback failed.');
  return result.stdout;
}
let activated = false, changed = false, rolledBack = false;
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
  const next = { ...manifest, release: destination, previous_release: manifest.release, activated: true,
    verified_at: new Date().toISOString(), evidence: id, verification: { health: true, static_assets: true, authenticated_read: false },
    previous_verification: { release: manifest.release, evidence: manifest.evidence, verified_at: manifest.verified_at },
    component_evidence: proof, owner_configuration_changed: false };
  await atomic(manifestPath, JSON.stringify(next, null, 2) + '\n');
  activated = true;
} catch {
  process.exitCode = 1;
  if (changed) {
    try { await atomic(unitPath, originalUnit); systemctl('daemon-reload'); systemctl('restart', 'yeisme-control-center.service'); rolledBack = true; }
    catch { /* Report failed rollback without claiming recovery. */ }
  }
  await writeFile(join(evidence, 'stderr.log'), `Activation failed; rollback=${rolledBack}.\n`);
} finally {
  const result = { status: activated ? 'passed' : 'failed', release: destination, previous_release: manifest.release,
    origin: manifest.origin, activated, rolled_back: rolledBack, tls_verified: activated, authenticated_read: false,
    owner_configuration_changed: false, credentials_changed: false, real_owner_reads: false, component_evidence: proof };
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(join(evidence, 'stdout.log'), `Control center activation=${activated}; owner configuration unchanged.\n`);
  console.log(JSON.stringify({ evidence, ...result }));
}
