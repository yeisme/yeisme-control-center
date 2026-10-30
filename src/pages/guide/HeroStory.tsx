import { Check, LoaderCircle } from "../../icons";
import { cx } from "../../components/ui/cx";
import { typed, useLoopClock, useOnScreen } from "./guide-motion";

const cycle = 12_000;
const rest = 9_800;
const first = "eikona doctor --agent";
const second = "claude mcp add eikona -- eikona mcp --transport stdio";
const firstEnd = 300 + first.length * 55;
const secondStart = 2_300;
const secondEnd = secondStart + second.length * 32;

/**
 * Illustration of the guide's promise: a real command runs in the terminal, then an agent calls the same
 * tool over MCP and stops for the cost confirmation. Outputs and the chat are examples, labelled as such.
 */
export function HeroStory() {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const t = useLoopClock(cycle, onScreen, rest);
  const at = (ms: number) => t >= ms;
  const typingFirst = t < firstEnd + 150;
  const typingSecond = t >= secondStart && t < secondEnd + 150;
  const pressed = t >= 7_250 && t < 7_450;
  const confirmed = at(7_450);
  return <div ref={ref} className="guide-hero-story" data-dissolve={t >= 11_300 || undefined} aria-label="示意动画：在终端运行命令，再让 Agent 通过 MCP 调用同一个工具" role="img">
    <div className="guide-terminal">
      <div className="guide-terminal-bar"><i /><i /><i /><span>~/projects/rain-station</span></div>
      <div className="guide-terminal-body">
        <p className="guide-line"><span className="guide-prompt">$</span>{typed(first, t, 300, 55)}{typingFirst && <span className="guide-caret" />}</p>
        <p className="guide-out" data-on={at(1_650) || undefined}><Check className="guide-out-ok" /><span className="guide-bar w-24" /><span className="guide-bar w-14" /></p>
        <p className="guide-out" data-on={at(1_820) || undefined}><Check className="guide-out-ok" /><span className="guide-bar w-16" /><span className="guide-bar w-20" /></p>
        {at(secondStart) && <p className="guide-line"><span className="guide-prompt">$</span>{typed(second, t, secondStart, 32)}{typingSecond && <span className="guide-caret" />}</p>}
        <p className="guide-out" data-on={at(4_150) || undefined}><Check className="guide-out-ok" /><span className="guide-bar w-28" /></p>
        {!typingFirst && !typingSecond && at(4_150) && <p className="guide-line"><span className="guide-prompt">$</span><span className="guide-caret" /></p>}
      </div>
    </div>
    <div className="guide-agent">
      <p className="guide-agent-title">Agent</p>
      <p className="guide-bubble" data-on={at(4_600) || undefined}>用 Eikona 生成 3 张雨夜车站的概念图</p>
      <div className="guide-chip" data-on={at(5_200) || undefined}>{at(5_800) ? <Check className="text-success" /> : <LoaderCircle className="motion-safe:animate-spin" />}<code>eikona.search</code><span>{at(5_800) ? "找到 generate" : "查找动作"}</span></div>
      <div className={cx("guide-chip", !confirmed && at(6_200) && "is-waiting")} data-on={at(6_200) || undefined}>{confirmed ? <Check className="text-success" /> : <span className="guide-wait-dot" />}<code>eikona.execute</code><span>{confirmed ? "已确认 · 上限 $0.50" : "等你确认费用"}</span></div>
      <span aria-hidden="true" className="guide-confirm" data-on={(at(6_400) && !confirmed) || undefined} data-pressed={pressed || undefined}>确认，上限 $0.50</span>
      <div className="guide-tiles">
        {[0, 1, 2].map((index) => <span key={index} className="guide-tile" data-on={at(7_700 + index * 120) || undefined} data-resolved={at(8_300 + index * 120) || undefined} style={{ "--tile-hue": 190 + index * 28 } as React.CSSProperties} />)}
      </div>
    </div>
  </div>;
}
