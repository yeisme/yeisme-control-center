import { createHash } from "node:crypto";
import type { Scenario } from "./world";

export interface DramaReply { status: number; body?: unknown }

type StageKey = "screenplay" | "director_plan" | "creative_storyboard" | "production_handoff";
interface StageSpec { state: string; native: string; revision?: number; current: boolean; blockers?: string[]; reviews?: string[]; at?: number }
interface CollectionRecord { record_ref: string; record_kind: string; project_ref: string; updated_at: string; [key: string]: unknown }

const built = Date.now();
const hour = 3_600_000;
const day = 24 * hour;
const defaultProject = "rain-reunion";
const stageOrder: StageKey[] = ["screenplay", "director_plan", "creative_storyboard", "production_handoff"];
const objectKinds: Record<StageKey, string> = { screenplay: "screenplay", director_plan: "director_scene_plan", creative_storyboard: "storyboard_plan", production_handoff: "production_episode_handoff" };
const refPrefixes = { director_plan: "director_scene", creative_storyboard: "storyboard", production_handoff: "handoff" };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const stamp = (at: number) => new Date(at).toISOString();
const digest = (seed: string) => "sha256:" + createHash("sha256").update(seed).digest("hex");
const stageDigest = (key: StageKey, project: string, episode: string, revision: number) => digest(`${key}:${project}:${episode}:${revision}`);
const failure = (status: number, code: string, message: string): DramaReply => ({ status, body: { error: { code, message } } });

// --- Auctra collection records (timestamps fixed at load so source_revision never churns between syncs) ---

const unit = (project: string, id: string, kind: string, title: string, status: string, createdAgo: number, updatedAgo: number): CollectionRecord => ({
  record_ref: `unit:${id}`, record_kind: "text_unit", project_ref: project, work_ref: project, unit_ref: id, kind, title, status,
  source_revision: stamp(built - updatedAgo), source_digest: digest(`unit:${project}:${id}:${kind}:${status}`),
  created_at: stamp(built - createdAgo), updated_at: stamp(built - updatedAgo),
});

const collection: Record<string, CollectionRecord[]> = {
  "rain-reunion": [
    unit("rain-reunion", "outline-s1", "outline", "第一季 · 故事大纲", "ready", 30 * day, 12 * day),
    unit("rain-reunion", "char-lin-wan", "character_profile", "角色档案 · 林晚", "ready", 28 * day, 10 * day),
    unit("rain-reunion", "ep-01", "screenplay", "第 1 集 · 雨停站台", "ready", 20 * day, 6 * day),
    unit("rain-reunion", "ep-03", "screenplay", "第 3 集 · 回声", "ready", 14 * day, 3 * day),
    unit("rain-reunion", "ep-02", "screenplay", "第 2 集 · 末班车", "ready", 16 * day, 26 * hour),
    {
      // Carries an episode unit_ref on purpose: only text_unit/screenplay records are episodes.
      record_ref: "review:rv-ep02-storyboard", record_kind: "review", project_ref: "rain-reunion", unit_ref: "ep-02", review_ref: "rv-ep02-storyboard",
      kind: "storyboard_plan", title: "第 2 集 · 分镜计划评审", status: "pending_review",
      source_revision: stamp(built - 40 * 60_000), source_digest: digest("review:rain-reunion:rv-ep02-storyboard:pending_review"),
      created_at: stamp(built - 50 * 60_000), updated_at: stamp(built - 40 * 60_000), evidence_refs: ["review:rv-ep02-storyboard"],
    },
  ],
  "coast-letters": [unit("coast-letters", "ep-01", "screenplay", "第 1 集 · 海岸来信", "draft", 9 * day, 2 * day)],
};

// --- Auctra creative flow (state words and blockers follow cli/auctra/internal/authoring/creative_flow.go) ---

const accepted = (revision: number): StageSpec => ({ state: "accepted", native: "accepted", revision, current: true });
const flows: Record<string, Record<string, Partial<Record<StageKey, StageSpec>>>> = {
  "rain-reunion": {
    "ep-01": { screenplay: accepted(2), director_plan: accepted(1), creative_storyboard: accepted(1), production_handoff: accepted(1) },
    "ep-02": {
      screenplay: accepted(1), director_plan: accepted(1),
      creative_storyboard: { state: "waiting_review", native: "pending_review", revision: 1, current: true, reviews: ["rv-ep02-storyboard"] },
    },
    // The handoff was cut from screenplay revision 1; revision 2 was accepted since, so the owner downgrades it to stale.
    "ep-03": {
      screenplay: accepted(2), director_plan: accepted(1), creative_storyboard: accepted(1),
      production_handoff: { state: "stale", native: "accepted", revision: 1, current: false, blockers: ["screenplay_revision_mismatch"], at: built - 3 * hour },
    },
  },
  "coast-letters": { "ep-01": { screenplay: { state: "blocked", native: "missing", current: false, blockers: ["source_not_accepted"] } } },
};

function stageOf(project: string, episode: string, key: StageKey, spec: StageSpec | undefined, now: number) {
  const revision = spec?.revision;
  const sourceRef = key === "screenplay" ? `auctra:screenplay:${episode}` : revision ? `${refPrefixes[key]}:${episode.replace(/-/g, "")}-r${revision}` : "";
  const handoff = key === "screenplay" && revision ? `auctra-storyboard-source:${episode}:${revision}` : "";
  const reviews = spec?.reviews ?? (handoff ? [handoff] : []);
  const blockers = spec?.blockers ?? [];
  const safe = key === "screenplay" ? (revision ? [sourceRef, handoff] : [episode]) : revision ? [sourceRef, ...reviews, ...(key === "production_handoff" ? [episode] : [])] : [];
  return {
    stage: key, owner: "auctra" as const, object_kind: objectKinds[key], source_ref: sourceRef,
    state: spec?.state ?? "missing", native_state: spec?.native ?? "missing",
    ...(revision ? { revision: String(revision), digest: stageDigest(key, project, episode, revision) } : {}),
    observed_at: stamp(spec?.at ?? now), source_current: spec?.current ?? false, episode_ref: episode,
    ...(reviews.length ? { review_refs: reviews } : {}), ...(blockers.length ? { blockers } : {}),
    safe_refs: [...new Set(safe)].sort(),
  };
}

function creativeFlow(scenario: Scenario, args: Record<string, unknown>): DramaReply {
  const episode = text(args.episode_ref);
  if (!episode) return failure(400, "INVALID_ARGUMENT", "episode_ref is required");
  const project = text(args.project_ref) || defaultProject;
  const spec = scenario === "empty" ? undefined : flows[project]?.[episode];
  const now = Date.now();
  const stages = spec ? stageOrder.map((key) => stageOf(project, episode, key, spec[key], now)) : [stageOf(project, episode, "screenplay", undefined, now)];
  const complete = !!spec && stages.every((stage) => stage.state === "accepted" && stage.source_current);
  return { status: 200, body: { data: { schema_version: "auctra.creative_flow_source.v1", owner: "auctra", project_ref: project, episode_ref: episode, observed_at: stamp(now), coverage: complete ? "complete" : "partial", stages } } };
}

function snapshot(scenario: Scenario, args: Record<string, unknown>): DramaReply {
  const project = text(args.project_ref) || defaultProject;
  const since = text(args.updated_after);
  const after = since ? Date.parse(since) : 0;
  if (Number.isNaN(after)) return failure(400, "INVALID_ARGUMENT", "invalid updated_after");
  const cursor = text(args.cursor);
  const start = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(start) || start < 0) return failure(400, "INVALID_ARGUMENT", "invalid collection cursor");
  const limit = typeof args.limit === "number" && args.limit >= 1 ? Math.min(200, Math.floor(args.limit)) : 100;
  const rows = (scenario === "empty" ? [] : (collection[project] ?? []))
    .filter((row) => Date.parse(row.updated_at) > after)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.record_ref.localeCompare(b.record_ref));
  const page = rows.slice(start, start + limit);
  const next = start + limit < rows.length ? String(start + limit) : "";
  return { status: 200, body: { data: { schema_version: "auctra.collection.snapshot.v1", project_ref: project, ...(cursor ? { cursor } : {}), ...(next ? { next_cursor: next } : {}), returned: page.length, total: rows.length, coverage: "complete", freshness: "fresh", observed_at: stamp(Date.now()), records: page } } };
}

function recordShow(scenario: Scenario, args: Record<string, unknown>): DramaReply {
  const ref = text(args.record_ref);
  if (!ref) return failure(400, "INVALID_ARGUMENT", "record_ref is required");
  const scoped = text(args.project_ref);
  const rows = scenario === "empty" ? [] : Object.entries(collection).filter(([project]) => !scoped || project === scoped).flatMap(([, list]) => list);
  const record = rows.find((row) => row.record_ref === ref);
  if (!record) return failure(404, "NOT_FOUND", "collection record not found");
  return { status: 200, body: { data: { schema_version: "auctra.collection.record.v1", record, observed_at: stamp(Date.now()) } } };
}

function invokeAuctra(scenario: Scenario, operationId: string, args: Record<string, unknown>): DramaReply {
  if (operationId === "collection.snapshot") return snapshot(scenario, args);
  if (operationId === "collection.record.show") return recordShow(scenario, args);
  if (operationId === "creative.flow.read") return creativeFlow(scenario, args);
  return failure(404, "UNKNOWN_ACTION", `unknown operation ${operationId}`);
}

// --- Scaena storyboard workspace projection ---

type ShotRow = [size: string, angle: string, movement: string, durationMs: number, action: string];
const layout: { heading: string; shots: ShotRow[] }[] = [
  { heading: "站台 · 雨停", shots: [
    ["wide", "high", "static", 9000, "示例镜头：雨刚停，空站台积水映出灯光。"],
    ["medium", "eye_level", "push_in", 8000, "示例镜头：林晚收起雨伞，抖落水珠。"],
    ["close_up", "eye_level", "static", 6500, "示例镜头：林晚抬头，望向进站方向。"],
    ["medium", "over_the_shoulder", "pan", 7500, "示例镜头：远处列车灯光扫过站台。"],
  ] },
  { heading: "候车厅 · 旧友", shots: [
    ["wide", "eye_level", "tracking", 9500, "示例镜头：陈序推门走进候车厅。"],
    ["medium", "eye_level", "static", 8500, "示例镜头：两人隔着长椅对视，谁也没先开口。"],
    ["close_up", "low", "push_in", 7000, "示例镜头：林晚的指尖停在车票边缘。"],
    ["medium_close_up", "eye_level", "handheld", 8000, "示例镜头：陈序递出一把旧伞。"],
  ] },
  { heading: "站外 · 灯下", shots: [
    ["wide", "high", "pull_out", 11000, "示例镜头：两人并肩走向站外，灯光渐远。"],
    ["close_up", "eye_level", "static", 9000, "示例镜头：伞下的侧脸，嘴角轻微上扬。"],
    ["extreme_close_up", "eye_level", "static", 10000, "示例镜头：车票落入水洼，涟漪扩散。"],
  ] },
];

interface ItemSpec { key: string; version: number; state: string; candidate?: string; candidateState?: string; scenes: number; findings: number; blocking: boolean; ago: number; media?: boolean }
interface SourceSpec { auctraEpisode: string; revision: number; current: boolean; state: string; blockers: string[] }

const boards: Record<string, Record<string, { source: SourceSpec; items: ItemSpec[] }>> = {
  "rain-reunion": {
    "ep-01": {
      source: { auctraEpisode: "ep-01", revision: 2, current: true, state: "accepted", blockers: [] },
      items: [
        { key: "ep01", version: 3, state: "accepted", candidate: "cand-ep01-v3", candidateState: "accepted", scenes: 3, findings: 0, blocking: false, ago: 0, media: true },
        { key: "ep01", version: 2, state: "rejected", candidate: "cand-ep01-v2", candidateState: "rejected", scenes: 2, findings: 3, blocking: true, ago: 3 * hour },
        { key: "ep01", version: 1, state: "failed", scenes: 0, findings: 1, blocking: true, ago: day },
      ],
    },
    // Scaena files this episode as "episode:03" while Auctra calls it "ep-03": joining on equal refs finds nothing.
    "episode:03": {
      source: { auctraEpisode: "ep-03", revision: 1, current: false, state: "stale", blockers: ["source_superseded"] },
      items: [{ key: "ep03", version: 1, state: "running", scenes: 0, findings: 0, blocking: false, ago: 30_000 }],
    },
  },
};

function sourceOf(project: string, episode: string, spec: SourceSpec) {
  const sourceRef = `auctra:screenplay:${spec.auctraEpisode}`;
  return {
    source_ref: sourceRef, episode_ref: episode, revision: spec.revision, digest: stageDigest("screenplay", project, spec.auctraEpisode, spec.revision),
    current: spec.current, state: spec.state, blockers: spec.blockers,
    safe_refs: [`auctra-storyboard-source:${spec.auctraEpisode}:${spec.revision}`, sourceRef].sort(),
  };
}

function itemOf(project: string, episode: string, source: ReturnType<typeof sourceOf>, spec: ItemSpec, now: number) {
  const scenes = layout.slice(0, spec.scenes).map((scene, s) => {
    const sceneRef = `${spec.key}-sc${s + 1}`;
    return {
      scene_ref: sceneRef, order: s + 1, heading: scene.heading,
      shots: scene.shots.map(([shot_size, camera_angle, camera_movement, duration_ms, action_summary], i) => ({
        shot_ref: `${sceneRef}-sh${i + 1}`, scene_ref: sceneRef, order: i + 1, shot_size, camera_angle, camera_movement, duration_ms, action_summary,
        candidate_refs: spec.candidate ? [spec.candidate] : [],
      })),
    };
  });
  const shots = scenes.flatMap((scene) => scene.shots);
  return {
    breakdown_ref: `bd-${spec.key}-v${spec.version}`, episode_ref: episode,
    source_ref: source.source_ref, source_version: source.revision, source_digest: source.digest,
    version: spec.version, state: spec.state,
    ...(spec.candidate ? { current_candidate_ref: spec.candidate, candidate_version: spec.version, candidate_digest: digest(`candidate:${project}:${spec.candidate}`), candidate_state: spec.candidateState } : {}),
    scene_count: scenes.length, shot_count: shots.length, duration_ms: shots.reduce((total, shot) => total + shot.duration_ms, 0),
    finding_count: spec.findings, blocking: spec.blocking, updated_at: stamp(now - spec.ago),
    scenes, allowed_actions: [],
    media: spec.media && spec.candidate
      ? shots.map((shot) => ({ candidate_ref: spec.candidate, shot_ref: shot.shot_ref, representation_ref: `rep-${shot.shot_ref}`, content_ref: `fixture-content:${shot.shot_ref}`, digest: digest(`media:${project}:${shot.shot_ref}`), media_type: "image/png", status: "ready" }))
      : [],
  };
}

function storyboardOf(scenario: Scenario, project: string, query: URLSearchParams): DramaReply {
  const episode = (query.get("episode") ?? "").trim();
  if (!episode) return failure(400, "INVALID_ARGUMENT", "episode is required");
  const rawLimit = Number(query.get("limit"));
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(100, rawLimit) : 24;
  const start = Number(query.get("cursor") || 0);
  if (!Number.isInteger(start) || start < 0) return failure(400, "INVALID_ARGUMENT", "invalid cursor");
  const board = scenario === "empty" ? undefined : boards[project]?.[episode];
  const source = board && sourceOf(project, episode, board.source);
  const now = Date.now();
  const all = (board && source ? board.items.map((spec) => itemOf(project, episode, source, spec, now)) : []).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const breakdown = query.get("breakdown") ?? "";
  const items = all.filter((item) => !breakdown || item.breakdown_ref === breakdown);
  return { status: 200, body: { data: {
    schema_version: "scaena.storyboard_workspace_projection.v1", project_ref: project, episode_ref: episode,
    revision: Math.max(1, ...all.map((item) => item.version)),
    digest: digest(`storyboard:${project}:${episode}:${all.map((item) => `${item.breakdown_ref}:${item.state}`).join(",")}`),
    observed_at: stamp(now), freshness: "fresh", ...(source ? { source } : {}),
    items: items.slice(start, start + limit),
    ...(start + limit < items.length ? { next_cursor: String(start + limit) } : {}),
  } } };
}

export function buildDramaWorld(scenario: Scenario) {
  const unavailable: DramaReply = { status: 503 };
  return {
    invoke: (operationId: string, args: Record<string, unknown>): DramaReply => (scenario === "degraded" ? unavailable : invokeAuctra(scenario, operationId, args)),
    storyboard: (project: string, query: URLSearchParams): DramaReply => (scenario === "degraded" ? unavailable : storyboardOf(scenario, project, query)),
  };
}
