import { addressGroup } from "./client-address";

/**
 * How many sign-ins that were refused (credentials checked and wrong) are allowed in a window, counted so that a stranger who
 * has no account cannot use them up for the people who do.
 *
 * - per account and client address: 5. Guessing at one account from one place stops there, and the same account's real owner,
 *   coming from another address, is not touched;
 * - per client address, every name known or not: 20. One place cannot try many names or many accounts;
 * - per account across every address: 50. A guesser who changes address (a proxy on this machine that passes on a client-supplied
 *   forwarding header makes that cheap) is still bounded for each account;
 * - the whole server: 500. A circuit breaker for a flood from many addresses at once.
 *
 * A sign-in that names no account counts only against its address and the breaker, so it never reaches an account's buckets.
 * Everything is asked before any password work is done, so a refused request costs almost nothing.
 *
 * An address is counted as an IPv4 address or an IPv6 /64 (`addressGroup`), in its canonical form, so writing one address another way,
 * or choosing another address in the same /64, is not a new client. What remains is real: someone with ten addresses (or /64s) of
 * their own can fill one account's 50, and twenty-five can fill the server's 500. The counts live in this process and start from
 * nothing when it restarts.
 */
export const loginLimits = { windowMs: 15 * 60_000, accountAddress: 5, address: 20, account: 50, server: 500 };

export type LoginLimits = typeof loginLimits;
export type LimitBucket = "account_address" | "address" | "account" | "server";

/** How many keys one table keeps; a flood from many addresses cannot grow memory past this. */
const maxKeys = 10_000;

export class LoginLimiter {
  private accountAddress = new Map<string, number[]>();
  private address = new Map<string, number[]>();
  private account = new Map<string, number[]>();
  private server: number[] = [];

  constructor(private limits: LoginLimits = loginLimits, private now: () => number = Date.now) {}

  /** Times within the window of one entry; the entry is trimmed as it is read. */
  private within(table: Map<string, number[]>, key: string, now: number) {
    const times = table.get(key);
    if (!times) return [];
    const recent = times.filter((at) => now - at < this.limits.windowMs);
    if (recent.length) table.set(key, recent);
    else table.delete(key);
    return recent;
  }

  private add(table: Map<string, number[]>, key: string, now: number) {
    const recent = this.within(table, key, now);
    recent.push(now);
    table.delete(key);
    table.set(key, recent);
    // A key is moved to the end of the Map each time it is added to, so the first key is the one touched longest ago: when the
    // table is full that one goes, in constant time, and a flood from many addresses cannot make each request more costly.
    while (table.size > maxKeys) table.delete(table.keys().next().value as string);
    return recent.length;
  }

  /** The buckets that are full for this attempt. Empty means it may go on. `account` is the account the name refers to, or nothing for a name that is no account. */
  full(client: string, account?: string): LimitBucket[] {
    const now = this.now();
    const address = addressGroup(client);
    const full: LimitBucket[] = [];
    if (account !== undefined && this.within(this.accountAddress, account + "\u0000" + address, now).length >= this.limits.accountAddress) full.push("account_address");
    if (this.within(this.address, address, now).length >= this.limits.address) full.push("address");
    if (account !== undefined && this.within(this.account, account, now).length >= this.limits.account) full.push("account");
    this.server = this.server.filter((at) => now - at < this.limits.windowMs);
    if (this.server.length >= this.limits.server) full.push("server");
    return full;
  }

  /** Counts one refused attempt. Returns the buckets this attempt filled, so the caller can note once that they tripped. */
  failed(client: string, account?: string): LimitBucket[] {
    const now = this.now();
    const address = addressGroup(client);
    const tripped: LimitBucket[] = [];
    if (account !== undefined && this.add(this.accountAddress, account + "\u0000" + address, now) === this.limits.accountAddress) tripped.push("account_address");
    if (this.add(this.address, address, now) === this.limits.address) tripped.push("address");
    if (account !== undefined && this.add(this.account, account, now) === this.limits.account) tripped.push("account");
    this.server = this.server.filter((at) => now - at < this.limits.windowMs);
    this.server.push(now);
    if (this.server.length === this.limits.server) tripped.push("server");
    return tripped;
  }
}
