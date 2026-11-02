import { errorClassOf, errorCode } from "../shared/api/control-center-client";
import { staleSessionCode } from "../shared/api/session-signals";

export type SignOutResult = { ok: true } | { ok: false; code: string; stale: boolean };

/**
 * Ends the session on the server. The session cookie is HttpOnly, so the page cannot end it by itself: a request that
 * failed leaves the session valid, and the page must not pretend otherwise. A session that is already gone counts as ended.
 * `stale` means the page's session is not the cookie's any more; the workspace reads the session again for that.
 */
export async function signOut(request: () => Promise<unknown>): Promise<SignOutResult> {
  try {
    await request();
    return { ok: true };
  } catch (error) {
    if (errorClassOf(error) === "login_required") return { ok: true };
    const code = errorCode(error);
    return { ok: false, code, stale: code === staleSessionCode };
  }
}

/** After one reload for a refused CSRF token, the next one waits at least this long. */
export const staleReloadGapMs = 10_000;

/**
 * What to do when a request comes back `csrf_denied`.
 * - `ignore`: the page already holds a newer token than the failing request sent (a late answer to something sent before
 *   the last reload), or it reloaded for this very reason a moment ago. Reading the session again would only repeat that.
 * - `reload`: read `/session` once and compare its token with the one that was refused (`staleSessionVerdict`).
 */
export function staleSignalPlan(input: { sent: string | null; held: string | undefined; now: number; lastReloadAt: number | undefined; gapMs?: number }): "ignore" | "reload" {
  if (input.sent !== null && input.held !== undefined && input.sent !== input.held) return "ignore";
  if (input.lastReloadAt !== undefined && input.now - input.lastReloadAt < (input.gapMs ?? staleReloadGapMs)) return "ignore";
  return "reload";
}

/**
 * Compares the session read after a refusal with the token that was refused.
 * - `replaced`: the server hands out a different token now. The cookie belongs to another session (another tab signed in
 *   as someone else), so the page takes the new one and starts over.
 * - `refused`: the server still hands out the token it just refused. Nothing the page can reload will change that, and
 *   starting over would only send the same request into the same refusal (a proxy that strips the `Origin` header does this
 *   to every write), so the page stops and says the server refuses its requests.
 */
export function staleSessionVerdict(sent: string | null, reloaded: string): "replaced" | "refused" {
  return sent === null || sent !== reloaded ? "replaced" : "refused";
}
