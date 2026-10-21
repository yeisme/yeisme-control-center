import { createHash } from "node:crypto";
import type { CreativeCapabilityContract, CreativeGenerationMode, CreativeReferenceRole } from "../src/shared/creative-input";
import {
  ownerModelStatuses,
  type ActionAvailability,
  type CatalogAction,
  type CatalogChannel,
  type CatalogModel,
  type CatalogOwner,
  type CatalogPricing,
  type CatalogTool,
  type ChannelStatus,
  type DomainReadiness,
  type ModelSnapshotStatus,
  type RiskTier,
  type SchemaField,
  type SchemaSummary,
} from "../src/shared/tool-catalog";

const maxFields = 40;
const maxEnum = 24;
const secretKey = /token|secret|password|credential|api[_-]?key|authorization|cookie/i;

export const str = (value: unknown, max = 240): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
};
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
export const strings = (value: unknown, max = 40, length = 120): string[] =>
  Array.isArray(value) ? [...new Set(value.flatMap((item) => { const v = str(item, length); return v ? [v] : []; }))].slice(0, max) : [];
const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : null;

/** Canonical JSON (sorted keys) so digests do not depend on owner key order. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value as object).sort().map((key) => JSON.stringify(key) + ":" + canonicalJSON((value as any)[key])).join(",") + "}";
  return JSON.stringify(value ?? null);
}

export const digestOf = (value: unknown) => "sha256:" + createHash("sha256").update(canonicalJSON(value)).digest("hex");

const typeLabel = (schema: Record<string, any>): string => {
  const type = schema.type;
  if (Array.isArray(type)) return type.filter((item) => typeof item === "string").join(" | ") || "unknown";
  if (typeof type === "string") {
    if (type === "array") {
      const items = record(schema.items);
      return items && typeof items.type === "string" ? `array<${items.type}>` : "array";
    }
    return type;
  }
  if (Array.isArray(schema.enum)) return "enum";
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) return "union";
  return "unknown";
};

const defaultLabel = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (typeof value === "string") return str(value, 80);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

/** Summarizes a JSON schema's top-level contract; nested bodies stay with the owner. */
export function summarizeSchema(schema: unknown): SchemaSummary {
  const root = record(schema);
  if (!root) return { digest: null, fields: [], field_count: 0, truncated: false };
  const properties = record(root.properties) || {};
  const required = new Set(strings(root.required, 200, 120));
  const names = Object.keys(properties).filter((name) => !secretKey.test(name) || name === "confirm_external_call");
  const fields: SchemaField[] = names.slice(0, maxFields).map((name) => {
    const field = record(properties[name]) || {};
    const enums = Array.isArray(field.enum) ? field.enum.flatMap((item: unknown) => (typeof item === "string" || typeof item === "number" ? [String(item)] : [])).slice(0, maxEnum) : null;
    return {
      name: name.slice(0, 120),
      type: typeLabel(field),
      required: required.has(name),
      description: str(field.description, 280),
      enum: enums && enums.length ? enums : null,
      default: defaultLabel(field.default),
    };
  });
  return { digest: digestOf(root), fields, field_count: names.length, truncated: names.length > maxFields };
}

/** Sonora/legacy action registries describe arguments as a property map rather than a full schema. */
const argsAsSchema = (args: unknown) => {
  const properties = record(args);
  if (!properties) return null;
  const required = Object.entries(properties).flatMap(([name, value]) => (/\(required\)/.test(String(record(value)?.description || "")) ? [name] : []));
  return { type: "object", properties, required };
};

export function normalizeTools(owner: CatalogOwner, raw: unknown): CatalogTool[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item): CatalogTool[] => {
    const tool = record(item);
    const name = str(tool?.name, 160);
    if (!tool || !name || seen.has(name)) return [];
    seen.add(name);
    const annotations = record(tool.annotations) || {};
    return [{
      id: name,
      owner,
      name,
      title: str(tool.title, 160) || str(annotations.title, 160),
      description: str(tool.description, 600),
      annotations: {
        read_only: bool(annotations.readOnlyHint),
        destructive: bool(annotations.destructiveHint),
        idempotent: bool(annotations.idempotentHint),
        open_world: bool(annotations.openWorldHint),
      },
      dispatcher: name === owner + ".execute",
      input: summarizeSchema(tool.inputSchema),
    }];
  }).slice(0, 200);
}

const availability = (value: unknown): ActionAvailability => {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  if (["available", "ready", "enabled"].includes(v)) return "available";
  if (["blocked"].includes(v)) return "blocked";
  if (["unavailable", "disabled"].includes(v)) return "unavailable";
  if (["planned"].includes(v)) return "planned";
  return "unknown";
};

const eikonaCreativeModes: Record<string, CreativeGenerationMode> = { generate: "text_to_image", edit: "image_to_image", upscale: "image_upscale" };

export function eikonaRisk(descriptor: Record<string, any>, blockers: string[]): RiskTier {
  if (blockers.includes("HUMAN_DECISION_REQUIRED")) return "human_gate";
  const kind = String(descriptor.kind || "").toLowerCase();
  const effects = strings(descriptor.side_effects, 20, 80);
  if (kind === "generation" || effects.includes("may_call_provider")) return "paid_external";
  if (kind === "mutation" || effects.includes("writes_local_state_when_confirmed")) return "mutation";
  if (kind === "readonly" && (effects.length === 0 || effects.every((effect) => effect === "none"))) return "read_only";
  return "unknown";
}

/** eikona://runtime/capabilities → eikona.runtime_capabilities.v1 (wrapped in eikona.mcp.resource.v1). */
export function eikonaActions(resource: unknown): { actions: CatalogAction[]; generation_route: string | null } {
  const root = record(resource);
  const data = record(root?.data) || root;
  const list = Array.isArray(data?.actions) ? data.actions : [];
  const actions = list.flatMap((item: unknown): CatalogAction[] => {
    const descriptor = record(item);
    const name = str(descriptor?.action, 160);
    if (!descriptor || !name) return [];
    const runtime = record(descriptor.runtime_availability) || {};
    const blockers = strings(runtime.blockers, 12, 160);
    return [{
      id: "eikona.execute#" + name,
      owner: "eikona",
      name,
      tool: "eikona.execute",
      summary: null,
      description: str(descriptor.description, 600),
      risk: eikonaRisk(descriptor, blockers),
      availability: availability(runtime.state),
      lane: str(descriptor.audience, 40),
      blockers,
      next_actions: strings(runtime.next_actions, 8, 240),
      conditions: strings(runtime.conditions, 12, 120),
      requires_confirm: bool(descriptor.confirm_required),
      requires_idempotency: null,
      side_effects: strings(descriptor.side_effects, 12, 80),
      creative_mode: eikonaCreativeModes[name] || null,
      input: summarizeSchema(descriptor.input_schema),
      source: "eikona://runtime/capabilities",
    }];
  }).slice(0, 300);
  return { actions, generation_route: str(record(data?.generation_route)?.route, 120) || str(data?.generation_route, 120) };
}

const sonoraLaneRisk: Record<string, RiskTier> = { readonly: "read_only", mutation: "mutation", gated: "paid_external" };
const sonoraCreativeModes: Record<string, CreativeGenerationMode> = { "voice.audition": "text_to_audio" };

/** sonora://capabilities → sonora.mcp.discovery.v1 */
export function sonoraDiscovery(doc: unknown): { actions: CatalogAction[]; readiness: DomainReadiness[]; tools: string[] } {
  const root = record(doc);
  const list = Array.isArray(root?.actions) ? root.actions : [];
  const actions = list.flatMap((item: unknown): CatalogAction[] => {
    const action = record(item);
    const name = str(action?.id, 160);
    if (!action || !name) return [];
    const lane = str(action.lane, 40);
    return [{
      id: "sonora.execute#" + name,
      owner: "sonora",
      name,
      tool: "sonora.execute",
      summary: str(action.summary, 240),
      description: str(action.description, 600),
      risk: (lane && sonoraLaneRisk[lane]) || "unknown",
      availability: "unknown",
      lane,
      blockers: [],
      next_actions: [],
      conditions: [],
      requires_confirm: bool(action.requires_confirm),
      requires_idempotency: bool(action.requires_idempotency),
      side_effects: [],
      creative_mode: sonoraCreativeModes[name] || null,
      input: summarizeSchema(action.input_schema || argsAsSchema(action.args)),
      source: "sonora://capabilities",
    }];
  }).slice(0, 300);
  const readiness = (Array.isArray(root?.readiness) ? root.readiness : []).flatMap((item: unknown): DomainReadiness[] => {
    const entry = record(item);
    const domain = str(entry?.domain, 80);
    return entry && domain ? [{ domain, status: availability(entry.status), note: str(entry.note, 280) }] : [];
  }).slice(0, 40);
  return { actions, readiness, tools: strings(root?.tools, 40, 120) };
}

/** Pinned to scaena.video_provider_task_guide.v1 semantics; unknown names stay `unknown`. */
const scaenaActionRisk: Record<string, RiskTier> = {
  createVideoProviderTask: "paid_external",
  getVideoProviderTask: "read_only",
  reconcileVideoProviderTask: "remote_query",
  createProviderAssetRegistration: "mutation",
  getProviderAssetRegistration: "read_only",
  submitProviderAssetRegistration: "human_gate",
  reconcileProviderAssetRegistration: "remote_query",
};

export function scaenaGuide(guide: unknown): {
  actions: CatalogAction[];
  channels: CatalogChannel[];
  models: CatalogModel[];
  bindings: Record<string, any>[];
  latest_policy: string | null;
  native_channels: string[];
  backed: boolean | null;
  blocked_reason: string | null;
} {
  const root = record(guide) || {};
  const readiness = record(root.readiness) || {};
  const backed = bool(readiness.backed);
  const registration = record(root.registration) || {};
  const names = [...strings(root.actions, 20, 120), ...strings(registration.actions, 20, 120)];
  const actions: CatalogAction[] = [...new Set(names)].map((name) => ({
    id: "scaena.execute#" + name,
    owner: "scaena",
    name,
    tool: "scaena.execute",
    summary: null,
    description: null,
    risk: scaenaActionRisk[name] || "unknown",
    availability: backed === false ? "unavailable" : backed === true ? "available" : "unknown",
    lane: null,
    blockers: str(readiness.blocked_reason, 160) ? [str(readiness.blocked_reason, 160)!] : [],
    next_actions: [],
    conditions: name === "createVideoProviderTask" ? ["explicit_confirmation_required", "max_cost_required", "idempotency_key_required"] : [],
    requires_confirm: name === "createVideoProviderTask" ? true : null,
    requires_idempotency: name.startsWith("create") || name.startsWith("reconcile") ? true : null,
    side_effects: [],
    creative_mode: null,
    input: summarizeSchema(null),
    source: "scaena://video-tasks/guide",
  }));
  const bindings = (Array.isArray(root.bindings) ? root.bindings : []).flatMap((item: unknown) => (record(item) ? [record(item)!] : [])).slice(0, 100);
  const routing = record(root.model_routing) || {};
  const channels = normalizeChannels("scaena", root.channels);
  const byModel = new Map<string, CatalogModel>();
  for (const binding of bindings) {
    const modelRef = str(binding.model || binding.model_ref, 200);
    if (!modelRef) continue;
    const channel = str(binding.channel, 80);
    const key = modelRef + "@" + (channel || "default");
    const existing = byModel.get(key);
    const duration = num(binding.duration_seconds);
    const entry: CatalogModel = existing || {
      id: key,
      owner: "scaena",
      model_ref: modelRef,
      original_model_ref: null,
      provider: null,
      channel,
      operation: "video_generation",
      capabilities: [],
      input_modalities: ["text"],
      output_modalities: ["video"],
      durations: [],
      resolutions: [],
      ratios: [],
      pricing: null,
      readiness: null,
      status: ownerStatus(binding.status),
      status_source: ownerModelStatuses.includes(String(binding.status) as ModelSnapshotStatus) ? "owner" : "undeclared",
      observed_at: null,
      expires_at: null,
      digest: null,
      warnings: [],
      source: "scaena://video-tasks/guide",
    };
    const mode = str(binding.task_mode, 40);
    if (mode && !entry.capabilities.includes(mode)) entry.capabilities.push(mode);
    if ((mode === "reference" || mode === "frames" || binding.require_reference === true) && !entry.input_modalities.includes("image")) entry.input_modalities.push("image");
    if (duration !== null && !entry.durations.includes(duration + "s")) entry.durations.push(duration + "s");
    const resolution = str(binding.resolution, 40);
    if (resolution && !entry.resolutions.includes(resolution)) entry.resolutions.push(resolution);
    const ratio = str(binding.ratio, 20);
    if (ratio && !entry.ratios.includes(ratio)) entry.ratios.push(ratio);
    const enabled = binding.enabled !== false;
    entry.readiness = entry.readiness === "enabled" || enabled ? "enabled" : "disabled";
    if (!enabled) {
      const reason = str(binding.disabled_reason, 160);
      if (reason && !entry.warnings.includes(reason)) entry.warnings.push(reason);
    }
    byModel.set(key, entry);
  }
  const nativeChannels = (Array.isArray(routing.native_channels) ? routing.native_channels : []).flatMap((item: unknown) => {
    const value = str(record(item)?.channel, 60);
    return value ? [value] : [];
  });
  return {
    actions,
    channels,
    models: [...byModel.values()].slice(0, 200),
    bindings,
    latest_policy: str(routing.latest_policy, 400),
    native_channels: nativeChannels,
    backed,
    blocked_reason: str(readiness.blocked_reason, 160),
  };
}

const ownerStatus = (value: unknown): ModelSnapshotStatus =>
  ownerModelStatuses.includes(String(value) as ModelSnapshotStatus) ? (String(value) as ModelSnapshotStatus) : "unknown";

const pricing = (value: unknown): CatalogPricing | null => {
  const raw = record(value);
  if (!raw) return null;
  const result = { source: str(raw.source, 80), currency: str(raw.currency, 12), unit: str(raw.unit, 40), price_type: str(raw.price_type, 40) };
  return Object.values(result).some(Boolean) ? result : null;
};

const statusText = (value: unknown) => str(record(value)?.status, 40) || str(value, 40);

/** channel.summary.v1 — accepts either `{channels: [...]}` or a bare list. */
export function normalizeChannels(owner: CatalogOwner, raw: unknown): CatalogChannel[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(record(raw)?.channels) ? record(raw)!.channels : [];
  const seen = new Set<string>();
  return list.flatMap((item: unknown): CatalogChannel[] => {
    const channel = record(item);
    const id = str(channel?.channel_id || channel?.id, 160);
    if (!channel || !id || seen.has(id)) return [];
    seen.add(id);
    const status = String(channel.status || "").toLowerCase();
    const routing = record(channel.routing);
    const note = record(channel.note);
    return [{
      id,
      owner,
      channel_id: id,
      name: str(channel.name, 160) || id,
      provider: str(channel.provider, 80),
      protocol: str(channel.protocol, 80),
      models: strings(channel.models, 40, 200),
      capabilities: strings(channel.capabilities, 20, 80),
      status: (["ready", "available", "enabled"].includes(status) ? "ready" : ["blocked", "disabled", "unavailable"].includes(status) ? "blocked" : "unknown") as ChannelStatus,
      observed_at: str(channel.observed_at, 40) === "unknown" ? null : str(channel.observed_at, 40),
      routing: routing ? { priority: num(routing.priority), weight: num(routing.weight), default: bool(routing.default), selection_mode: str(routing.selection_mode, 80) } : null,
      pricing: pricing(channel.pricing),
      note_required: note?.must_read_before_use === true,
      last_attempt: statusText(channel.last_attempt) === "unknown" ? null : statusText(channel.last_attempt),
      last_success: statusText(channel.last_success) === "unknown" ? null : statusText(channel.last_success),
    }];
  }).slice(0, 200);
}

/** eikona.model_protocol_snapshot.v1 rows (or the shared provider-native model snapshot). */
export function normalizeModels(owner: CatalogOwner, raw: unknown, source: string): CatalogModel[] {
  const root = record(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(root?.models) ? root!.models : Array.isArray(root?.snapshots) ? root!.snapshots : Array.isArray(record(root?.data)?.models) ? record(root?.data)!.models : [];
  const seen = new Set<string>();
  return list.flatMap((item: unknown): CatalogModel[] => {
    const row = record(item);
    const modelRef = str(row?.model_ref || row?.normalized_model_ref, 200);
    if (!row || !modelRef) return [];
    const channel = str(row.channel, 80);
    const id = modelRef + "@" + (channel || str(row.provider, 80) || "default");
    if (seen.has(id)) return [];
    seen.add(id);
    const declared = ownerModelStatuses.includes(String(row.status) as ModelSnapshotStatus);
    const parameters = record(row.parameters) || record(row.supported_parameters) || {};
    return [{
      id,
      owner,
      model_ref: modelRef,
      original_model_ref: str(row.original_model_ref, 200),
      provider: str(row.provider, 80),
      channel,
      operation: str(row.operation, 80),
      capabilities: strings(row.capabilities, 20, 80),
      input_modalities: strings(row.input_modalities, 8, 40),
      output_modalities: strings(row.output_modalities, 8, 40),
      durations: strings(row.supported_durations || parameters.durations, 16, 20),
      resolutions: strings(row.supported_resolutions || parameters.resolutions || parameters.sizes, 16, 40),
      ratios: strings(row.supported_aspect_ratios || parameters.aspect_ratios || parameters.ratios, 16, 20),
      pricing: pricing(row.pricing_snapshot || row.pricing),
      readiness: str(row.readiness, 60),
      status: declared ? (String(row.status) as ModelSnapshotStatus) : "unknown",
      status_source: declared ? "owner" : "undeclared",
      observed_at: str(row.captured_at || row.observed_at, 40),
      expires_at: str(row.expires_at, 40),
      digest: str(row.catalog_digest || row.snapshot_digest, 120),
      warnings: strings(row.warnings, 8, 200),
      source,
    }];
  }).slice(0, 300);
}

/**
 * Derives the AI 创作 contract from real owner discovery instead of an owner resource that does not
 * exist. Only modes backed by a declared, not-unavailable action or an enabled binding are enabled.
 */
export function deriveCreativeContract(owner: "eikona" | "scaena" | "sonora", input: { actions: CatalogAction[]; bindings?: Record<string, any>[] }): CreativeCapabilityContract {
  const modes = new Set<CreativeGenerationMode>();
  const roles = new Set<CreativeReferenceRole>();
  const ratios = new Set<string>();
  const resolutions = new Set<string>();
  const formats = new Set<string>();
  const durations = new Set<number>();
  let timeline: CreativeCapabilityContract["timeline_support"] = null;
  let schemaRef: string | null = null;
  if (owner === "scaena") {
    for (const binding of input.bindings || []) {
      if (binding.enabled === false) continue;
      const mode = String(binding.task_mode || "text");
      if (mode === "text") modes.add("text_to_video");
      if (mode === "reference") { modes.add("image_to_video"); roles.add("subject"); roles.add("composition"); }
      if (mode === "frames") {
        modes.add("keyframe_video");
        roles.add("first_frame");
        roles.add("last_frame");
        timeline = { enabled: true, requires_start_end: true, max_keyframes: 2, transitions: ["cut"] };
      }
      if (binding.require_reference === true || binding.requires_reference === true) roles.add("subject");
      const ratio = str(binding.ratio, 20); if (ratio) ratios.add(ratio);
      const resolution = str(binding.resolution, 40); if (resolution) resolutions.add(resolution);
      const format = str(binding.output_format, 20); if (format) formats.add(format);
      const seconds = num(binding.duration_seconds); if (seconds !== null && seconds > 0) durations.add(seconds * 1000);
    }
    if (modes.size) schemaRef = "scaena://video-tasks/guide#createVideoProviderTask";
  } else {
    for (const action of input.actions) {
      if (!action.creative_mode || action.availability === "unavailable" || action.availability === "blocked") continue;
      modes.add(action.creative_mode);
      schemaRef ??= `${action.source}#${action.name}`;
      if (action.creative_mode === "image_to_image") { roles.add("subject"); roles.add("style"); roles.add("composition"); }
      for (const field of action.input.fields) {
        if (!field.enum) continue;
        if (/ratio|aspect/.test(field.name)) field.enum.forEach((value) => ratios.add(value));
        if (/resolution|size/.test(field.name)) field.enum.forEach((value) => resolutions.add(value));
        if (/format/.test(field.name)) field.enum.forEach((value) => formats.add(value));
      }
    }
  }
  return {
    input_modes: [...modes],
    reference_roles: [...roles],
    timeline_support: timeline,
    output_constraints: {
      ...(ratios.size ? { ratios: [...ratios].slice(0, 32) } : {}),
      ...(resolutions.size ? { resolutions: [...resolutions].slice(0, 32) } : {}),
      ...(formats.size ? { formats: [...formats].slice(0, 32) } : {}),
      ...(durations.size ? { durations_ms: [...durations].sort((a, b) => a - b).slice(0, 32) } : {}),
    },
    input_schema_ref: schemaRef,
    limits: {},
  };
}
