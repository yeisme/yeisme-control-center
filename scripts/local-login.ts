import { mkdir, writeFile, readFile, stat, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const file = join(homedir(), '.config/yeisme-control-center/test-login.json');
const action = process.argv[2];
if (!['store', 'status'].includes(action || '') || process.argv.length !== 3) throw Error('Usage: bun scripts/local-login.ts store|status');
if (action === 'status') {
  const info = await stat(file);
  const value = JSON.parse(await readFile(file, 'utf8'));
  console.log(JSON.stringify({ configured: typeof value.password === 'string' && value.password.length > 0, username: value.username, mode: (info.mode & 0o777).toString(8), file }));
} else {
  process.stdout.write('Enter the local test password (input hidden), then Enter: ');
  const tty = process.stdin.isTTY;
  if (tty) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  let password = '';
  try {
    password = await new Promise<string>((done, fail) => {
      let value = '';
      const data = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === '\u0003') { process.stdin.off('data', data); fail(Error('Cancelled')); return; }
          if (ch === '\r' || ch === '\n') { process.stdin.off('data', data); done(value); return; }
          if (ch === '\u007f') value = value.slice(0, -1);
          else if (ch >= ' ') value += ch;
          if (Buffer.byteLength(value) > 1024) { process.stdin.off('data', data); fail(Error('Input too long')); return; }
        }
      };
      process.stdin.on('data', data);
      process.stdin.once('end', () => done(value));
    });
  } finally {
    if (tty) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
  }
  if (!password) throw Error('Empty password rejected.');
  await mkdir(join(homedir(), '.config/yeisme-control-center'), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.tmp';
  await writeFile(temporary, JSON.stringify({ username: 'yeisme', password }) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
  password = '';
  console.log('Local test login saved in user-only configuration. Server password hash unchanged.');
}
