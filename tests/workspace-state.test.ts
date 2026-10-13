import { describe, it, expect } from "vitest";
import {
  configDefault,
  configDraft,
  configChanged,
  validateConfig,
  parseConfig,
  validateConnect,
} from "../src/workspace-state";
describe("workspace form boundaries", () => {
  it("keeps blank numeric drafts distinct from zero and reports separate errors", () => {
    const draft = {
      ...configDraft(configDefault),
      concurrency: "",
      timeout: "601",
    };
    expect(draft.concurrency).toBe("");
    expect(validateConfig(draft)).toEqual({
      concurrency: "请填写并发上限。",
      timeout: "请输入 10–600 之间的整数。",
    });
    expect(parseConfig(draft)).toBeNull();
  });
  it("accepts only integer ranges and keeps revision during conversion", () => {
    expect(
      parseConfig({ ...configDraft(configDefault), concurrency: "1.5" }),
    ).toBeNull();
    expect(
      parseConfig({
        concurrency: "16",
        timeout: "600",
        profile: "quality",
        revision: 2,
      }),
    ).toEqual({
      concurrency: 16,
      timeout: 600,
      profile: "quality",
      revision: 2,
    });
  });
  it("detects edits and compares rebased drafts against the new effective configuration", () => {
    const draft = configDraft(configDefault);
    expect(configChanged(draft, configDefault)).toBe(false);
    expect(
      configChanged(
        { ...draft, concurrency: "04", timeout: "90.0" },
        configDefault,
      ),
    ).toBe(false);
    const updated = { ...configDefault, concurrency: 6, revision: 2 };
    expect(configChanged({ ...draft, revision: 2 }, updated)).toBe(true);
    expect(configChanged(configDraft(updated), updated)).toBe(false);
  });
  it("validates only required wizard stages and rejects addresses or plaintext credentials", () => {
    expect(
      validateConnect(
        { name: "", ref: "https://example.com", credential: "not-a-reference" },
        0,
      ),
    ).toEqual({ name: "请填写实例名称。" });
    const invalid = validateConnect(
      {
        name: "Eikona",
        ref: "https://example.com",
        credential: "not-a-reference",
      },
      1,
    );
    expect(Object.keys(invalid)).toEqual(["ref", "credential"]);
    expect(
      validateConnect(
        {
          name: "Eikona",
          ref: "connection://lan/eikona",
          credential: "credentialctl://team/eikona",
        },
        2,
      ),
    ).toEqual({});
  });
  it("keeps whitespace-only drafts invalid without changing the effective config", () => {
    const draft = { ...configDraft(configDefault), timeout: "  " };
    expect(validateConfig(draft).timeout).toBe("请填写请求超时。");
    expect(configChanged(draft, configDefault)).toBe(true);
    expect(configDefault.timeout).toBe(90);
  });
});
