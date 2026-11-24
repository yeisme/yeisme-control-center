import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface Box { x: number; y: number; width: number; height: number }

/**
 * A pill that sits behind the selected item of a list and slides when the selection moves. The list must be positioned
 * (`relative`); `selector` finds the selected item inside it; `version` changes when the selection does. The pill is
 * placed without a transition first and only slides afterwards, and it follows the item when its size changes.
 */
export function useSlidingIndicator<T extends HTMLElement>(selector: string, version: unknown, className: string): { ref: React.RefObject<T | null>; ready: boolean; indicator: ReactNode } {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const selected = root.querySelector<HTMLElement>(selector);
      if (!selected) { setBox(null); return; }
      const outer = root.getBoundingClientRect();
      const inner = selected.getBoundingClientRect();
      setBox((current) => {
        const next = { x: inner.left - outer.left + root.scrollLeft - root.clientLeft, y: inner.top - outer.top + root.scrollTop - root.clientTop, width: inner.width, height: inner.height };
        return current && current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height ? current : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const child of root.children) observer.observe(child);
    return () => observer.disconnect();
  }, [selector, version]);
  useLayoutEffect(() => {
    if (!box || ready) return;
    // The first placement is painted before transitions switch on.
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [box, ready]);
  const style: CSSProperties | undefined = box ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height } : undefined;
  return { ref, ready: ready && !!box, indicator: box ? <span aria-hidden="true" className={`slide-indicator ${className}`} style={style} /> : null };
}
