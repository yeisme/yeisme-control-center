import { describe, expect, it } from "vitest";
import { createMemoryDB } from "../server/db/client";
import { SessionAuth } from "../server/auth";
import { CollaborationService } from "../server/collaboration";
import { createApp } from "../server/app";
import type { ScopeBinding, ServerConfig, Session } from "../server/contracts";

const source = (id: string): ScopeBinding => ({
  id,
  tenant: id,
  team: "",
  project: "owner-project",
  label: id,
  owners: { eikona: { tenant: id, project: "owner-project", actor: "owner", audience: "eikona" } },
  connection_ids: [],
});

const config: ServerConfig = {
  origin: "http://127.0.0.1:4388",
  port: 4388,
  owners: {},
  principals: [
    { issuer: "test", subject: "admin", name: "Admin", role: "admin", scopes: [source("A")] },
    { issuer: "test", subject: "other", name: "Other", role: "admin", scopes: [source("B")] },
  ],
};

const session = (subject = "admin"): Session => ({
  id: subject,
  issuer: "test",
  subject,
  name: subject,
  accessToken: "",
  accessAudience: [],
  csrf: "csrf",
  epoch: 1,
  expires: Date.now() + 60_000,
});

function fixture() {
  const db = createMemoryDB();
  const auth = new SessionAuth(config);
  const service = new CollaborationService(db, config, auth);
  const admin = session();
  const [organization] = service.execute(admin, "organization.create", "new", "0", { name: "Org", source_scope: "A" });
  const [project] = service.execute(admin, "project.create", organization, "0", { name: "Project" });
  auth.sessions.set(admin.id, admin);
  auth.sessions.set("other", session("other"));
  const app = createApp(config, { db, auth });
  const request = (path: string, method = "GET", body?: unknown, subject = "admin") => {
    const current = session(subject);
    return new Request(config.origin + "/api/control-center/v1" + path, {
      method,
      headers: {
        Cookie: "yeisme_session=" + subject,
        Origin: config.origin,
        ...(method === "POST" ? { "X-CSRF-Token": current.csrf, "Content-Type": "application/json" } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  return { app, project, request };
}

describe("reference binding fail-closed contract", () => {
  it("returns an explicit unknown/needs_contract page without owner calls", async () => {
    const f = fixture();
    const response = await f.app(f.request(`/projects/${f.project}/reference-bindings?owner=eikona&kind=image&limit=20`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schema_version: "yeisme.reference_binding.page.v1",
      rows: [],
      next_cursor: null,
      coverage: "unknown",
      availability: "needs_contract",
      sources: [{ owner: "eikona", project_ref: null, state: "needs_contract", reason: "reference_binding_project_not_bound" }],
    });
  });

  it("rejects invalid directory queries before any owner adapter", async () => {
    const f = fixture();
    expect((await f.app(f.request(`/projects/${f.project}/reference-bindings?owner=sonora`))).status).toBe(400);
    expect((await f.app(f.request(`/projects/${f.project}/reference-bindings?limit=101`))).status).toBe(400);
  });

  it("validates access input and keeps the missing owner contract explicit", async () => {
    const f = fixture();
    const invalid = await f.app(f.request(`/projects/${f.project}/reference-bindings/binding-1/access`, "POST", { purpose: "preview", expected_revision: "1", expected_digest: "bad" }));
    expect(invalid.status).toBe(400);
    const missing = await f.app(f.request(`/projects/${f.project}/reference-bindings/binding-1/access`, "POST", { purpose: "preview", expected_revision: "1", expected_digest: "sha256:" + "a".repeat(64) }));
    expect(missing.status).toBe(422);
    await expect(missing.json()).resolves.toMatchObject({ error: "needs_contract", class: "invalid" });
  });

  it("does not reveal a project to another scope", async () => {
    const f = fixture();
    const response = await f.app(f.request(`/projects/${f.project}/reference-bindings`, "GET", undefined, "other"));
    expect(response.status).toBe(404);
  });
});
