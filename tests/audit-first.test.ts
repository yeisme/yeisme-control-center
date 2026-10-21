import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth, AuthError } from "../server/auth";
import { OwnerReaders } from "../server/owners";
import { AuditStore } from "../server/db/audit";
import { createMemoryDB, type ControlDB } from "../server/db/client";
import type { ServerConfig, Session } from "../server/contracts";
import { ownerFetch, jsonResponse } from "./contract/mock-owner";

const ownerOrigin = "http://127.0.0.1:4391";
const config: ServerConfig = {
  origin: "http://127.0.0.1:4390",
  port: 4390,
  owners: { eikona: { origin: ownerOrigin, audience: "aud-eikona" } },
  principals: [
    {
      issuer: "https://id.example",
      subject: "one",
      name: "One",
      role: "admin",
      scopes: [
        {
          id: "scope-1",
          tenant: "tenant-a",
          team: "t",
          project: "project-1",
          label: "Project One",
          owners: {
            eikona: {
              tenant: "tenant-a",
              project: "project-1",
              actor: "user-1",
              audience: "aud-eikona",
            },
          },
        },
      ],
    },
    {
      issuer: "https://id.example",
      subject: "viewer",
      name: "Viewer",
      role: "viewer",
      scopes: [
        {
          id: "scope-1",
          tenant: "tenant-a",
          team: "t",
          project: "project-1",
          label: "Project One",
          owners: {},
        },
      ],
    },
  ],
};

const session: Session = {
  id: "audit-test-session",
  issuer: "https://id.example",
  subject: "one",
  name: "One",
  csrf: "audit-test-csrf",
  accessToken: "owner-token",
  accessAudience: ["aud-eikona"],
  expires: Date.now() + 600_000,
  epoch: 1,
};

const contentBody = {
  schema_version: "yeisme.business_content.v1",
  audience: "authorized_user",
  state: "complete",
  text: "business text only",
};

type Mode = "ok" | "deny" | "fail";
function setup(mode: Mode = "ok", db?: ControlDB) {
  const transport = ownerFetch((url) => {
    if (url.pathname.endsWith("/content:read")) {
      if (mode === "deny") return jsonResponse({ error: "forbidden" }, 403);
      if (mode === "fail") return jsonResponse({}, 500);
      return jsonResponse({ data: contentBody });
    }
    return jsonResponse({
      rows: [],
      coverage: { state: "complete", observed_at: "2026-10-12T08:00:00Z" },
    });
  });
  const auth = new SessionAuth(config);
  auth.sessions.set(session.id, session);
  const readers = new OwnerReaders(config, transport.fetcher);
  const appDb = db ?? createMemoryDB();
  const app = createApp(config, { auth, readers, db: appDb });
  const audit = new AuditStore(appDb);
  const request = (path: string, method = "GET", body?: unknown, cookie = session.id, csrf = session.csrf) =>
    new Request(config.origin + "/api/control-center/v1" + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: "yeisme_session=" + cookie } : {}),
        Origin: config.origin,
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { app, audit, transport, request };
}

describe("audit-first content authorization", () => {
  it("writes the audit row before the owner read and records the outcome", async () => {
    const { app, audit, transport, request } = setup("ok");
    const response = await app(
      request(
        "/requests/eikona/req-1/content:read?scope=scope-1",
        "POST",
        { direction: "input", purpose: "operator review" },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "complete" });
    const rows = audit.page({ limit: 10, action: "requests.content_read" }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "succeeded",
      owner: "eikona",
      target_ref: "req-1",
      purpose: "operator review",
      scope_id: "scope-1",
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].headers.authorization).toBe("<bearer>");
  });

  it("blocks the owner read entirely when audit storage fails", async () => {
    const real = createMemoryDB();
    const broken = new Proxy(real, {
      get(target, prop) {
        if (prop === "insert")
          return () => {
            throw new Error("disk full");
          };
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ControlDB;
    const { app, transport, request } = setup("ok", broken);
    const response = await app(
      request(
        "/requests/eikona/req-1/content:read?scope=scope-1",
        "POST",
        { direction: "input", purpose: "operator review" },
      ),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "audit_unavailable",
      class: "unavailable",
    });
    expect(transport.calls).toHaveLength(0);
  });

  it("records denied owner outcomes without masking the error", async () => {
    const { app, audit, request } = setup("deny");
    const response = await app(
      request(
        "/requests/eikona/req-1/content:read?scope=scope-1",
        "POST",
        { direction: "input", purpose: "operator review" },
      ),
    );
    expect(response.status).toBe(403);
    const rows = audit.page({ limit: 10, action: "requests.content_read" }).rows;
    expect(rows[0].outcome).toBe("denied");
    expect(rows[0].error_code).toBe("owner_forbidden");
  });

  it("never audits or contacts owners for unauthenticated reads", async () => {
    const { app, audit, transport, request } = setup("ok");
    const response = await app(
      request(
        "/requests/eikona/req-1/content:read?scope=scope-1",
        "POST",
        { direction: "input", purpose: "operator review" },
        "",
      ),
    );
    expect(response.status).toBe(401);
    expect(transport.calls).toHaveLength(0);
    expect(audit.page({ limit: 100 }).rows).toHaveLength(0);
  });

  it("exposes the audit trail only to admins with bounded filters", async () => {
    const { app, request } = setup("ok");
    await app(
      request(
        "/requests/eikona/req-1/content:read?scope=scope-1",
        "POST",
        { direction: "input", purpose: "operator review" },
      ),
    );
    const listed = await app(request("/audit?limit=25"));
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("owner-token");

    const viewerSession: Session = {
      ...session,
      id: "viewer-session",
      subject: "viewer",
      csrf: "viewer-csrf",
      accessAudience: [],
    };
    const denied = await app(request("/audit?limit=25", "GET", undefined, viewerSession.id, viewerSession.csrf));
    expect(denied.status).toBe(401); // viewer session was never registered

    const bad = await app(request("/audit?action=not_an_action"));
    expect(bad.status).toBe(400);
    expect(AuthError).toBeDefined();
  });
});
