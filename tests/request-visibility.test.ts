import { describe, expect, it } from "vitest";
import {
  matchesRequest,
  summarizeRequests,
  defaultRequestQuery,
  type RequestProjection,
} from "../src/request-visibility";
const time = "2026-10-03T00:00:00Z";
const row: RequestProjection = {
  id: "r1",
  owner: "eikona",
  tenant: "a",
  project: "p",
  title: "same",
  kind: "generation",
  state: "succeeded",
  native_state: "succeeded",
  actor: "one",
  actor_type: "human",
  created_at: time,
  duration_ms: null,
  model: null,
  parent_ref: null,
  attempts: [{ ref: "attempt:1", state: "succeeded" }],
  output_refs: ["asset:one"],
  attachments: [
    {
      ref: "file:one",
      name: "one.png",
      mime: "image/png",
      bytes: 100,
      source: "upload",
      state: "complete",
      upload_ref: "upload:one",
      downloadable: false,
    },
  ],
  input: "complete",
  output: "partial",
  submitted: {},
  effective: {},
  coverage: { owner: "eikona", state: "complete", observed_at: time },
};
const coverage = [row.coverage];
describe("request visibility facts", () => {
  it("deduplicates explicit owner request, attempt, upload and asset identities", () => {
    const s = summarizeRequests(
      [row, row, { ...row, id: "r2" }],
      time,
      time,
      coverage,
    );
    expect(s.generation.value).toBe(2);
    expect(s.attempts.value).toBe(1);
    expect(s.outputs.value).toBe(1);
    expect(s.uploaded_files.value).toBe(1);
    expect(s.uploaded_bytes.value).toBe(100);
  });
  it("does not count reused assets as uploaded bytes or fill missing bytes with zero", () => {
    const r = {
      ...row,
      attachments: [
        { ...row.attachments[0], bytes: null },
        {
          ...row.attachments[0],
          source: "reference" as const,
          ref: "asset:ref",
        },
      ],
    };
    const s = summarizeRequests([r], time, time, coverage);
    expect(s.uploaded_bytes.value).toBeNull();
    expect(s.referenced_assets.value).toBe(1);
  });
  it("partial source coverage stays visible even with no rows", () => {
    const s = summarizeRequests([], time, time, [
      { ...row.coverage, state: "unavailable" },
    ]);
    expect(s.generation.state).toBe("partial");
  });
  it("combined filters and unknown timestamps do not fabricate matches", () => {
    const q = {
      ...defaultRequestQuery(new Date(time)),
      input_type: "image",
      attachments: "yes",
      outputs: "yes",
    };
    expect(matchesRequest(row, q)).toBe(true);
    expect(matchesRequest({ ...row, created_at: "" }, q)).toBe(false);
    expect(matchesRequest(row, { ...q, owner: "sonora" })).toBe(false);
  });
});
