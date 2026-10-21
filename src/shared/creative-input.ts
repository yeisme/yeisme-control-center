export const creativeGenerationModes = [
  "text_to_image",
  "image_to_image",
  "image_upscale",
  "text_to_video",
  "image_to_video",
  "keyframe_video",
  "text_to_audio",
  "text_to_text",
] as const;

export type CreativeGenerationMode = (typeof creativeGenerationModes)[number];

export const creativeReferenceRoles = [
  "subject",
  "style",
  "composition",
  "motion",
  "first_frame",
  "last_frame",
  "keyframe",
] as const;

export type CreativeReferenceRole = (typeof creativeReferenceRoles)[number];
export type CreativeReferenceSource = "local" | "artifact";

export interface CreativeReference {
  ref: string;
  source: CreativeReferenceSource;
  name: string;
  mime: string;
  bytes: number | null;
  width?: number;
  height?: number;
  duration_ms?: number;
  digest?: string;
  roles: CreativeReferenceRole[];
  access: "session" | "authorized" | "unknown";
}

export interface CreativeTimelineKeyframe {
  id: string;
  at_ms: number;
  reference_refs: string[];
  prompt?: string;
}

export interface CreativeTimeline {
  duration_ms: number;
  keyframes: CreativeTimelineKeyframe[];
  transition?: "cut" | "interpolate";
}

export interface CreativeOutputSpec {
  ratio?: string;
  resolution?: string;
  duration_ms?: number;
  format?: string;
}

export interface CreativeBudgetCap {
  amount: number | null;
  currency: "CNY";
}

export interface CreativeInputSpec {
  schema_version: "yeisme.creative_input.v1";
  generation_mode: CreativeGenerationMode;
  model_ref: string;
  binding_id?: string;
  voice_ref?: string;
  prompt: string;
  negative_prompt?: string;
  references: CreativeReference[];
  timeline?: CreativeTimeline;
  output: CreativeOutputSpec;
  variant_count: number;
  budget_cap: CreativeBudgetCap;
}

export interface CreativeTimelineSupport {
  enabled: boolean;
  max_keyframes?: number;
  requires_start_end?: boolean;
  transitions?: readonly ("cut" | "interpolate")[];
}

export interface CreativeCapabilityLimits {
  max_prompt_length?: number;
  max_references?: number;
  max_keyframes?: number;
  max_duration_ms?: number;
  max_variants?: number;
  max_upload_bytes?: number;
}

export interface CreativeOutputConstraints {
  ratios?: readonly string[];
  resolutions?: readonly string[];
  formats?: readonly string[];
  durations_ms?: readonly number[];
}

export interface CreativeCapabilityContract {
  input_modes: readonly CreativeGenerationMode[];
  reference_roles: readonly CreativeReferenceRole[];
  timeline_support: CreativeTimelineSupport | null;
  output_constraints: CreativeOutputConstraints;
  input_schema_ref: string | null;
  limits: CreativeCapabilityLimits;
}

export interface CreativeValidationResult {
  errors: string[];
  warnings: string[];
  valid: boolean;
}

export const creativeModeLabels: Record<CreativeGenerationMode, string> = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  image_upscale: "图像放大",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  keyframe_video: "关键帧视频",
  text_to_audio: "文生音频",
  text_to_text: "文生文本",
};

export const creativeModeModalities: Record<CreativeGenerationMode, "image" | "video" | "audio" | "text"> = {
  text_to_image: "image",
  image_to_image: "image",
  image_upscale: "image",
  text_to_video: "video",
  image_to_video: "video",
  keyframe_video: "video",
  text_to_audio: "audio",
  text_to_text: "text",
};

export function validateCreativeInput(
  input: CreativeInputSpec,
  capability?: Partial<CreativeCapabilityContract>,
): CreativeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const limits = capability?.limits || {};
  const mode = input.generation_mode;
  const references = input.references || [];
  const roles = new Set(capability?.reference_roles || []);

  if (capability?.input_modes && !capability.input_modes.includes(mode)) errors.push("owner 尚未声明该创作模式。");
  if (!input.model_ref) errors.push("未选择模型。");
  if (input.prompt.length > (limits.max_prompt_length || 10000)) errors.push("提示词超过 owner 限制。");
  if (input.variant_count < 1 || input.variant_count > Math.min(4, limits.max_variants || 4)) errors.push("预览变体数量必须在 1–4 之间。");
  if (references.length > (limits.max_references || 16)) errors.push("参考素材数量超过 owner 限制。");
  if (input.budget_cap.amount !== null && input.budget_cap.amount <= 0) errors.push("预算上限需要大于 0。");

  for (const reference of references) {
    if (!reference.ref || !reference.name || !reference.mime) errors.push("参考素材缺少安全引用或媒体类型。");
    if (reference.source === "local" && reference.access !== "session") warnings.push(`${reference.name} 仍未获得上传合同。`);
    for (const role of reference.roles) if (roles.size && !roles.has(role)) errors.push(`owner 未声明参考角色：${role}。`);
  }

  const needsReference = ["image_to_image", "image_upscale", "image_to_video", "keyframe_video"].includes(mode);
  if (needsReference && references.length === 0) errors.push("该创作模式至少需要一个参考素材。");
  if (mode === "keyframe_video") {
    if (!input.timeline) errors.push("关键帧视频需要时间线。");
    else {
      const timeline = input.timeline;
      if (timeline.duration_ms <= 0) errors.push("时间线时长必须大于 0。");
      if (timeline.duration_ms > (limits.max_duration_ms || Number.MAX_SAFE_INTEGER)) errors.push("时间线超过 owner 时长限制。");
      if (timeline.keyframes.length > (limits.max_keyframes || capability?.timeline_support?.max_keyframes || 32)) errors.push("关键帧数量超过 owner 限制。");
      if (timeline.keyframes.some((keyframe, index) => index > 0 && keyframe.at_ms <= timeline.keyframes[index - 1].at_ms)) errors.push("关键帧必须按时间轴顺序递增。");
      const ordered = [...timeline.keyframes].sort((a, b) => a.at_ms - b.at_ms);
      if (ordered.some((keyframe, index) => keyframe.at_ms < 0 || keyframe.at_ms > timeline.duration_ms || (index > 0 && keyframe.at_ms === ordered[index - 1].at_ms))) errors.push("关键帧时间必须在时间线内且严格递增。");
      if (capability?.timeline_support?.requires_start_end !== false) {
        if (!ordered.some((keyframe) => keyframe.at_ms === 0)) errors.push("关键帧视频需要首帧。");
        if (!ordered.some((keyframe) => keyframe.at_ms === timeline.duration_ms)) errors.push("关键帧视频需要尾帧。");
      }
      if (capability?.timeline_support?.transitions && timeline.transition && !capability.timeline_support.transitions.includes(timeline.transition)) errors.push("当前 owner 不支持该关键帧转场。");
    }
  } else if (input.timeline) {
    errors.push("时间线只适用于关键帧视频。");
  }

  return { errors, warnings, valid: errors.length === 0 };
}

export function emptyCreativeInput(modelRef = ""): CreativeInputSpec {
  return {
    schema_version: "yeisme.creative_input.v1",
    generation_mode: "text_to_image",
    model_ref: modelRef,
    prompt: "",
    references: [],
    output: {},
    variant_count: 1,
    budget_cap: { amount: 1, currency: "CNY" },
  };
}
