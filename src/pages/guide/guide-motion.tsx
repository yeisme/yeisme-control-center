import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "../../components/ui/cx";

/**
 * Scroll and story motion for the guide, after elayadesign/ai-design-skills: sections rise and resolve
 * from blur once when ~30% visible, visuals loop only while on screen, reduced motion shows final states.
 */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Flips to true once the element is about 30% visible; reveals never replay on scroll back. */
export function useRevealOnce<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion()) { setShown(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setShown(true); observer.disconnect(); }
    }, { threshold });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, threshold]);
  return [ref, shown] as const;
}

/** True while any part of the element is on screen, so story loops stop costing frames off screen. */
export function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, visible] as const;
}

type RevealKind = "up" | "card" | "fade";

export function Reveal({ kind = "up", delay = 0, className, children, as: Tag = "div", id }: { kind?: RevealKind; delay?: number; className?: string; children: ReactNode; as?: "div" | "section" | "li" | "article" | "figure"; id?: string }) {
  const [ref, shown] = useRevealOnce<HTMLElement>();
  return <Tag ref={ref as never} id={id} data-reveal={kind} data-shown={shown || undefined} className={className} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>{children}</Tag>;
}

/** Tagline whose words light up one at a time as they cross a line about two thirds down the viewport. */
export function TaglineReveal({ words, className }: { words: string[]; className?: string }) {
  const host = useRef<HTMLParagraphElement>(null);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion()) { setLit(words.length); return; }
    const spans = [...node.querySelectorAll<HTMLElement>("[data-word]")];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number((entry.target as HTMLElement).dataset.word);
        setLit((current) => Math.max(current, index + 1));
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -34% 0px" });
    for (const span of spans) observer.observe(span);
    return () => observer.disconnect();
  }, [words.length]);
  // Screen readers get the sentence once; the animated word spans are presentation only.
  return <p ref={host} className={cx("guide-tagline", className)}>
    <span className="sr-only">{words.join("")}</span>
    {words.map((word, index) => <span key={index} aria-hidden="true" data-word={index} data-lit={index < lit || undefined}>{word}</span>)}
  </p>;
}

/**
 * Loop clock for a story visual: advances only while running and visible, wraps at `cycle` ms and
 * renders at most ~30 times a second. Reduced motion pins it to the resting frame.
 */
export function useLoopClock(cycle: number, running: boolean, rest: number) {
  const reduced = prefersReducedMotion();
  const [time, setTime] = useState(reduced ? rest : 0);
  const elapsed = useRef(0);
  useEffect(() => {
    if (!running || reduced) return;
    let frame = 0;
    let last = performance.now();
    let shown = -1;
    const tick = (now: number) => {
      elapsed.current = (elapsed.current + Math.min(64, now - last)) % cycle;
      last = now;
      const step = Math.floor(elapsed.current / 33);
      if (step !== shown) { shown = step; setTime(elapsed.current); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cycle, reduced, running]);
  return reduced ? rest : time;
}

/** Characters of `text` typed by time `t`, starting at `start`, one glyph per `perChar` ms. */
export function typed(text: string, t: number, start: number, perChar: number) {
  if (t <= start) return "";
  return text.slice(0, Math.min(text.length, Math.floor((t - start) / perChar)));
}
