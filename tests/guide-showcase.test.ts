import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { agentReplays } from "../src/pages/guide/agent-replays";
import { allShowcaseItems, editPair, showcaseChain, showcaseRecord } from "../src/pages/guide/showcase";
import { clientConfigs, toolManuals, troubleshooting } from "../src/pages/guide/guide-reference";
import { guideTools } from "../src/pages/guide/guide-content";

const publicDir = resolve(import.meta.dirname, "../public");
const showcaseDir = resolve(publicDir, "guide/showcase");
const media = [...allShowcaseItems.map((item) => item.media), ...agentReplays.map((replay) => replay.result.media)];

describe("使用指南 real samples", () => {
  it("ships every file the manifest names, at the size it declares, inside the 8 MB budget", () => {
    for (const item of media) {
      const file = resolve(publicDir, item.src);
      expect(statSync(file).size, item.src).toBe(item.bytes);
      if (item.poster) expect(statSync(resolve(publicDir, item.poster)).isFile(), item.poster).toBe(true);
      expect(item.src).toMatch(/^guide\/showcase\/[a-z0-9-]+\.(webp|mp4|mp3)$/);
      if (item.kind === "video") expect(item.bytes, item.src).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    }
    const files = readdirSync(showcaseDir);
    const total = files.reduce((sum, name) => sum + statSync(resolve(showcaseDir, name)).size, 0);
    expect(total).toBeLessThanOrEqual(8 * 1024 * 1024);
    // No orphan: everything in the folder is referenced, so nothing unreviewed is published by accident.
    const referenced = new Set(media.flatMap((item) => [item.src, item.poster].filter(Boolean).map((src) => src!.replace("guide/showcase/", ""))));
    expect(files.filter((name) => !referenced.has(name))).toEqual([]);
  });

  it("records the prompt, call, model, cost, time, short ref and alt text of every sample", () => {
    expect(showcaseRecord.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const item of allShowcaseItems) {
      for (const field of [item.title, item.prompt, item.call, item.model, item.cost, item.time, item.ref]) expect(field.trim(), item.id).not.toBe("");
      expect(item.alt, item.id).toMatch(/^AI (生成|合成)/);
      expect(item.call, item.id).toMatch(/^(eikona|scaena|sonora)\.execute \{"action":"[a-zA-Z.]+"/);
      // Run refs are shortened: a full run id or task id would only help someone probe the owner.
      expect(item.ref, item.id).not.toMatch(/run_\d{8}|[0-9a-f]{12}/);
    }
    expect(new Set(allShowcaseItems.map((item) => item.id)).size).toBe(allShowcaseItems.length);
    expect(editPair.before.media.src).not.toBe(editPair.after.media.src);
    expect(showcaseChain.map((step) => step.item.tool)).toEqual(["eikona", "eikona", "scaena", "sonora", "sonora"]);
  });

  it("keeps each agent replay a real exchange: a request, a call, the hand-back for confirmation and a result", () => {
    expect(agentReplays.map((replay) => replay.client).sort()).toEqual(["claude", "codex"]);
    for (const replay of agentReplays) {
      const kinds = replay.steps.map((step) => step.kind);
      expect(kinds[0], replay.client).toBe("user");
      expect(kinds.filter((kind) => kind === "user").length, replay.client).toBeGreaterThanOrEqual(2);
      expect(kinds, replay.client).toContain("call");
      const reply = kinds.indexOf("user", 1);
      expect(kinds.slice(0, reply), replay.client).toContain("agent");
      for (const step of replay.steps) {
        if (step.kind === "call") expect(() => JSON.parse(step.args), step.args).not.toThrow();
        if (step.kind === "fold") expect(step.count).toBeGreaterThan(0);
      }
      expect(replay.cost.length).toBeGreaterThanOrEqual(2);
      expect(replay.runtime).toMatch(/\d+\.\d+\.\d+/);
    }
  });

  it("gives every tool a manual and keeps shared-service tokens in environment variables", () => {
    expect(toolManuals.map((manual) => manual.id).sort()).toEqual(guideTools.map((tool) => tool.id).sort());
    for (const config of clientConfigs) {
      const text = config.steps.map((step) => step.command).join("\n");
      expect(text, config.client).toMatch(config.client === "claude" ? /Bearer \$\{[A-Z_]+\}/ : /bearer_token_env_var = "[A-Z_]+"/);
      expect(text, config.client).toContain("<lan-host>:<port>");
    }
    for (const row of troubleshooting) for (const field of [row.tool, row.symptom, row.cause, row.fix]) expect(field.trim()).not.toBe("");
    expect(troubleshooting.some((row) => row.seen)).toBe(true);
  });
});
