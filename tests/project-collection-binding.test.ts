import { describe, expect, it } from "vitest";
import { createMemoryDB } from "../server/db/client";
import { SessionAuth } from "../server/auth";
import { CollaborationService } from "../server/collaboration";
import { ActionService } from "../server/actions";
import { collectionIndexScope } from "../server/collection-context";
import { createApp } from "../server/app";
import type { ScopeBinding, ServerConfig, Session } from "../server/contracts";
import type { ActionPreviewRequest } from "../src/shared/action-contract";

function setup() {
  const source = (actor: string): ScopeBinding => ({ id: "source", tenant: "tenant", project: "work", team: "", label: "Source", owners: {}, collection: { auctra: { tenant: "tenant", project: "work", actor, audience: "auctra" } } });
  const config: ServerConfig = { origin: "http://127.0.0.1:4377", port: 4377, owners: {},
    collection: { auctra: { origin: "https://auctra.invalid", audience: "auctra", credential_ref: "not-opened-by-these-tests" } },
    principals: [
      { issuer: "test", subject: "admin", name: "Admin", role: "admin", scopes: [source("admin-actor")] },
      { issuer: "test", subject: "viewer", name: "Viewer", role: "viewer", scopes: [source("viewer-actor")] },
    ] };
  const db = createMemoryDB(); const auth = new SessionAuth(config); const service = new CollaborationService(db, config, auth);
  const session = (subject: string): Session => ({ id: subject, issuer: "test", subject, name: subject, csrf: "csrf", epoch: 1, accessToken: "", accessAudience: [], expires: Date.now() + 60_000 });
  const admin = session("admin"); const viewer = session("viewer");
  const [org] = service.execute(admin, "organization.create", "new", "0", { name: "Org", source_scope: "source" });
  const [member] = service.execute(admin, "organization.member.set", org, "0", { identity: "test|viewer", role: "member", status: "active" });
  const [project] = service.execute(admin, "project.create", org, "0", { name: "Project" });
  service.execute(admin, "project.members.set", project, "1", { grants: [{ subject_type: "member", subject_id: member, role: "viewer" }] });
  const binding = service.collectionBindingOptions(admin, project)[0];
  return { config, db, auth, service, admin, viewer, project, binding };
}

describe("independent project collection binding", () => {
  it("does not backfill task bindings and only derives the current visitor's actor", () => {
    const f = setup();
    expect(f.service.collectionBinding(f.admin, f.project).availability).toBe("binding_missing");
    f.service.execute(f.admin, "project.collection_binding.set", f.project, "2", { binding: f.binding });
    expect(f.service.project(f.admin, f.project).bindings).toEqual([]);
    expect(f.service.scope(f.admin, f.project).collection?.auctra?.actor).toBe("admin-actor");
    expect(f.service.scope(f.viewer, f.project).collection?.auctra?.actor).toBe("viewer-actor");
    expect(collectionIndexScope(f.service.scope(f.admin, f.project))).not.toBe(collectionIndexScope(f.service.scope(f.viewer, f.project)));
  });
  it("refuses viewers, foreign sources and injected credentials; CAS prevents lost updates", () => {
    const f = setup();
    expect(() => f.service.execute(f.viewer, "project.collection_binding.set", f.project, "2", { binding: f.binding })).toThrow("project_permission_denied");
    for (const binding of [{ ...f.binding, source_scope: "foreign" }, { ...f.binding, project_ref: "other" }, { ...f.binding, credential: "injected" }])
      expect(() => f.service.execute(f.admin, "project.collection_binding.set", f.project, "2", { binding })).toThrow("invalid_collection_binding");
    f.service.execute(f.admin, "project.collection_binding.set", f.project, "2", { binding: f.binding });
    expect(() => f.service.execute(f.admin, "project.collection_binding.set", f.project, "2", { binding: null })).toThrow("revision_conflict");
  });
  it("revokes source access without granting it through project membership and never reuses the old index", () => {
    const f = setup();
    f.service.execute(f.admin, "project.collection_binding.set", f.project, "2", { binding: f.binding });
    const previous = collectionIndexScope(f.service.scope(f.viewer, f.project));
    f.config.principals[1].scopes = [];
    expect(f.service.project(f.viewer, f.project).role).toBe("viewer");
    expect(f.service.collectionBinding(f.viewer, f.project)).toMatchObject({ binding: null, availability: "forbidden" });
    expect(f.service.scope(f.viewer, f.project).collection).toBeUndefined();
    expect(collectionIndexScope(f.service.scope(f.viewer, f.project))).not.toBe(previous);
    f.service.execute(f.admin, "project.collection_binding.set", f.project, "3", { binding: null });
    expect(f.service.collectionBinding(f.admin, f.project).availability).toBe("binding_missing");
  });
  it("commits binding and receipt atomically and replays a duplicate confirm", () => {
    const f = setup(); const actions = new ActionService(f.db);
    const request: ActionPreviewRequest = { action: "project.collection_binding.set", owner: "control-center", target_kind: "project", target_ref: f.project, scope_id: f.project, expected_revision: "2", idempotency_key: "collection_binding_confirm_001", input: { binding: f.binding } };
    const preview = actions.preview(request, "test|admin");
    const confirm = { scope_id: f.project, preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: request.idempotency_key };
    expect(() => actions.confirmLocal(confirm, () => { f.service.execute(f.admin, "project.collection_binding.set", f.project, "2", request.input); throw Error("receipt_interrupted"); }, "test|admin")).toThrow("receipt_interrupted");
    expect(f.service.collectionBinding(f.admin, f.project).binding).toBeNull();
    const receipt = actions.confirmLocal(confirm, (record) => ActionService.succeeded(record, { result_refs: f.service.execute(f.admin, "project.collection_binding.set", f.project, "2", request.input) }), "test|admin");
    expect(new ActionService(f.db).confirmLocal(confirm, () => { throw Error("duplicate mutation"); }, "test|admin").receipt_ref).toBe(receipt.receipt_ref);
    expect(f.service.project(f.admin, f.project).revision).toBe(3);
  });
  it("checks source authorization again at HTTP confirm and hides foreign project existence", async () => {
    const f = setup(); f.auth.sessions.set(f.admin.id, f.admin);
    const app = createApp(f.config, { db: f.db, auth: f.auth });
    const headers = { Cookie: `yeisme_session=${f.admin.id}`, Origin: f.config.origin, "X-CSRF-Token": f.admin.csrf, "Content-Type": "application/json" };
    const request = async (path: string, body?: unknown) => app(new Request(`${f.config.origin}/api/control-center/v1${path}`, { headers, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) }));
    const view = await request(`/projects/${f.project}/collection-binding`);
    expect(view.status).toBe(200);
    const previewResponse = await request(`/actions/preview?scope=${f.project}`, { action: "project.collection_binding.set", owner: "control-center", target_kind: "project", target_ref: f.project, scope_id: f.project, expected_revision: "2", idempotency_key: "collection_binding_http_001", input: { binding: f.binding } });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    f.config.principals[0].scopes[0].collection!.auctra!.actor = "changed-actor";
    const confirm = await request(`/actions/confirm?scope=${f.project}`, { scope_id: f.project, preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: "collection_binding_http_001" });
    expect(confirm.status).toBe(409);
    expect(await confirm.json()).toMatchObject({ error: "collection_binding_changed" });
    expect(f.service.collectionBinding(f.admin, f.project).binding).toBeNull();
    expect((await request("/projects/project_foreign/collection-binding")).status).toBe(404);
  });
});
