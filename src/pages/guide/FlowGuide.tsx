import type { ReactNode } from "react";
import { Bot, UserRound } from "../../icons";
import { briefGuardrails } from "../../shared/agent-brief";
import { productionStations } from "../../shared/production-line";
import { stationLabels } from "../../shared/read-model/production";
import { agentAccountCommand, agentReadSteps, flowRoles, flowStations, handoffSteps } from "./guide-content";
import { Reveal } from "./guide-motion";
import { CommandLine, SectionHeading } from "./guide-parts";

const readyWords = { yes: "已接通", partly: "部分", no: "待接通" } as const;

/** 七站制作线: the stations in order, who decides at each, and how far each is read today. */
function LineSection() {
  return <section className="guide-section" aria-labelledby="guide-line">
    <SectionHeading id="guide-line" eyebrow="七站制作线" title="从一张图，到一集漫剧" body="一集漫剧在 Yeisme 里走七站。剧集工作室和项目页按这七站显示进度；没接通的站写「待接通」，不会算成 0 或已完成。" />
    <Reveal className="guide-trouble">
      <table role="table">
        <caption className="sr-only">七站制作线：每站由人决定什么、Agent 能做什么、哪个工具来做、今天接通到哪</caption>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">站</th><th role="columnheader" scope="col">人决定</th><th role="columnheader" scope="col">Agent 能跑</th><th role="columnheader" scope="col">工具</th><th role="columnheader" scope="col">今天</th></tr></thead>
        <tbody role="rowgroup">
          {productionStations.map((id, index) => {
            const copy = flowStations[id];
            return <tr role="row" key={id} data-flow-station={id}>
              <th role="rowheader" scope="row"><span className="tabular text-muted">{index + 1}</span> {stationLabels[id].label}<span className="block text-2xs font-normal text-muted">{stationLabels[id].detail}</span></th>
              <td role="cell" data-label="人决定">{copy.human}</td>
              <td role="cell" data-label="Agent 能跑">{copy.agent}</td>
              <td role="cell" data-label="工具"><span className="guide-tag">{copy.tools}</span></td>
              <td role="cell" data-label="今天" data-ready={copy.ready}><span className="sr-only">{readyWords[copy.ready]}：</span>{copy.today}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </Reveal>
  </section>;
}

function RoleList({ title, icon, items }: { title: string; icon: ReactNode; items: { title: string; body: string }[] }) {
  return <Reveal as="article" kind="card" className="guide-config">
    <h3 className="guide-h3 flex items-center gap-2">{icon}{title}</h3>
    <ul className="mt-3 space-y-2">
      {items.map((item) => <li key={item.title} className="text-body-sm text-ink-soft text-pretty"><strong className="font-semibold text-ink">{item.title}</strong>：{item.body}</li>)}
    </ul>
  </Reveal>;
}

/** 人和 Agent: the split, stated once. */
function RolesSection() {
  return <section className="guide-section" aria-labelledby="guide-roles">
    <SectionHeading id="guide-roles" eyebrow="人和 Agent" title="人决定，Agent 跑腿" body="人和 Agent 看的是同一份制作事实，能做的事分开。Agent 能读、能报价、能准备，最后拍板的永远是人。" />
    <div className="guide-config-grid">
      <RoleList title="只由你来做" icon={<UserRound className="size-4 text-warm" />} items={flowRoles.human} />
      <RoleList title="可以交给 Agent" icon={<Bot className="size-4 text-muted" />} items={flowRoles.agent} />
    </div>
  </section>;
}

/** 交给 Agent: the three steps and the rules every brief carries. One text, for any agent. */
function HandoffSection() {
  return <section className="guide-section" aria-labelledby="guide-handoff">
    <SectionHeading id="guide-handoff" eyebrow="交给 Agent" title="把一站、一个镜头交给 Agent" body="Studio 不替 Agent 执行任何一步，它只写一份说明：目标、引用、步骤、护栏、做完的标准，以及回哪里看结果。" />
    <ol className="guide-connect-steps">
      {handoffSteps.map((step, index) => <Reveal as="li" key={step.title} kind="card" delay={index * 90} className="guide-config">
        <p className="guide-config-title"><span className="guide-step-index is-small" aria-hidden="true">{index + 1}</span>{step.title}</p>
        <p className="mt-1 text-body-sm text-muted text-pretty">{step.body}</p>
      </Reveal>)}
    </ol>
    <Reveal className="guide-config mt-6">
      <h3 className="guide-h3">每份说明都带着这些规则</h3>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-body-sm text-ink-soft">
        {briefGuardrails.map((rule) => <li key={rule} className="text-pretty">{rule}</li>)}
      </ul>
    </Reveal>
  </section>;
}

/** Agent 读制作线: the read-only HTTP flow for an agent with its own account. */
function AgentReadSection() {
  return <section className="guide-section" aria-labelledby="guide-agent-read">
    <SectionHeading id="guide-agent-read" eyebrow="Agent 读制作线" title="Agent 自己读进度" body="能登录的 Agent 可以直接读同一份制作线，结构和剧集工作室「更多」里「复制制作线数据」得到的一样。只读不写：读不需要 CSRF，写的事一律不交给 Agent。" />
    <Reveal className="space-y-2">
      {agentReadSteps.map((step) => <CommandLine key={step.command} command={step.command} note={step.note} />)}
    </Reveal>
    <Reveal className="guide-config mt-6">
      <h3 className="guide-h3">给 Agent 一个自己的只读账号</h3>
      <p className="mt-1 text-body-sm text-muted text-pretty">审计会记在登录的账号名下，所以别让 Agent 用你的账号。请管理员在「成员与管理 → 账号」里给它单独建一个只读（viewer）账号：新 Key 只显示一次，复制或下载后交给 Agent。习惯命令行的管理员，也可以在服务器上运行下面这条命令。</p>
      <div className="mt-3"><CommandLine command={agentAccountCommand.command} note={agentAccountCommand.note} /></div>
      <p className="mt-3 text-body-sm text-muted text-pretty">浏览器里的 Agent 可以按这些标记读页面：<code>data-station</code>、<code>data-episode</code>、<code>data-shot</code>、<code>data-decision</code>、<code>data-brief</code>。状态都在地址里，每页一个一级标题，控件都有名字。</p>
    </Reveal>
  </section>;
}

export function FlowChapter() {
  return <>
    <LineSection />
    <RolesSection />
    <HandoffSection />
    <AgentReadSection />
  </>;
}
