import { describe, expect, it, vi } from "vitest";
import { startSessionHeartbeat, type SessionHeartbeatEnv } from "../src/app/session-heartbeat";

function env() {
  let timer: (() => void) | undefined;
  let wake: (() => void) | undefined;
  let delay = 0;
  let visible = true;
  let online = true;
  const value: SessionHeartbeatEnv = {
    visible: () => visible,
    online: () => online,
    onWake: (callback) => { wake = callback; return () => { wake = undefined; }; },
    every: (callback, ms) => {
      timer = callback;
      delay = ms;
      return () => { if (timer === callback) timer = undefined; };
    },
  };
  return {
    value,
    tick: () => timer?.(),
    wake: () => wake?.(),
    setVisible: (next: boolean) => { visible = next; },
    setOnline: (next: boolean) => { online = next; },
    delay: () => delay,
    hasWake: () => wake !== undefined,
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("session heartbeat", () => {
  it("refreshes an active visible session and never overlaps requests", async () => {
    const e = env();
    let resolve: (() => void) | undefined;
    const refresh = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const stop = startSessionHeartbeat({ refresh, env: e.value, every: 1 });
    e.tick();
    e.tick();
    expect(refresh).toHaveBeenCalledTimes(1);
    resolve?.();
    await settle();
    e.wake();
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    e.tick();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh a hidden or offline tab until it recovers", () => {
    const e = env();
    const refresh = vi.fn(() => Promise.resolve());
    const stop = startSessionHeartbeat({ refresh, env: e.value, every: 1 });
    e.setVisible(false);
    e.tick();
    expect(refresh).not.toHaveBeenCalled();
    e.setVisible(true);
    e.wake();
    expect(refresh).toHaveBeenCalledTimes(1);
    e.setOnline(false);
    e.tick();
    expect(refresh).toHaveBeenCalledTimes(1);
    e.setOnline(true);
    e.wake();
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("recovers after an online wake once the prior refresh settles", async () => {
    const e = env();
    const refresh = vi.fn(() => Promise.resolve());
    const stop = startSessionHeartbeat({ refresh, env: e.value, every: 99 });
    e.tick();
    await settle();
    e.setOnline(false);
    e.tick();
    e.setOnline(true);
    e.wake();
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("retries transient failures with bounded exponential backoff and resets after recovery", async () => {
    const e = env();
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("still offline"));
    const stop = startSessionHeartbeat({ refresh, env: e.value, every: 99 });
    e.tick();
    await settle();
    expect(e.delay()).toBe(1_000);
    e.tick();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(e.delay()).toBe(99);
    for (const expected of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
      e.tick();
      await settle();
      expect(e.delay()).toBe(expected);
    }
    stop();
  });

  it("stops and logs out immediately for 401/login_required", async () => {
    const e = env();
    const refresh = vi.fn(() => Promise.reject({ status: 401, code: "login_required" }));
    const unauthenticated = vi.fn();
    const stop = startSessionHeartbeat({ refresh, env: e.value, onUnauthenticated: unauthenticated });
    expect(e.hasWake()).toBe(true);
    e.tick();
    await settle();
    expect(unauthenticated).toHaveBeenCalledTimes(1);
    e.tick();
    e.wake();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(e.hasWake()).toBe(true);
    stop();
    stop();
    expect(e.hasWake()).toBe(false);
  });

  it("does not adopt a refresh that settles after stop", async () => {
    const e = env();
    let resolve: ((value: { epoch: number }) => void) | undefined;
    const refresh = vi.fn((_signal: AbortSignal) => new Promise<{ epoch: number }>((done) => { resolve = done; }));
    const onRefresh = vi.fn();
    const stop = startSessionHeartbeat({ refresh, env: e.value, onRefresh });
    e.tick();
    stop();
    resolve?.({ epoch: 2 });
    await settle();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not call status or retry callbacks after stop", async () => {
    const e = env();
    let resolve: (() => void) | undefined;
    const refresh = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const onStatus = vi.fn();
    const stop = startSessionHeartbeat({ refresh, env: e.value, onStatus });
    e.tick();
    stop();
    resolve?.();
    await settle();
    expect(onStatus).toHaveBeenCalledWith("refreshing");
    expect(onStatus).not.toHaveBeenCalledWith("idle");
    e.tick();
    e.wake();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
