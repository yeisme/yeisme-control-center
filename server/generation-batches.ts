import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AuthError } from "./auth";
import type { Session, ServerConfig } from "./contracts";
import { CollaborationService, targetBinding } from "./collaboration";
import { OwnerReaders } from "./owners";
import { collaborationBatches as batches } from "./db/schema";
import { normalizePromptObservation, type PromptCaptureObservation } from "../src/observation-contract";
import type { GenerationBatch, GenerationBatchItem, GenerationBatchSource } from "../src/shared/collaboration";

const digest = (v: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(v)).digest("hex");
const validDigest = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const reference = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\x00-\x1f]/.test(v);
const captureKey = (projectID: string, inputRef: string) => `${projectID}\u0000${inputRef}`;
/** An item stays valid while its own target binding is unchanged; other bindings may come and go. */
const bindingDigest = (binding: { owner: string; project_ref: string; source_scope: string }) => digest({ owner: binding.owner, project_ref: binding.project_ref, source_scope: binding.source_scope });
const bindingUnchanged = (project: Parameters<typeof targetBinding>[0], item: GenerationBatchItem) => {
  const target = targetBinding(project, item);
  // Items planned before per-item targets hashed every binding of the project.
  return !!target && (item.binding_digest === bindingDigest(target) || item.binding_digest === digest(project.bindings));
};

/** Batch states a list may filter on, as stored or as observed from the owner. */
export const batchStates = ["planned", "blocked", "submitting", "queued", "running", "cancelling", "partial", "succeeded", "failed", "cancelled", "unknown"] as const;
export const batchOwners = ["eikona", "scaena"] as const;
const observedStates = ["queued", "running", "submitting", "unknown", "partial"];
const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export interface BatchQuery { q?: string; states?: string[]; owners?: string[]; from?: string; to?: string; limit: number }
/** Where the previous page stopped, in `created_at DESC, id DESC` order. */
export interface BatchPosition { created_at: string; id: string }

/** Filters for a project's batch list: unknown values are refused rather than ignored, so a typo cannot widen a list. */
export function parseBatchQuery(params: URLSearchParams): BatchQuery {
  const list = (key: string, allowed: readonly string[]) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return undefined;
    const values = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
    if (!values.length || values.some((value) => !allowed.includes(value))) throw new AuthError("invalid_query", 400);
    return values;
  };
  const time = (key: string) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return undefined;
    if (!rfc3339.test(raw) || Number.isNaN(Date.parse(raw))) throw new AuthError("invalid_query", 400);
    return new Date(raw).toISOString();
  };
  const q = (params.get("q") || "").trim();
  if (q.length > 200) throw new AuthError("invalid_query", 400);
  const from = time("from"), to = time("to");
  if (from && to && from >= to) throw new AuthError("invalid_query", 400);
  const rawLimit = params.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AuthError("invalid_query", 400);
  return { ...(q ? { q } : {}), ...(list("state", batchStates) ? { states: list("state", batchStates) } : {}), ...(list("owner", batchOwners) ? { owners: list("owner", batchOwners) } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), limit };
}

export type BatchSource = GenerationBatchSource;
type ItemRead = { item: GenerationBatchItem; source: BatchSource };
/** Owner reads one list or detail request may make, and how many of them run at once. */
export const observeBudget = 24, observeParallel = 4;
const isLive = (item: GenerationBatchItem) => !!item.operation_ref && observedStates.includes(item.state);
/** A failed owner read, in the task page's connection states. */
const readFailure = (error: unknown): Pick<BatchSource, "state" | "reason"> => ({
  state: error instanceof AuthError && error.status === 403 ? "forbidden" : error instanceof AuthError && error.code.includes("contract") ? "needs_contract" : "source_unavailable",
  reason: error instanceof AuthError ? error.code : "owner_unavailable",
});
/** A failed read outranks items left for a later poll, which outrank a successful read. */
const severity = (state: BatchSource["state"]) => state === "ready" ? 0 : state === "not_checked" ? 1 : 2;

/** Delegates execution to owners. Holds only immutable refs, cost holds and observations. */
export class GenerationBatches {
  private promptCaptures = new Map<string, PromptCaptureObservation>();
  /** Item reads in flight, so a list poll and a detail poll of the same batch share one owner read. */
  private inflight = new Map<string, Promise<ItemRead>>();
  /** When each live item was last read, so a page with more live items than one request may read reaches them all over successive polls. */
  private lastRead = new Map<string, number>();
  constructor(private collaboration: CollaborationService, private owners: OwnerReaders, private config: ServerConfig) {}
  async prepare(session: Session, projectID: string, input: Record<string, unknown>, key: string): Promise<GenerationBatchItem[]> {
    const project = this.collaboration.project(session, projectID, "creator");
    const scope = this.collaboration.scope(session, projectID);
    if (input.owner !== "eikona") throw new AuthError("video_fixed_input_and_known_quote_contract_required", 422);
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 50) throw new AuthError("invalid_generation_input", 400);
    const result: GenerationBatchItem[] = [];
    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i] as Record<string, unknown>;
      const allowed = ["id", "prompt", "prompt_ref", "model_ref", "size", "aspect", "candidate_count", "references", "folder_id", "project_ref"];
      if (!row || typeof row !== "object" || Object.keys(row).some((k) => !allowed.includes(k)) || !reference(row.id) || !reference(row.model_ref) || !Number.isInteger(row.candidate_count) || Number(row.candidate_count) < 1 || Number(row.candidate_count) > 16) throw new AuthError("invalid_generation_input", 400);
      if (row.folder_id && !this.collaboration.folders(session, projectID).some((f) => f.id === row.folder_id)) throw new AuthError("folder_not_found", 404);
      if ((row.prompt && (typeof row.prompt !== "string" || row.prompt.length > 10_000)) || (!row.prompt && !reference(row.prompt_ref))) throw new AuthError("invalid_generation_input", 400);
      const { folder_id: _folder, project_ref: _project, ...ownerInput } = row;
      const target = targetBinding(project, { owner: "eikona", project_ref: typeof row.project_ref === "string" ? row.project_ref : undefined });
      if (!target) throw typeof row.project_ref === "string" ? new AuthError("generation_binding_changed", 409) : new AuthError("generation_target_project_required", 400);
      const receipt = await this.owners.imageBatch("input", session, scope, { items: [ownerInput] }, `${key}_${i}`, target.project_ref);
      if (receipt.schema_version !== "eikona.browser_batch_input.v1" || !reference(receipt.request_batch_ref) || !validDigest(receipt.request_batch_digest) || receipt.request_count !== 1 || receipt.candidate_count !== row.candidate_count) throw new AuthError("generation_input_contract_mismatch", 422);
      const promptCapture = normalizePromptObservation(receipt.prompt_capture);
      if (promptCapture) this.promptCaptures.set(captureKey(projectID, receipt.request_batch_ref), promptCapture);
      const [planned] = await this.verify(session, projectID, [{ id: String(row.id), owner: "eikona", modality: "image", model_ref: String(row.model_ref), candidate_count: Number(row.candidate_count), folder_id: typeof row.folder_id === "string" ? row.folder_id : null, input_ref: receipt.request_batch_ref, input_digest: receipt.request_batch_digest, plan_digest: "", currency: project.currency, estimated_cost: null, state: "planned", project_ref: target.project_ref }], false);
      result.push(planned);
    }
    return result;
  }
  async verify(session: Session, projectID: string, values: unknown, fixed = true, trustedCaptures?: ReadonlyMap<string, PromptCaptureObservation>): Promise<GenerationBatchItem[]> {
    const p = this.collaboration.project(session, projectID, "creator");
    const scope = this.collaboration.scope(session, projectID);
    if (!Array.isArray(values) || !values.length || values.length > 50) throw new AuthError("invalid_generation_batch", 400);
    const ids = new Set<string>(); const result: GenerationBatchItem[] = [];
    for (const raw of values) {
      if (!raw || typeof raw !== "object" || !reference(raw.id) || ids.has(raw.id) || !reference(raw.input_ref) || !validDigest(raw.input_digest) || !reference(raw.model_ref) || !Number.isInteger(raw.candidate_count) || raw.candidate_count < 1 || raw.candidate_count > 16) throw new AuthError("invalid_generation_item", 400);
      ids.add(raw.id);
      if (raw.owner !== "eikona" || raw.modality !== "image") throw new AuthError("video_fixed_input_and_known_quote_contract_required", 422);
      const target = targetBinding(p, { owner: "eikona", project_ref: typeof raw.project_ref === "string" ? raw.project_ref : undefined });
      // A named target that is no longer bound means the bindings changed since it was picked.
      if (!target) throw typeof raw.project_ref === "string" ? new AuthError("generation_binding_changed", 409) : new AuthError("generation_target_project_required", 400);
      const query = { request_batch_ref: raw.input_ref, request_batch_digest: raw.input_digest };
      const snapshot = await this.owners.imageBatch("snapshot", session, scope, query, undefined, target.project_ref);
      const plan = await this.owners.imageBatch("plan", session, scope, query, undefined, target.project_ref);
      if (snapshot.schema_version !== "eikona.batch_input_preview.v1" || snapshot.request_batch_ref !== raw.input_ref || snapshot.request_batch_digest !== raw.input_digest || snapshot.request_count !== 1 || snapshot.candidate_count !== raw.candidate_count || snapshot.execution_authorized !== false || plan.schema_version !== "eikona.batch_plan_preview.v1" || plan.request_batch_ref !== raw.input_ref || plan.request_batch_digest !== raw.input_digest || !validDigest(plan.plan_digest) || plan.execution_authorized !== false || !["ready", "blocked"].includes(plan.status) || !Array.isArray(plan.blockers)) throw new AuthError("generation_plan_contract_mismatch", 422);
      if (fixed && raw.plan_digest !== plan.plan_digest) throw new AuthError("generation_plan_changed", 409);
      const amount = plan.cost_estimate_known === true && typeof plan.estimated_usd_upper === "number" && Number.isFinite(plan.estimated_usd_upper) && plan.estimated_usd_upper >= 0 ? plan.estimated_usd_upper : null;
      const reason = plan.status !== "ready" ? plan.blockers.map((b: { code?: string }) => b.code || "owner_blocked").join(",").slice(0, 300) : amount === null ? "generation_cost_unknown" : p.currency !== "USD" ? "generation_budget_currency_mismatch" : undefined;
      const key = captureKey(projectID, raw.input_ref);
      const promptCapture = normalizePromptObservation(snapshot.prompt_capture) || normalizePromptObservation(plan.prompt_capture) || trustedCaptures?.get(key) || this.promptCaptures.get(key);
      if (promptCapture) this.promptCaptures.set(key, promptCapture);
      result.push({ id: raw.id, owner: "eikona", modality: "image", model_ref: raw.model_ref, candidate_count: raw.candidate_count, folder_id: raw.folder_id || null, input_ref: raw.input_ref, input_digest: raw.input_digest, plan_digest: plan.plan_digest, estimated_cost: amount, currency: "USD", state: reason ? "blocked" : "planned", ...(reason ? { reason } : {}), project_ref: target.project_ref, binding_digest: bindingDigest(target), ...(promptCapture ? { prompt_capture: promptCapture } : {}) } as GenerationBatchItem);
    }
    return result;
  }
  private save(batch: GenerationBatch, changes: Partial<GenerationBatch>) {
    const next = { ...batch, ...changes, revision: batch.revision + 1, updated_at: new Date().toISOString() };
    const changed = this.collaboration.db.update(batches).set({ state: next.state, revision: next.revision, items: JSON.stringify(next.items), updatedAt: next.updated_at }).where(and(eq(batches.id, batch.id), eq(batches.revision, batch.revision))).run();
    if (!changed.changes) throw new AuthError("generation_batch_conflict", 409);
    return next;
  }
  /**
   * Owner member reads only: no submit, retry, resume, repair or Provider poll. Re-reads the given batches only (a list
   * its current page, a detail its one batch, never the project's whole history), at most `observeBudget` items per
   * request with `observeParallel` in flight, least recently read first. A failed read keeps the stored state, and so
   * does an item left for a later poll; both are reported in `sources`.
   */
  async observeBatches(session: Session, projectID: string, list: GenerationBatch[]): Promise<{ rows: GenerationBatch[]; sources: BatchSource[] }> {
    const live = list.flatMap((batch) => batch.items.filter(isLive).map((item) => ({ batch, item, key: `${projectID}\u0000${batch.id}\u0000${item.id}` })));
    if (!live.length) return { rows: list, sources: [] };
    // Stable sort: items never read keep page order.
    live.sort((a, b) => (this.lastRead.get(a.key) ?? 0) - (this.lastRead.get(b.key) ?? 0));
    const chosen = live.slice(0, observeBudget);
    const scope = this.collaboration.scope(session, projectID);
    const reads = new Map<string, ItemRead>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(observeParallel, chosen.length) }, async () => {
      while (next < chosen.length) {
        const { batch, item, key } = chosen[next++];
        reads.set(key, await this.readItem(session, scope, projectID, batch, item, key));
      }
    }));
    const sources = new Map<string, BatchSource>();
    const note = (source: BatchSource) => {
      const id = `${source.owner}\u0000${source.project_ref || ""}`;
      const seen = sources.get(id);
      if (!seen || severity(source.state) > severity(seen.state)) sources.set(id, source);
    };
    for (const read of reads.values()) note(read.source);
    for (const { batch, item, key } of live.slice(observeBudget)) {
      // Not read this time: the stored state stands, as of its last read.
      const last = this.lastRead.get(key);
      note({ owner: item.owner, project_ref: item.project_ref || null, state: "not_checked", observed_at: last ? new Date(last).toISOString() : batch.updated_at, reason: "observation_deferred" });
    }
    return { rows: list.map((batch) => this.fold(session, projectID, batch, reads)), sources: [...sources.values()] };
  }

  private readItem(session: Session, scope: ReturnType<CollaborationService["scope"]>, projectID: string, batch: GenerationBatch, item: GenerationBatchItem, readKey: string): Promise<ItemRead> {
    const key = [session.issuer, session.subject, projectID, batch.id, batch.revision, item.id].join("\u0000");
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.readMembers(session, scope, item).finally(() => {
        this.inflight.delete(key);
        this.lastRead.delete(readKey);
        this.lastRead.set(readKey, Date.now());
        // Oldest first out: an item that is no longer live never needs its place in the rotation again.
        if (this.lastRead.size > 10_000) this.lastRead.delete(this.lastRead.keys().next().value!);
      });
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async readMembers(session: Session, scope: ReturnType<CollaborationService["scope"]>, item: GenerationBatchItem): Promise<ItemRead> {
    const source = { owner: item.owner, project_ref: item.project_ref || null };
    try {
      const page = await this.owners.imageBatch("members", session, scope, { operation_ref: item.operation_ref, offset: 0, limit: 100 }, undefined, item.project_ref);
      if (page.schema_version !== "eikona.batch_member_page.v1" || page.operation_ref !== item.operation_ref || page.request_batch_ref !== item.input_ref || page.request_batch_digest !== item.input_digest || page.plan_digest !== item.plan_digest || !Array.isArray(page.items) || !["planned", "blocked", "queued", "running", "partial", "succeeded", "failed", "cancelled", "cancelling"].includes(page.status)) throw new AuthError("generation_members_contract_mismatch", 422);
      return { item: { ...item, state: page.status, reason: undefined, task_refs: page.items.flatMap((v: { run_ref?: unknown }) => reference(v.run_ref) ? [v.run_ref] : []) }, source: { ...source, state: "ready", observed_at: new Date().toISOString() } };
    } catch (error) {
      return { item, source: { ...source, ...readFailure(error), observed_at: new Date().toISOString() } };
    }
  }

  /** Applies this request's reads to one batch and saves it when an item changed; when another request saved first, its result stands. */
  private fold(session: Session, projectID: string, batch: GenerationBatch, reads: Map<string, ItemRead>): GenerationBatch {
    const values = batch.items.map((item) => reads.get(`${projectID}\u0000${batch.id}\u0000${item.id}`)?.item ?? item);
    if (JSON.stringify(values) === JSON.stringify(batch.items)) return batch;
    this.collaboration.project(session, projectID);
    const states = values.map((v) => v.state);
    const state = states.every((v) => v === "succeeded") ? "succeeded" : states.includes("unknown") || states.includes("submitting") ? "unknown" : states.some((v) => ["queued", "running", "cancelling"].includes(v)) ? "running" : states.includes("succeeded") || states.includes("partial") ? "partial" : states.every((v) => ["failed", "cancelled", "blocked"].includes(v)) ? "failed" : batch.state;
    try { return this.save(batch, { state, items: values }); } catch { return this.collaboration.batch(session, projectID, batch.id) || batch; }
  }
  async operate(session: Session, projectID: string, batchID: string, submit: boolean): Promise<GenerationBatch> {
    let p = this.collaboration.project(session, projectID, "creator");
    let batch = this.collaboration.batches(session, projectID).find((b) => b.id === batchID);
    if (!batch) throw new AuthError("generation_batch_not_found", 404);
    if (submit) {
      if (batch.state !== "planned") throw new AuthError("generation_original_operation_requires_reconcile", 409);
      const trustedCaptures = new Map(batch.items.flatMap((item) => item.prompt_capture ? [[captureKey(projectID, item.input_ref), item.prompt_capture] as const] : []));
      const verified = await this.verify(session, projectID, batch.items, true, trustedCaptures);
      if (verified.some((v) => v.state === "blocked" || v.estimated_cost === null)) throw new AuthError("generation_plan_blocked", 409);
      // Permissions and policy are re-read after the owner observations complete.
      p = this.collaboration.project(session, projectID, "creator");
      if (!p.generation_enabled || verified.some((v) => v.currency !== p.currency || !this.config.providers?.[v.owner]?.enabled)) throw new AuthError("project_generation_disabled", 403);
      if (batch.items.some((v) => !bindingUnchanged(p, v))) throw new AuthError("generation_binding_changed", 409);
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
      if (!bindingUnchanged(this.collaboration.project(session, projectID), item)) throw new AuthError("generation_binding_changed", 409);
      const key = `${batch.idempotency_key}_${i}`;
      if (submit) { batch = this.save(batch, { items: batch.items.map((v, n) => n === i ? { ...v, state: "submitting" } : v) }); }
      let observed: GenerationBatchItem;
      try {
        const scope = this.collaboration.scope(session, projectID);
        const op = await this.owners.imageBatch(submit ? "submit" : "reconcile", session, scope, submit ? { request_batch_ref: item.input_ref, request_batch_digest: item.input_digest, plan_digest: item.plan_digest, confirm: true, allow_unknown_cost: false } : {}, key, item.project_ref);
        if (op.schema_version !== "eikona.batch_operation_preview.v1" || !reference(op.operation_ref) || op.request_batch_ref !== item.input_ref || op.request_batch_digest !== item.input_digest || op.plan_digest !== item.plan_digest || !["planned", "blocked", "queued", "running", "cancelling", "partial", "succeeded", "failed", "cancelled"].includes(op.status)) throw new AuthError("generation_operation_contract_mismatch", 422);
        const members = await this.owners.imageBatch("members", session, scope, { operation_ref: op.operation_ref, offset: 0, limit: 100 }, undefined, item.project_ref);
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
