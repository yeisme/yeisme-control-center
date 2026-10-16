import { randomBytes, createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, statSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ServerConfig, Session, PrincipalBinding, PersonalUser } from "./contracts";
import type { ControlCenterRole } from "../src/service-directory";
import { checkPassword, credentialVersion, hashPassword } from "./password";
const nonce = () => randomBytes(32).toString("base64url");
export class AuthError extends Error {
  constructor(
    public code: string,
    public status = 401,
  ) {
    super(code);
  }
}
export function secret(ref: string) {
  const stat = statSync(ref);
  if (!stat.isFile() || stat.mode & 0o077)
    throw new AuthError("secret_permissions_invalid", 503);
  return readFileSync(ref, "utf8").trim();
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
  sessions = new Map<string, Session>();
  private challenges = new Map<
    string,
    { state: string; verifier: string; nonce: string; expires: number }
  >();
  constructor(
    private config: ServerConfig,
    private fetcher: typeof fetch = fetch,
  ) {}
  private loginAttempts: number[] = [];
  private loginBusy = false;
  private personalUsers() {
    return this.config.personal?.users || [];
  }
  private personalUser(username: string) {
    return this.personalUsers().find((user) => user.enabled !== false && user.username === username);
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
    const users = this.personalUsers();
    const user = username ? this.personalUser(username) : undefined;
    const binding = user ? this.personalUserBinding(user) : this.personalBinding();
    if (
      this.config.auth_mode !== "personal" ||
      !this.config.personal ||
      request.headers.get("origin") !== this.config.origin ||
      new URL(request.url).origin !== this.config.origin
    )
      throw new AuthError("personal_login_unavailable", 403);
    validateControlOrigin(this.config.origin);
    const now = Date.now();
    this.loginAttempts = this.loginAttempts.filter(
      (v) => now - v < 15 * 60_000,
    );
    if (this.loginBusy || this.loginAttempts.length >= 5)
      throw new AuthError("login_rate_limited", 429);
    this.loginAttempts.push(now);
    this.loginBusy = true;
    try {
      const encoded = user
        ? secret(user.key_hash_ref)
        : secret(this.config.personal!.password_hash_ref);
      const valueMatches = await checkPassword(secretValue, encoded);
      const expectedUsername = this.config.personal!.username;
      const legacyAdminMatch = users.length > 0 && !user && expectedUsername !== undefined && username === expectedUsername && valueMatches;
      if (!valueMatches || (users.length === 0 && expectedUsername !== undefined && username !== expectedUsername) || (users.length > 0 && !user && !legacyAdminMatch))
        throw new AuthError("invalid_credentials", 401);
      if (!binding) throw new AuthError("invalid_credentials", 401);
      this.prune();
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
      });
      return { cookie: this.cookie(id, 12 * 3600) };
    } finally {
      this.loginBusy = false;
    }
  }
  listPersonalUsers() {
    return this.personalUsers().map(({ key_hash_ref: _keyHashRef, ...user }) => ({ ...user, enabled: user.enabled !== false }));
  }
  async createPersonalUser(input: { username: string; name: string; role: ControlCenterRole; scope_ids: string[] }) {
    if (!this.config.personal || !this.config.config_file) throw new AuthError("user_management_unavailable", 503);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(input.username) || !input.name.trim() || !["admin", "viewer"].includes(input.role))
      throw new AuthError("invalid_user", 400);
    if (this.personalUsers().some((user) => user.username === input.username)) throw new AuthError("user_exists", 409);
    const allowedScopes = new Set(this.config.principals.flatMap((principal) => principal.scopes.map((scope) => scope.id)));
    if (!input.scope_ids.length || input.scope_ids.some((id) => !allowedScopes.has(id))) throw new AuthError("scope_not_found", 404);
    const accessKey = "yk_live_" + nonce();
    const keyHashRef = resolve(this.config.config_file + ".users", input.username + ".key");
    mkdirSync(dirname(keyHashRef), { recursive: true, mode: 0o700 });
    writeFileSync(keyHashRef, (await hashPassword(accessKey)) + "\n", { mode: 0o600, flag: "wx" });
    const user: PersonalUser = { username: input.username, name: input.name.trim(), role: input.role, key_hash_ref: keyHashRef, scope_ids: input.scope_ids, enabled: true, created_at: new Date().toISOString() };
    this.config.personal.users = [...this.personalUsers(), user];
    this.persistConfig();
    return { user: { ...user, key_hash_ref: undefined }, access_key: accessKey };
  }
  revokePersonalUser(username: string) {
    if (!this.config.personal || !this.personalUsers().some((user) => user.username === username)) throw new AuthError("user_not_found", 404);
    this.config.personal.users = this.personalUsers().map((user) => user.username === username ? { ...user, enabled: false } : user);
    for (const session of this.sessions.values()) if (session.personal && session.subject === username) this.sessions.delete(session.id);
    this.persistConfig();
  }
  private persistConfig() {
    const path = this.config.config_file;
    if (!path) throw new AuthError("user_management_unavailable", 503);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = path + "." + process.pid + ".users.tmp";
    writeFileSync(temp, JSON.stringify({ ...this.config, config_file: undefined }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
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
    });
    return {
      cookie: this.cookie(id, Math.floor((expires - Date.now()) / 1000)),
      clear: this.challengeCookie("", 0),
    };
  }
  current(r: Request) {
    this.prune();
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
        (s.last_seen || 0) + 30 * 60_000 <= Date.now() ||
        !ref ||
        s.credential_version !== credentialVersion(secret(ref))
      ) {
        this.sessions.delete(s.id);
        throw new AuthError("login_required");
      }
      s.last_seen = Date.now();
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
    for (const [k, v] of this.sessions)
      if (v.expires <= Date.now()) this.sessions.delete(k);
    for (const [k, v] of this.challenges)
      if (v.expires <= Date.now()) this.challenges.delete(k);
  }
}
