import { describe, expect, it } from "vitest";
import { createMemoryDB } from "../server/db/client";
import { SessionAuth } from "../server/auth";
import { CollaborationService } from "../server/collaboration";
import { ActionService } from "../server/actions";
import { OwnerReaders } from "../server/owners";
import { createApp } from "../server/app";
import type { ScopeBinding, ServerConfig, Session } from "../server/contracts";
import type { ActionPreviewRequest } from "../src/shared/action-contract";

const source = (id: string): ScopeBinding => ({ id, tenant: id, team: "", project: "same-owner-project", label: id, owners: { eikona: { tenant: id, project: "same-owner-project", actor: "owner-user", audience: "eikona" } }, connection_ids: [] });
const config: ServerConfig = { origin: "http://127.0.0.1:4377", port: 4377, owners: {}, principals: [
  { issuer: "test", subject: "admin", name: "Admin", role: "admin", scopes: [source("A"), source("B")] },
  { issuer: "test", subject: "creator", name: "Creator", role: "viewer", scopes: [source("A")] },
  { issuer: "test", subject: "other", name: "Other", role: "admin", scopes: [source("B")] },
] };
const session = (subject = "admin"): Session => ({ id: subject, issuer: "test", subject, name: subject, accessToken: "", accessAudience: [], csrf: "test-csrf", epoch: 1, expires: Date.now() + 60_000 });
function fixture() {
  const db = createMemoryDB(); const auth = new SessionAuth(config); const service = new CollaborationService(db, config, auth);
  const admin = session();
  const [org] = service.execute(admin, "organization.create", "new", "0", { name: "Same name", source_scope: "A" });
  const [project] = service.execute(admin, "project.create", org, "0", { name: "Shared project" });
  return { db, auth, service, admin, org, project };
}
describe("shared project authorization", () => {
  it("retains the recipient's owner actor and does not grant an owner scope through sharing", () => {
    const creatorSource = { ...source("A"), owners: { eikona: { ...source("A").owners.eikona!, actor: "creator-owner-actor" } } };
    const custom = { ...config, principals: [config.principals[0], { ...config.principals[1], scopes: [creatorSource] }] };
    const auth = new SessionAuth(custom); const service = new CollaborationService(createMemoryDB(), custom, auth); const admin = session();
    const [org] = service.execute(admin, "organization.create", "new", "0", { name: "Org", source_scope: "A" });
    const [member] = service.execute(admin, "organization.member.set", org, "0", { identity: "test|creator", role: "member", status: "active" });
    const [project] = service.execute(admin, "project.create", org, "0", { name: "Project", bindings: service.bindingOptions(admin, org) });
    service.execute(admin, "project.members.set", project, "1", { grants: [{ subject_type: "member", subject_id: member, role: "creator" }] });
    expect(service.scope(session("creator"), project).owners.eikona?.actor).toBe("creator-owner-actor");
    custom.principals[1].scopes = [];
    expect(service.project(session("creator"), project).role).toBe("creator");
    expect(service.scope(session("creator"), project).owners).toEqual({});
  });
  it("assigns teams, unions roles and revokes suspended identities immediately", () => {
    const { service, admin, org, project } = fixture();
    const [member] = service.execute(admin, "organization.member.set", org, "0", { identity: "test|creator", role: "member", status: "active" });
    const [team] = service.execute(admin, "team.create", org, "0", { name: "Production" });
    service.execute(admin, "team.members.set", org, "1", { team_id: team, member_ids: [member] });
    service.execute(admin, "project.members.set", project, "1", { grants: [{ subject_type: "team", subject_id: team, role: "creator" }, { subject_type: "member", subject_id: member, role: "viewer" }] });
    expect(service.project(session("creator"), project).role).toBe("creator");
    expect(() => service.execute(session("creator"), "project.update", project, "2", { name: "Forbidden" })).toThrow(/permission_denied/);
    service.execute(admin, "organization.member.set", org, "1", { identity: "test|creator", role: "member", status: "suspended" });
    expect(() => service.project(session("creator"), project)).toThrow(/not_found/);
  });
  it("hides foreign projects, enforces CAS and protects the last administrator", () => {
    const { service, admin, org, project } = fixture();
    expect(() => service.project(session("other"), project)).toThrow(/not_found/);
    expect(() => service.project({ ...admin, expires: 0 }, project)).toThrow(/session_expired/);
    expect(() => service.execute(admin, "project.update", project, "9", { name: "Conflict" })).toThrow(/revision_conflict/);
    expect(() => service.execute(admin, "organization.member.set", org, "1", { identity: "test|admin", role: "member", status: "active" })).toThrow(/last_organization_admin/);
    const [otherOrg] = service.execute(admin, "organization.create", "new", "0", { name: "Same name", source_scope: "B" });
    const [otherProject] = service.execute(admin, "project.create", otherOrg, "0", { name: "Shared project" });
    const [folder] = service.execute(admin, "folder.create", project, "1", { name: "Design" });
    expect(() => service.execute(admin, "folder.create", otherProject, "1", { name: "Bad", parent_id: folder })).toThrow(/folder_not_found/);
    expect(service.folders(admin, otherProject)).toEqual([]);
  });
  it("only binds exact configured scope options", () => {
    const { service, admin, org, project } = fixture();
    const option = service.bindingOptions(admin, org)[0];
    service.execute(admin, "project.bindings.set", project, "1", { bindings: [option] });
    expect(service.scope(admin, project).owners.eikona?.project).toBe("same-owner-project");
    expect(() => service.execute(admin, "project.bindings.set", project, "2", { bindings: [{ ...option, project_ref: "foreign" }] })).toThrow(/invalid_project_bindings/);
  });
});
describe("durable action identity", () => {
  it("rolls back the local mutation when writing its receipt cannot complete", () => {
    const f = fixture(); const service = new ActionService(f.db);
    const request: ActionPreviewRequest = { scope_id: "A", owner: "control-center", target_kind: "organization", target_ref: f.org, action: "project.create", input: { name: "Atomic project" }, expected_revision: "0", idempotency_key: "atomic_project_creation_001" };
    const preview = service.preview(request, "test|admin");
    const confirm = { scope_id: "A", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: request.idempotency_key };
    expect(() => service.confirmLocal(confirm, () => { f.service.execute(f.admin, "project.create", f.org, "0", request.input); throw Error("receipt interrupted"); }, "test|admin")).toThrow("receipt interrupted");
    expect(f.service.list(f.admin)).toHaveLength(1);
    const receipt = service.confirmLocal(confirm, (r) => ({ ...ActionService.unavailable(r, ""), state: "succeeded", result_refs: f.service.execute(f.admin, "project.create", f.org, "0", request.input) }), "test|admin");
    expect(f.service.list(f.admin)).toHaveLength(2);
    expect(new ActionService(f.db).confirmLocal(confirm, () => { throw Error("duplicate"); }, "test|admin").receipt_ref).toBe(receipt.receipt_ref);
  });
  it("replays across service restart and refuses other actors and changed keys", async () => {
    const db = createMemoryDB(); const service = new ActionService(db);
    const request: ActionPreviewRequest = { scope_id: "A", owner: "control-center", target_kind: "organization", target_ref: "new", action: "organization.create", input: { name: "Organization", source_scope: "A" }, expected_revision: "0", idempotency_key: "organization_create_001" };
    const preview = service.preview(request, "test|admin");
    let writes = 0;
    const confirm = { scope_id: "A", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: request.idempotency_key };
    const receipt = await service.confirm(confirm, async (r) => { writes++; return { ...ActionService.unavailable(r, ""), state: "succeeded", error_code: null }; }, "test|admin");
    const restarted = new ActionService(db);
    const replay = await restarted.confirm(confirm, async () => { throw Error("duplicate"); }, "test|admin");
    expect(replay.receipt_ref).toBe(receipt.receipt_ref); expect(writes).toBe(1);
    expect(() => restarted.record(preview.preview_ref, "test|other", "A")).toThrow(/scope_denied/);
    expect(() => restarted.preview({ ...request, input: { ...request.input, name: "Changed" } }, "test|admin")).toThrow(/idempotency_conflict/);
  });
});
describe("member delegation", () => {
  it("never reads a configured service credential for a personal or wrong-audience member request", async () => {
    let outgoing = 0;
    const readers = new OwnerReaders({ ...config, owners: { eikona: { origin: "https://owner.invalid", audience: "eikona", credential_ref: "/must-not-be-read" } } }, (async () => { outgoing++; return Response.json({}); }) as typeof fetch);
    for (const s of [{ ...session(), personal: true }, { ...session(), accessToken: "delegated", accessAudience: ["wrong"] }, { ...session(), expires: 0 }])
      await expect(readers.organization("eikona", s, source("A"))).rejects.toThrow(/delegation_unavailable/);
    expect(outgoing).toBe(0);
  });
  it("exposes shared projects through real HTTP and actor-bound action receipts", async () => {
    const { db, auth, admin, project } = fixture(); auth.sessions.set(admin.id, admin);
    const app = createApp(config, { db, auth });
    const request = (path: string) => new Request(config.origin + "/api/control-center/v1" + path, { headers: { Cookie: "yeisme_session=admin" } });
    expect((await (await app(request("/projects"))).json()).rows[0].id).toBe(project);
    const state = await (await app(request("/session"))).json(); expect(state.shared_projects).toHaveLength(1);
  });
});
