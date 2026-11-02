import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const css = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
const layout = readFileSync(join(root, "src/components/ui/Layout.tsx"), "utf8");

/** The custom properties of one theme block: `:root { ... }` for light, the `[data-theme="dark"]` block for dark. */
function tokens(block: "light" | "dark") {
  const start = block === "light" ? css.indexOf(":root") : css.indexOf('[data-theme="dark"]');
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [match[1], match[2]]));
}
const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const channel = (value: number) => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
const luminance = (color: number[]) => 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
const contrast = (a: number[], b: number[]) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };
const blend = (under: number[], over: number[], alpha: number) => under.map((value, at) => Math.round(value * (1 - alpha) + over[at] * alpha));

/** The notice's own text colour and background, as `noticeTones` pairs them. */
const tones = ["neutral", "warning", "info", "danger", "review"] as const;
const pair = (theme: Record<string, string>, tone: (typeof tones)[number]) => tone === "neutral" ? { text: theme["ink-soft"], background: theme["panel-soft"] } : { text: theme[tone], background: theme[`${tone}-soft`] };

describe("a button in a notice keeps its label readable while it is hovered", () => {
  const className = /export function NoticeAction[\s\S]*?className="([^"]+)"/.exec(layout)?.[1] ?? "";
  const hover = /hover:bg-panel\/(\d+)/.exec(className);

  it("lifts its background toward the panel colour, never tints it with the label's own colour", () => {
    expect(className).not.toMatch(/hover:bg-current/);
    expect(hover, className).not.toBeNull();
    expect(Number(hover![1])).toBeGreaterThanOrEqual(40);
  });

  for (const theme of ["light", "dark"] as const) {
    it(`reads at 4.5:1 or better on every tone of the ${theme} theme, hovered or not`, () => {
      const values = tokens(theme);
      const alpha = Number(hover?.[1] ?? 0) / 100;
      for (const tone of tones) {
        const { text, background } = pair(values, tone);
        expect(text && background, `${theme} ${tone} tokens`).toBeTruthy();
        const at = (color: number[]) => contrast(rgb(text), color);
        expect(at(rgb(background)), `${theme} ${tone} at rest`).toBeGreaterThanOrEqual(4.5);
        expect(at(blend(rgb(background), rgb(values.panel), alpha)), `${theme} ${tone} hovered`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("is the check that the old tint would have failed: 10% of the label colour over the light warning notice is 4.3:1", () => {
    const values = tokens("light");
    const { text, background } = pair(values, "warning");
    expect(contrast(rgb(text), blend(rgb(background), rgb(text), 0.1))).toBeLessThan(4.5);
  });
});
