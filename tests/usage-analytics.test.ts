import { describe, expect, it } from "vitest";
import { confirmedTotals, dedupeUsage } from "../src/pages/usage/UsageAnalytics";
import type { UsageEvent } from "../src/shared/api/control-center-client";

const event = (owner: UsageEvent["owner"], sourceRef: string, cost: number | null, patch: Partial<UsageEvent> = {}): UsageEvent => ({
  source_ref: sourceRef,
  trace_ref: "trace-" + sourceRef,
  owner,
  model_ref: "model",
  modality: "image",
  quantity: 1,
  unit: "images",
  upstream_cost: cost,
  currency: "CNY",
  cost_state: cost === null ? "unknown" : "confirmed",
  status: "succeeded",
  project_ref: "p",
  created_at: "2026-10-14T12:00:00+08:00",
  ...patch,
});

describe("usage analytics projections", () => {
  it("deduplicates repeated receipts by owner and source reference", () => {
    const unique = dedupeUsage([
      event("eikona", "call-1", 12.8),
      event("eikona", "call-1", 12.8, { trace_ref: "replayed" }),
      event("sonora", "call-1", 6.4),
    ]);
    expect(unique.map((row) => `${row.owner}:${row.source_ref}`)).toEqual(["eikona:call-1", "sonora:call-1"]);
    expect(unique[0].trace_ref).toBe("trace-call-1");
  });

  it("sums only confirmed cost per currency and never counts unknown as zero", () => {
    const totals = confirmedTotals([
      event("eikona", "a", 2),
      event("eikona", "b", 3, { cost_state: "estimated" }),
      event("scaena", "c", null),
      event("sonora", "d", 1.5, { currency: "USD" }),
    ]);
    expect(totals).toEqual({ CNY: 2, USD: 1.5 });
  });
});
