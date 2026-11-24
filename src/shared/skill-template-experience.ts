/** Body-free projection for MCP connection guidance and Skill/template selection.
 * Remote content is metadata only: refs, versions, digests and blockers.
 * This module never accepts commands, credentials, paths, arbitrary URLs,
 * template bodies, prompts or provider payloads.
 */

export const skillTemplateExperienceSchema = "yeisme.skill_template_experience.v1" as const;

export const assetIntents = ["image", "video", "audio", "episode", "collection"] as const;
export type AssetIntent = (typeof assetIntents)[number];

export const mcpConnectionStages = ["unconfigured", "transport_ready", "protocol_ready", "discovery_ready", "invocation_unverified", "invocation_ready", "degraded", "forbidden", "needs_contract", "unavailable"] as const;
export type McpConnectionStage = (typeof mcpConnectionStages)[number];

export const skillTemplateAvailability = ["available", "update_available", "pinned", "stale", "incompatible", "forbidden", "source_unavailable", "body_forbidden", "needs_contract", "digest_mismatch", "unavailable"] as const;
export type SkillTemplateAvailability = (typeof skillTemplateAvailability)[number];

export const templateMaturities = ["unknown", "exploratory", "first_support", "mature"] as const;
export type TemplateMaturity = (typeof templateMaturities)[number];

export interface SkillDescriptor {
  readonly ref: string;
  readonly title: string;
  readonly version: string;
  readonly revision: string;
  readonly digest: string;
  readonly source_id: string;
  readonly intents: readonly AssetIntent[];
  readonly required_tools: readonly string[];
  readonly required_templates: readonly string[];
  readonly maturity: TemplateMaturity;
  readonly availability: SkillTemplateAvailability;
  readonly executable: false;
  readonly blockers: readonly string[];
}

export interface TemplateDescriptor {
  readonly ref: string;
  readonly title: string;
  readonly version: string;
  readonly revision: string;
  readonly digest: string;
  readonly snapshot: string;
  readonly source_owner: string;
  readonly intents: readonly AssetIntent[];
  readonly maturity: TemplateMaturity;
  readonly rights: "unknown" | "granted" | "expired" | "forbidden";
  readonly availability: SkillTemplateAvailability;
  readonly executable: false;
  readonly blockers: readonly string[];
}

export interface SkillTemplateRecommendation {
  readonly intent: AssetIntent;
  readonly skill: SkillDescriptor | null;
  readonly template: TemplateDescriptor | null;
  readonly reason: string;
  readonly executable: false;
}

export interface SkillTemplateSelection {
  readonly intent: AssetIntent;
  readonly skill_ref?: string;
  readonly skill_digest?: string;
  readonly template_ref?: string;
  readonly template_revision?: string;
  readonly template_digest?: string;
  readonly snapshot_id?: string;
  readonly state: "previewed" | "pinned" | "skipped" | "superseded";
  readonly reason?: string;
}

export interface AssetPreflight {
  readonly schema_version: typeof skillTemplateExperienceSchema;
  readonly intent: AssetIntent;
  readonly recommendation: SkillTemplateRecommendation;
  readonly selection: SkillTemplateSelection | null;
  readonly availability: SkillTemplateAvailability;
  readonly provider_calls: 0;
  readonly durable_writes: 0;
  readonly next_action: string;
}

export interface McpConnectionDiagnosis {
  readonly stage: McpConnectionStage;
  readonly label: string;
  readonly detail: string;
  readonly next_action: string;
}

const refPattern = /^[a-z][a-z0-9_-]{0,63}:[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function validTitle(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}
const forbiddenKeys = new Set(["body", "prompt", "content", "command", "args", "argv", "env", "environment", "workdir", "script", "code", "credential", "credentials", "token", "secret", "password", "authorization", "payload", "url", "endpoint", "path", "filepath"]);

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);

function clean(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function hasForbidden(value: RecordValue): boolean {
  return Object.keys(value).some((key) => forbiddenKeys.has(key.toLowerCase()));
}

function intents(value: unknown): AssetIntent[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > assetIntents.length) return;
  const parsed = value.filter((item): item is AssetIntent => assetIntents.includes(item as AssetIntent));
  return parsed.length === value.length && new Set(parsed).size === parsed.length ? parsed : undefined;
}

function tokens(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return;
  const parsed = value.filter((item): item is string => typeof item === "string" && (tokenPattern.test(item) || refPattern.test(item)));
  return parsed.length === value.length ? parsed : undefined;
}

function availability(value: unknown): SkillTemplateAvailability {
  return skillTemplateAvailability.includes(value as SkillTemplateAvailability) ? value as SkillTemplateAvailability : "needs_contract";
}

function maturity(value: unknown): TemplateMaturity {
  return templateMaturities.includes(value as TemplateMaturity) ? value as TemplateMaturity : "unknown";
}

export function normalizeSkillDescriptor(input: unknown): SkillDescriptor | undefined {
  if (!record(input) || hasForbidden(input)) return;
  const ref = clean(input.ref, refPattern);
  const title = validTitle(input.title) ? input.title : undefined;
  const version = clean(input.version, tokenPattern);
  const revision = clean(input.revision, tokenPattern);
  const digest = clean(input.digest, digestPattern);
  const source = clean(input.source_id, tokenPattern);
  const parsedIntents = intents(input.intents);
  const tools = tokens(input.required_tools);
  const templates = tokens(input.required_templates);
  const blockers = tokens(input.blockers) || [];
  if (!ref || !title || !version || !revision || !digest || !source || !parsedIntents || !tools || !templates) return;
  return { ref, title, version, revision, digest, source_id: source, intents: parsedIntents, required_tools: tools, required_templates: templates, maturity: maturity(input.maturity), availability: availability(input.availability), executable: false, blockers };
}

export function normalizeTemplateDescriptor(input: unknown): TemplateDescriptor | undefined {
  if (!record(input) || hasForbidden(input)) return;
  const ref = clean(input.ref, refPattern);
  const title = validTitle(input.title) ? input.title : undefined;
  const version = clean(input.version, tokenPattern);
  const revision = clean(input.revision, tokenPattern);
  const digest = clean(input.digest, digestPattern);
  const snapshot = clean(input.snapshot, tokenPattern);
  const owner = clean(input.source_owner, /^[a-z][a-z0-9_-]{0,63}$/);
  const parsedIntents = intents(input.intents);
  const blockers = tokens(input.blockers) || [];
  const rights = input.rights === "granted" || input.rights === "expired" || input.rights === "forbidden" ? input.rights : "unknown";
  if (!ref || !title || !version || !revision || !digest || !snapshot || !owner || !parsedIntents) return;
  return { ref, title, version, revision, digest, snapshot, source_owner: owner, intents: parsedIntents, maturity: maturity(input.maturity), rights, availability: availability(input.availability), executable: false, blockers };
}

export function diagnoseMcpConnection(input: { configured: boolean; transport: boolean; protocol: boolean; tools: number | null; schemaValid: boolean; invocation: "unverified" | "validated" | "forbidden"; degraded: boolean }): McpConnectionDiagnosis {
  if (!input.configured) return { stage: "unconfigured", label: "尚未配置 MCP", detail: "当前范围没有开放工具连接。", next_action: "配置 Gateway 连接后再推荐 Skill 与模板。" };
  if (!input.transport) return { stage: "unavailable", label: "Gateway 不可达", detail: "网络失败不代表 Gateway 没有运行。", next_action: "检查服务连接后重试。" };
  if (input.invocation === "forbidden") return { stage: "forbidden", label: "MCP 已连接但权限不足", detail: "凭据存在，但当前 scope 不能读取所需资源。", next_action: "使用具备只读权限的连接。" };
  if (!input.protocol) return { stage: "needs_contract", label: "MCP 协议未对齐", detail: "initialize 尚未成功或协议合同不兼容。", next_action: "核对 Gateway 协议版本。" };
  if (input.tools === null || !input.schemaValid) return { stage: "needs_contract", label: "工具合同未对齐", detail: "工具发现结果缺少可验证 schema。", next_action: "等待 owner 发布兼容的工具合同。" };
  if (input.degraded) return { stage: "degraded", label: "MCP 部分可用", detail: "工具发现成功，但观测不完整。", next_action: "可查看推荐，不能把观测缺口当成调用成功。" };
  if (input.invocation === "validated") return { stage: "invocation_ready", label: "只读调用已验证", detail: "选定工具通过只读检查；这不代表 Provider 任务成功。", next_action: "进入资产 preflight，确认版本后再生成计划。" };
  return { stage: input.tools > 0 ? "discovery_ready" : "invocation_unverified", label: "工具发现成功 · 调用未验证", detail: `已发现 ${input.tools} 个工具。发现成功不等于工具调用或资产生产成功。`, next_action: "选择一个只读工具做调用前检查，或先查看推荐的 Skill 与模板。" };
}

export function recommendSkillTemplate(intent: AssetIntent, skills: readonly SkillDescriptor[], templates: readonly TemplateDescriptor[]): SkillTemplateRecommendation {
  const skill = skills.find((item) => item.intents.includes(intent) && item.availability !== "forbidden" && item.availability !== "body_forbidden") || null;
  const template = templates.find((item) => item.intents.includes(intent) && (!skill || skill.required_templates.length === 0 || skill.required_templates.includes(item.ref)) && item.availability !== "forbidden" && item.availability !== "body_forbidden") || null;
  if (!skill && !template) return { intent, skill: null, template: null, reason: "owner_contract_missing", executable: false };
  return { intent, skill, template, reason: template?.availability === "needs_contract" || skill?.availability === "needs_contract" ? "needs_contract" : "matched_metadata", executable: false };
}

export function pinSelection(current: SkillTemplateSelection | null, preview: SkillTemplateSelection): SkillTemplateSelection | undefined {
  if (preview.state !== "previewed" || !preview.template_ref || !preview.template_digest) return;
  if (current?.state === "pinned" && current.template_digest && current.template_digest !== preview.template_digest) return { ...preview, state: "previewed", reason: "digest_changed_requires_confirmation" };
  return { ...preview, state: "pinned" };
}

export function buildAssetPreflight(intent: AssetIntent, recommendation: SkillTemplateRecommendation, selection: SkillTemplateSelection | null): AssetPreflight {
  let availability: SkillTemplateAvailability = "needs_contract";
  if (recommendation.skill || recommendation.template) availability = selection?.state === "pinned" ? "pinned" : recommendation.template?.availability || recommendation.skill?.availability || "needs_contract";
  let next = "查看推荐并确认版本；确认前不会固定或执行。";
  if (availability === "needs_contract") next = "等待模板 owner 发布 body-free 合同；当前不能执行生成。";
  else if (selection?.state === "pinned") next = "版本已固定。生成仍须通过 owner 的独立确认，不会自动提交。";
  return {
    schema_version: skillTemplateExperienceSchema,
    intent,
    recommendation,
    selection,
    availability,
    provider_calls: 0,
    durable_writes: 0,
    next_action: next,
  };
}
