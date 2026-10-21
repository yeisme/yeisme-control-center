import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { OwnerReaders } from "../server/owners";
import { AuditStore } from "../server/db/audit";
import { createMemoryDB, type ControlDB } from "../server/db/client";
import type { ServerConfig, Session } from "../server/contracts";
import { ownerFetch } from "./contract/mock-owner";

const ownerOrigin = "http://127.0.0.1:4461";
const audience = "aud-eikona";

const config: ServerConfig = {
  origin: "http://127.0.0.1:4460",
  port: 4460,
  owners: { eikona: { origin: ownerOrigin, audience } },
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
            eikona: { tenant: "tenant-a", project: "project-1", actor: "user-1", audience },
          },
        },
      ],
    },
  ],
};

const session: Session = {
  id: "attachment-session",
  issuer: "https://id.example",
  subject: "one",
  name: "One",
  csrf: "attachment-csrf",
  accessToken: "oidc-token",
  accessAudience: [audience],
  expires: Date.now() + 600_000,
  epoch: 1,
};

type Mode = "text" | "image" | "not-found" | "oversize" | "bad-mime";
function setup(mode: Mode = "text", db?: ControlDB) {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8]);
  const transport = ownerFetch((url) => {
    if (!url.pathname.includes("/attachments/")) return Response.json({ data: { rows: [] } });
    if (mode === "not-found") return new Response(null, { status: 404 });
    if (mode === "text")
      return Response.json({
        data: { state: "complete", receipt_ref: "receipt-1", mime: "text/plain", text: "用户上传的分镜说明文本", truncated: false },
      });
    if (mode === "bad-mime")
      return Response.json({
        data: { state: "complete", mime: "application/zip", data: Buffer.from(pngBytes).toString("base64") },
      });
    const payload = mode === "oversize" ? new Uint8Array(8.5 * 1024 * 1024).fill(65) : pngBytes;
    return Response.json({
      data: { state: "complete", receipt_ref: "receipt-2", mime: "image/png", sha256: "a".repeat(64), data: Buffer.from(payload).toString("base64") },
    });
  });
  const auth = new SessionAuth(config);
  auth.sessions.set(session.id, session);
  const appDb = db ?? createMemoryDB();
  const app = createApp(config, { auth, readers: new OwnerReaders(config, transport.fetcher), db: appDb });
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

const readAttachment = (
  app: ReturnType<typeof setup>["app"],
  request: ReturnType<typeof setup>["request"],
  ref = "att-1",
) =>
  app(
    request(`/requests/eikona/req-1/attachments/${ref}/content:read?scope=scope-1`, "POST", {
      direction: "input",
      purpose: "attachment review",
    }),
  );

describe("attachment content reads", () => {
  it("returns text attachments inline with an audit-first row", async () => {
    const { app, audit, transport, request } = setup("text");
    const response = await readAttachment(app, request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ state: "complete", text: "用户上传的分镜说明文本", receipt_ref: "receipt-1" });
    expect(body.url).toBeUndefined();
    const rows = audit.page({ limit: 10, action: "requests.attachment_read" }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "succeeded", owner: "eikona", target_ref: "req-1#att-1", purpose: "attachment review" });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].authorization).toBe("Bearer oidc-token");
  });

  it("serves binary attachments through a short-lived bytes handle", async () => {
    const { app, audit, request } = setup("image");
    const response = await readAttachment(app, request, "att-img");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state).toBe("complete");
    expect(body.mime).toBe("image/png");
    expect(body.url).toMatch(/^\/api\/control-center\/v1\/media\/.+$/);
    const media = await app(new Request(config.origin + body.url, { headers: { Cookie: "yeisme_session=" + session.id } }));
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/png");
    expect(media.headers.get("cache-control")).toBe("no-store");
    expect((await media.arrayBuffer()).byteLength).toBe(16);
    const actions = audit.page({ limit: 10 }).rows.map((r) => r.action);
    expect(actions).toContain("requests.attachment_read");
    expect(actions).toContain("media.read");
  });

  it("maps missing owner contracts to needs_contract without faking content", async () => {
    const { app, audit, request } = setup("not-found");
    const response = await readAttachment(app, request);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "needs_contract", class: "unavailable" });
    const rows = audit.page({ limit: 10, action: "requests.attachment_read" }).rows;
    expect(rows[0].outcome).toBe("failed");
    expect(rows[0].error_code).toBe("needs_contract");
  });

  it("rejects non-whitelisted attachment mime types", async () => {
    const { app, request } = setup("bad-mime");
    const response = await readAttachment(app, request);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "media_limits_exceeded", class: "invalid" });
  });

  it("enforces the 8MB attachment ceiling", async () => {
    const { app, request } = setup("oversize");
    const response = await readAttachment(app, request);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "attachment_limit_exceeded", class: "invalid" });
  });

  it("blocks unauthenticated reads before any audit or owner call", async () => {
    const { app, audit, transport, request } = setup("text");
    const response = await app(
      request(
        "/requests/eikona/req-1/attachments/att-1/content:read?scope=scope-1",
        "POST",
        { direction: "input", purpose: "x" },
        "",
      ),
    );
    expect(response.status).toBe(401);
    expect(transport.calls).toHaveLength(0);
    expect(audit.page({ limit: 100 }).rows).toHaveLength(0);
  });

  it("requires CSRF for attachment reads", async () => {
    const { app, transport, request } = setup("text");
    const response = await app(
      request(
        "/requests/eikona/req-1/attachments/att-1/content:read?scope=scope-1",
        "POST",
        { direction: "input", purpose: "x" },
        session.id,
        "",
      ),
    );
    expect(response.status).toBe(403);
    expect(transport.calls).toHaveLength(0);
  });
});
