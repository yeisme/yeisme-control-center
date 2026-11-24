import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { ChevronLeft, ChevronRight, Columns2, Download, Expand, Info, LoaderCircle, PanelRightOpen, RotateCcw, Shrink, X, ZoomIn, ZoomOut } from "../icons";
import { KindBadge, cx, ownerLabel, type MediaKind } from "./ui";
import { kindLabel } from "./ui/Kind";
import { grantErrorLabel, type MediaPreviewController } from "./media-preview";
import { resultAction, resultMeta, type ResultEntry } from "../shared/read-model/tasks";
import { clampPan, fitted, slidePosition, stepWhere, swipeIntent, toggleZoom, zoomAt, zoomPercent, zoomStep, type ZoomState } from "../shared/viewer";
import { actualPixels, coastSpeed, distance, dismissIntent, dragAxis, isDoubleTap, midpoint, originTransform, panVelocity, pinchScale, pullOpacity, rubberBand, type Point } from "../shared/viewer-gestures";
import { releaseVelocity } from "../shared/sheet-drag";
import { formatFullTime, formatRelative } from "../shared/read-model/format";
import { taskStateLabels, type TaskArtifact, type TaskSnapshot } from "../task-observation";
import { TaskThumbnail, peekThumbnail } from "./TaskThumbnail";
import { useWorkspace } from "../app/workspace";
import { leaveAsGhost } from "./panel-ghost";
import { prefersReducedMotion, scrollBehavior } from "../shared/motion/reduced";

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
/** Mark a card, poster or thumbnail with this and the result's key: the viewer grows out of it when it opens. */
export const viewerOrigin = "data-viewer-origin";

/** The card the viewer grows out of: the one around the button that opened it, else the first on screen for that key. */
function originBox(key: string, opener: Element | null): DOMRect | null {
  const selector = `[${viewerOrigin}="${CSS.escape(key)}"]`;
  const near = opener?.closest?.(selector) || opener?.closest?.("[data-result], [data-asset-stage], li, article")?.querySelector(selector);
  const box = (near || document.querySelector(selector))?.getBoundingClientRect();
  return box && box.width > 0 && box.bottom > 0 && box.top < window.innerHeight ? box : null;
}

type Gesture =
  | { kind: "drag"; id: number; start: Point; from: ZoomState; axis: "x" | "y" | null; touch: boolean; samples: { x: number; y: number; t: number }[] }
  | { kind: "pinch"; startDistance: number; from: ZoomState };

/**
 * Zoomable, pannable image. Wheel, buttons and pinching zoom about the pointer; a double click or a double tap toggles
 * fit; a zoomed image pans with the drag. At fit, a sideways drag follows the finger (with some give past either end)
 * and steps on release; on touch, a pull down closes the viewer.
 */
function ZoomImage({ src, alt, zoom, onZoom, onError, onSwipe, canStep, onDismiss, placeholder, size, actual }: {
  src: string;
  alt: string;
  zoom: ZoomState;
  onZoom: (next: ZoomState) => void;
  onError: () => void;
  onSwipe: (direction: -1 | 1) => void;
  canStep: (direction: -1 | 1) => boolean;
  onDismiss: () => void;
  /** A thumbnail this tab already holds: shown, softened, until the full image has loaded. */
  placeholder: string | null;
  /** The size the owner reported, so the stand-in takes the picture's place (never above its natural size). */
  size: { width: number; height: number } | null;
  /** Filled in with 1:1 for the 原始像素 button and the 1 key. */
  actual: MutableRefObject<(() => void) | null>;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<(Point & { t: number }) | null>(null);
  const [follow, setFollow] = useState<Point | null>(null);
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
  actual.current = () => {
    const img = image.current;
    if (!img || !img.naturalWidth) return;
    const scale = actualPixels({ width: img.naturalWidth, height: img.naturalHeight }, { width: img.offsetWidth, height: img.offsetHeight });
    onZoom(scale <= 1 || Math.abs(zoomRef.current.scale - scale) < 0.01 ? fitted : bounded(zoomAt(fitted, scale)));
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
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", startDistance: distance(a!, b!), from: zoomRef.current };
      setFollow(null);
      return;
    }
    if (pointers.current.size > 2) return;
    cancelAnimationFrame(coasting.current);
    gesture.current = { kind: "drag", id: event.pointerId, start: { x: event.clientX, y: event.clientY }, from: zoomRef.current, axis: null, touch: event.pointerType !== "mouse", samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }] };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    if (current.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const center = midpoint(a, b);
      onZoom(bounded(zoomAt(current.from, pinchScale(current.from.scale, current.startDistance, distance(a, b)), pointFor(center.x, center.y))));
      return;
    }
    if (current.id !== event.pointerId) return;
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    current.samples = [...current.samples.slice(-11), { x: event.clientX, y: event.clientY, t: event.timeStamp }];
    if (current.from.scale > 1) { onZoom(bounded({ ...current.from, x: current.from.x + dx, y: current.from.y + dy })); return; }
    current.axis ??= dragAxis(dx, dy);
    if (current.axis === "x") setFollow({ x: canStep(dx < 0 ? 1 : -1) ? dx : rubberBand(dx), y: 0 });
    else if (current.axis === "y" && current.touch) setFollow({ x: 0, y: Math.max(0, dy) });
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (!current) return;
    if (current.kind === "pinch") {
      if (!pointers.current.size) gesture.current = null;
      return;
    }
    if (current.id !== event.pointerId) return;
    gesture.current = null;
    setFollow(null);
    if (event.type === "pointercancel") return;
    // A zoomed picture let go while moving keeps gliding a little and slows to a stop.
    if (current.from.scale > 1) { coast(panVelocity([...current.samples, { x: event.clientX, y: event.clientY, t: event.timeStamp }])); return; }
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (current.touch && Math.hypot(dx, dy) < 8) {
      const tap = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      if (isDoubleTap(lastTap.current, tap)) { lastTap.current = null; onZoom(bounded(toggleZoom(zoomRef.current, pointFor(tap.x, tap.y)))); }
      else lastTap.current = tap;
      return;
    }
    if (current.axis === "y" && current.touch) {
      if (dismissIntent(dy, releaseVelocity([...current.samples, { y: event.clientY, t: event.timeStamp }]))) onDismiss();
      return;
    }
    const direction = swipeIntent(dx, dy);
    if (direction && canStep(direction)) onSwipe(direction);
  };
  const coasting = useRef(0);
  useEffect(() => () => cancelAnimationFrame(coasting.current), []);
  const coast = (velocity: Point) => {
    if (prefersReducedMotion() || Math.hypot(velocity.x, velocity.y) < 0.05) return;
    let speed = velocity;
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(48, now - last);
      last = now;
      speed = coastSpeed(speed, elapsed);
      if (Math.hypot(speed.x, speed.y) < 0.02) return;
      const current = zoomRef.current;
      const next = bounded({ ...current, x: current.x + speed.x * elapsed, y: current.y + speed.y * elapsed });
      if (next.x === current.x && next.y === current.y) return;
      onZoom(next);
      coasting.current = requestAnimationFrame(step);
    };
    coasting.current = requestAnimationFrame(step);
  };
  const shiftX = zoom.x + (follow?.x ?? 0);
  const shiftY = zoom.y + (follow?.y ?? 0);
  const pulled = follow && follow.y > 0 ? follow.y : 0;
  return <div
    ref={stage}
    className="viewer-zoom"
    data-zoomed={zoom.scale > 1 || undefined}
    data-dragging={follow ? "true" : undefined}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerEnd}
    onPointerCancel={onPointerEnd}
    onDoubleClick={(event) => onZoom(bounded(toggleZoom(zoomRef.current, pointFor(event.clientX, event.clientY))))}
  >
    {/* A thumbnail this tab already holds stands in, softened, until the full image arrives; otherwise a skeleton. */}
    {!loaded && (placeholder ? <div className="viewer-placeholder" aria-hidden="true" style={{ backgroundImage: `url("${placeholder}")`, width: size ? `min(100%, ${size.width}px)` : "100%", aspectRatio: size ? `${size.width} / ${size.height}` : "16 / 10" }} /> : <span className="viewer-skeleton" aria-hidden="true" />)}
    <img
      ref={image}
      src={src}
      alt={alt}
      draggable={false}
      data-loaded={loaded || undefined}
      data-reveal={placeholder ? "fade" : "blur"}
      className="viewer-image"
      style={{ transform: `translate3d(${shiftX}px, ${shiftY}px, 0) scale(${zoom.scale * (pulled ? 1 - Math.min(0.2, pulled / 1200) : 1)})`, opacity: pulled ? pullOpacity(pulled) : undefined }}
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
    active.scrollIntoView({ block: "nearest", inline: "center", behavior: scrollBehavior() });
    if (track.current?.contains(document.activeElement) && document.activeElement !== active) active.focus({ preventScroll: true });
  }, [current]);
  return <nav aria-label="当前视图的结果" className="viewer-strip" data-viewer-strip>
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

/** What the viewer already knows about the item: nothing here is read anew. */
function ViewerInfo({ entry, kind, onClose }: { entry: ResultEntry; kind: MediaKind; onClose: () => void }) {
  const { task, result } = entry;
  const rows: Array<[string, ReactNode]> = [
    ["名称", result.name || "未命名结果"],
    ["类型", kindLabel(kind)],
    ["规格", resultMeta(result).join(" · ") || "来源未提供"],
    ["来自", `${ownerLabel(task.locator.owner)} · ${task.title}`],
    ["项目", task.locator.project || "未提供"],
    ["任务状态", taskStateLabels[task.state] || task.state.replace(/_/g, " ")],
    ["更新", <span title={formatFullTime(task.updated_at || task.created_at)}>{formatRelative(task.updated_at || task.created_at)}</span>],
    ["任务引用", <span className="break-all font-mono text-[12px]">{task.locator.task_ref}</span>],
  ];
  return <aside className="viewer-info" data-viewer-info aria-labelledby="viewer-info-title">
    <div className="flex items-center justify-between gap-2">
      <h2 id="viewer-info-title" className="text-body-sm font-semibold text-white">信息</h2>
      <button type="button" className="viewer-icon" aria-label="收起信息" title="收起信息（I）" onClick={onClose}><X className="size-4" /></button>
    </div>
    <dl className="mt-3 space-y-3">
      {rows.map(([label, value]) => <div key={label}>
        <dt className="text-2xs text-white/55">{label}</dt>
        <dd className="mt-0.5 text-[13px] leading-5 text-white/90 break-words">{value}</dd>
      </div>)}
    </dl>
    <p className="mt-4 text-2xs leading-5 text-white/50">这些都是已经读到的信息；看信息不会再读取内容。</p>
  </aside>;
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
  const { scopeId, session } = useWorkspace();
  const target = controller.target;
  const open = controller.status !== "closed" && target?.kind !== "audio";
  const currentKey = target?.key ?? null;
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(fitted);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Comparing pins the loaded image as A, keeping its source without a new handle; B follows stepping.
  const [pinned, setPinned] = useState<{ key: string; src: string; title: string; loaded: boolean } | null>(null);
  const compareStepped = useRef<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const actual = useRef<(() => void) | null>(null);
  const opener = useRef<Element | null>(null);
  const origin = useRef<{ x: number; y: number; scale: number } | null>(null);
  const wasOpen = useRef(false);
  // Capture the opener while rendering the open transition: by the time effects run, focus is inside the dialog. The
  // card it was opened from, when it shows on screen, is where the stage grows from.
  if (open && !wasOpen.current && typeof document !== "undefined") {
    opener.current = document.activeElement;
    const box = target ? originBox(target.key, document.activeElement) : null;
    origin.current = box ? originTransform(box, { width: window.innerWidth, height: window.innerHeight }) : null;
  }
  wasOpen.current = open;

  useEffect(() => { setZoom(fitted); }, [currentKey]);
  useEffect(() => { setStepError(null); }, [currentKey, open]);
  useEffect(() => { if (!open || pendingKey === currentKey) setPendingKey(null); }, [currentKey, open, pendingKey]);
  useEffect(() => { if (!open) setPinned(null); }, [open]);

  // Closing leaves a still copy that fades where it stood, while the page underneath answers at once. Radix mounts the
  // content one pass after `open`, so it is read when closing; leaving the page (or signing out) takes no copy along.
  const unmounting = useRef(false);
  const lastKey = useRef<string | null>(null);
  useLayoutEffect(() => () => { unmounting.current = true; }, []);
  useLayoutEffect(() => {
    if (!open) return;
    return () => {
      const node = content.current;
      if (!node?.isConnected || unmounting.current) return;
      // The card of the item last shown, when it is on screen: the stage shrinks back into it.
      const box = lastKey.current ? originBox(lastKey.current, opener.current instanceof Element ? opener.current : null) : null;
      const to = box ? originTransform(box, { width: window.innerWidth, height: window.innerHeight }) : null;
      leaveAsGhost(node, { exit: "viewer", scrim: "viewer-backdrop", scrollTop: 0, ...(to ? { shrink: { selector: ".viewer-stage", to } } : {}) });
    };
  }, [open]);

  // The tools step aside after 2.5 s without a pointer or a key, and come back with the next one; never while they hold
  // focus or the information is open.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!open) return;
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const node = content.current;
        const holding = node?.querySelector(".viewer-bar")?.contains(document.activeElement) || node?.querySelector(".viewer-strip")?.contains(document.activeElement);
        if (!holding) setIdle(true);
      }, 2500);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake, true);
    window.addEventListener("focusin", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake, true);
      window.removeEventListener("focusin", wake);
    };
  }, [open]);

  useEffect(() => {
    const sync = () => setFullscreen(!!content.current && document.fullscreenElement === content.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!open && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [open]);
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled !== false && typeof HTMLElement !== "undefined" && "requestFullscreen" in HTMLElement.prototype;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void content.current?.requestFullscreen?.().catch(() => undefined);
  };

  const shownKey = pendingKey ?? currentKey;
  // Kept through the closing render (which no longer has a target), for the copy that shrinks back to its card.
  if (open && shownKey) lastKey.current = shownKey;
  const position = slidePosition(slides, shownKey);
  const slide = position.index >= 0 ? slides[position.index] : null;
  const kind: MediaKind = target?.kind ?? slide?.kind ?? "image";
  const title = target?.result.name || slide?.title || "预览";
  const meta = target ? [ownerLabel(target.task.locator.owner), target.task.title, ...resultMeta(target.result).slice(0, 2)].filter(Boolean).join(" · ") : slide?.meta || "";
  // Only a thumbnail this tab already holds: the viewer never asks for one of its own.
  const thumbnail = target ? peekThumbnail(scopeId, session?.epoch, target.task, target.result) : null;
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
  const canStep = useCallback((step: -1 | 1) => !!stepWhere(slides, shownKey, step, eligible), [eligible, shownKey, slides]);
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
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const handled = (() => {
      switch (event.key) {
        case "ArrowLeft": go(-1); return true;
        case "ArrowRight": go(1); return true;
        case "Home": goTo(slides.find(eligible)?.key); return true;
        case "End": goTo([...slides].reverse().find(eligible)?.key); return true;
        case "+": case "=": if (!zoomable) return false; setZoom((current) => zoomAt(current, current.scale * zoomStep)); return true;
        case "-": case "_": if (!zoomable) return false; setZoom((current) => zoomAt(current, current.scale / zoomStep)); return true;
        case "0": if (!zoomable) return false; setZoom(fitted); return true;
        case "1": if (!zoomable) return false; actual.current?.(); return true;
        case "i": case "I": if (!target) return false; setInfo((value) => !value); return true;
        case "f": case "F": if (!canFullscreen) return false; toggleFullscreen(); return true;
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
      return <div className="viewer-pending" style={{ "--viewer-ratio": ratio } as CSSProperties}>
        {thumbnail ? <div className="viewer-placeholder" aria-hidden="true" style={{ backgroundImage: `url("${thumbnail}")` }} /> : <span className="viewer-skeleton" aria-hidden="true" />}
        <p className="viewer-pending-label"><LoaderCircle className="size-4 motion-safe:animate-spin" />正在申请预览句柄</p>
      </div>;
    }
    if (kind === "image") return <ZoomImage src={controller.sourceUrl} alt={title} zoom={zoom} onZoom={setZoom} onError={recover} onSwipe={go} canStep={canStep} onDismiss={controller.close} placeholder={thumbnail} size={target.result.width && target.result.height ? { width: target.result.width, height: target.result.height } : null} actual={actual} />;
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
  const iconButton = (label: string, icon: ReactNode, onClick: () => void, disabled = false, className?: string, keys?: string) =>
    <button type="button" aria-label={label} title={keys ? `${label}（${keys}）` : label} aria-keyshortcuts={keys} disabled={disabled} onClick={onClick} className={cx("viewer-icon", className)}>{icon}</button>;
  const grow = origin.current;

  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) controller.close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="viewer-backdrop" />
      <Dialog.Content ref={content} tabIndex={-1} className="viewer" aria-describedby={undefined} onKeyDown={onKeyDown} onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus({ preventScroll: true }); }} onCloseAutoFocus={restoreFocus} onEscapeKeyDown={(event) => { if (pinned) { event.preventDefault(); setPinned(null); } else if (info) { event.preventDefault(); setInfo(false); } }} data-media-viewer={kind} data-viewer-status={controller.status} data-viewer-compare={pinned ? "true" : undefined} data-idle={idle && !info ? "true" : undefined}>
        {/* The picture itself, blurred far out, tints the room; a thumbnail this tab already holds, never a new read. */}
        {thumbnail && <div key={thumbnail} className="viewer-ambient" aria-hidden="true" style={{ backgroundImage: `url("${thumbnail}")` }} />}
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
              {iconButton("缩小", <ZoomOut className="size-4" />, () => setZoom((current) => zoomAt(current, current.scale / zoomStep)), zoom.scale <= 1, undefined, "-")}
              <button type="button" className="viewer-zoom-value" aria-label={`${zoomPercent(zoom)}，适应窗口`} title="适应窗口（0）" onClick={() => setZoom(fitted)}>{zoomPercent(zoom)}</button>
              {iconButton("放大", <ZoomIn className="size-4" />, () => setZoom((current) => zoomAt(current, current.scale * zoomStep)), zoom.scale >= 6, undefined, "+")}
              <button type="button" className="viewer-actual" aria-label="1:1 原始像素" title="原始像素（1）" aria-keyshortcuts="1" onClick={() => actual.current?.()}>1:1</button>
            </div>}
            {target && <button type="button" className="viewer-pill max-sm:px-2.5" aria-pressed={info} title="这一项的信息（I）" aria-keyshortcuts="I" onClick={() => setInfo((value) => !value)}><Info className="size-3.5" /><span className="max-sm:sr-only">信息</span></button>}
            {canFullscreen && iconButton(fullscreen ? "退出全屏" : "全屏", fullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />, toggleFullscreen, false, "max-sm:hidden", "F")}
            {download && target && iconButton(download.enabled ? "下载" : download.reason || "来源未开放下载", controller.pendingDownload ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : <Download className="size-4" />, () => void controller.download(target), !download.enabled || controller.pendingDownload)}
            {onDetails && shownKey && <button type="button" className="viewer-pill max-sm:px-2.5" title={detailsLabel} onClick={() => onDetails(shownKey)}><PanelRightOpen className="size-3.5" /><span className="max-sm:sr-only">{detailsLabel}</span></button>}
            <Dialog.Close asChild>{iconButton("关闭预览", <X className="size-[18px]" />, () => {})}</Dialog.Close>
          </div>
        </header>
        <div className="viewer-body" data-info={info && target ? "true" : undefined}>
          <div className="viewer-stage" data-compare={pinned ? true : undefined} data-origin={grow ? "true" : undefined} style={grow ? { "--grow-x": `${grow.x}px`, "--grow-y": `${grow.y}px`, "--grow-scale": grow.scale } as CSSProperties : undefined}>
            {/* A sits outside the keyed slide wrapper, so stepping B never remounts it. */}
            {pinned && <figure className="viewer-pane" data-pane="a">
              <img src={pinned.src} alt={`对比 A：${pinned.title}`} className="viewer-pane-image" onLoad={() => setPinned((current) => current && !current.loaded ? { ...current, loaded: true } : current)} onError={() => setPinned(null)} />
              <figcaption className="viewer-pane-label"><span className="viewer-pane-tag">A</span><span className="truncate">{pinned.title}</span></figcaption>
            </figure>}
            <div key={shownKey || "empty"} className="viewer-media" data-direction={direction} data-pending={pendingKey !== null && pendingKey !== currentKey ? true : undefined}>{comparePane || body}</div>
            {iconButton("上一项", <ChevronLeft className="size-6" />, () => go(-1), !canStep(-1), "viewer-nav viewer-nav-prev")}
            {iconButton("下一项", <ChevronRight className="size-6" />, () => go(1), !canStep(1), "viewer-nav viewer-nav-next")}
          </div>
          {info && target && <ViewerInfo entry={target} kind={kind} onClose={() => setInfo(false)} />}
        </div>
        {slides.length > 1 && <ViewerStrip slides={slides} current={shownKey} pinned={pinned?.key ?? null} eligible={eligible} onPick={goTo} />}
        <footer className="viewer-foot">
          <span role="status" className={stepError ? "viewer-alert" : "sr-only"}>{stepError && `没能打开这一项：${stepError}`}</span>
          {!stepError && <>
            <span className="max-sm:hidden">{pinned ? "← → 换右边的 B · Esc 结束对比" : `← → 切换${zoomable ? " · 滚轮或双击缩放，拖动平移 · 1 原始像素" : ""} · I 信息${canFullscreen ? " · F 全屏" : ""} · Esc 关闭`}</span>
            <span className="sm:hidden">{position.label ? `${position.label} · 左右滑动切换，下拉关闭` : "预览"}</span>
          </>}
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
