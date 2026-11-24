import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, LockKeyhole, Maximize2, Minimize2, Pin, PinOff, X } from "../icons";
import { cx, rowButton } from "./ui";
import { prefersReducedMotion, scrollBehavior } from "../shared/motion/reduced";
import { useInspectorWidth } from "../app/preferences";
import { useSlidingIndicator } from "../app/use-sliding-indicator";
import { draggedInspectorWidth, inspectorWidthLimits, inspectorWidthValue, keyedInspectorWidth, shownInspectorWidth, snappedInspectorWidth } from "../shared/inspector-size";
import { releaseVelocity, sheetDragOffset, sheetRelease } from "../shared/sheet-drag";
import { chordTokens, inspectorStep, parseChord, stepFromEvent, stepText } from "../shared/keymap";
import { useKeymap } from "../app/keymap";
import { isTypingTarget } from "../shared/keyboard";
import { leaveAsGhost, type GhostExit } from "./panel-ghost";

export type InspectorMode = "fixed" | "floating";

export interface InspectorSection {
  id: string;
  label: string;
}

/** Previous and next item of the list the panel was opened from. A missing side is the end of the list. */
export interface InspectorStepper {
  /** What one item is called, for the buttons: 任务, 资源. */
  noun: string;
  previous?: () => void;
  next?: () => void;
  /** Where the item is in its list: 「3 / 40」. */
  position?: string;
}

interface InspectorShellProps {
  open: boolean;
  mode: InspectorMode;
  maximized: boolean;
  onModeChange: (mode: InspectorMode) => void;
  onMaximize: () => void;
  onClose: () => void;
  label: string;
  closeAriaLabel?: string;
  ariaLabel: string;
  dataAttribute: string;
  header: ReactNode;
  headerActions?: ReactNode;
  meta?: ReactNode;
  sections: InspectorSection[];
  footer: ReactNode;
  children: ReactNode;
  /**
   * Selector of the shown item's list entry. Closing returns focus to the opener while it sits in that entry,
   * otherwise to the entry's row button, so focus never falls to the page body.
   */
  returnFocus?: string;
  /** Previous and next item; `[` and `]` do the same while nothing is open above the panel. */
  stepper?: InspectorStepper;
  /** The item shown. Another item fades the body in from the top; the panel itself stays, and so does focus. */
  itemKey?: string;
  /** A section to open at (its `data-inspector-section` id), when the panel was opened for that part. */
  initialSection?: string | null;
  /**
   * Selector of the shown item's entry in the list beside the panel, when it differs from `returnFocus` (or there is
   * none). Stepping to another item scrolls that entry into view while the list is visible (docked or floating).
   */
  followRow?: string;
}

const scrimClass = "fade-in fixed inset-0 z-inspector-scrim bg-black/20 backdrop-blur-[1px] min-[1280px]:hidden";
const iconButton = "grid size-8 place-items-center rounded-[8px] text-muted hover:bg-panel-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-35";

/** A media query read on the first render too, so a wide screen never starts with one frame of the narrow layout. */
function useMedia(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** `html[data-inspector-docked]` / `[data-inspector-floating]` while a panel is open that way: the audio dock gives way. */
const held = { docked: 0, floating: 0 };
function holdLayout(layout: keyof typeof held) {
  held[layout] += 1;
  document.documentElement.setAttribute(`data-inspector-${layout}`, "");
  return () => {
    held[layout] -= 1;
    if (!held[layout]) document.documentElement.removeAttribute(`data-inspector-${layout}`);
  };
}

/**
 * The right-hand panel for one item. Three layouts by width: docked as a card 12px in from the edges (from 1280px; the
 * page keeps its column free), a drawer over the page (768–1279px, the scrim closes it) and a sheet from the bottom on
 * phones, dragged down by its top to close. Floating and maximized remain.
 */
export function InspectorShell({
  open,
  mode,
  maximized,
  onModeChange,
  onMaximize,
  onClose,
  label,
  closeAriaLabel = "关闭详情",
  ariaLabel,
  dataAttribute,
  header,
  headerActions,
  meta,
  sections,
  footer,
  children,
  returnFocus,
  stepper,
  itemKey,
  initialSection,
  followRow,
}: InspectorShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnRowRef = useRef<string | undefined>(undefined);
  const desktopDock = useMedia("(min-width: 1280px)");
  const tablet = useMedia("(min-width: 768px)");
  // Phones always get the sheet: a floating card there covers the list anyway, without a way back to it.
  const floating = mode === "floating" && tablet;
  const docked = desktopDock && !floating && !maximized;
  const sheet = !tablet && !maximized;
  const modal = maximized || (!docked && !floating);
  const [chosenWidth, setChosenWidth] = useInspectorWidth();
  const keymap = useKeymap();
  const maximizeKeys = keymap["inspector-maximize"] || [];

  useEffect(() => { if (open) returnRowRef.current = returnFocus; }, [open, returnFocus]);

  useEffect(() => {
    if (!open) return;
    // A click on a row's plain text leaves focus on the body, which is no place to return to.
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      // However the panel closed (close button, Escape, URL change), focus that fell to the body goes back to the row.
      requestAnimationFrame(() => {
        const current = document.activeElement;
        if (current && current !== document.body && current.isConnected) return;
        const item = returnRowRef.current ? document.querySelector<HTMLElement>(returnRowRef.current) : null;
        const opener = returnFocusRef.current?.isConnected ? returnFocusRef.current : null;
        const target = opener && (!item || item.contains(opener)) ? opener : item?.querySelector<HTMLElement>(rowButton) || opener;
        target?.focus({ preventScroll: true });
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open || !modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [modal, open]);

  // Drawer, sheet and maximized are modal: move focus inside and keep Tab cycling within the panel.
  useEffect(() => {
    if (!open || !modal) return;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modal, open]);

  useEffect(() => {
    if (!open) return;
    if (docked) return holdLayout("docked");
    if (floating) return holdLayout("floating");
  }, [docked, floating, open]);

  // Closing from the panel itself (its close button, Escape, the scrim, a drag) leaves a still copy that slides out; a
  // panel closed from elsewhere (Back, another page, signing out) just goes.
  const scrollTop = useRef(0);
  const leaving = useRef<{ offset?: number } | null>(null);
  const layout = useRef<{ exit: GhostExit; modal: boolean }>({ exit: "side", modal });
  layout.current = { exit: sheet ? "sheet" : maximized ? "maximized" : "side", modal };
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    leaving.current = null;
    return () => {
      const exit = leaving.current;
      leaving.current = null;
      if (exit && panel) leaveAsGhost(panel, { exit: layout.current.exit, scrim: layout.current.modal ? scrimClass : null, scrollTop: scrollTop.current, offset: exit.offset });
    };
  }, [open]);
  const leave = useCallback((offset?: number) => {
    const token = { offset };
    leaving.current = token;
    // A page that keeps the panel open after all does not leave a copy behind later.
    window.setTimeout(() => { if (leaving.current === token) leaving.current = null; }, 600);
    onClose();
  }, [onClose]);
  const close = useCallback(() => leave(), [leave]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A layer above (viewer, menu, sheet) already consumed this Escape; only the topmost surface closes.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (maximized) onMaximize();
      else close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, maximized, onMaximize, open]);

  const latestStepper = useRef(stepper);
  latestStepper.current = stepper;
  const stepping = !!stepper;
  useEffect(() => {
    if (!open || !stepping) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const delta = inspectorStep(stepFromEvent(event));
      if (!delta) return;
      // A dialog, sheet, menu or the viewer above the panel owns the keyboard.
      const panel = panelRef.current;
      if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')].some((layer) => layer !== panel && !panel?.contains(layer))) return;
      const go = delta < 0 ? latestStepper.current?.previous : latestStepper.current?.next;
      if (!go) return;
      event.preventDefault();
      go();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, stepping]);

  // The maximize key (M unless the account changed it), like the header button; phones have no maximized layout.
  const maximizeChord = maximizeKeys.join("|");
  useEffect(() => {
    if (!open || !tablet || !maximizeChord) return;
    const chords = maximizeChord.split("|");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isTypingTarget(event.target)) return;
      const step = stepFromEvent(event);
      if (!step || !chords.includes(stepText(step))) return;
      const panel = panelRef.current;
      if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')].some((layer) => layer !== panel && !panel?.contains(layer))) return;
      event.preventDefault();
      onMaximize();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximizeChord, onMaximize, open, tablet]);

  // The section being read (the last one whose top has reached the top of the body); null while at the top.
  const readingSection = useRef<string | null>(null);
  // After stepping: the section to return to once the next item has it, until the person scrolls or it times out.
  const keepSection = useRef<{ id: string; until: number } | null>(null);
  const followSelector = followRow ?? returnFocus;
  const listVisible = docked || floating;
  const follow = useRef({ selector: followSelector, visible: listVisible });
  follow.current = { selector: followSelector, visible: listVisible };

  // Another item: the body fades in, at the section that was being read when the next item has it and at the top
  // otherwise; header, buttons and focus stay where they are. The list beside the panel brings the item's row into view.
  const shownItem = useRef(itemKey);
  useLayoutEffect(() => {
    if (shownItem.current === itemKey) return;
    shownItem.current = itemKey;
    const body = bodyRef.current;
    if (!body) return;
    const reading = readingSection.current;
    keepSection.current = reading ? { id: reading, until: Date.now() + 1500 } : null;
    if (!reading || !scrollToSection(body, reading)) body.scrollTop = 0;
    scrollTop.current = body.scrollTop;
    const { selector, visible } = follow.current;
    if (selector && visible) requestAnimationFrame(() => followListRow(selector));
    if (typeof body.animate !== "function") return;
    const reduced = prefersReducedMotion();
    body.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], { duration: reduced ? 120 : 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  }, [itemKey]);

  // The next item's sections may arrive after it does: go to the kept one when it appears.
  useLayoutEffect(() => {
    const kept = keepSection.current;
    const body = bodyRef.current;
    if (!kept || !body) return;
    if (Date.now() > kept.until) { keepSection.current = null; return; }
    if (scrollToSection(body, kept.id)) { keepSection.current = null; scrollTop.current = body.scrollTop; }
  });

  // The phone sheet follows a drag on its top (not on its buttons) and closes when let go far or fast enough.
  const drag = useRef<{ id: number; y: number; offset: number; samples: { y: number; t: number }[] } | null>(null);
  const dragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (!sheet || (event.pointerType === "mouse" && event.button !== 0)) return;
    if ((event.target as Element).closest("button, a, input, select, textarea, [role='separator']")) return;
    drag.current = { id: event.pointerId, y: event.clientY, offset: 0, samples: [{ y: event.clientY, t: event.timeStamp }] };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    const panel = panelRef.current;
    if (!current || current.id !== event.pointerId || !panel) return;
    current.offset = sheetDragOffset(event.clientY - current.y);
    current.samples = [...current.samples.slice(-11), { y: event.clientY, t: event.timeStamp }];
    panel.style.transition = "none";
    panel.style.transform = `translateY(${current.offset}px)`;
  };
  const dragEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    const panel = panelRef.current;
    if (!current || current.id !== event.pointerId || !panel) return;
    drag.current = null;
    // The release point counts too: a finger that stopped before letting go is not a flick.
    const samples = [...current.samples, { y: event.clientY, t: event.timeStamp }];
    const release = event.type === "pointercancel" ? "settle" : sheetRelease(current.offset, releaseVelocity(samples), panel.getBoundingClientRect().height);
    if (release === "close" && current.offset > 0) { leave(current.offset); return; }
    panel.style.transition = prefersReducedMotion() ? "" : "transform var(--dur-normal) var(--ease-spring-soft)";
    panel.style.transform = "";
  };

  if (!open) return null;

  const position = maximized
    ? "fixed inset-0 z-inspector rounded-none border-0 inspector-maximized-in min-[1280px]:inset-auto min-[1280px]:bottom-3 min-[1280px]:left-[var(--workspace-left)] min-[1280px]:right-3 min-[1280px]:top-[calc(var(--topbar-height)+12px)] min-[1280px]:rounded-[20px] min-[1280px]:border min-[1280px]:shadow-float"
    : floating
      ? "fixed bottom-3 right-3 top-[calc(var(--topbar-height)+12px)] z-inspector w-[min(640px,calc(100vw-24px))] rounded-[20px] border shadow-float inspector-float-in"
      : sheet
        ? "fixed inset-x-0 bottom-0 top-[max(10px,env(safe-area-inset-top))] z-inspector rounded-t-[22px] border-t shadow-float inspector-sheet-in"
        // The drawer and the docked card share their place; from 1280 the card takes the chosen width and the page gives way.
        : cx("fixed bottom-3 right-3 top-[calc(var(--topbar-height)+12px)] z-inspector w-[min(520px,calc(100vw-24px))] rounded-[20px] border inspector-fixed-in min-[1280px]:w-[var(--inspector-width)]", docked ? "shadow-raised" : "shadow-float");

  return createPortal(<>
    {modal && <div className={scrimClass} aria-hidden="true" onClick={close} />}
    <aside
      ref={panelRef}
      tabIndex={-1}
      {...{ [dataAttribute]: mode }}
      {...{ [`${dataAttribute}-maximized`]: maximized ? "true" : undefined }}
      data-inspector-layout={maximized ? "maximized" : floating ? "floating" : sheet ? "sheet" : docked ? "docked" : "drawer"}
      role={docked ? "complementary" : "dialog"}
      aria-modal={modal ? true : undefined}
      aria-label={ariaLabel}
      className={cx("flex min-h-0 flex-col overflow-hidden border-line bg-panel text-ink outline-none", position)}
    >
      {docked && <ResizeHandle label={label} chosen={chosenWidth} onChange={setChosenWidth} />}
      <header
        className={cx("shrink-0 border-b border-line px-5 pb-3", sheet ? "touch-none pt-2" : maximized ? "pt-[max(16px,env(safe-area-inset-top))]" : "pt-4")}
        onPointerDown={dragStart}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onPointerCancel={dragEnd}
      >
        {sheet && <span aria-hidden="true" data-sheet-grabber className="mx-auto mb-2 block h-1 w-10 rounded-full bg-line-strong" />}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">{header}</div>
          <div className="flex shrink-0 items-center gap-1">
            {stepper && <Stepper stepper={stepper} />}
            {headerActions}
            <button type="button" className={cx(iconButton, "max-md:hidden")} onClick={() => onModeChange(floating ? "fixed" : "floating")} aria-label={floating ? `固定${label}侧栏` : `悬浮${label}侧栏`} title={floating ? "固定侧栏" : "悬浮侧栏"}>
              {floating ? <Pin className="size-4" /> : <PinOff className="size-4" />}
            </button>
            <button type="button" className={cx(iconButton, "max-md:hidden")} onClick={onMaximize} aria-label={maximized ? `还原${label}侧栏` : `最大化${label}侧栏`} aria-keyshortcuts={ariaShortcut(maximizeKeys[0])} title={`${maximized ? "还原" : "最大化"}${maximizeKeys[0] ? `（${chordTokens(maximizeKeys[0], "Ctrl").join("+")}）` : ""}`}>
              {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button type="button" className={iconButton} onClick={close} aria-label={closeAriaLabel} title="关闭">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {meta}
      </header>
      <InspectorOutline sections={sections} bodyRef={bodyRef} itemKey={itemKey} initialSection={initialSection} />
      <div ref={bodyRef} data-inspector-body data-task-inspector-body={dataAttribute === "data-task-inspector" ? "true" : undefined} onScroll={(event) => { scrollTop.current = event.currentTarget.scrollTop; readingSection.current = sectionAt(event.currentTarget); }} onWheel={() => { keepSection.current = null; }} onTouchMove={() => { keepSection.current = null; }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      <footer className="shrink-0 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {footer}
        <div className="mt-2 flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3 shrink-0" />状态来自 owner 观察；控制中心不会重投或改写原记录。</div>
      </footer>
    </aside>
  </>, document.body);
}

/** `aria-keyshortcuts` for a one-step chord: `M`, `Control+M`. */
function ariaShortcut(chord: string | undefined) {
  const step = chord ? parseChord(chord)?.[0] : undefined;
  return step ? [step.mod && "Control", step.shift && "Shift", step.key].filter(Boolean).join("+") : undefined;
}

/** Where a section starts inside the scrolling body, measured on screen so it holds whatever the offset parent is. */
function sectionTop(body: HTMLElement, section: HTMLElement) {
  return section.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
}

function sectionAt(body: HTMLElement): string | null {
  if (body.scrollTop < 24) return null;
  let current: string | null = null;
  for (const section of body.querySelectorAll<HTMLElement>("[data-inspector-section]")) {
    if (sectionTop(body, section) - body.scrollTop > 32) break;
    current = section.getAttribute("data-inspector-section");
  }
  return current;
}

/** Scroll the body to a section of the shown item; false when the item has no such section (yet). */
function scrollToSection(body: HTMLElement, id: string) {
  const target = body.querySelector<HTMLElement>(`[data-inspector-section="${CSS.escape(id)}"]`);
  if (!target) return false;
  body.scrollTop = Math.max(0, sectionTop(body, target) - 8);
  return true;
}

/** Bring the shown item's list entry into view, clear of the top bar and the audio dock; nothing moves if it is visible. */
function followListRow(selector: string) {
  const row = document.querySelector<HTMLElement>(selector);
  if (!row) return;
  const style = row.style;
  const before = { top: style.scrollMarginTop, bottom: style.scrollMarginBottom };
  style.scrollMarginTop = "calc(var(--topbar-height, 64px) + 12px)";
  style.scrollMarginBottom = "calc(var(--workspace-bottom, 0px) + 12px)";
  row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: scrollBehavior() });
  requestAnimationFrame(() => { style.scrollMarginTop = before.top; style.scrollMarginBottom = before.bottom; });
}

function Stepper({ stepper }: { stepper: InspectorStepper }) {
  return <span className="flex items-center gap-0.5" data-inspector-stepper>
    {stepper.position && <span className="tabular px-1 text-2xs text-muted max-sm:hidden">{stepper.position}</span>}
    <button type="button" className={iconButton} disabled={!stepper.previous} onClick={stepper.previous} aria-label={`上一个${stepper.noun}`} aria-keyshortcuts="[" title={`上一个${stepper.noun}（[）`}><ChevronLeft className="size-4" /></button>
    <button type="button" className={iconButton} disabled={!stepper.next} onClick={stepper.next} aria-label={`下一个${stepper.noun}`} aria-keyshortcuts="]" title={`下一个${stepper.noun}（]）`}><ChevronRight className="size-4" /></button>
  </span>;
}

/**
 * The docked card's left edge: drag it, or focus it and use ← and → (Shift for bigger steps), Home and End; Enter or a
 * double click goes back to the default width. While dragging only the CSS width changes; the width is saved on release.
 * Dragging close to the default width settles on it, and the width shows beside the edge while it changes.
 */
function ResizeHandle({ label, chosen, onChange }: { label: string; chosen: number | null; onChange: (width: number | null) => void }) {
  const [viewport, setViewport] = useState(() => document.documentElement.clientWidth);
  const [dragging, setDragging] = useState<number | null>(null);
  const [keyed, setKeyed] = useState(false);
  const keyedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(keyedTimer.current), []);
  const start = useRef<{ id: number; x: number; width: number } | null>(null);
  useEffect(() => {
    const update = () => setViewport(document.documentElement.clientWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const value = dragging ?? shownInspectorWidth(chosen, viewport);
  const limits = inspectorWidthLimits(viewport);
  const preset = shownInspectorWidth(null, viewport);
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    const begun = start.current;
    if (!begun || begun.id !== event.pointerId) return;
    start.current = null;
    setDragging(null);
    document.documentElement.removeAttribute("data-inspector-resizing");
    onChange(snappedInspectorWidth(dragging ?? begun.width, viewport).chosen);
  };
  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label={`调整${label}详情的宽度`}
    aria-valuenow={value}
    aria-valuemin={limits.min}
    aria-valuemax={limits.max}
    aria-valuetext={`${value} 像素`}
    tabIndex={0}
    data-inspector-resize
    title="拖动调整宽度，双击恢复默认"
    className="group absolute inset-y-5 left-0 z-10 w-2.5 cursor-col-resize touch-none rounded-full outline-none"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      start.current = { id: event.pointerId, x: event.clientX, width: value };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.documentElement.setAttribute("data-inspector-resizing", "");
      setDragging(value);
    }}
    onPointerMove={(event) => {
      const begun = start.current;
      if (!begun || begun.id !== event.pointerId) return;
      const { width } = snappedInspectorWidth(draggedInspectorWidth(begun.width, begun.x, event.clientX, viewport), viewport);
      setDragging(width);
      document.documentElement.style.setProperty("--inspector-width", inspectorWidthValue(width)!);
    }}
    onPointerUp={end}
    onPointerCancel={end}
    onDoubleClick={() => onChange(null)}
    onKeyDown={(event) => {
      const next = keyedInspectorWidth(value, event.key, event.shiftKey, viewport);
      if (next === undefined) return;
      event.preventDefault();
      onChange(next);
      setKeyed(true);
      window.clearTimeout(keyedTimer.current);
      keyedTimer.current = window.setTimeout(() => setKeyed(false), 1200);
    }}
    onBlur={() => setKeyed(false)}
  >
    <span aria-hidden="true" className="absolute inset-y-0 left-[3px] w-[3px] rounded-full bg-transparent transition-colors duration-150 group-hover:bg-line-strong group-focus-visible:bg-focus group-active:bg-accent" />
    {(dragging !== null || keyed) && <span aria-hidden="true" data-inspector-width-readout={value === preset ? "default" : ""} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-chip bg-ink px-2 py-0.5 text-2xs font-semibold text-canvas tabular shadow-panel">{value} px{value === preset ? " · 默认" : ""}</span>}
  </div>;
}

function InspectorOutline({ sections, bodyRef, itemKey, initialSection }: { sections: InspectorSection[]; bodyRef: RefObject<HTMLElement | null>; itemKey?: string; initialSection?: string | null }) {
  const [active, setActive] = useState(sections[0]?.id || "");
  // Opened for one part: the body starts there (once its content is in), and the outline marks it.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!initialSection || opened.current === initialSection) return;
    const root = bodyRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-inspector-section="${initialSection}"]`);
    if (!root || !target) return;
    opened.current = initialSection;
    root.scrollTo({ top: Math.max(0, sectionTop(root, target) - 8) });
    setActive(initialSection);
  });
  // Pages pass a new array on every render; only a change of the sections themselves starts the outline over.
  const ids = sections.map((section) => section.id).join("|");
  const latest = useRef(sections);
  latest.current = sections;

  useEffect(() => {
    const list = latest.current;
    setActive(list[0]?.id || "");
    const root = bodyRef.current;
    if (!root) return;
    const targets = list.map((section) => root.querySelector<HTMLElement>(`[data-inspector-section="${section.id}"]`)).filter((target): target is HTMLElement => Boolean(target));
    if (!targets.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const next = visible?.target.getAttribute("data-inspector-section");
      if (next) setActive(next);
    }, { root, rootMargin: "-24px 0px -65% 0px", threshold: [0, 0.2, 0.6] });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [bodyRef, ids, itemKey]);

  const { ref, ready, indicator } = useSlidingIndicator<HTMLElement>('[aria-current="location"]', `${active}|${ids}`, "rounded-[7px] bg-panel-sunken");
  if (!sections.length) return null;
  return <nav ref={ref} data-indicator-ready={ready ? "" : undefined} aria-label="详情区块" className="relative z-10 flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-panel px-5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {indicator}
    {sections.map((section) => <button
      key={section.id}
      type="button"
      aria-current={active === section.id ? "location" : undefined}
      onClick={() => {
        const root = bodyRef.current;
        const target = root?.querySelector<HTMLElement>(`[data-inspector-section="${section.id}"]`);
        if (!root || !target) return;
        setActive(section.id);
        root.scrollTo({ top: Math.max(0, sectionTop(root, target) - 8), behavior: scrollBehavior() });
        requestAnimationFrame(() => (target.querySelector<HTMLElement>("h2, h3, h4") || target).focus({ preventScroll: true }));
      }}
      className={cx("min-h-8 shrink-0 rounded-[7px] px-2.5 py-1.5 text-2xs font-medium text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-focus max-sm:min-h-10", !ready && "hover:bg-panel-sunken", active === section.id && "text-ink", active === section.id && !ready && "bg-panel-sunken")}
    >{section.label}</button>)}
  </nav>;
}
