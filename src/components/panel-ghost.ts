import { prefersReducedMotion } from "../shared/motion/reduced";

export type GhostExit = "side" | "sheet" | "maximized" | "viewer";

const easing = "cubic-bezier(0.4, 0, 1, 1)";
/** Each layout leaves toward where it came from: a side panel to the right, a sheet down, the viewer in place. */
const exits: Record<GhostExit, string> = { side: "translateX(12px)", sheet: "translateY(24px)", maximized: "translateY(8px)", viewer: "scale(0.98)" };
const media = "video, audio, iframe, object, embed, canvas";
const kept = new Set(["class", "style", "src", "srcset", "alt", "width", "height", "viewBox", "d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "xmlns", "points", "cx", "cy", "r", "x", "y", "x1", "x2", "y1", "y2", "rx", "ry", "transform", "opacity"]);

/**
 * A closing panel leaves as a still copy that slides toward where it came from and fades, so the page is free at once.
 * The copy is inert, hidden from assistive tech and keeps only what draws it: no ids, names, roles, links or data
 * attributes, so nothing finds it, focuses it or reads it. Video and frames in it are dropped rather than loaded again,
 * and an image that had not loaded yet stays empty.
 */
export function leaveAsGhost(panel: HTMLElement, options: { exit: GhostExit; scrim: string | null; scrollTop: number; offset?: number; shrink?: { selector: string; to: { x: number; y: number; scale: number } } }) {
  if (typeof document === "undefined" || typeof panel.animate !== "function") return;
  const reduced = prefersReducedMotion();
  const duration = reduced ? 120 : options.offset ? 200 : 160;
  const scrim = options.scrim ? Object.assign(document.createElement("div"), { className: options.scrim }) : null;
  scrim?.setAttribute("aria-hidden", "true");
  if (scrim) scrim.style.pointerEvents = "none";

  const copy = panel.cloneNode(true) as HTMLElement;
  const body = copy.querySelector<HTMLElement>("[data-inspector-body]");
  const images = [...panel.querySelectorAll("img")];
  copy.querySelectorAll("img").forEach((image, index) => {
    if (images[index]?.complete) return;
    image.removeAttribute("src");
    image.removeAttribute("srcset");
  });
  copy.querySelectorAll(media).forEach((element) => element.replaceWith(Object.assign(document.createElement("div"), { className: element.getAttribute("class") || "" })));
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
    for (const name of element.getAttributeNames()) if (!kept.has(name)) element.removeAttribute(name);
  }
  copy.setAttribute("inert", "");
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("data-panel-ghost", "");
  copy.style.pointerEvents = "none";

  if (scrim) document.body.append(scrim);
  document.body.append(copy);
  if (body) body.scrollTop = options.scrollTop;
  const remove = () => { copy.remove(); scrim?.remove(); };

  const from = options.offset ? `translateY(${options.offset}px)` : "none";
  const to = reduced ? from : options.offset ? "translateY(100%)" : exits[options.exit];
  const frames: Keyframe[] = options.offset && !reduced
    ? [{ transform: from, opacity: 1 }, { transform: to, opacity: 0.6 }]
    : [{ transform: from, opacity: 1 }, { transform: to, opacity: 0 }];
  // Shrinking back to where it came from, the copy only fades; the part that moves carries the motion.
  const part = options.shrink && !reduced ? copy.querySelector<HTMLElement>(options.shrink.selector) : null;
  if (part && options.shrink) {
    const { x, y, scale } = options.shrink.to;
    part.animate([{ transform: "none" }, { transform: `translate(${x}px, ${y}px) scale(${scale})` }], { duration: 220, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
  }
  const animation = copy.animate(part ? [{ opacity: 1 }, { opacity: 0 }] : frames, { duration: part ? 220 : duration, easing, fill: "forwards" });
  scrim?.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing, fill: "forwards" });
  animation.finished.then(remove, remove);
  // A tab in the background may never run the animation; the copy goes regardless.
  window.setTimeout(remove, duration + 400);
}
