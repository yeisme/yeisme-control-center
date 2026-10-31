import { ArrowLeft, ArrowRight, BookOpen, ShieldCheck, Terminal } from "../../icons";
// Direct imports: the public guide must not load the menu and dialog components behind the ui barrel.
import { Pill } from "../../components/ui/Status";
import { catalogCoverageLabels, catalogCoverageTone } from "../../shared/read-model/labels";
import type { ToolCatalog } from "../../shared/tool-catalog";
import { guideTools, moreTools, type GuideTool } from "./guide-content";
import { locateSection, type GuideLocation, type GuideOutlineItem } from "./guide-location";
import { Reveal, useOnScreen } from "./guide-motion";
import { GuideLink, type GuideNavigator } from "./GuideNav";
import { CommandLine, SectionHeading } from "./guide-parts";
import { toolManuals } from "./guide-reference";
import { ToolStoryVisual } from "./ToolStories";

function CoveragePill({ tool, catalog }: { tool: GuideTool; catalog: ToolCatalog | null }) {
  const coverage = catalog?.coverage.find((item) => item.owner === tool.owner) || null;
  const count = catalog?.tools.filter((item) => item.owner === tool.owner).length ?? 0;
  return coverage ? <Pill size="sm" tone={catalogCoverageTone[coverage.state]} title={coverage.reason || undefined}>{catalogCoverageLabels[coverage.state]}{count ? ` · ${count} 个工具` : ""}</Pill> : null;
}

/** Where "用 X 走一遍三步" leads: the three steps of 开始, with that tool chosen. */
const stepsFor = (location: GuideLocation, tool: GuideTool): GuideLocation => ({ ...location, chapter: "start", page: null, tool: tool.id, section: "guide-steps" });
const pageFor = (location: GuideLocation, tool: GuideTool): GuideLocation => ({ ...location, chapter: "tools", page: tool.id, section: null });

function ToolCard({ tool, catalog, index, location, nav }: { tool: GuideTool; catalog: ToolCatalog | null; index: number; location: GuideLocation; nav: GuideNavigator }) {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  return <Reveal as="article" kind="card" delay={(index % 2) * 90} className="guide-tool">
    <div ref={ref} className="guide-tool-visual" data-on-screen={onScreen || undefined}><ToolStoryVisual story={tool.story} /></div>
    <div className="guide-tool-body">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="guide-h3">{tool.name}</h3>
        <span className="text-meta text-muted">{tool.domain}</span>
        <CoveragePill tool={tool} catalog={catalog} />
      </div>
      <p className="mt-1.5 text-body-sm text-ink-soft text-pretty">{tool.outcome}</p>
      <p className="mt-3 flex flex-wrap gap-1.5">{tool.tools.map((name) => <code key={name} className="guide-tag">{name}</code>)}</p>
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        <GuideLink to={pageFor(location, tool)} nav={nav} className="guide-link"><BookOpen className="size-3.5" />{tool.name} 手册<ArrowRight className="size-3.5" /></GuideLink>
        <GuideLink to={stepsFor(location, tool)} nav={nav} className="guide-link">用 {tool.name} 走一遍三步<ArrowRight className="size-3.5" /></GuideLink>
      </p>
    </div>
  </Reveal>;
}

/** 工具: every tool on one screen, each opening its own page. */
export function ToolsOverview({ catalog, location, nav }: { catalog: ToolCatalog | null; location: GuideLocation; nav: GuideNavigator }) {
  return <>
    <section className="guide-section" aria-labelledby="guide-tools">
      <SectionHeading id="guide-tools" eyebrow="创作工具" title="每个工具管好一件事" body={catalog ? "状态标签来自控制中心的工具目录；没接入控制中心的工具照样能在本机使用。" : "每个工具都能单独在本机使用；登录控制中心后，还能看到它们在团队环境里的接入状态。"} />
      <div className="guide-tool-grid">{guideTools.map((tool, index) => <ToolCard key={tool.id} tool={tool} index={index} catalog={catalog} location={location} nav={nav} />)}</div>
    </section>
    <section className="guide-section" aria-labelledby="guide-open-tools">
      <SectionHeading id="guide-open-tools" eyebrow="更多 MCP 工具" title="把文件、笔记和代码也交给 Agent" body="这些服务同样走 MCP，和上面的创作工具用同一套“先搜索、再执行”的调用方式。" />
      <Reveal className="guide-more">
        <ul className="guide-more-list">{moreTools.map((item) => <li key={item.name}><p className="text-body-sm font-semibold text-ink">{item.name}<span className="ml-2 font-normal text-muted">{item.domain}</span></p><CommandLine command={item.command} /><p className="mt-1.5 text-2xs text-muted text-pretty">{item.note}</p></li>)}</ul>
      </Reveal>
    </section>
  </>;
}

const sectionId = (tool: GuideTool, part: string) => `guide-tool-${tool.id}-${part}`;

/** The sections a tool page offers in its outline, in page order. */
export function toolOutline(tool: GuideTool): GuideOutlineItem[] {
  const manual = toolManuals.find((item) => item.id === tool.id);
  return [
    { id: sectionId(tool, "commands"), label: "常用命令" },
    { id: sectionId(tool, "mcp"), label: "MCP" },
    { id: sectionId(tool, "install"), label: "安装" },
    ...(manual?.topics || []).map((topic, index) => ({ id: sectionId(tool, `t${index + 1}`), label: topic.title })),
    { id: sectionId(tool, "samples"), label: "真实样例" },
  ];
}

/** One tool, from what it does to reading results back: the old card and the old manual on one page. */
export function ToolPage({ tool, catalog, location, nav }: { tool: GuideTool; catalog: ToolCatalog | null; location: GuideLocation; nav: GuideNavigator }) {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const manual = toolManuals.find((item) => item.id === tool.id);
  const index = guideTools.findIndex((item) => item.id === tool.id);
  const previous = guideTools[index - 1];
  const next = guideTools[index + 1];
  return <>
    <section className="guide-section" aria-labelledby={`guide-tool-${tool.id}`}>
      <Reveal className="guide-heading">
        <p className="guide-eyebrow"><GuideLink to={{ ...location, page: null, section: null }} nav={nav} className="guide-crumb"><ArrowLeft className="size-3.5" />工具</GuideLink><span aria-hidden="true"> / </span>{tool.domain}</p>
        <h2 id={`guide-tool-${tool.id}`} className="guide-h2">{tool.name}</h2>
        <p className="guide-lead">{tool.outcome}</p>
        <p className="mt-3"><CoveragePill tool={tool} catalog={catalog} /></p>
      </Reveal>
      <div className="guide-tool-page-hero">
        <div ref={ref} className="guide-tool-visual" data-on-screen={onScreen || undefined}><ToolStoryVisual story={tool.story} /></div>
        <div className="space-y-3">
          <p className="guide-gate"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{tool.gate}</p>
          <GuideLink to={stepsFor(location, tool)} nav={nav} className="guide-link">用 {tool.name} 走一遍三步<ArrowRight className="size-3.5" /></GuideLink>
        </div>
      </div>
    </section>
    <h3 className="guide-sub" id={sectionId(tool, "commands")}>常用命令</h3>
    <div className="guide-tool-commands">{tool.commands.map((item) => <CommandLine key={item.command} command={item.command} note={item.note} />)}</div>
    <h3 className="guide-sub" id={sectionId(tool, "mcp")}>MCP</h3>
    <div className="guide-tool-mcp">
      <p className="flex items-center gap-1.5 text-2xs font-medium text-muted"><Terminal className="size-3.5" />本机 stdio</p>
      <CommandLine command={tool.mcp.command} note={tool.mcp.note} dark />
      <p className="mt-2 flex flex-wrap gap-1.5">{tool.tools.map((name) => <code key={name} className="guide-tag">{name}</code>)}</p>
      {tool.mcpNote && <p className="guide-note mt-2">{tool.mcpNote}</p>}
    </div>
    <h3 className="guide-sub" id={sectionId(tool, "install")}>安装</h3>
    <div className="guide-tool-commands">
      <CommandLine command={tool.install} />
      <CommandLine command={`${tool.id} --version`} />
    </div>
    {manual?.topics.map((topic, topicIndex) => <section key={topic.title} aria-labelledby={sectionId(tool, `t${topicIndex + 1}`)}>
      <h3 className="guide-sub" id={sectionId(tool, `t${topicIndex + 1}`)}>{topic.title}</h3>
      <div className="guide-tool-commands">
        {topic.commands?.map((item) => <CommandLine key={item.command} command={item.command} note={item.note} />)}
        {topic.body && <p className="guide-manual-body">{topic.body}</p>}
      </div>
    </section>)}
    <h3 className="guide-sub" id={sectionId(tool, "samples")}>真实样例</h3>
    <p className="guide-manual-samples">
      {manual?.samples.length
        ? manual.samples.map((sample) => {
          const place = locateSection(sample.target);
          return place ? <GuideLink key={sample.label} to={{ ...location, ...place, section: sample.target }} nav={nav} className="guide-link">{sample.label}<ArrowRight className="size-3.5" /></GuideLink> : null;
        })
        : <span className="text-muted">这一轮还没有录制</span>}
    </p>
    <nav aria-label="其他工具" className="guide-tool-siblings">
      {previous ? <GuideLink to={pageFor(location, previous)} nav={nav} className="guide-link"><ArrowLeft className="size-3.5" />{previous.name}</GuideLink> : <span />}
      {next && <GuideLink to={pageFor(location, next)} nav={nav} className="guide-link">{next.name}<ArrowRight className="size-3.5" /></GuideLink>}
    </nav>
  </>;
}
