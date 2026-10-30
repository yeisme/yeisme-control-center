import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeProcessObservation } from "../src/observation-contract";
import { ProcessTimeline } from "../src/components/ProcessTimeline";
import { promptStateLabel } from "../src/components/PromptCaptureSummary";

describe("process observation gaps", () => {
  it("renders the not-observed state and an explicit observation notice", () => {
    const notObserved = renderToStaticMarkup(createElement(ProcessTimeline));
    const observedEmpty = renderToStaticMarkup(createElement(ProcessTimeline, { observation: {
      schema_version: "yeisme.process_observation.v1",
      state: "active",
      freshness: "fresh",
      coverage: "partial",
      observed_at: "2026-10-27T00:00:00Z",
      checkpoints: [],
      gap: false,
    } }));
    expect(notObserved).toContain('data-process-gap="not-observed"');
    expect(observedEmpty).toContain("来源已返回过程观察，但尚未返回中间检查点");
    expect(observedEmpty).not.toContain('data-process-gap="not-observed"');
  });

  it("does not call expired or integrity-failed observations a checkpoint gap", () => {
    for (const coverage of ["expired", "integrity_failed"] as const) {
      const html = renderToStaticMarkup(createElement(ProcessTimeline, { observation: {
        schema_version: "yeisme.process_observation.v1",
        state: "unknown",
        freshness: "stale",
        coverage,
        observed_at: "2026-10-27T00:00:00Z",
        checkpoints: [],
        gap: true,
      } }));
      expect(html).not.toContain("来源已返回过程观察，但尚未返回中间检查点");
    }
  });

  it("preserves a valid observation with no checkpoints as an explicit gap", () => {
    const observation = normalizeProcessObservation({
      state: "active",
      coverage: "partial",
      freshness: "fresh",
      observed_at: "2026-10-27T00:00:00Z",
      checkpoints: [],
      gap: false,
    });
    expect(observation).toMatchObject({ state: "active", coverage: "partial", checkpoints: [], gap: false });
    expect(observation?.checkpoints).toHaveLength(0);
  });

  it("keeps prompt input metadata separate from untrusted prompt body", () => {
    const observation = normalizeProcessObservation({
      state: "complete",
      coverage: "complete",
      prompt_capture: { state: "captured", source: "owner", readable: false, summary: "已脱敏", observed_at: "2026-10-27T00:00:00Z", raw_prompt: "drop" },
      checkpoints: [],
      gap: false,
    });
    expect(observation?.prompt_capture).toMatchObject({ state: "captured", readable: false, summary: "已脱敏" });
    expect(JSON.stringify(observation)).not.toContain("raw_prompt");
  });

  it("keeps the user-facing prompt status labels explicit", () => {
    expect(promptStateLabel("not_recorded")).toBe("未采集");
    expect(promptStateLabel("captured")).toBe("已采集");
    expect(promptStateLabel("needs_contract" as never)).toBe("needs_contract");
  });
});
