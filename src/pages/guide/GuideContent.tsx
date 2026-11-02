import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ShieldCheck } from "../../icons";
import { formatRelative } from "../../shared/read-model/format";
import type { ToolCatalog } from "../../shared/tool-catalog";
import { callFlow, connectCommands, faqs, guideClients, guideTools, pathCommand, tagline, type GuideClient, type GuideTool } from "./guide-content";
import { chapterOutlines, guideChapters, type GuideLocation } from "./guide-location";
import { Reveal, TaglineReveal } from "./guide-motion";
import { GuideChapterNav, GuideChapterPager, GuideLink, GuideOutline, type GuideNavigator } from "./GuideNav";
import { CommandLine, Picker, SectionHeading, scrollIntoViewGently } from "./guide-parts";
import { ToolPage, ToolsOverview, toolOutline } from "./GuideTools";
import { AgentReplaySection } from "./AgentReplay";
import { ConfigSection, ConnectedToolsSection, ControlCenterSection, RenewSection, TroubleSection } from "./Reference";
import { ShowcaseSection } from "./Showcase";
import { showcaseRecord } from "./showcase";
import { HeroStory } from "./HeroStory";

/**
 * The guide itself, with no router, session or server read: the signed-in page and the public page (no login) both
 * render it. The signed-in page passes the live tool catalog; the public page passes none and links to sign-in instead.
 */
export interface GuideCatalog { status: "loading" | "ready" | "unavailable"; catalog: ToolCatalog | null }
/** Where "查看已发现的工具" leads: the catalog page when signed in, sign-in on the public page. */
export interface GuideCatalogLink { label: string; onClick?: () => void; href?: string }

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

function Hero({ catalog, link, steps, cases, nav }: { catalog?: GuideCatalog; link: GuideCatalogLink; steps: GuideLocation; cases: GuideLocation; nav: GuideNavigator }) {
  return <section className="guide-hero" aria-labelledby="guide-title">
    <div className="guide-hero-copy">
      <p className="guide-eyebrow guide-rise" style={{ "--rise-delay": "0ms" } as CSSProperties}>使用指南 · CLI 与 MCP</p>
      <h2 id="guide-title" className="guide-h1 guide-rise" style={{ "--rise-delay": "80ms" } as CSSProperties}>在终端和 Agent 里<br className="max-md:hidden" /> 直接调用 Yeisme 的创作工具</h2>
      <p className="guide-lead guide-rise" style={{ "--rise-delay": "160ms" } as CSSProperties}>先装好 CLI，用一条体检命令确认环境；再把同一套能力通过 MCP 接进 Claude Code 或 Codex。要花钱的生成，每次都等你确认。</p>
      <div className="guide-hero-actions guide-rise" style={{ "--rise-delay": "240ms" } as CSSProperties}>
        <GuideLink to={steps} nav={nav} className="guide-cta">开始第一步<ArrowRight className="size-4" /></GuideLink>
        <CatalogLink link={link} className="guide-link" />
      </div>
      <p className="guide-rise" style={{ "--rise-delay": "320ms" } as CSSProperties}><ProofLine catalog={catalog} /></p>
    </div>
    <div className="guide-hero-visual guide-rise" style={{ "--rise-delay": "200ms" } as CSSProperties}>
      <HeroStory />
      <p className="guide-caption">示意动画。真实生成的结果和 Agent 对话见<GuideLink to={cases} nav={nav} className="guide-inline-link">「案例」</GuideLink>，记录于 {showcaseRecord.date}。</p>
    </div>
  </section>;
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

/** 接下来: the other chapters, so the first screen also shows what else the guide has. */
function NextSteps({ location, nav }: { location: GuideLocation; nav: GuideNavigator }) {
  return <section className="guide-section" aria-labelledby="guide-next">
    <SectionHeading id="guide-next" eyebrow="接下来" title="跑通第一条命令之后" />
    <ul className="guide-next">
      {guideChapters.filter((chapter) => chapter.id !== "start").map((chapter, index) => <Reveal as="li" key={chapter.id} kind="card" delay={index * 70}>
        <GuideLink to={{ ...location, chapter: chapter.id, page: null, section: null }} nav={nav} className="guide-next-link">
          <span className="guide-h3">{chapter.label}</span>
          <span className="text-body-sm text-muted text-pretty">{chapter.summary}</span>
          <ArrowRight className="guide-next-arrow size-4" />
        </GuideLink>
      </Reveal>)}
    </ul>
  </section>;
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
 * The whole guide, one chapter at a time. `location` comes from the page address and `nav` writes it back: the
 * signed-in page keeps it in the hash route, the public page in its query string. `data-page` names the page for
 * the signed-in shell and the public page alike.
 */
export function GuideContent({ location, nav, catalog, link, page = "guide" }: {
  location: GuideLocation;
  nav: GuideNavigator;
  catalog?: GuideCatalog;
  link: GuideCatalogLink;
  page?: string;
}) {
  const tool = guideTools.find((item) => item.id === location.tool) || guideTools[0];
  const toolPage = location.chapter === "tools" ? guideTools.find((item) => item.id === location.page) || null : null;
  const chapterRef = useRef<HTMLDivElement>(null);
  const firstPlace = useRef(true);
  const place = `${location.chapter}/${toolPage?.id || ""}`;

  // A move within the open page replaces the address and scrolls at once; opening another chapter or page pushes.
  const guideNav: GuideNavigator = {
    hrefFor: nav.hrefFor,
    go: (to, options) => {
      const samePlace = to.chapter === location.chapter && (to.page || null) === (location.page || null);
      nav.go(to, { replace: options?.replace ?? samePlace });
      if (samePlace && to.section) { const id = to.section; window.requestAnimationFrame(() => scrollIntoViewGently(id)); }
    },
  };
  const choose = (patch: Partial<GuideLocation>) => nav.go({ ...location, ...patch }, { replace: true });

  // Opening a chapter lands on its section if the address names one, otherwise at the top with focus on its heading,
  // so keyboard and screen-reader users start on what just opened. The first render leaves focus where it is.
  useEffect(() => {
    const initial = firstPlace.current;
    firstPlace.current = false;
    const section = location.section;
    if (section) {
      const timer = window.setTimeout(() => scrollIntoViewGently(section), initial ? 120 : 0);
      return () => window.clearTimeout(timer);
    }
    if (initial) return;
    window.scrollTo({ top: 0, behavior: "auto" });
    const heading = chapterRef.current?.querySelector<HTMLElement>("h2");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [place]);

  const at = (patch: Partial<GuideLocation>): GuideLocation => ({ ...location, page: null, section: null, ...patch });
  const outline = toolPage ? toolOutline(toolPage) : chapterOutlines[location.chapter];
  const body = location.chapter === "start"
    ? <>
      <Hero catalog={catalog} link={link} steps={at({ chapter: "start", section: "guide-steps" })} cases={at({ chapter: "cases" })} nav={guideNav} />
      <QuickStart tool={tool} client={location.client} onTool={(id) => choose({ tool: id })} onClient={(id) => choose({ client: id })} />
      <CallFlow />
      <NextSteps location={location} nav={guideNav} />
    </>
    : location.chapter === "tools"
      ? toolPage ? <ToolPage tool={toolPage} catalog={catalog?.catalog ?? null} location={location} nav={guideNav} /> : <ToolsOverview catalog={catalog?.catalog ?? null} location={location} nav={guideNav} />
      : location.chapter === "cases"
        ? <><ShowcaseSection /><AgentReplaySection client={location.client} onClient={(id) => choose({ client: id })} /></>
        : location.chapter === "connect"
          ? <><ConfigSection /><ControlCenterSection /><ConnectedToolsSection /><RenewSection /></>
          : <>
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
                <GuideLink to={at({ chapter: "start", section: "guide-steps" })} nav={guideNav} className="guide-cta">开始第一步<ArrowRight className="size-4" /></GuideLink>
                <CatalogLink link={link} className="guide-link" />
              </div>
            </Reveal>
          </>;

  return <div className="guide-page" data-page={page}>
    <h1 className="sr-only">使用指南</h1>
    <GuideChapterNav location={location} nav={guideNav} />
    <div ref={chapterRef} className="guide-chapter" data-chapter={location.chapter}>
      <div className="guide-layout">
        <GuideOutline items={outline} location={location} nav={guideNav} />
        <div className="guide-body">{body}</div>
      </div>
      <GuideChapterPager location={location} nav={guideNav} />
    </div>
  </div>;
}
