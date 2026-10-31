import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { callFlow, connectCommands, faqs, guideTools, moreTools, tagline } from "../src/pages/guide/guide-content";
import { navItems, navItem } from "../src/app-shell/navigation";

const allCommands = () => [
  ...guideTools.flatMap((tool) => [tool.install, tool.mcp.command, ...tool.commands.map((item) => item.command), ...tool.check.map((item) => item.command), ...connectCommands(tool, "claude").map((item) => item.command), ...connectCommands(tool, "codex").map((item) => item.command)]),
  ...moreTools.map((item) => item.command),
];

describe("使用指南 content", () => {
  it("replaces AI 创作 in the sidebar while keeping batch generation addressable", () => {
    expect(navItems.map((item) => item.id)).toContain("guide");
    expect(navItems.map((item) => item.id)).not.toContain("creation");
    expect(navItems.find((item) => item.label === "AI 创作")).toBeUndefined();
    expect(navItem("creation").label).toBe("批量生成");
  });

  it("never ships internal addresses, home paths or token values in commands", () => {
    for (const command of allCommands()) {
      expect(command).not.toMatch(/\b10\.\d+\.\d+\.\d+\b|192\.168\.|\/home\/|qianxi|coglet|Bearer [A-Za-z0-9]/);
      expect(command).not.toMatch(/:(8443|51873|1897\d|1898\d)\b/);
    }
  });

  it("keeps every guide source free of internal addresses, home paths and tokens, since the guide is public", () => {
    const names = readdirSync(resolve(import.meta.dirname, "../src/pages/guide")).filter((name) => /\.tsx?$/.test(name));
    expect(names).toEqual(expect.arrayContaining(["guide-content.ts", "GuideContent.tsx", "showcase.ts", "agent-replays.ts", "guide-reference.ts"]));
    for (const name of names) {
      const source = readFileSync(resolve(import.meta.dirname, "../src/pages/guide", name), "utf8");
      expect(source, name).not.toMatch(/\b10\.\d+\.\d+\.\d+\b|\b192\.168\.|\b172\.(1[6-9]|2\d|3[01])\.|\/home\/|\/Users\/|qianxi|coglet|\.local\b|Bearer [A-Za-z0-9]|sk-[A-Za-z0-9]{8}/);
    }
  });

  it("registers every tool the same way in each client and keeps tokens in env vars", () => {
    for (const tool of guideTools) {
      const claude = connectCommands(tool, "claude");
      expect(claude[0]).toEqual({ command: `claude mcp add ${tool.id} -- ${tool.mcp.command}`, note: expect.any(String) });
      // The shared form names the variable in single quotes, so the token itself never reaches .mcp.json.
      if (tool.sharedEnv) expect(claude[1].command).toBe(`claude mcp add --transport http -s project ${tool.id}-lan http://<lan-host>:<port>/mcp --header 'Authorization: Bearer \${${tool.sharedEnv}}'`);
      else expect(claude).toHaveLength(1);
      const codex = connectCommands(tool, "codex");
      expect(codex[0].command).toBe(`codex mcp add ${tool.id} -- ${tool.mcp.command}`);
      if (tool.sharedEnv) expect(codex[1].command).toMatch(new RegExp(`--bearer-token-env-var ${tool.sharedEnv}$`));
      else expect(codex).toHaveLength(1);
      expect(tool.install).toMatch(/^curl -fsSL https:\/\/raw\.githubusercontent\.com\/yeisme\/yeisme-dist\/main\/install\.sh \| bash -s -- [a-z]+$/);
    }
  });

  it("keeps step two free of paid calls and flags tools whose release lacks MCP", () => {
    for (const tool of guideTools) {
      for (const item of tool.check) expect(item.command).not.toMatch(/\bgenerate\b|--confirm|run_start|music/);
    }
    expect(guideTools.filter((tool) => tool.mcpNote).map((tool) => tool.id)).toEqual(["sonora", "auctra"]);
  });

  it("keeps the guide free of the ui barrel and Radix, so the public page loads no menu or dialog code", () => {
    const names = readdirSync(resolve(import.meta.dirname, "../src/pages/guide")).filter((name) => /\.tsx?$/.test(name));
    for (const name of names) {
      const source = readFileSync(resolve(import.meta.dirname, "../src/pages/guide", name), "utf8");
      expect(source, name).not.toMatch(/from ["'](radix-ui|@radix-ui\/[^"']+)["']|from ["']\.\.\/\.\.\/components\/ui["']/);
    }
  });

  it("keeps the landing structure: three call steps, a multi-line tagline and six to twelve FAQs", () => {
    expect(callFlow).toHaveLength(3);
    expect(tagline.join("").length).toBeGreaterThan(20);
    expect(faqs.length).toBeGreaterThanOrEqual(6);
    expect(faqs.length).toBeLessThanOrEqual(12);
  });
});
