import { inspectorWidthRange } from "./preferences";

/**
 * The docked Inspector's width. By default it follows the window (`clamp(400px, 34vw, 520px)`, `--inspector-width` in
 * tokens.css). A person can drag or key it anywhere from 400 to 720 px, and the page beside it always keeps 480 px, so on
 * a 1280 screen it stops at 712.
 */
export const pageKeeps = 480;
/** The navigation column the page starts after (`--rail-width`). */
export const railWidth = 88;
export const widthSteps = { normal: 16, large: 64 } as const;

export function defaultInspectorWidth(viewport: number): number {
  return Math.round(Math.min(520, Math.max(inspectorWidthRange.min, viewport * 0.34)));
}

export function inspectorWidthLimits(viewport: number): { min: number; max: number } {
  const { min, max } = inspectorWidthRange;
  return { min, max: Math.max(min, Math.min(max, Math.floor(viewport - railWidth - pageKeeps))) };
}

const within = (value: number, viewport: number) => {
  const { min, max } = inspectorWidthLimits(viewport);
  return Math.min(max, Math.max(min, Math.round(value)));
};

/** The width the panel has: the chosen one within the limits, or the default. */
export function shownInspectorWidth(chosen: number | null, viewport: number): number {
  return within(chosen ?? defaultInspectorWidth(viewport), viewport);
}

/**
 * What a key does on the resize handle, which sits on the panel's left edge: ← widens and → narrows (16 px, or 64 with
 * Shift), Home and End go to the narrowest and the widest, Enter goes back to the default (null). Undefined: not a key
 * the handle takes.
 */
export function keyedInspectorWidth(current: number, key: string, shift: boolean, viewport: number): number | null | undefined {
  const step = shift ? widthSteps.large : widthSteps.normal;
  if (key === "ArrowLeft") return within(current + step, viewport);
  if (key === "ArrowRight") return within(current - step, viewport);
  if (key === "Home") return inspectorWidthLimits(viewport).min;
  if (key === "End") return inspectorWidthLimits(viewport).max;
  if (key === "Enter") return null;
  return undefined;
}

/** The width while the handle is dragged: the edge follows the pointer, within the limits. */
export function draggedInspectorWidth(start: number, startX: number, x: number, viewport: number): number {
  return within(start + startX - x, viewport);
}

/**
 * `--inspector-width` for a chosen width; null keeps the default from tokens.css. The value still gives the page its
 * 480 px when the window narrows later.
 */
export function inspectorWidthValue(chosen: number | null): string | null {
  if (chosen === null || !Number.isFinite(chosen)) return null;
  const { min } = inspectorWidthRange;
  return `clamp(${min}px, ${Math.round(chosen)}px, max(${min}px, calc(100vw - ${railWidth + pageKeeps}px)))`;
}

/** Within this many pixels of the default width a drag settles on the default. */
export const snapDistance = 12;

/**
 * The width a drag shows and saves: the dragged one, or the default when it comes within `snapDistance` of it. Null when
 * it settled on the default, so the panel goes back to following the window.
 */
export function snappedInspectorWidth(width: number, viewport: number): { width: number; chosen: number | null } {
  const preset = shownInspectorWidth(null, viewport);
  return Math.abs(width - preset) <= snapDistance ? { width: preset, chosen: null } : { width, chosen: width };
}
