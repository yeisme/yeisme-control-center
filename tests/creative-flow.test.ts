import { describe, expect, it } from "vitest";
import { buildCreativeFlow } from "../server/creative-flow";
import { buildWorkQueue } from "../server/work-queue";
import type { AuctraCollectionRecordView } from "../server/db/auctra-collection-store";
import type { ScopeBinding, Session } from "../server/contracts";

const record = (record_kind: string, record_ref: string, status: string): AuctraCollectionRecordView => ({
  record_ref,
  record_kind,
  project_ref: "project-a",
  status,
  source_revision: "rev-1",
  source_digest: "sha256:abc",
  collection_state: "active",
  source_state: "fresh",
  metadata_revision: 1,
  labels: [],
  note: "",
  confirmed_at: null,
  confirmed_by: null,
  archived_at: null,
  archived_by: null,
  first_seen_at: "2026-10-20T00:00:00.000Z",
  last_seen_at: "2026-10-20T00:01:00.000Z",
});

describe("creative flow projection", () => {
  it("connects Auctra planning stages to a Scaena breakdown", () => {
    const flow = buildCreativeFlow({
      scope: "scope-a",
      project_ref: "project-a",
      episode_ref: "episode-1",
      auctra_records: [
        record("screenplay", "screenplay-1", "accepted"),
        record("director_plan", "director-1", "waiting_review"),
        record("storyboard_plan", "storyboard-1", "accepted"),
        record("production_handoff", "handoff-1", "ready"),
      ],
      auctra_coverage: "complete",
      scaena: {
        owner: "scaena",
        project_ref: "project-a",
        observed_at: "2026-10-20T00:01:00.000Z",
        coverage: "complete",
        freshness: "fresh",
        items: [{ breakdown_ref: "breakdown-1", episode_ref: "episode-1", state: "waiting_review", native_state: "review_required", revision: "3", observed_at: "2026-10-20T00:01:00.000Z", blockers: [] }],
      },
    });
    expect(flow.schema_version).toBe("yeisme.creative_flow.v1");
    expect(flow.stages.map((stage) => stage.stage)).toEqual(["screenplay", "director_plan", "creative_storyboard", "production_handoff", "production_breakdown"]);
    expect(flow.edges).toHaveLength(4);
    expect(flow.next_attention?.stage).toBe("director_plan");
  });

  it("keeps missing owner coverage explicit", () => {
    const flow = buildCreativeFlow({
      scope: "scope-a",
      project_ref: "project-a",
      auctra_records: [],
      auctra_coverage: "needs_contract",
      scaena: { owner: "scaena", project_ref: "project-a", observed_at: "2026-10-20T00:01:00.000Z", coverage: "needs_contract", freshness: "unknown", items: [], blocker: "storyboard_binding_missing" },
    });
    expect(flow.coverage).toBe("partial");
    expect(flow.stages).toEqual([]);
    expect(flow.next_attention).toBeUndefined();
    const queue = buildWorkQueue({
      scope: { id: "scope-a", tenant: "tenant-a", team: "team-a", project: "project-a", label: "Project A", owners: {} } as ScopeBinding,
      session: { id: "session-a", issuer: "test", subject: "owner", name: "Owner", csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, epoch: 1 } as Session,
      tasks: [], connections: [], notifications: [], creativeFlow: flow,
    });
    expect(queue.items.some((item) => item.kind === "contract_gap" && item.object_kind === "creative_flow")).toBe(true);
  });

  it("builds a configured MuWeave URL from safe refs only", () => {
    const flow = buildCreativeFlow({
      scope: "scope-a",
      project_ref: "project-a",
      episode_ref: "episode-1",
      auctra_records: [record("storyboard_plan", "storyboard-1", "waiting_review")],
      auctra_coverage: "complete",
      scaena: { owner: "scaena", project_ref: "project-a", observed_at: "2026-10-20T00:01:00.000Z", coverage: "needs_contract", freshness: "unknown", items: [], blocker: "storyboard_binding_missing" },
    });
    const scope = { id: "scope-a", tenant: "tenant-a", team: "team-a", project: "project-a", label: "Project A", owners: {} } as ScopeBinding;
    const session = { id: "session-a", issuer: "test", subject: "owner", name: "Owner", csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, epoch: 1 } as Session;
    const queue = buildWorkQueue({ scope, session, tasks: [], connections: [], notifications: [], creativeFlow: flow, clientOrigins: { muweave: "https://muweave.example.test" } });
    const item = queue.items.find((value) => value.workflow_stage === "creative_storyboard");
    const launch = item?.safe_links.find((value) => value.target === "muweave")?.launch;
    expect(launch?.url).toContain("https://muweave.example.test/");
    expect(launch?.url).toContain("project=project-a");
    expect(launch?.url).toContain("#/script");
    expect(launch?.url).not.toContain("Authorization");
  });

  it("does not merge multiple episodes without an explicit episode ref", () => {
    const flow = buildCreativeFlow({
      scope: "scope-a",
      project_ref: "project-a",
      auctra_records: [
        { ...record("screenplay", "screenplay-1", "accepted"), unit_ref: "episode-1" },
        { ...record("screenplay", "screenplay-2", "accepted"), unit_ref: "episode-2" },
      ],
      auctra_coverage: "complete",
      scaena: { owner: "scaena", project_ref: "project-a", observed_at: "2026-10-20T00:01:00.000Z", coverage: "needs_contract", freshness: "unknown", items: [] },
    });
    expect(flow.stages).toEqual([]);
    expect(flow.next_attention?.reason).toBe("episode_ref_required");
  });

  it("deduplicates same owner object revision in the work queue", () => {
    const flow = buildCreativeFlow({
      scope: "scope-a",
      project_ref: "project-a",
      episode_ref: "episode-1",
      auctra_records: [record("storyboard_plan", "storyboard-1", "waiting_review"), record("storyboard_plan", "storyboard-1", "waiting_review")],
      auctra_coverage: "complete",
      scaena: { owner: "scaena", project_ref: "project-a", observed_at: "2026-10-20T00:01:00.000Z", coverage: "needs_contract", freshness: "unknown", items: [] },
    });
    const queue = buildWorkQueue({
      scope: { id: "scope-a", tenant: "tenant-a", team: "team-a", project: "project-a", label: "Project A", owners: {} } as ScopeBinding,
      session: { id: "session-a", issuer: "test", subject: "owner", name: "Owner", csrf: "csrf", accessToken: "", accessAudience: [], expires: Date.now() + 60_000, epoch: 1 } as Session,
      tasks: [], connections: [], notifications: [], creativeFlow: flow,
    });
    expect(queue.items.filter((item) => item.workflow_stage === "creative_storyboard")).toHaveLength(1);
  });
});

