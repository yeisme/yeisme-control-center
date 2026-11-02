import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, openSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

/**
 * The control center and `personal-config` both rewrite the configuration file, and each reads it, works, and writes it
 * back whole. Without an exclusive lock between the two, the later writer silently undoes whatever the earlier one did in
 * between (a revocation made in the web console, an account added on the command line).
 *
 * The lock is held by the kernel, not recorded in a file. It is a small SQLite database beside the configuration
 * (`<config>.lock.sqlite`, mode 0600, made on first use) that a writer holds open in a `BEGIN IMMEDIATE` transaction for the whole
 * read, change, write and rename. SQLite takes it as an operating-system file lock, so it is exclusive between processes and
 * between connections of one process, and the operating system lets go of it the moment the holder dies, however it dies
 * (`kill -9` included). There is nothing to time out, no pid to reuse and nothing stale to break.
 */
export const lockWaitMs = 5_000;
export const lockPollMs = 25;

/** Another process holds the lock and did not let go within the wait. Nothing was written. */
export class ConfigBusyError extends Error {
  constructor() {
    super("config_busy");
    this.name = "ConfigBusyError";
  }
}

/** The file is not the version the writer read: something changed it in between, so the writer's copy is out of date. */
export class ConfigChangedError extends Error {
  constructor() {
    super("config_changed");
    this.name = "ConfigChangedError";
  }
}

export interface LockOptions {
  waitMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** A seam for tests: runs after the temporary file is written and before the version is checked for the last time. */
  beforeRename?: () => void;
}

/** Names one version of a file: inode, size, modification and change time. A file renamed into place has a new inode. `absent` when there is none. */
export function fileIdentity(path: string): string {
  try {
    const info = statSync(path);
    return [info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

/**
 * The real path of a configuration file: links resolved, so that the lock and the temporary file are made beside the file
 * that is rewritten, and renaming over the path replaces that file and not a link to it. A file that does not exist yet
 * (`init`) gets the real path of its directory.
 */
export function canonicalConfigPath(file: string): string {
  const absolute = resolve(file);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    return join(realpathSync(dirname(absolute)), basename(absolute));
  } catch {
    return absolute;
  }
}

/** True when the effective user is not the one who owns the file. A file rewritten by root through sudo is root's afterwards, and the service, running as its own user, can no longer read it. */
export const ownerMismatch = (fileUid: number, effectiveUid: number | undefined) => effectiveUid !== undefined && fileUid !== effectiveUid;

/** `other_owner` when the user running the command (`effectiveUid`, by default this process's) is not the owner of the file at `path`; nothing when it is, or when there is no file yet. */
export function ownerProblem(path: string, effectiveUid: number | undefined = process.geteuid?.()): "other_owner" | undefined {
  try {
    return ownerMismatch(statSync(path).uid, effectiveUid) ? "other_owner" : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

const requireModule = createRequire(import.meta.url);
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
interface Connection {
  exec(sql: string): unknown;
  close(): unknown;
}
/** The server and the command line run on Bun (`bun:sqlite`); the tests run on Node (`better-sqlite3`). Both speak SQLite's own file locking, so they exclude each other. */
function openConnection(path: string): Connection {
  if (isBun) {
    const { Database } = requireModule("bun:sqlite") as { Database: new (path: string) => Connection };
    return new Database(path);
  }
  const module = requireModule("better-sqlite3") as (new (path: string, options?: object) => Connection) | { default: new (path: string, options?: object) => Connection };
  const Database = typeof module === "function" ? module : module.default;
  return new Database(path, { timeout: 0 });
}

const isBusy = (error: unknown) => {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return (typeof code === "string" && code.startsWith("SQLITE_BUSY")) || (typeof message === "string" && /database is locked/i.test(message));
};

/**
 * One try at the lock. Returns what releases it, or nothing when another holder has it. The waiting is done by the caller, in
 * short polls, so that a process that waits is not frozen while it does: the control center keeps serving requests.
 */
function tryLock(lockPath: string): (() => void) | undefined {
  const connection = openConnection(lockPath);
  try {
    connection.exec("PRAGMA busy_timeout = 0");
    connection.exec("BEGIN IMMEDIATE");
  } catch (error) {
    try { connection.close(); } catch { /* nothing to release */ }
    if (isBusy(error)) return undefined;
    throw error;
  }
  return () => {
    try { connection.exec("ROLLBACK"); } catch { /* closing the connection lets go of it anyway */ }
    try { connection.close(); } catch { /* the operating system lets go when the process ends */ }
  };
}

/**
 * Runs `work` while holding the lock of the configuration file `configPath` (links resolved first). Waits up to `waitMs` for
 * another holder, then throws `ConfigBusyError`. Do the slow part of a change (hashing, key generation) before calling this;
 * `work` should only re-read, change and write the file. Failing to open the lock for any other reason (a read-only
 * directory) is thrown as it is.
 */
export async function withConfigLock<T>(configPath: string, work: () => T | Promise<T>, options: LockOptions = {}): Promise<T> {
  const { waitMs = lockWaitMs, pollMs = lockPollMs, now = Date.now } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)));
  const lockPath = canonicalConfigPath(configPath) + ".lock.sqlite";
  // Made private at birth. An existing file is tightened, though it holds nothing: the lock is in the kernel, not in the file.
  closeSync(openSync(lockPath, "a", 0o600));
  try { chmodSync(lockPath, 0o600); } catch { /* not ours to change */ }
  const started = now();
  let release = tryLock(lockPath);
  while (!release) {
    if (now() - started >= waitMs) throw new ConfigBusyError();
    await sleep(pollMs);
    release = tryLock(lockPath);
  }
  try {
    return await work();
  } finally {
    release();
  }
}

/**
 * Replaces the configuration file with `content` (a temporary file renamed over it, mode 0600), if the file is still the version
 * `expectedVersion`. The version is checked once more right before the rename, so a writer that does not take the lock cannot
 * slip a change in after the first check. Call it while holding the lock. Returns the identity of the file it wrote.
 */
export function replaceConfigFile(path: string, content: string, expectedVersion: string, beforeRename?: () => void): string {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
    beforeRename?.();
    if (fileIdentity(path) !== expectedVersion) throw new ConfigChangedError();
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return fileIdentity(path);
}

/**
 * Writes `content` to the configuration file under the lock, but only if the file is still the version `readVersion` that the
 * writer read before it started its work. A writer that read, worked for a while and writes its whole copy back would otherwise
 * undo whatever another writer stored in between. Returns the identity of the file it wrote; throws `ConfigChangedError` or
 * `ConfigBusyError` and writes nothing.
 */
export async function writeConfigIfUnchanged(path: string, readVersion: string, content: string, options: LockOptions = {}): Promise<string> {
  const real = canonicalConfigPath(path);
  return withConfigLock(real, () => {
    if (fileIdentity(real) !== readVersion) throw new ConfigChangedError();
    return replaceConfigFile(real, content, readVersion, options.beforeRename);
  }, options);
}
