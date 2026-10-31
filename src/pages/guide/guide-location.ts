/**
 * Where the reader is in the guide: a chapter, a page inside it (one tool under 工具), the tool and client the steps
 * show, and a section to land on. The signed-in app keeps this in its hash route (`#/guide/<chapter>/<page>?…`);
 * the public page keeps it in its query string with the section as a real `#fragment`. Pure functions only, so the
 * sign-in redirect can use it without loading the guide.
 */
export type GuideChapterId = "start" | "tools" | "cases" | "connect" | "help";
export type GuideClientId = "claude" | "codex";

export interface GuideChapter { id: GuideChapterId; label: string; summary: string }
export interface GuideOutlineItem { id: string; label: string; children?: GuideOutlineItem[] }
export interface GuideLocation {
  chapter: GuideChapterId;
  /** A page inside the chapter; only 工具 has pages, one per tool. */
  page: string | null;
  /** The tool the three steps show. */
  tool: string | null;
  client: GuideClientId;
  section: string | null;
}

export const guideChapters: GuideChapter[] = [
  { id: "start", label: "开始", summary: "装好 CLI、体检环境、接进 Agent" },
  { id: "tools", label: "工具", summary: "每个工具做什么、怎么装、怎么用" },
  { id: "cases", label: "案例", summary: "真实生成记录与 Agent 对话回放" },
  { id: "connect", label: "接入", summary: "Claude Code、Codex 与控制中心的配置" },
  { id: "help", label: "排障与问答", summary: "遇到问题先查这里" },
];

/** Pages under 工具. Kept here rather than read from the guide copy, so this module stays small. */
export const guideToolPages = ["eikona", "sonora", "scaena", "auctra"] as const;

/** Sections each chapter offers in its outline; a tool page builds its own from the tool's manual. */
export const chapterOutlines: Record<GuideChapterId, GuideOutlineItem[]> = {
  start: [
    { id: "guide-steps", label: "三步上手" },
    { id: "guide-flow", label: "调用约定" },
    { id: "guide-next", label: "接下来" },
  ],
  tools: [
    { id: "guide-tools", label: "创作工具" },
    { id: "guide-open-tools", label: "更多 MCP 工具" },
  ],
  cases: [
    { id: "guide-showcase", label: "真实案例", children: [
      { id: "guide-showcase-models", label: "两个模型对比" },
      { id: "guide-showcase-edit", label: "改图" },
      { id: "guide-showcase-video", label: "视频" },
      { id: "guide-showcase-audio", label: "声音" },
    ] },
    { id: "guide-replay", label: "Agent 回放" },
  ],
  connect: [
    { id: "guide-config", label: "Claude Code 与 Codex" },
    { id: "guide-control-center", label: "接入控制中心" },
    { id: "guide-control-center-more", label: "更多工具" },
  ],
  help: [
    { id: "guide-trouble", label: "排障" },
    { id: "guide-faq", label: "常见问题" },
  ],
};

const chapterIds = new Set<string>(guideChapters.map((chapter) => chapter.id));
const toolPages = new Set<string>(guideToolPages);
/** Old addresses that already led to the guide keep working and land somewhere sensible. */
const aliasChapters: Record<string, GuideChapterId> = { help: "help", mcp: "connect", docs: "start", cli: "start" };
const sectionPattern = /^guide-[a-z0-9-]{1,80}$/;

const chapterOf = (value: string | null | undefined): GuideChapterId | null => value && chapterIds.has(value) ? value as GuideChapterId : null;
const clientOf = (value: string | null): GuideClientId => value === "codex" ? "codex" : "claude";
const sectionOf = (value: string | null | undefined) => value && sectionPattern.test(value) ? value : null;
const pageOf = (chapter: GuideChapterId, value: string | null | undefined) => chapter === "tools" && value && toolPages.has(value) ? value : null;

/** The chapter and page a section lives on, so a link to it can open the right view first. */
export function locateSection(id: string): { chapter: GuideChapterId; page: string | null } | null {
  for (const page of guideToolPages) if (id === `guide-tool-${page}` || id.startsWith(`guide-tool-${page}-`)) return { chapter: "tools", page };
  for (const chapter of guideChapters) {
    const items = chapterOutlines[chapter.id].flatMap((item) => [item, ...(item.children || [])]);
    if (items.some((item) => item.id === id)) return { chapter: chapter.id, page: null };
  }
  return null;
}

/**
 * Reads the signed-in address. `#/guide` alone with a tool, as old links and the batch page send, opens the three
 * steps for that tool.
 */
export function parseAppGuide(pathname: string, params: URLSearchParams): GuideLocation {
  const [first, second, third] = pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const named = first === "guide" ? chapterOf(second) : aliasChapters[first || ""] || null;
  const chapter = named || "start";
  const tool = params.get("tool");
  const legacy = first === "guide" && !second && !!tool;
  return { chapter, page: first === "guide" ? pageOf(chapter, third) : null, tool, client: clientOf(params.get("client")), section: sectionOf(params.get("section")) || (legacy ? "guide-steps" : null) };
}

/** Reads the public page's address: `guide.html?chapter=&page=&tool=&client=#section`. */
export function parsePublicGuide(params: URLSearchParams, hash = ""): GuideLocation {
  const chapter = chapterOf(params.get("chapter")) || "start";
  const tool = params.get("tool");
  const legacy = !params.get("chapter") && !!tool;
  return { chapter, page: pageOf(chapter, params.get("page")), tool, client: clientOf(params.get("client")), section: sectionOf(hash.replace(/^#/, "")) || sectionOf(params.get("section")) || (legacy ? "guide-steps" : null) };
}

function choiceParams(location: GuideLocation) {
  const params = new URLSearchParams();
  if (location.tool) params.set("tool", location.tool);
  if (location.client === "codex") params.set("client", "codex");
  return params;
}

/** The signed-in route for a location, for `navigate()`; prefix `#` for an href. */
export function appGuidePath(location: GuideLocation) {
  const params = choiceParams(location);
  if (location.section) params.set("section", location.section);
  const query = params.toString();
  return `/guide/${location.chapter}${location.page ? `/${location.page}` : ""}${query ? `?${query}` : ""}`;
}

/** The public page's address for a location. */
export function publicGuideHref(location: GuideLocation, path = "guide.html") {
  const choices = choiceParams(location);
  const params = new URLSearchParams();
  // The chapter is named whenever anything else is, so a tool alone still reads as an old link.
  if (location.chapter !== "start" || location.page || choices.toString() || location.section) params.set("chapter", location.chapter);
  if (location.page) params.set("page", location.page);
  for (const [key, value] of choices) params.set(key, value);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${location.section ? `#${location.section}` : ""}`;
}

/** Whether a signed-in path is the guide or one of its aliases. */
export function isGuidePath(pathname: string) {
  const first = pathname.replace(/^\/+/, "").split("/")[0] || "";
  return first === "guide" || first in aliasChapters;
}

/** Where a signed-out visit to a guide address goes: the public page at the same place. */
export function publicGuideFromApp(pathname: string, search: string) {
  return publicGuideHref(parseAppGuide(pathname, new URLSearchParams(search)));
}
