import { randomBytes, createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ServerConfig, Session, PrincipalBinding, PersonalUser } from "./contracts";
import type { ControlCenterRole } from "../src/service-directory";
import { credentialFileProblem, type CredentialFileReason } from "./credential-file";
import { checkPassword, credentialVersion, hashPassword } from "./password";
import { ConfigBusyError, fileIdentity, withConfigLock, type LockOptions } from "./config-lock";
import { duplicateNames, enabledUsers, findEnabledUser, isEnabledFlag } from "./personal-users";
import { SessionStore } from "./db/session-store";
import { createMemoryDB } from "./db/client";
const nonce = () => randomBytes(32).toString("base64url");
/** An account entry the server can use. One edited by hand into something else is skipped, not trusted; a role other than admin is a viewer, as it always was. */
function isPersonalUser(value: unknown): value is PersonalUser {
  const user = value as Partial<PersonalUser> | null;
  return !!user && typeof user === "object" && typeof user.username === "string" && typeof user.name === "string" && typeof user.key_hash_ref === "string" && typeof user.role === "string" && Array.isArray(user.scope_ids) && user.scope_ids.every((id) => typeof id === "string");
}
/** A personal session ends this long after its last request. */
export const personalIdleMs = 30 * 60_000;
/** One account may hold this many sessions at once; signing in again ends its oldest, so one account cannot fill the table. */
export const maxSessionsPerAccount = 8;
/** Successful sign-ins one account may make in a window. Checked before any credential work, so it costs nothing to refuse. */
export const loginBudget = { max: 20, windowMs: 15 * 60_000 };
let decoy: Promise<string> | undefined;
/**
 * A scrypt digest of a random value that nobody knows, made once per process. A sign-in that names no account is checked
 * against it, so it costs the same as a real check and fails the same way (401), whether or not the legacy owner's digest file can be read.
 */
export const decoyDigest = () => (decoy ??= hashPassword(randomBytes(24).toString("base64url")));
export class AuthError extends Error {
  constructor(
    public code: string,
    public status = 401,
  ) {
    super(code);
  }
}
export function secret(ref: string) {
  const problem = credentialFileProblem(ref);
  if (problem) throw credentialUnreadable(problem);
  let value: string;
  try {
    value = readFileSync(ref, "utf8").trim();
  } catch (error) {
    // The stat passed, so the file went away or belongs to someone else by the time it is read.
    throw credentialUnreadable((error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "permissions");
  }
  if (!value) throw credentialUnreadable("empty");
  return value;
}
/** One error for every reason a credential file cannot be used; `reason` says which, and never names the file. */
function credentialUnreadable(reason: CredentialFileReason) {
  return Object.assign(new AuthError("credential_unreadable", 503), { reason });
}
export function validateEndpoint(value: string, issuer: string) {
  const url = new URL(value),
    source = new URL(issuer);
  if (
    url.origin !== source.origin ||
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new AuthError("oidc_endpoint_not_trusted", 503);
  return url.href;
}
export function validateControlOrigin(value: string) {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  )
    throw new AuthError("control_origin_not_trusted", 503);
  return url.origin;
}
export function validateControlBind(value: string) {
  if (!["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"].includes(value))
    throw new AuthError("control_bind_not_trusted", 503);
  return value;
}
export async function boundedJSON(response: Response, max = 1048576) {
  if (!response.ok)
    throw new AuthError(
      "upstream_unavailable",
      response.status === 403 ? 403 : 503,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new AuthError("invalid_response", 503);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new AuthError("response_limit_exceeded", 503);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
}
export function verifyIDToken(
  token: string,
  jwks: { keys: JsonWebKey[] },
  expected: { issuer: string; audience: string; nonce: string; now: number },
) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("invalid_id_token");
  let header: any, claims: any;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    throw new AuthError("invalid_id_token");
  }
  const keys = jwks.keys.filter(
    (k: any) =>
      k.kid === header.kid &&
      k.kty === "RSA" &&
      (!k.use || k.use === "sig") &&
      (!k.alg || k.alg === "RS256"),
  );
  if (
    header.alg !== "RS256" ||
    keys.length !== 1 ||
    header.crit ||
    !verify(
      "RSA-SHA256",
      Buffer.from(parts[0] + "." + parts[1]),
      createPublicKey({ key: keys[0] as any, format: "jwk" }),
      Buffer.from(parts[2], "base64url"),
    )
  )
    throw new AuthError("invalid_id_token");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== expected.issuer ||
    !aud.includes(expected.audience) ||
    (aud.length > 1 && claims.azp !== expected.audience) ||
    (claims.azp && claims.azp !== expected.audience) ||
    claims.nonce !== expected.nonce ||
    typeof claims.exp !== "number" ||
    claims.exp <= expected.now ||
    typeof claims.iat !== "number" ||
    claims.iat > expected.now + 30 ||
    (claims.nbf && claims.nbf > expected.now + 30) ||
    typeof claims.sub !== "string" ||
    !claims.sub
  )
    throw new AuthError("invalid_id_token");
  return claims;
}
export class SessionAuth {
  sessions: SessionStore;
  private challenges = new Map<
    string,
    { state: string; verifier: string; nonce: string; expires: number }
  >();
  constructor(
    private config: ServerConfig,
    private fetcher: typeof fetch = fetch,
    sessions?: SessionStore,
  ) {
    this.sessions = sessions ?? new SessionStore(createMemoryDB());
  }
  /** When the sign-ins that failed in the last 15 minutes were tried; only these count against the limit. */
  private loginFailures: number[] = [];
  private loginBusy = false;
  /** When each account signed in successfully within the budget window; only real accounts ever get an entry. */
  private loginSuccesses = new Map<string, number[]>();
  /** Accounts revoked through this server whose revocation the configuration file does not hold (yet). */
  private revoked = new Set<string>();
  /** Which version of the configuration file the account list was last taken from; empty until it has been. */
  private usersStamp = "";
  /** The version of the file whose reload failed and was logged, so one bad file is logged once and not on every request. */
  private reloadFailedStamp = "";
  /** How long a write waits for the configuration lock (5 s by default) and when it breaks a stale one; tests shorten it. */
  lockOptions: LockOptions = {};
  private personalUsers() {
    return this.config.personal?.users || [];
  }
  private personalUser(username: string) {
    return findEnabledUser(this.personalUsers(), username);
  }
  /** Takes the account list from the configuration file now, if the file changed since it was last taken. */
  refreshPersonalUsers() {
    this.followConfigFile();
  }
  /**
   * Takes `personal.users` from the configuration file when the file has changed since it was last taken, so an account
   * added, revoked, enabled or rotated with `personal-config` applies to the next request and needs no restart. The check
   * is one `stat` (inode, size and times: personal-config replaces the file through a rename). Only the account list is
   * taken; nothing else of the file reaches memory. `users: null` is an empty list. A file that cannot be read, is not
   * JSON, or whose `users` is not a list changes nothing and is read again next time, and is logged once per version of
   * the file (by code, never the path). Revocations made through this server and not yet stored stay in force.
   */
  private followConfigFile() {
    const path = this.config.config_file;
    if (!path || !this.config.personal) return;
    let stamp = "unreadable";
    let read: PersonalUser[];
    try {
      stamp = fileIdentity(path);
      if (stamp === this.usersStamp) return;
      if (stamp === "absent") throw Object.assign(new Error("absent"), { code: "ENOENT" });
      const stored = (JSON.parse(readFileSync(path, "utf8")) as Partial<ServerConfig> | null)?.personal;
      if (!stored || typeof stored !== "object") throw Object.assign(new Error("no personal block"), { code: "no_personal_block" });
      if (stored.users !== undefined && stored.users !== null && !Array.isArray(stored.users)) throw Object.assign(new Error("users is not a list"), { code: "users_not_a_list" });
      read = (stored.users ?? []).filter(isPersonalUser);
    } catch (error) {
      this.noteReloadFailed(stamp, error);
      return;
    }
    this.usersStamp = stamp;
    this.reloadFailedStamp = "";
    const repeated = duplicateNames(read);
    if (repeated.size) console.warn(`[control-center] account list has ${repeated.size} username(s) listed more than once; every entry of them is disabled`);
    this.settleRevocations(read);
    this.adopt(this.withRevocations(read));
  }
  /** Logs a failed reload once per version of the file. The code says why (EACCES, invalid_json, ...); the path and the content are never logged. */
  private noteReloadFailed(stamp: string, error: unknown) {
    if (this.reloadFailedStamp === stamp) return;
    this.reloadFailedStamp = stamp;
    const code = (error as NodeJS.ErrnoException)?.code;
    console.warn(`[control-center] account list reload failed: ${typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : error instanceof SyntaxError ? "invalid_json" : "unreadable"}`);
  }
  /** Replaces the account list in one assignment. Sessions of accounts that stopped being enabled end, and live sessions move to a new epoch. */
  private adopt(next: PersonalUser[]) {
    const personal = this.config.personal!;
    const before = personal.users ?? [];
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    const names = (list: PersonalUser[]) => new Set(enabledUsers(list).map((user) => user.username));
    const stays = names(next);
    personal.users = next;
    for (const name of names(before)) if (!stays.has(name)) this.endSessionsOf(name);
    this.sessions.bumpAll();
  }
  private endSessionsOf(username: string) {
    for (const session of this.sessions.values()) if (session.personal && session.subject === username) this.sessions.delete(session.id);
  }
  /** A revocation never goes back on its own: whatever list is taken from the file or written to it has the pending ones applied. */
  private withRevocations(users: PersonalUser[]) {
    return users.map((user) => (this.revoked.has(user.username) ? { ...user, enabled: false } : user));
  }
  /**
   * A revocation stops being pending once the file holds it for every entry of the name, or the name is gone from the file.
   * From then on the file decides. (Looking at one entry only would settle it while a second entry of the name was still on.)
   */
  private settleRevocations(stored: PersonalUser[]) {
    for (const name of [...this.revoked]) {
      if (stored.filter((user) => user.username === name).every((user) => !isEnabledFlag(user.enabled))) this.revoked.delete(name);
    }
  }
  /** A new session starts above every stored one and no lower than the clock, so a tab that holds an older session sees the change. */
  private nextEpoch() {
    return Math.max(Date.now(), this.sessions.maxEpoch() + 1);
  }
  personalBinding(): PrincipalBinding | undefined {
    const p = this.config.personal;
    if (this.config.auth_mode !== "personal" || !p) return undefined;
    const all = this.config.principals.flatMap((v) => v.scopes);
    return {
      issuer: "yeisme:personal",
      subject: p.username || "owner",
      name: p.name,
      role: p.role === "admin" ? "admin" : "viewer",
      scopes: all.filter((v) => p.scope_ids.includes(v.id)),
    };
  }
  private personalUserBinding(user: PersonalUser): PrincipalBinding {
    const all = this.config.principals.flatMap((v) => v.scopes);
    return {
      issuer: "yeisme:personal",
      subject: user.username,
      name: user.name,
      role: user.role,
      scopes: all.filter((scope) => user.scope_ids.includes(scope.id)),
    };
  }
  principal(s: Session): PrincipalBinding | undefined {
    if (s.personal) {
      const user = this.personalUser(s.subject);
      if (user) {
        const binding = this.personalUserBinding(user);
        return binding.issuer === s.issuer && binding.subject === s.subject ? binding : undefined;
      }
      const binding = this.personalBinding();
      return binding?.issuer === s.issuer && binding.subject === s.subject
        ? binding
        : undefined;
    }
    return this.config.principals.find(
      (p) => p.issuer === s.issuer && p.subject === s.subject,
    );
  }
  role(s: Session) {
    return this.principal(s)?.role === "admin" ? "admin" : "viewer";
  }
  async personalLogin(request: Request, secretValue: string, username?: string) {
    this.followConfigFile();
    const users = this.personalUsers();
    const user = username ? this.personalUser(username) : undefined;
    if (
      this.config.auth_mode !== "personal" ||
      !this.config.personal ||
      request.headers.get("origin") !== this.config.origin ||
      new URL(request.url).origin !== this.config.origin
    )
      throw new AuthError("personal_login_unavailable", 403);
    validateControlOrigin(this.config.origin);
    const personal = this.config.personal;
    const now = Date.now();
    this.loginFailures = this.loginFailures.filter(
      (v) => now - v < 15 * 60_000,
    );
    // Who could this be? An enabled account of that name, or the legacy owner of the configuration. Anything else names no account.
    const legacy = !user && (personal.username === undefined ? users.length === 0 : username === personal.username);
    const subject = user ? user.username : legacy ? personal.username || "owner" : undefined;
    // An account that signed in too often is refused before any credential work, for that account only. Only successful
    // sign-ins fill the budget, so nobody can use up another account's by guessing at its name.
    if (subject !== undefined && this.successesOf(subject, now).length >= loginBudget.max)
      throw new AuthError("login_rate_limited", 429);
    // Credentials are checked one at a time, so a second sign-in that arrives meanwhile is told to wait a moment. Only a
    // sign-in whose credentials were checked and refused counts against the limit: a success, or a server-side problem, does not.
    if (this.loginBusy) throw new AuthError("login_busy", 429);
    if (this.loginFailures.length >= 5)
      throw new AuthError("login_rate_limited", 429);
    this.loginBusy = true;
    try {
      // A name that matches no account is checked against a decoy digest of the same cost, so it fails as a wrong key does
      // (401) and counts as one, and never as a 503 that would tell a name that exists from one that does not.
      const encoded = user ? secret(user.key_hash_ref) : legacy ? secret(personal.password_hash_ref) : await decoyDigest();
      const valueMatches = await checkPassword(secretValue, encoded);
      const refused = () => {
        this.loginFailures.push(now);
        return new AuthError("invalid_credentials", 401);
      };
      const binding = user ? this.personalUserBinding(user) : legacy ? this.personalBinding() : undefined;
      if (!valueMatches || !binding) throw refused();
      this.prune();
      // This account's oldest sessions make room for the new one. The table's own limit then only matters when many accounts are busy at once.
      this.sessions.evictOldest(binding.issuer, binding.subject, maxSessionsPerAccount - 1);
      if (this.sessions.size >= 100)
        throw new AuthError("session_capacity", 503);
      const id = nonce();
      this.sessions.set(id, {
        id,
        issuer: binding.issuer,
        subject: binding.subject,
        name: binding.name,
        accessToken: "",
        accessAudience: [],
        expires: now + 12 * 3600_000,
        csrf: nonce(),
        personal: true,
        last_seen: now,
        credential_version: credentialVersion(encoded),
        epoch: this.nextEpoch(),
      });
      this.loginSuccesses.set(binding.subject, [...this.successesOf(binding.subject, now), now]);
      return { cookie: this.cookie(id, 12 * 3600) };
    } finally {
      this.loginBusy = false;
    }
  }
  /** The successful sign-ins of one account inside the budget window. */
  private successesOf(subject: string, now: number) {
    return (this.loginSuccesses.get(subject) ?? []).filter((at) => now - at < loginBudget.windowMs);
  }
  listPersonalUsers() {
    this.followConfigFile();
    const enabled = new Set<PersonalUser>(enabledUsers(this.personalUsers()));
    return this.personalUsers().map(({ key_hash_ref: _keyHashRef, ...user }, index) => ({ ...user, enabled: enabled.has(this.personalUsers()[index]) }));
  }
  async createPersonalUser(input: { username: string; name: string; role: ControlCenterRole; scope_ids: string[] }) {
    if (!this.config.personal || !this.config.config_file) throw new AuthError("user_management_unavailable", 503);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(input.username) || !input.name.trim() || !["admin", "viewer"].includes(input.role))
      throw new AuthError("invalid_user", 400);
    // An account added with personal-config since the server started is in the file but not yet in memory.
    this.followConfigFile();
    const onDisk = this.readConfigFile().personal?.users;
    if ([...this.personalUsers(), ...(Array.isArray(onDisk) ? onDisk : [])].some((user) => user?.username === input.username)) throw new AuthError("user_exists", 409);
    const allowedScopes = new Set(this.config.principals.flatMap((principal) => principal.scopes.map((scope) => scope.id)));
    if (!input.scope_ids.length || input.scope_ids.some((id) => !allowedScopes.has(id))) throw new AuthError("scope_not_found", 404);
    const accessKey = "yk_live_" + nonce();
    const keyHashRef = resolve(this.config.config_file + ".users", input.username + ".key");
    const digest = (await hashPassword(accessKey)) + "\n";
    try {
      mkdirSync(dirname(keyHashRef), { recursive: true, mode: 0o700 });
    } catch {
      throw new AuthError("user_management_unavailable", 503);
    }
    try {
      // "wx": two creations of one username, or a digest an earlier one left behind, meet here, and the later one is refused.
      writeFileSync(keyHashRef, digest, { mode: 0o600, flag: "wx" });
    } catch (error) {
      throw (error as NodeJS.ErrnoException).code === "EEXIST" ? new AuthError("user_exists", 409) : new AuthError("user_management_unavailable", 503);
    }
    const user: PersonalUser = { username: input.username, name: input.name.trim(), role: input.role, key_hash_ref: keyHashRef, scope_ids: input.scope_ids, enabled: true, created_at: new Date().toISOString() };
    try {
      // Memory follows the file only once the file holds the account, so a failed write leaves no account that vanishes at restart.
      await this.persistConfig((stored) => {
        if (stored.some((existing) => existing.username === user.username)) throw new AuthError("user_exists", 409);
        return [...stored, user];
      });
    } catch (error) {
      rmSync(keyHashRef, { force: true });
      throw error;
    }
    return { user: { ...user, key_hash_ref: undefined }, access_key: accessKey };
  }
  async revokePersonalUser(username: string) {
    this.followConfigFile();
    if (!this.config.personal || !this.personalUsers().some((user) => user.username === username)) throw new AuthError("user_not_found", 404);
    // Effective at once, even when the file cannot be written or is busy: a revocation must not wait for the disk or for
    // another writer. Everything up to the first await runs before this function returns its promise. It is also remembered
    // until the file holds it, so a later write or a reload of the file cannot bring the account back.
    this.revoked.add(username);
    this.adopt(this.withRevocations(this.personalUsers()));
    this.endSessionsOf(username);
    await this.persistConfig((stored) => stored);
  }
  private readConfigFile(): ServerConfig {
    const path = this.config.config_file;
    if (!path) throw new AuthError("user_management_unavailable", 503);
    try {
      return JSON.parse(readFileSync(path, "utf8")) as ServerConfig;
    } catch {
      throw new AuthError("user_management_unavailable", 503);
    }
  }
  /**
   * Stores the account list in the configuration file, and then makes memory follow it. The in-memory config is not the
   * file: it also holds values that never lived there (providers and the bind address from the environment, `config_file`
   * itself) and it may lack edits made with personal-config. So under the exclusive lock the file is read again, `change`
   * is applied to the accounts it holds now, the revocations still pending are applied to that list too, and only
   * `personal.users` is replaced, through a temporary file renamed over the original, mode 0600. `personal-config` takes the
   * same lock and refuses to write a copy that is older than the file, so neither writer can undo the other. Slow work
   * (hashing, key generation) belongs before this call.
   */
  private async persistConfig(change: (stored: PersonalUser[]) => PersonalUser[]): Promise<void> {
    const path = this.config.config_file;
    if (!path) throw new AuthError("user_management_unavailable", 503);
    try {
      await withConfigLock(path, () => this.writeAccounts(path, change), this.lockOptions);
    } catch (error) {
      if (error instanceof ConfigBusyError) throw new AuthError("config_busy", 503);
      if (error instanceof AuthError) throw error;
      throw new AuthError("user_management_unavailable", 503);
    }
  }
  /** The part of `persistConfig` that runs while the lock is held. */
  private writeAccounts(path: string, change: (stored: PersonalUser[]) => PersonalUser[]) {
    const stored = this.readConfigFile();
    if (!stored.personal) throw new AuthError("user_management_unavailable", 503);
    const fresh = Array.isArray(stored.personal.users) ? stored.personal.users : [];
    // Pending revocations go into every write, so a write can never bring a revoked account back.
    const users = this.withRevocations(change(fresh));
    const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.users.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ ...stored, personal: { ...stored.personal, users } }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      renameSync(temp, path);
    } catch {
      rmSync(temp, { force: true });
      throw new AuthError("user_management_unavailable", 503);
    }
    // The file holds the revocations now, and nobody else writes without the lock: they are no longer pending.
    this.settleRevocations(users);
    this.usersStamp = fileIdentity(path);
    this.reloadFailedStamp = "";
    // Permission bindings changed: every live session moves to a new epoch so
    // connected clients refetch /session and drop stale scoped responses.
    this.adopt(users.filter(isPersonalUser));
  }

  cookie(value: string, maxAge: number) {
    return `yeisme_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(this.config.origin).protocol === "https:" ? "; Secure" : ""}`;
  }
  challengeCookie(value: string, maxAge: number) {
    return `yeisme_login=${value}; Path=/api/control-center/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(this.config.origin).protocol === "https:" ? "; Secure" : ""}`;
  }
  private async discovery() {
    if (this.config.auth_mode === "personal")
      throw new AuthError("oidc_not_configured", 503);
    const o = this.config.oidc;
    if (!o) throw new AuthError("oidc_not_configured", 503);
    validateEndpoint(o.issuer, o.issuer);
    const d = await boundedJSON(
      await this.fetcher(
        o.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
        { redirect: "error", signal: AbortSignal.timeout(5000) },
      ),
    );
    if (d.issuer !== o.issuer) throw new AuthError("issuer_mismatch", 503);
    for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"])
      validateEndpoint(d[key], o.issuer);
    return d;
  }
  async begin() {
    const d = await this.discovery(),
      o = this.config.oidc!,
      state = nonce(),
      challenge = nonce(),
      verifier = nonce(),
      n = nonce();
    this.prune();
    if (this.challenges.size >= 1000)
      throw new AuthError("login_capacity", 503);
    this.challenges.set(challenge, {
      state,
      verifier,
      nonce: n,
      expires: Date.now() + 300000,
    });
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: o.clientId,
      response_type: "code",
      scope: "openid",
      redirect_uri: this.config.origin + "/api/control-center/v1/auth/callback",
      state,
      nonce: n,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.href, cookie: this.challengeCookie(challenge, 300) };
  }
  async callback(request: Request) {
    const url = new URL(request.url),
      cookie = request.headers
        .get("cookie")
        ?.match(/(?:^|;\s*)yeisme_login=([^;]+)/)?.[1],
      pending = cookie ? this.challenges.get(cookie) : undefined;
    if (cookie) this.challenges.delete(cookie);
    if (
      !pending ||
      pending.expires < Date.now() ||
      pending.state !== url.searchParams.get("state") ||
      !url.searchParams.get("code")
    )
      throw new AuthError("invalid_login_state");
    const d = await this.discovery(),
      o = this.config.oidc!;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: url.searchParams.get("code")!,
      redirect_uri: this.config.origin + "/api/control-center/v1/auth/callback",
      client_id: o.clientId,
      code_verifier: pending.verifier,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (o.clientSecretRef)
      headers.Authorization =
        "Basic " +
        Buffer.from(
          encodeURIComponent(o.clientId) +
            ":" +
            encodeURIComponent(secret(o.clientSecretRef)),
        ).toString("base64");
    const tokens = await boundedJSON(
      await this.fetcher(d.token_endpoint, {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      }),
      65536,
    );
    const jwks = await boundedJSON(
      await this.fetcher(d.jwks_uri, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      }),
      65536,
    );
    const claims = verifyIDToken(tokens.id_token, jwks, {
      issuer: o.issuer,
      audience: o.clientId,
      nonce: pending.nonce,
      now: Date.now() / 1000,
    });
    const binding = this.config.principals.find(
      (p) => p.issuer === claims.iss && p.subject === claims.sub,
    );
    if (!binding) throw new AuthError("identity_not_bound", 403);
    // An access token is never accepted as identity here. Each target owner must verify its audience and delegated actor.
    let accessAudience: string[] = [];
    try {
      const payload = JSON.parse(
        Buffer.from(tokens.access_token.split(".")[1], "base64url").toString(),
      );
      accessAudience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    } catch {
      /* Opaque tokens require an explicit owner exchange contract, not inference. */
    }
    this.prune();
    if (this.sessions.size >= 1000)
      throw new AuthError("session_capacity", 503);
    const id = nonce(),
      expires = Math.min(
        claims.exp * 1000,
        Date.now() + Math.min(Number(tokens.expires_in) || 300, 1800) * 1000,
      );
    this.sessions.set(id, {
      id,
      issuer: claims.iss,
      subject: claims.sub,
      name: binding.name,
      accessToken:
        typeof tokens.access_token === "string" ? tokens.access_token : "",
      accessAudience,
      expires,
      csrf: nonce(),
      epoch: this.nextEpoch(),
    });
    return {
      cookie: this.cookie(id, Math.floor((expires - Date.now()) / 1000)),
      clear: this.challengeCookie("", 0),
    };
  }
  current(r: Request) {
    const now = Date.now();
    this.prune();
    // The accounts are the file's: a revocation made with personal-config already applies to this request.
    this.followConfigFile();
    const id = r.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)yeisme_session=([^;]+)/)?.[1];
    const s = id ? this.sessions.get(id) : undefined;
    if (!s) throw new AuthError("login_required");
    if (!this.principal(s)) {
      this.sessions.delete(s.id);
      throw new AuthError("identity_not_bound", 403);
    }
    if (s.personal) {
      const user = this.personalUser(s.subject);
      const ref = user?.key_hash_ref || this.config.personal?.password_hash_ref;
      if (
        (s.last_seen || 0) + personalIdleMs <= now ||
        !ref ||
        s.credential_version !== credentialVersion(secret(ref))
      ) {
        this.sessions.delete(s.id);
        throw new AuthError("login_required");
      }
      // The idle time runs from the last request. `get` returns a copy, so the time is written back (at most once a minute).
      if (this.sessions.touch(s.id, now)) s.last_seen = now;
    }
    return s;
  }
  csrf(r: Request, s: Session) {
    if (
      r.headers.get("origin") !== this.config.origin ||
      r.headers.get("x-csrf-token") !== s.csrf
    )
      throw new AuthError("csrf_denied", 403);
  }
  private prune() {
    this.sessions.prune();
    this.sessions.pruneIdle(Date.now(), personalIdleMs);
    for (const [k, v] of this.challenges)
      if (v.expires <= Date.now()) this.challenges.delete(k);
  }
}
