import { describe, expect, it } from "vitest";
import { dedupeUsageFacts } from "../src/workspace-v18/usage-analytics";
import type { UsageFact } from "../src/workspace-v18/types";

const fact = (id: string, sourceRef: string, cost: number): UsageFact => ({
  id,
  createdAt: "2026-10-14T12:00:00+08:00",
  projectId: "rain",
  projectName: "雨夜重逢",
  member: "陈序",
  provider: "Eikona",
  model: "GPT Image 2.5 Sunburst",
  modality: "图像",
  traceRef: "trace-1",
  sourceRef,
  quantity: 1,
  unit: "images",
  upstreamCost: cost,
  currency: "CNY",
  costState: "confirmed",
  status: "succeeded",
  durationMs: 1000,
});

describe("usage analytics projections", () => {
  it("deduplicates repeated source references before chart aggregation", () => {
    const unique = dedupeUsageFacts([
      fact("1", "model-call-1", 12.8),
      fact("1-replayed", "model-call-1", 12.8),
      fact("2", "model-call-2", 6.4),
    ]);
    expect(unique.map((row) => row.id)).toEqual(["1", "2"]);
  });
});
