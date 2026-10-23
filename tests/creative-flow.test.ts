import { describe, expect, it } from "vitest";
import { buildCreativeFlow } from "../server/creative-flow";
import { buildWorkQueue } from "../server/work-queue";
import type { AuctraCollectionRecordView } from "../server/db/auctra-collection-store";
import type { ScopeBinding, Session } from "../server/contracts";
import { flowStateFrom } from "../src/shared/creative-flow";
import { auctraFlow } from "./fixtures/drama-fakes";

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


describe("creative flow: episode board rules", () => {
  const scaenaWith = (items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
    owner: "scaena" as const, project_ref: "scaena-project", observed_at: "2026-10-22T00:00:00.000Z", coverage: "complete" as const, freshness: "fresh" as const, items: items as never, ...extra,
  });
  const breakdown = (ref: string, state: string, native: string, revision: string, episode = "ep-1") => ({ breakdown_ref: ref, episode_ref: episode, state, native_state: native, revision, observed_at: "2026-10-22T00:00:00.000Z", blockers: [] });

  it("takes only the newest Scaena breakdown as the production stage", () => {
    const flow = buildCreativeFlow({ scope: "s", project_ref: "p", episode_ref: "ep-1", auctra_flow: auctraFlow("ep-1"), scaena: scaenaWith([breakdown("bd-new", "accepted", "accepted", "3"), breakdown("bd-old", "blocked", "failed", "1")]) });
    const stages = flow.stages.filter((stage) => stage.stage === "production_breakdown");
    expect(stages.map((stage) => stage.source_ref)).toEqual(["bd-new"]);
    expect(flow.next_attention).toBeUndefined();
  });

  it("shows a running breakdown as in progress rather than unknown", () => {
    const flow = buildCreativeFlow({ scope: "s", project_ref: "p", episode_ref: "ep-1", auctra_flow: auctraFlow("ep-1"), scaena: scaenaWith([breakdown("bd-1", "in_progress", "running", "1")]) });
    expect(flow.stages.at(-1)).toMatchObject({ stage: "production_breakdown", state: "in_progress", native_state: "running" });
  });

  it("joins Scaena by its own episode ref when it differs from Auctra's unit ref", () => {
    const input = { scope: "s", project_ref: "p", episode_ref: "ep-3", auctra_flow: auctraFlow("ep-3"), scaena: scaenaWith([breakdown("bd-3", "accepted", "accepted", "1", "episode:03")]) };
    expect(buildCreativeFlow(input).stages.some((stage) => stage.stage === "production_breakdown")).toBe(false);
    const joined = buildCreativeFlow({ ...input, scaena_episode_ref: "episode:03" });
    expect(joined.stages.find((stage) => stage.stage === "production_breakdown")).toMatchObject({ source_ref: "bd-3", episode_ref: "episode:03" });
    expect(joined.stages.filter((stage) => stage.owner === "auctra")).toHaveLength(4);
  });

  it("carries Auctra's own project ref on its stages so hand-off links point at the right project", () => {
    const flow = buildCreativeFlow({ scope: "s", project_ref: "scope-project", episode_ref: "ep-1", auctra_flow: auctraFlow("ep-1"), scaena: scaenaWith([]) });
    expect(flow.stages.filter((stage) => stage.owner === "auctra").every((stage) => stage.project_ref === "project:a")).toBe(true);
  });

  it("normalizes owner states with one vocabulary", () => {
    expect(["queued", "running", "cancelled", "review_required", "superseded", "weird"].map(flowStateFrom)).toEqual(["in_progress", "in_progress", "blocked", "waiting_review", "stale", "unknown"]);
  });
});

describe("creative flow: a breakdown built from an older screenplay", () => {
  const digestOf = (char: string) => "sha256:" + char.repeat(64);
  const flowWith = (sourceRefs: string[], sourceDigest: string) => buildCreativeFlow({
    scope: "s", project_ref: "p", episode_ref: "ep-1",
    auctra_flow: auctraFlow("ep-1", ["accepted", "accepted", "accepted", "accepted"]),
    scaena: {
      owner: "scaena", project_ref: "sp", observed_at: "2026-10-22T00:00:00.000Z", coverage: "complete", freshness: "fresh",
      items: [{ breakdown_ref: "bd-1", episode_ref: "ep-1", state: "accepted", native_state: "accepted", revision: "1", observed_at: "2026-10-22T00:00:00.000Z", blockers: [] }],
      source: { source_ref: "src", episode_ref: "ep-1", revision: "1", digest: sourceDigest, state: "accepted", current: true, blockers: [], safe_refs: sourceRefs },
    },
  });
  // auctraFlow gives the screenplay digest "sha256:" + "a" * 64 and safe_refs ["screenplay:ep-1"].
  const breakdown = (flow: ReturnType<typeof flowWith>) => flow.stages.find((stage) => stage.stage === "production_breakdown")!;

  it("flags the breakdown when it shares Auctra's ref but carries a different source digest", () => {
    const stage = breakdown(flowWith(["src", "screenplay:ep-1"], digestOf("b")));
    expect(stage.blockers).toContain("screenplay_revision_mismatch");
    expect(stage.source_current).toBe(false);
  });

  it("leaves it alone when the digests agree", () => {
    const stage = breakdown(flowWith(["src", "screenplay:ep-1"], digestOf("a")));
    expect(stage.blockers).not.toContain("screenplay_revision_mismatch");
    expect(stage.source_current).toBe(true);
  });

  it("never compares sources that did not come from this screenplay (no shared ref, or only empty refs)", () => {
    for (const refs of [["src"], ["src", "", ""], ["other:ep-1"]]) {
      const stage = breakdown(flowWith(refs, digestOf("b")));
      expect(stage.blockers).not.toContain("screenplay_revision_mismatch");
    }
  });
});
