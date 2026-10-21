import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { OwnerReaders } from "../server/owners";
import { createMemoryDB } from "../server/db/client";
import { SessionStore } from "../server/db/session-store";
import type { ServerConfig, Session } from "../server/contracts";
import { ownerFetch } from "./contract/mock-owner";

const ownerOrigin = "http://127.0.0.1:4451";
const audience = "aud-eikona";
const serviceToken = "service-credential-token";

const scope = {
  id: "scope-1",
  tenant: "tenant-a",
  team: "t",
  project: "project-1",
  label: "Project One",
  owners: {
    eikona: { tenant: "tenant-a", project: "project-1", actor: "user-1", audience },
  },
};

const baseConfig: ServerConfig = {
  origin: "http://127.0.0.1:4450",
  port: 4450,
  owners: { eikona: { origin: ownerOrigin, audience } },
  principals: [
    {
      issuer: "https://id.example",
      subject: "one",
      name: "One",
      role: "admin",
      scopes: [scope],
    },
  ],
};

const baseSession: Session = {
  id: "delegation-session",
  issuer: "https://id.example",
  subject: "one",
  name: "One",
  csrf: "delegation-csrf",
  accessToken: "",
  accessAudience: [],
  expires: Date.now() + 600_000,
  epoch: 1,
};

let temp = "";
let credentialRef = "";

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "cc-delegation-"));
  credentialRef = join(temp, "owner-credential");
  writeFileSync(credentialRef, serviceToken + "\n", { mode: 0o600 });
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

const ownerList = () =>
  Response.json({
    data: { rows: [], coverage: { state: "complete", observed_at: "2026-10-17T00:00:00Z" } },
  });

function build(session: Partial<Session>, ownersConfig: ServerConfig["owners"]) {
  const transport = ownerFetch(() => ownerList());
  const config = { ...baseConfig, owners: ownersConfig };
  const auth = new SessionAuth(config, undefined, new SessionStore(createMemoryDB()));
  auth.sessions.set(session.id ?? baseSession.id, { ...baseSession, ...session });
  const app = createApp(config, {
    auth,
    readers: new OwnerReaders(config, transport.fetcher),
  });
  const request = (path: string) =>
    new Request(config.origin + "/api/control-center/v1" + path, {
      headers: {
        Cookie: "yeisme_session=" + (session.id ?? baseSession.id),
        Origin: config.origin,
        "X-CSRF-Token": baseSession.csrf,
      },
    });
  return { app, transport, request, config };
}

const coverageOf = (body: { coverage: { owner: string; state: string; reason?: string }[] }, owner: string) =>
  body.coverage.find((c) => c.owner === owner);

describe("owner delegation channel", () => {
  it("prefers the session (OIDC) delegation over the service credential", async () => {
    const { app, transport, request } = build(
      { accessToken: "oidc-user-token", accessAudience: [audience] },
      { eikona: { origin: ownerOrigin, audience, credential_ref: credentialRef } },
    );
    const response = await app(request("/requests?scope=scope-1"));
    expect(response.status).toBe(200);
    expect(transport.calls[0].authorization).toBe("Bearer oidc-user-token");
    const body = await response.json();
    expect(coverageOf(body, "eikona")!.state).toBe("complete");
  });

  it("uses the per-owner service credential when the session has no delegation", async () => {
    const { app, transport, request } = build(
      {},
      { eikona: { origin: ownerOrigin, audience, credential_ref: credentialRef } },
    );
    const response = await app(request("/requests?scope=scope-1"));
    expect(response.status).toBe(200);
    expect(transport.calls[0].authorization).toBe("Bearer " + serviceToken);
    const body = await response.json();
    expect(coverageOf(body, "eikona")!.state).toBe("complete");
    // Redaction for leak scans still applies.
    expect(transport.calls[0].headers.authorization).toBe("<bearer>");
  });

  it("stays delegation_unavailable without either delegation path", async () => {
    const { app, request } = build({}, { eikona: { origin: ownerOrigin, audience } });
    const response = await app(request("/requests?scope=scope-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(coverageOf(body, "eikona")).toMatchObject({
      state: "forbidden",
      reason: "delegation_unavailable",
    });
  });

  it("rejects credentials with unsafe file permissions", async () => {
    chmodSync(credentialRef, 0o644);
    const { app, request } = build(
      {},
      { eikona: { origin: ownerOrigin, audience, credential_ref: credentialRef } },
    );
    const response = await app(request("/requests?scope=scope-1"));
    const body = await response.json();
    expect(coverageOf(body, "eikona")).toMatchObject({
      state: "unavailable",
      reason: "secret_permissions_invalid",
    });
  });

  it("marks request-owner services configured when a credential backs the session", async () => {
    const ownersConfig = {
      eikona: { origin: ownerOrigin, audience, credential_ref: credentialRef },
    } as ServerConfig["owners"];
    const transport = ownerFetch(() => ownerList());
    const config = { ...baseConfig, owners: ownersConfig };
    const auth = new SessionAuth(config, undefined, new SessionStore(createMemoryDB()));
    auth.sessions.set(baseSession.id, baseSession);
    const app = createApp(config, { auth });
    const response = await app(
      new Request(config.origin + "/api/control-center/v1/services?scope=scope-1", {
        headers: { Cookie: "yeisme_session=" + baseSession.id },
      }),
    );
    const result = await response.json();
    const eikona = result.services.find((v: { id: string }) => v.id === "eikona");
    expect(eikona.configuration).toBe("configured");
    expect(transport.calls).toHaveLength(0);
  });
});
