import { isIP } from "node:net";

/** An IP address in one form (IPv4-mapped IPv6 as IPv4, no zone, lower case), or nothing when it is not an address at all, ports and brackets included. */
export function normalizeAddress(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let address = raw.trim().toLowerCase();
  const zone = address.indexOf("%");
  if (zone > 0) address = address.slice(0, zone);
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4) address = address.slice(7);
  return isIP(address) ? address : undefined;
}

/** 127.0.0.0/8 and ::1: the proxy on this machine. */
export const isLoopback = (address: string) => address === "::1" || (isIP(address) === 4 && address.startsWith("127."));

/**
 * The address a request came from, for the sign-in limits.
 *
 * The control center listens on loopback behind a TLS front on the same machine, so the peer of every real request is the
 * proxy, and the client is the last entry of the `X-Forwarded-For` header that proxy sets. That header is believed only when the
 * peer is loopback: from any other peer it is the client's own claim, and the peer address is used. An absent or malformed
 * header, too, falls back to the peer. (A second local proxy that forwards a header the client supplied lets a client choose
 * its address; the limits per account across addresses and for the whole server bound that.) With no peer at all, as when the
 * handler is called directly, every request counts as coming from `unknown`.
 */
export function clientAddress(peer: string | null | undefined, forwardedFor: string | null | undefined): string {
  const direct = normalizeAddress(peer);
  if (!direct) return "unknown";
  if (!isLoopback(direct)) return direct;
  return normalizeAddress(forwardedFor?.split(",").pop()) ?? direct;
}
