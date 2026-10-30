import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ShieldCheck, Terminal } from "../../icons";
// Direct imports: the public guide must not load the menu and dialog components behind the ui barrel.
import { Pill } from "../../components/ui/Status";
import { cx } from "../../components/ui/cx";
import { formatRelative } from "../../shared/read-model/format";
import { catalogCoverageLabels, catalogCoverageTone } from "../../shared/read-model/labels";
import type { ToolCatalog } from "../../shared/tool-catalog";
import { callFlow, connectCommands, faqs, guideClients, guideTools, moreTools, pathCommand, tagline, type GuideClient, type GuideTool } from "./guide-content";
import { Reveal, TaglineReveal, useOnScreen } from "./guide-motion";
import { CommandLine, Picker, SectionHeading, scrollIntoViewGently } from "./guide-parts";
import { AgentReplaySection } from "./AgentReplay";
import { ConfigSection, ManualSection, TroubleSection } from "./Reference";
import { ShowcaseSection } from "./Showcase";
import { showcaseRecord } from "./showcase";
import { HeroStory } from "./HeroStory";
import { ToolStoryVisual } from "./ToolStories";

/**
 * The guide itself, with no router, session or server read: the signed-in page and the public page (no login) both
 * render it. The signed-in page passes the live tool catalog; the public page passes none and links to sign-in instead.
 */
export interface GuideCatalog { status: "loading" | "ready" | "unavailable"; catalog: ToolCatalog | null }
/** Where "查看已发现的工具" leads: the catalog page when signed in, sign-in on the public page. */
export interface GuideCatalogLink { label: string; onClick?: () => void; href?: string }

function scrollToSteps() {
  document.getElementById("guide-steps")?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block: "start" });
}

function ProofLine({ catalog }: { catalog?: GuideCatalog }) {
  if (!catalog) return <span className="guide-proof"><ShieldCheck className="mr-1.5 inline size-3.5 align-[-2px] text-success" />公开页面：不登录也能看，不读取任何账号数据。</span>;
  if (catalog.status === "loading") return <span className="guide-proof"><span className="skeleton inline-block h-3 w-48 rounded-chip align-middle" /></span>;
  const data = catalog.catalog;
  if (!data) return <span className="guide-proof">工具目录暂不可读，下面的命令不依赖它。</span>;
  const readable = data.coverage.filter((item) => item.state === "readable" || item.state === "partial").length;
  return <span className="guide-proof"><ShieldCheck className="mr-1.5 inline size-3.5 align-[-2px] text-success" />控制中心已发现 <strong>{data.tools.length}</strong> 个 MCP 工具，{readable}/{data.coverage.length} 个服务可读 · 观察于 {formatRelative(data.observed_at)}</span>;
}

function CatalogLink({ link, className }: { link: GuideCatalogLink; className: string }) {
  return link.href ? <a className={className} href={link.href}>{link.label}</a> : <button type="button" className={className} onClick={link.onClick}>{link.label}</button>;
}

function Hero({ catalog, link }: { catalog?: GuideCatalog; link: GuideCatalogLink }) {
  return <section className="guide-hero" aria-labelledby="guide-title">
    <div className="guide-hero-copy">
      <p className="guide-eyebrow guide-rise" style={{ "--rise-delay": "0ms" } as CSSProperties}>使用指南 · CLI 与 MCP</p>
      <h2 id="guide-title" className="guide-h1 guide-rise" style={{ "--rise-delay": "80ms" } as CSSProperties}>在终端和 Agent 里<br className="max-md:hidden" /> 直接调用 Yeisme 的创作工具</h2>
      <p className="guide-lead guide-rise" style={{ "--rise-delay": "160ms" } as CSSProperties}>先装好 CLI，用一条体检命令确认环境；再把同一套能力通过 MCP 接进 Claude Code 或 Codex。要花钱的生成，每次都等你确认。</p>
      <div className="guide-hero-actions guide-rise" style={{ "--rise-delay": "240ms" } as CSSProperties}>
        <button type="button" className="guide-cta" onClick={scrollToSteps}>开始第一步<ArrowRight className="size-4" /></button>
        <CatalogLink link={link} className="guide-link" />
      </div>
      <p className="guide-rise" style={{ "--rise-delay": "320ms" } as CSSProperties}><ProofLine catalog={catalog} /></p>
    </div>
    <div className="guide-hero-visual guide-rise" style={{ "--rise-delay": "200ms" } as CSSProperties}>
      <HeroStory />
      <p className="guide-caption">示意动画。真实生成的结果和 Agent 对话见下方「真实案例」与「Agent 回放」，记录于 {showcaseRecord.date}。</p>
    </div>
  </section>;
}

const pageSections = [
  { id: "guide-steps", label: "三步上手" },
  { id: "guide-flow", label: "调用约定" },
  { id: "guide-showcase", label: "真实案例" },
  { id: "guide-replay", label: "Agent 回放" },
  { id: "guide-tools", label: "工具" },
  { id: "guide-manual", label: "工具手册" },
  { id: "guide-config", label: "配置示例" },
  { id: "guide-trouble", label: "排障" },
  { id: "guide-faq", label: "常见问题" },
];

/** Contents of this page. Buttons rather than #anchors: the signed-in app keeps its route in the hash. */
function PageNav() {
  return <nav aria-label="本页目录" className="guide-toc">
    <ul>{pageSections.map((item) => <li key={item.id}><button type="button" onClick={() => scrollIntoViewGently(item.id)}>{item.label}</button></li>)}</ul>
  </nav>;
}

function StepCard({ index, title, body, children }: { index: number; title: string; body: string; children: ReactNode }) {
  return <Reveal as="li" kind="card" delay={index * 90} className="guide-step">
    <div className="flex items-baseline gap-3">
      <span className="guide-step-index" aria-hidden="true">{index + 1}</span>
      <div className="min-w-0">
        <h3 className="guide-h3">{title}</h3>
        <p className="mt-1 text-body-sm text-muted text-pretty">{body}</p>
      </div>
    </div>
    <div className="mt-4 space-y-2">{children}</div>
  </Reveal>;
}

function QuickStart({ tool, client, onTool, onClient }: { tool: GuideTool; client: GuideClient; onTool: (id: GuideTool["id"]) => void; onClient: (id: GuideClient) => void }) {
  return <section className="guide-section" aria-labelledby="guide-steps">
    <SectionHeading id="guide-steps" eyebrow="三步上手" title="从一条体检命令开始" body="选一个工具和你常用的 Agent 客户端，下面三步的命令会跟着换。前两步都不会产生费用。" />
    <Reveal className="guide-pickers" delay={60}>
      <Picker label="选择工具" value={tool.id} onChange={onTool} options={guideTools.map((item) => ({ id: item.id, label: <><span className="font-semibold">{item.name}</span><span className="text-muted">{item.domain}</span></> }))} />
      <Picker label="选择 Agent 客户端" value={client} onChange={onClient} options={guideClients} />
    </Reveal>
    <ol className="guide-steps">
      <StepCard index={0} title="装好 CLI" body="一条命令装好二进制，默认放进 ~/.yeisme/bin。">
        <CommandLine command={tool.install} />
        <CommandLine command={pathCommand} note="把安装目录加进 PATH；写进 shell 配置后长期生效。" />
        <CommandLine command={`${tool.id} --version`} />
      </StepCard>
      <StepCard index={1} title="体检并保存凭据" body="体检只检查环境，不调用付费服务；凭据写进用户级配置，不进项目仓库。">
        {tool.check.map((item) => <CommandLine key={item.command} command={item.command} note={item.note} />)}
      </StepCard>
      <StepCard index={2} title="接进你的 Agent" body="用 MCP 把同一套能力交给 Agent，它就能按你的话调用工具。">
        {connectCommands(tool, client).map((item) => <CommandLine key={item.command} command={item.command} note={item.note} />)}
        {tool.mcpNote && <p className="guide-note">{tool.mcpNote}</p>}
        <p className="guide-try"><span>接好后试着说</span>「{tool.firstPrompt}」</p>
      </StepCard>
    </ol>
  </section>;
}

function CallFlow() {
  return <section className="guide-section" aria-labelledby="guide-flow">
    <SectionHeading id="guide-flow" eyebrow="调用约定" title="先搜索，再执行" body="接进 Agent 之后，多数服务只露出两个入口。记住这个顺序，Agent 就不会猜错动作名。" />
    <ol className="guide-flow">
      {callFlow.map((item, index) => <Reveal as="li" key={item.title} kind="card" delay={index * 90} className="guide-flow-item">
        <span className="guide-flow-index" aria-hidden="true">{index + 1}</span>
        <code className="guide-flow-code">{item.code}</code>
        <h3 className="guide-h3 mt-3">{item.title}</h3>
        <p className="mt-1 text-body-sm text-muted text-pretty">{item.body}</p>
      </Reveal>)}
    </ol>
  </section>;
}

function ToolCard({ tool, catalog, index, highlighted, onUse }: { tool: GuideTool; catalog: ToolCatalog | null; index: number; highlighted: boolean; onUse: () => void }) {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const coverage = catalog?.coverage.find((item) => item.owner === tool.owner) || null;
  const count = catalog?.tools.filter((item) => item.owner === tool.owner).length ?? 0;
  return <Reveal as="article" kind="card" delay={(index % 2) * 90} id={`guide-tool-${tool.id}`} className={cx("guide-tool", highlighted && "is-highlighted")}>
    <div ref={ref} className="guide-tool-visual" data-on-screen={onScreen || undefined}><ToolStoryVisual story={tool.story} /></div>
    <div className="guide-tool-body">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="guide-h3">{tool.name}</h3>
        <span className="text-meta text-muted">{tool.domain}</span>
        {coverage && <Pill size="sm" tone={catalogCoverageTone[coverage.state]} title={coverage.reason || undefined}>{catalogCoverageLabels[coverage.state]}{count ? ` · ${count} 个工具` : ""}</Pill>}
      </div>
      <p className="mt-1.5 text-body-sm text-ink-soft text-pretty">{tool.outcome}</p>
      <div className="mt-4 space-y-2">{tool.commands.map((item) => <CommandLine key={item.command} command={item.command} note={item.note} />)}</div>
      <div className="guide-tool-mcp">
        <p className="flex items-center gap-1.5 text-2xs font-medium text-muted"><Terminal className="size-3.5" />MCP</p>
        <CommandLine command={tool.mcp.command} note={tool.mcp.note} dark />
        <p className="mt-2 flex flex-wrap gap-1.5">{tool.tools.map((name) => <code key={name} className="guide-tag">{name}</code>)}</p>
        {tool.mcpNote && <p className="guide-note mt-2">{tool.mcpNote}</p>}
      </div>
      <p className="guide-gate"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{tool.gate}</p>
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        <button type="button" className="guide-link" onClick={onUse}>用 {tool.name} 走一遍三步<ArrowRight className="size-3.5" /></button>
        <button type="button" className="guide-link" onClick={() => scrollIntoViewGently(`guide-manual-${tool.id}`)}>{tool.name} 完整手册<ArrowRight className="size-3.5" /></button>
      </p>
    </div>
  </Reveal>;
}

function FaqItem({ q, a, index }: { q: string; a: string; index: number }) {
  return <Reveal as="li" delay={Math.min(index, 5) * 50} className="guide-faq-item">
    <details className="group">
      <summary className="guide-faq-q">{q}<ChevronDown className="size-4 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" /></summary>
      <p className="guide-faq-a">{a}</p>
    </details>
  </Reveal>;
}

/**
 * The whole guide. `toolId` and `client` come from the page address; `onTool` and `onClient` write them back.
 * `data-page` names the page for the signed-in shell and the public page alike.
 */
export function GuideContent({ toolId, client, onTool, onClient, catalog, link, page = "guide" }: {
  toolId: string | null;
  client: GuideClient;
  onTool: (id: GuideTool["id"]) => void;
  onClient: (id: GuideClient) => void;
  catalog?: GuideCatalog;
  link: GuideCatalogLink;
  page?: string;
}) {
  const requested = guideTools.find((item) => item.id === toolId);
  const tool = requested || guideTools[0];
  const choose = (id: GuideTool["id"], scroll = false) => {
    onTool(id);
    if (scroll) window.requestAnimationFrame(scrollToSteps);
  };

  // A deep link from 模型与工具 or an old AI 创作 link names a tool; bring its card into view once.
  const initialTool = useState(() => toolId)[0];
  useEffect(() => {
    const deepLinked = guideTools.find((item) => item.id === initialTool);
    if (!deepLinked) return;
    const timer = window.setTimeout(() => document.getElementById(`guide-tool-${deepLinked.id}`)?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block: "center" }), 120);
    return () => window.clearTimeout(timer);
  }, [initialTool]);

  return <div className="guide-page" data-page={page}>
    <h1 className="sr-only">使用指南</h1>
    <Hero catalog={catalog} link={link} />
    <PageNav />
    <QuickStart tool={tool} client={client} onTool={(id) => choose(id)} onClient={onClient} />
    <CallFlow />
    <ShowcaseSection />
    <AgentReplaySection client={client} onClient={onClient} />
    <section className="guide-section" aria-labelledby="guide-tools">
      <SectionHeading id="guide-tools" eyebrow="选择工具" title="每个工具管好一件事" body={catalog ? "状态标签来自控制中心的工具目录；没接入控制中心的工具照样能在本机使用。" : "每个工具都能单独在本机使用；登录控制中心后，还能看到它们在团队环境里的接入状态。"} />
      <div className="guide-tool-grid">{guideTools.map((item, index) => <ToolCard key={item.id} tool={item} index={index} catalog={catalog?.catalog ?? null} highlighted={item.id === requested?.id} onUse={() => choose(item.id, true)} />)}</div>
      <Reveal className="guide-more">
        <p className="guide-eyebrow">更多 MCP 工具</p>
        <ul className="guide-more-list">{moreTools.map((item) => <li key={item.name}><p className="text-body-sm font-semibold text-ink">{item.name}<span className="ml-2 font-normal text-muted">{item.domain}</span></p><CommandLine command={item.command} /><p className="mt-1.5 text-2xs text-muted text-pretty">{item.note}</p></li>)}</ul>
      </Reveal>
    </section>
    <ManualSection />
    <ConfigSection />
    <TroubleSection />
    <section className="guide-tagline-section" aria-label="核心原则"><TaglineReveal words={tagline} /></section>
    <section className="guide-section" aria-labelledby="guide-faq">
      <SectionHeading id="guide-faq" eyebrow="常见问题" title="开始之前，你可能想知道" />
      <ul className="guide-faq">{faqs.map((item, index) => <FaqItem key={item.q} index={index} q={item.q} a={item.a} />)}</ul>
    </section>
    <Reveal kind="card" className="guide-final">
      <div>
        <h2 className="guide-h2">先跑通一条体检命令</h2>
        <p className="guide-lead mt-2">装好 CLI、确认环境、接进 Agent，前两步不花一分钱。花钱的那一步，还是你说了算。</p>
      </div>
      <div className="guide-hero-actions">
        <button type="button" className="guide-cta" onClick={scrollToSteps}>开始第一步<ArrowRight className="size-4" /></button>
        <CatalogLink link={link} className="guide-link" />
      </div>
    </Reveal>
  </div>;
}

