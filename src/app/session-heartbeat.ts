export const sessionHeartbeatEveryMs = 5 * 60_000;
export const sessionHeartbeatRetryBaseMs = 1_000;
export const sessionHeartbeatRetryMaxMs = 30_000;

export type SessionHeartbeatStatus = "idle" | "refreshing" | "retrying";

export interface SessionHeartbeatEnv {
  visible(): boolean;
  /** Older test environments may omit this; browsers without the signal are treated as online. */
  online?(): boolean;
  onWake(callback: () => void): () => void;
  every(callback: () => void, ms: number): () => void;
}

function isOnline(env: SessionHeartbeatEnv) {
  return env.online?.() !== false;
}

function isUnauthenticated(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; code?: unknown; errorClass?: unknown };
  return value.status === 401 || value.code === "login_required" || value.errorClass === "login_required";
}

/**
 * Keeps an authenticated browser session active without persisting credentials.
 * The callback is deliberately supplied by WorkspaceProvider so a heartbeat
 * only refreshes the current HttpOnly-cookie session and never changes scope.
 */
export function startSessionHeartbeat<T>(options: {
  refresh: (signal: AbortSignal) => Promise<T>;
  env: SessionHeartbeatEnv;
  every?: number;
  whileHidden?: boolean;
  onRefresh?: (value: T) => void;
  onUnauthenticated?: (error: unknown) => void;
  onStatus?: (status: SessionHeartbeatStatus) => void;
}): () => void {
  const interval = options.every ?? sessionHeartbeatEveryMs;
  const controller = new AbortController();
  let stopped = false;
  let cleanedUp = false;
  let inFlight = false;
  let failures = 0;
  let cancel = () => {};
  let stopWake = () => {};
  const status = (value: SessionHeartbeatStatus) => {
    if (!stopped) options.onStatus?.(value);
  };
  const schedule = (ms: number) => {
    cancel();
    if (!stopped) cancel = options.env.every(beat, ms);
  };
  const beat = () => {
    if (stopped || inFlight || (!options.env.visible() && !options.whileHidden) || !isOnline(options.env)) return;
    inFlight = true;
    status("refreshing");
    void options.refresh(controller.signal).then((value) => {
      if (stopped) return;
      failures = 0;
      options.onRefresh?.(value);
      status("idle");
      schedule(interval);
    }).catch((error: unknown) => {
      if (stopped) return;
      inFlight = false;
      if (isUnauthenticated(error)) {
        stopped = true;
        cancel();
        options.onUnauthenticated?.(error);
        return;
      }
      failures += 1;
      const delay = Math.min(sessionHeartbeatRetryMaxMs, sessionHeartbeatRetryBaseMs * 2 ** (failures - 1));
      status("retrying");
      schedule(delay);
    }).finally(() => {
      if (!stopped) inFlight = false;
    });
  };
  schedule(interval);
  stopWake = options.env.onWake(() => beat());
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    stopped = true;
    cancel();
    controller.abort();
    stopWake();
  };
}

export function browserSessionHeartbeatEnv(doc: Document = document, win: Window = window): SessionHeartbeatEnv {
  return {
    visible: () => doc.visibilityState === "visible",
    online: () => win.navigator.onLine !== false,
    onWake: (callback) => {
      const wake = () => {
        if (doc.visibilityState === "visible" && win.navigator.onLine !== false) callback();
      };
      doc.addEventListener("visibilitychange", wake);
      win.addEventListener("focus", wake);
      win.addEventListener("online", wake);
      return () => {
        doc.removeEventListener("visibilitychange", wake);
        win.removeEventListener("focus", wake);
        win.removeEventListener("online", wake);
      };
    },
    every: (callback, ms) => {
      const handle = win.setInterval(callback, ms);
      return () => win.clearInterval(handle);
    },
  };
}
