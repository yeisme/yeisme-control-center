import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ConfigChangedError, acquireConfigLock, fileIdentity, writeConfigIfUnchanged } from "../server/config-lock";
import { call, cli, cliAsync, password, rewrite, running, signIn, stored, viewer, waitFor } from "./personal-server.support";

describe("a web revoke and a personal-config save cannot undo each other", () => {
  it("keeps the revocation when the command line writes a copy it read before the revoke (the reported race)", async () => {
    const { auth, app, file } = await running();
    const x = await auth.createPersonalUser(viewer("x"));
    // The command line starts: it reads the file and notes its version. Hashing a new key takes it a few hundred ms.
    const version = fileIdentity(file);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const stale = JSON.stringify({ ...parsed, personal: { ...parsed.personal, users: [...parsed.personal.users, { username: "bob", name: "Bob", role: "viewer", key_hash_ref: join(file + ".users", "bob.key"), scope_ids: ["personal"], enabled: true }] } }, null, 2) + "\n";
    expect(JSON.parse(stale).personal.users.find((user: { username: string }) => user.username === "x").enabled).toBe(true);
    // Meanwhile the revoke is made on the web and stored.
    await auth.revokePersonalUser("x");
    // The command line's save finds a different file and writes nothing.
    await expect(writeConfigIfUnchanged(file, version, stale)).rejects.toBeInstanceOf(ConfigChangedError);
    expect(stored(file).personal?.users?.map((user) => [user.username, user.enabled])).toEqual([["x", false]]);
    // The key that was revoked stays refused, on this request and after the file is read again.
    expect((await signIn(app, "x", x.access_key)).response.status).toBe(401);
    expect(auth.listPersonalUsers().map((user) => [user.username, user.enabled])).toEqual([["x", false]]);
  });

  it("runs the same race with the real command: it finds the file changed while it waited for the lock, stores nothing and leaves no key behind", async () => {
    const { auth, app, file, home } = await running();
    const x = await auth.createPersonalUser(viewer("x"));
    const bobKey = join(home, "bob.key");
    // Someone else holds the lock, as a web write in progress would.
    const lock = await acquireConfigLock(file);
    const command = cliAsync("user", file, "add", "bob", "viewer", "Bob", "--key-file", bobKey);
    // The command has read the file and made its key digest; its save is now waiting for the lock.
    await waitFor(() => existsSync(join(file + ".users", "bob.key")));
    // The revoke the web console made is stored (a write by another writer, finished before the lock is let go).
    rewrite(file, (config) => { config.personal.users = config.personal.users.map((user: { username: string }) => user.username === "x" ? { ...user, enabled: false } : user); });
    lock.release();
    const result = await command.done;
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("配置文件在读取后被改动，请重新运行");
    expect(stored(file).personal?.users?.map((user) => [user.username, user.enabled])).toEqual([["x", false]]);
    expect(existsSync(bobKey)).toBe(false);
    expect(existsSync(join(file + ".users", "bob.key"))).toBe(false);
    expect(readdirSync(home).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect((await signIn(app, "x", x.access_key)).response.status).toBe(401);
    // Run again, it reads the current file and adds the account.
    expect(cli("user", file, "add", "bob", "viewer", "Bob", "--key-file", bobKey).status).toBe(0);
    expect(stored(file).personal?.users?.map((user) => user.username)).toEqual(["x", "bob"]);
  });

  it("keeps a revocation made with the command line when the server writes next, though it had not noticed it yet", async () => {
    const { auth, app, file } = await running();
    const x = await auth.createPersonalUser(viewer("x"));
    expect(cli("user", file, "revoke", "x").status).toBe(0);
    // No request has run since: the server still has x enabled in memory. Its own write re-reads the file under the lock.
    await auth.createPersonalUser(viewer("z"));
    expect(stored(file).personal?.users?.map((user) => [user.username, user.enabled])).toEqual([["x", false], ["z", true]]);
    expect(auth.listPersonalUsers().map((user) => [user.username, user.enabled])).toEqual([["x", false], ["z", true]]);
    expect((await signIn(app, "x", x.access_key)).response.status).toBe(401);
  });

  it("writes the file privately whatever mode it had", () => {
    const home = spawnSync("mktemp", ["-d", "-p", process.env.TMPDIR ?? "/tmp"], { encoding: "utf8" }).stdout.trim();
    try {
      const file = join(home, "control.json");
      expect(cli("init", file, "http://127.0.0.1:4312", "boss").status).toBe(0);
      expect(cli("user", file, "add", "reader", "viewer", "Reader", "--key-file", join(home, "reader.key")).status).toBe(0);
      chmodSync(file, 0o644);
      expect(cli("user", file, "revoke", "reader").status).toBe(0);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(file + ".lock.sqlite").mode & 0o777).toBe(0o600);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("a write waits for the lock and gives up politely, and a lock that is let go is free at once", () => {
  const holdLock = async (file: string) => {
    const lock = await acquireConfigLock(file);
    return { release: async () => { lock.release(); } };
  };

  it("answers 503 config_busy when the lock stays held, keeps the revocation in force in memory, and stores it with the next write", async () => {
    const { auth, app, file } = await running();
    const x = await auth.createPersonalUser(viewer("x"));
    auth.lockOptions = { waitMs: 150, pollMs: 10 };
    const lock = await holdLock(file);
    await expect(auth.revokePersonalUser("x")).rejects.toMatchObject({ code: "config_busy", status: 503 });
    // Revoked at once in memory, though nothing was stored.
    expect((await signIn(app, "x", x.access_key)).response.status).toBe(401);
    expect(stored(file).personal?.users?.[0]?.enabled).toBe(true);
    await lock.release();
    // The next write, by anyone, carries the pending revocation into the file.
    await auth.createPersonalUser(viewer("z"));
    expect(stored(file).personal?.users?.map((user) => [user.username, user.enabled])).toEqual([["x", false], ["z", true]]);
  });

  it("refuses to create an account while the lock is held, and leaves no account and no key digest", async () => {
    const { auth, file } = await running();
    auth.lockOptions = { waitMs: 100, pollMs: 10 };
    const lock = await holdLock(file);
    await expect(auth.createPersonalUser(viewer("late"))).rejects.toMatchObject({ code: "config_busy", status: 503 });
    await lock.release();
    expect(existsSync(join(file + ".users", "late.key"))).toBe(false);
    expect(auth.listPersonalUsers()).toEqual([]);
    // Once the lock is free the same request works.
    await auth.createPersonalUser(viewer("late"));
    expect(auth.listPersonalUsers().map((user) => user.username)).toEqual(["late"]);
  });

  it("waits for a lock that is let go in time", async () => {
    const { auth, file } = await running();
    auth.lockOptions = { waitMs: 2_000, pollMs: 10 };
    const lock = await holdLock(file);
    const creating = auth.createPersonalUser(viewer("patient"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await lock.release();
    await creating;
    expect(stored(file).personal?.users?.map((user) => user.username)).toEqual(["patient"]);
  });

  it("is not held up by a process that was killed while it held the lock: the kernel let go of it at once", async () => {
    const { auth, file } = await running();
    const holder = spawn("bun", ["tests/fixtures/lock-holder.ts", file], { stdio: ["ignore", "pipe", "ignore"] });
    let said = "";
    holder.stdout.on("data", (chunk) => { said += chunk; });
    await waitFor(() => said.includes("locked"));
    auth.lockOptions = { waitMs: 150, pollMs: 10 };
    await expect(auth.createPersonalUser(viewer("blocked"))).rejects.toMatchObject({ code: "config_busy", status: 503 });
    const gone = new Promise((resolve) => holder.on("close", resolve));
    holder.kill("SIGKILL");
    await gone;
    auth.lockOptions = {};
    const started = Date.now();
    await auth.createPersonalUser(viewer("one"));
    await auth.createPersonalUser(viewer("two"));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(stored(file).personal?.users?.map((user) => user.username)).toEqual(["one", "two"]);
  });

  it("makes the command line give up with a Chinese message after its wait, writing nothing", async () => {
    const { file, home } = await running();
    const before = readFileSync(file, "utf8");
    const lock = await holdLock(file);
    const started = Date.now();
    const result = await cliAsync("user", file, "add", "slow", "viewer", "Slow", "--key-file", join(home, "slow.key")).done;
    await lock.release();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("配置文件正被另一个进程写入");
    expect(Date.now() - started).toBeGreaterThanOrEqual(5_000);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(home, "slow.key"))).toBe(false);
    expect(existsSync(join(file + ".users", "slow.key"))).toBe(false);
  }, 60_000);
});

describe("a configuration reached through a link", () => {
  it("is rewritten in place by the server and by the command line, with the lock and the key digests beside the real file", async () => {
    const { auth, app, config, file, home } = await running();
    const link = join(mkdtempSync(join(tmpdir(), "yeisme-link-")), "control.json");
    symlinkSync(file, link);
    config.config_file = link;
    try {
      const web = await auth.createPersonalUser(viewer("web"));
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(stored(file).personal?.users?.map((user) => user.username)).toEqual(["web"]);
      expect(existsSync(join(file + ".users", "web.key"))).toBe(true);
      expect(readdirSync(home).filter((name) => name.endsWith(".tmp"))).toEqual([]);
      expect((await signIn(app, "web", web.access_key)).response.status).toBe(200);
      // The command line given the link as well: same file, same lock, same digest directory.
      const added = cli("user", link, "add", "cli", "viewer", "Cli", "--key-file", join(home, "cli.key"));
      expect(added.status, added.stderr).toBe(0);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(stored(file).personal?.users?.map((user) => user.username)).toEqual(["web", "cli"]);
      expect(existsSync(join(file + ".users", "cli.key"))).toBe(true);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(existsSync(file + ".lock.sqlite")).toBe(true);
      expect(existsSync(link + ".lock.sqlite")).toBe(false);
      // A revoke made through the link through the server is the one the command line sees next.
      await auth.revokePersonalUser("web");
      expect(JSON.parse(cli("user", link, "list").stdout).map((user: { username: string; enabled: boolean }) => [user.username, user.enabled])).toEqual([["web", false], ["cli", true]]);
    } finally {
      rmSync(join(link, ".."), { recursive: true, force: true });
    }
  });
});

describe("a lock file that cannot be used", () => {
  /** Puts something unusable where the lock file goes: a link to a file that is not a lock, or a pipe. */
  const plant = (file: string, kind: "link" | "pipe") => {
    const lock = file + ".lock.sqlite";
    rmSync(lock, { force: true });
    if (kind === "link") {
      const elsewhere = file + ".elsewhere";
      writeFileSync(elsewhere, "not a lock\n");
      symlinkSync(elsewhere, lock);
    } else {
      expect(spawnSync("mkfifo", [lock]).status).toBe(0);
    }
    return lock;
  };

  it.each(["link", "pipe"] as const)("is answered 503 config_lock_invalid by the web (a %s), with no account made, no key digest left and a revocation kept in memory", async (kind) => {
    const { auth, app, file } = await running();
    const x = await auth.createPersonalUser(viewer("x"));
    plant(file, kind);
    const admin = await signIn(app, "root", password);
    const csrf = (await (await call(app, "/session", { cookie: admin.cookie })).json()).csrf as string;
    const created = await call(app, "/admin/personal-users", { method: "POST", cookie: admin.cookie, csrf, body: { username: "late", name: "Late", role: "viewer", scope_ids: ["personal"] } });
    expect([created.status, (await created.json()).error]).toEqual([503, "config_lock_invalid"]);
    expect(existsSync(join(file + ".users", "late.key"))).toBe(false);
    const revoked = await call(app, "/admin/personal-users/x/revoke", { method: "POST", cookie: admin.cookie, csrf });
    expect([revoked.status, (await revoked.json()).error]).toEqual([503, "config_lock_invalid"]);
    // Revoked at once in memory, though nothing could be stored; the file is as it was.
    expect((await signIn(app, "x", x.access_key)).response.status).toBe(401);
    expect(stored(file).personal?.users?.map((user) => [user.username, user.enabled])).toEqual([["x", true]]);
    // Put right (the unusable file removed), the next write stores the pending revocation and the new account.
    rmSync(file + ".lock.sqlite", { force: true });
    await auth.createPersonalUser(viewer("z"));
    expect(stored(file).personal?.users?.map((user) => [user.username, user.enabled])).toEqual([["x", false], ["z", true]]);
  });

  it.each([["link", "符号链接"], ["pipe", "管道"]] as const)("makes the command line stop with a Chinese message (a %s), writing nothing and leaving no key behind", async (kind, word) => {
    const { file, home } = await running();
    const before = readFileSync(file, "utf8");
    plant(file, kind);
    const started = Date.now();
    const result = await cliAsync("user", file, "add", "bob", "viewer", "Bob", "--key-file", join(home, "bob.key")).done;
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("锁文件");
    expect(result.stderr).toContain(word);
    expect(result.stderr).toContain("没有写入任何内容");
    // Refused at once: neither the five second wait nor a hang on the pipe.
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(home, "bob.key"))).toBe(false);
    expect(existsSync(join(file + ".users", "bob.key"))).toBe(false);
    // Once the file is removed, the same command works and makes a lock file of its own.
    rmSync(file + ".lock.sqlite", { force: true });
    expect(cli("user", file, "add", "bob", "viewer", "Bob", "--key-file", join(home, "bob.key")).status).toBe(0);
    expect(statSync(file + ".lock.sqlite").isFile()).toBe(true);
  }, 30_000);
});
