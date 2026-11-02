import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ControlCenterApiError } from "../src/shared/api/control-center-client";
import { onStaleSession, signalStaleSession } from "../src/shared/api/session-signals";
import { signOut, staleReloadGapMs, staleSessionVerdict, staleSignalPlan } from "../src/app/session-recovery";

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

describe("a session replaced elsewhere", () => {
  it("is signalled when a request is refused with csrf_denied, and the request still fails with its own error", async () => {
    vi.stubGlobal("fetch", answer(403, { error: "csrf_denied", class: "forbidden" }));
    const heard = vi.fn();
    const stop = onStaleSession(heard);
    await expect(api.logout("a-token-from-another-session")).rejects.toMatchObject({ code: "csrf_denied", status: 403, errorClass: "forbidden" });
    expect(heard).toHaveBeenCalledTimes(1);
    // The listener is told which token was refused, so it can tell a replaced session from a refusal with another cause.
    expect(heard).toHaveBeenCalledWith("a-token-from-another-session");
    stop();
  });

  it("is not signalled for any other refusal", async () => {
    const heard = vi.fn();
    const stop = onStaleSession(heard);
    for (const [status, error, errorClass] of [[403, "control_center_admin_required", "forbidden"], [403, "origin_denied", "forbidden"], [401, "login_required", "login_required"], [503, "source_unavailable", "unavailable"]] as const) {
      vi.stubGlobal("fetch", answer(status, { error, class: errorClass }));
      await expect(api.logout("token")).rejects.toMatchObject({ code: error });
    }
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it("reaches every listener that is still subscribed, and one that throws costs the others nothing", () => {
    const first = vi.fn(() => { throw new Error("broken listener"); });
    const second = vi.fn();
    const stopFirst = onStaleSession(first);
    const stopSecond = onStaleSession(second);
    signalStaleSession();
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
    stopSecond();
    signalStaleSession();
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([2, 1]);
    stopFirst();
  });
});

describe("signing out", () => {
  it("is done when the server ended the session", async () => {
    vi.stubGlobal("fetch", answer(200, { ok: true }));
    expect(await signOut(() => api.logout("token"))).toEqual({ ok: true });
  });

  it("is done when the session was already gone", async () => {
    vi.stubGlobal("fetch", answer(401, { error: "login_required", class: "login_required" }));
    expect(await signOut(() => api.logout("token"))).toEqual({ ok: true });
  });

  it("is not done when the request failed, because the HttpOnly cookie keeps the session valid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await signOut(() => api.logout("token"))).toEqual({ ok: false, code: "control_center_unavailable", stale: false });
    vi.stubGlobal("fetch", answer(503, { error: "source_unavailable", class: "unavailable" }));
    expect(await signOut(() => api.logout("token"))).toEqual({ ok: false, code: "source_unavailable", stale: false });
  });

  it("says a refused token is stale, so the workspace reads the session instead of retrying with it", async () => {
    vi.stubGlobal("fetch", answer(403, { error: "csrf_denied", class: "forbidden" }));
    expect(await signOut(() => api.logout("token"))).toEqual({ ok: false, code: "csrf_denied", stale: true });
    expect(await signOut(async () => { throw new ControlCenterApiError("csrf_denied", 403, "forbidden"); })).toMatchObject({ ok: false, stale: true });
  });
});

describe("what a refused CSRF token leads to", () => {
  const t = 1_000_000;
  it("reads the session again for a token the page still holds, and not twice within ten seconds", () => {
    expect(staleSignalPlan({ sent: "a", held: "a", now: t, lastReloadAt: undefined })).toBe("reload");
    expect(staleSignalPlan({ sent: "a", held: "a", now: t, lastReloadAt: t - 9_999 })).toBe("ignore");
    expect(staleSignalPlan({ sent: "a", held: "a", now: t, lastReloadAt: t - 10_000 })).toBe("reload");
    expect(staleReloadGapMs).toBe(10_000);
    expect(staleSignalPlan({ sent: "a", held: "a", now: t, lastReloadAt: t - 500, gapMs: 100 })).toBe("reload");
  });

  it("ignores a refusal of a token the page has already replaced", () => {
    expect(staleSignalPlan({ sent: "old", held: "new", now: t, lastReloadAt: undefined })).toBe("ignore");
  });

  it("reads the session when it cannot tell which token the failing request carried or which the page holds", () => {
    expect(staleSignalPlan({ sent: null, held: "a", now: t, lastReloadAt: undefined })).toBe("reload");
    expect(staleSignalPlan({ sent: "a", held: undefined, now: t, lastReloadAt: undefined })).toBe("reload");
  });

  it("takes a different token as a replaced session and the same token as a refusal no reload can fix", () => {
    expect(staleSessionVerdict("old", "new")).toBe("replaced");
    expect(staleSessionVerdict(null, "new")).toBe("replaced");
    expect(staleSessionVerdict("same", "same")).toBe("refused");
  });

  it("simulates a proxy that strips Origin: one reload, then the forbidden state, and no further round", () => {
    // Every write is refused whatever the token. The first refusal reads the session; it returns the same token, so the page stops.
    let reloads = 0;
    let state: "ready" | "forbidden" = "ready";
    const held = "token-1";
    const onRefused = (sent: string, now: number, lastReloadAt?: number) => {
      if (staleSignalPlan({ sent, held, now, lastReloadAt }) === "ignore") return lastReloadAt;
      reloads += 1;
      if (staleSessionVerdict(sent, "token-1") === "refused") state = "forbidden";
      return now;
    };
    const first = onRefused("token-1", 0);
    // The notification sync, another write, fails the same way a moment later: still no new reload.
    const second = onRefused("token-1", 2_000, first);
    onRefused("token-1", 9_000, second);
    expect([reloads, state]).toEqual([1, "forbidden"]);
  });
});
