import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { ChevronLeft, ChevronRight, Columns2, Download, LoaderCircle, PanelRightOpen, RotateCcw, X, ZoomIn, ZoomOut } from "../icons";
import { KindBadge, cx, ownerLabel, type MediaKind } from "./ui";
import { grantErrorLabel, type MediaPreviewController } from "./media-preview";
import { resultAction, resultMeta, type ResultEntry } from "../shared/read-model/tasks";
import { clampPan, fitted, slidePosition, stepWhere, swipeIntent, toggleZoom, zoomAt, zoomPercent, zoomStep, type ZoomState } from "../shared/viewer";
import type { TaskArtifact, TaskSnapshot } from "../task-observation";
import { TaskThumbnail } from "./TaskThumbnail";

/** One item the viewer can step to; audio never appears here because it plays in the global player. */
export interface ViewerSlide {
  key: string;
  title: string;
  kind: MediaKind;
  meta: string;
  /** Owner-provided thumbnail for the strip; absent ones show the kind mark instead. */
  thumb?: { task: TaskSnapshot; result: TaskArtifact } | null;
}

export function viewerSlide(entry: ResultEntry): ViewerSlide {
  const thumb = (entry.kind === "image" || entry.kind === "video") && entry.result.thumbnail?.state === "ready" ? { task: entry.task, result: entry.result } : null;
  return { key: entry.key, title: entry.result.name || "未命名结果", kind: entry.kind, meta: `${ownerLabel(entry.task.locator.owner)} · ${entry.task.title}`, thumb };
}

/** Visual results in view order that the owner allows previewing. */
export function visualSlides(entries: ResultEntry[]): ViewerSlide[] {
  return entries.filter((entry) => entry.kind !== "audio" && resultAction(entry.task, "preview").enabled).map(viewerSlide);
}

const openLabel: Record<MediaKind, string> = { image: "查看大图", video: "播放视频", text: "阅读全文", audio: "播放" };
export const viewerOpenLabel = (kind: MediaKind) => openLabel[kind];

const textLimit = 200_000;

/** Zoomable, pannable image: wheel and buttons zoom about the pointer, drag pans, double-click toggles fit. */
function ZoomImage({ src, alt, zoom, onZoom, onError, onSwipe }: { src: string; alt: string; zoom: ZoomState; onZoom: (next: ZoomState) => void; onError: () => void; onSwipe: (direction: -1 | 1) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; from: ZoomState; moved: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const bounded = useCallback((next: ZoomState) => {
    const box = stage.current?.getBoundingClientRect();
    const img = image.current;
    if (!box || !img) return next;
    // The fitted size is the rendered size at scale 1, independent of the current transform.
    return clampPan(next, { width: img.offsetWidth, height: img.offsetHeight }, { width: box.width, height: box.height });
  }, []);
  const pointFor = (clientX: number, clientY: number) => {
    const box = stage.current!.getBoundingClientRect();
    return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
  };
  // React registers wheel listeners as passive, so zooming (and blocking page zoom) needs a native listener.
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0025));
      onZoom(bounded(zoomAt(zoomRef.current, zoomRef.current.scale * factor, pointFor(event.clientX, event.clientY))));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [bounded, onZoom]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: zoomRef.current, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) current.moved = true;
    if (current.from.scale > 1) onZoom(bounded({ ...current.from, x: current.from.x + dx, y: current.from.y + dy }));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.id !== event.pointerId || current.from.scale > 1) return;
    const direction = swipeIntent(event.clientX - current.x, event.clientY - current.y);
    if (direction) onSwipe(direction);
  };
  return <div
    ref={stage}
    className="viewer-zoom"
    data-zoomed={zoom.scale > 1 || undefined}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={() => { drag.current = null; }}
    onDoubleClick={(event) => onZoom(bounded(toggleZoom(zoomRef.current, pointFor(event.clientX, event.clientY))))}
  >
    {!loaded && <span className="viewer-skeleton" aria-hidden="true" />}
    <img
      ref={image}
      src={src}
      alt={alt}
      draggable={false}
      data-loaded={loaded || undefined}
      className="viewer-image"
      style={{ transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` }}
      onLoad={() => setLoaded(true)}
      onError={onError}
    />
  </div>;
}

/** Text results read in a centred column; the short-lived handle is fetched once per slide. */
function TextReader({ url, onError }: { url: string; onError: (code: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    void fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("text_preview_unavailable"); return response.text(); })
      .then((value) => { setTruncated(value.length > textLimit); setText(value.slice(0, textLimit)); })
      .catch((error) => { if (!controller.signal.aborted) onError(error instanceof Error ? error.message : "text_preview_unavailable"); });
    return () => controller.abort();
  }, [onError, url]);
  return <article className="viewer-text" tabIndex={0} aria-label="文本内容">
    {text === null ? <p className="text-muted">正在读取文本内容…</p> : <pre className="whitespace-pre-wrap break-words font-sans">{text}</pre>}
    {truncated && <p className="mt-4 text-2xs text-muted">内容较长，只显示前 {textLimit.toLocaleString("zh-CN")} 个字符；完整内容请下载查看。</p>}
  </article>;
}

function StageMessage({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return <div className="viewer-message" role="status">
    <span className="viewer-message-icon">{icon}</span>
    <p className="text-body-sm font-medium">{title}</p>
    {body && <p className="max-w-sm text-2xs text-white/65 text-pretty">{body}</p>}
    {action}
  </div>;
}

/**
 * The current view's results under the stage. One tab stop (the current tile); arrow keys keep driving the viewer,
 * and focus follows the current tile while it is inside the strip. Off-strip thumbnails load only when scrolled in.
 */
function ViewerStrip({ slides, current, pinned, eligible, onPick }: { slides: ViewerSlide[]; current: string | null; pinned: string | null; eligible: (slide: ViewerSlide) => boolean; onPick: (key: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = track.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!active) return;
    active.scrollIntoView({ block: "nearest", inline: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (track.current?.contains(document.activeElement) && document.activeElement !== active) active.focus({ preventScroll: true });
  }, [current]);
  return <nav aria-label="当前视图的结果" className="viewer-strip max-sm:hidden" data-viewer-strip>
    <div ref={track} className="viewer-strip-track">
      {slides.map((slide, index) => {
        const isCurrent = slide.key === current;
        const isPinned = slide.key === pinned;
        const disabled = !isCurrent && !eligible(slide);
        return <button
          key={slide.key}
          type="button"
          tabIndex={isCurrent ? 0 : -1}
          className="viewer-thumb"
          aria-label={`${index + 1}. ${slide.title}${isPinned ? "（对比 A）" : ""}`}
          aria-current={isCurrent ? "true" : undefined}
          aria-disabled={disabled || undefined}
          data-pinned={isPinned || undefined}
          onClick={() => { if (!disabled && !isCurrent) onPick(slide.key); }}
        >
          {slide.thumb ? <TaskThumbnail task={slide.thumb.task} result={slide.thumb.result} className="absolute inset-0 size-full! rounded-none! border-0! bg-transparent!" /> : <KindBadge kind={slide.kind} size="sm" />}
          {isPinned && <span aria-hidden="true" className="viewer-thumb-tag">A</span>}
        </button>;
      })}
    </div>
  </nav>;
}

/**
 * Full-screen viewer for image, video and text results. The page owns the URL-synced preview controller;
 * opening is still an explicit, audited preview request and stepping requests the next item only on demand.
 */
export function MediaViewer({ controller, slides, onNavigate, onDetails, detailsLabel = "查看详情" }: {
  controller: MediaPreviewController;
  slides: ViewerSlide[];
  onNavigate: (key: string) => void | Promise<unknown>;
  onDetails?: (key: string) => void;
  detailsLabel?: string;
}) {
  const target = controller.target;
  const open = controller.status !== "closed" && target?.kind !== "audio";
  const currentKey = target?.key ?? null;
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(fitted);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  const [stepError, setStepError] = useState<string | null>(null);
  // Comparing pins the loaded image as A, keeping its source without a new handle; B follows stepping.
  const [pinned, setPinned] = useState<{ key: string; src: string; title: string; loaded: boolean } | null>(null);
  const compareStepped = useRef<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  // Capture the opener while rendering the open transition: by the time effects run, focus is inside the dialog.
  if (open && !wasOpen.current && typeof document !== "undefined") opener.current = document.activeElement;
  wasOpen.current = open;

  useEffect(() => { setZoom(fitted); }, [currentKey]);
  useEffect(() => { setStepError(null); }, [currentKey, open]);
  useEffect(() => { if (!open || pendingKey === currentKey) setPendingKey(null); }, [currentKey, open, pendingKey]);
  useEffect(() => { if (!open) setPinned(null); }, [open]);

  const shownKey = pendingKey ?? currentKey;
  const position = slidePosition(slides, shownKey);
  const slide = position.index >= 0 ? slides[position.index] : null;
  const kind: MediaKind = target?.kind ?? slide?.kind ?? "image";
  const title = target?.result.name || slide?.title || "预览";
  const meta = target ? [ownerLabel(target.task.locator.owner), target.task.title, ...resultMeta(target.result).slice(0, 2)].filter(Boolean).join(" · ") : slide?.meta || "";
  // A page that reads the next item before opening it may reject; the item still on screen stays current
  // and the reason is announced inside the dialog, where page notices and toasts are hidden from assistive tech.
  const navigate = useCallback((key: string) => {
    setStepError(null);
    setPendingKey(key);
    void Promise.resolve(onNavigate(key)).catch((error: unknown) => {
      setPendingKey((current) => current === key ? null : current);
      setStepError(error instanceof Error && error.message ? error.message : "预览暂不可用");
    });
  }, [onNavigate]);
  // While comparing, stepping only lands on other images; A stays where it is.
  const eligible = useCallback((candidate: { key: string; kind: MediaKind }) => !pinned || (candidate.kind === "image" && candidate.key !== pinned.key), [pinned]);
  const go = useCallback((step: -1 | 1) => {
    const next = stepWhere(slides, shownKey, step, eligible);
    if (!next) return;
    setDirection(step);
    navigate(next);
  }, [eligible, navigate, shownKey, slides]);
  const goTo = useCallback((key: string | undefined) => {
    if (!key || key === shownKey) return;
    const candidate = slides.find((item) => item.key === key);
    if (candidate && !eligible(candidate)) return;
    setDirection(slidePosition(slides, key).index > position.index ? 1 : -1);
    navigate(key);
  }, [eligible, navigate, position.index, shownKey, slides]);
  // Once A has painted from its kept source, open B: the next image, or the previous one at the end of the set.
  useEffect(() => {
    if (!pinned?.loaded || shownKey !== pinned.key || compareStepped.current === pinned.key) return;
    compareStepped.current = pinned.key;
    const next = stepWhere(slides, pinned.key, 1, eligible) ?? stepWhere(slides, pinned.key, -1, eligible);
    if (!next) return;
    setDirection(1);
    navigate(next);
  }, [eligible, navigate, pinned, shownKey, slides]);

  const recover = useCallback(() => {
    void controller.fallback().catch((error) => controller.reportError(error instanceof Error ? error.message : "media_unavailable"));
  }, [controller]);
  const reportText = useCallback((code: string) => controller.reportError(code), [controller]);
  const imageReady = controller.status === "ready" && !!controller.sourceUrl && kind === "image";
  const zoomable = imageReady && !pinned;
  const canCompare = !pinned && imageReady && slides.filter((item) => item.kind === "image").length > 1;
  const toggleCompare = () => {
    if (pinned) { setPinned(null); return; }
    if (!canCompare || !shownKey || !controller.sourceUrl) return;
    compareStepped.current = null;
    setPinned({ key: shownKey, src: controller.sourceUrl, title, loaded: false });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    if (element.closest("input, textarea, select, [contenteditable='true']")) return;
    // Native video controls own their own arrow and space keys while focused.
    if (element instanceof HTMLMediaElement && [" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const handled = (() => {
      switch (event.key) {
        case "ArrowLeft": go(-1); return true;
        case "ArrowRight": go(1); return true;
        case "Home": goTo(slides.find(eligible)?.key); return true;
        case "End": goTo([...slides].reverse().find(eligible)?.key); return true;
        case "+": case "=": if (!zoomable) return false; setZoom((current) => zoomAt(current, current.scale * zoomStep)); return true;
        case "-": case "_": if (!zoomable) return false; setZoom((current) => zoomAt(current, current.scale / zoomStep)); return true;
        case "0": if (!zoomable) return false; setZoom(fitted); return true;
        case " ": {
          if (element !== content.current || kind !== "video") return false;
          const video = content.current?.querySelector("video");
          if (video) void (video.paused ? video.play().catch(() => {}) : video.pause());
          return true;
        }
        default: return false;
      }
    })();
    if (handled) event.preventDefault();
  };

  const restoreFocus = (event: Event) => {
    const element = opener.current;
    if (!(element instanceof HTMLElement) || !element.isConnected) return;
    event.preventDefault();
    element.focus({ preventScroll: true });
  };

  const body = (() => {
    if (controller.status === "blocked" || controller.status === "error") {
      const code = controller.error || "media_unavailable";
      return <StageMessage icon={<KindBadge kind={kind} size="lg" />} title="内容暂不可预览" body={grantErrorLabel(code)} action={controller.status === "error" && code !== "preview_target_missing" ? <button type="button" className="viewer-pill" onClick={controller.retry}><RotateCcw className="size-3.5" />重新申请</button> : undefined} />;
    }
    if (controller.status !== "ready" || !controller.sourceUrl || !target) {
      const ratio = target?.result.width && target.result.height ? `${target.result.width} / ${target.result.height}` : "16 / 10";
      return <div className="viewer-pending" style={{ "--viewer-ratio": ratio } as CSSProperties}><span className="viewer-skeleton" aria-hidden="true" /><p className="viewer-pending-label"><LoaderCircle className="size-4 motion-safe:animate-spin" />正在申请预览句柄</p></div>;
    }
    if (kind === "image") return <ZoomImage src={controller.sourceUrl} alt={title} zoom={zoom} onZoom={setZoom} onError={recover} onSwipe={go} />;
    if (kind === "video") return <video key={controller.sourceUrl} src={controller.sourceUrl} controls playsInline preload="metadata" autoPlay={controller.autoplay} className="viewer-video" onError={recover} />;
    return <TextReader url={controller.sourceUrl} onError={reportText} />;
  })();

  const comparePane = pinned && <figure className="viewer-pane" data-pane="b">
    {shownKey === pinned.key
      ? <StageMessage icon={<Columns2 className="size-6" />} title="选一张来对比" body="用 ← → 或下方缩略条选另一张图，它会出现在这里。" />
      : imageReady ? <img src={controller.sourceUrl!} alt={`对比 B：${title}`} className="viewer-pane-image" onError={recover} /> : body}
    {shownKey !== pinned.key && <figcaption className="viewer-pane-label"><span className="viewer-pane-tag">B</span><span className="truncate">{title}</span></figcaption>}
  </figure>;

  const download = target && resultAction(target.task, "download");
  const iconButton = (label: string, icon: ReactNode, onClick: () => void, disabled = false, className?: string) =>
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cx("viewer-icon", className)}>{icon}</button>;

  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) controller.close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="viewer-backdrop" />
      <Dialog.Content ref={content} tabIndex={-1} className="viewer" aria-describedby={undefined} onKeyDown={onKeyDown} onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus({ preventScroll: true }); }} onCloseAutoFocus={restoreFocus} onEscapeKeyDown={(event) => { if (pinned) { event.preventDefault(); setPinned(null); } }} data-media-viewer={kind} data-viewer-status={controller.status} data-viewer-compare={pinned ? "true" : undefined}>
        <header className="viewer-bar">
          <KindBadge kind={kind} size="sm" className="max-sm:hidden" />
          <div className="min-w-0 flex-1">
            <Dialog.Title className="truncate text-body-sm font-semibold text-white">{title}</Dialog.Title>
            <p className="truncate text-2xs text-white/60">{meta}</p>
          </div>
          {position.label && <span className="viewer-count max-sm:hidden" aria-label={`第 ${position.index + 1} 项，共 ${position.total} 项`}>{position.label}</span>}
          <div className="flex shrink-0 items-center gap-1">
            {(canCompare || pinned) && <button type="button" className="viewer-pill max-sm:px-2.5" aria-pressed={!!pinned} title={pinned ? "结束对比（Esc）" : "把这张固定在左边，和另一张并排看"} onClick={toggleCompare}><Columns2 className="size-3.5" /><span className="max-sm:sr-only">并排对比</span></button>}
            {zoomable && <div className="viewer-zoom-group max-md:hidden">
              {iconButton("缩小", <ZoomOut className="size-4" />, () => setZoom((current) => zoomAt(current, current.scale / zoomStep)), zoom.scale <= 1)}
              <button type="button" className="viewer-zoom-value" aria-label={`${zoomPercent(zoom)}，适应窗口`} title="适应窗口" onClick={() => setZoom(fitted)}>{zoomPercent(zoom)}</button>
              {iconButton("放大", <ZoomIn className="size-4" />, () => setZoom((current) => zoomAt(current, current.scale * zoomStep)), zoom.scale >= 6)}
            </div>}
            {download && target && iconButton(download.enabled ? "下载" : download.reason || "来源未开放下载", controller.pendingDownload ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : <Download className="size-4" />, () => void controller.download(target), !download.enabled || controller.pendingDownload)}
            {onDetails && shownKey && <button type="button" className="viewer-pill max-sm:px-2.5" title={detailsLabel} onClick={() => onDetails(shownKey)}><PanelRightOpen className="size-3.5" /><span className="max-sm:sr-only">{detailsLabel}</span></button>}
            <Dialog.Close asChild>{iconButton("关闭预览", <X className="size-[18px]" />, () => {})}</Dialog.Close>
          </div>
        </header>
        <div className="viewer-stage" data-compare={pinned ? true : undefined}>
          {/* A sits outside the keyed slide wrapper, so stepping B never remounts it. */}
          {pinned && <figure className="viewer-pane" data-pane="a">
            <img src={pinned.src} alt={`对比 A：${pinned.title}`} className="viewer-pane-image" onLoad={() => setPinned((current) => current && !current.loaded ? { ...current, loaded: true } : current)} onError={() => setPinned(null)} />
            <figcaption className="viewer-pane-label"><span className="viewer-pane-tag">A</span><span className="truncate">{pinned.title}</span></figcaption>
          </figure>}
          <div key={shownKey || "empty"} className="viewer-media" data-direction={direction} data-pending={pendingKey !== null && pendingKey !== currentKey ? true : undefined}>{comparePane || body}</div>
          {iconButton("上一项", <ChevronLeft className="size-6" />, () => go(-1), !stepWhere(slides, shownKey, -1, eligible), "viewer-nav viewer-nav-prev")}
          {iconButton("下一项", <ChevronRight className="size-6" />, () => go(1), !stepWhere(slides, shownKey, 1, eligible), "viewer-nav viewer-nav-next")}
        </div>
        {slides.length > 1 && <ViewerStrip slides={slides} current={shownKey} pinned={pinned?.key ?? null} eligible={eligible} onPick={goTo} />}
        <footer className="viewer-foot">
          <span role="status" className={stepError ? "viewer-alert" : "sr-only"}>{stepError && `没能打开这一项：${stepError}`}</span>
          {!stepError && <>
            <span className="max-sm:hidden">{pinned ? "← → 换右边的 B · Esc 结束对比" : `← → 切换${zoomable ? " · 滚轮或双击缩放，拖动平移" : ""} · Esc 关闭`}</span>
            <span className="sm:hidden">{position.label || "预览"}</span>
          </>}
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
