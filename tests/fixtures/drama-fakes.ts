import { AuctraCollectionStore } from "../../server/db/auctra-collection-store";
import type { AuctraCollectionRecord, AuctraCreativeFlowSnapshot } from "../../server/auctra";
import type { ScaenaStoryboardSnapshot } from "../../server/scaena-storyboard";
import type { ScopeBinding, ServerConfig, Session } from "../../server/contracts";

export const origin = "http://127.0.0.1:4470";

export const scope: ScopeBinding = {
  id: "scope-a",
  tenant: "tenant-a",
  team: "team-a",
  project: "project-a",
  label: "Project A",
  owners: { scaena: { tenant: "tenant-a", project: "scaena-project", actor: "operator", audience: "aud-scaena" } },
  collection: { auctra: { tenant: "tenant-a", project: "project:a", actor: "collector", audience: "aud-auctra" } },
};

export const unboundScope: ScopeBinding = { ...scope, id: "scope-unbound", owners: {}, collection: undefined };

export const config: ServerConfig = {
  origin,
  port: 4470,
  auth_mode: "personal",
  personal: { name: "Owner", password_hash_ref: "/unused", scope_ids: [scope.id, unboundScope.id], role: "admin" },
  collection: { auctra: { origin: "https://auctra.example.test", audience: "aud-auctra", enabled: true } },
  clients: { muweave: { origin: "http://127.0.0.1:4399", enabled: true } },
  owners: { scaena: { origin: "https://scaena.example.test", audience: "aud-scaena" } },
  principals: [{ issuer: "yeisme:personal", subject: "owner", name: "Owner", role: "admin", scopes: [scope, unboundScope] }],
};

export const makeSession = (id = "session-a", epoch = 1): Session => ({
  id, issuer: "yeisme:personal", subject: "owner", name: "Owner", csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 600_000, personal: true, epoch,
});

export function unit(id: string, extra: Partial<AuctraCollectionRecord> = {}): AuctraCollectionRecord {
  return { record_ref: "unit:" + id, record_kind: "text_unit", project_ref: "project:a", unit_ref: id, kind: "screenplay", title: "Title " + id, status: "accepted", updated_at: "2026-10-20T00:00:00.000Z", ...extra };
}

export function seed(store: AuctraCollectionStore, records: AuctraCollectionRecord[], scopeId = scope.id) {
  store.upsertSnapshot(scopeId, { schema_version: "auctra.collection.snapshot.v1", owner: "auctra", scope: scopeId, project_ref: "project:a", observed_at: new Date().toISOString(), coverage: "complete", freshness: "fresh", returned: records.length, total: records.length, records });
}

const stageNames = ["screenplay", "director_plan", "creative_storyboard", "production_handoff"] as const;
const objectKinds = ["screenplay", "director_scene_plan", "storyboard_plan", "production_episode_handoff"] as const;

export function auctraFlow(episode: string, states: string[] = ["accepted", "accepted", "accepted", "accepted"], over: Partial<AuctraCreativeFlowSnapshot> = {}): AuctraCreativeFlowSnapshot {
  const now = new Date().toISOString();
  return {
    schema_version: "auctra.creative_flow_source.v1",
    owner: "auctra",
    project_ref: "project:a",
    episode_ref: episode,
    observed_at: now,
    coverage: "complete",
    stages: stageNames.map((stage, index) => ({
      stage, owner: "auctra" as const, object_kind: objectKinds[index], source_ref: `${stage}:${episode}`, state: states[index], native_state: states[index], revision: "1",
      digest: "sha256:" + "a".repeat(64), observed_at: now, source_current: states[index] === "accepted", episode_ref: episode, blockers: [], safe_refs: [`${stage}:${episode}`],
    })),
    ...over,
  };
}

export function scaenaSnapshot(episode: string, over: Partial<ScaenaStoryboardSnapshot> = {}): ScaenaStoryboardSnapshot {
  const now = new Date().toISOString();
  return {
    owner: "scaena",
    project_ref: "scaena-project",
    observed_at: now,
    coverage: "complete",
    freshness: "fresh",
    items: [{ breakdown_ref: "bd-" + episode, episode_ref: episode, state: "accepted", native_state: "accepted", revision: "3", observed_at: now, blockers: [], scene_count: 2, shot_count: 5, duration_ms: 40_000 }],
    source: { source_ref: "src-" + episode, episode_ref: episode, revision: "1", digest: "sha256:" + "b".repeat(64), state: "accepted", current: true, blockers: [], safe_refs: [] },
    ...over,
  };
}
