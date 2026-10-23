import { describe, expect, it } from "vitest";
import { createMemoryDB } from "../server/db/client";
import { SessionAuth } from "../server/auth";
import { CollaborationService } from "../server/collaboration";
import { OwnerReaders } from "../server/owners";
import { GenerationBatches } from "../server/generation-batches";
import type { ServerConfig, Session } from "../server/contracts";
import type { GenerationBatchItem } from "../src/shared/collaboration";
const hash = "sha256:" + "a".repeat(64);
function fixture() {
  const config: ServerConfig = { origin: "http://127.0.0.1:4377", port: 4377, owners: {}, providers: { eikona: { owner: "eikona", endpoint: "http://127.0.0.1:1/mcp", enabled: true } }, principals: [{ issuer: "test", subject: "admin", name: "Admin", role: "admin", scopes: [{ id: "A", tenant: "A", project: "A", team: "", label: "A", owners: { eikona: { tenant: "A", project: "owner-project", actor: "admin", audience: "eikona" } } }] }] };
  const session: Session = { id: "admin", issuer: "test", subject: "admin", name: "Admin", csrf: "csrf", epoch: 1, accessToken: "", accessAudience: [], expires: Date.now() + 60000 };
  const db = createMemoryDB(), auth = new SessionAuth(config), collaboration = new CollaborationService(db, config, auth);
  const [org] = collaboration.execute(session, "organization.create", "new", "0", { name: "Studio", source_scope: "A" });
  const [project] = collaboration.execute(session, "project.create", org, "0", { name: "Project" });
  collaboration.execute(session, "project.bindings.set", project, "1", { bindings: collaboration.bindingOptions(session, org) });
  collaboration.execute(session, "project.update", project, "2", { generation_enabled: true, budget_cap: 1, currency: "USD" });
  let posts = 0, unknown = false, cost: number | null = .4, ownerState = "succeeded";
  const reader = new OwnerReaders(config);
  reader.imageBatch = async (operation, _s, _scope, body) => {
    if (operation === "snapshot") return { schema_version: "eikona.batch_input_preview.v1", request_batch_ref: body.request_batch_ref, request_batch_digest: hash, request_count: 1, candidate_count: 2, execution_authorized: false };
    if (operation === "plan") return { schema_version: "eikona.batch_plan_preview.v1", request_batch_ref: body.request_batch_ref, request_batch_digest: hash, plan_digest: hash, execution_authorized: false, status: "ready", blockers: [], cost_estimate_known: cost !== null, estimated_usd_upper: cost };
    if (operation === "submit") { posts++; if (unknown) throw new Error("disconnected"); }
    if (operation === "submit" || operation === "reconcile") return { schema_version: "eikona.batch_operation_preview.v1", operation_ref: "eikona-batch:original", request_batch_ref: "input:original", request_batch_digest: hash, plan_digest: hash, status: ownerState };
    if (operation === "members") return { schema_version: "eikona.batch_member_page.v1", status: ownerState, request_batch_digest: hash, plan_digest: hash, operation_ref: "eikona-batch:original", request_batch_ref: "input:original", items: ownerState === "succeeded" ? [{ request_id: "row1", run_ref: "run_original" }] : [] };
    throw Error("unexpected owner operation");
  };
  const service = new GenerationBatches(collaboration, reader, config);
  const raw: GenerationBatchItem = { id: "row1", owner: "eikona", modality: "image", model_ref: "openai/gpt-image-2.5-sunburst", candidate_count: 2, folder_id: null, input_ref: "input:original", input_digest: hash, plan_digest: hash, estimated_cost: 0, currency: "USD", state: "planned" };
  const create = async () => { const items = await service.verify(session, project, [raw]); const [batch] = collaboration.execute(session, "generation.batch.create", project, "3", { name: "Candidates", items, idempotency_key: crypto.randomUUID() }); return batch; };
  return { service, reader, config, session, collaboration, project, create, raw, posts: () => posts, setUnknown: (v: boolean) => { unknown = v; }, setCost: (v: number | null) => { cost = v; }, setOwnerState: (v: string) => { ownerState = v; } };
}
describe("fixed owner generation batches", () => {
  it("observes completion without submitting and groups each stable artifact once", async () => {
    const f = fixture();
    const [folder] = f.collaboration.execute(f.session, "folder.create", f.project, "3", { name: "Candidates" }); f.raw.folder_id = folder;
    const batch = await f.create(); f.setOwnerState("queued");
    await f.service.operate(f.session, f.project, batch, true);
    f.setOwnerState("succeeded"); const observed = await f.service.observe(f.session, f.project);
    expect(observed[0].state).toBe("succeeded"); expect(f.posts()).toBe(1);
    const task = { task_key: "task-original", connection_id: "connection", locator: { owner: "eikona", instance_id: "fixture", project: "owner-project", task_family: "run", task_ref: "run_original" }, results: [{ ref: "artifact-0", name: "result.png", mime: "image/png", state: "candidate", version: hash }], revision: "1", created_at: new Date().toISOString() } as unknown as import("../src/task-observation").TaskSnapshot;
    f.collaboration.syncItems(f.session, f.project, [task]); f.collaboration.syncItems(f.session, f.project, [{ ...task, revision: "2" }]);
    const items = f.collaboration.items(f.session, f.project, {});
    expect(items.total).toBe(1); expect(items.rows[0]).toMatchObject({ folder_id: folder, batch_ref: batch, revision: "2" });
  });
  it("uses the owner's estimate and preserves the original operation across restart", async () => {
    const f = fixture(); const batch = await f.create();
    expect(f.collaboration.batches(f.session, f.project)[0].total_cost).toBe(.4);
    f.setUnknown(true);
    const uncertain = await f.service.operate(f.session, f.project, batch, true);
    expect(uncertain.state).toBe("unknown"); expect(f.posts()).toBe(1);
    await expect(f.service.operate(f.session, f.project, batch, true)).rejects.toThrow(/reconcile/);
    const restarted = new GenerationBatches(f.collaboration, f.reader, f.config);
    const reconciled = await restarted.operate(f.session, f.project, batch, false);
    expect(reconciled.state).toBe("succeeded"); expect(reconciled.items[0].task_refs).toEqual(["run_original"]); expect(f.posts()).toBe(1);
  });
  it("blocks unknown prices, over-budget aggregate reservations and changed plans", async () => {
    const f = fixture(); f.setCost(null); const unknown = await f.create();
    await expect(f.service.operate(f.session, f.project, unknown, true)).rejects.toThrow(/plan_blocked/); expect(f.posts()).toBe(0);
    f.setCost(.6); const a = await f.create(); const b = await f.create();
    await f.service.operate(f.session, f.project, a, true);
    await expect(f.service.operate(f.session, f.project, b, true)).rejects.toThrow(/budget_exceeded/); expect(f.posts()).toBe(1);
    await expect(f.service.verify(f.session, f.project, [{ ...f.raw, plan_digest: "sha256:" + "b".repeat(64) }])).rejects.toThrow(/plan_changed/);
  });
  it("does not invent a known-price video contract", async () => {
    const f = fixture(); await expect(f.service.prepare(f.session, f.project, { owner: "scaena", rows: [] }, "original-key")).rejects.toThrow(/known_quote_contract/); expect(f.posts()).toBe(0);
  });
});
