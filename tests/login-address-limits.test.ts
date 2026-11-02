import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as passwordModule from "../server/password";
import { addressGroup, clientAddress, isLoopback, normalizeAddress } from "../server/client-address";
import { LoginLimiter, loginLimits } from "../server/login-limits";
import { call, cheapWrong as wrong, password, refuseCheaply, running, signIn, viewer } from "./personal-server.support";

// Only addresses reserved for documentation (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32) and loopback appear here.
beforeEach(() => { refuseCheaply(); });
afterEach(() => vi.restoreAllMocks());
const from = (peer: string, forwardedFor?: string) => ({ peer, forwardedFor });
const proxy = (client: string) => from("127.0.0.1", client);
/** `count` different IPv4 documentation addresses. */
const addresses = (count: number) => Array.from({ length: count }, (_, i) => `${["192.0.2", "198.51.100", "203.0.113"][i % 3]}.${1 + Math.floor(i / 3)}`);
/** The `i`th address of a different IPv6 documentation /64 each, for floods that need more addresses than the IPv4 ranges hold. */
const network = (i: number) => `2001:db8:${i.toString(16)}::1`;

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

  it("writes an address one way whatever way it was written: IPv6 compressed and in lower case, IPv4-mapped IPv6 as IPv4, no zone", () => {
    const same: [string, string][] = [
      ["2001:db8:0:0::1", "2001:db8::1"], ["2001:DB8::1", "2001:db8::1"], ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
      ["::ffff:7f00:1", "127.0.0.1"], ["::ffff:127.0.0.1", "127.0.0.1"], ["::FFFF:C633:6407", "198.51.100.7"], ["::ffff:198.51.100.7", "198.51.100.7"],
      ["0:0:0:0:0:0:0:1", "::1"], ["::0001", "::1"], ["0:0:0:0:0:0:0:0", "::"], ["::", "::"], ["2001:db8::", "2001:db8::"], ["fe80::1%eth0", "fe80::1"],
      // The longest run of zero groups is the one compressed (the first, when two are as long), and a lone zero group is not.
      ["1:0:0:2:0:0:0:3", "1:0:0:2::3"], ["1:0:0:0:2:0:0:0", "1::2:0:0:0"], ["2001:db8:0:1:1:1:1:1", "2001:db8:0:1:1:1:1:1"], ["1:2:3:4:5:6:7::", "1:2:3:4:5:6:7:0"],
      ["64:ff9b::198.51.100.7", "64:ff9b::c633:6407"], ["198.51.100.7", "198.51.100.7"], [" 203.0.113.9 ", "203.0.113.9"],
    ];
    for (const [written, canonical] of same) expect(normalizeAddress(written), written).toBe(canonical);
    for (const bad of ["", ":::", "2001:db8:::1", "1:2:3:4:5:6:7:8:9", "g::1", "12345::1", "1::2::3", "198.51.100.7%eth0", "%eth0", "[::1]", "198.51.100", "01.2.3.4", "localhost"]) expect(normalizeAddress(bad), bad).toBeUndefined();
  });

  it("knows the proxy on this machine whatever way its address is written", () => {
    for (const loopback of ["127.0.0.1", "127.9.8.7", "::1", "0:0:0:0:0:0:0:1", "::0001", "::ffff:127.0.0.1", "::ffff:7f00:1", "::FFFF:7F00:0001"]) expect(isLoopback(loopback), loopback).toBe(true);
    for (const other of ["::2", "::ffff:c000:201", "192.0.2.1", "2001:db8::1", "128.0.0.1", "unknown", "", "::ffff:7e00:1"]) expect(isLoopback(other), other).toBe(false);
    // So the header is believed from it in any of those forms, and the client comes out in the one canonical form.
    expect(clientAddress("::ffff:7f00:1", "203.0.113.5")).toBe("203.0.113.5");
    expect(clientAddress("0:0:0:0:0:0:0:1", "2001:DB8:0:0::5")).toBe("2001:db8::5");
    expect(clientAddress("::1", "::FFFF:C633:6407")).toBe("198.51.100.7");
    // And it is not believed from anyone else, in any form.
    expect(clientAddress("2001:db8:0:0::9", "198.51.100.7")).toBe("2001:db8::9");
    expect(clientAddress("::ffff:c000:209", "198.51.100.7")).toBe("192.0.2.9");
  });

  it("counts an IPv4 address as it is and an IPv6 address by its /64", () => {
    expect(addressGroup("192.0.2.5")).toBe("192.0.2.5");
    expect(addressGroup("unknown")).toBe("unknown");
    expect(addressGroup("2001:db8:0:1:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:0:1::/64");
    expect(addressGroup("2001:db8::1")).toBe("2001:db8::/64");
    // One /64 is one client, whichever address in it and whichever way it is written; the next /64 is another.
    const one = ["2001:db8:0:1::1", "2001:db8:0:1:ffff:eeee:dddd:cccc", "2001:DB8:0:1:0:0:0:7", "2001:db8:0:1::", "2001:db8:0:0001:1:2:3:4"].map(addressGroup);
    expect(new Set(one).size).toBe(1);
    expect(addressGroup("2001:db8:0:2::1")).not.toBe(one[0]);
    expect(addressGroup("2001:db9:0:1::1")).not.toBe(one[0]);
    // An IPv4-mapped address is the IPv4 client it carries.
    expect(addressGroup("::ffff:192.0.2.5")).toBe("192.0.2.5");
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
    for (let i = 0; i < 49; i++) limiter.failed(network(i), "reader");
    expect(limiter.full("192.0.2.91", "reader")).toEqual([]);
    expect(limiter.failed("192.0.2.99", "reader")).toEqual(["account"]);
    expect(limiter.full("192.0.2.77", "reader")).toEqual(["account"]);
    expect(limiter.full("192.0.2.77", "other")).toEqual([]);
    const flood = clock().limiter;
    for (let i = 0; i < 499; i++) flood.failed(network(i));
    expect(flood.full("192.0.2.22", "anyone")).toEqual([]);
    expect(flood.failed("192.0.2.23")).toEqual(["server"]);
    expect(flood.full("192.0.2.44")).toEqual(["server"]);
  });

  it("counts every address of one IPv6 /64 as one client, however each is written, and the next /64 as another", () => {
    const { limiter } = clock();
    const inOne = ["2001:db8:0:1::1", "2001:db8:0:1:ffff:eeee:dddd:cccc", "2001:DB8:0:1:0:0:0:7", "2001:db8:0:1::", "2001:db8:0:0001:aaaa::5"];
    const trips = inOne.map((client) => limiter.failed(client, "reader").join());
    expect(trips).toEqual(["", "", "", "", "account_address"]);
    expect(limiter.full("2001:db8:0:1:1234:5678:9abc:def0", "reader")).toEqual(["account_address"]);
    expect(limiter.full("2001:db8:0:1::", "other")).toEqual([]);
    expect(limiter.full("2001:db8:0:2::1", "reader")).toEqual([]);
    // The address bucket is the /64's too: twenty different addresses in one, whatever the names, fill it.
    const flood = clock().limiter;
    for (let i = 0; i < 19; i++) expect(flood.failed(`2001:db8:0:7:${i.toString(16)}::1`)).toEqual([]);
    expect(flood.failed("2001:db8:0:7:ffff:ffff:ffff:ffff")).toEqual(["address"]);
    expect(flood.full("2001:db8:0:7::abcd", "reader")).toEqual(["address"]);
    expect(flood.full("2001:db8:0:8::1", "reader")).toEqual([]);
    // IPv4 clients are counted one by one, and an IPv4-mapped IPv6 address is the IPv4 client.
    const v4 = clock().limiter;
    for (let i = 0; i < 4; i++) v4.failed("192.0.2.5", "reader");
    expect(v4.failed("::ffff:192.0.2.5", "reader")).toEqual(["account_address"]);
    expect(v4.full("192.0.2.6", "reader")).toEqual([]);
  });

  it("keeps its tables bounded however many addresses a flood comes from", () => {
    const { limiter } = clock();
    for (let i = 0; i < 12_000; i++) limiter.failed(network(i), `name-${i}`);
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

  it("counts the addresses of one IPv6 /64 as one client, however a proxy writes them", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    const inOne = ["2001:db8:0:1::1", "2001:db8:0:1:ffff:eeee:dddd:cccc", "2001:DB8:0:1:0:0:0:7", "2001:db8:0:1::", "2001:db8:0:0001:aaaa::5"];
    for (const client of inOne) expect((await signIn(app, "reader", wrong, proxy(client))).response.status).toBe(401);
    // A sixth address in the same /64 is the same client, which is locked out of that account; another /64 is not.
    expect((await signIn(app, "reader", reader.access_key, proxy("2001:db8:0:1:9:9:9:9"))).response.status).toBe(429);
    expect((await signIn(app, "reader", reader.access_key, proxy("2001:db8:0:2::1"))).response.status).toBe(200);
  });

  it("cannot be fooled by the same address written another way, in the peer or in the header", async () => {
    const { app } = await running();
    // Twenty refusals from one IPv4 client, written four ways, one after another.
    const ways = ["198.51.100.30", "::ffff:198.51.100.30", "::FFFF:C633:641E", " 198.51.100.30 "];
    for (let i = 0; i < loginLimits.address; i++) expect((await signIn(app, `nobody-${i}`, wrong, proxy(ways[i % ways.length]))).response.status).toBe(401);
    expect((await signIn(app, "root", password, proxy("198.51.100.30"))).response.status).toBe(429);
    // The same through the peer, when it is not the proxy: every spelling of one peer is one client.
    for (let i = 0; i < loginLimits.address; i++) expect((await signIn(app, `nobody-${i}`, wrong, from(["2001:db8:0:0::9", "2001:DB8::9", "2001:db8::9"][i % 3]))).response.status).toBe(401);
    expect((await signIn(app, "root", password, from("2001:db8::9"))).response.status).toBe(429);
    expect((await signIn(app, "root", password, from("2001:db8::a"))).response.status).toBe(429);
    expect((await signIn(app, "root", password, from("2001:db8:0:1::a"))).response.status).toBe(200);
  });

  it("bounds what many addresses can do: ten of them can fill one account's 50 refusals, twenty-five the server's 500, and no fewer", async () => {
    const { app, auth } = await running();
    const reader = await auth.createPersonalUser(viewer("reader"));
    const ten = addresses(10);
    // Five refusals from each of nine addresses are not enough to shut the account out; the tenth address's fifth is.
    for (const client of ten.slice(0, 9)) for (let i = 0; i < loginLimits.accountAddress; i++) expect((await signIn(app, "reader", wrong, proxy(client))).response.status).toBe(401);
    expect((await signIn(app, "reader", reader.access_key, proxy("198.51.100.200"))).response.status).toBe(200);
    for (let i = 0; i < loginLimits.accountAddress - 1; i++) expect((await signIn(app, "reader", wrong, proxy(ten[9]))).response.status).toBe(401);
    expect((await signIn(app, "reader", wrong, proxy(ten[9]))).response.status).toBe(401);
    // That was the fiftieth refusal for the account: from any address, a sign-in of it is now refused up front, and nobody else is.
    const shut = await signIn(app, "reader", reader.access_key, proxy("198.51.100.201"));
    expect([shut.response.status, (await shut.response.json()).error]).toEqual([429, "login_rate_limited"]);
    expect((await signIn(app, "root", password, proxy("198.51.100.202"))).response.status).toBe(200);
    // The breaker: twenty-five addresses with twenty refusals each, whatever the names.
    const flood = (await running()).app;
    const many = addresses(25);
    for (const client of many.slice(0, 24)) for (let i = 0; i < loginLimits.address; i++) expect((await signIn(flood, `nobody-${i}`, wrong, proxy(client))).response.status).toBe(401);
    expect((await signIn(flood, "root", password, proxy("198.51.100.203"))).response.status).toBe(200);
    for (let i = 0; i < loginLimits.address; i++) expect((await signIn(flood, `nobody-${i}`, wrong, proxy(many[24]))).response.status, `refusal ${i + 1}`).toBe(401);
    const breaker = await signIn(flood, "root", password, proxy("198.51.100.204"));
    expect(breaker.response.status).toBe(429);
    expect((await breaker.response.json()).error).toBe("login_rate_limited");
  }, 60_000);

  it("believes the forwarding header only from the proxy on this machine", async () => {
    const { app } = await running();
    // A peer that is not loopback sends a different header every time; it is one address all the same.
    for (let i = 0; i < loginLimits.address; i++) expect((await signIn(app, `nobody-${i}`, wrong, from("203.0.113.9", `198.51.100.${i}`))).response.status).toBe(401);
    expect((await signIn(app, "nobody-more", wrong, from("203.0.113.9", "198.51.100.200"))).response.status).toBe(429);
    // Another peer is not affected, and neither is a client behind the local proxy, however the proxy's own address is written.
    expect((await signIn(app, "root", password, from("203.0.113.10", "203.0.113.9"))).response.status).toBe(200);
    expect((await signIn(app, "root", password, proxy("198.51.100.77"))).response.status).toBe(200);
    expect((await signIn(app, "root", password, from("::ffff:7f00:1", "198.51.100.78"))).response.status).toBe(200);
    expect((await signIn(app, "root", password, from("0:0:0:0:0:0:0:1", "198.51.100.79"))).response.status).toBe(200);
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

describe("a request that is not a guess at a credential is not counted", () => {
  /** What a refused sign-in leaves in the limits of one address: how many more refusals it takes to fill them. */
  const asRefusal = (app: Awaited<ReturnType<typeof running>>["app"], client: string) => signIn(app, "nobody", wrong, proxy(client));

  it("answers a secret over 1024 bytes 400 invalid_login_request, before any password work or counting, so no flood of them fills a limit", async () => {
    const { app } = await running();
    const check = vi.spyOn(passwordModule, "checkPassword");
    for (let i = 0; i < 4 * loginLimits.address; i++) {
      const attempt = await signIn(app, i % 2 ? "root" : `nobody-${i}`, "x".repeat(1025 + i), proxy("198.51.100.40"));
      expect([attempt.response.status, (await attempt.response.json()).error], `request ${i + 1}`).toEqual([400, "invalid_login_request"]);
    }
    expect(check).not.toHaveBeenCalled();
    // Nothing was counted: the same address signs in with the right key, and its allowance of refusals is whole.
    expect((await signIn(app, "root", password, proxy("198.51.100.40"))).response.status).toBe(200);
    for (let i = 0; i < loginLimits.address - 1; i++) expect((await asRefusal(app, "198.51.100.40")).response.status).toBe(401);
  });

  it("measures the secret in bytes: 1024 is a guess, 1025 is not, whatever the characters", async () => {
    const { app } = await running();
    // At the limit, a real check of a wrong secret: refused, and counted.
    expect((await signIn(app, "root", "y".repeat(1024), proxy("198.51.100.41"))).response.status).toBe(401);
    expect((await signIn(app, "root", "y".repeat(1025), proxy("198.51.100.41"))).response.status).toBe(400);
    // 341 three-byte characters are 1023 bytes, 342 are 1026, though both are far under 1024 characters.
    expect((await signIn(app, "root", "密".repeat(341), proxy("198.51.100.41"))).response.status).toBe(401);
    expect((await signIn(app, "root", "密".repeat(342), proxy("198.51.100.41"))).response.status).toBe(400);
    expect(passwordModule.maxSecretBytes).toBe(1024);
  });

  it("holds the username to 80 characters in the same way, and the whole request to 2048", async () => {
    const { app } = await running();
    const long = await signIn(app, "n".repeat(81), wrong, proxy("198.51.100.42"));
    expect([long.response.status, (await long.response.json()).error]).toEqual([400, "invalid_login_request"]);
    const limit = await signIn(app, "n".repeat(80), wrong, proxy("198.51.100.42"));
    expect(limit.response.status).toBe(401);
    const big = await call(app, "/auth/personal", { method: "POST", body: { username: "root", key: "k".repeat(2100) }, ...proxy("198.51.100.42") });
    expect([big.status, (await big.json()).error]).toEqual([400, "invalid_login_request"]);
    // Of those, only the one that was a guess was counted: nineteen more refusals fit before the address is full, and the next is refused up front.
    for (let i = 0; i < loginLimits.address - 2; i++) expect((await asRefusal(app, "198.51.100.42")).response.status).toBe(401);
    expect((await asRefusal(app, "198.51.100.42")).response.status).toBe(401);
    expect((await asRefusal(app, "198.51.100.42")).response.status).toBe(429);
  });
});
