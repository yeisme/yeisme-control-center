/**
 * Dragging the phone sheet down by its top. It follows the finger down; pulled up it gives a little and stops, since it
 * already fills the screen. Let go far enough down, or fast enough, and it closes; otherwise it settles back.
 */
export const sheetClose = { distance: 140, velocity: 0.5, flick: 24 } as const;

export function sheetDragOffset(dy: number): number {
  if (!Number.isFinite(dy)) return 0;
  return dy >= 0 ? dy : -Math.min(24, Math.sqrt(-dy) * 2);
}

/** Close at 140 px down (a quarter of a shorter sheet, at least 48), or on a downward flick of 0.5 px/ms past 24 px. */
export function sheetRelease(offset: number, velocity: number, height: number): "close" | "settle" {
  const distance = Math.min(sheetClose.distance, Math.max(48, height * 0.25));
  if (offset >= distance) return "close";
  if (velocity >= sheetClose.velocity && offset >= sheetClose.flick) return "close";
  return "settle";
}

/** Downward speed in px/ms over the last 80 ms of the drag. */
export function releaseVelocity(samples: readonly { y: number; t: number }[]): number {
  const last = samples[samples.length - 1];
  if (!last || samples.length < 2) return 0;
  const first = samples.find((sample) => last.t - sample.t <= 80) ?? samples[0]!;
  const elapsed = last.t - first.t;
  return elapsed > 0 ? (last.y - first.y) / elapsed : 0;
}
