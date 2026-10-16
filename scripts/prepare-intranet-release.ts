import { mkdir, readFile, writeFile, cp, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

// Prepare only. This command cannot alter units, configuration, credentials or running owners.
if (process.argv.length !== 2) throw Error('Usage: bun scripts/prepare-intranet-release.ts');
const root = resolve(import.meta.dirname, '..');
const workspace = resolve(root, '../..');
const id = 'intranet-candidate-' + new Date().toISOString().replace(/[:.]/g, '-');
const run = join(root, 'temp/integration-test-runs', id);
await mkdir(join(run, 'artifacts/control-center/dist'), { recursive: true, mode: 0o700 });
await writeFile(join(run, 'command.txt'), 'bun scripts/prepare-intranet-release.ts\n');
await writeFile(join(run, 'env.json'), JSON.stringify({ layer: 'build', production_changed: false, credentials_created: false, CGO_ENABLED: '0', race: false }));
await writeFile(join(run, 'stdout.log'), '');
await writeFile(join(run, 'stderr.log'), '');
const commands: { command: string; status: number }[] = [];
async function command(bin: string, args: string[], cwd: string) {
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>(done => {
    let stdout = '', stderr = '';
    const child = spawn(bin, args, { cwd, env: { ...process.env, CGO_ENABLED: '0', GOMAXPROCS: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', () => done({ code: 127, stdout, stderr: 'Unable to start build command.' }));
    child.once('close', code => done({ code: code ?? 1, stdout, stderr }));
  });
  const label = [bin, ...args].join(' ');
  commands.push({ command: label, status: result.code });
  await writeFile(join(run, 'stdout.log'), '$ ' + label + '\n' + result.stdout, { flag: 'a' });
  await writeFile(join(run, 'stderr.log'), result.stderr, { flag: 'a' });
  if (result.code) throw Error('candidate_build_failed');
}
const binaries = process.env.YEISME_CONTROL_CENTER_ONLY === "1" ? [] : [
  { owner: 'cli/eikona', name: 'eikona', entry: './cmd/eikona' },
  { owner: 'agent/scaena', name: 'scaena', entry: './cmd/scaena' },
  { owner: 'agent/scaena', name: 'scaena-api', entry: './cmd/scaena-api' },
];
const checksums: Record<string, string> = {};
let failed = false;
try {
  await access(join(root, 'dist/index.html'));
  for (const entry of ['index.html']) {
    await access(join(root, 'dist', entry));
    await cp(join(root, 'dist', entry), join(run, 'artifacts/control-center/dist', entry));
  }
  await cp(join(root, 'dist/assets'), join(run, 'artifacts/control-center/dist/assets'), { recursive: true });
  try {
    await access(join(root, 'dist/v18'));
    await cp(join(root, 'dist/v18'), join(run, 'artifacts/control-center/dist/v18'), { recursive: true });
  } catch {
    // Optional design media is omitted when the build has no public v18 assets.
  }
  // Static files use an explicit allowlist; never copy docs, source archives or test evidence.
  for (const name of ['favicon.svg', 'favicon.ico']) {
    try { await access(join(root, 'dist', name)); } catch { continue; }
    await cp(join(root, 'dist', name), join(run, 'artifacts/control-center/dist', name));
  }
  await command('bun', ['build', 'server/index.ts', '--target=bun', '--outfile=' + join(run, 'artifacts/control-center/server.mjs')], root);
  for (const binary of binaries) {
    const target = join(run, 'artifacts', binary.name);
    await command('go', ['build', '-p', '2', '-trimpath', '-o', target, binary.entry], join(workspace, binary.owner));
    checksums[binary.name] = createHash('sha256').update(await readFile(target)).digest('hex');
  }
  async function fingerprint(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name), name = prefix + '/' + entry.name;
      if (entry.isDirectory()) await fingerprint(file, name);
      else checksums[name] = createHash('sha256').update(await readFile(file)).digest('hex');
    }
  }
  await fingerprint(join(run, 'artifacts/control-center'), 'control-center');
} catch {
  failed = true;
  process.exitCode = 1;
} finally {
  await writeFile(join(run, 'summary.json'), JSON.stringify({ status: failed ? 'failed' : 'passed', commands, checksums, production_changed: false, credentials_created: false, real_owner_reads: false }, null, 2));
  console.log(JSON.stringify({ evidence: run, status: failed ? 'failed' : 'passed', production_changed: false }));
}
