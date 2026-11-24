import { describe, expect, it } from "vitest";
import { kindCountText, projectHomeTabs } from "../src/pages/projects/ProjectHome";
import { connectInstanceCommand, projectReference } from "../src/pages/projects/ProjectConnections";
import { defaultOrganizationName, wizardSteps } from "../src/pages/projects/NewProjectWizard";

describe("project home", () => {
  it("opens on an overview and keeps assets, production, tasks, connections and members as tabs", () => {
    expect(projectHomeTabs.map((tab) => tab.label)).toEqual(["概览", "资产", "制作", "任务", "连接", "成员"]);
  });

  it("counts a finished directory exactly and an unfinished one as a lower bound", () => {
    expect(kindCountText({ total: 7, coverage: "complete", rows: new Array(7) })).toBe("7");
    expect(kindCountText({ total: 0, coverage: "complete", rows: [] })).toBe("0");
    expect(kindCountText({ total: 100, coverage: "partial", rows: new Array(100) })).toBe("100+");
    expect(kindCountText(null)).toBe("—");
  });

  it("hands Agents a project reference and shows a connect command made of placeholders only", () => {
    expect(projectReference({ id: "project_abc" })).toBe("yeisme-project:project_abc");
    expect(connectInstanceCommand).toContain("https://<owner-host>/mcp");
    expect(connectInstanceCommand).not.toMatch(/\d+\.\d+\.\d+\.\d+|localhost/);
    expect(connectInstanceCommand.replace(/<[^>]+>/g, "")).not.toMatch(/[A-Za-z0-9_-]{24,}/);
  });
});

describe("new project wizard", () => {
  it("asks for tools and people only when an organization can offer them", () => {
    expect(wizardSteps(true)).toEqual(["name", "tools", "people", "review"]);
    expect(wizardSteps(false)).toEqual(["name", "review"]);
    expect(defaultOrganizationName).toBe("我的工作室");
  });
});
