import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { AuctraCollectionReader } from "../server/auctra";
import { SessionAuth } from "../server/auth";
import { createMemoryDB } from "../server/db/client";
import type { ScopeBinding, ServerConfig, Session } from "../server/contracts";

const origin = "http://127.0.0.1:4460";
const scope: ScopeBinding = { id: "scope-auctra", tenant: "tenant-a", team: "team-a", project: "project-a", label: "Auctra", owners: {}, collection: { auctra: { tenant: "tenant-a", project: "project-a", actor: "collector", audience: "aud-auctra" } } };
const session: Session = { id: "session-auctra", issuer: "test", subject: "collector", name: "Collector", csrf: "csrf-auctra", accessToken: "oidc-auctra-token", accessAudience: ["aud-auctra"], expires: Date.now() + 60_000, epoch: 1 };
const config: ServerConfig = { origin, port: 4460, owners: {}, collection: { auctra: { origin: "https://auctra.example.test", audience: "aud-auctra", enabled: true } }, principals: [{ issuer: "test", subject: "collector", name: "Collector", role: "admin", scopes: [scope] }] };

function setup() {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("collection.snapshot:invoke")) return Response.json({ status: "success", data: { schema_version: "auctra.collection.snapshot.v1", project_ref: "project:project-a", observed_at: new Date().toISOString(), freshness: "fresh", returned: 1, total: 1, records: [{ record_ref: "unit:one", record_kind: "text_unit", project_ref: "project:project-a", title: "章一", status: "draft", source_digest: "sha256:one", updated_at: new Date().toISOString() }] } });
    return Response.json({ status: "failed", error: { code: "not_found" } }, { status: 404 });
  });
  const auth = new SessionAuth(config); auth.sessions.set(session.id, session);
  const app = createApp(config, { auth, auctra: new AuctraCollectionReader(config, fetcher), db: createMemoryDB() });
  const request = (path: string, init: RequestInit = {}) => new Request(origin + "/api/control-center/v1" + path, { ...init, headers: { Cookie: "yeisme_session=" + session.id, Origin: origin, ...(init.headers || {}) } });
  return { app, request };
}

describe("Auctra collection integration", () => {
  it("syncs refs-only records into the local Control Center index", async () => {
    const { app, request } = setup();
    const sync = await app(request("/auctra/collection/sync?scope=scope-auctra", { method: "POST", headers: { "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, body: "{}" }));
    expect(sync.status).toBe(200);
    const page = await app(request("/auctra/collection?scope=scope-auctra"));
    const body = await page.json();
    expect(body.rows[0].record_ref).toBe("unit:one");
    expect(JSON.stringify(body)).not.toContain("body");
    expect(JSON.stringify(body)).not.toContain("path");
  });

  it("confirms a local collection record through preview and receipt", async () => {
    const { app, request } = setup();
    await app(request("/auctra/collection/sync?scope=scope-auctra", { method: "POST", headers: { "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, body: "{}" }));
    const previewResponse = await app(request("/actions/preview?scope=scope-auctra", { method: "POST", headers: { "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, body: JSON.stringify({ scope_id: scope.id, owner: "control-center", target_kind: "auctra_collection_record", target_ref: "unit:one", action: "collection.record.confirm", expected_revision: "1", idempotency_key: "collection-confirm-001", input: { expected_revision: "1" } }) }));
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    const receiptResponse = await app(request("/actions/confirm?scope=scope-auctra", { method: "POST", headers: { "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, body: JSON.stringify({ scope_id: scope.id, preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: "collection-confirm-001" }) }));
    expect(receiptResponse.status).toBe(202);
    expect((await receiptResponse.json()).owner_state).toBe("confirmed");
  });
});
