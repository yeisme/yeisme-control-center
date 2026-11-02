import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuideContent } from "../src/pages/guide/GuideContent";
import { guideTools } from "../src/pages/guide/guide-content";
import { toolManuals } from "../src/pages/guide/guide-reference";
import { appGuidePath, chapterOutlines, guideChapters, guideToolPages, isGuidePath, locateSection, parseAppGuide, parsePublicGuide, publicGuideFromApp, publicGuideHref, type GuideLocation } from "../src/pages/guide/guide-location";
import { toolOutline } from "../src/pages/guide/GuideTools";

const nav = { hrefFor: (to: GuideLocation) => `#${appGuidePath(to)}`, go: () => undefined };
const render = (location: GuideLocation) => renderToString(createElement(GuideContent, { location, nav, link: { label: "登录控制中心查看工具状态", href: "./" }, page: "public-guide" }));
const at = (patch: Partial<GuideLocation>): GuideLocation => ({ chapter: "start", page: null, tool: null, client: "claude", section: null, ...patch });

describe("guide location", () => {
  it("reads and writes the signed-in hash route", () => {
    expect(parseAppGuide("/guide/tools/sonora", new URLSearchParams("client=codex&section=guide-tool-sonora-mcp"))).toEqual({ chapter: "tools", page: "sonora", tool: null, client: "codex", section: "guide-tool-sonora-mcp" });
    expect(appGuidePath(at({ chapter: "tools", page: "sonora", client: "codex", section: "guide-tool-sonora-mcp" }))).toBe("/guide/tools/sonora?client=codex&section=guide-tool-sonora-mcp");
    // Unknown chapters and pages fall back instead of failing; a section must look like a guide id.
    expect(parseAppGuide("/guide/nowhere/x", new URLSearchParams("section=../evil"))).toEqual(at({}));
    expect(parseAppGuide("/guide/cases/eikona", new URLSearchParams())).toEqual(at({ chapter: "cases" }));
    expect(parseAppGuide("/guide/tools/unknown", new URLSearchParams())).toEqual(at({ chapter: "tools" }));
  });

  it("opens the three steps for old links that only name a tool, and keeps aliases working", () => {
    expect(parseAppGuide("/guide", new URLSearchParams("tool=sonora"))).toEqual(at({ tool: "sonora", section: "guide-steps" }));
    // Once a chapter is named, a tool is just the picker's choice and does not move the reader.
    expect(parseAppGuide("/guide/start", new URLSearchParams("tool=sonora"))).toEqual(at({ tool: "sonora" }));
    expect(parseAppGuide("/help", new URLSearchParams()).chapter).toBe("help");
    expect(parseAppGuide("/mcp", new URLSearchParams()).chapter).toBe("connect");
    expect(isGuidePath("/guide/cases")).toBe(true);
    expect(isGuidePath("/docs")).toBe(true);
    expect(isGuidePath("/tasks")).toBe(false);
  });

  it("reads and writes the public address with the section as a real fragment", () => {
    const location = at({ chapter: "cases", client: "codex", section: "guide-showcase-video" });
    const href = publicGuideHref(location);
    expect(href).toBe("guide.html?chapter=cases&client=codex#guide-showcase-video");
    const url = new URL(href, "https://example.test/");
    expect(parsePublicGuide(url.searchParams, url.hash)).toEqual(location);
    expect(publicGuideHref(at({}))).toBe("guide.html");
    // A chosen tool on 开始 names its chapter, so a reload is not read as an old link that jumps to the steps.
    expect(publicGuideHref(at({ tool: "sonora" }))).toBe("guide.html?chapter=start&tool=sonora");
    expect(parsePublicGuide(new URLSearchParams("tool=sonora&client=codex"))).toEqual(at({ tool: "sonora", client: "codex", section: "guide-steps" }));
  });

  it("sends a signed-out visit to the same place on the public page", () => {
    expect(publicGuideFromApp("/guide/tools/sonora", "?client=codex")).toBe("guide.html?chapter=tools&page=sonora&client=codex");
    expect(publicGuideFromApp("/guide", "?tool=sonora&client=codex")).toBe("guide.html?chapter=start&tool=sonora&client=codex#guide-steps");
  });

  it("lists every tool as a page, and every section a link can point to belongs to a chapter", () => {
    expect([...guideToolPages]).toEqual(guideTools.map((tool) => tool.id));
    for (const manual of toolManuals) for (const sample of manual.samples) expect(locateSection(sample.target), sample.target).not.toBeNull();
    expect(locateSection("guide-tool-eikona-mcp")).toEqual({ chapter: "tools", page: "eikona" });
    expect(locateSection("guide-showcase-audio")).toEqual({ chapter: "cases", page: null });
  });

  it("opens a credential's renewal section on 接入, in the signed-in route and on the public page", () => {
    for (const tool of ["anatomia", "drivebridge", "gateway"]) {
      const id = `guide-renew-${tool}`;
      expect(locateSection(id)).toEqual({ chapter: "connect", page: null });
      expect(appGuidePath(at({ chapter: "connect", section: id }))).toBe(`/guide/connect?section=${id}`);
      expect(parseAppGuide("/guide/connect", new URLSearchParams(`section=${id}`))).toEqual(at({ chapter: "connect", section: id }));
      expect(publicGuideHref(at({ chapter: "connect", section: id }))).toBe(`guide.html?chapter=connect#${id}`);
    }
    expect(locateSection("guide-renew")).toEqual({ chapter: "connect", page: null });
  });
});

describe("guide chapters", () => {
  it("renders every chapter and tool page with no router, session or workspace, and every outline entry has its section", () => {
    const places = [...guideChapters.map((chapter) => at({ chapter: chapter.id })), ...guideToolPages.map((page) => at({ chapter: "tools", page }))];
    for (const place of places) {
      const html = render(place);
      expect(html, place.chapter).toContain('data-page="public-guide"');
      expect(html, place.chapter).toMatch(/aria-label="指南章节"/);
      // The open chapter is marked in the top bar, and only it.
      const current = guideChapters.find((chapter) => chapter.id === place.chapter)!;
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toContain(`aria-current="page">${current.label}<`);
      const tool = place.page ? guideTools.find((item) => item.id === place.page)! : null;
      const outline = tool ? toolOutline(tool) : chapterOutlines[place.chapter];
      for (const item of outline.flatMap((entry) => [entry, ...(entry.children || [])])) expect(html, `${place.chapter}/${place.page}:${item.id}`).toContain(`id="${item.id}"`);
    }
  });

  it("keeps the public promise on 开始: no account data, a sign-in link and the chosen tool", () => {
    const html = render(at({ tool: "sonora", client: "codex" }));
    expect(html).toContain("公开页面");
    expect(html).toContain('href="./"');
    expect(html).toContain("sonora mcp serve --stdio");
    expect(html).not.toContain("控制中心已发现");
  });

  it("links chapters, tool pages and samples with real addresses", () => {
    const tools = render(at({ chapter: "tools" }));
    expect(tools).toContain('href="#/guide/tools/eikona"');
    expect(tools).toContain('href="#/guide/start?tool=sonora&amp;section=guide-steps"');
    const eikona = render(at({ chapter: "tools", page: "eikona" }));
    expect(eikona).toContain('href="#/guide/cases?section=guide-showcase-models"');
    expect(render(at({ chapter: "cases" }))).toContain('href="#/guide/connect"');
  });
});
