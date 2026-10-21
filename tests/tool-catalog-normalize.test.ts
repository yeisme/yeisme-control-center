import { describe, expect, it } from "vitest";
import {
  canonicalJSON,
  deriveCreativeContract,
  digestOf,
  eikonaActions,
  normalizeChannels,
  normalizeModels,
  normalizeTools,
  scaenaGuide,
  sonoraDiscovery,
  summarizeSchema,
} from "../server/tool-catalog-normalize";
import { eikonaChannels, eikonaModels, eikonaRuntimeCapabilities, providerTools, scaenaGuide as scaenaGuideFixture, sonoraDiscovery as sonoraDiscoveryFixture } from "../scripts/fixtures/provider-catalog";

describe("tool catalog normalization", () => {
  it("digests schemas independent of key order and summarizes top-level fields", () => {
    const a = { type: "object", properties: { b: { type: "string" }, a: { type: "integer", enum: [2, 4], default: 2 } }, required: ["a"] };
    const b = { required: ["a"], properties: { a: { default: 2, enum: [2, 4], type: "integer" }, b: { type: "string" } }, type: "object" };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    expect(digestOf(a)).toBe(digestOf(b));
    const summary = summarizeSchema(a);
    expect(summary.fields).toEqual([
      { name: "b", type: "string", required: false, description: null, enum: null, default: null },
      { name: "a", type: "integer", required: true, description: null, enum: ["2", "4"], default: "2" },
    ]);
    expect(summary.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("drops secret-looking fields and bounds large schemas", () => {
    const properties = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field_${i}`, { type: "string", description: "x".repeat(400) }]));
    const summary = summarizeSchema({ type: "object", properties: { ...properties, api_key: { type: "string" }, access_token: { type: "string" } } });
    expect(summary.fields.some((field) => /key|token/.test(field.name))).toBe(false);
    expect(summary.fields).toHaveLength(40);
    expect(summary.truncated).toBe(true);
    expect(summary.fields[0].description!.length).toBeLessThanOrEqual(280);
  });

  it("keeps tool annotations as declared and marks the owner dispatcher", () => {
    const [first, second] = providerTools("eikona", 0);
    const tools = normalizeTools("eikona", [...first, ...second, { name: "eikona.execute" }, { title: "nameless" }]);
    expect(tools.map((tool) => tool.name)).toEqual(["eikona.execute", "eikona.search", "eikona.fetch"]);
    expect(tools[0]).toMatchObject({ dispatcher: true, annotations: { read_only: false, open_world: true } });
    expect(tools[2].annotations).toEqual({ read_only: true, destructive: null, idempotent: true, open_world: null });
  });

  it("derives Eikona risk tiers from declared kinds without defaulting to read-only", () => {
    const { actions } = eikonaActions(eikonaRuntimeCapabilities());
    const byName = Object.fromEntries(actions.map((action) => [action.name, action]));
    expect(byName.generate).toMatchObject({ risk: "paid_external", creative_mode: "text_to_image", availability: "unknown" });
    expect(byName.upscale.creative_mode).toBe("image_upscale");
    expect(byName["models.readiness"].risk).toBe("read_only");
    expect(byName["delivery.create"].risk).toBe("mutation");
    expect(byName["assets.qualification.accept"]).toMatchObject({ risk: "human_gate", availability: "blocked" });
    const unknown = eikonaActions({ actions: [{ action: "mystery", kind: "novel" }] }).actions[0];
    expect(unknown.risk).toBe("unknown");
  });

  it("maps Sonora lanes and readiness without inventing music creative modes", () => {
    const parsed = sonoraDiscovery(sonoraDiscoveryFixture());
    const byName = Object.fromEntries(parsed.actions.map((action) => [action.name, action]));
    expect(byName["voice.audition"]).toMatchObject({ risk: "paid_external", creative_mode: "text_to_audio", requires_confirm: true });
    expect(byName["music.generate"]).toMatchObject({ risk: "paid_external", creative_mode: null });
    expect(byName["music.estimate"].risk).toBe("read_only");
    expect(byName["voice.audition"].input.fields.find((field) => field.name === "text")?.required).toBe(true);
    expect(parsed.readiness.find((entry) => entry.domain === "music.yue2")?.status).toBe("planned");
  });

  it("passes through owner model status and never infers latest_ready", () => {
    const models = normalizeModels("eikona", eikonaModels(0).data, "eikona://models/readiness");
    const byRef = Object.fromEntries(models.map((model) => [model.model_ref, model]));
    expect(byRef["openai/gpt-image-2.5-sunburst"]).toMatchObject({ status: "latest_ready", status_source: "owner", channel: "openrouter" });
    expect(byRef["openai/gpt-image-1"].status).toBe("historical");
    expect(byRef["stability/sd-3.5"]).toMatchObject({ status: "unknown", status_source: "undeclared" });
    expect(normalizeModels("eikona", [{ model_ref: "x", status: "ready" }], "test")[0].status).toBe("unknown");
  });

  it("parses channel.summary.v1 and treats unknown observations as absent", () => {
    const channels = normalizeChannels("eikona", eikonaChannels(0));
    expect(channels.map((channel) => [channel.channel_id, channel.status])).toEqual([["openrouter", "ready"], ["kie", "ready"], ["legacy-gateway", "blocked"]]);
    expect(channels[0]).toMatchObject({ observed_at: null, last_success: null, note_required: true, routing: { priority: 10, default: true } });
  });

  it("projects Scaena guide channels, models and pinned action risks", () => {
    const parsed = scaenaGuide(scaenaGuideFixture(0));
    expect(parsed.latest_policy).toContain("latest mainline");
    expect(parsed.native_channels).toEqual(["kie", "openrouter"]);
    const risks = Object.fromEntries(parsed.actions.map((action) => [action.name, action.risk]));
    expect(risks).toMatchObject({ createVideoProviderTask: "paid_external", getVideoProviderTask: "read_only", reconcileVideoProviderTask: "remote_query", submitProviderAssetRegistration: "human_gate" });
    const disabled = parsed.models.find((model) => model.model_ref === "seedance25-ark-text-1080p");
    expect(disabled).toMatchObject({ readiness: "disabled", status: "unknown", warnings: ["binding_disabled"] });
  });

  it("derives AI creation contracts only from enabled bindings and available actions", () => {
    const guide = scaenaGuide(scaenaGuideFixture(0));
    const video = deriveCreativeContract("scaena", { actions: guide.actions, bindings: guide.bindings });
    expect(video.input_modes).toEqual(["text_to_video", "image_to_video", "keyframe_video"]);
    expect(video.timeline_support).toMatchObject({ enabled: true, requires_start_end: true, max_keyframes: 2 });
    expect(video.output_constraints.durations_ms).toEqual([5000, 8000]);
    expect(video.output_constraints.resolutions).not.toContain(undefined);
    const image = deriveCreativeContract("eikona", eikonaActions(eikonaRuntimeCapabilities()));
    expect(image.input_modes).toEqual(["text_to_image", "image_to_image", "image_upscale"]);
    expect(image.output_constraints.ratios).toEqual(["1:1", "16:9", "9:16", "4:3"]);
    const blocked = deriveCreativeContract("eikona", { actions: eikonaActions(eikonaRuntimeCapabilities()).actions.map((action) => ({ ...action, availability: "unavailable" as const })) });
    expect(blocked.input_modes).toEqual([]);
    expect(deriveCreativeContract("sonora", sonoraDiscovery(sonoraDiscoveryFixture())).input_modes).toEqual(["text_to_audio"]);
  });
});
