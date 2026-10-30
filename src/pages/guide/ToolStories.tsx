import { Check } from "../../icons";
import type { ToolStory } from "./guide-content";

/**
 * One looping story per tool card, each acting out what the tool does. Pure CSS loops that only run
 * while the card is on screen ([data-on-screen]); reduced motion shows the resting frame.
 */
export function ToolStoryVisual({ story }: { story: ToolStory }) {
  if (story === "image") return <div className="story story-image" aria-hidden="true">
    {[0, 1, 2].map((index) => <span key={index} className="story-frame" style={{ "--i": index } as React.CSSProperties}><span className="story-frame-fill" />{index === 1 && <span className="story-pick"><Check className="size-3" /></span>}</span>)}
  </div>;
  if (story === "audio") return <div className="story story-audio" aria-hidden="true">
    <span className="story-wave">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}</span>
    <span className="story-progress"><span /></span>
  </div>;
  if (story === "pipeline") return <div className="story story-pipeline" aria-hidden="true">
    <span className="story-rail"><span className="story-pulse" /></span>
    {["剧本", "分镜", "镜头", "交付"].map((label, index) => <span key={label} className="story-node" style={{ "--i": index } as React.CSSProperties}><i />{label}</span>)}
  </div>;
  return <div className="story story-text" aria-hidden="true">
    {[0, 1, 2].map((index) => <span key={index} className="story-line" style={{ "--i": index } as React.CSSProperties} />)}
    <span className="story-candidate">候选稿 · 待你审阅</span>
  </div>;
}
