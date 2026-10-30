import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { GuideContent } from "../src/pages/guide/GuideContent";

describe("public guide", () => {
  it("renders with no router, session or workspace, and links to sign-in instead of the catalog", () => {
    const html = renderToString(createElement(GuideContent, { toolId: "sonora", client: "codex", onTool: () => undefined, onClient: () => undefined, link: { label: "登录控制中心查看工具状态", href: "./" }, page: "public-guide" }));
    expect(html).toContain('data-page="public-guide"');
    expect(html).toContain("公开页面");
    expect(html).toContain('href="./"');
    expect(html).toContain("sonora");
    expect(html).not.toContain("控制中心已发现");
  });
});
