import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ConfigBusyError, fileIdentity, ownerMismatch, ownerProblem, withConfigLock } from "../server/config-lock";

const dir = mkdtempSync(join(tmpdir(), "yeisme-lock-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const target = () => join(dir, `config-${++counter}.json`);
/** A clock the test drives: sleeping moves it, so a five second wait costs no time. */
const fakeTime = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } };
};
/** The pid of a process that has already exited. */
const deadPid = () => spawnSync("true").pid!;

describe("the configuration lock", () => {
  it("is a private file holding the holder's pid and time while work runs, and is gone afterwards", async () => {
    const path = target();
    const seen = await withConfigLock(path, () => {
      const info = statSync(path + ".lock");
      const [pid, at] = readFileSync(path + ".lock", "utf8").trim().split(":").map(Number);
      return { mode: info.mode & 0o777, pid, recent: Math.abs(Date.now() - at) < 5_000 };
    });
    expect(seen).toEqual({ mode: 0o600, pid: process.pid, recent: true });
    expect(existsSync(path + ".lock")).toBe(false);
  });

  it("releases the lock when the work throws, and returns the work's value otherwise", async () => {
    const path = target();
    await expect(withConfigLock(path, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(path + ".lock")).toBe(false);
    expect(await withConfigLock(path, async () => 42)).toBe(42);
  });

  it("makes a second caller wait for the first, and run only after it let go", async () => {
    const path = target();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = withConfigLock(path, async () => { order.push("first:start"); await gate; order.push("first:end"); });
    const second = withConfigLock(path, () => { order.push("second"); }, { pollMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("gives up after the wait with ConfigBusyError, without running the work or touching the holder's lock", async () => {
    const path = target();
    const time = fakeTime();
    writeFileSync(path + ".lock", `${process.pid}:${time.now()}:held\n`, { mode: 0o600 });
    let ran = false;
    await expect(withConfigLock(path, () => { ran = true; }, { ...time, waitMs: 5_000, pollMs: 50 })).rejects.toBeInstanceOf(ConfigBusyError);
    expect(ran).toBe(false);
    expect(time.now() - 1_000_000).toBeGreaterThanOrEqual(5_000);
    expect(readFileSync(path + ".lock", "utf8")).toContain(":held");
  });

  it("breaks a lock whose holder is no longer running", async () => {
    const path = target();
    const time = fakeTime();
    writeFileSync(path + ".lock", `${deadPid()}:${time.now()}:crashed\n`, { mode: 0o600 });
    expect(await withConfigLock(path, () => "ran", time)).toBe("ran");
    expect(existsSync(path + ".lock")).toBe(false);
  });

  it("breaks a lock older than 30 seconds even if its holder looks alive, and leaves a younger one alone", async () => {
    const path = target();
    const time = fakeTime();
    writeFileSync(path + ".lock", `${process.pid}:${time.now() - 29_000}:slow\n`, { mode: 0o600 });
    await expect(withConfigLock(path, () => "ran", { ...time, waitMs: 500 })).rejects.toBeInstanceOf(ConfigBusyError);
    time.advance(2_000);
    expect(await withConfigLock(path, () => "ran", time)).toBe("ran");
  });

  it("does not remove a lock that someone else took over while the work ran", async () => {
    const path = target();
    await withConfigLock(path, () => { writeFileSync(path + ".lock", `${process.pid}:${Date.now()}:other\n`, { mode: 0o600 }); });
    expect(readFileSync(path + ".lock", "utf8")).toContain(":other");
  });

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

describe("file identity", () => {
  it("changes when another file is renamed over the path or the content changes, and says absent for no file", () => {
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
    // As root through sudo: the file would be rewritten as root's, and the service could no longer read it.
    expect(ownerProblem(path, owner === 0 ? 1 : 0)).toBe("other_owner");
    expect(ownerProblem(target(), 0)).toBeUndefined();
  });
});
