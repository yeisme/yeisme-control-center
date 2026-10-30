import { ArrowRight, BookOpen, Wrench } from "../../icons";
import { guideTools, type GuideTool } from "./guide-content";
import { Reveal } from "./guide-motion";
import { CommandLine, SectionHeading, scrollIntoViewGently } from "./guide-parts";
import { clientConfigs, toolManuals, troubleshooting, type ToolManual } from "./guide-reference";

function ManualArticle({ tool, manual }: { tool: GuideTool; manual: ToolManual }) {
  return <Reveal as="article" kind="card" id={`guide-manual-${tool.id}`} className="guide-manual-tool">
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className="guide-h3">{tool.name}</h3>
      <span className="text-meta text-muted">{tool.domain}</span>
    </header>
    <div className="guide-manual-grid">
      <section className="guide-manual-topic" aria-label={`${tool.name}：安装`}>
        <h4>安装</h4>
        <CommandLine command={tool.install} />
        <CommandLine command={`${tool.id} --version`} />
      </section>
      {manual.topics.map((topic) => <section key={topic.title} className="guide-manual-topic" aria-label={`${tool.name}：${topic.title}`}>
        <h4>{topic.title}</h4>
        {topic.commands?.map((item) => <CommandLine key={item.command} command={item.command} note={item.note} />)}
        {topic.body && <p className="guide-manual-body">{topic.body}</p>}
      </section>)}
    </div>
    <p className="guide-manual-samples">
      <span>真实样例</span>
      {manual.samples.length
        ? manual.samples.map((sample) => <button key={sample.label} type="button" className="guide-link" onClick={() => scrollIntoViewGently(sample.target)}>{sample.label}<ArrowRight className="size-3.5" /></button>)
        : <span className="text-muted">这一轮还没有录制</span>}
    </p>
  </Reveal>;
}

export function ManualSection() {
  return <section className="guide-section" aria-labelledby="guide-manual">
    <SectionHeading id="guide-manual" eyebrow="工具手册" title="每个工具从安装到读回结果" body="安装、凭据、生成、费用和输出，一个工具一张卡。命令照抄各工具自己的文档，尖括号里的内容换成你的值。" />
    <Reveal className="guide-manual-nav" delay={60}>
      <BookOpen className="size-4 text-muted" />
      {guideTools.map((tool) => <button key={tool.id} type="button" onClick={() => scrollIntoViewGently(`guide-manual-${tool.id}`)}>{tool.name}</button>)}
    </Reveal>
    <div className="guide-manual-list">
      {guideTools.map((tool) => {
        const manual = toolManuals.find((item) => item.id === tool.id);
        return manual ? <ManualArticle key={tool.id} tool={tool} manual={manual} /> : null;
      })}
    </div>
  </section>;
}

export function ConfigSection() {
  return <section className="guide-section" aria-labelledby="guide-config">
    <SectionHeading id="guide-config" eyebrow="配置示例" title="把服务接进 Claude Code 和 Codex" body="本机用 stdio，团队共享用 HTTP /mcp。共享服务的令牌只放在环境变量里，配置文件里只有变量名。" />
    <div className="guide-config-grid">
      {clientConfigs.map((config, index) => <Reveal key={config.client} kind="card" delay={index * 90} className="guide-config">
        <h3 className="guide-h3">{config.title}</h3>
        <ol className="guide-config-steps">
          {config.steps.map((step) => <li key={step.title}>
            <p className="guide-config-title">{step.title}</p>
            <CommandLine command={step.command} note={step.note} block={step.block} label={step.label} dark={step.block} />
          </li>)}
        </ol>
      </Reveal>)}
    </div>
  </section>;
}

export function TroubleSection() {
  return <section className="guide-section" aria-labelledby="guide-trouble">
    <SectionHeading id="guide-trouble" eyebrow="排障" title="遇到这些情况，先这样查" body="标着「录制时遇到」的，是录制本页真实样例时实际碰到的；其余来自各工具的错误码说明。" />
    <Reveal className="guide-trouble">
      {/* Explicit roles keep the table semantics when narrow screens restack the cells. */}
      <table role="table">
        <caption className="sr-only">常见问题的现象、原因和处理办法</caption>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">工具</th><th role="columnheader" scope="col">现象</th><th role="columnheader" scope="col">原因</th><th role="columnheader" scope="col">怎么处理</th></tr></thead>
        <tbody role="rowgroup">
          {troubleshooting.map((row) => <tr role="row" key={row.symptom}>
            <td role="cell"><span className="guide-tag">{row.tool}</span></td>
            <th role="rowheader" scope="row">{row.symptom}{row.seen && <span className="guide-seen">录制时遇到</span>}</th>
            <td role="cell" data-label="原因">{row.cause}</td>
            <td role="cell" data-label="怎么处理"><span className="inline-flex gap-1.5"><Wrench className="mt-0.5 size-3.5 shrink-0 text-muted" />{row.fix}</span></td>
          </tr>)}
        </tbody>
      </table>
    </Reveal>
  </section>;
}
