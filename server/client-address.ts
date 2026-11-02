import { isIP } from "node:net";

/** The eight 16-bit groups of an IPv6 address that `isIP` has accepted (zone already removed, lower case), or nothing. */
function groupsOf(address: string): number[] | undefined {
  let text = address;
  // An IPv4 tail (`::ffff:192.0.2.1`) is two more groups.
  const dot = text.lastIndexOf(".");
  if (dot !== -1) {
    const colon = text.lastIndexOf(":");
    const tail = text.slice(colon + 1).split(".").map(Number);
    if (tail.length !== 4 || tail.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
    text = `${text.slice(0, colon + 1)}${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`;
  }
  const [head, rest, ...more] = text.split("::");
  if (more.length) return undefined;
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const gap = 8 - left.length - right.length;
  if (rest === undefined ? gap !== 0 : gap < 1) return undefined;
  const groups = [...left, ...Array<string>(rest === undefined ? 0 : gap).fill("0"), ...right].map((part) => parseInt(part, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : undefined;
}

/** RFC 5952: lower case, no leading zeros, the longest run of two or more zero groups (the first, on a tie) written `::`. */
function compressed(groups: number[]): string {
  let start = -1;
  let length = 0;
  for (let at = 0; at < 8;) {
    if (groups[at] !== 0) { at += 1; continue; }
    let end = at;
    while (end < 8 && groups[end] === 0) end += 1;
    if (end - at > length) { start = at; length = end - at; }
    at = end;
  }
  const hex = groups.map((group) => group.toString(16));
  return length < 2 ? hex.join(":") : `${hex.slice(0, start).join(":")}::${hex.slice(start + length).join(":")}`;
}

/**
 * An IP address in one canonical form, or nothing when it is not an address at all (a port, brackets or a name make it not one).
 * One address is written many ways (`2001:db8:0:0::1`, `2001:DB8::1`, and `::ffff:7f00:1` for 127.0.0.1), and a limit or a
 * loopback test that compared the text would take each for another client. So IPv6 is written compressed and in lower case,
 * IPv4-mapped IPv6 is the IPv4 address it carries, and a zone (`%eth0`) is dropped.
 */
export function normalizeAddress(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let address = raw.trim().toLowerCase();
  if (address.includes(":")) {
    const zone = address.indexOf("%");
    if (zone > 0) address = address.slice(0, zone);
  }
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return undefined;
  const groups = groupsOf(address);
  if (!groups) return undefined;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  return compressed(groups);
}

/** 127.0.0.0/8 and ::1, in any way of writing them: the proxy on this machine. */
export function isLoopback(raw: string | null | undefined): boolean {
  const address = normalizeAddress(raw);
  return address !== undefined && (address === "::1" || (isIP(address) === 4 && address.startsWith("127.")));
}

/**
 * What the sign-in limits count a client by: an IPv4 address as it is, an IPv6 address by its /64. Whoever holds IPv6 is given
 * a /64 at least and can choose any address in it, one request after another, so counting single IPv6 addresses would make
 * one machine as many clients as it likes. `unknown` and anything that is not an address are returned as they are.
 */
export function addressGroup(address: string): string {
  const normal = normalizeAddress(address);
  if (normal === undefined) return address;
  if (isIP(normal) !== 6) return normal;
  const groups = groupsOf(normal);
  return groups ? `${compressed([...groups.slice(0, 4), 0, 0, 0, 0])}/64` : address;
}

/**
 * The address a request came from, for the sign-in limits, in canonical form.
 *
 * The control center listens on loopback behind a TLS front on the same machine, so the peer of every real request is the
 * proxy, and the client is the last entry of the `X-Forwarded-For` header that proxy sets. That header is believed only when the
 * peer is loopback: from any other peer it is the client's own claim, and the peer address is used. An absent or malformed
 * header, too, falls back to the peer. (Every proxy on this machine must therefore say who is on its own connection and
 * not pass on what the client wrote: the dev server's proxy in `vite.config.ts` does. Behind one that passes the header on, a
 * client could choose its address; the limits per account across addresses and for the whole server bound that.) With no peer at
 * all, as when the handler is called directly, every request counts as coming from `unknown`.
 */
export function clientAddress(peer: string | null | undefined, forwardedFor: string | null | undefined): string {
  const direct = normalizeAddress(peer);
  if (!direct) return "unknown";
  if (!isLoopback(direct)) return direct;
  return normalizeAddress(forwardedFor?.split(",").pop()) ?? direct;
}
