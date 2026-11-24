/**
 * Scaena's per-episode production summary (`control_center.production.episodes`), as the control center keeps it:
 * references, statuses and counts only. Scaena reads its own stored records; nothing here is inferred from task states.
 */
export const episodeProductionSchema = "yeisme.episode_production_observation.v1" as const;

export type EpisodeSectionState = "observed" | "needs_contract" | "unavailable";
export const episodeSectionParts = ["references", "review", "edit", "assembly", "delivery"] as const;
export type EpisodeSectionPart = (typeof episodeSectionParts)[number];

export interface EpisodeProductionSection {
  state: EpisodeSectionState;
  reason?: string;
  status?: string;
  counts: Record<string, number>;
  artifact_ref?: string;
  truncated?: boolean;
  updated_at?: string;
}

/** One owner binding Scaena keeps for the episode, with its dispatched items counted by state. */
export interface EpisodeProductionOwner {
  owner: string;
  purpose: string;
  resource_ref: string;
  version: string;
  delegations: Record<string, number>;
}

export interface EpisodeProduction {
  episode_ref: string;
  production_episode_ref?: string;
  version: number;
  updated_at: string;
  owners: EpisodeProductionOwner[];
  delegations_truncated?: boolean;
  sections: Record<EpisodeSectionPart, EpisodeProductionSection>;
  /** Scaena's rollup of this episode's runs; absent from a Scaena that predates it. */
  timing?: EpisodeProductionTiming;
}

/**
 * Scaena's own sum over every run of the episode, so it is whole where the control center's task pages are bounded.
 * `splits_recorded` is false while Scaena does not record blocked and human-wait time; those then read as not provided.
 */
export interface EpisodeProductionTiming {
  state: EpisodeSectionState;
  reason?: string;
  run_count: number;
  timed_run_count: number;
  wall_duration_ms: number | null;
  active_duration_ms: number | null;
  queue_duration_ms: number | null;
  blocked_duration_ms: number | null;
  human_wait_duration_ms: number | null;
  retry_count: number;
  running: number;
  stalled: number;
  first_started_at?: string;
  last_ended_at?: string;
  splits_recorded: boolean;
  truncated?: boolean;
}

/**
 * What the control center could learn. `observed` carries the row; `empty` means Scaena answered and keeps no such
 * episode; the other states say why nothing was read and never stand for zero.
 */
export type EpisodeProductionRead =
  | { state: "observed"; observed_at: string; row: EpisodeProduction }
  | { state: "empty"; observed_at: string }
  | { state: "unconnected" | "needs_contract" | "unavailable"; reason: string };

const ownerLimit = 50;
const countKeyLimit = 32;
const refPattern = /^[^\s\u0000-\u001f\u007f]{1,256}$/;
const keyPattern = /^[a-z0-9_:.-]{1,48}$/;
const sectionStates = new Set<EpisodeSectionState>(["observed", "needs_contract", "unavailable"]);

const ref = (value: unknown): string | undefined => typeof value === "string" && refPattern.test(value) ? value : undefined;
const word = (value: unknown): string | undefined => typeof value === "string" && keyPattern.test(value) ? value : undefined;
const time = (value: unknown): string | undefined => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : undefined;

function counts(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(value as Record<string, unknown>)) {
    if (!word(key) || typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return undefined;
    if (Object.keys(out).length < countKeyLimit) out[key] = n;
  }
  return out;
}

function section(value: unknown): EpisodeProductionSection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const state = raw.state as EpisodeSectionState;
  const c = counts(raw.counts ?? {});
  if (!sectionStates.has(state) || !c) return undefined;
  const reason = word(raw.reason);
  const status = word(raw.status);
  const artifact = ref(raw.artifact_ref);
  const updated = time(raw.updated_at);
  return { state, ...(reason ? { reason } : {}), ...(status ? { status } : {}), counts: c, ...(artifact ? { artifact_ref: artifact } : {}), ...(raw.truncated === true ? { truncated: true } : {}), ...(updated ? { updated_at: updated } : {}) };
}

const whole = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** A malformed timing block is dropped on its own; the rest of the row still stands. */
function timing(value: unknown): EpisodeProductionTiming | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const state = raw.state as EpisodeSectionState;
  if (!sectionStates.has(state)) return undefined;
  const reason = word(raw.reason);
  const first = time(raw.first_started_at);
  const last = time(raw.last_ended_at);
  return {
    state,
    ...(reason ? { reason } : {}),
    run_count: whole(raw.run_count) ?? 0,
    timed_run_count: whole(raw.timed_run_count) ?? 0,
    wall_duration_ms: whole(raw.wall_duration_ms),
    active_duration_ms: whole(raw.active_duration_ms),
    queue_duration_ms: whole(raw.queue_duration_ms),
    blocked_duration_ms: whole(raw.blocked_duration_ms),
    human_wait_duration_ms: whole(raw.human_wait_duration_ms),
    retry_count: whole(raw.retry_count) ?? 0,
    running: whole(raw.running) ?? 0,
    stalled: whole(raw.stalled) ?? 0,
    ...(first ? { first_started_at: first } : {}),
    ...(last ? { last_ended_at: last } : {}),
    splits_recorded: raw.splits_recorded === true,
    ...(raw.truncated === true ? { truncated: true } : {}),
  };
}

function row(value: unknown): EpisodeProduction | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const episode = ref(raw.episode_ref);
  const sections = raw.sections as Record<string, unknown> | undefined;
  if (!episode || !sections || typeof sections !== "object" || !Array.isArray(raw.owners)) return undefined;
  const parsed = {} as Record<EpisodeSectionPart, EpisodeProductionSection>;
  for (const part of episodeSectionParts) {
    const s = section(sections[part]);
    if (!s) return undefined;
    parsed[part] = s;
  }
  const owners: EpisodeProductionOwner[] = [];
  for (const item of raw.owners.slice(0, ownerLimit)) {
    const o = item as Record<string, unknown> | null;
    const owner = word(o?.owner);
    const resource = ref(o?.resource_ref);
    const delegations = counts(o?.delegations ?? {});
    if (!owner || !resource || !delegations) continue;
    owners.push({ owner, purpose: word(o?.purpose) || "", resource_ref: resource, version: typeof o?.version === "string" ? o.version.slice(0, 64) : "", delegations });
  }
  const production = ref(raw.production_episode_ref);
  return {
    episode_ref: episode,
    ...(production ? { production_episode_ref: production } : {}),
    version: typeof raw.version === "number" && Number.isSafeInteger(raw.version) && raw.version >= 0 ? raw.version : 0,
    updated_at: time(raw.updated_at) || "",
    owners,
    ...(raw.delegations_truncated === true ? { delegations_truncated: true } : {}),
    sections: parsed,
    ...(timing(raw.timing) ? { timing: timing(raw.timing) } : {}),
  };
}

/**
 * The row for the episode asked about, from a Scaena page. The row must name that episode (its own ref or its Scaena
 * production episode); a page that does not match the schema is `undefined`, never a guess.
 */
export function normalizeEpisodeProductionPage(value: unknown, wanted: string[], now: string): EpisodeProductionRead | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.schema_version !== episodeProductionSchema || !Array.isArray(raw.rows)) return undefined;
  const observed = time(raw.observed_at) || now;
  const names = new Set(wanted.filter(Boolean));
  for (const item of raw.rows.slice(0, 20)) {
    const parsed = row(item);
    if (!parsed) return undefined;
    if (names.has(parsed.episode_ref) || (parsed.production_episode_ref && names.has(parsed.production_episode_ref))) return { state: "observed", observed_at: observed, row: parsed };
  }
  return raw.rows.length ? undefined : { state: "empty", observed_at: observed };
}

/** The owner binding refs Scaena records for one owner in this episode; a task whose ref matches one belongs to it. */
export function episodeBindingRefs(read: EpisodeProductionRead | undefined, owner: string): Set<string> {
  if (read?.state !== "observed") return new Set();
  return new Set(read.row.owners.filter((o) => o.owner === owner).map((o) => o.resource_ref));
}
