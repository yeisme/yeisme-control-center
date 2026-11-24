/** The media viewer's touch and pointer gestures as plain rules. Offsets are CSS pixels; time is milliseconds. */

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

/** Past the first or the last item a drag still follows, less and less, and never beyond `limit`. */
export function rubberBand(offset: number, limit = 72): number {
  if (!Number.isFinite(offset) || offset === 0) return 0;
  const distance = Math.abs(offset);
  return Math.sign(offset) * limit * distance / (distance + limit);
}

/** Which way a drag goes once it has moved 8 px: sideways steps between items, down may close the viewer. */
export function dragAxis(dx: number, dy: number, slop = 8): "x" | "y" | null {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
}

/** A pull down closes past 120 px, or on a flick (0.6 px/ms) past 40 px. */
export function dismissIntent(dy: number, velocity: number): boolean {
  return dy >= 120 || (dy >= 40 && velocity >= 0.6);
}

/** How visible the picture stays while pulled down: fully at rest, half at 240 px and beyond. */
export function pullOpacity(dy: number): number {
  return Math.max(0.5, 1 - Math.max(0, dy) / 480);
}

/** Two fingers: the scale follows their distance, within the zoom range. */
export function pinchScale(startScale: number, startDistance: number, distance: number, min = 1, max = 6): number {
  if (!(startDistance > 0) || !Number.isFinite(distance)) return startScale;
  return Math.min(max, Math.max(min, startScale * distance / startDistance));
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** 1:1, where one image pixel is one screen pixel. Never below fit: fit never enlarges a small picture. */
export function actualPixels(natural: { width: number; height: number }, fitted: { width: number; height: number }, max = 6): number {
  if (!(fitted.width > 0) || !(natural.width > 0)) return 1;
  return Math.min(max, Math.max(1, natural.width / fitted.width));
}

/** The speed of a pan as it was let go: px/ms over its last 80 ms. */
export function panVelocity(samples: readonly (Point & { t: number })[]): Point {
  const last = samples[samples.length - 1];
  if (!last || samples.length < 2) return { x: 0, y: 0 };
  const first = samples.find((sample) => last.t - sample.t <= 80) ?? samples[0]!;
  const elapsed = last.t - first.t;
  return elapsed > 0 ? { x: (last.x - first.x) / elapsed, y: (last.y - first.y) / elapsed } : { x: 0, y: 0 };
}

/** The glide after a pan slows by a constant fraction per 16 ms frame, whatever the frame rate. */
export function coastSpeed(speed: Point, elapsed: number, decay = 0.92): Point {
  const factor = Math.pow(decay, Math.max(0, elapsed) / 16);
  return { x: speed.x * factor, y: speed.y * factor };
}

/** Two taps within 300 ms and 24 px. */
export function isDoubleTap(previous: (Point & { t: number }) | null, next: Point & { t: number }): boolean {
  return !!previous && next.t - previous.t <= 300 && distance(previous, next) <= 24;
}

/** Where the viewer grows from: the card's centre against the screen's, and its width against most of the screen. */
export function originTransform(card: Box, viewport: { width: number; height: number }): { x: number; y: number; scale: number } {
  const scale = Math.min(0.9, Math.max(0.08, card.width / (viewport.width * 0.8)));
  return { x: Math.round(card.x + card.width / 2 - viewport.width / 2), y: Math.round(card.y + card.height / 2 - viewport.height / 2), scale: Number(scale.toFixed(3)) };
}
