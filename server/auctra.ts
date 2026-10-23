import { AuthError, boundedJSON, secret } from "./auth";
import type { ScopeBinding, ServerConfig, Session } from "./contracts";
import type { CoverageState } from "../src/request-visibility";

export type AuctraCollectionCoverage = "complete" | "partial" | "needs_contract" | "forbidden" | "unavailable" | "unknown" | "stale";

export interface AuctraCollectionRecord {
  record_ref: string;
  record_kind: string;
  project_ref: string;
  work_ref?: string;
  unit_ref?: string;
  candidate_ref?: string;
  review_ref?: string;
  version_ref?: string;
  run_ref?: string;
  kind?: string;
  title?: string;
  status?: string;
  source_revision?: string;
  source_digest?: string;
  created_at?: string;
  updated_at?: string;
  evidence_refs?: string[];
}

export interface AuctraCollectionSnapshot {
  schema_version: "auctra.collection.snapshot.v1";
  owner: "auctra";
  scope: string;
  project_ref: string;
  observed_at: string;
  coverage: AuctraCollectionCoverage;
  freshness: "fresh" | "stale" | "unknown";
  cursor?: string;
  next_cursor?: string;
  returned: number;
  total: number;
  records: AuctraCollectionRecord[];
  blocker?: string;
}

export interface AuctraCollectionRecordProjection {
  schema_version: "auctra.collection.record.v1";
  owner: "auctra";
  scope: string;
  observed_at: string;
  coverage: AuctraCollectionCoverage;
  record_ref: string;
  record?: AuctraCollectionRecord;
  blocker?: string;
}

export interface AuctraCreativeFlowStage {
  stage: "screenplay" | "director_plan" | "creative_storyboard" | "production_handoff";
  owner: "auctra";
  object_kind: string;
  source_ref: string;
  state: string;
  native_state: string;
  revision?: string;
  digest?: string;
  observed_at: string;
  source_current: boolean;
  episode_ref: string;
  review_refs?: string[];
  blockers?: string[];
  safe_refs: string[];
}

export interface AuctraCreativeFlowSnapshot {
  schema_version: "auctra.creative_flow_source.v1";
  owner: "auctra";
  project_ref: string;
  episode_ref: string;
  observed_at: string;
  coverage: CoverageState;
  stages: AuctraCreativeFlowStage[];
  blocker?: string;
}

type AuctraTarget = NonNullable<NonNullable<ServerConfig["collection"]>["auctra"]>;
type AuctraBinding = NonNullable<NonNullable<ScopeBinding["collection"]>["auctra"]>;

function text(value: unknown, max = 512) { return typeof value === "string" ? value.slice(0, max) : ""; }
function opaque(value: unknown, max = 512) {
  const result = text(value, max);
  return result && !/[\\/\x00-\x1f]/.test(result) ? result : "";
}
function stateFor(error: unknown): AuctraCollectionCoverage {
  const code = error instanceof AuthError ? error.code : "owner_unavailable";
  if (code.includes("contract")) return "needs_contract";
  if (error instanceof AuthError && error.status === 403) return "forbidden";
  return "unavailable";
}
function envelopeData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
}
function redact(value: unknown, key = "", depth = 0): unknown {
  if (depth > 8) return "[depth-limited]";
  const lowered = key.toLowerCase();
  if (/(authorization|token|secret|password|api[_-]?key|provider[_-]?payload|raw[_-]?prompt|body|content)/.test(lowered)) return "[redacted]";
  if (/(^|_)(path|root|file|filename)$/.test(lowered)) return "[redacted-path]";
  if (typeof value === "string") return value.slice(0, 4096);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, key, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 300).map(([childKey, childValue]) => [childKey, redact(childValue, childKey, depth + 1)]));
  return value;
}
/** Blockers are short machine tokens. A non-array or an oversized value must not reach code that iterates them. */
function tokens(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9_.:-]{1,96}$/.test(item)).slice(0, 16) : [];
}
function originOf(value: string) { try { return new URL(value).origin; } catch { return null; } }
function normalizeRecord(value: unknown): AuctraCollectionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const record_ref = opaque(raw.record_ref, 512), record_kind = opaque(raw.record_kind, 80), project_ref = opaque(raw.project_ref, 512);
  if (!record_ref || !record_kind || !project_ref) return null;
  const result: AuctraCollectionRecord = { record_ref, record_kind, project_ref };
  for (const key of ["work_ref", "unit_ref", "candidate_ref", "review_ref", "version_ref", "run_ref"] as const) if (opaque(raw[key])) result[key] = opaque(raw[key]);
  for (const key of ["kind", "title", "status", "source_revision", "source_digest", "created_at", "updated_at"] as const) if (text(raw[key]) && !/[\\/\x00-\x1f]/.test(text(raw[key]))) result[key] = text(raw[key]);
  if (Array.isArray(raw.evidence_refs)) result.evidence_refs = raw.evidence_refs.filter((item): item is string => typeof item === "string").slice(0, 32);
  return result;
}

export class AuctraCollectionReader {
  constructor(private config: ServerConfig, private fetcher: typeof fetch = fetch) {}
  private binding(scope: ScopeBinding, session: Session): { target: AuctraTarget; binding: AuctraBinding } {
    const target = this.config.collection?.auctra;
    const binding = scope.collection?.auctra;
    if (!target || target.enabled === false) throw new AuthError("source_not_configured", 503);
    if (!binding || !binding.actor || binding.audience !== target.audience) throw new AuthError("delegation_unavailable", 403);
    if (!originOf(target.origin)) throw new AuthError("upstream_not_allowed", 403);
    if (!session.accessToken && !target.credential_ref) throw new AuthError("delegation_unavailable", 403);
    return { target, binding };
  }
  private bearer(target: AuctraTarget, session: Session) {
    if (session.accessToken && session.accessAudience.includes(target.audience)) return session.accessToken;
    if (target.credential_ref) return secret(target.credential_ref);
    throw new AuthError("delegation_unavailable", 403);
  }
  private async request(path: string, init: RequestInit, scope: ScopeBinding, session: Session, limit = 2 * 1024 * 1024) {
    const { target } = this.binding(scope, session);
    const url = new URL(path, target.origin);
    if (url.origin !== originOf(target.origin) || url.username || url.password || url.hash || url.search) throw new AuthError("upstream_not_allowed", 403);
    const response = await this.fetcher(url, { ...init, headers: { Authorization: "Bearer " + this.bearer(target, session), "Content-Type": "application/json", ...(init.headers || {}) }, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new AuthError("owner_forbidden", 403);
      if (response.status === 404 || response.status === 501) throw new AuthError("needs_contract", 422);
      throw new AuthError("owner_unavailable", 503);
    }
    return boundedJSON(response, limit);
  }
  private async invoke(operationID: string, args: Record<string, unknown>, scope: ScopeBinding, session: Session) {
    return this.request(`/v1/operations/${encodeURIComponent(operationID)}:invoke`, { method: "POST", body: JSON.stringify({ operation_id: operationID, args: redact(args) }) }, scope, session);
  }
  async snapshot(scopeID: string, scope: ScopeBinding, session: Session, query: { cursor?: string; updated_after?: string; limit?: number; project_ref?: string } = {}): Promise<AuctraCollectionSnapshot> {
    try {
      const data = envelopeData(await this.invoke("collection.snapshot", { ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.updated_after ? { updated_after: query.updated_after } : {}), ...(query.project_ref ? { project_ref: query.project_ref } : {}), limit: query.limit || 100 }, scope, session));
      const records = Array.isArray(data.records) ? data.records.map(normalizeRecord).filter((item): item is AuctraCollectionRecord => !!item) : [];
      return { schema_version: "auctra.collection.snapshot.v1", owner: "auctra", scope: scopeID, project_ref: text(data.project_ref), observed_at: text(data.observed_at, 80) || new Date().toISOString(), coverage: "complete", freshness: data.freshness === "stale" ? "stale" : "fresh", ...(text(data.cursor) ? { cursor: text(data.cursor, 4096) } : {}), ...(text(data.next_cursor) ? { next_cursor: text(data.next_cursor, 4096) } : {}), returned: typeof data.returned === "number" ? data.returned : records.length, total: typeof data.total === "number" ? data.total : records.length, records };
    } catch (error) {
      return { schema_version: "auctra.collection.snapshot.v1", owner: "auctra", scope: scopeID, project_ref: "", observed_at: new Date().toISOString(), coverage: stateFor(error), freshness: "unknown", returned: 0, total: 0, records: [], blocker: error instanceof AuthError ? error.code : "owner_unavailable" };
    }
  }
  async recordShow(scopeID: string, scope: ScopeBinding, session: Session, recordRef: string): Promise<AuctraCollectionRecordProjection> {
    if (!recordRef || recordRef.length > 512 || /[\\/\x00-\x1f]/.test(recordRef)) throw new AuthError("invalid_reference", 400);
    try {
      const data = envelopeData(await this.invoke("collection.record.show", { record_ref: recordRef }, scope, session));
      const record = normalizeRecord(data.record);
      return { schema_version: "auctra.collection.record.v1", owner: "auctra", scope: scopeID, observed_at: new Date().toISOString(), coverage: record ? "complete" : "unknown", record_ref: recordRef, ...(record ? { record } : {}) };
    } catch (error) {
      return { schema_version: "auctra.collection.record.v1", owner: "auctra", scope: scopeID, observed_at: new Date().toISOString(), coverage: stateFor(error), record_ref: recordRef, blocker: error instanceof AuthError ? error.code : "owner_unavailable" };
    }
  }

  async creativeFlow(scopeID: string, scope: ScopeBinding, session: Session, query: { episode_ref?: string } = {}): Promise<AuctraCreativeFlowSnapshot> {
    const projectRef = scope.collection?.auctra?.project || scope.project;
    if (!query.episode_ref) {
      return { schema_version: "auctra.creative_flow_source.v1", owner: "auctra", project_ref: projectRef, episode_ref: "", observed_at: new Date().toISOString(), coverage: "unknown", stages: [], blocker: "episode_ref_required" };
    }
    try {
      const data = envelopeData(await this.invoke("creative.flow.read", {
        project_ref: projectRef,
        ...(query.episode_ref ? { episode_ref: query.episode_ref } : {}),
        work_ref: projectRef,
      }, scope, session));
      if (data.schema_version !== "auctra.creative_flow_source.v1" || typeof data.project_ref !== "string" || typeof data.episode_ref !== "string" || !Array.isArray(data.stages)) {
        throw new AuthError("needs_contract", 422);
      }
      // Both owners trim refs; an echo that differs from what was asked means the stages describe some other episode.
      if (query.episode_ref && data.episode_ref !== query.episode_ref) throw new AuthError("needs_contract", 422);
      const stages = data.stages.filter((value): value is AuctraCreativeFlowStage => {
        if (!value || typeof value !== "object") return false;
        const stage = value as Record<string, unknown>;
        return ["screenplay", "director_plan", "creative_storyboard", "production_handoff"].includes(String(stage.stage)) && stage.owner === "auctra" && typeof stage.object_kind === "string" && typeof stage.source_ref === "string" && typeof stage.state === "string" && typeof stage.native_state === "string" && typeof stage.observed_at === "string" && typeof stage.episode_ref === "string" && typeof stage.source_current === "boolean";
      }).map((stage) => ({
        ...stage,
        source_current: stage.source_current === true,
        blockers: tokens((stage as { blockers?: unknown }).blockers),
        safe_refs: Array.isArray(stage.safe_refs) ? stage.safe_refs.filter((value): value is string => typeof value === "string" && !!opaque(value)).slice(0, 32) : [],
      }));
      if (stages.length !== data.stages.length) throw new AuthError("needs_contract", 422);
      return {
        schema_version: "auctra.creative_flow_source.v1",
        owner: "auctra",
        project_ref: text(data.project_ref) || projectRef,
        episode_ref: text(data.episode_ref),
        observed_at: text(data.observed_at, 80) || new Date().toISOString(),
        // Auctra reports `partial` until every stage is accepted and current. That is pipeline progress, which each stage's
        // own state already carries; treating it as a data gap would flag the first accepted stage as needing attention.
        coverage: text(data.coverage, 32) === "stale" ? "expired" : text(data.coverage, 32) === "partial" ? "complete" : ((text(data.coverage, 32) as CoverageState) || "unknown"),
        stages,
      };
    } catch (error) {
      // A scope with no Auctra connection at all is a missing contract, not a denied or broken owner.
      const unbound = !this.config.collection?.auctra || this.config.collection.auctra.enabled === false || !scope.collection?.auctra;
      const failedCoverage = unbound ? "needs_contract" : stateFor(error);
      return {
        schema_version: "auctra.creative_flow_source.v1",
        owner: "auctra",
        project_ref: projectRef,
        episode_ref: query.episode_ref || "",
        observed_at: new Date().toISOString(),
        coverage: failedCoverage === "stale" ? "expired" : failedCoverage,
        stages: [],
        blocker: unbound ? "source_not_configured" : error instanceof AuthError ? error.code : "owner_unavailable",
      };
    }
  }
}
