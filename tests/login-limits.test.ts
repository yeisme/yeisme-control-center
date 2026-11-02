import { afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { loginBudget, maxSessionsPerAccount, personalIdleMs } from "../server/auth";
import { LoginLimiter, loginLimits } from "../server/login-limits";
import type { Session } from "../server/contracts";
import { call, password, running, signIn, stored, viewer } from "./personal-server.support";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** A personal session as the store holds it, for filling the table without paying for a sign-in each time. */
const personalSession = (i: number, over: Partial<Session> = {}): Session => ({
  id: `filler-${i}`, issuer: "yeisme:personal", subject: `filler-${i}`, name: `Filler ${i}`, csrf: "c", accessToken: "", accessAudience: [],
  expires: Date.now() + 3_600_000, personal: true, last_seen: Date.now(), credential_version: "x", epoch: 1, ...over,
});

describe("one account cannot fill the session table for everyone", () => {
  it("removes sessions that idled out before it counts the table, so forgotten sessions never block a sign-in", async () => {
    const { app, auth } = await running();
    for (let i = 0; i < 100; i++) auth.sessions.set(`filler-${i}`, personalSession(i, { last_seen: Date.now() - personalIdleMs - 60_000 }));
    expect(auth.sessions.size).toBe(100);
    // Not yet past their absolute expiry, so the old pruning kept all of them and the sign-in got 503 session_capacity.
    const admin = await signIn(app, "root", password);
    expect(admin.response.status).toBe(200);
    expect(auth.sessions.size).toBe(1);
  });

  it("removes idle sessions on ordinary requests too, not only at sign-in", async () => {
    const { app, auth } = await running();
    const admin = await signIn(app, "root", password);
    for (let i = 0; i < 5; i++) auth.sessions.set(`filler-${i}`, personalSession(i, { last_seen: Date.now() - personalIdleMs - 1 }));
    auth.sessions.set("busy", personalSession(9));
    expect(auth.sessions.size).toBe(7);
    expect((await call(app, "/session", { cookie: admin.cookie })).status).toBe(200);
    expect(auth.sessions.size).toBe(2);
    expect(auth.sessions.has("busy")).toBe(true);
  });

  it("still refuses a sign-in with 503 when the table is full of sessions in use", async () => {
    const { app, auth } = await running();
    for (let i = 0; i < 100; i++) auth.sessions.set(`filler-${i}`, personalSession(i));
    const admin = await signIn(app, "root", password);
    expect(admin.response.status).toBe(503);
    expect((await admin.response.json()).error).toBe("session_capacity");
  });

  it("ends an account's oldest session when it signs in beyond the per-account limit", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    const cookies: string[] = [];
    for (let i = 0; i < maxSessionsPerAccount + 2; i++) {
      const attempt = await signIn(app, "reader", reader.access_key);
      expect(attempt.response.status).toBe(200);
      cookies.push(attempt.cookie);
    }
    expect([...auth.sessions.values()].filter((session) => session.subject === "reader")).toHaveLength(maxSessionsPerAccount);
    // The two oldest were the ones given up; the newest are alive.
    for (const cookie of cookies.slice(0, 2)) expect((await call(app, "/session", { cookie })).status).toBe(401);
    for (const cookie of cookies.slice(2)) expect((await call(app, "/session", { cookie })).status).toBe(200);
  });
});

describe("the sign-in budget of one account", () => {
  it("refuses one account's 21st sign-in in 15 minutes with 429 login_rate_limited, for that account only", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    const other = await auth.createPersonalUser(viewer("other"));
    for (let i = 0; i < loginBudget.max; i++) expect((await signIn(app, "reader", reader.access_key)).response.status, `sign-in ${i + 1}`).toBe(200);
    const refused = await signIn(app, "reader", reader.access_key);
    expect(refused.response.status).toBe(429);
    expect((await refused.response.json()).error).toBe("login_rate_limited");
    // A hundred sign-ins in all: the other eighty are refused up front, which costs nothing.
    for (let i = loginBudget.max + 1; i < 100; i++) expect((await signIn(app, "reader", reader.access_key)).response.status, `sign-in ${i + 1}`).toBe(429);
    // Nobody else is touched, the administrator included, and the sessions the viewer already holds still work.
    expect((await signIn(app, "root", password)).response.status).toBe(200);
    expect((await signIn(app, "other", other.access_key)).response.status).toBe(200);
    expect([...auth.sessions.values()].filter((session) => session.subject === "reader")).toHaveLength(maxSessionsPerAccount);
    // The window moves on.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + loginBudget.windowMs + 1_000);
    expect((await signIn(app, "reader", reader.access_key)).response.status).toBe(200);
  }, 120_000);

  it("is checked before the sign-in is processed: a refused account neither takes the busy flag nor delays anyone", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    // The budget is full, as if the viewer had signed in 20 times (a full budget is what the check reads).
    (auth as unknown as { loginSuccesses: Map<string, number[]> }).loginSuccesses.set("reader", Array.from({ length: loginBudget.max }, () => Date.now()));
    const [refused, admin] = await Promise.all([signIn(app, "reader", reader.access_key), signIn(app, "root", password)]);
    expect(refused.response.status).toBe(429);
    expect((await refused.response.json()).error).toBe("login_rate_limited");
    expect(admin.response.status).toBe(200);
  });

  it("cannot be used up by someone who does not hold the account's key: only successful sign-ins count", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    const first = await signIn(app, "reader", reader.access_key);
    for (let i = 0; i < 4; i++) expect((await signIn(app, "reader", "yk_live_wrong-wrong-wrong")).response.status).toBe(401);
    // The account's session is still there and it can still sign in: the guesses neither evicted nor counted.
    expect((await call(app, "/session", { cookie: first.cookie })).status).toBe(200);
    expect(((auth as unknown as { loginSuccesses: Map<string, number[]> }).loginSuccesses.get("reader") ?? []).length).toBe(1);
    expect([...auth.sessions.values()].filter((session) => session.subject === "reader")).toHaveLength(1);
    // A name that is not an account never gets an entry, so the budget table cannot be grown from outside.
    await signIn(app, "nobody-at-all", "yk_live_wrong-wrong-wrong");
    expect([...(auth as unknown as { loginSuccesses: Map<string, number[]> }).loginSuccesses.keys()]).toEqual(["reader"]);
  });
});

describe("a name that is no account is checked like a wrong key", () => {
  it("counts the attempt and answers 401, even when the legacy owner's digest file cannot be read", async () => {
    const { app, auth, config } = await running();
    await auth.createPersonalUser(viewer("reader"));
    rmSync(config.personal!.password_hash_ref);
    // The address's limit (20 by default) shortened so that the flood is quick; the point is what the answers are.
    auth.limiter = new LoginLimiter({ ...loginLimits, address: 5 });
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await signIn(app, `nobody-${i}`, "yk_live_wrong-wrong-wrong")).response.status);
    // Five refused attempts, then the limit; never a 503 that would tell a name that does not exist from one that does.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(new Set(statuses.slice(5))).toEqual(new Set([429]));
    expect(statuses).not.toContain(503);
  });

  it("answers the same 401 body for an unknown name and for a real name with a wrong key", async () => {
    const { app, auth, config } = await running();
    await auth.createPersonalUser(viewer("reader"));
    rmSync(config.personal!.password_hash_ref);
    const unknown = await signIn(app, "nobody", "yk_live_wrong-wrong-wrong");
    const known = await signIn(app, "reader", "yk_live_wrong-wrong-wrong");
    expect([unknown.response.status, known.response.status]).toEqual([401, 401]);
    expect(await unknown.response.json()).toEqual(await known.response.json());
  });

  it("still reports an unreadable digest of the legacy owner itself as a server problem, and does not count it", async () => {
    const { app, config } = await running();
    rmSync(config.personal!.password_hash_ref);
    for (let i = 0; i < 6; i++) expect((await signIn(app, "root", password)).response.status).toBe(503);
    expect(stored(config.config_file!).personal?.username).toBe("root");
  });
});
