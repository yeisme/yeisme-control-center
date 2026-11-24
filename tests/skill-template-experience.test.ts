import { describe, expect, test } from "vitest";
import { assetIntents, buildAssetPreflight, diagnoseMcpConnection, normalizeSkillDescriptor, normalizeTemplateDescriptor, pinSelection, recommendSkillTemplate } from "../src/shared/skill-template-experience";

const digest = `sha256:${"a".repeat(64)}`;
const nextDigest = `sha256:${"b".repeat(64)}`;

const skill = {
  ref: "skill:yeisme/image-preset",
  title: "图片预设",
  version: "1.2.0",
  revision: "r1",
  digest,
  source_id: "yeisme-official",
  intents: ["image"],
  required_tools: ["eikona.execute"],
  required_templates: ["template:promptrepo/image-v1"],
  maturity: "exploratory",
  availability: "available",
  blockers: [],
};

const template = {
  ref: "template:promptrepo/image-v1",
  title: "图片模板",
  version: "3",
  revision: "rev3",
  digest,
  snapshot: "snap3",
  source_owner: "promptrepo",
  intents: ["image"],
  maturity: "unknown",
  rights: "unknown",
  availability: "needs_contract",
  blockers: ["owner_contract_missing"],
};

describe("skill template experience", () => {
  test("rejects executable or secret manifest fields", () => {
    expect(normalizeSkillDescriptor({ ...skill, command: "curl example.invalid" })).toBeUndefined();
    expect(normalizeTemplateDescriptor({ ...template, body: "secret prompt" })).toBeUndefined();
    expect(normalizeTemplateDescriptor({ ...template, credential: "token" })).toBeUndefined();
  });

  test("keeps discovery distinct from invocation across connection stages", () => {
    expect(diagnoseMcpConnection({ configured: false, transport: false, protocol: false, tools: null, schemaValid: false, invocation: "unverified", degraded: false }).stage).toBe("unconfigured");
    expect(diagnoseMcpConnection({ configured: true, transport: false, protocol: false, tools: null, schemaValid: false, invocation: "unverified", degraded: false }).stage).toBe("unavailable");
    expect(diagnoseMcpConnection({ configured: true, transport: true, protocol: true, tools: 4, schemaValid: true, invocation: "forbidden", degraded: false }).stage).toBe("forbidden");
    expect(diagnoseMcpConnection({ configured: true, transport: true, protocol: false, tools: null, schemaValid: false, invocation: "unverified", degraded: false }).stage).toBe("needs_contract");
    expect(diagnoseMcpConnection({ configured: true, transport: true, protocol: true, tools: 4, schemaValid: false, invocation: "unverified", degraded: false }).stage).toBe("needs_contract");
    expect(diagnoseMcpConnection({ configured: true, transport: true, protocol: true, tools: 4, schemaValid: true, invocation: "unverified", degraded: true }).stage).toBe("degraded");
    const diagnosis = diagnoseMcpConnection({ configured: true, transport: true, protocol: true, tools: 12, schemaValid: true, invocation: "unverified", degraded: false });
    expect(diagnosis.stage).toBe("discovery_ready");
    expect(diagnosis.label).toContain("调用未验证");
    expect(diagnoseMcpConnection({ configured: true, transport: true, protocol: true, tools: 12, schemaValid: true, invocation: "validated", degraded: false }).stage).toBe("invocation_ready");
  });

  test("fails closed with zero provider calls across all five asset intents when no owner contract exists", () => {
    for (const intent of assetIntents) {
      const recommendation = recommendSkillTemplate(intent, [], []);
      expect(recommendation).toEqual({ intent, skill: null, template: null, reason: "owner_contract_missing", executable: false });
      const preflight = buildAssetPreflight(intent, recommendation, null);
      expect(preflight).toMatchObject({ intent, availability: "needs_contract", provider_calls: 0, durable_writes: 0 });
    }
  });

  test("recommends metadata without making it executable", () => {
    const parsedSkill = normalizeSkillDescriptor(skill);
    const parsedTemplate = normalizeTemplateDescriptor(template);
    expect(parsedSkill?.executable).toBe(false);
    expect(parsedTemplate?.executable).toBe(false);
    const recommendation = recommendSkillTemplate("image", parsedSkill ? [parsedSkill] : [], parsedTemplate ? [parsedTemplate] : []);
    const preflight = buildAssetPreflight("image", recommendation, null);
    expect(preflight.provider_calls).toBe(0);
    expect(preflight.availability).toBe("needs_contract");
    expect(preflight.next_action).toContain("不能执行生成");
  });

  test("requires confirmation when a pinned digest changes and rejects unpreviewed inputs", () => {
    const current = { intent: "image" as const, template_ref: template.ref, template_digest: digest, state: "pinned" as const };
    const preview = { ...current, template_digest: nextDigest, state: "previewed" as const };
    expect(pinSelection(current, preview)?.state).toBe("previewed");
    expect(pinSelection(current, preview)?.reason).toBe("digest_changed_requires_confirmation");
    expect(pinSelection(null, preview)?.state).toBe("pinned");
    expect(pinSelection(null, { ...preview, state: "skipped" })).toBeUndefined();
    expect(pinSelection(null, { intent: "image", state: "previewed" })).toBeUndefined();
  });
});
