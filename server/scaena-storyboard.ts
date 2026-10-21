import { AuthError, boundedJSON, secret } from "./auth";
import type { ScopeBinding, ServerConfig, Session } from "./contracts";
import type { CoverageState } from "../src/request-visibility";

export interface ScaenaStoryboardItem {
  breakdown_ref: string;
  episode_ref?: string;
  source_ref?: string;
  state: string;
  native_state: string;
  revision: string;
  digest?: string;
  observed_at: string;
  blockers: string[];
  scene_ref?: string;
  shot_ref?: string;
  source_revision?: string;
  source_digest?: string;
  candidate_ref?: string;
  candidate_state?: string;
  current?: boolean;
}

export interface ScaenaStoryboardSource {
  source_ref: string;
  episode_ref: string;
  revision: string;
  digest: string;
  state: string;
  current: boolean;
  blockers: string[];
  safe_refs: string[];
}

export interface ScaenaStoryboardSnapshot {
  owner: "scaena";
  project_ref: string;
  observed_at: string;
  coverage: CoverageState;
  freshness: "fresh" | "stale" | "unknown";
  items: ScaenaStoryboardItem[];
  source?: ScaenaStoryboardSource;
  blocker?: string;
}

type OwnerTarget = NonNullable<ServerConfig["owners"]["scaena"]>;

const text = (value: unknown, max = 512) => typeof value === "string" ? value.slice(0, max) : "";
const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 32) : [];
const originOf = (value: string) => { try { return new URL(value).origin; } catch { return null; } };

function coverageForError(error: unknown): CoverageState {
  const code = error instanceof AuthError ? error.code : "owner_unavailable";
  if (code.includes("contract")) return "needs_contract";
  if (error instanceof AuthError && error.status === 403) return "forbidden";
  return "unavailable";
}

function normalizeState(value: unknown) {
  const state = text(value, 96).toLowerCase();
  if (["accepted", "approved", "adopted", "ready", "export_ready", "handoff_ready"].includes(state)) return "accepted";
  if (["review", "reviewing", "waiting_review", "review_required", "needs_review"].includes(state)) return "waiting_review";
  if (["blocked", "failed", "rejected"].includes(state)) return "blocked";
  if (["stale", "superseded"].includes(state)) return "stale";
  if (["draft", "planned", "pending"].includes(state)) return state;
  return state || "unknown";
}

function envelopeData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  for (const key of ["data", "projection", "storyboard"]) {
    if (record[key] && typeof record[key] === "object") return record[key] as Record<string, unknown>;
  }
  return record;
}

function validDigest(value: unknown) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/i.test(value);
}

function normalizeItem(value: unknown, fallbackObservedAt: string): ScaenaStoryboardItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const breakdown_ref = text(raw.breakdown_ref);
  if (!breakdown_ref) return null;
  const observed_at = text(raw.updated_at, 80) || fallbackObservedAt;
  const blockers = list(raw.blockers);
  const version = typeof raw.version === "number" ? raw.version : 0;
  if (!version || !text(raw.episode_ref) || !text(raw.state)) return null;
  if (text(raw.source_ref) && (typeof raw.source_version !== "number" || raw.source_version < 1 || !validDigest(raw.source_digest))) return null;
  return {
    breakdown_ref,
    episode_ref: text(raw.episode_ref),
    ...(text(raw.source_ref) ? { source_ref: text(raw.source_ref) } : {}),
    state: normalizeState(raw.state),
    native_state: text(raw.state, 96),
    revision: String(version),
    ...(validDigest(raw.candidate_digest) ? { digest: text(raw.candidate_digest, 160) } : {}),
    observed_at,
    blockers,
    ...(text(raw.scene_ref) ? { scene_ref: text(raw.scene_ref) } : {}),
    ...(text(raw.shot_ref) ? { shot_ref: text(raw.shot_ref) } : {}),
    ...(typeof raw.source_version === "number" ? { source_revision: String(raw.source_version) } : {}),
    ...(text(raw.source_digest) && validDigest(raw.source_digest) ? { source_digest: text(raw.source_digest) } : {}),
    ...(text(raw.current_candidate_ref) ? { candidate_ref: text(raw.current_candidate_ref) } : {}),
    ...(text(raw.candidate_state) ? { candidate_state: text(raw.candidate_state) } : {}),
    current: raw.blocking !== true,
  };
}

export class ScaenaStoryboardReader {
  constructor(private readonly config: ServerConfig, private readonly fetcher: typeof fetch = fetch) {}

  private bearer(target: OwnerTarget, session: Session) {
    if (session.accessToken && session.accessAudience.includes(target.audience)) return session.accessToken;
    if (target.credential_ref) return secret(target.credential_ref);
    throw new AuthError("delegation_unavailable", 403);
  }

  async snapshot(scope: ScopeBinding, session: Session, query: { episode_ref?: string; breakdown_ref?: string } = {}): Promise<ScaenaStoryboardSnapshot> {
    const target = this.config.owners.scaena;
    const binding = scope.owners.scaena;
    const observed_at = new Date().toISOString();
    if (!target || !binding) return { owner: "scaena", project_ref: binding?.project || scope.project, observed_at, coverage: "needs_contract", freshness: "unknown", items: [], blocker: "scaena_storyboard_binding_missing" };
    const origin = originOf(target.origin);
    if (!origin) return { owner: "scaena", project_ref: binding.project, observed_at, coverage: "forbidden", freshness: "unknown", items: [], blocker: "upstream_not_allowed" };
    try {
      const url = new URL(`/api/v1/projects/${encodeURIComponent(binding.project)}/storyboard`, origin);
      if (query.episode_ref) url.searchParams.set("episode", query.episode_ref);
      if (query.breakdown_ref) url.searchParams.set("breakdown", query.breakdown_ref);
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: "Bearer " + this.bearer(target, session) },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new AuthError("owner_forbidden", 403);
        if (response.status === 404 || response.status === 501) throw new AuthError("needs_contract", 422);
        throw new AuthError("owner_unavailable", 503);
      }
      const payload = envelopeData(await boundedJSON(response));
      if (payload.schema_version !== "scaena.storyboard_workspace_projection.v1" || !text(payload.project_ref) || !text(payload.episode_ref) || typeof payload.revision !== "number" || payload.revision < 1 || !validDigest(payload.digest) || !Array.isArray(payload.items)) {
        throw new AuthError("needs_contract", 422);
      }
      if (text(payload.episode_ref) !== (query.episode_ref || text(payload.episode_ref))) throw new AuthError("needs_contract", 422);
      const items = payload.items.map((item) => normalizeItem(item, observed_at)).filter((item): item is ScaenaStoryboardItem => !!item);
      if (items.length !== payload.items.length) throw new AuthError("needs_contract", 422);
      let source: ScaenaStoryboardSource | undefined;
      if (payload.source === undefined) throw new AuthError("needs_contract", 422);
      {
        if (!payload.source || typeof payload.source !== "object") throw new AuthError("needs_contract", 422);
        const rawSource = payload.source as Record<string, unknown>;
        if (!text(rawSource.source_ref) || text(rawSource.episode_ref) !== text(payload.episode_ref) || typeof rawSource.revision !== "number" || rawSource.revision < 1 || !validDigest(rawSource.digest) || typeof rawSource.current !== "boolean" || !text(rawSource.state)) throw new AuthError("needs_contract", 422);
        source = { source_ref: text(rawSource.source_ref), episode_ref: text(rawSource.episode_ref), revision: String(rawSource.revision), digest: text(rawSource.digest), state: text(rawSource.state), current: rawSource.current, blockers: list(rawSource.blockers), safe_refs: list(rawSource.safe_refs) };
      }
      return {
        owner: "scaena",
        project_ref: text(payload.project_ref || payload.projectRef, 512) || binding.project,
        observed_at: text(payload.observed_at, 80) || observed_at,
        coverage: "complete",
        freshness: text(payload.freshness, 32) === "stale" ? "stale" : "fresh",
        items,
        ...(source ? { source } : {}),
      };
    } catch (error) {
      return { owner: "scaena", project_ref: binding.project, observed_at, coverage: coverageForError(error), freshness: "unknown", items: [], blocker: error instanceof AuthError ? error.code : "owner_unavailable" };
    }
  }
}

