import { afterAll, describe, expect, it } from "vitest";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ConfigBusyError, ConfigChangedError, ConfigLockInvalidError, acquireConfigLock, canonicalConfigPath, fileIdentity, ownerMismatch, ownerProblem, withConfigLock, writeConfigIfUnchanged } from "../server/config-lock";

const dir = mkdtempSync(join(tmpdir(), "yeisme-lock-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const target = () => join(dir, `config-${++counter}.json`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A clock the test drives: sleeping moves it, so a five second wait costs no time. */
const fakeTime = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};
const holdLock = async (path: string) => {
  const lock = await acquireConfigLock(path);
  return async () => { lock.release(); };
};
/** A real process, run under Bun like the control center and the command line are. */
const bun = (script: string, ...args: string[]) => {
  const child = spawn("bun", [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  const done = new Promise<number | null>((resolve) => child.on("close", (status) => resolve(status)));
  return { child, done, output: () => stdout, said: async (text: string) => { for (let i = 0; i < 1000 && !stdout.includes(text); i++) await sleep(10); return stdout.includes(text); } };
};

describe("the configuration lock", () => {
  it("is a private SQLite file beside the configuration, made on first use, and nothing else is left behind", async () => {
    const path = target();
    await withConfigLock(path, () => undefined);
    expect(statSync(path + ".lock.sqlite").mode & 0o777).toBe(0o600);
    // Nothing recorded in it, nothing journaled beside it.
    expect(readdirSync(dir).filter((name) => name.startsWith(`config-${counter}.json`))).toEqual([`config-${counter}.json.lock.sqlite`]);
    // A file that was made looser is tightened.
    chmodSync(path + ".lock.sqlite", 0o644);
    await withConfigLock(path, () => undefined);
    expect(statSync(path + ".lock.sqlite").mode & 0o777).toBe(0o600);
  });

  it("returns the work's value, throws its error, and is free again afterwards", async () => {
    const path = target();
    expect(await withConfigLock(path, () => 42)).toBe(42);
    await expect(withConfigLock(path, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withConfigLock(path, () => "again")).toBe("again");
  });

  it("makes a second caller in the same process wait for the first, and run only after it let go", async () => {
    const path = target();
    const order: string[] = [];
    const first = await acquireConfigLock(path);
    order.push("first:start");
    const second = withConfigLock(path, () => { order.push("second"); }, { pollMs: 5 });
    await sleep(80);
    expect(order).toEqual(["first:start"]);
    order.push("first:end");
    first.release();
    await second;
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("gives up after the wait with ConfigBusyError, without running the work, and the holder keeps the lock", async () => {
    const path = target();
    const time = fakeTime();
    const release = await holdLock(path);
    let ran = false;
    await expect(withConfigLock(path, () => { ran = true; }, { ...time, waitMs: 5_000, pollMs: 50 })).rejects.toBeInstanceOf(ConfigBusyError);
    expect(ran).toBe(false);
    expect(time.now() - 1_000_000).toBeGreaterThanOrEqual(5_000);
    await expect(withConfigLock(path, () => "still held", { ...time, waitMs: 100, pollMs: 10 })).rejects.toBeInstanceOf(ConfigBusyError);
    await release();
    expect(await withConfigLock(path, () => "free")).toBe("free");
  });

  it("never lets real processes overlap, and a process on Node and others on Bun exclude each other", async () => {
    const path = target();
    const log = join(dir, `overlap-${counter}.log`);
    writeFileSync(log, "");
    const workers = [1, 2, 3].map(() => bun("tests/fixtures/lock-worker.ts", path, log, "6", "25"));
    // This process, on Node's driver, takes the same lock in between.
    for (let round = 0; round < 6; round++) {
      const lock = await acquireConfigLock(path, { waitMs: 30_000 });
      try { appendFileSync(log, `enter node\n`); await sleep(25); appendFileSync(log, `exit node\n`); } finally { lock.release(); }
    }
    expect(await Promise.all(workers.map((worker) => worker.done))).toEqual([0, 0, 0]);
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines).toHaveLength((3 * 6 + 6) * 2);
    for (let i = 0; i < lines.length; i += 2) {
      const [enter, who] = lines[i].split(" ");
      expect([enter, lines[i + 1]]).toEqual(["enter", `exit ${who}`]);
    }
  }, 60_000);

  it("lets go of the lock the moment its holder is killed with SIGKILL, with no stale lock to break", async () => {
    const path = target();
    const holder = bun("tests/fixtures/lock-holder.ts", path);
    expect(await holder.said("locked")).toBe(true);
    // Alive: nobody else gets in.
    await expect(withConfigLock(path, () => "in", { waitMs: 150, pollMs: 10 })).rejects.toBeInstanceOf(ConfigBusyError);
    holder.child.kill("SIGKILL");
    await holder.done;
    const started = Date.now();
    expect(await withConfigLock(path, () => "in", { waitMs: 2_000, pollMs: 10 })).toBe("in");
    expect(Date.now() - started).toBeLessThan(1_000);
  }, 30_000);

  it.skipIf(process.getuid?.() === 0)("passes a failure that is not contention straight through, so a read-only directory is not reported as busy", async () => {
    const home = mkdtempSync(join(dir, "ro-"));
    chmodSync(home, 0o500);
    try {
      await expect(withConfigLock(join(home, "config.json"), () => "ran")).rejects.toMatchObject({ code: expect.stringMatching(/EACCES|EROFS|EPERM/) });
    } finally {
      chmodSync(home, 0o700);
    }
  });
});

describe("the lock stays held while the process does other things with the lock file", () => {
  /** A real Bun process that tries the lock once: `acquired`, `busy` or `error:<name>`. */
  const tryFromAnotherProcess = async (path: string, waitMs = 300) => {
    const child = bun("tests/fixtures/lock-try.ts", path, String(waitMs));
    await child.done;
    return child.output().trim();
  };

  it("is not given up by the calls that wait for it, fail on it or make the file in the same process (the lock file is never opened and closed by hand)", async () => {
    const path = target();
    const lock = await acquireConfigLock(path);
    const time = fakeTime();
    // Each of these looks at the lock file in this process while the lock is held: closing a descriptor of it used to drop the lock.
    for (let call = 0; call < 3; call++) await expect(withConfigLock(path, () => "never", { ...time, waitMs: 200, pollMs: 20 })).rejects.toBeInstanceOf(ConfigBusyError);
    await expect(acquireConfigLock(path, { ...time, waitMs: 50, pollMs: 10 })).rejects.toBeInstanceOf(ConfigBusyError);
    expect(await tryFromAnotherProcess(path)).toBe("busy");
    lock.release();
    expect(await tryFromAnotherProcess(path)).toBe("acquired");
  }, 30_000);

  it("is let go once however many times the holder lets go, and is free for another process afterwards", async () => {
    const path = target();
    const lock = await acquireConfigLock(path);
    lock.release();
    lock.release();
    expect(await tryFromAnotherProcess(path)).toBe("acquired");
    // Taken again after a release: the holder's second release must not let go of this new hold.
    const again = await acquireConfigLock(path);
    lock.release();
    expect(await tryFromAnotherProcess(path)).toBe("busy");
    again.release();
  }, 30_000);
});

describe("the work done under the lock is synchronous", () => {
  it("refuses a promise, lets go of the lock, and does not leave the promise's failure unhandled", async () => {
    const path = target();
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", record);
    try {
      await expect(withConfigLock(path, async () => 1)).rejects.toThrow(TypeError);
      await expect(withConfigLock(path, async () => { throw new Error("late failure"); })).rejects.toThrow(TypeError);
      await expect(withConfigLock(path, () => ({ then: (resolve: (value: number) => void) => resolve(2) }))).rejects.toThrow(TypeError);
      await sleep(30);
    } finally {
      process.off("unhandledRejection", record);
    }
    expect(unhandled).toEqual([]);
    // Free again at once, for this process and another.
    expect(await withConfigLock(path, () => "free", { waitMs: 100, pollMs: 10 })).toBe("free");
  });

  it("passes a plain value, undefined and an object with no `then` through", async () => {
    const path = target();
    expect(await withConfigLock(path, () => undefined)).toBeUndefined();
    expect(await withConfigLock(path, () => ({ ok: true }))).toEqual({ ok: true });
    expect(await withConfigLock(path, () => null)).toBeNull();
  });
});

describe("a lock file that is not a regular file of this user", () => {
  const lockOf = (path: string) => path + ".lock.sqlite";

  it("is refused when it is a link, and the link's target is left alone", async () => {
    const path = target();
    const elsewhere = join(dir, `elsewhere-${counter}`);
    writeFileSync(elsewhere, "not a lock\n", { mode: 0o644 });
    symlinkSync(elsewhere, lockOf(path));
    await expect(withConfigLock(path, () => "ran")).rejects.toMatchObject({ name: "ConfigLockInvalidError", problem: "link" });
    expect(readFileSync(elsewhere, "utf8")).toBe("not a lock\n");
    expect(statSync(elsewhere).mode & 0o777).toBe(0o644);
    // A link to nothing is a link too.
    const dangling = target();
    symlinkSync(join(dir, "does-not-exist"), lockOf(dangling));
    await expect(withConfigLock(dangling, () => "ran")).rejects.toBeInstanceOf(ConfigLockInvalidError);
    expect(existsSync(join(dir, "does-not-exist"))).toBe(false);
  });

  it("is refused at once when it is a pipe, which would otherwise hang the process that opened it", async () => {
    const path = target();
    expect(spawnSync("mkfifo", [lockOf(path)]).status).toBe(0);
    const outcome = await Promise.race([
      withConfigLock(path, () => "ran").then(() => "ran", (error: unknown) => (error as ConfigLockInvalidError).problem),
      sleep(3_000).then(() => "hung"),
    ]);
    expect(outcome).toBe("not_file");
  });

  it("is refused when it is a directory", async () => {
    const path = target();
    mkdirSync(lockOf(path));
    await expect(withConfigLock(path, () => "ran")).rejects.toMatchObject({ problem: "not_file" });
  });

  it("is refused when it belongs to another user, and used when it belongs to this one", async () => {
    const path = target();
    await withConfigLock(path, () => undefined);
    const owner = statSync(lockOf(path)).uid;
    await expect(withConfigLock(path, () => "ran", { euid: owner + 1 })).rejects.toMatchObject({ name: "ConfigLockInvalidError", problem: "other_owner" });
    expect(await withConfigLock(path, () => "ran", { euid: owner })).toBe("ran");
  });

  it("is made by the lock when it is missing, and a looser one is tightened", async () => {
    const path = target();
    expect(existsSync(lockOf(path))).toBe(false);
    await withConfigLock(path, () => undefined);
    expect(statSync(lockOf(path)).mode & 0o777).toBe(0o600);
    chmodSync(lockOf(path), 0o664);
    await withConfigLock(path, () => undefined);
    expect(statSync(lockOf(path)).mode & 0o777).toBe(0o600);
  });
});

describe("the lock of a configuration reached through a link", () => {
  it("is made beside the real file, and the real file is rewritten while the link stays a link", async () => {
    const real = mkdtempSync(join(dir, "real-"));
    const links = mkdtempSync(join(dir, "links-"));
    const file = join(real, "control.json");
    const link = join(links, "control.json");
    writeFileSync(file, "{}\n", { mode: 0o600 });
    symlinkSync(file, link);
    expect(canonicalConfigPath(link)).toBe(canonicalConfigPath(file));
    const version = fileIdentity(link);
    const written = await writeConfigIfUnchanged(link, version, '{"through":"link"}\n');
    expect(written).toBe(fileIdentity(file));
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(file, "utf8")).toBe('{"through":"link"}\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(file + ".lock.sqlite")).toBe(true);
    expect(readdirSync(links)).toEqual(["control.json"]);
    expect(readdirSync(real).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("excludes a writer that names the file by the link from one that names it by its real path", async () => {
    const real = mkdtempSync(join(dir, "real-"));
    const file = join(real, "control.json");
    const link = join(mkdtempSync(join(dir, "links-")), "control.json");
    writeFileSync(file, "{}\n");
    symlinkSync(file, link);
    const release = await holdLock(file);
    await expect(withConfigLock(link, () => "in", { waitMs: 100, pollMs: 10 })).rejects.toBeInstanceOf(ConfigBusyError);
    await release();
    expect(await withConfigLock(link, () => "in")).toBe("in");
  });

  it("gives the real directory's path to a file that does not exist yet", () => {
    const real = mkdtempSync(join(dir, "real-"));
    const links = join(dir, `dirlink-${++counter}`);
    symlinkSync(real, links);
    expect(canonicalConfigPath(join(links, "new.json"))).toBe(join(canonicalConfigPath(real), "new.json"));
    mkdirSync(join(real, "sub"));
    expect(canonicalConfigPath(join(real, "sub", "..", "new.json"))).toBe(join(canonicalConfigPath(real), "new.json"));
  });
});

describe("writing under the lock", () => {
  it("writes nothing when the file is not the version that was read, whether it changed before or during the write", async () => {
    const path = target();
    writeFileSync(path, '{"v":1}\n', { mode: 0o600 });
    const version = fileIdentity(path);
    // Another writer replaces the file the way both of ours do: a new file renamed over it.
    const replaceWith = (content: string) => { writeFileSync(path + ".other", content, { mode: 0o600 }); renameSync(path + ".other", path); };
    // Changed before the lock was taken.
    replaceWith('{"v":2,"by":"another writer"}\n');
    await expect(writeConfigIfUnchanged(path, version, '{"v":"stale"}\n')).rejects.toBeInstanceOf(ConfigChangedError);
    expect(readFileSync(path, "utf8")).toBe('{"v":2,"by":"another writer"}\n');
    // Changed by a writer that does not take the lock, after the first check and before the rename.
    const fresh = fileIdentity(path);
    await expect(writeConfigIfUnchanged(path, fresh, '{"v":"late"}\n', { beforeRename: () => replaceWith('{"v":3,"by":"a writer without the lock"}\n') })).rejects.toBeInstanceOf(ConfigChangedError);
    expect(readFileSync(path, "utf8")).toBe('{"v":3,"by":"a writer without the lock"}\n');
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("writes a file of its own privately when the version is the one that was read", async () => {
    const path = target();
    writeFileSync(path, "{}\n", { mode: 0o644 });
    const written = await writeConfigIfUnchanged(path, fileIdentity(path), '{"ok":true}\n');
    expect(written).toBe(fileIdentity(path));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("file identity and owners", () => {
  it("changes when another file is renamed over the path, and says absent for no file", () => {
    const path = target();
    expect(fileIdentity(path)).toBe("absent");
    writeFileSync(path, "{}\n");
    const first = fileIdentity(path);
    expect(fileIdentity(path)).toBe(first);
    writeFileSync(path + ".next", "{}\n");
    renameSync(path + ".next", path);
    expect(fileIdentity(path)).not.toBe(first);
  });

  it("flags a file owned by someone other than the effective user", () => {
    expect(ownerMismatch(1021, 1021)).toBe(false);
    expect(ownerMismatch(1021, 0)).toBe(true);
    expect(ownerMismatch(0, 1021)).toBe(true);
    expect(ownerMismatch(1021, undefined)).toBe(false);
  });

  it("reports another effective user as a problem for an existing file, and no problem for its owner or a file not made yet", () => {
    const path = target();
    writeFileSync(path, "{}\n");
    const owner = statSync(path).uid;
    expect(ownerProblem(path)).toBeUndefined();
    expect(ownerProblem(path, owner)).toBeUndefined();
    expect(ownerProblem(path, owner === 0 ? 1 : 0)).toBe("other_owner");
    expect(ownerProblem(target(), 0)).toBeUndefined();
  });
});
