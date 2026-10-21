import { and, desc, eq, inArray, not, sql } from "drizzle-orm";
import type {
  ProviderRunProjection,
  UsageEventProjection,
} from "../provider-live";
import type { ControlDB } from "./client";
import { idempotencyKeys, providerRuns, usageEvents } from "./schema";

type RunRow = typeof providerRuns.$inferSelect;
type UsageRow = typeof usageEvents.$inferSelect;

const terminalStates = ["succeeded", "failed", "reconciled"];

const stringList = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

const toRun = (r: RunRow): ProviderRunProjection => ({
  run_ref: r.runRef,
  owner: r.owner as ProviderRunProjection["owner"],
  modality: r.modality as ProviderRunProjection["modality"],
  model_ref: r.modelRef,
  scope_id: r.scopeId,
  project_ref: r.projectRef,
  trace_ref: r.traceRef,
  source_ref: r.sourceRef ?? null,
  state: r.state as ProviderRunProjection["state"],
  output_refs: stringList(r.outputRefs),
  upstream_cost: r.upstreamCost ?? null,
  currency: r.currency,
  cost_state: r.costState as ProviderRunProjection["cost_state"],
  observed_at: r.observedAt,
  created_at: r.createdAt,
  evidence_refs: stringList(r.evidenceRefs),
  error_code: r.errorCode ?? null,
  connection_state: r.connectionState as ProviderRunProjection["connection_state"],
});

const toUsage = (r: UsageRow): UsageEventProjection => ({
  source_ref: r.sourceRef,
  trace_ref: r.traceRef,
  owner: r.owner as UsageEventProjection["owner"],
  model_ref: r.modelRef,
  modality: r.modality as UsageEventProjection["modality"],
  quantity: r.quantity ?? null,
  unit: r.unit,
  upstream_cost: r.upstreamCost ?? null,
  currency: r.currency,
  cost_state: r.costState as UsageEventProjection["cost_state"],
  status: r.status as UsageEventProjection["status"],
  project_ref: r.projectRef,
  created_at: r.createdAt,
});

/** Durable storage for provider runs, usage facts, and idempotency keys. */
export class RunStore {
  constructor(private db: ControlDB) {}

  getRun(runRef: string): ProviderRunProjection | null {
    const row = this.db
      .select()
      .from(providerRuns)
      .where(eq(providerRuns.runRef, runRef))
      .get();
    return row ? toRun(row) : null;
  }

  insertRun(run: ProviderRunProjection, budgetReserved: number): void {
    this.db
      .insert(providerRuns)
      .values({
        runRef: run.run_ref,
        owner: run.owner,
        modality: run.modality,
        modelRef: run.model_ref,
        scopeId: run.scope_id,
        projectRef: run.project_ref,
        traceRef: run.trace_ref,
        sourceRef: run.source_ref ?? null,
        state: run.state,
        outputRefs: JSON.stringify(run.output_refs),
        upstreamCost: run.upstream_cost ?? null,
        currency: run.currency,
        costState: run.cost_state,
        observedAt: run.observed_at,
        createdAt: run.created_at,
        evidenceRefs: JSON.stringify(run.evidence_refs),
        errorCode: run.error_code ?? null,
        connectionState: run.connection_state,
        budgetReserved,
      })
      .run();
  }

  /** Updates the projection only; budget reservation stays with the row. */
  updateRun(run: ProviderRunProjection): void {
    this.db
      .update(providerRuns)
      .set({
        sourceRef: run.source_ref ?? null,
        state: run.state,
        outputRefs: JSON.stringify(run.output_refs),
        upstreamCost: run.upstream_cost ?? null,
        currency: run.currency,
        costState: run.cost_state,
        observedAt: run.observed_at,
        evidenceRefs: JSON.stringify(run.evidence_refs),
        errorCode: run.error_code ?? null,
        connectionState: run.connection_state,
      })
      .where(eq(providerRuns.runRef, run.run_ref))
      .run();
  }

  /**
   * Boot recovery: interrupted non-terminal runs become unknown and stay
   * manually reconcilable. Nothing is ever resubmitted automatically.
   */
  markInterrupted(): number {
    const now = new Date().toISOString();
    const rows = this.db
      .select({ runRef: providerRuns.runRef })
      .from(providerRuns)
      .where(not(inArray(providerRuns.state, terminalStates)))
      .all();
    if (!rows.length) return 0;
    this.db
      .update(providerRuns)
      .set({ state: "unknown", errorCode: "server_restarted", observedAt: now })
      .where(not(inArray(providerRuns.state, terminalStates)))
      .run();
    return rows.length;
  }

  /** Reserved budget = non-terminal runs only; terminal runs release theirs. */
  reservedBudget(): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${providerRuns.budgetReserved}), 0)` })
      .from(providerRuns)
      .where(not(inArray(providerRuns.state, terminalStates)))
      .get();
    return Number(row?.total || 0);
  }

  getIdempotency(key: string): string | null {
    const row = this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .get();
    return row?.runRef ?? null;
  }

  putIdempotency(key: string, runRef: string): void {
    this.db
      .insert(idempotencyKeys)
      .values({ key, runRef, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: idempotencyKeys.key,
        set: { runRef },
      })
      .run();
  }

  putUsage(event: UsageEventProjection): void {
    const sourceKey = event.owner + ":" + event.source_ref;
    const row = {
      sourceKey,
      sourceRef: event.source_ref,
      traceRef: event.trace_ref,
      owner: event.owner,
      modelRef: event.model_ref,
      modality: event.modality,
      quantity: event.quantity ?? null,
      unit: event.unit,
      upstreamCost: event.upstream_cost ?? null,
      currency: event.currency,
      costState: event.cost_state,
      status: event.status,
      projectRef: event.project_ref,
      createdAt: event.created_at,
    };
    this.db
      .insert(usageEvents)
      .values(row)
      .onConflictDoUpdate({ target: usageEvents.sourceKey, set: row })
      .run();
  }

  usageRows(projectRef: string): UsageEventProjection[] {
    return this.db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.projectRef, projectRef))
      .orderBy(desc(usageEvents.createdAt))
      .all()
      .map(toUsage);
  }
}

export { terminalStates };
