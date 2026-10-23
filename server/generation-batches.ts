import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AuthError } from "./auth";
import type { Session, ServerConfig } from "./contracts";
import { CollaborationService } from "./collaboration";
import { OwnerReaders } from "./owners";
import { collaborationBatches as batches } from "./db/schema";
import type { GenerationBatch, GenerationBatchItem } from "../src/shared/collaboration";

const digest = (v: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(v)).digest("hex");
const validDigest = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const reference = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\x00-\x1f]/.test(v);

/** Delegates execution to owners. Holds only immutable refs, cost holds and observations. */
export class GenerationBatches {
  constructor(private collaboration: CollaborationService, private owners: OwnerReaders, private config: ServerConfig) {}
  async prepare(session: Session, projectID: string, input: Record<string, unknown>, key: string): Promise<GenerationBatchItem[]> {
    const project = this.collaboration.project(session, projectID, "creator");
    const scope = this.collaboration.scope(session, projectID);
    if (input.owner !== "eikona") throw new AuthError("video_fixed_input_and_known_quote_contract_required", 422);
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 50) throw new AuthError("invalid_generation_input", 400);
    const result: GenerationBatchItem[] = [];
    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i] as Record<string, unknown>;
      const allowed = ["id", "prompt", "prompt_ref", "model_ref", "size", "aspect", "candidate_count", "references", "folder_id"];
      if (!row || typeof row !== "object" || Object.keys(row).some((k) => !allowed.includes(k)) || !reference(row.id) || !reference(row.model_ref) || !Number.isInteger(row.candidate_count) || Number(row.candidate_count) < 1 || Number(row.candidate_count) > 16) throw new AuthError("invalid_generation_input", 400);
      if (row.folder_id && !this.collaboration.folders(session, projectID).some((f) => f.id === row.folder_id)) throw new AuthError("folder_not_found", 404);
      if ((row.prompt && (typeof row.prompt !== "string" || row.prompt.length > 10_000)) || (!row.prompt && !reference(row.prompt_ref))) throw new AuthError("invalid_generation_input", 400);
      const { folder_id: _folder, ...ownerInput } = row;
      const receipt = await this.owners.imageBatch("input", session, scope, { items: [ownerInput] }, `${key}_${i}`);
      if (receipt.schema_version !== "eikona.browser_batch_input.v1" || !reference(receipt.request_batch_ref) || !validDigest(receipt.request_batch_digest) || receipt.request_count !== 1 || receipt.candidate_count !== row.candidate_count) throw new AuthError("generation_input_contract_mismatch", 422);
      const [planned] = await this.verify(session, projectID, [{ id: String(row.id), owner: "eikona", modality: "image", model_ref: String(row.model_ref), candidate_count: Number(row.candidate_count), folder_id: typeof row.folder_id === "string" ? row.folder_id : null, input_ref: receipt.request_batch_ref, input_digest: receipt.request_batch_digest, plan_digest: "", currency: project.currency, estimated_cost: null, state: "planned" }], false);
      result.push(planned);
    }
    return result;
  }
  async verify(session: Session, projectID: string, values: unknown, fixed = true): Promise<GenerationBatchItem[]> {
    const p = this.collaboration.project(session, projectID, "creator");
    const scope = this.collaboration.scope(session, projectID);
    if (!Array.isArray(values) || !values.length || values.length > 50) throw new AuthError("invalid_generation_batch", 400);
    const ids = new Set<string>(); const result: GenerationBatchItem[] = [];
    for (const raw of values) {
      if (!raw || typeof raw !== "object" || !reference(raw.id) || ids.has(raw.id) || !reference(raw.input_ref) || !validDigest(raw.input_digest) || !reference(raw.model_ref) || !Number.isInteger(raw.candidate_count) || raw.candidate_count < 1 || raw.candidate_count > 16) throw new AuthError("invalid_generation_item", 400);
      ids.add(raw.id);
      if (raw.owner !== "eikona" || raw.modality !== "image") throw new AuthError("video_fixed_input_and_known_quote_contract_required", 422);
      const query = { request_batch_ref: raw.input_ref, request_batch_digest: raw.input_digest };
      const snapshot = await this.owners.imageBatch("snapshot", session, scope, query);
      const plan = await this.owners.imageBatch("plan", session, scope, query);
      if (snapshot.schema_version !== "eikona.batch_input_preview.v1" || snapshot.request_batch_ref !== raw.input_ref || snapshot.request_batch_digest !== raw.input_digest || snapshot.request_count !== 1 || snapshot.candidate_count !== raw.candidate_count || snapshot.execution_authorized !== false || plan.schema_version !== "eikona.batch_plan_preview.v1" || plan.request_batch_ref !== raw.input_ref || plan.request_batch_digest !== raw.input_digest || !validDigest(plan.plan_digest) || plan.execution_authorized !== false || !["ready", "blocked"].includes(plan.status) || !Array.isArray(plan.blockers)) throw new AuthError("generation_plan_contract_mismatch", 422);
      if (fixed && raw.plan_digest !== plan.plan_digest) throw new AuthError("generation_plan_changed", 409);
      const amount = plan.cost_estimate_known === true && typeof plan.estimated_usd_upper === "number" && Number.isFinite(plan.estimated_usd_upper) && plan.estimated_usd_upper >= 0 ? plan.estimated_usd_upper : null;
      const reason = plan.status !== "ready" ? plan.blockers.map((b: { code?: string }) => b.code || "owner_blocked").join(",").slice(0, 300) : amount === null ? "generation_cost_unknown" : p.currency !== "USD" ? "generation_budget_currency_mismatch" : undefined;
      result.push({ id: raw.id, owner: "eikona", modality: "image", model_ref: raw.model_ref, candidate_count: raw.candidate_count, folder_id: raw.folder_id || null, input_ref: raw.input_ref, input_digest: raw.input_digest, plan_digest: plan.plan_digest, estimated_cost: amount, currency: "USD", state: reason ? "blocked" : "planned", ...(reason ? { reason } : {}), binding_digest: digest(p.bindings) } as GenerationBatchItem);
    }
    return result;
  }
  private save(batch: GenerationBatch, changes: Partial<GenerationBatch>) {
    const next = { ...batch, ...changes, revision: batch.revision + 1, updated_at: new Date().toISOString() };
    const changed = this.collaboration.db.update(batches).set({ state: next.state, revision: next.revision, items: JSON.stringify(next.items), updatedAt: next.updated_at }).where(and(eq(batches.id, batch.id), eq(batches.revision, batch.revision))).run();
    if (!changed.changes) throw new AuthError("generation_batch_conflict", 409);
    return next;
  }
  /** Owner member reads only: no submit, retry, resume, repair or Provider poll. */
  async observe(session: Session, projectID: string): Promise<GenerationBatch[]> {
    this.collaboration.project(session, projectID);
    const scope = this.collaboration.scope(session, projectID);
    const observed: GenerationBatch[] = [];
    for (const original of this.collaboration.batches(session, projectID)) {
      let batch = original;
      const values: GenerationBatchItem[] = [];
      for (const item of batch.items) {
        if (!item.operation_ref || !["queued", "running", "submitting", "unknown", "partial"].includes(item.state)) { values.push(item); continue; }
        try {
          const page = await this.owners.imageBatch("members", session, scope, { operation_ref: item.operation_ref, offset: 0, limit: 100 });
          if (page.schema_version !== "eikona.batch_member_page.v1" || page.operation_ref !== item.operation_ref || page.request_batch_ref !== item.input_ref || page.request_batch_digest !== item.input_digest || page.plan_digest !== item.plan_digest || !Array.isArray(page.items) || !["planned", "blocked", "queued", "running", "partial", "succeeded", "failed", "cancelled", "cancelling"].includes(page.status)) throw new AuthError("generation_members_contract_mismatch", 422);
          values.push({ ...item, state: page.status, reason: undefined, task_refs: page.items.flatMap((v: { run_ref?: unknown }) => reference(v.run_ref) ? [v.run_ref] : []) });
        } catch { values.push(item); }
      }
      if (JSON.stringify(values) !== JSON.stringify(batch.items)) {
        this.collaboration.project(session, projectID);
        const states = values.map((v) => v.state);
        const state = states.every((v) => v === "succeeded") ? "succeeded" : states.includes("unknown") || states.includes("submitting") ? "unknown" : states.some((v) => ["queued", "running", "cancelling"].includes(v)) ? "running" : states.includes("succeeded") || states.includes("partial") ? "partial" : states.every((v) => ["failed", "cancelled", "blocked"].includes(v)) ? "failed" : batch.state;
        try { batch = this.save(batch, { state, items: values }); } catch { batch = this.collaboration.batches(session, projectID).find((v) => v.id === batch.id) || batch; }
      }
      observed.push(batch);
    }
    return observed;
  }
  async operate(session: Session, projectID: string, batchID: string, submit: boolean): Promise<GenerationBatch> {
    let p = this.collaboration.project(session, projectID, "creator");
    let batch = this.collaboration.batches(session, projectID).find((b) => b.id === batchID);
    if (!batch) throw new AuthError("generation_batch_not_found", 404);
    if (submit) {
      if (batch.state !== "planned") throw new AuthError("generation_original_operation_requires_reconcile", 409);
      const verified = await this.verify(session, projectID, batch.items);
      if (verified.some((v) => v.state === "blocked" || v.estimated_cost === null)) throw new AuthError("generation_plan_blocked", 409);
      // Permissions and policy are re-read after the owner observations complete.
      p = this.collaboration.project(session, projectID, "creator");
      if (!p.generation_enabled || verified.some((v) => v.currency !== p.currency || !this.config.providers?.[v.owner]?.enabled)) throw new AuthError("project_generation_disabled", 403);
      if (batch.items.some((v) => v.binding_digest !== digest(p.bindings))) throw new AuthError("generation_binding_changed", 409);
      const total = verified.reduce((n, v) => n + v.estimated_cost!, 0);
      this.collaboration.db.transaction(() => {
        const reserved = this.collaboration.batches(session, projectID).filter((b) => b.id !== batch!.id && !["planned", "blocked"].includes(b.state)).reduce((n, b) => n + (b.total_cost || 0), 0);
        if (reserved + total > p.budget_cap) throw new AuthError("project_budget_exceeded", 409);
        batch = this.save(batch!, { state: "submitting", items: verified });
      });
    }
    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      if (submit ? item.state !== "planned" : !["submitting", "unknown", "queued", "running", "partial"].includes(item.state)) continue;
      this.collaboration.project(session, projectID, "creator");
      if (item.binding_digest !== digest(this.collaboration.project(session, projectID).bindings)) throw new AuthError("generation_binding_changed", 409);
      const key = `${batch.idempotency_key}_${i}`;
      if (submit) { batch = this.save(batch, { items: batch.items.map((v, n) => n === i ? { ...v, state: "submitting" } : v) }); }
      let observed: GenerationBatchItem;
      try {
        const scope = this.collaboration.scope(session, projectID);
        const op = await this.owners.imageBatch(submit ? "submit" : "reconcile", session, scope, submit ? { request_batch_ref: item.input_ref, request_batch_digest: item.input_digest, plan_digest: item.plan_digest, confirm: true, allow_unknown_cost: false } : {}, key);
        if (op.schema_version !== "eikona.batch_operation_preview.v1" || !reference(op.operation_ref) || op.request_batch_ref !== item.input_ref || op.request_batch_digest !== item.input_digest || op.plan_digest !== item.plan_digest || !["planned", "blocked", "queued", "running", "cancelling", "partial", "succeeded", "failed", "cancelled"].includes(op.status)) throw new AuthError("generation_operation_contract_mismatch", 422);
        const members = await this.owners.imageBatch("members", session, scope, { operation_ref: op.operation_ref, offset: 0, limit: 100 });
        if (members.schema_version !== "eikona.batch_member_page.v1" || members.operation_ref !== op.operation_ref || members.request_batch_ref !== item.input_ref || !Array.isArray(members.items)) throw new AuthError("generation_members_contract_mismatch", 422);
        observed = { ...item, state: op.status, operation_ref: op.operation_ref, reason: undefined, task_refs: members.items.flatMap((m: { run_ref?: unknown }) => reference(m.run_ref) ? [m.run_ref] : []) };
      } catch (e) { observed = { ...item, state: "unknown", reason: e instanceof AuthError ? e.code : "generation_submission_unknown" }; }
      batch = this.save(batch, { items: batch.items.map((v, n) => n === i ? observed : v) });
    }
    const states = batch.items.map((v) => v.state);
    const state = states.every((v) => v === "succeeded") ? "succeeded" : states.includes("unknown") || states.includes("submitting") ? "unknown" : states.some((v) => ["queued", "running", "cancelling"].includes(v)) ? "running" : states.includes("succeeded") || states.includes("partial") ? "partial" : states.every((v) => ["failed", "cancelled", "blocked"].includes(v)) ? "failed" : batch.state;
    return this.save(batch, { state });
  }
}
