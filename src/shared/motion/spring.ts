/**
 * A critically damped spring as a CSS `linear()` easing: it settles without overshooting, so nothing bounces, and it
 * starts fast, so a moving indicator reads as following the pointer. `omega` is the spring's stiffness over the
 * animation's length; at 9 the curve is within 0.1% of its end by the last sample.
 */
export function criticalSpringPoints(omega = 9, samples = 24): number[] {
  const points: number[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    points.push(index === samples ? 1 : 1 - (1 + omega * t) * Math.exp(-omega * t));
  }
  return points;
}

export const linearEasing = (points: readonly number[]) => `linear(${points.map((value) => Number(value.toFixed(4))).join(", ")})`;

/** The curve the stylesheet uses for `--ease-spring-soft`. */
export const springSoft = linearEasing(criticalSpringPoints());
