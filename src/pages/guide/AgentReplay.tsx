import { useEffect, useRef, useState } from "react";
import { Bot, CircleAlert, CircleCheck, Info, Receipt, Terminal } from "../../icons";
import { cx } from "../../components/ui/cx";
import { agentReplays, type AgentReplay, type ReplayStep } from "./agent-replays";
import { guideClients, type GuideClient } from "./guide-content";
import { Reveal } from "./guide-motion";
import { Picker, SectionHeading } from "./guide-parts";

/** The first exchange: the request, the calls, and the agent handing back before it spends anything. */
const firstStop = (replay: AgentReplay) => {
  const reply = replay.steps.findIndex((step, index) => index > 0 && step.kind === "user");
  return reply > 0 ? reply : replay.steps.length;
};

function Step({ step }: { step: ReplayStep }) {
  if (step.kind === "user") return <div className="guide-replay-user"><span className="guide-replay-who">你</span><p>{step.text}</p></div>;
  if (step.kind === "agent") return <div className="guide-replay-agent"><span className="guide-replay-who"><Bot className="size-3.5" />Agent</span><p>{step.text}</p></div>;
  if (step.kind === "note") return <div className="guide-replay-note"><Info className="mt-0.5 size-3.5 shrink-0" /><p><strong>编者注</strong>{step.text}</p></div>;
  if (step.kind === "fold") return <div className="guide-replay-fold"><span className="guide-replay-count">×{step.count}</span><p>{step.text}</p></div>;
  return <div className={cx("guide-replay-call", step.failed && "is-failed")}>
    <p className="guide-replay-tool"><Terminal className="size-3.5" />{step.tool}</p>
    <code>{step.args}</code>
    <p className="guide-replay-result">{step.failed ? <CircleAlert className="size-3.5 shrink-0" /> : <CircleCheck className="size-3.5 shrink-0" />}{step.result}</p>
  </div>;
}

function Result({ replay }: { replay: AgentReplay }) {
  const { media, alt, caption } = replay.result;
  return <div className="guide-replay-outcome">
    {media.kind === "image"
      ? <img src={media.src} alt={alt} width={media.width} height={media.height} loading="lazy" decoding="async" className="guide-replay-image" />
      : <audio controls preload="none" src={media.src} aria-label={`播放：${caption}`} className="w-full" />}
    <div className="min-w-0">
      <p className="text-body-sm font-semibold text-ink">{caption}<span className="guide-ai-label is-inline">AI 生成</span></p>
      <ul className="mt-2 space-y-1">{replay.cost.map((line) => <li key={line} className="flex gap-1.5 text-2xs text-muted"><Receipt className="mt-px size-3.5 shrink-0" />{line}</li>)}</ul>
    </div>
  </div>;
}

/**
 * Two recorded sessions, revealed a step at a time. The client follows the page's Claude Code / Codex choice; each new
 * step takes focus, so keyboard and screen-reader users land on what just appeared.
 */
export function AgentReplaySection({ client, onClient }: { client: GuideClient; onClient: (id: GuideClient) => void }) {
  const replay = agentReplays.find((item) => item.client === client) || agentReplays[0];
  const [shown, setShown] = useState(() => firstStop(replay));
  const list = useRef<HTMLOListElement>(null);
  const focusFrom = useRef<number | null>(null);
  useEffect(() => { setShown(firstStop(replay)); focusFrom.current = null; }, [replay]);
  useEffect(() => {
    if (focusFrom.current === null) return;
    list.current?.querySelectorAll<HTMLElement>("[data-step]")[focusFrom.current]?.focus({ preventScroll: false });
    focusFrom.current = null;
  }, [shown]);
  const reveal = (count: number) => { focusFrom.current = shown; setShown(Math.min(replay.steps.length, count)); };
  const done = shown >= replay.steps.length;
  return <section className="guide-section" aria-labelledby="guide-replay">
    <SectionHeading id="guide-replay" eyebrow="Agent 回放" title="看 Agent 怎么找工具、等你确认、交出结果" body="两段真实录制，压缩了重复的查询，保留每一次调用的动作和参数。失败也照实保留：它们正是最常见的坑。" />
    <Reveal className="guide-pickers" delay={60}>
      <Picker label="选择回放的客户端" value={client} onChange={onClient} options={guideClients} />
    </Reveal>
    <Reveal kind="card" className="guide-replay">
      <header className="guide-replay-head">
        <h3 className="guide-h3">{replay.title}</h3>
        <p className="text-2xs text-muted">{replay.runtime} · 录制于 {replay.date} · {replay.setup}</p>
      </header>
      <ol ref={list} className="guide-replay-steps" aria-label={`${replay.title}：第 1 到 ${shown} 步，共 ${replay.steps.length} 步`}>
        {replay.steps.slice(0, shown).map((step, index) => <li key={`${replay.client}-${index}`} data-step tabIndex={-1} data-kind={step.kind}><Step step={step} /></li>)}
      </ol>
      <div className="guide-replay-controls">
        {done
          ? <button type="button" className="guide-link" onClick={() => { setShown(firstStop(replay)); list.current?.querySelector<HTMLElement>("[data-step]")?.focus(); }}>从头再看</button>
          : <>
            <button type="button" className="guide-cta is-small" onClick={() => reveal(shown + 1)}>下一步<span className="font-normal opacity-80">{shown + 1} / {replay.steps.length}</span></button>
            <button type="button" className="guide-link" onClick={() => reveal(replay.steps.length)}>全部展开</button>
          </>}
      </div>
      {done && <Result replay={replay} />}
    </Reveal>
  </section>;
}
