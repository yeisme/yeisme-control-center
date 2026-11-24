import { useEffect, useState, type AnimationEvent } from "react";

/**
 * A page's entrance plays once, when it mounts. The class comes off when it has played, so closing a panel later never
 * plays it again, and the finished animation does not keep the page a containing block for the panels fixed inside it.
 */
export function usePageEnter(enabled = true) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDone(true), 600);
    return () => window.clearTimeout(timer);
  }, []);
  return {
    className: enabled && !done ? "page-enter" : undefined,
    onAnimationEnd: (event: AnimationEvent<HTMLElement>) => { if (event.target === event.currentTarget) setDone(true); },
  };
}
