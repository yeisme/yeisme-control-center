import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createMemoryDB } from "../server/db/client";
import { SessionAuth } from "../server/auth";
import { createApp } from "../server/app";
import { credentialVersion } from "../server/password";
import { TaskConnections } from "../server/task-connections";
import { CollaborationService, targetBinding } from "../server/collaboration";
import { ConnectionCatalog } from "../server/connection-catalog";
import { GenerationBatches } from "../server/generation-batches";
import { OwnerReaders } from "../server/owners";
import { ProjectMetadataStore } from "../server/db/project-metadata-store";
import type { ScopeBinding, ServerConfig, Session, TaskConnection } from "../server/contracts";

const connection = (id: string, project: string, owner: TaskConnection["owner"] = "eikona"): TaskConnection => ({
  id, owner, instance_id: "lan", label: id, environment: "lan", endpoint: "http://127.0.0.1:9/mcp", credential_ref: "/not-read", project, enabled: true, allow_cancel: true, allow_content: true,
});
// One scope pins one Eikona project but reads three, as in the real configuration this round started from.
const scope: ScopeBinding = { id: "personal", tenant: "personal", team: "", project: "personal", label: "个人", connection_ids: ["e-a", "e-b", "e-c", "s-a"],
  owners: { eikona: { tenant: "p-a", project: "p-a", actor: "personal", audience: "eikona" }, sonora: { tenant: "v-a", project: "v-a", actor: "personal", audience: "sonora" } } };
const config: ServerConfig = { origin: "http://127.0.0.1:4377", port: 4377, owners: {}, connections: [connection("e-a", "p-a"), connection("e-b", "p-b"), connection("e-c", "p-c"), connection("s-a", "v-a", "sonora")],
  principals: [{ issuer: "test", subject: "admin", name: "Admin", role: "admin", scopes: [scope] }] };
const admin: Session = { id: "admin", issuer: "test", subject: "admin", name: "admin", accessToken: "", accessAudience: [], csrf: "c", epoch: 1, expires: Date.now() + 60_000 };

function setup() {
  const db = createMemoryDB();
  const service = new CollaborationService(db, config, new SessionAuth(config), new ConnectionCatalog(config, db));
  const [org] = service.execute(admin, "organization.create", "new", "0", { name: "Org", source_scope: "personal" });
  return { db, service, org: org! };
}
const pick = (service: CollaborationService, org: string, ...projects: string[]) => service.bindingOptions(admin, org).filter((o) => projects.includes(o.project_ref));

describe("every connected tool project can be bound", () => {
  it("offers the pinned project and every connected one, and binds several of one owner", () => {
    const { service, org } = setup();
    const options = service.bindingOptions(admin, org);
    expect(options.filter((o) => o.owner === "eikona").map((o) => [o.project_ref, o.pinned])).toEqual([["p-a", true], ["p-b", false], ["p-c", false]]);
    const [project] = service.execute(admin, "project.create", org, "0", { name: "多项目", bindings: pick(service, org, "p-b", "p-c", "v-a") });
    const bound = service.scope(admin, project!);
    expect(bound.projects?.map((p) => `${p.owner}:${p.project_ref}`)).toEqual(["eikona:p-b", "eikona:p-c", "sonora:v-a"]);
    expect(bound.connection_ids).toEqual(["e-b", "e-c", "s-a"]);
    // Delegated reads keep the source scope's actor but never reach the pinned p-a, which this project does not bind.
    expect(bound.owners.eikona).toMatchObject({ actor: "personal", project: "p-b" });
    const [withPinned] = service.execute(admin, "project.create", org, "0", { name: "含钉住", bindings: [...pick(service, org, "p-c"), ...pick(service, org, "p-a")] });
    expect(service.scope(admin, withPinned!).owners.eikona?.project).toBe("p-a");
  });

  it("rejects the same project twice, unknown projects and more than ten bindings", () => {
    const { service, org } = setup();
    const [b] = pick(service, org, "p-b");
    expect(() => service.execute(admin, "project.create", org, "0", { name: "x", bindings: [b, b] })).toThrow();
    expect(() => service.execute(admin, "project.create", org, "0", { name: "x", bindings: [{ ...b!, project_ref: "p-unknown" }] })).toThrow();
    expect(() => service.execute(admin, "project.create", org, "0", { name: "x", bindings: Array.from({ length: 11 }, () => b) })).toThrow();
    // Connection ids are rebuilt by the server, so a stale or forged list is ignored.
    const [project] = service.execute(admin, "project.create", org, "0", { name: "x", bindings: [{ ...b!, connection_ids: ["e-a", "forged"] }] });
    expect(service.project(admin, project!).bindings[0]?.connection_ids).toEqual(["e-b"]);
  });

  it("needs a target project for generation once an owner has several", () => {
    const one = { bindings: [{ owner: "eikona", project_ref: "p-b", source_scope: "personal", connection_ids: [] }] };
    const two = { bindings: [...one.bindings, { owner: "eikona", project_ref: "p-c", source_scope: "personal", connection_ids: [] }] };
    expect(targetBinding(one, { owner: "eikona" })?.project_ref).toBe("p-b");
    expect(targetBinding(two, { owner: "eikona" })).toBeNull();
    expect(targetBinding(two, { owner: "eikona", project_ref: "p-c" })?.project_ref).toBe("p-c");
    expect(targetBinding(two, { owner: "eikona", project_ref: "p-z" })).toBeNull();
  });
});

describe("tool projects connected from the control center", () => {
  it("copies a configured template, never cancels, and belongs to one scope and tenant", () => {
    const db = createMemoryDB();
    const catalog = new ConnectionCatalog(config, db);
    const id = catalog.register({ scope, template: config.connections![0]!, project: "p-new", label: "新项目", actor: "test|admin" });
    const [registered] = catalog.registered();
    expect(registered).toMatchObject({ id, owner: "eikona", project: "p-new", endpoint: config.connections![0]!.endpoint, credential_ref: "/not-read", allow_cancel: false, allow_content: true, label: "新项目" });
    expect(catalog.forScope(scope).map((c) => c.id)).toContain(id);
    expect(catalog.forScope({ ...scope, tenant: "other" }).map((c) => c.id)).not.toContain(id);
    expect(() => catalog.disconnect(id, { ...scope, id: "elsewhere" })).toThrow();
    catalog.disconnect(id, scope);
    expect(catalog.registered()).toEqual([]);
  });

  it("lets the new project be bound to shared projects without a restart", () => {
    const { db, service, org } = setup();
    new ConnectionCatalog(config, db).register({ scope, template: config.connections![0]!, project: "p-new", label: "", actor: "test|admin" });
    const option = service.bindingOptions(admin, org).find((o) => o.project_ref === "p-new");
    expect(option).toMatchObject({ owner: "eikona", pinned: false, registered: true });
  });
});

describe("connecting a tool project through the action flow", () => {
  const root = mkdtempSync(join(tmpdir(), "tool-projects-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const secret = join(root, "credential");
  writeFileSync(secret, "test-service-credential", { mode: 0o600 });
  const template: TaskConnection = { ...connection("e-a", "p-a"), credential_ref: secret, allow_private_http: true };
  const local: ServerConfig = { ...config, auth_mode: "personal", connections: [template], principals: [{ issuer: "test", subject: "nobody", name: "", scopes: [{ ...scope, connection_ids: ["e-a"] }] }],
    personal: { name: "Owner", username: "owner", role: "admin", password_hash_ref: secret, scope_ids: ["personal"],
      users: [{ username: "viewer", name: "Viewer", role: "viewer", key_hash_ref: secret, scope_ids: ["personal"] }] } };
  // The owner accepts the template credential for p-a and p-new only and refuses every other project.
  const probed: string[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    if (b.method === "initialize") return Response.json({ id: b.id, result: { protocolVersion: "2025-06-18" } });
    const { action, args } = b.params.arguments;
    probed.push(`${args.project_id}:${action}`);
    if (!["p-a", "p-new"].includes(args.project_id)) return Response.json({ id: b.id, result: { structuredContent: { error: { code: "AUTH_ACTION_DENIED" } } } });
    const data = action === "control_center.capabilities" ? { schema_version: "yeisme.task_observation.v1", task_families: ["run"] } : { rows: [] };
    return Response.json({ id: b.id, result: { structuredContent: { result: { data } } } });
  }) as typeof fetch;
  function harness() {
    const db = createMemoryDB();
    const auth = new SessionAuth(local);
    const tasks = new TaskConnections(local, fetcher, randomBytes(32), new ConnectionCatalog(local, db));
    const app = createApp(local, { auth, db, tasks });
    const sessions = { owner: { id: "owner-session", issuer: "yeisme:personal", subject: "owner", name: "Owner", personal: true }, viewer: { id: "viewer-session", issuer: "yeisme:personal", subject: "viewer", name: "Viewer", personal: true } };
    for (const s of Object.values(sessions)) auth.sessions.set(s.id, { ...s, csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, epoch: 1, last_seen: Date.now(), credential_version: credentialVersion("test-service-credential") });
    const call = (who: keyof typeof sessions, path: string, body?: unknown) => app(new Request(local.origin + "/api/control-center/v1" + path, { method: body ? "POST" : "GET",
      headers: { Cookie: `yeisme_session=${sessions[who].id}`, Origin: local.origin, "X-CSRF-Token": "csrf", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    let n = 0;
    const act = async (who: keyof typeof sessions, action: string, input: Record<string, unknown>) => {
      const key = `tool_project_key_${String(++n).padStart(4, "0")}`;
      const preview = await call(who, "/actions/preview?scope=personal", { scope_id: "personal", owner: "control-center", target_kind: "owner_project", target_ref: String(input.project_ref || input.connection_id), action, expected_revision: "0", idempotency_key: key, input });
      if (preview.status !== 200) return { status: preview.status, body: await preview.json() };
      const p = await preview.json();
      const confirmed = await call(who, "/actions/confirm?scope=personal", { scope_id: "personal", preview_ref: p.preview_ref, preview_digest: p.preview_digest, idempotency_key: key });
      return { status: confirmed.status, body: await confirmed.json() };
    };
    return { call, act, tasks };
  }

  it("connects a project the template credential covers, at once and without a restart", async () => {
    const { call, act, tasks } = harness();
    const connected = await act("owner", "owner_project.connect", { template_connection_id: "e-a", project_ref: "p-new", label: "新项目" });
    expect(connected).toMatchObject({ status: 202, body: { state: "succeeded", owner_state: "connected" } });
    const id = connected.body.result_refs[0];
    expect(tasks.connections(local.principals[0]!.scopes[0]!).map((c) => c.id)).toEqual(["e-a", id]);
    const listed = await (await call("owner", "/owner-projects?scope=personal")).json();
    expect(listed.can_register).toBe(true);
    expect(listed.rows.find((r: { project_ref: string }) => r.project_ref === "p-new")).toMatchObject({ owner: "eikona", pinned: false, registered: true, display_name: "新项目", registrations: [{ id, template_id: "e-a", label: "新项目" }] });
    expect(JSON.stringify(listed)).not.toContain(secret);
    // Only registered connections can be disconnected; the configured template stays.
    expect(await act("owner", "owner_project.disconnect", { connection_id: "e-a" })).toMatchObject({ status: 404, body: { error: "owner_project_not_found" } });
    expect(await act("owner", "owner_project.disconnect", { connection_id: id })).toMatchObject({ status: 202, body: { owner_state: "disconnected" } });
    expect(tasks.connections(local.principals[0]!.scopes[0]!).map((c) => c.id)).toEqual(["e-a"]);
  });

  it("refuses projects the owner does not grant without blocking the template", async () => {
    const { act, tasks } = harness();
    expect(await act("owner", "owner_project.connect", { template_connection_id: "e-a", project_ref: "p-denied" })).toMatchObject({ status: 403, body: { error: "owner_project_not_accessible" } });
    const page = await tasks.list(local.principals[0]!.scopes[0]!, "active");
    expect(page.connections.find((c) => c.id === "e-a")?.state).not.toBe("needs_authorization");
    expect(probed).toContain("p-denied:control_center.capabilities");
  });

  it("names a tool project after the same project in another scope of the tenant unless this scope named it", async () => {
    const db = createMemoryDB();
    const twoScopes: ServerConfig = { ...local, principals: [{ ...local.principals[0]!, scopes: [{ ...scope, connection_ids: ["e-a"] }, { ...scope, id: "studio", label: "工作室", connection_ids: ["e-a"] }] }], personal: { ...local.personal!, scope_ids: ["personal", "studio"] } };
    const auth = new SessionAuth(twoScopes);
    auth.sessions.set("owner-session", { id: "owner-session", issuer: "yeisme:personal", subject: "owner", name: "Owner", personal: true, csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, epoch: 1, last_seen: Date.now(), credential_version: credentialVersion("test-service-credential") });
    const app = createApp(twoScopes, { auth, db, tasks: new TaskConnections(twoScopes, fetcher, randomBytes(32), new ConnectionCatalog(twoScopes, db)) });
    const names = async () => (await (await app(new Request(local.origin + "/api/control-center/v1/owner-projects?scope=personal", { headers: { Cookie: "yeisme_session=owner-session" } }))).json()).rows
      .filter((r: { project_ref: string }) => r.project_ref === "p-a").map((r: { scope_id: string; display_name: string }) => `${r.scope_id}:${r.display_name}`);
    const metadata = new ProjectMetadataStore(db);
    metadata.rename("studio", "eikona", "p-a", "0", "主线", "yeisme:personal|owner");
    expect(await names()).toEqual(["personal:主线", "studio:主线"]);
    metadata.rename("personal", "eikona", "p-a", "0", "个人命名", "yeisme:personal|owner");
    expect(await names()).toEqual(["personal:个人命名", "studio:主线"]);
  });

  it("checks role, template, reference and duplicates before asking the owner", async () => {
    const { act } = harness();
    probed.length = 0;
    expect(await act("viewer", "owner_project.connect", { template_connection_id: "e-a", project_ref: "p-new" })).toMatchObject({ status: 403, body: { error: "control_center_admin_required" } });
    expect(await act("owner", "owner_project.connect", { template_connection_id: "e-b", project_ref: "p-new" })).toMatchObject({ status: 404, body: { error: "owner_project_template_not_found" } });
    expect(await act("owner", "owner_project.connect", { template_connection_id: "e-a", project_ref: "../p new" })).toMatchObject({ status: 400, body: { error: "invalid_owner_project_ref" } });
    expect(await act("owner", "owner_project.connect", { template_connection_id: "e-a", project_ref: "p-a" })).toMatchObject({ status: 409, body: { error: "owner_project_already_connected" } });
    expect(probed).toEqual([]);
  });
});

describe("generation goes to one bound project per item", () => {
  it("routes prepare, plan and submit to the item's project and ignores unrelated binding changes", async () => {
    const { service, org } = setup();
    const [project] = service.execute(admin, "project.create", org, "0", { name: "生成", bindings: pick(service, org, "p-b", "p-c") });
    service.execute(admin, "project.update", project!, String(service.project(admin, project!).revision), { generation_enabled: true, budget_cap: 5, currency: "USD" });
    const routed: string[] = [];
    const hash = "sha256:" + "a".repeat(64);
    const reader = new OwnerReaders({ ...config, providers: { eikona: { owner: "eikona", endpoint: "http://127.0.0.1:1/mcp", enabled: true } } });
    reader.imageBatch = async (operation, _s, _scope, body, _key, projectRef) => {
      routed.push(`${operation}:${projectRef}`);
      if (operation === "input") return { schema_version: "eikona.browser_batch_input.v1", request_batch_ref: "input:one", request_batch_digest: hash, request_count: 1, candidate_count: 1 };
      if (operation === "snapshot") return { schema_version: "eikona.batch_input_preview.v1", request_batch_ref: body.request_batch_ref, request_batch_digest: hash, request_count: 1, candidate_count: 1, execution_authorized: false };
      if (operation === "plan") return { schema_version: "eikona.batch_plan_preview.v1", request_batch_ref: body.request_batch_ref, request_batch_digest: hash, plan_digest: hash, execution_authorized: false, status: "ready", blockers: [], cost_estimate_known: true, estimated_usd_upper: 0.1 };
      throw new Error("disconnected");
    };
    const batches = new GenerationBatches(service, reader, { ...config, providers: { eikona: { owner: "eikona", endpoint: "http://127.0.0.1:1/mcp", enabled: true } } });
    const row = { id: "row1", prompt: "a lighthouse", model_ref: "model", candidate_count: 1 };
    await expect(batches.prepare(admin, project!, { owner: "eikona", rows: [row] }, "prepare_key")).rejects.toThrow(/generation_target_project_required/);
    const [item] = await batches.prepare(admin, project!, { owner: "eikona", rows: [{ ...row, project_ref: "p-c" }] }, "prepare_key");
    expect(item).toMatchObject({ project_ref: "p-c", state: "planned" });
    expect(routed).toEqual(["input:p-c", "snapshot:p-c", "plan:p-c"]);
    const create = () => service.execute(admin, "generation.batch.create", project!, String(service.project(admin, project!).revision), { name: "批次", items: [item], idempotency_key: crypto.randomUUID() })[0]!;
    const setBindings = (...refs: string[]) => service.execute(admin, "project.bindings.set", project!, String(service.project(admin, project!).revision), { bindings: pick(service, org, ...refs) });
    // Dropping p-b and adding Sonora does not touch the item's target, so the batch still submits (to p-c).
    const kept = create();
    setBindings("p-c", "v-a");
    routed.length = 0;
    expect((await batches.operate(admin, project!, kept, true)).state).toBe("unknown");
    expect(routed).toContain("submit:p-c");
    // Removing the target itself stops the next batch before anything is sent.
    const stale = create();
    setBindings("p-b", "v-a");
    routed.length = 0;
    await expect(batches.operate(admin, project!, stale, true)).rejects.toThrow(/generation_binding_changed/);
    expect(routed).not.toContain("submit:p-c");
  });
});
