import { describe, expect, it } from "vitest";
import { emptyCreativeInput, validateCreativeInput, type CreativeInputSpec } from "../src/shared/creative-input";

const capability = {
  input_modes: ["keyframe_video", "image_to_image"] as const,
  reference_roles: ["subject", "first_frame", "last_frame", "keyframe"] as const,
  timeline_support: { enabled: true, requires_start_end: true, max_keyframes: 4, transitions: ["cut"] as const },
  limits: { max_duration_ms: 10_000, max_keyframes: 4, max_variants: 4 },
};

function keyframeInput(patch: Partial<CreativeInputSpec> = {}): CreativeInputSpec {
  return {
    ...emptyCreativeInput("video-model"),
    generation_mode: "keyframe_video",
    prompt: "雨夜街道",
    references: [{ ref: "artifact:one", source: "artifact", name: "one.png", mime: "image/png", bytes: 10, roles: ["first_frame"], access: "authorized" }],
    timeline: { duration_ms: 5000, keyframes: [
      { id: "start", at_ms: 0, reference_refs: ["artifact:one"] },
      { id: "end", at_ms: 5000, reference_refs: ["artifact:one"] },
    ], transition: "cut" },
    ...patch,
  };
}

describe("creative input contract", () => {
  it("accepts a bounded keyframe video input", () => {
    expect(validateCreativeInput(keyframeInput(), capability).valid).toBe(true);
  });

  it("requires start and end keyframes and rejects unordered time", () => {
    expect(validateCreativeInput(keyframeInput({ timeline: { duration_ms: 5000, keyframes: [{ id: "one", at_ms: 1000, reference_refs: [] }], transition: "cut" } }), capability).errors).toContain("关键帧视频需要首帧。");
    expect(validateCreativeInput(keyframeInput({ timeline: { duration_ms: 5000, keyframes: [{ id: "one", at_ms: 0, reference_refs: [] }, { id: "two", at_ms: 0, reference_refs: [] }, { id: "end", at_ms: 5000, reference_refs: [] }], transition: "cut" } }), capability).errors).toContain("关键帧时间必须在时间线内且严格递增。");
    expect(validateCreativeInput(keyframeInput({ timeline: { duration_ms: 5000, keyframes: [{ id: "end", at_ms: 5000, reference_refs: [] }, { id: "start", at_ms: 0, reference_refs: [] }], transition: "cut" } }), capability).errors).toContain("关键帧必须按时间轴顺序递增。");
  });

  it("keeps unsupported modes as contract gaps", () => {
    const input = { ...emptyCreativeInput("image-model"), generation_mode: "text_to_image" as const };
    expect(validateCreativeInput(input, capability).errors).toContain("owner 尚未声明该创作模式。");
  });
});
