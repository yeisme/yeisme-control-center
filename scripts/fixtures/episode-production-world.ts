/**
 * Scaena's per-episode production summary as the fixture Scaena stores it, shaped like
 * `sdk/contract/episode_production_observation.go` (testdata golden). Keyed by the episode the control center asks for:
 * the Scaena production episode the studio knows, or the center episode itself.
 *
 * - ep-01: everything Scaena can answer today — references, review, edit and assembly observed; delivery still has no
 *   episode field, so it stays `needs_contract`. Eikona and Sonora bindings let their tasks count for this episode.
 *   It also carries Scaena's per-episode timing rollup (`timing`).
 * - ep-02: an episode with no Scaena production episode and no edit session; references are not published.
 * - anything else: not stored, so the fake owner answers as an owner without the operation (UNKNOWN_ACTION).
 */
const section = (state: string, extra: Record<string, unknown> = {}) => ({ state, counts: {}, ...extra });

const references = section("observed", { reason: "project_scope", status: "complete", counts: { total: 14, disabled: 2, "kind:character": 6, "kind:scene": 4, "kind:style": 2 } });

const rows: Record<string, Record<string, unknown>> = {
  "ep-01": {
    episode_ref: "episode_workspace_ep01",
    production_episode_ref: "ep-01",
    version: 7,
    updated_at: "2026-11-07T02:40:00Z",
    owners: [
      { owner: "scaena", purpose: "production_episode", resource_ref: "ep-01", version: "3", delegations: {} },
      { owner: "scaena", purpose: "edit_session", resource_ref: "edit-session-ep01", version: "5", delegations: {} },
      { owner: "eikona", purpose: "keyframes", resource_ref: "run-2398-review", version: "2", delegations: { completed: 1 } },
      { owner: "sonora", purpose: "dialogue", resource_ref: "sonora://episodes/rain-01", version: "4", delegations: { running: 1, completed: 2 } },
    ],
    sections: {
      references,
      review: section("observed", { status: "reviewed", counts: { reviews: 2, critical_errors: 1 }, updated_at: "2026-11-07T02:10:00Z" }),
      edit: section("observed", { status: "bound", counts: { sessions: 1 } }),
      assembly: section("observed", { status: "completed", counts: { previews: 3, artifacts: 1 }, artifact_ref: "artifact:cut:ep-01:v3", updated_at: "2026-11-07T02:35:00Z" }),
      delivery: section("needs_contract", { reason: "delivery_episode_link_missing" }),
    },
    // Scaena's own sum over every run of the episode, including runs past the control center's first task page.
    // It does not record blocked or human-wait time yet, so those are null and `splits_recorded` is false.
    timing: {
      state: "observed", run_count: 5, timed_run_count: 5, wall_duration_ms: 7_440_000, active_duration_ms: 1_860_000, queue_duration_ms: 480_000,
      blocked_duration_ms: null, human_wait_duration_ms: null, retry_count: 1, running: 0, stalled: 1,
      first_started_at: "2026-11-06T22:10:00Z", last_ended_at: "2026-11-07T02:35:00Z", splits_recorded: false,
    },
  },
  "ep-02": {
    episode_ref: "ep-02",
    version: 1,
    updated_at: "2026-11-06T09:00:00Z",
    owners: [],
    sections: {
      references: section("needs_contract", { reason: "reference_catalog_unpublished" }),
      review: section("observed", { status: "not_reviewed", counts: { reviews: 0, critical_errors: 0 } }),
      edit: section("observed", { status: "unbound", counts: { sessions: 0 } }),
      assembly: section("unavailable", { reason: "production_episode_unbound" }),
      delivery: section("needs_contract", { reason: "delivery_episode_link_missing" }),
    },
  },
};

/** The page Scaena returns for `episode`, or `undefined` when this fixture owner has no such operation for it. */
export function episodeProductionPage(project: string, episode: string) {
  const row = project === "rain-reunion" ? rows[episode] : undefined;
  if (!row) return undefined;
  return { schema_version: "yeisme.episode_production_observation.v1", project_ref: project, rows: [row], observed_at: new Date().toISOString() };
}
