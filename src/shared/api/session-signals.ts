/**
 * The server answers `csrf_denied` when the page's CSRF token is not the one of the session behind its cookie. That is what
 * a tab sees after another tab signed out and in as someone else (cookies are shared, the page's copy of the session is
 * not), or after the session ended on the server. The page is then showing a session that no longer exists, and whoever
 * owns the session should read it again instead of reporting "forbidden". The API client raises the signal; the workspace
 * listens.
 */
export const staleSessionCode = "csrf_denied";

/** Gets the CSRF token the refused request carried (`null` if it carried none), so the listener can tell a replaced session from a refusal that has another cause. */
type Listener = (sentToken: string | null) => void;
const listeners = new Set<Listener>();

/** Calls `listener` whenever the server refuses a request's CSRF token; returns what stops listening. */
export function onStaleSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Told by the API client; a listener that throws never keeps the others, or the failed request's own error, from being delivered. */
export function signalStaleSession(sentToken: string | null = null) {
  for (const listener of [...listeners]) {
    try { listener(sentToken); } catch { /* the request still fails with its own error */ }
  }
}
