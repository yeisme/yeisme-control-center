import { describe, expect, it } from "vitest";
import { criticalSpringPoints, linearEasing, springSoft } from "../src/shared/motion/spring";
import { badgeText, entryBadgeCount } from "../src/shared/nav-badges";

describe("the soft spring", () => {
  it("starts at 0, ends at 1 and never overshoots or turns back", () => {
    const points = criticalSpringPoints();
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]!).toBeGreaterThanOrEqual(points[index - 1]!);
      expect(points[index]!).toBeLessThanOrEqual(1);
    }
    // Most of the way there in the first third: a slide reads as following the selection.
    expect(points[8]!).toBeGreaterThan(0.75);
  });

  it("is the curve the stylesheet uses", async () => {
    expect(linearEasing([0, 0.5, 1])).toBe("linear(0, 0.5, 1)");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/styles/motion.css", "utf8")).toContain(springSoft);
  });
});

describe("navigation badges", () => {
  it("adds up an entry's pages", () => {
    const badgeOf = (page: string) => page === "reminders" ? 3 : page === "review" ? 2 : 0;
    expect(entryBadgeCount("activity", badgeOf)).toBe(3);
    expect(entryBadgeCount("works", badgeOf)).toBe(2);
    expect(entryBadgeCount("today", badgeOf)).toBe(0);
    expect(badgeText(120)).toBe("99+");
  });
});

describe("navigation entries", () => {
  it("has five entries for making things and two for wiring, one settings entry, and every page in exactly one", async () => {
    const { navEntries, navItems, phoneEntries, entryOf } = await import("../src/app-shell/navigation");
    expect(navEntries.map((entry) => `${entry.group}:${entry.id}`)).toEqual(["make:today", "make:projects", "make:create", "make:works", "make:activity", "setup:connect", "setup:settings"]);
    for (const item of navItems) expect(navEntries.some((entry) => entry.id === item.group)).toBe(true);
    for (const entry of navEntries) expect(entryOf(entry.home).id).toBe(entry.id);
    expect(navItems.filter((item) => item.label === "设置")).toHaveLength(1);
    expect(entryOf("team").id).toBe("settings");
    expect(entryOf("mcp-gateway").id).toBe("connect");
    expect(phoneEntries).toEqual(["today", "projects", "works", "activity"]);
  });
});
