import { afterEach, describe, expect, it, vi } from "vitest";
import * as passwordModule from "../server/password";
import { clientAddress, normalizeAddress } from "../server/client-address";
import { LoginLimiter, loginLimits } from "../server/login-limits";
import { call, password, running, signIn, viewer } from "./personal-server.support";

afterEach(() => vi.restoreAllMocks());
/** A key too long to be one: the server refuses it without the scrypt work, so a flood of refused sign-ins in a test costs nothing. */
const wrong = "x".repeat(1100);
const from = (peer: string, forwardedFor?: string) => ({ peer, forwardedFor });
const proxy = (client: string) => from("127.0.0.1", client);

describe("the address a sign-in is counted against", () => {
  it("is the last entry of the forwarding header when the connection is from the proxy on this machine", () => {
    expect(clientAddress("127.0.0.1", "198.51.100.7")).toBe("198.51.100.7");
    expect(clientAddress("::1", "198.51.100.7")).toBe("198.51.100.7");
    expect(clientAddress("::ffff:127.0.0.1", "203.0.113.5, 198.51.100.7")).toBe("198.51.100.7");
    expect(clientAddress("127.0.0.1", " 2001:db8::1 ")).toBe("2001:db8::1");
  });

  it("never believes the header from any other peer, whatever it says", () => {
    expect(clientAddress("203.0.113.9", "198.51.100.7")).toBe("203.0.113.9");
    expect(clientAddress("::ffff:203.0.113.9", "198.51.100.7")).toBe("203.0.113.9");
    expect(clientAddress("192.0.2.120", "127.0.0.1")).toBe("192.0.2.120");
    expect(clientAddress("2001:db8::9", "198.51.100.7")).toBe("2001:db8::9");
  });

  it("falls back to the peer when the header is absent or malformed, and to `unknown` with no peer at all", () => {
    for (const bad of [undefined, null, "", "not-an-address", "198.51.100.7:4433", "[2001:db8::1]:80", "198.51.100.7, ", "1.2.3", "999.1.1.1"]) expect(clientAddress("127.0.0.1", bad as string), String(bad)).toBe("127.0.0.1");
    expect(clientAddress(undefined, "198.51.100.7")).toBe("unknown");
    expect(clientAddress("", "198.51.100.7")).toBe("unknown");
    expect(normalizeAddress("FE80::1%eth0")).toBe("fe80::1");
  });
});

describe("the limits on refused sign-ins", () => {
  const clock = () => { const time = { now: 1_000_000 }; return { time, limiter: new LoginLimiter(loginLimits, () => time.now) }; };

  it("counts a known account by account and address, by address, by account and for the server; a name that is no account only by address and for the server", () => {
    const { limiter } = clock();
    for (let i = 0; i < 4; i++) expect(limiter.failed("a", "reader")).toEqual([]);
    expect(limiter.full("a", "reader")).toEqual([]);
    expect(limiter.failed("a", "reader")).toEqual(["account_address"]);
    expect(limiter.full("a", "reader")).toEqual(["account_address"]);
    // Other addresses, other accounts and names that are no account are untouched by that.
    expect(limiter.full("b", "reader")).toEqual([]);
    expect(limiter.full("a", "other")).toEqual([]);
    expect(limiter.full("a")).toEqual([]);
    // Unknown names never reach an account: twenty of them fill the address and nothing else.
    const fresh = clock().limiter;
    for (let i = 0; i < 19; i++) fresh.failed("c");
    expect(fresh.failed("c")).toEqual(["address"]);
    expect(fresh.full("c", "reader")).toEqual(["address"]);
    expect(fresh.full("d", "reader")).toEqual([]);
  });

  it("says a bucket tripped once, when it fills, and lets the window go by", () => {
    const { limiter, time } = clock();
    const trips: string[][] = [];
    for (let i = 0; i < 7; i++) trips.push(limiter.failed("a", "reader"));
    // Filled by the fifth failure; the sixth and seventh are counted too (the caller would not have let them through).
    expect(trips.map((t) => t.join())).toEqual(["", "", "", "", "account_address", "", ""]);
    time.now += loginLimits.windowMs - 1;
    expect(limiter.full("a", "reader")).toEqual(["account_address"]);
    time.now += 2;
    expect(limiter.full("a", "reader")).toEqual([]);
  });

  it("limits one account across addresses to 50 and the whole server to 500", () => {
    const { limiter } = clock();
    for (let i = 0; i < 49; i++) limiter.failed(`10.0.0.${i}`, "reader");
    expect(limiter.full("192.0.2.91", "reader")).toEqual([]);
    expect(limiter.failed("192.0.2.99", "reader")).toEqual(["account"]);
    expect(limiter.full("192.0.2.77", "reader")).toEqual(["account"]);
    expect(limiter.full("192.0.2.77", "other")).toEqual([]);
    const flood = clock().limiter;
    for (let i = 0; i < 499; i++) flood.failed(`10.1.${i >> 8}.${i & 255}`);
    expect(flood.full("192.0.2.22", "anyone")).toEqual([]);
    expect(flood.failed("192.0.2.23")).toEqual(["server"]);
    expect(flood.full("192.0.2.44")).toEqual(["server"]);
  });

  it("keeps its tables bounded however many addresses a flood comes from", () => {
    const { limiter } = clock();
    for (let i = 0; i < 12_000; i++) limiter.failed(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, `name-${i}`);
    const tables = limiter as unknown as { accountAddress: Map<string, unknown>; address: Map<string, unknown>; account: Map<string, unknown> };
    for (const table of [tables.accountAddress, tables.address, tables.account]) expect(table.size).toBeLessThanOrEqual(10_000);
  });
});

describe("one stranger cannot lock the others out of signing in", () => {
  it("an unknown-name flood from one address does not stop the administrator, who signs in from another", async () => {
    const { app } = await running();
    for (let i = 0; i < loginLimits.address; i++) expect((await signIn(app, `nobody-${i}`, wrong, proxy("198.51.100.1"))).response.status).toBe(401);
    const refused = await signIn(app, "nobody-more", wrong, proxy("198.51.100.1"));
    expect(refused.response.status).toBe(429);
    expect((await refused.response.json()).error).toBe("login_rate_limited");
    // The administrator's correct key, from anywhere else, is not touched; this is what five unknown names used to do to everyone.
    expect((await signIn(app, "root", password, proxy("203.0.113.40"))).response.status).toBe(200);
    // And from the flooding address itself the administrator is turned away too: the address is the one that is limited.
    expect((await signIn(app, "root", password, proxy("198.51.100.1"))).response.status).toBe(429);
  });

  it("five unknown names from one address are only five refusals", async () => {
    const { app } = await running();
    for (let i = 0; i < 5; i++) expect((await signIn(app, `nobody-${i}`, wrong, proxy("198.51.100.2"))).response.status).toBe(401);
    expect((await signIn(app, "root", password, proxy("198.51.100.3"))).response.status).toBe(200);
    expect((await signIn(app, "root", password, proxy("198.51.100.2"))).response.status).toBe(200);
  });

  it("locks guesses at one account out from one address, and the same account signs in from another address", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    for (let i = 0; i < loginLimits.accountAddress; i++) expect((await signIn(app, "reader", wrong, proxy("198.51.100.4"))).response.status).toBe(401);
    const locked = await signIn(app, "reader", reader.access_key, proxy("198.51.100.4"));
    expect(locked.response.status).toBe(429);
    expect((await signIn(app, "reader", reader.access_key, proxy("198.51.100.5"))).response.status).toBe(200);
    // The same address may still sign in as someone else: only that pair is locked.
    expect((await signIn(app, "root", password, proxy("198.51.100.4"))).response.status).toBe(200);
  });

  it("bounds one account's guesses from many addresses at 50, and the whole server's at 500", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    const at = (i: number) => proxy(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`);
    for (let i = 0; i < loginLimits.account; i++) expect((await signIn(app, "reader", wrong, at(i))).response.status).toBe(401);
    expect((await signIn(app, "reader", reader.access_key, at(900))).response.status).toBe(429);
    // Other accounts are not affected by that.
    expect((await signIn(app, "root", password, at(901))).response.status).toBe(200);
    // Many addresses, many names: the breaker.
    const flood = (await running()).app;
    for (let i = 0; i < loginLimits.server; i++) expect((await signIn(flood, `nobody-${i}`, wrong, at(1000 + i))).response.status, `refusal ${i + 1}`).toBe(401);
    const breaker = await signIn(flood, "root", password, at(5000));
    expect(breaker.response.status).toBe(429);
    expect((await breaker.response.json()).error).toBe("login_rate_limited");
  }, 60_000);

  it("believes the forwarding header only from the proxy on this machine", async () => {
    const { app } = await running();
    // A peer that is not loopback sends a different header every time; it is one address all the same.
    for (let i = 0; i < loginLimits.address; i++) expect((await signIn(app, `nobody-${i}`, wrong, from("203.0.113.9", `198.51.100.${i}`))).response.status).toBe(401);
    expect((await signIn(app, "nobody-more", wrong, from("203.0.113.9", "198.51.100.200"))).response.status).toBe(429);
    // Another peer is not affected, and neither is a client behind the local proxy.
    expect((await signIn(app, "root", password, from("203.0.113.10", "203.0.113.9"))).response.status).toBe(200);
    expect((await signIn(app, "root", password, proxy("198.51.100.77"))).response.status).toBe(200);
  });

  it("asks every limit before the password is checked and before the busy flag is taken", async () => {
    const { app, auth } = await running();
    const check = vi.spyOn(passwordModule, "checkPassword");
    for (let i = 0; i < loginLimits.address; i++) await signIn(app, `nobody-${i}`, wrong, proxy("198.51.100.9"));
    const before = check.mock.calls.length;
    (auth as unknown as { loginBusy: boolean }).loginBusy = true;
    // Refused for the address, not told to wait: the limit was asked first. And no password work was done for it.
    const refused = await signIn(app, "root", password, proxy("198.51.100.9"));
    expect([refused.response.status, (await refused.response.json()).error]).toEqual([429, "login_rate_limited"]);
    // Somewhere else the busy flag is what answers, which shows it was set.
    expect((await (await signIn(app, "root", password, proxy("198.51.100.10"))).response.json()).error).toBe("login_busy");
    (auth as unknown as { loginBusy: boolean }).loginBusy = false;
    expect(check.mock.calls.length).toBe(before);
    for (let i = 0; i < 5; i++) await signIn(app, "root", password, proxy("198.51.100.9"));
    expect(check.mock.calls.length).toBe(before);
  });
});
