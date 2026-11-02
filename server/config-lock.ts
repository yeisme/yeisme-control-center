import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";

/**
 * The control center and `personal-config` both rewrite the configuration file, and each reads it, works, and writes it
 * back whole. Without an exclusive lock between the two, the later writer silently undoes whatever the earlier one did in
 * between (a revocation made in the web console, an account added on the command line). This is that lock: a file
 * `<config>.lock`, created with `wx` (so only one process can create it), holding the holder's pid and time.
 */
export const lockWaitMs = 5_000;
export const lockPollMs = 50;
export const lockStaleMs = 30_000;

/** Another process holds the lock and did not let go within the wait. Nothing was written. */
export class ConfigBusyError extends Error {
  constructor() {
    super("config_busy");
    this.name = "ConfigBusyError";
  }
}

export interface LockOptions {
  waitMs?: number;
  pollMs?: number;
  staleMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  alive?: (pid: number) => boolean;
}

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

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

interface Holder { raw: string; pid: number; at: number }
function readHolder(lock: string): Holder | undefined {
  try {
    const raw = readFileSync(lock, "utf8");
    const [pid, at] = raw.trim().split(":").map(Number);
    // A lock being written (created, content not there yet) has no time; the file's own time stands in for it.
    return { raw, pid, at: Number.isFinite(at) ? at : statSync(lock).mtimeMs };
  } catch {
    return undefined;
  }
}

/**
 * Runs `work` while holding `<configPath>.lock`. Waits up to `waitMs` for another holder, then throws `ConfigBusyError`.
 * A lock whose holder is not running, or that is older than `staleMs`, was left by a crash and is broken. Do the slow part
 * of a change (hashing, key generation) before calling this; `work` should only re-read, change and write the file.
 * Failing to create the lock for any other reason (a read-only directory) is thrown as it is.
 */
export async function withConfigLock<T>(configPath: string, work: () => T | Promise<T>, options: LockOptions = {}): Promise<T> {
  const { waitMs = lockWaitMs, pollMs = lockPollMs, staleMs = lockStaleMs, now = Date.now, alive = pidAlive } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lock = configPath + ".lock";
  const token = `${process.pid}:${now()}:${randomBytes(6).toString("hex")}`;
  const started = now();
  for (;;) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try { writeSync(fd, token + "\n"); } finally { closeSync(fd); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = readHolder(lock);
    if (holder && (!alive(holder.pid) || now() - holder.at > staleMs)) {
      // Removed only if it is still the lock that was judged stale; a waiter that got there first may already have made a new one.
      if (readHolder(lock)?.raw === holder.raw) rmSync(lock, { force: true });
      continue;
    }
    // A lock that cannot be read (another user's) or has just vanished is waited on like any other, and the wait is bounded.
    if (now() - started >= waitMs) throw new ConfigBusyError();
    await sleep(pollMs);
  }
  try {
    return await work();
  } finally {
    // Only our own lock is removed: if it was broken as stale while we were slow, someone else holds it now.
    if (readHolder(lock)?.raw.trim() === token) rmSync(lock, { force: true });
  }
}

/** The file is not the version the writer read: something changed it in between, so the writer's copy is out of date. */
export class ConfigChangedError extends Error {
  constructor() {
    super("config_changed");
    this.name = "ConfigChangedError";
  }
}

/**
 * Replaces the configuration file with `content` (a temporary file renamed over it, mode 0600) under the lock, but only if
 * the file is still the version `readVersion` that the writer read before it started its work. A writer that read, worked
 * for a while and writes its whole copy back would otherwise undo whatever another writer stored in between. Returns the
 * identity of the file it wrote; throws `ConfigChangedError` or `ConfigBusyError` and writes nothing.
 */
export async function writeConfigIfUnchanged(path: string, readVersion: string, content: string, options: LockOptions = {}): Promise<string> {
  return withConfigLock(path, () => {
    if (fileIdentity(path) !== readVersion) throw new ConfigChangedError();
    const temp = `${path}.${process.pid}.tmp`;
    rmSync(temp, { force: true });
    try {
      writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    return fileIdentity(path);
  }, options);
}
