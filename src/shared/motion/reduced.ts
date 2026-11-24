/**
 * Whether motion should be reduced: the device setting first (`html[data-motion]`, set before the first paint), then the
 * system's preference. `full` is an explicit choice on this device and wins over the system.
 */
export function prefersReducedMotion(root: { dataset?: DOMStringMap } | null = typeof document === "undefined" ? null : document.documentElement, media: ((query: string) => { matches: boolean }) | undefined = typeof window === "undefined" ? undefined : window.matchMedia?.bind(window)): boolean {
  const chosen = root?.dataset?.motion;
  if (chosen === "reduced") return true;
  if (chosen === "full") return false;
  return media?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** `smooth` unless motion is reduced. */
export const scrollBehavior = (): ScrollBehavior => prefersReducedMotion() ? "auto" : "smooth";
