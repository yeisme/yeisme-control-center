import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AudioLines, ChevronLeft, ChevronRight, Maximize2, MoveHorizontal, Music, Receipt, TriangleAlert, X } from "../../icons";
import { cx } from "../../components/ui/cx";
import { Reveal } from "./guide-motion";
import { SectionHeading } from "./guide-parts";
import { editPair, modelComparison, musicSteps, showcaseChain, showcaseRecord, sounds, videos, type ShowcaseItem } from "./showcase";

const toolNames: Record<ShowcaseItem["tool"], string> = { eikona: "Eikona", scaena: "Scaena", sonora: "Sonora" };

function AiLabel() {
  return <span className="guide-ai-label">AI 生成</span>;
}

/** The record behind one sample: what was asked, the exact call, and what the owner reported. */
export function ItemFacts({ item }: { item: ShowcaseItem }) {
  return <details className="guide-facts">
    <summary>生成记录</summary>
    <dl>
      <div><dt>提示词</dt><dd>{item.prompt}</dd></div>
      <div><dt>调用</dt><dd><code>{item.call}</code></dd></div>
      <div><dt>模型</dt><dd>{item.model}</dd></div>
      <div><dt>费用</dt><dd>{item.cost}</dd></div>
      <div><dt>耗时</dt><dd>{item.time}</dd></div>
      <div><dt>记录</dt><dd>{toolNames[item.tool]} · {item.ref} · {showcaseRecord.date}</dd></div>
    </dl>
  </details>;
}

function Meta({ item }: { item: ShowcaseItem }) {
  return <p className="guide-media-meta">{item.model} · {item.cost} · {item.time}</p>;
}

/**
 * A light full-screen viewer on the native <dialog>: the browser traps focus and closes on Escape, so the public page
 * needs no dialog library. Arrow keys step through the set; closing returns focus to the thumbnail that opened it.
 */
function MediaViewer({ items, index, onIndex, onClose }: { items: ShowcaseItem[]; index: number | null; onIndex: (index: number) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = index !== null;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open]);
  const item = index === null ? null : items[index];
  const step = (delta: number) => { if (index !== null) onIndex((index + delta + items.length) % items.length); };
  return <dialog
    ref={dialog}
    className="guide-viewer"
    aria-label={item ? `大图：${item.title}` : "大图"}
    onClose={() => { onClose(); opener.current?.focus({ preventScroll: true }); }}
    onKeyDown={(event) => {
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
    }}
    onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
  >
    {item && <div className="guide-viewer-body">
      <div className="guide-viewer-bar">
        <p className="min-w-0 truncate"><strong>{item.title}</strong><span>{index! + 1} / {items.length}</span></p>
        <button type="button" className="guide-viewer-button" aria-label="关闭大图" autoFocus onClick={() => dialog.current?.close()}><X className="size-4" /></button>
      </div>
      <figure className="guide-viewer-figure">
        <img src={item.media.src} alt={item.alt} width={item.media.width} height={item.media.height} />
        <AiLabel />
        <figcaption><Meta item={item} /></figcaption>
      </figure>
      <div className="guide-viewer-nav">
        <button type="button" className="guide-viewer-button" aria-label="上一张" onClick={() => step(-1)}><ChevronLeft className="size-4" /></button>
        <button type="button" className="guide-viewer-button" aria-label="下一张" onClick={() => step(1)}><ChevronRight className="size-4" /></button>
      </div>
    </div>}
  </dialog>;
}

function ComparisonGallery() {
  const [viewing, setViewing] = useState<number | null>(null);
  const groups = [
    { title: "GPT Image 2.5", note: "3:2 横幅，模型自己加了胶片边框", items: modelComparison.filter((item) => item.id.startsWith("eikona-gpt")) },
    { title: "Grok Imagine", note: "方图，更偏远景", items: modelComparison.filter((item) => item.id.startsWith("eikona-grok")) },
  ];
  return <>
    <div className="guide-compare-groups">
      {groups.map((group) => <Reveal key={group.title} kind="card" className="guide-gallery">
        <p className="guide-gallery-title"><strong>{group.title}</strong><span>{group.note}</span></p>
        <ul className="guide-gallery-grid" aria-label={`${group.title} 的三张结果`}>
          {group.items.map((item) => {
            const index = modelComparison.indexOf(item);
            return <li key={item.id}>
              <button type="button" className="guide-thumb" aria-label={`查看大图：${item.title}`} onClick={() => setViewing(index)}>
                <img src={item.media.src} alt={item.alt} width={item.media.width} height={item.media.height} loading="lazy" decoding="async" />
                <span className="guide-thumb-zoom" aria-hidden="true"><Maximize2 className="size-3.5" /></span>
              </button>
              <p className="guide-media-meta">{item.cost} · {item.time}</p>
            </li>;
          })}
        </ul>
        <ItemFacts item={group.items[0]} />
      </Reveal>)}
    </div>
    <MediaViewer items={modelComparison} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
  </>;
}

/** Before on the left of the split, after on the right; the range input drives the split by pointer or arrow keys. */
function BeforeAfter() {
  const [split, setSplit] = useState(50);
  const { before, after } = editPair;
  return <Reveal kind="card" className="guide-edit">
    <div className="guide-before-after" style={{ "--split": `${split}%` } as CSSProperties}>
      <img src={before.media.src} alt={`改图前：${before.alt}`} width={before.media.width} height={before.media.height} loading="lazy" decoding="async" />
      <img src={after.media.src} alt={`改图后：${after.alt}`} width={after.media.width} height={after.media.height} loading="lazy" decoding="async" className="guide-before-after-top" />
      <span className="guide-before-after-line" aria-hidden="true"><span><MoveHorizontal className="size-4" /></span></span>
      <span className="guide-before-after-label is-before" aria-hidden="true">改图前</span>
      <span className="guide-before-after-label is-after" aria-hidden="true">改图后</span>
      <AiLabel />
      <input
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(event) => setSplit(Number(event.currentTarget.value))}
        aria-label="改图前后的分界位置"
        aria-valuetext={`分界在 ${split}%：左边是改图前，右边是改图后`}
        className="guide-before-after-range"
      />
    </div>
    <div className="guide-edit-copy">
      <h4 className="guide-h3">{after.title}</h4>
      <p className="mt-1 text-body-sm text-muted text-pretty">拖动分界线，或聚焦后用方向键。人物、构图和光线都没动，只有伞换了。</p>
      <Meta item={after} />
      <ItemFacts item={after} />
    </div>
  </Reveal>;
}

function VideoCard({ item, index }: { item: ShowcaseItem; index: number }) {
  return <Reveal as="figure" kind="card" delay={index * 90} className="guide-media-card">
    <div className="guide-media-frame">
      <video controls preload="none" playsInline poster={item.media.poster} width={item.media.width} height={item.media.height} aria-label={item.alt}>
        <source src={item.media.src} type="video/mp4" />
      </video>
      <AiLabel />
    </div>
    <figcaption className="guide-media-copy">
      <h4 className="guide-h3">{item.title}</h4>
      <Meta item={item} />
      <ItemFacts item={item} />
    </figcaption>
  </Reveal>;
}

function AudioCard({ item, index }: { item: ShowcaseItem; index: number }) {
  const music = item.id === "sonora-music";
  return <Reveal as="figure" kind="card" delay={index * 90} className="guide-media-card guide-audio-card">
    <div className="flex items-start gap-3">
      <span className="guide-audio-icon" aria-hidden="true">{music ? <Music className="size-4" /> : <AudioLines className="size-4" />}</span>
      <div className="min-w-0">
        <h4 className="guide-h3">{item.title}</h4>
        <p className="mt-1 text-body-sm text-ink-soft text-pretty">{music ? item.prompt : `「${item.prompt}」`}</p>
      </div>
      <AiLabel />
    </div>
    <audio controls preload="none" src={item.media.src} aria-label={`播放：${item.title}`} className="mt-3 w-full" />
    <figcaption className="guide-media-copy">
      <Meta item={item} />
      <ItemFacts item={item} />
    </figcaption>
  </Reveal>;
}

function ChainStrip() {
  return <Reveal className="guide-chain-wrap">
    <ol className="guide-chain" aria-label="这组样例的生成顺序">
      {showcaseChain.map(({ label, item }, index) => <li key={label} className="guide-chain-step">
        <span className="guide-chain-thumb">
          {item.media.kind === "audio"
            ? <span className="guide-audio-icon" aria-hidden="true">{item.id === "sonora-music" ? <Music className="size-4" /> : <AudioLines className="size-4" />}</span>
            : <img src={item.media.poster || item.media.src} alt="" width={96} height={64} loading="lazy" decoding="async" />}
        </span>
        <span className="min-w-0">
          <span className="block text-body-sm font-semibold text-ink">{index + 1}. {label}</span>
          <span className="block text-2xs text-muted">{toolNames[item.tool]} · {item.model.split("（")[0]}</span>
        </span>
      </li>)}
    </ol>
  </Reveal>;
}

export function ShowcaseSection() {
  return <section className="guide-section" aria-labelledby="guide-showcase">
    <SectionHeading id="guide-showcase" eyebrow="真实案例" title="同一个场景，从关键帧做到配乐" body="下面每个文件都来自一次真实调用：先出关键帧，再改图、做成视频、配上台词和音乐。点开「生成记录」能看到提示词、调用参数、模型、费用和耗时。" />
    <Reveal className="guide-record">
      <p><Receipt className="size-3.5 shrink-0" />真实记录 · {showcaseRecord.date} · {showcaseRecord.versions}</p>
      <p>{showcaseRecord.disclosure}</p>
    </Reveal>
    <ChainStrip />

    <h3 className="guide-sub" id="guide-showcase-models">同一句提示词，两个模型各出三张</h3>
    <p className="guide-sub-lead">「{modelComparison[0].prompt}」</p>
    <ComparisonGallery />

    <h3 className="guide-sub" id="guide-showcase-edit">改图</h3>
    <BeforeAfter />

    <h3 className="guide-sub" id="guide-showcase-video">视频</h3>
    <div className="guide-media-grid">{videos.map((item, index) => <VideoCard key={item.id} item={item} index={index} />)}</div>

    <h3 className="guide-sub" id="guide-showcase-audio">声音</h3>
    <div className="guide-media-grid is-three">{sounds.map((item, index) => <AudioCard key={item.id} item={item} index={index} />)}</div>
    <Reveal className="guide-music-steps">
      <p className="guide-eyebrow">配乐是这样走到 generate 的</p>
      <ol>{musicSteps.map((step) => <li key={step.action}><code className="guide-tag">{step.action}</code><span>{step.note}</span></li>)}</ol>
    </Reveal>

    <Reveal className={cx("guide-missing")}>
      <p className="flex items-center gap-1.5 text-body-sm font-semibold text-ink"><TriangleAlert className="size-4 text-warning" />这次没做成的</p>
      <ul>
        <li>首尾帧视频：Scaena 当前没有启用首尾帧模式的线路。</li>
        <li>无损放大：这台 Eikona 没有配置超分模型。用改图重画一遍不算放大，所以没有放上来。</li>
        <li>更多音色：其余 TTS Provider 缺凭据或额度，韩语音色的请求被 Provider 拒绝。</li>
      </ul>
    </Reveal>
  </section>;
}
