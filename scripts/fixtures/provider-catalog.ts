// Fixture-only owner discovery documents shaped like the real owner contracts:
// eikona.runtime_capabilities.v1, eikona.model_protocol_snapshot.v1, channel.summary.v1,
// sonora.mcp.discovery.v1 and scaena.video_provider_task_guide.v1. Revision 1 simulates owner
// catalog drift (a new model, a changed tool schema, a removed channel) for change-ledger journeys.

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const string = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });

export function providerTools(owner: string, revision: number) {
  const execute = {
    name: `${owner}.execute`,
    title: `${owner[0].toUpperCase() + owner.slice(1)} action dispatcher`,
    description: "Dispatches discovered owner actions; read the action registry before calling.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: object({ action: string("Exact discovered action id"), args: { type: "object", description: "Action arguments" } }, ["action"]),
  };
  const search = {
    name: `${owner}.search`,
    title: "Search",
    description: "Searches owner documents, providers and resources without side effects.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: object({
      query: string("Search text"),
      types: { type: "array", items: { type: "string" }, description: "Result types" },
      limit: { type: "integer", description: "Maximum results", default: 20 },
      ...(revision > 0 ? { cursor: string("Opaque continuation cursor") } : {}),
    }, ["query"]),
  };
  const fetch = {
    name: `${owner}.fetch`,
    title: "Fetch resource",
    description: "Reads one owner resource by URI.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: object({ uri: string("Owner resource URI") }, ["uri"]),
  };
  return [[execute, search], [fetch]];
}

const eikonaAction = (action: string, kind: "generation" | "mutation" | "readonly", description: string, inputSchema: unknown, runtime: Record<string, unknown> = { state: "unknown", conditions: ["request_validation_required", "live_effect_unverified"] }) => ({
  action, audience: "consumer", kind, description, input_schema: inputSchema,
  confirm_required: kind !== "readonly",
  side_effects: kind === "readonly" ? ["none"] : kind === "generation" ? ["writes_run_evidence", "may_call_provider"] : ["dry_run_by_default", "writes_local_state_when_confirmed"],
  safety: kind === "readonly" ? "readonly" : kind === "generation" ? "writes_run_evidence" : "mutates_local_state_or_requires_dry_run",
  runtime_availability: runtime,
});

export function eikonaRuntimeCapabilities() {
  const ratio = { type: "string", enum: ["1:1", "16:9", "9:16", "4:3"], description: "Output aspect ratio" };
  const format = { type: "string", enum: ["png", "webp"], description: "Output format", default: "png" };
  return {
    schema_version: "eikona.mcp.resource.v1", status: "success", resource_uri: "eikona://runtime/capabilities", kind: "runtime_capabilities",
    data: {
      schema_version: "eikona.runtime_capabilities.v1",
      generation_route: "native_channel",
      live_verified: false,
      actions: [
        eikonaAction("generate", "generation", "Generate images from a prompt through an explicit model channel.", object({ prompt: string("Prompt text"), model: string("Exact model ref"), channel: string("kie or openrouter"), aspect_ratio: ratio, output_format: format, n: { type: "integer", description: "Variants", default: 1 } }, ["prompt", "model"]), { state: "unknown", conditions: ["request_validation_required", "model_channel_and_budget_admission_required"] }),
        eikonaAction("edit", "generation", "Edit an image with references (subject, style, composition).", object({ prompt: string("Edit instruction"), reference_refs: { type: "array", items: { type: "string" }, description: "Owner asset refs" }, aspect_ratio: ratio }, ["prompt", "reference_refs"])),
        eikonaAction("upscale", "generation", "Upscale an existing artifact 2x/4x with faithful detail.", object({ source_ref: string("Artifact ref (required)"), scale: { type: "integer", enum: [2, 4], description: "Scale factor", default: 2 }, preserve_alpha: { type: "boolean", description: "Keep transparency" } }, ["source_ref", "scale"])),
        eikonaAction("models.readiness", "readonly", "Read model readiness snapshots.", object({})),
        eikonaAction("channel.list", "readonly", "List channel summaries.", object({})),
        eikonaAction("delivery.create", "mutation", "Create a delivery package from reviewed artifacts.", object({ run_id: string("Run id (required)") }, ["run_id"])),
        eikonaAction("assets.qualification.accept", "mutation", "Accept an asset qualification.", object({ ref: string("Qualification ref") }, ["ref"]), { state: "blocked", blockers: ["HUMAN_DECISION_REQUIRED"], next_actions: ["Ask the owner operator to run eikona assets qualification accept"] }),
      ],
    },
  };
}

export function eikonaModels(revision: number) {
  const row = (model_ref: string, provider: string, status: string | undefined, extra: Record<string, unknown> = {}) => ({
    schema_version: "eikona.model_protocol_snapshot.v1", model_ref, provider, capabilities: ["text_to_image", "image_to_image"],
    parameters: { aspect_ratios: ["1:1", "16:9", "9:16"] }, pricing: { source: "provider_catalog", currency: "USD", unit: "image", price_type: "per_output" },
    readiness: status === "historical" ? "query_only" : "ready", observed_at: "2026-10-20T06:00:00Z", snapshot_digest: "sha256:" + model_ref.replace(/[^a-z0-9]/gi, "").padEnd(16, "0").slice(0, 16),
    ...(status ? { status } : {}), ...extra,
  });
  return {
    schema_version: "eikona.mcp.resource.v1", status: "success", resource_uri: "eikona://models/readiness", kind: "model_readiness",
    data: {
      schema_version: "eikona.model_protocol_snapshot.v1",
      snapshot_ref: "fixture-model-snapshot",
      models: [
        row("openai/gpt-image-2.5-sunburst", "openrouter", "latest_ready", { channel: "openrouter" }),
        row("google/nano-banana-pro", "kie", "latest_unverified", { channel: "kie" }),
        row("bytedance/seedream-4", "kie", "unknown_cost", { channel: "kie" }),
        row("openai/gpt-image-1", "openrouter", "historical", { channel: "openrouter" }),
        row("stability/sd-3.5", "local", undefined),
        ...(revision > 0 ? [row("black-forest/flux-2-pro", "openrouter", "latest_ready", { channel: "openrouter" })] : []),
      ],
    },
  };
}

const channel = (owner: string, channel_id: string, provider: string, protocol: string, models: string[], capabilities: string[], status: string, priority: number, isDefault: boolean) => ({
  schema_version: "channel.summary.v1", owner, channel_id, provider, name: channel_id, protocol, models, capabilities, status,
  observed_at: "unknown", freshness: "unknown",
  last_attempt: { status: "unknown" }, last_success: { status: "unknown" }, last_settlement: { status: "unknown" },
  pricing: { source: "provider_catalog", price_type: "per_output", unit: owner === "scaena" ? "second" : "image", currency: "USD" },
  routing: { priority, weight: 1, default: isDefault, selection_mode: "priority_weighted_rendezvous_v1" },
  note: { resource_uri: `${owner}://channels/${channel_id}/note`, status: "missing", must_read_before_use: true },
});

export function eikonaChannels(revision: number) {
  return {
    schema_version: "channel.summary.v1",
    resource_uri: "eikona://channels",
    channels: [
      channel("eikona", "openrouter", "openrouter_image", "openrouter_image_v1", ["openai/gpt-image-2.5-sunburst", ...(revision > 0 ? ["black-forest/flux-2-pro"] : [])], ["generate", "edit"], "ready", 10, true),
      channel("eikona", "kie", "kie_image", "kie_market_image_v1", ["google/nano-banana-pro", "bytedance/seedream-4"], ["generate", "edit", "upscale"], "ready", 20, false),
      ...(revision > 0 ? [] : [channel("eikona", "legacy-gateway", "gateway_image", "openai_images_v1", ["openai/gpt-image-1"], ["generate"], "blocked", 90, false)]),
    ],
    required_reading: ["eikona://channels/openrouter/note", "eikona://channels/kie/note"],
  };
}

const sonoraAction = (id: string, lane: "readonly" | "mutation" | "gated", summary: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, lane, summary, description: summary, args, ...extra });

export function sonoraDiscovery() {
  const text = (description: string) => ({ type: "string", description });
  return {
    schema_version: "sonora.mcp.discovery.v1",
    server: "sonora",
    tools: ["sonora.execute", "sonora.search"],
    search_types: ["provider", "model", "voice", "doc"],
    actions: [
      sonoraAction("voice.audition", "gated", "Synthesize a short audition line with an explicit voice", { provider_id: text("provider id (required)"), voice_model_ref: text("voice model ref (required)"), text: text("line text (required)"), max_cost_usd: text("cost ceiling (required)") }, { requires_confirm: true, requires_idempotency: true }),
      sonoraAction("doctor.run", "readonly", "Diagnose one provider without a generation call", { provider_id: text("provider id (required)") }),
      sonoraAction("credential.status", "readonly", "Report whether a provider credential is configured", { provider_id: text("provider id (required)") }),
      sonoraAction("music.providers.list", "readonly", "List configured music providers"),
      sonoraAction("music.brief.create", "mutation", "Create a provider-neutral music brief", { brief: { type: "object", description: "mode: original|cover|extend|stems|lyrics …" } }),
      sonoraAction("music.estimate", "readonly", "Estimate a music plan with zero provider calls", { plan: { type: "object", description: "music plan" } }),
      sonoraAction("music.generate", "gated", "Submit a music generation job (approval + budget required)", { plan_ref: text("music plan ref (required)"), approval_ref: text("approval ref (required)"), max_cost_usd: text("required positive cost ceiling") }, { requires_confirm: true, requires_idempotency: true }),
      sonoraAction("music.approval.issue", "mutation", "Issue a music approval bound to one plan", { plan_ref: text("music plan ref (required)") }, { requires_idempotency: true }),
      sonoraAction("music.job.status", "readonly", "Read a music job", { job_ref: text("music job ref") }),
    ],
    readiness: [
      { domain: "voice", status: "available", transport: "mcp", note: "TTS audition through explicit providers", next_action: "" },
      { domain: "music", status: "available", transport: "mcp", note: "ElevenLabs music v2.5 via plan + approval", next_action: "" },
      { domain: "music.yue2", status: "planned", transport: "mcp", note: "Self-hosted YuE2 is off by default", next_action: "Owner enables the YuE2 runtime" },
      { domain: "lipsync", status: "unavailable", transport: "none", note: "No provider configured", next_action: "Configure a lipsync provider" },
    ],
  };
}

export function scaenaGuide(revision: number) {
  const binding = (binding_id: string, model: string, channel: string, task_mode: string, enabled: boolean, extra: Record<string, unknown> = {}) => ({
    binding_id, model, channel, task_mode, duration_seconds: 5, resolution: "720P", ratio: "16:9", require_reference: task_mode !== "text", enabled, default: binding_id === "seedance-720p-16x9", priority: 10, weight: 1,
    ...(enabled ? {} : { disabled_reason: "binding_disabled" }), ...extra,
  });
  const bindings = [
    binding("seedance-720p-16x9", "seedance25-ark-text-720p", "ark-cn-beijing", "text", true),
    binding("seedance-1080p-9x16", "seedance25-ark-text-1080p", "ark-cn-beijing", "text", false, { resolution: "1080P", ratio: "9:16" }),
    binding("kling-reference-8s", "kling-3.0-pro", "kie", "reference", true, { duration_seconds: 8, ratio: "9:16" }),
    binding("wan3-frames-5s", "wan3.0-video", "openrouter", "frames", true, { resolution: "1080P" }),
  ];
  return {
    schema_version: "scaena.video_provider_task_guide.v1",
    readiness: { backed: true, default_enabled: false, blocked_reason: "" },
    actions: ["createVideoProviderTask", "getVideoProviderTask", "reconcileVideoProviderTask"],
    bindings,
    channels: [
      channel("scaena", "seedance-720p-16x9", "video", "video_provider_task", ["seedance25-ark-text-720p"], ["text"], "ready", 10, true),
      channel("scaena", "seedance-1080p-9x16", "video", "video_provider_task", ["seedance25-ark-text-1080p"], ["text"], "blocked", 20, false),
      channel("scaena", "kling-reference-8s", "video", "video_provider_task", ["kling-3.0-pro"], ["reference"], "ready", 30, false),
      channel("scaena", "wan3-frames-5s", "video", "video_provider_task", ["wan3.0-video"], ["frames"], revision > 0 ? "blocked" : "ready", 40, false),
    ],
    model_routing: {
      executable: true,
      native_channels: [
        { channel: "kie", provider: "kie_video", protocol: "kie_market_video_v1", model_selection: "exact_market_model_id" },
        { channel: "openrouter", provider: "openrouter_video", protocol: "openrouter_video_v1", model_selection: "exact_canonical_slug" },
      ],
      latest_policy: "new tasks expose latest mainline models; historical refs remain query/reconcile only",
      fallback: "disabled",
    },
    registration: { actions: ["createProviderAssetRegistration", "getProviderAssetRegistration", "submitProviderAssetRegistration", "reconcileProviderAssetRegistration"] },
  };
}
