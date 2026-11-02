import { mkdir, readFile, writeFile, cp, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { servedEntries, unservedPaths } from '../server/static';
import { DirtyTreeError, readReleaseSource, releaseTreeState, type TreeState } from './release-source';

// Prepare only. This command cannot alter units, configuration, credentials or running owners.
if (process.argv.length !== 2) throw Error('Usage: bun scripts/prepare-intranet-release.ts');
const root = resolve(import.meta.dirname, '..');
const workspace = resolve(root, '../..');
const id = 'intranet-candidate-' + new Date().toISOString().replace(/[:.]/g, '-');
const run = join(root, 'temp/integration-test-runs', id);
// The candidate is built from the commit it records: read both before anything is written, and stop on tracked changes
// (YEISME_RELEASE_ALLOW_DIRTY=1 is the explicit way past that; untracked files never count).
let source: { source_commit: string; porcelain: string } = { source_commit: 'unknown', porcelain: '' };
let sourceError = false;
try { source = readReleaseSource(root); } catch { sourceError = true; }
let tree: TreeState = { dirty: false, changed_files: 0, dirty_allowed: false };
const sourceFacts = () => ({ source_commit: source.source_commit, dirty: tree.dirty, dirty_allowed: tree.dirty_allowed, changed_files: tree.changed_files });
const writeEnv = () => writeFile(join(run, 'env.json'), JSON.stringify({ layer: 'build', production_changed: false, credentials_created: false, CGO_ENABLED: '0', race: false, ...sourceFacts() }));
await mkdir(join(run, 'artifacts/control-center/dist'), { recursive: true, mode: 0o700 });
await writeFile(join(run, 'command.txt'), 'bun scripts/prepare-intranet-release.ts\n');
await writeEnv();
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
// What the candidate's dist must have; the rest of servedEntries (guide samples, design pictures, favicons) is optional media.
const requiredEntries = ['index.html', 'guide.html', 'assets/'];
let failed = false;
let failure = '';
async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name), name = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) found.push(...await listFiles(file, name));
    else found.push(name);
  }
  return found;
}
try {
  if (sourceError) throw Error('source_unreadable');
  tree = releaseTreeState(source.porcelain, process.env);
  // Always build here: a dist/ left over from an earlier build, or from other sources, must never become a release.
  await command('bun', ['run', 'build'], root);
  await access(join(root, 'dist/index.html'));
  // Static files use the server's own allowlist; never copy docs, source archives or test evidence.
  const target = join(run, 'artifacts/control-center/dist');
  for (const entry of servedEntries) {
    const name = entry.replace(/\/$/, '');
    try { await access(join(root, 'dist', name)); }
    catch {
      if (requiredEntries.includes(entry)) throw Error('candidate_dist_incomplete');
      continue;
    }
    await cp(join(root, 'dist', name), join(target, name), { recursive: entry.endsWith('/') });
  }
  if (unservedPaths(await listFiles(target)).length) throw Error('candidate_dist_unserved_entry');
  await command('bun', ['build', 'server/index.ts', '--target=bun', '--outfile=' + join(run, 'artifacts/control-center/server.mjs')], root);
  await access(join(root, 'server/db/migrations'));
  await cp(join(root, 'server/db/migrations'), join(run, 'artifacts/control-center/migrations'), { recursive: true });
  await access(join(root, 'node_modules/drizzle-orm'));
  await cp(join(root, 'node_modules/drizzle-orm'), join(run, 'artifacts/control-center/node_modules/drizzle-orm'), { recursive: true });
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
} catch (error) {
  failed = true;
  process.exitCode = 1;
  if (error instanceof DirtyTreeError) {
    failure = 'dirty_working_tree';
    tree = { dirty: true, changed_files: error.changed.length, dirty_allowed: false };
    await writeFile(join(run, 'stderr.log'), `Refusing to build: ${error.changed.length} tracked file(s) differ from HEAD. Commit them, or set YEISME_RELEASE_ALLOW_DIRTY=1 to build anyway.\n`, { flag: 'a' });
  } else {
    const code = error instanceof Error ? error.message : '';
    failure = /^(candidate_[a-z_]+|source_unreadable)$/.test(code) ? code : 'candidate_prepare_failed';
  }
} finally {
  await writeEnv();
  await writeFile(join(run, 'summary.json'), JSON.stringify({ status: failed ? 'failed' : 'passed', ...(failure ? { failure } : {}), ...sourceFacts(), built_here: commands.some(entry => entry.command === 'bun run build' && entry.status === 0), commands, checksums, production_changed: false, credentials_created: false, real_owner_reads: false }, null, 2));
  console.log(JSON.stringify({ evidence: run, status: failed ? 'failed' : 'passed', ...(failure ? { failure } : {}), source_commit: source.source_commit, dirty: tree.dirty, production_changed: false }));
}
