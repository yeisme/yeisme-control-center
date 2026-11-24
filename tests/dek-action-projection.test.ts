import { describe, expect, it } from "vitest";
import {
  dedupeWorkQueueByActionCursor,
  mapOwnerRefToActionProjection,
  projectCreativeFlowCompletionMilestones,
} from "../src/shared/dek-action-projection";
import type { CreativeFlowProjection } from "../src/shared/creative-flow";
import type { WorkQueueItem } from "../src/shared/work-queue";

function sampleItem(overrides: Partial<WorkQueueItem> = {}): WorkQueueItem {
  return {
    work_ref: "work:1",
    kind: "review_required",
    owner: "scaena",
    project: "proj:1",
    scope_id: "scope:1",
    title: "Shot 01",
    state: "in_progress",
    native_state: "running",
    priority: "normal",
    attention_reason: "awaiting review",
    observed_at: "2026-11-13T00:00:00Z",
    freshness: "fresh",
    coverage: "complete",
    revision: "1",
    source_ref: "source:1",
    safe_links: [],
    allowed_actions: [],
    preview_state: "available",
    ...overrides,
  };
}

describe("control center DEK action_id projection", () => {
  it("dedupes Eikona run_id, Scaena submission_ref, and ControlCenter revision by action_id + event_cursor", () => {
    const e1 = mapOwnerRefToActionProjection(
      sampleItem({ owner: "eikona", task_ref: "run_ek_01", revision: "1" }),
      {
        action_id: "dekact_001",
        event_cursor: "1",
        eikona_run_id: "run_ek_01",
        outcome: "ACCEPTED",
      },
    );
    const s2 = mapOwnerRefToActionProjection(
      sampleItem({ owner: "scaena", operation_ref: "sub_sc_01", revision: "2" }),
      {
        action_id: "dekact_001",
        event_cursor: "2",
        scaena_submission_ref: "sub_sc_01",
        readback_ref: "eikona://run/run_ek_01",
        binding_digest: "sha256:aaaa",
        outcome: "BOUND",
      },
    );

    const deduped = dedupeWorkQueueByActionCursor([s2, e1]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.event_cursor).toBe("2");
    expect(deduped[0]?.outcome).toBe("BOUND");
    expect(deduped[0]?.eikona_run_id).toBe("run_ek_01");
    expect(deduped[0]?.scaena_submission_ref).toBe("sub_sc_01");
    expect(deduped[0]?.preview_owner_written).toBe(false);
    expect(deduped[0]?.production_ready).toBe(false);
  });

  it("keeps ACCEPTED strictly separate from COMPLETED, BOUND, and REVIEWED on creative_flow", () => {
    const flow: CreativeFlowProjection = {
      schema_version: "yeisme.creative_flow.v1",
      scope: "scope:1",
      project_ref: "proj:1",
      episode_ref: "ep:01",
      observed_at: "2026-11-13T00:00:00Z",
      coverage: "complete",
      source_coverage: [],
      stages: [
        {
          stage: "screenplay",
          owner: "auctra",
          object_kind: "episode",
          source_ref: "ep:01",
          state: "accepted",
          native_state: "accepted",
          revision: "3",
          observed_at: "2026-11-13T00:00:00Z",
          freshness: "fresh",
          coverage: "complete",
          source_current: true,
          blockers: [],
          safe_refs: [],
        },
      ],
      edges: [],
      launch_contexts: [],
    };

    const acceptedOnly = projectCreativeFlowCompletionMilestones(flow, {
      action_id: "dekact_002",
      event_cursor: "10",
      outcome: "ACCEPTED",
      preview_only: true,
    });
    expect(acceptedOnly.accepted).toBe(true);
    expect(acceptedOnly.completed).toBe(false);
    expect(acceptedOnly.bound).toBe(false);
    expect(acceptedOnly.reviewed).toBe(false);
    expect(acceptedOnly.preview_owner_written).toBe(false);
    expect(acceptedOnly.production_ready).toBe(false);

    const reviewed = projectCreativeFlowCompletionMilestones(flow, {
      action_id: "dekact_002",
      event_cursor: "12",
      readback_ref: "readback://1",
      binding_digest: "sha256:bbbb",
      review_decision_ref: "decision://human-1",
      outcome: "REVIEWED",
    });
    expect(reviewed.accepted).toBe(true);
    expect(reviewed.completed).toBe(true);
    expect(reviewed.bound).toBe(true);
    expect(reviewed.reviewed).toBe(true);
  });
});
