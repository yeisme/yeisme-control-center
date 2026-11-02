/**
 * Authenticated read-back: after a release is live (or a candidate is running), sign in once as a personal viewer account and
 * check what that account may and may not see. Library only; `verify-live-readback.ts` is the command, `control-release.ts` and
 * `verify-release-component.ts` call it directly.
 *
 * The account is a verifier: its role must be viewer, so a release that lets a viewer read secrets or run admin actions is
 * caught by the one account that is safe to hand to a script. Exactly one login is made per run (the server counts refused
 * logins per client address and per account: 5 per account and address, 20 per address and 50 per account in 15 minutes, so a
 * retry loop with a wrong key would lock this account out from here, and use up the address's allowance for the others), the
 * access key and the session cookie live in memory only, and nothing in the result contains either.
 *
 * Probe file (`YEISME_RELEASE_PROBE_FILE`, mode 0600, a regular file) holds the account's access key in one of two forms:
 *   - the key alone, on the first line; the username then comes from `YEISME_RELEASE_PROBE_USERNAME`;
 *   - JSON `{ "username": "<name>", "key": "<access key>" }` (`access_key` is accepted for `key`, so the output of
 *     `personal-config.ts user add` can be saved as it is).
 * `YEISME_RELEASE_PROBE_USERNAME`, when set, wins over a username in the file.
 * Create the account and its key file with `bun scripts/personal-config.ts user <config> add <name> viewer <label> --key-file <new file>`.
 */
import { readFileSync, statSync } from "node:fs";

export const probeFileEnv = "YEISME_RELEASE_PROBE_FILE";
export const probeUsernameEnv = "YEISME_RELEASE_PROBE_USERNAME";
const prefix = "/api/control-center/v1";

export class ReadbackError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface ProbeCredentials {
  username: string;
  key: string;
}

/** Reads the verifier's credentials from a private file. Errors carry a code, never the file's content. */
export function loadProbeCredentials(file: string, env: Record<string, string | undefined> = process.env): ProbeCredentials {
  let stat;
  try { stat = statSync(file); } catch { throw new ReadbackError("probe_file_missing"); }
  if (!stat.isFile() || stat.mode & 0o077) throw new ReadbackError("probe_file_permissions_invalid");
  let text: string;
  try { text = readFileSync(file, "utf8").trim(); } catch { throw new ReadbackError("probe_file_unreadable"); }
  let username = env[probeUsernameEnv]?.trim() || undefined;
  let key: string;
  if (text.startsWith("{")) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new ReadbackError("probe_file_invalid"); }
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const stored = typeof record.key === "string" ? record.key : typeof record.access_key === "string" ? record.access_key : "";
    key = stored.trim();
    if (!username && typeof record.username === "string") username = record.username.trim();
  } else {
    key = text.split(/\r?\n/)[0].trim();
  }
  if (!username) throw new ReadbackError("probe_username_missing");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(username)) throw new ReadbackError("probe_username_invalid");
  if (key.length < 12 || Buffer.byteLength(key) > 1024 || /\s/.test(key)) throw new ReadbackError("probe_key_invalid");
  return { username, key };
}

export type CheckState = "passed" | "failed" | "absent";
export interface ReadbackCheck {
  name: string;
  state: CheckState;
  /** HTTP status of the answer, when there was one. */
  http_status?: number;
  /** Why it failed, as a short code: never a response body. */
  reason?: string;
}
export interface ReadbackResult {
  status: "passed" | "failed";
  /** The first thing that went wrong: `login_unauthorized`, `login_rate_limited`, `login_server_error`, `check_failed:<name>`, ... */
  failure?: string;
  /** Whether any answer was a 5xx: the release itself, not the probe, is unhealthy. Decides rollback. */
  server_error: boolean;
  /** The probe makes one login attempt per run; 0 means it never got that far. */
  login_attempts: number;
  login_status?: number;
  transport: "https" | "http";
  loopback: boolean;
  checks: ReadbackCheck[];
  observed_at: string;
}

export interface ReadbackOptions {
  /** The control center's own origin, exactly as in its configuration. */
  origin: string;
  credentials: ProbeCredentials;
  /** PEM text of the CA that signed an HTTPS origin's certificate (Bun's `tls.ca`); the system store is used without it. */
  ca?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Per request; default 10 s. */
  timeoutMs?: number;
}

/** Things that must never appear in what a viewer reads: where credentials live on disk, and any home directory. */
const leakPatterns: { name: string; pattern: RegExp }[] = [
  { name: "credential_ref", pattern: /credential_ref/ },
  { name: "hash_ref", pattern: /(?:key|password)_hash_ref/ },
  { name: "home_path", pattern: /\/(?:home\/[A-Za-z0-9_.-]+|Users\/[A-Za-z0-9_.-]+|root)\// },
];

const errorClass = (error: unknown) => {
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/timeout|abort/i.test(text)) return "timeout";
  if (/certificate|self.signed|SSL|TLS|unable to verify/i.test(text)) return "tls";
  return "network";
};

/**
 * What a release does with a read-back. Only a server error (any answer in the 5xx range) says the release itself is unhealthy and
 * takes the rollback path; a refused login (401), a rate-limited one (429), an unreachable probe or any other failed check marks the
 * read-back failed and leaves the release in place for the operator to judge.
 */
export function readbackVerdict(result: ReadbackResult): { authenticated_read: boolean; rollback: boolean; failure?: string } {
  const passed = result.status === "passed";
  return { authenticated_read: passed, rollback: result.server_error, ...(passed ? {} : { failure: result.failure ?? "readback_failed" }) };
}

export async function runLiveReadback(options: ReadbackOptions): Promise<ReadbackResult> {
  const origin = new URL(options.origin).origin;
  const url = new URL(origin);
  const send = options.fetchImpl ?? ((target: string, init?: RequestInit) => fetch(target, init));
  const result: ReadbackResult = {
    status: "failed",
    server_error: false,
    login_attempts: 0,
    transport: url.protocol === "https:" ? "https" : "http",
    loopback: ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    checks: [],
    observed_at: new Date().toISOString(),
  };
  let cookie = "";
  let csrf = "";
  const call = async (method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; text: string; headers: Headers } | { error: string }> => {
    const headers: Record<string, string> = { Origin: origin, Accept: "application/json" };
    if (cookie) headers.Cookie = cookie;
    if (method === "POST") headers["Content-Type"] = "application/json";
    if (method === "POST" && csrf) headers["X-CSRF-Token"] = csrf;
    try {
      const response = await send(origin + prefix + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect would carry the session cookie somewhere else.
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        ...(options.ca ? { tls: { ca: options.ca } } : {}),
      } as RequestInit);
      if (response.status >= 500) result.server_error = true;
      return { status: response.status, text: await response.text(), headers: response.headers };
    } catch (error) {
      return { error: errorClass(error) };
    }
  };
  const record = (name: string, state: CheckState, http_status?: number, reason?: string) => {
    result.checks.push({ name, state, ...(http_status === undefined ? {} : { http_status }), ...(reason ? { reason } : {}) });
    if (state === "failed" && !result.failure) result.failure = `check_failed:${name}`;
  };
  /** One check = one request and an expectation on its status. */
  const expectStatus = async (name: string, method: "GET" | "POST", path: string, allowed: number[], body?: unknown, absentOn?: number[]) => {
    const answer = await call(method, path, body);
    if ("error" in answer) { record(name, "failed", undefined, answer.error); return undefined; }
    if (absentOn?.includes(answer.status)) record(name, "absent", answer.status);
    else if (allowed.includes(answer.status)) record(name, "passed", answer.status);
    else record(name, "failed", answer.status, `unexpected_status`);
    return answer;
  };

  try {
    // The only login of this run. No retry, whatever the answer: a retry would spend another of the 5 attempts per 15 minutes.
    result.login_attempts = 1;
    const login = await call("POST", "/auth/personal", { username: options.credentials.username, key: options.credentials.key });
    if ("error" in login) {
      result.failure = login.error === "network" ? "login_unreachable" : `login_${login.error}`;
      record("login", "failed", undefined, login.error);
      return result;
    }
    result.login_status = login.status;
    const session = login.headers.getSetCookie?.().map((entry) => entry.split(";")[0]).find((pair) => pair.startsWith("yeisme_session="));
    if (login.status !== 200 || !session) {
      result.failure = login.status === 401 ? "login_unauthorized" : login.status === 429 ? "login_rate_limited" : login.status === 403 ? "login_forbidden" : login.status >= 500 ? "login_server_error" : login.status === 200 ? "login_no_session" : "login_failed";
      record("login", "failed", login.status, result.failure);
      return result;
    }
    cookie = session;
    record("login", "passed", login.status);

    const me = await call("GET", "/session");
    let scope = "";
    if ("error" in me) record("session_is_viewer", "failed", undefined, me.error);
    else {
      let body: { role?: unknown; csrf?: unknown; scopes?: { id?: unknown }[] } = {};
      try { body = JSON.parse(me.text); } catch { /* reported below */ }
      csrf = typeof body.csrf === "string" ? body.csrf : "";
      scope = typeof body.scopes?.[0]?.id === "string" ? body.scopes[0].id : "";
      if (me.status !== 200) record("session_is_viewer", "failed", me.status, "unexpected_status");
      else if (body.role !== "viewer") record("session_is_viewer", "failed", me.status, "role_is_not_viewer");
      else if (!csrf || !scope) record("session_is_viewer", "failed", me.status, "session_incomplete");
      else record("session_is_viewer", "passed", me.status);
    }

    if (csrf && scope) {
      const query = `?scope=${encodeURIComponent(scope)}`;
      // Without observe=1, so the control center asks no owner anything while this runs.
      const services = await call("GET", "/services" + query);
      if ("error" in services) record("services_without_secrets", "failed", undefined, services.error);
      else if (services.status !== 200) record("services_without_secrets", "failed", services.status, "unexpected_status");
      else {
        const leaked = leakPatterns.filter(({ pattern }) => pattern.test(services.text)).map(({ name }) => name);
        if (leaked.length) record("services_without_secrets", "failed", services.status, `leaks:${leaked.join("+")}`);
        else record("services_without_secrets", "passed", services.status);
      }
      await expectStatus("notifications_readable", "GET", "/notifications" + query, [200]);
      // The route may not exist in the release under test: 404 is "absent", not a failure.
      // A release without the route answers 405 (unknown API paths end in methodNotAllowed) or 404: absent, not failed.
      await expectStatus("observation_status", "GET", "/observation/status" + query, [200], undefined, [404, 405]);
      await expectStatus("admin_users_refused", "GET", "/admin/personal-users", [403]);
      await expectStatus("audit_refused", "GET", "/audit", [403]);
      // A preview only: even a server that wrongly allowed it would change nothing before a confirm, and this names no real account.
      await expectStatus("admin_action_refused", "POST", "/actions/preview" + query, [403], {
        scope_id: scope,
        owner: "control-center",
        target_kind: "personal_user",
        target_ref: "user:readback-probe-absent",
        action: "admin.user.revoke",
        expected_revision: "0",
        idempotency_key: "readback_probe_" + crypto.randomUUID().replace(/-/g, ""),
        input: { username: "readback-probe-absent" },
      });
    }

    // Leave nothing behind: close the session, then see that it is closed. Without a CSRF token (the session read failed) it
    // cannot be closed here and ends at the server's idle limit.
    if (csrf) {
      const out = await expectStatus("logout", "POST", "/auth/logout", [200], {});
      if (out && out.status === 200) await expectStatus("session_closed", "GET", "/session", [401]);
    } else {
      record("logout", "failed", undefined, "no_csrf_token");
    }
  } catch {
    record("readback", "failed", undefined, "unexpected_error");
  } finally {
    result.observed_at = new Date().toISOString();
    result.status = result.checks.length && result.checks.every((check) => check.state !== "failed") && !result.failure ? "passed" : "failed";
    if (result.status === "failed" && !result.failure) result.failure = "readback_failed";
  }
  return result;
}
