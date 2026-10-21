export interface OwnerCall {
  url: string;
  method: string;
  /** Redacted headers; authorization is masked as "<bearer>". */
  headers: Record<string, string>;
  redirect?: RequestRedirect | undefined;
  /** Raw bearer value when present, for delegation-channel assertions. */
  authorization?: string;
}

export type OwnerHandler = (
  url: URL,
  init: RequestInit,
) => Response | Promise<Response>;

/**
 * Recording fake owner transport for contract-level tests. Every call is
 * captured (url, method, redacted headers, redirect policy, raw bearer) so
 * tests can assert boundaries without a live owner.
 */
export function ownerFetch(handler: OwnerHandler) {
  const calls: OwnerCall[] = [];
  const fetcher = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    const rawHeaders = new Headers(init.headers as HeadersInit | undefined);
    let authorization = rawHeaders.get("authorization") ?? undefined;
    rawHeaders.forEach((value, key) => {
      headers[key] = key === "authorization" ? "<bearer>" : value;
    });
    if (authorization === null) authorization = undefined;
    calls.push({
      url: url.href,
      method: init.method || "GET",
      headers,
      redirect: init.redirect,
      ...(authorization ? { authorization } : {}),
    });
    return handler(url, init);
  }) as typeof fetch;
  return { fetcher, calls };
}

export const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, { status });
