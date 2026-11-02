import { Wrench } from "../../icons";
import { Reveal } from "./guide-motion";
import { CommandLine, SectionHeading } from "./guide-parts";
import { clientConfigs, connectedTools, controlCenterSteps, renewGeneral, troubleshooting } from "./guide-reference";

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

/** How a tool shows up in the control center: an observer credential from the tool, a connection line, a check. */
export function ControlCenterSection() {
  return <section className="guide-section" aria-labelledby="guide-control-center">
    <SectionHeading id="guide-control-center" eyebrow="接入控制中心" title="让控制中心看到工具里的任务" body="控制中心只读：它查看任务、进度和结果，花钱和改动仍在各工具里由你确认。下面以 Eikona 为例，其他工具照它们各自的观察凭据说明签发。" />
    <ol className="guide-connect-steps">
      {controlCenterSteps.map((step, index) => <Reveal as="li" key={step.title} kind="card" delay={index * 90} className="guide-config">
        <p className="guide-config-title"><span className="guide-step-index is-small" aria-hidden="true">{index + 1}</span>{step.title}</p>
        <p className="mt-1 text-body-sm text-muted text-pretty">{step.body}</p>
        {step.commands.length > 0 && <div className="mt-3 space-y-2">{step.commands.map((item) => <CommandLine key={item.command} command={item.command} note={item.note} />)}</div>}
      </Reveal>)}
    </ol>
  </section>;
}

/** 接入更多工具: the tools beyond the creative ones, each with its read-only credential and one registration line. */
export function ConnectedToolsSection() {
  return <section className="guide-section" aria-labelledby="guide-control-center-more">
    <SectionHeading id="guide-control-center-more" eyebrow="更多工具" title="拉片、文件传输和网关也能看" body="和创作工具一样：在工具那边签发只读凭据，再在控制中心登记一行。控制中心只读，不在这些工具里发起、修改或取消任何事。" />
    <div className="guide-connect-tools">
      {connectedTools.map((tool, index) => <Reveal as="article" key={tool.id} kind="card" delay={index * 90} className="guide-config">
        <div className="flex flex-wrap items-center gap-2" data-connected-tool={tool.id}>
          <h3 className="guide-h3">{tool.name}</h3>
          <span className="guide-tag">{tool.kind}</span>
        </div>
        <p className="mt-1 text-body-sm text-muted text-pretty">{tool.sees}</p>
        <div className="mt-3 space-y-2">{tool.steps.map((step) => <CommandLine key={step.command} command={step.command} note={step.note} />)}</div>
      </Reveal>)}
    </div>
  </section>;
}

/**
 * 续签凭据: how to replace a credential before it runs out, or once the tool refuses it. Each tool has its own anchor,
 * `guide-renew-<tool>`, which the services page links to from that tool's credential; the rest share `guide-renew`.
 */
export function RenewSection() {
  return <section className="guide-section" aria-labelledby="guide-renew">
    <SectionHeading id="guide-renew" eyebrow="续签凭据" title="凭据快到期，或者被工具拒绝了" body="控制中心不会替你续签，也不会签发新凭据：到期前在工具那边按原来的办法再签一份，用 credential replace 换上，再重启控制中心。工具不会告诉控制中心凭据什么时候到期，到期时间要在登记或换上时自己记下来，「服务」页才能提前提醒。" />
    {connectedTools.map((tool) => <div key={tool.id} data-renew-tool={tool.id}>
      <h3 className="guide-sub" id={`guide-renew-${tool.id}`}>{tool.name}</h3>
      <div className="mt-3 space-y-2">{tool.renew.map((step) => <CommandLine key={step.command} command={step.command} note={step.note} />)}</div>
    </div>)}
    <h3 className="guide-sub">其他凭据</h3>
    <p className="guide-sub-lead">Eikona、Sonora、Scaena 的连接和 Auctra 的密钥照同样的办法换：</p>
    <div className="mt-3 space-y-2">{renewGeneral.map((step) => <CommandLine key={step.command} command={step.command} note={step.note} />)}</div>
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
