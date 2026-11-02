import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { loginLimits } from "../server/login-limits";
import type { AuditRow } from "../server/db/audit";
import { call, cheapWrong as wrong, password, refuseCheaply, running, signIn, viewer } from "./personal-server.support";

beforeEach(() => { refuseCheaply(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const proxy = (client: string) => ({ peer: "127.0.0.1", forwardedFor: client });

/** The sign-in rows of the audit trail, newest first, as an administrator reads them. */
async function loginRows(app: Awaited<ReturnType<typeof running>>["app"]) {
  const admin = await signIn(app, "root", password, proxy("203.0.113.250"));
  expect(admin.response.status).toBe(200);
  const page = await (await call(app, "/audit?limit=100&action=auth.login", { cookie: admin.cookie })).json() as { rows: AuditRow[] };
  return page.rows;
}

describe("what the audit trail keeps of sign-ins", () => {
  it("records the username of a refused sign-in only when it is exactly a configured account, never a key pasted into the box", async () => {
    const { app, auth } = await running();
    await auth.createPersonalUser(viewer("reader"));
    const pasted = "yk_live_" + "A1b2C3d4E5".repeat(4);
    await signIn(app, pasted, wrong, proxy("198.51.100.1"));
    await signIn(app, "reader", wrong, proxy("198.51.100.1"));
    await signIn(app, "root", wrong, proxy("198.51.100.1"));
    await signIn(app, "Reader", wrong, proxy("198.51.100.1"));
    const rows = (await loginRows(app)).filter((row) => row.outcome === "denied");
    expect(rows.map((row) => row.actor).reverse()).toEqual(["(unknown)", "reader", "root", "(unknown)"]);
    expect(JSON.stringify(rows)).not.toContain(pasted);
  });

  it("writes one row when a bucket fills and none for the attempts it then turns away", async () => {
    const { app, auth } = await running();
    await auth.createPersonalUser(viewer("reader"));
    for (let i = 0; i < loginLimits.address + 15; i++) await signIn(app, `nobody-${i}`, wrong, proxy("198.51.100.2"));
    let rows = (await loginRows(app)).filter((row) => row.outcome !== "succeeded");
    // Twenty refusals, and one row saying that the address's bucket filled; the fifteen attempts after that left nothing.
    expect(rows).toHaveLength(loginLimits.address + 1);
    expect(rows.filter((row) => row.meta?.bucket === "address")).toHaveLength(1);
    expect(rows.find((row) => row.meta?.bucket === "address")).toMatchObject({ actor: "(unknown)", outcome: "denied", error_code: "login_rate_limited", action: "auth.login" });
    // An account guessed at from one address: its pair's bucket fills after five.
    for (let i = 0; i < loginLimits.accountAddress + 3; i++) await signIn(app, "reader", wrong, proxy("198.51.100.3"));
    rows = (await loginRows(app)).filter((row) => row.outcome !== "succeeded" && row.actor === "reader");
    expect(rows).toHaveLength(loginLimits.accountAddress + 1);
    expect(rows.find((row) => row.meta?.bucket === "account_address")).toMatchObject({ actor: "reader", error_code: "login_rate_limited" });
  });

  it("writes nothing for a sign-in that was told to wait, and the sign-ins that succeed are written as before", async () => {
    const { app, auth } = await running();
    const before = (await loginRows(app)).length;
    (auth as unknown as { loginBusy: boolean }).loginBusy = true;
    for (let i = 0; i < 5; i++) expect((await signIn(app, "root", password, proxy("198.51.100.4"))).response.status).toBe(429);
    (auth as unknown as { loginBusy: boolean }).loginBusy = false;
    const rows = await loginRows(app);
    // Only the administrator's own sign-ins (the one before and the one that read the trail) are there.
    expect(rows.length).toBe(before + 1);
    expect(rows.every((row) => row.outcome === "succeeded" && row.actor === "root")).toBe(true);
  });

  it("writes a failure that needs no wrong credential at most once a minute per error code", async () => {
    const { app, auth, config } = await running();
    // A named administrator reads the trail; the legacy owner's digest is the one that goes missing.
    const boss = await auth.createPersonalUser({ username: "boss", name: "Boss", role: "admin", scope_ids: ["personal"] });
    const admin = await signIn(app, "boss", boss.access_key, proxy("203.0.113.251"));
    expect(admin.response.status).toBe(200);
    rmSync(config.personal!.password_hash_ref);
    vi.useFakeTimers({ toFake: ["Date"] });
    const failed = async () => {
      for (let i = 0; i < 6; i++) expect((await signIn(app, "root", password, proxy("198.51.100.5"))).response.status).toBe(503);
      const page = await (await call(app, "/audit?limit=100&action=auth.login", { cookie: admin.cookie })).json() as { rows: AuditRow[] };
      return page.rows.filter((row) => row.outcome === "failed").length;
    };
    expect(await failed()).toBe(1);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await failed()).toBe(2);
  });
});
