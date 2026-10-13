import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { createApp, parseQuery } from "../server/app";
import { SessionAuth, verifyIDToken, validateEndpoint } from "../server/auth";
import { businessText, safeProjection, OwnerReaders } from "../server/owners";
import type { ServerConfig, Session } from "../server/contracts";
const config: ServerConfig = {
  origin: "http://127.0.0.1:4299",
  port: 4299,
  owners: {},
  principals: [
    {
      issuer: "https://id.example",
      subject: "one",
      name: "Same Name",
      scopes: [
        {
          id: "a",
          tenant: "tenant-a",
          team: "t",
          project: "p",
          label: "Same Project",
          owners: {},
        },
      ],
    },
    {
      issuer: "https://id.example",
      subject: "two",
      name: "Same Name",
      scopes: [
        {
          id: "b",
          tenant: "tenant-b",
          team: "t",
          project: "p",
          label: "Same Project",
          owners: {},
        },
      ],
    },
  ],
};
const session: Session = {
  id: "local-test-session",
  issuer: "https://id.example",
  subject: "one",
  name: "Same Name",
  csrf: "local-test-csrf",
  accessToken: "local-test-token",
  accessAudience: [],
  expires: Date.now() + 60000,
};
const request = (path: string, method = "GET", body?: any) =>
  new Request(config.origin + "/api/control-center/v1" + path, {
    method,
    headers: {
      Cookie: "yeisme_session=" + session.id,
      Origin: config.origin,
      "X-CSRF-Token": session.csrf,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
function setup() {
  const auth = new SessionAuth(config);
  auth.sessions.set(session.id, session);
  return { auth, app: createApp(config, { auth }) };
}
describe("control center authorization boundary", () => {
  it("never falls back to demo for unauthenticated requests", async () => {
    const r = await createApp(config)(
      new Request(config.origin + "/api/control-center/v1/requests?scope=a"),
    );
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "login_required" });
  });
  it("same names do not allow cross-tenant search, deep links or exports", async () => {
    const { app } = setup();
    for (const p of [
      "/requests?scope=b",
      "/organization?scope=b",
      "/requests/eikona/r1?scope=b",
      "/requests/export?scope=b",
    ])
      expect((await app(request(p))).status).toBe(404);
  });
  it("does not turn missing sources into healthy zeros", async () => {
    const { app } = setup();
    const r = await app(request("/requests?scope=a"));
    const data = await r.json();
    expect(data.rows).toEqual([]);
    expect(data.coverage).toHaveLength(4);
    expect(data.coverage.every((c: any) => c.state === "unavailable")).toBe(
      true,
    );
    const summary = await (
      await app(request("/requests/summary?scope=a"))
    ).json();
    expect(summary.complete).toBe(false);
    expect(summary.sources.every((s: any) => !s.summary)).toBe(true);
  });
  it("content POST requires same origin and CSRF, business mutations are absent", async () => {
    const { app } = setup();
    const r = request("/requests/eikona/r1/content:read?scope=a", "POST", {
      direction: "input",
      purpose: "inspection",
    });
    r.headers.delete("X-CSRF-Token");
    expect((await app(r)).status).toBe(403);
    expect(
      (await app(request("/requests/eikona/r1/retry?scope=a", "POST", {})))
        .status,
    ).toBe(405);
  });
  it("revoking a principal invalidates the next read", async () => {
    const local = structuredClone(config),
      auth = new SessionAuth(local);
    auth.sessions.set(session.id, session);
    const app = createApp(local, { auth });
    local.principals = [];
    expect((await app(request("/session"))).status).toBe(403);
  });
  it("rejects unbounded windows, invalid page size and injected paths", () => {
    expect(() =>
      parseQuery(new URLSearchParams("from=2025-01-01&to=2026-10-03")),
    ).toThrow();
    expect(() => parseQuery(new URLSearchParams("limit=50000"))).toThrow();
    expect(() =>
      validateEndpoint("https://evil.example/token", "https://id.example"),
    ).toThrow();
  });
  it("renders only explicit business text, excluding system and tool internals", () => {
    const input = {
      messages: [
        { role: "system", content: "internal sentinel" },
        { role: "user", content: "business sample" },
        { role: "tool", content: "private argument sentinel" },
      ],
      api_key: "secret sentinel",
    };
    expect(businessText(input, "input")).toBe("business sample");
    expect(businessText({ response: "untyped raw payload" }, "output")).toBe(
      "",
    );
  });
  it("does not accept cross-scope owner rows", () => {
    expect(() =>
      safeProjection({ id: "r", tenant: "other", project: "p" }, "eikona", {
        tenant: "a",
        project: "p",
        actor: "one",
        audience: "x",
      }),
    ).toThrow();
  });
  it("OIDC verifies signature, audience, issuer, nonce and expiry", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const jwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: "test",
      alg: "RS256",
    };
    const jwt = (overrides = {}) => {
      const head = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: "test" }),
        ).toString("base64url"),
        body = Buffer.from(
          JSON.stringify({
            iss: "https://id.example",
            sub: "one",
            aud: "center",
            nonce: "n",
            iat: 100,
            exp: 300,
            ...overrides,
          }),
        ).toString("base64url");
      return (
        head +
        "." +
        body +
        "." +
        sign("RSA-SHA256", Buffer.from(head + "." + body), privateKey).toString(
          "base64url",
        )
      );
    };
    const expected = {
      issuer: "https://id.example",
      audience: "center",
      nonce: "n",
      now: 200,
    };
    expect(verifyIDToken(jwt(), { keys: [jwk] }, expected).sub).toBe("one");
    for (const overrides of [
      { aud: "other" },
      { nonce: "other" },
      { exp: 199 },
      { iss: "https://other.example" },
    ])
      expect(() =>
        verifyIDToken(jwt(overrides), { keys: [jwk] }, expected),
      ).toThrow();
  });
});
