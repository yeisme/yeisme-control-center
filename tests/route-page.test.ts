import { createElement, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { routePage } from "../src/app/route-page";

const render = (Page: () => ReturnType<typeof createElement>) => renderToString(createElement(Suspense, { fallback: createElement("i", null, "skeleton") }, createElement(Page)));

describe("routePage", () => {
  it("shows the skeleton only while the chunk loads, and renders a warmed page without suspending", async () => {
    let loads = 0;
    const page = routePage(async () => { loads += 1; return { default: () => createElement("p", null, "page") }; });
    const loading = render(page.Page);
    expect(loading).toContain("skeleton");
    expect(loading).not.toContain("<p>page</p>");
    await page.preload();
    const warmed = render(page.Page);
    expect(warmed).toContain("<p>page</p>");
    expect(warmed).not.toContain("skeleton");
    expect(loads).toBe(2);
  });

  it("renders directly after the idle prefetch, before the page was ever opened", async () => {
    const page = routePage(async () => ({ default: () => createElement("p", null, "warmed") }));
    await page.preload();
    const html = render(page.Page);
    expect(html).toContain("<p>warmed</p>");
    expect(html).not.toContain("skeleton");
  });
});
