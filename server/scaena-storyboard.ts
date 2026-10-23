import { AuthError, boundedJSON, secret } from "./auth";
import type { ScopeBinding, ServerConfig, Session } from "./contracts";
import type { CoverageState } from "../src/request-visibility";
import { flowStateFrom } from "../src/shared/creative-flow";
import type { StoryboardOutline, StoryboardOutlineScene, StoryboardOutlineShot } from "../src/shared/drama";

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
  scene_count?: number;
  shot_count?: number;
  duration_ms?: number;
  finding_count?: number;
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
  /** Newest first: items[0] is the head breakdown, the rest are earlier attempts. */
  items: ScaenaStoryboardItem[];
  source?: ScaenaStoryboardSource;
  /** True when Scaena reported further (older) attempts that were not fetched. */
  truncated?: boolean;
  outline?: StoryboardOutline;
  blocker?: string;
}

type OwnerTarget = NonNullable<ServerConfig["owners"]["scaena"]>;

const defaultLimit = 3;
const text = (value: unknown, max = 512) => typeof value === "string" ? value.slice(0, max) : "";
/** Machine tokens and refs only: short, no control characters, no separators that would change what a ref means. */
const clean = (value: unknown, max = 160) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : "";
const list = (value: unknown) => Array.isArray(value) ? value.map((item) => clean(item)).filter(Boolean).slice(0, 32) : [];
const refOf = (value: unknown) => clean(value, 512);
const originOf = (value: string) => { try { return new URL(value).origin; } catch { return null; } };
const label = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : "";
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
const time = (value: string) => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; };

function coverageForError(error: unknown): CoverageState {
  const code = error instanceof AuthError ? error.code : "owner_unavailable";
  if (code.includes("contract")) return "needs_contract";
  if (error instanceof AuthError && error.status === 403) return "forbidden";
  return "unavailable";
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
  const breakdown_ref = refOf(raw.breakdown_ref);
  if (!breakdown_ref) return null;
  const observed_at = text(raw.updated_at, 80) || fallbackObservedAt;
  const native = text(raw.state, 96);
  const blockers = list(raw.blockers);
  if (/^cancell?ed$/i.test(native) && !blockers.includes("breakdown_cancelled")) blockers.push("breakdown_cancelled");
  const version = typeof raw.version === "number" ? raw.version : 0;
  if (!version || !text(raw.episode_ref) || !native) return null;
  if (text(raw.source_ref) && (typeof raw.source_version !== "number" || raw.source_version < 1 || !validDigest(raw.source_digest))) return null;
  return {
    breakdown_ref,
    episode_ref: text(raw.episode_ref),
    ...(refOf(raw.source_ref) ? { source_ref: refOf(raw.source_ref) } : {}),
    state: flowStateFrom(native),
    native_state: native,
    revision: String(version),
    ...(validDigest(raw.candidate_digest) ? { digest: text(raw.candidate_digest, 160) } : {}),
    observed_at,
    blockers,
    ...(refOf(raw.scene_ref) ? { scene_ref: refOf(raw.scene_ref) } : {}),
    ...(refOf(raw.shot_ref) ? { shot_ref: refOf(raw.shot_ref) } : {}),
    ...(typeof raw.source_version === "number" ? { source_revision: String(raw.source_version) } : {}),
    ...(text(raw.source_digest) && validDigest(raw.source_digest) ? { source_digest: text(raw.source_digest) } : {}),
    ...(text(raw.current_candidate_ref) ? { candidate_ref: text(raw.current_candidate_ref) } : {}),
    ...(text(raw.candidate_state) ? { candidate_state: text(raw.candidate_state) } : {}),
    current: raw.blocking !== true,
    ...(count(raw.scene_count) !== undefined ? { scene_count: count(raw.scene_count) } : {}),
    ...(count(raw.shot_count) !== undefined ? { shot_count: count(raw.shot_count) } : {}),
    ...(count(raw.duration_ms) !== undefined ? { duration_ms: count(raw.duration_ms) } : {}),
    ...(count(raw.finding_count) !== undefined ? { finding_count: count(raw.finding_count) } : {}),
  };
}

/** Structure only. Action summaries, candidate bodies, prompts and media bindings are deliberately not copied. */
function outlineOf(raw: Record<string, unknown>, head: ScaenaStoryboardItem, olderAttempts: number, truncated: boolean): StoryboardOutline {
  const scenes: StoryboardOutlineScene[] = [];
  for (const value of (Array.isArray(raw.scenes) ? raw.scenes : []).slice(0, 80)) {
    if (!value || typeof value !== "object") continue;
    const scene = value as Record<string, unknown>;
    const scene_ref = refOf(scene.scene_ref);
    if (!scene_ref) continue;
    const shots: StoryboardOutlineShot[] = [];
    for (const item of (Array.isArray(scene.shots) ? scene.shots : []).slice(0, 60)) {
      if (!item || typeof item !== "object") continue;
      const shot = item as Record<string, unknown>;
      const shot_ref = refOf(shot.shot_ref);
      if (!shot_ref) continue;
      shots.push({
        shot_ref,
        order: count(shot.order) ?? shots.length + 1,
        ...(label(shot.shot_size, 32) ? { shot_size: label(shot.shot_size, 32) } : {}),
        ...(label(shot.camera_angle, 32) ? { camera_angle: label(shot.camera_angle, 32) } : {}),
        ...(label(shot.camera_movement, 32) ? { camera_movement: label(shot.camera_movement, 32) } : {}),
        ...(count(shot.duration_ms) !== undefined ? { duration_ms: count(shot.duration_ms) } : {}),
      });
    }
    shots.sort((a, b) => a.order - b.order);
    scenes.push({ scene_ref, order: count(scene.order) ?? scenes.length + 1, heading: label(scene.heading, 80), shots });
  }
  scenes.sort((a, b) => a.order - b.order);
  const listedShots = scenes.reduce((sum, scene) => sum + scene.shots.length, 0);
  return {
    head_breakdown_ref: head.breakdown_ref,
    head_state: flowStateFrom(head.native_state),
    head_native_state: head.native_state,
    head_revision: head.revision,
    older_attempts: olderAttempts,
    truncated,
    scene_count: head.scene_count ?? scenes.length,
    shot_count: head.shot_count ?? listedShots,
    duration_ms: head.duration_ms ?? null,
    finding_count: head.finding_count ?? null,
    scenes,
  };
}

export class ScaenaStoryboardReader {
  constructor(private readonly config: ServerConfig, private readonly fetcher: typeof fetch = fetch) {}

  private bearer(target: OwnerTarget, session: Session) {
    if (session.accessToken && session.accessAudience.includes(target.audience)) return session.accessToken;
    if (target.credential_ref) return secret(target.credential_ref);
    throw new AuthError("delegation_unavailable", 403);
  }

  async snapshot(scope: ScopeBinding, session: Session, query: { episode_ref?: string; breakdown_ref?: string; limit?: number } = {}): Promise<ScaenaStoryboardSnapshot> {
    const target = this.config.owners.scaena;
    const binding = scope.owners.scaena;
    const observed_at = new Date().toISOString();
    if (!target || !binding) return { owner: "scaena", project_ref: binding?.project || scope.project, observed_at, coverage: "needs_contract", freshness: "unknown", items: [], blocker: "scaena_storyboard_binding_missing" };
    const origin = originOf(target.origin);
    if (!origin) return { owner: "scaena", project_ref: binding.project, observed_at, coverage: "forbidden", freshness: "unknown", items: [], blocker: "upstream_not_allowed" };
    if (!query.episode_ref) return { owner: "scaena", project_ref: binding.project, observed_at, coverage: "unknown", freshness: "unknown", items: [], blocker: "episode_ref_required" };
    try {
      const url = new URL(`/api/v1/projects/${encodeURIComponent(binding.project)}/storyboard`, origin);
      url.searchParams.set("episode", query.episode_ref);
      if (query.breakdown_ref) url.searchParams.set("breakdown", query.breakdown_ref);
      url.searchParams.set("limit", String(Math.min(Math.max(Math.floor(query.limit ?? defaultLimit), 1), 100)));
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
      if (text(payload.episode_ref) !== query.episode_ref) throw new AuthError("needs_contract", 422);
      const rawItems = payload.items as unknown[];
      const parsed = rawItems.map((item) => normalizeItem(item, observed_at));
      if (parsed.some((item) => !item)) throw new AuthError("needs_contract", 422);
      // Scaena omits `source` until a source has been imported; that is "not started", not a broken contract.
      let source: ScaenaStoryboardSource | undefined;
      if (payload.source !== undefined && payload.source !== null) {
        if (typeof payload.source !== "object") throw new AuthError("needs_contract", 422);
        const rawSource = payload.source as Record<string, unknown>;
        if (!text(rawSource.source_ref) || text(rawSource.episode_ref) !== text(payload.episode_ref) || typeof rawSource.revision !== "number" || rawSource.revision < 1 || !validDigest(rawSource.digest) || typeof rawSource.current !== "boolean" || !text(rawSource.state)) throw new AuthError("needs_contract", 422);
        source = { source_ref: text(rawSource.source_ref), episode_ref: text(rawSource.episode_ref), revision: String(rawSource.revision), digest: text(rawSource.digest), state: text(rawSource.state), current: rawSource.current, blockers: list(rawSource.blockers), safe_refs: list(rawSource.safe_refs) };
      }
      const pairs = parsed.map((item, index) => ({ item: item as ScaenaStoryboardItem, raw: rawItems[index] as Record<string, unknown> }));
      if (!source && pairs.some(({ item }) => item.source_ref)) throw new AuthError("needs_contract", 422);
      pairs.sort((a, b) => time(b.item.observed_at) - time(a.item.observed_at));
      const truncated = !!text(payload.next_cursor);
      const head = pairs[0];
      return {
        owner: "scaena",
        project_ref: text(payload.project_ref || payload.projectRef, 512) || binding.project,
        observed_at: text(payload.observed_at, 80) || observed_at,
        coverage: "complete",
        freshness: text(payload.freshness, 32) === "stale" ? "stale" : "fresh",
        items: pairs.map(({ item }) => item),
        ...(source ? { source } : {}),
        ...(truncated ? { truncated } : {}),
        ...(head ? { outline: outlineOf(head.raw, head.item, pairs.length - 1, truncated) } : {}),
      };
    } catch (error) {
      return { owner: "scaena", project_ref: binding.project, observed_at, coverage: coverageForError(error), freshness: "unknown", items: [], blocker: error instanceof AuthError ? error.code : "owner_unavailable" };
    }
  }
}
