import { describe, expect, it, vi } from "vitest";
import { buildCreativeFlow } from "../server/creative-flow";
import { dramaNextStep, railFromFlow } from "../src/shared/drama";
import { auctraFlow, scaenaSnapshot } from "./fixtures/drama-fakes";

const flowFor = (states: string[], scaena = scaenaSnapshot("ep-1")) => buildCreativeFlow({ scope: "s", project_ref: "p", episode_ref: "ep-1", auctra_flow: auctraFlow("ep-1", states), scaena });
const emptyScaena = scaenaSnapshot("ep-1", { items: [], source: undefined });

describe("drama rail", () => {
  it("always has five nodes in pipeline order with the right owners", () => {
    const rail = railFromFlow(flowFor(["accepted", "accepted", "accepted", "accepted"]));
    expect(rail.map((node) => `${node.stage}:${node.owner}:${node.state}`)).toEqual([
      "screenplay:auctra:accepted", "director_plan:auctra:accepted", "creative_storyboard:auctra:accepted", "production_handoff:auctra:accepted", "production_breakdown:scaena:accepted",
    ]);
  });

  it("marks a stage that its owner read cleanly but has nothing for as not started", () => {
    const rail = railFromFlow(flowFor(["accepted", "accepted", "accepted", "accepted"], emptyScaena));
    expect(rail.at(-1)).toMatchObject({ stage: "production_breakdown", state: "not_started", coverage: "complete" });
  });

  it("explains an absent stage by its owner's coverage instead of calling it not started", () => {
    const flow = flowFor(["accepted", "accepted", "accepted", "accepted"], scaenaSnapshot("ep-1", { items: [], source: undefined, coverage: "unavailable", blocker: "owner_unavailable" }));
    expect(railFromFlow(flow).at(-1)).toMatchObject({ state: "unavailable", coverage: "unavailable" });
  });

  it("surfaces the first blocker on a stage", () => {
    const flow = buildCreativeFlow({ scope: "s", project_ref: "p", episode_ref: "ep-1", auctra_flow: auctraFlow("ep-1", ["accepted", "accepted", "accepted", "accepted"], {}), scaena: scaenaSnapshot("ep-1", { items: [{ breakdown_ref: "bd", episode_ref: "ep-1", state: "blocked", native_state: "failed", revision: "1", observed_at: new Date().toISOString(), blockers: ["breakdown_cancelled"] }] }) });
    expect(railFromFlow(flow).at(-1)).toMatchObject({ state: "blocked", blocker: "breakdown_cancelled" });
  });
});

describe("drama next step", () => {
  it("names the owner and stage when something needs attention", () => {
    const flow = flowFor(["accepted", "accepted", "waiting_review", "missing"]);
    expect(dramaNextStep(railFromFlow(flow), flow.next_attention)).toMatchObject({ kind: "attention", stage: "creative_storyboard", owner: "auctra", action: "review" });
  });

  it("calls an unstarted stage the next thing to begin, not a fault", () => {
    const flow = flowFor(["accepted", "accepted", "accepted", "missing"], emptyScaena);
    expect(flow.next_attention?.stage).toBe("production_handoff");
    expect(dramaNextStep(railFromFlow(flow), flow.next_attention)).toMatchObject({ kind: "start", stage: "production_handoff", owner: "auctra" });
  });

  it("is done only when every stage is accepted and fresh", () => {
    const flow = flowFor(["accepted", "accepted", "accepted", "accepted"]);
    expect(flow.next_attention).toBeUndefined();
    expect(dramaNextStep(railFromFlow(flow), flow.next_attention)).toEqual({ kind: "done" });
  });
});

describe("Auctra flow coverage", () => {
  const owner = (stages: Array<[string, string, string]>, coverage: string) => {
    const now = new Date().toISOString();
    return { data: { schema_version: "auctra.creative_flow_source.v1", project_ref: "project:a", episode_ref: "ep-2", observed_at: now, coverage, stages: stages.map(([stage, state, native]) => ({
      stage, owner: "auctra", object_kind: stage, source_ref: `${stage}:ep-2`, state, native_state: native, revision: "1", observed_at: now, source_current: state === "accepted", episode_ref: "ep-2", safe_refs: [], blockers: [],
    })) } };
  };
  const read = async (body: unknown) => {
    const { AuctraCollectionReader } = await import("../server/auctra");
    const { config, makeSession, scope } = await import("./fixtures/drama-fakes");
    return new AuctraCollectionReader(config, (async () => Response.json(body)) as unknown as typeof fetch).creativeFlow(scope.id, { ...scope, collection: { auctra: { tenant: "t", project: "project:a", actor: "a", audience: "aud-auctra" } } }, { ...makeSession(), accessToken: "token", accessAudience: ["aud-auctra"] }, { episode_ref: "ep-2" });
  };

  it("treats the owner's `partial` as pipeline progress, so an accepted screenplay is not flagged for attention", async () => {
    const snapshot = await read(owner([["screenplay", "accepted", "accepted"], ["director_plan", "accepted", "accepted"], ["creative_storyboard", "waiting_review", "pending_review"], ["production_handoff", "missing", "missing"]], "partial"));
    expect(snapshot.coverage).toBe("complete");
    const flow = buildCreativeFlow({ scope: "s", project_ref: "p", episode_ref: "ep-2", auctra_flow: snapshot, scaena: scaenaSnapshot("ep-2", { items: [], source: undefined }) });
    expect(flow.next_attention).toMatchObject({ stage: "creative_storyboard", action: "review" });
    const rail = railFromFlow(flow);
    expect(rail.map((node) => node.state)).toEqual(["accepted", "accepted", "waiting_review", "missing", "not_started"]);
    expect(dramaNextStep(rail, flow.next_attention)).toMatchObject({ kind: "attention", stage: "creative_storyboard", owner: "auctra" });
  });

  it("still reports a real read failure as a coverage gap", async () => {
    const snapshot = await read({ error: "x" });
    expect(["needs_contract", "unavailable"]).toContain(snapshot.coverage);
    expect(snapshot.stages).toEqual([]);
  });

  it("reports a scope with no Auctra connection as needs_contract, not as denied", async () => {
    const { AuctraCollectionReader } = await import("../server/auctra");
    const { config, makeSession, unboundScope } = await import("./fixtures/drama-fakes");
    const fetcher = (async () => Response.json({})) as unknown as typeof fetch;
    const snapshot = await new AuctraCollectionReader(config, fetcher).creativeFlow(unboundScope.id, unboundScope, makeSession(), { episode_ref: "ep-2" });
    expect(snapshot).toMatchObject({ coverage: "needs_contract", blocker: "source_not_configured" });
  });
});

describe("drama labels", () => {
  it("reads known camera vocabulary in Chinese and keeps unknown tokens visible", async () => {
    const { shotSizeLabel, cameraAngleLabel, cameraMovementLabel, formatShotDuration, nextStepText } = await import("../src/shared/read-model/drama");
    expect([shotSizeLabel("close_up"), cameraAngleLabel("over_the_shoulder"), cameraMovementLabel("handheld_push")]).toEqual(["近景", "过肩", "手持推进"]);
    expect(cameraMovementLabel("whip_pan")).toBe("whip pan");
    expect(shotSizeLabel(undefined)).toBe("—");
    expect([formatShotDuration(9000), formatShotDuration(6500), formatShotDuration(94000), formatShotDuration(null)]).toEqual(["9 秒", "6.5 秒", "1 分 34 秒", "—"]);
    expect(nextStepText).toBeTypeOf("function");
  });

  it("words the next step without leaking state codes, and treats an unaccepted screenplay as waiting rather than failing", async () => {
    const { nextStepText, railNodeInfo } = await import("../src/shared/read-model/drama");
    const review = flowFor(["accepted", "accepted", "waiting_review", "missing"], emptyScaena);
    expect(nextStepText(railFromFlow(review), review.next_attention).text).toBe("待审阅：创意分镜（Auctra）");
    const stale = flowFor(["accepted", "accepted", "accepted", "stale"], emptyScaena);
    expect(nextStepText(railFromFlow(stale), stale.next_attention).text).toMatch(/^需处理：制作交接（Auctra）$/);
    expect(nextStepText(railFromFlow(flowFor(["accepted", "accepted", "accepted", "accepted"])), undefined).tone).toBe("success");
    expect(railNodeInfo({ state: "blocked", blocker: "source_not_accepted" })).toMatchObject({ label: "待采纳", tone: "neutral" });
    expect(railNodeInfo({ state: "blocked", blocker: "breakdown_cancelled" })).toMatchObject({ label: "受阻", tone: "danger" });
  });
});

describe("drama next step during an outage", () => {
  const unreadable = (state: "unavailable" | "forbidden" | "needs_contract") => flowFor(["accepted", "accepted", "accepted", "accepted"], scaenaSnapshot("ep-1", { items: [], source: undefined, coverage: state, blocker: "owner_unavailable" }));

  it("never calls an unread episode finished", async () => {
    const { nextStepText } = await import("../src/shared/read-model/drama");
    for (const state of ["unavailable", "forbidden", "needs_contract"] as const) {
      const flow = unreadable(state);
      expect(dramaNextStep(railFromFlow(flow), flow.next_attention)).toMatchObject({ kind: "unreadable", stage: "production_breakdown", owner: "scaena" });
      expect(nextStepText(railFromFlow(flow), flow.next_attention)).toMatchObject({ tone: "warning", text: expect.stringContaining("暂时读不到：制作拆解（Scaena）") });
    }
  });

  it("does not claim progress when neither owner could be read", () => {
    const flow = buildCreativeFlow({ scope: "s", project_ref: "p", episode_ref: "ep-1", auctra_flow: auctraFlow("ep-1", [], { coverage: "unavailable", stages: [], blocker: "owner_unavailable" }), scaena: scaenaSnapshot("ep-1", { items: [], source: undefined, coverage: "unavailable", blocker: "owner_unavailable" }) });
    const rail = railFromFlow(flow);
    expect(rail.every((node) => node.state === "unavailable")).toBe(true);
    expect(dramaNextStep(rail, flow.next_attention).kind).toBe("unreadable");
  });
});

describe("drama next step: problems before 'start the next stage'", () => {
  const node = (stage: string, state: string, extra: Record<string, unknown> = {}) => ({ stage, owner: stage === "production_breakdown" ? "scaena" : "auctra", state, coverage: "complete", freshness: "fresh", source_current: state === "accepted", observed_at: "2026-10-22T00:00:00.000Z", ...extra }) as never;
  const stages = ["screenplay", "director_plan", "creative_storyboard", "production_handoff", "production_breakdown"];
  const rail = (states: Record<string, string>, extra: Record<string, Record<string, unknown>> = {}) => stages.map((stage) => node(stage, states[stage] || "accepted", extra[stage]));

  it("reports a failed breakdown even when an earlier stage has not been started", () => {
    const step = dramaNextStep(rail({ director_plan: "missing", production_breakdown: "blocked" }, { production_breakdown: { blocker: "breakdown_cancelled" } }));
    expect(step).toMatchObject({ kind: "attention", stage: "production_breakdown", owner: "scaena", action: "repair", reason: "breakdown_cancelled" });
  });

  it("puts a real fault ahead of a screenplay that is merely waiting to be accepted", () => {
    const step = dramaNextStep(rail({ screenplay: "blocked", production_breakdown: "stale" }, { screenplay: { blocker: "source_not_accepted" } }));
    expect(step).toMatchObject({ kind: "attention", stage: "production_breakdown" });
    expect(dramaNextStep(rail({ screenplay: "blocked" }, { screenplay: { blocker: "source_not_accepted" } }))).toMatchObject({ kind: "attention", stage: "screenplay", reason: "source_not_accepted" });
  });

  it("treats an accepted stage whose source is no longer current as a problem", () => {
    const step = dramaNextStep(rail({}, { production_breakdown: { source_current: false, blocker: "screenplay_revision_mismatch" } }));
    expect(step).toMatchObject({ kind: "attention", stage: "production_breakdown", reason: "screenplay_revision_mismatch" });
  });

  it("starts the first unstarted stage only when nothing is wrong, and calls running work 'in progress'", async () => {
    const { nextStepText } = await import("../src/shared/read-model/drama");
    expect(dramaNextStep(rail({ production_handoff: "missing", production_breakdown: "not_started" }))).toMatchObject({ kind: "start", stage: "production_handoff" });
    const running = rail({ production_breakdown: "in_progress" }, { production_breakdown: { source_current: false } });
    expect(dramaNextStep(running)).toMatchObject({ kind: "in_progress", stage: "production_breakdown", owner: "scaena" });
    expect(nextStepText(running, undefined)).toEqual({ text: "进行中：制作拆解（Scaena）", tone: "info" });
  });

  it("does not call a stage nobody answered a problem; that is unreadable", () => {
    const unanswered = rail({ production_breakdown: "unknown" }, { production_breakdown: { observed_at: undefined, source_current: false } });
    expect(dramaNextStep(unanswered)).toMatchObject({ kind: "unreadable", stage: "production_breakdown" });
    const reported = rail({ production_breakdown: "unknown" }, { production_breakdown: { source_current: false } });
    expect(dramaNextStep(reported)).toMatchObject({ kind: "attention", stage: "production_breakdown", action: "inspect" });
  });

  it("marks the same stage the sentence is about on the rail", async () => {
    const { currentStage } = await import("../src/shared/read-model/drama");
    const flow = { rail: rail({ director_plan: "missing", production_breakdown: "blocked" }), next_attention: { stage: "director_plan", owner: "auctra", action: "inspect", reason: "missing", evidence_refs: [] } } as never;
    expect(currentStage(flow)).toBe("production_breakdown");
  });
});

describe("Auctra reader guards", () => {
  const stage = (over: Record<string, unknown> = {}) => ({ stage: "screenplay", owner: "auctra", object_kind: "screenplay", source_ref: "s", state: "accepted", native_state: "accepted", observed_at: new Date().toISOString(), source_current: true, episode_ref: "ep-2", safe_refs: ["s"], ...over });
  const reader = async (body: unknown, fetcher = (async () => Response.json(body)) as unknown as typeof fetch) => {
    const { AuctraCollectionReader } = await import("../server/auctra");
    const { config, makeSession, scope } = await import("./fixtures/drama-fakes");
    return (episode?: string) => new AuctraCollectionReader(config, fetcher).creativeFlow(scope.id, scope, { ...makeSession(), accessToken: "t", accessAudience: ["aud-auctra"] }, episode ? { episode_ref: episode } : {});
  };
  const envelope = (episode: string, stages: unknown[]) => ({ data: { schema_version: "auctra.creative_flow_source.v1", project_ref: "project:a", episode_ref: episode, observed_at: new Date().toISOString(), coverage: "partial", stages } });

  it("makes no request at all without an episode", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    const read = await reader({}, fetcher as unknown as typeof fetch);
    expect(await read()).toMatchObject({ coverage: "unknown", blocker: "episode_ref_required", stages: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses stages that describe a different episode than the one asked for", async () => {
    const read = await reader(envelope("ep-9", [stage({ episode_ref: "ep-9" })]));
    expect(await read("ep-2")).toMatchObject({ coverage: "needs_contract", stages: [] });
  });

  it("keeps only well-formed blocker tokens, so a malformed value cannot crash anything downstream", async () => {
    const read = await reader(envelope("ep-2", [stage({ blockers: "not-an-array" }), stage({ stage: "director_plan", blockers: ["ok_token", 7, "x".repeat(300), "bad token"] })]));
    const snapshot = await read("ep-2");
    expect(snapshot.stages.map((item) => item.blockers)).toEqual([[], ["ok_token"]]);
  });
});
