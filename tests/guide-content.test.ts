import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentAccountCommand, agentReadSteps, callFlow, connectCommands, faqs, flowStations, guideTools, handoffSteps, moreTools, tagline } from "../src/pages/guide/guide-content";
import { productionStations } from "../src/shared/production-line";
import { briefGuardrails } from "../src/shared/agent-brief";
import { navItems, navItem } from "../src/app-shell/navigation";
import { connectedTools, renewGeneral } from "../src/pages/guide/guide-reference";
import { renewGuideTools, renewSection, renewSectionId } from "../src/shared/credentials";

const allCommands = () => [
  ...guideTools.flatMap((tool) => [tool.install, tool.mcp.command, ...tool.commands.map((item) => item.command), ...tool.check.map((item) => item.command), ...connectCommands(tool, "claude").map((item) => item.command), ...connectCommands(tool, "codex").map((item) => item.command)]),
  ...moreTools.map((item) => item.command),
];

describe("使用指南 content", () => {
  it("keeps the guide and batch generation as tabs, and AI 创作 gone from the sidebar", () => {
    expect(navItems.map((item) => item.id)).toContain("guide");
    expect(navItem("creation")).toMatchObject({ label: "批量生成", group: "create" });
    expect(navItem("guide").group).toBe("settings");
    expect(navItems.find((item) => item.label === "AI 创作")).toBeUndefined();
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

  it("gives every connected tool renewal steps that end in a credential replace for its own slot", () => {
    expect(connectedTools.map((tool) => tool.id).sort()).toEqual([...renewGuideTools].sort());
    const slots = { anatomia: "connection:anatomia-main", drivebridge: "open_tool:drivebridge", gateway: "open_tool:gateway" } as const;
    for (const tool of connectedTools) {
      expect(tool.renew.length, tool.id).toBeGreaterThanOrEqual(2);
      const last = tool.renew.at(-1)!.command;
      expect(last, tool.id).toMatch(new RegExp(`^bun scripts/personal-config\\.ts credential <config-file> replace ${slots[tool.id]} <key-dir>/`));
      // The new credential goes into a new file, never over the one the first connection used.
      const fileIn = (command: string) => command.match(/<key-dir>\/\S+/)?.[0];
      const first = tool.steps.map((step) => fileIn(step.command)).filter(Boolean).at(-1);
      expect(fileIn(last), tool.id).toBeDefined();
      expect(fileIn(last), tool.id).not.toBe(first);
      for (const step of tool.renew) expect(step.note.length, step.command).toBeGreaterThan(10);
    }
  });

  it("stops DriveBridge before it signs and starts it before the credential is replaced, and records the new expiry", () => {
    const steps = connectedTools.find((tool) => tool.id === "drivebridge")!.renew.map((step) => step.command);
    const at = (needle: string) => steps.findIndex((command) => command.includes(needle));
    expect(at("stop")).toBeGreaterThanOrEqual(0);
    expect(at("stop")).toBeLessThan(at("agents create"));
    expect(at("agents create")).toBeLessThan(at("start"));
    expect(at("start")).toBeLessThan(at("credential <config-file> replace"));
    expect(steps[at("agents create")]).toMatch(/--out <key-dir>\/\S+/);
    expect(steps[at("credential <config-file> replace")]).toContain("--expires-at <RFC3339>");
    const gateway = connectedTools.find((tool) => tool.id === "gateway")!.renew.map((step) => step.command);
    expect(gateway[0]).toMatch(/^mcp-gateway tokens create /);
    const anatomia = connectedTools.find((tool) => tool.id === "anatomia")!.renew.map((step) => step.command);
    expect(anatomia[0]).toMatch(/^anatomia service key create .*--out <key-dir>\//);
  });

  it("points every credential at a renewal section that exists, with the general one for tools without their own", () => {
    for (const tool of connectedTools) expect(renewSection({ owner: tool.id })).toBe(`guide-renew-${tool.id}`);
    for (const owner of ["eikona", "sonora", "scaena", "auctra", "aigora"]) expect(renewSection({ owner })).toBe(renewSectionId);
    expect(renewGeneral.map((step) => step.command).join("\n")).toMatch(/credential <config-file> list[\s\S]*replace connection:<id>[\s\S]*expiry <slot> <RFC3339>/);
    for (const command of [...connectedTools.flatMap((tool) => tool.renew), ...renewGeneral].map((step) => step.command)) {
      expect(command).not.toMatch(/https?:\/\/|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\/home\/|\/Users\//);
    }
  });

  it("keeps the landing structure: three call steps, a multi-line tagline and six to twelve FAQs", () => {
    expect(callFlow).toHaveLength(3);
    expect(tagline.join("").length).toBeGreaterThan(20);
    expect(faqs.length).toBeGreaterThanOrEqual(6);
    expect(faqs.length).toBeLessThanOrEqual(12);
  });
});

describe("使用指南 · 流程", () => {
  it("lists the seven stations in order and keeps the missing contracts visible", () => {
    expect(Object.keys(flowStations)).toEqual([...productionStations]);
    expect(flowStations.look.ready).toBe("no");
    expect(flowStations.cut.today).toContain("待接通");
  });

  it("reads the line with placeholders only, logs in once with the key from a file, and writes nothing but the logout", () => {
    for (const step of [...agentReadSteps, agentAccountCommand]) expect(step.command, step.command).not.toMatch(/https?:\/\/|Bearer|\b\d{1,3}(\.\d{1,3}){3}\b/);
    const logins = agentReadSteps.filter((step) => step.command.includes("/auth/personal"));
    expect(logins).toHaveLength(1);
    expect(logins[0].command).toContain("--rawfile key '<密钥文件>'");
    expect(agentReadSteps.filter((step) => step.command.includes("-X POST")).map((step) => step.command.match(/\/api\/control-center\/v1\/[a-z/]+/)?.[0])).toEqual(["/api/control-center/v1/auth/logout"]);
    expect(agentReadSteps.some((step) => step.command.includes("/api/control-center/v1/production?scope=<范围>&episode_ref=<集引用>"))).toBe(true);
    expect(agentReadSteps[0].command).toContain("YEISME_CONTROL_ORIGIN");
    expect(agentReadSteps.slice(1).filter((step) => step.command.includes("/api/control-center/v1/")).every((step) => step.command.includes("$YEISME_CONTROL_ORIGIN"))).toBe(true);
  });

  it("shows the rules every brief carries, and hands off one text for any agent", () => {
    expect(briefGuardrails.some((rule) => rule.includes("dry_run"))).toBe(true);
    const words = handoffSteps.map((step) => `${step.title} ${step.body}`).join("\n");
    expect(words).toContain("复制给 Agent 的说明");
    expect(words).not.toMatch(/Claude Code|Codex|JSON|命令/);
  });
});
