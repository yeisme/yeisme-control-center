/**
 * Pure helpers for the media viewer: zoom about a point, pan limits, swipe intent and slide stepping.
 * Coordinates are relative to the stage centre, so a fitted image sits at x = y = 0.
 */

export interface ZoomState { scale: number; x: number; y: number }
export interface Size { width: number; height: number }

export const fitted: ZoomState = { scale: 1, x: 0, y: 0 };
export const minZoom = 1;
export const maxZoom = 6;
export const zoomStep = 1.25;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Zooms to `scale` keeping the image point under `point` fixed on screen; back at 1 it recentres. */
export function zoomAt(state: ZoomState, scale: number, point = { x: 0, y: 0 }): ZoomState {
  const next = clamp(Number.isFinite(scale) ? scale : 1, minZoom, maxZoom);
  if (next === minZoom) return fitted;
  const ratio = next / state.scale;
  return { scale: next, x: point.x - ratio * (point.x - state.x), y: point.y - ratio * (point.y - state.y) };
}

/** Keeps a zoomed image covering the stage: it may move only by the part that overflows. */
export function clampPan(state: ZoomState, content: Size, stage: Size): ZoomState {
  const maxX = Math.max(0, (content.width * state.scale - stage.width) / 2);
  const maxY = Math.max(0, (content.height * state.scale - stage.height) / 2);
  return { scale: state.scale, x: clamp(state.x, -maxX, maxX), y: clamp(state.y, -maxY, maxY) };
}

/** Double-click / double-tap: fitted images zoom in at the pointer, zoomed images return to fit. */
export function toggleZoom(state: ZoomState, point: { x: number; y: number }, target = 2.5): ZoomState {
  return state.scale > 1 ? fitted : zoomAt(state, target, point);
}

export function zoomPercent(state: ZoomState) {
  return `${Math.round(state.scale * 100)}%`;
}

/** A horizontal swipe navigates: left goes forward (+1), right goes back (-1); short or vertical drags do nothing. */
export function swipeIntent(dx: number, dy: number, threshold = 56): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
  return dx < 0 ? 1 : -1;
}

/** Neighbouring slide key in reading order; the viewer stops at both ends instead of wrapping. */
export function stepSlide<T extends { key: string }>(slides: T[], key: string | null, direction: -1 | 1): string | null {
  const index = key === null ? -1 : slides.findIndex((slide) => slide.key === key);
  if (index < 0) return null;
  return slides[index + direction]?.key ?? null;
}

/** Like `stepSlide`, but walks past slides that fail `eligible`; comparing only steps between other images. */
export function stepWhere<T extends { key: string }>(slides: T[], key: string | null, direction: -1 | 1, eligible: (slide: T) => boolean): string | null {
  const start = key === null ? -1 : slides.findIndex((slide) => slide.key === key);
  if (start < 0) return null;
  for (let index = start + direction; index >= 0 && index < slides.length; index += direction) if (eligible(slides[index])) return slides[index].key;
  return null;
}

export function slidePosition<T extends { key: string }>(slides: T[], key: string | null) {
  const index = key === null ? -1 : slides.findIndex((slide) => slide.key === key);
  return { index, total: slides.length, label: index < 0 ? "" : `${index + 1} / ${slides.length}` };
}
