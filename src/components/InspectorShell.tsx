import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { LockKeyhole, Maximize2, Minimize2, Pin, PinOff, X } from "../icons";
import { cx } from "./ui";

export type InspectorMode = "fixed" | "floating";

export interface InspectorSection {
  id: string;
  label: string;
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
}

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
}: InspectorShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [desktopDock, setDesktopDock] = useState(false);
  const floating = mode === "floating";
  const docked = desktopDock && !floating && !maximized;
  const modal = maximized || (!docked && !floating);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => setDesktopDock(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [docked, floating, maximized, open]);

  const close = useCallback(() => {
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (maximized) onMaximize();
      else close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, maximized, onMaximize, open]);

  if (!open) return null;

  const position = maximized
    ? "fixed inset-0 z-[55] w-auto rounded-none border-x-0 border-b-0 inspector-maximized-in min-[1280px]:bottom-0 min-[1280px]:left-[var(--workspace-left)] min-[1280px]:right-0 min-[1280px]:top-[var(--topbar-height)]"
    : floating
      ? "fixed bottom-3 right-3 top-[calc(var(--topbar-height)+0.75rem)] z-[55] w-[min(640px,calc(100vw-24px))] rounded-[16px] inspector-float-in"
      : "fixed inset-0 z-[55] min-[768px]:bottom-0 min-[768px]:left-auto min-[768px]:right-0 min-[768px]:top-[var(--topbar-height)] min-[768px]:h-[calc(100dvh-var(--topbar-height))] min-[768px]:w-[min(520px,calc(100vw-24px))] min-[1280px]:w-[var(--inspector-width)] min-[1280px]:rounded-none min-[1280px]:border-y-0 min-[1280px]:border-r-0 inspector-fixed-in";

  return createPortal(<>
    <div className="fixed inset-0 z-[54] bg-black/20 backdrop-blur-[1px] min-[1280px]:hidden" aria-hidden="true" />
    <aside
      {...{ [dataAttribute]: mode }}
      {...{ [`${dataAttribute}-maximized`]: maximized ? "true" : undefined }}
      role={docked ? "complementary" : "dialog"}
      aria-modal={modal ? true : undefined}
      aria-label={ariaLabel}
      className={cx(
        "flex min-h-0 flex-col overflow-hidden border border-line bg-panel text-ink shadow-float outline-none min-[1280px]:border-l",
        position,
      )}
    >
      <header className="shrink-0 border-b border-line px-5 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">{header}</div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <button type="button" className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-panel-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus" onClick={() => onModeChange(floating ? "fixed" : "floating")} aria-label={floating ? `固定${label}侧栏` : `悬浮${label}侧栏`} title={floating ? "固定侧栏" : "悬浮侧栏"}>
              {floating ? <Pin className="size-4" /> : <PinOff className="size-4" />}
            </button>
            <button type="button" className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-panel-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus" onClick={onMaximize} aria-label={maximized ? `还原${label}侧栏` : `最大化${label}侧栏`} title={maximized ? "还原" : "最大化"}>
              {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button type="button" className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-panel-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus" onClick={close} aria-label={closeAriaLabel} title="关闭">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {meta}
      </header>
      <InspectorOutline sections={sections} bodyRef={bodyRef} />
      <div ref={bodyRef} data-inspector-body data-task-inspector-body={dataAttribute === "data-task-inspector" ? "true" : undefined} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      <footer className="shrink-0 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {footer}
        <div className="mt-2 flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3 shrink-0" />状态来自 owner 观察；控制中心不会重投或改写原记录。</div>
      </footer>
    </aside>
  </>, document.body);
}

function InspectorOutline({ sections, bodyRef }: { sections: InspectorSection[]; bodyRef: RefObject<HTMLElement | null> }) {
  const [active, setActive] = useState(sections[0]?.id || "");

  useEffect(() => {
    setActive(sections[0]?.id || "");
    const root = bodyRef.current;
    if (!root) return;
    const targets = sections.map((section) => root.querySelector<HTMLElement>(`[data-inspector-section="${section.id}"]`)).filter((target): target is HTMLElement => Boolean(target));
    if (!targets.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const next = visible?.target.getAttribute("data-inspector-section");
      if (next) setActive(next);
    }, { root, rootMargin: "-24px 0px -65% 0px", threshold: [0, 0.2, 0.6] });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [bodyRef, sections]);

  return <nav aria-label="详情区块" className="sticky top-0 z-10 flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-panel px-5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {sections.map((section) => <button
      key={section.id}
      type="button"
      aria-current={active === section.id ? "location" : undefined}
      onClick={() => {
        const root = bodyRef.current;
        const target = root?.querySelector<HTMLElement>(`[data-inspector-section="${section.id}"]`);
        if (!root || !target) return;
        setActive(section.id);
        root.scrollTo({ top: Math.max(0, target.offsetTop - 8), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        requestAnimationFrame(() => (target.querySelector<HTMLElement>("h2, h3, h4") || target).focus({ preventScroll: true }));
      }}
      className={cx("min-h-8 shrink-0 rounded-[7px] px-2.5 py-1.5 text-2xs font-medium text-muted transition-colors hover:bg-panel-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus max-sm:min-h-10", active === section.id && "bg-panel-sunken text-ink")}
    >{section.label}</button>)}
  </nav>;
}
