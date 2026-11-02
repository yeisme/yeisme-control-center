/**
 * The public guide, end to end against the real server and the production build: it opens without a session, walks
 * every chapter through its top bar (Back included), never calls the control-center API, breaks no content policy,
 * keeps its place and choices in the address, is reached from a signed-out in-app link, serves media with byte
 * ranges, marks the section being read in its outline, drives its radio groups (the tool and client pickers and the
 * theme switch) from the keyboard, and passes axe on every chapter in both themes and on a phone.
 * Evidence lands in temp/integration-test-runs/public-guide-<run-id>/. Run `bun run build` first.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.PUBLIC_GUIDE_PORT || 4390);
const base = `http://127.0.0.1:${port}`;
const runId = "public-guide-" + new Date().toISOString().replace(/[:.]/g, "-");
const run = path.join(root, "temp/integration-test-runs", runId);
await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
const checks: { name: string; status: "passed" | "failed"; error?: string }[] = [];
const check = async (name: string, body: () => Promise<void>) => {
  try { await body(); checks.push({ name, status: "passed" }); console.log("PASSED " + name); }
  catch (error) { checks.push({ name, status: "failed", error: (error as Error).message.slice(0, 600) }); console.log("FAILED " + name + " :: " + (error as Error).message.slice(0, 300)); }
};

await fs.access(path.join(root, "dist/guide.html")).catch(() => { throw new Error("Build first: dist/guide.html is missing (bun run build)."); });
const temp = await fs.mkdtemp("/tmp/yeisme-public-guide-");
const configRef = path.join(temp, "config.json");
// Personal login is configured but never used: every check runs signed out.
await fs.writeFile(path.join(temp, "password"), "unused-hash\n", { mode: 0o600 });
await fs.writeFile(configRef, JSON.stringify({
  origin: base, port, bind: "127.0.0.1", auth_mode: "personal",
  personal: { name: "Guide", username: "guide", role: "viewer", password_hash_ref: path.join(temp, "password"), scope_ids: [], users: [] },
  principals: [], owners: {}, connections: [], database: { path: ":memory:" },
}, null, 2) + "\n", { mode: 0o600 });
const server = spawn("bun", ["server/index.ts"], { cwd: root, env: { ...process.env, YEISME_CONTROL_CONFIG: configRef }, stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
await new Promise<void>((resolve, reject) => {
  const append = (chunk: Buffer) => { serverOutput += chunk.toString(); if (serverOutput.includes("listening on")) resolve(); };
  server.stdout!.on("data", append);
  server.stderr!.on("data", append);
  server.on("exit", (code) => reject(new Error(`server exited early (${code}): ${serverOutput}`)));
  setTimeout(() => reject(new Error(`server start timeout: ${serverOutput}`)), 20_000);
});

const axeSource = await fs.readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
async function axe(page: Page) {
  // Scan only once no finite animation is running, twice in a row 200 ms apart: a scroll reveal starts from an
  // IntersectionObserver callback after the key press that scrolled it into view, so a single snapshot of the running
  // animations misses it on a slow machine and axe measures text halfway through its fade. Infinite loops never count.
  const running = () => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running" && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))).length);
  for (let quiet = 0, tries = 0; quiet < 2 && tries < 30; tries++) {
    quiet = (await running()) ? 0 : quiet + 1;
    await page.waitForTimeout(quiet ? 200 : 150);
  }
  // Evaluated through DevTools rather than an inline <script>, which the page's own content policy rightly blocks.
  if (!await page.evaluate(() => "axe" in window)) await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const { violations } = await (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[] }> } }).axe.run(document, { resultTypes: ["violations"] });
    return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}@${v.nodes.slice(0, 2).map((node) => node.target.join(" ")).join(",")}`);
  });
}
/** Chapters in top-bar order, with headings that only that chapter shows. */
const chapters = [
  { id: "start", label: "开始", texts: ["从一条体检命令开始", "先搜索，再执行", "公开页面"] },
  { id: "tools", label: "工具", texts: ["每个工具管好一件事", "把文件、笔记和代码也交给 Agent"] },
  { id: "cases", label: "案例", texts: ["同一个场景，从关键帧做到配乐", "看 Agent 怎么找工具"] },
  { id: "connect", label: "接入", texts: ["把服务接进 Claude Code 和 Codex", "让控制中心看到工具里的任务"] },
  { id: "help", label: "排障与问答", texts: ["遇到这些情况，先这样查", "开始之前，你可能想知道"] },
] as const;
const chapterUrl = (id: string) => `${base}/guide.html${id === "start" ? "" : `?chapter=${id}`}`;
async function openChapter(page: Page, id: string) {
  await page.goto(chapterUrl(id), { waitUntil: "domcontentloaded" });
  await page.locator('[data-page="public-guide"]').waitFor();
}

/** Scroll through once so every one-time reveal has played, then back to the top. */
async function revealAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((resolve) => setTimeout(resolve, 60)); }
    window.scrollTo(0, 0);
  });
}

const executablePath = process.env.CHROME_PATH || (await fs.stat("/usr/bin/google-chrome").then(() => "/usr/bin/google-chrome").catch(() => undefined));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  // Recorded before any page script runs, so a violation during boot is caught too.
  await context.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  const page = await context.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await check("opens without a session and walks every chapter through the top bar, Back included", async () => {
    const response = await page.goto(`${base}/guide.html`, { waitUntil: "domcontentloaded" });
    if (response?.status() !== 200) throw new Error(`status_${response?.status()}`);
    if (!(response.headers()["content-security-policy"] || "").includes("object-src 'none'")) throw new Error("csp_header_missing");
    await page.locator('[data-page="public-guide"]').waitFor();
    const bar = page.getByRole("navigation", { name: "指南章节" });
    for (const chapter of chapters) {
      const link = bar.getByRole("link", { name: chapter.label, exact: true });
      await link.click();
      for (const text of chapter.texts) await page.getByText(text, { exact: false }).first().waitFor();
      if (await link.getAttribute("aria-current") !== "page") throw new Error(`not_current:${chapter.id}`);
      const named = new URL(page.url()).searchParams.get("chapter");
      if (chapter.id !== "start" && named !== chapter.id) throw new Error(`address:${chapter.id}:${page.url()}`);
      await page.screenshot({ path: path.join(run, "artifacts", `public-guide-${chapter.id}.png`) });
    }
    await page.goBack();
    await page.getByText("让控制中心看到工具里的任务").first().waitFor();
    if (await bar.getByRole("link", { name: "接入", exact: true }).getAttribute("aria-current") !== "page") throw new Error("back_did_not_return_to_previous_chapter");
    // A tool's own page, reached from the overview, carries its manual.
    await bar.getByRole("link", { name: "工具", exact: true }).click();
    await page.getByRole("link", { name: /Sonora 手册/ }).click();
    await page.getByRole("heading", { name: "Sonora", exact: true }).waitFor();
    if (new URL(page.url()).searchParams.get("page") !== "sonora") throw new Error(`tool_page_address:${page.url()}`);
    if ((await context.cookies()).length) throw new Error("cookies_set");
  });
  await check("never calls the control-center API and breaks no content policy on any chapter", async () => {
    for (const chapter of chapters) { await openChapter(page, chapter.id); await revealAll(page); }
    await page.waitForTimeout(500);
    const api = requests.filter((p) => p.startsWith("/api/"));
    if (api.length) throw new Error(`api_requests:${api.join(",")}`);
    const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    if (csp.length) throw new Error(`csp_violations:${csp.join(" | ")}`);
    if (errors.length) throw new Error(`runtime_errors:${errors.join(" | ")}`);
  });
  await check("keeps the chosen tool and client in the address and links to sign-in", async () => {
    await openChapter(page, "start");
    await page.getByRole("radiogroup", { name: "选择工具" }).getByRole("radio").nth(1).click();
    await page.getByRole("radiogroup", { name: "选择 Agent 客户端" }).getByRole("radio", { name: /Codex/ }).click();
    const params = new URL(page.url()).searchParams;
    if (!params.get("tool") || params.get("client") !== "codex") throw new Error(`params:${page.url()}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-page="public-guide"]').waitFor();
    if (await page.getByRole("radiogroup", { name: "选择 Agent 客户端" }).getByRole("radio", { checked: true }).innerText() !== "Codex") throw new Error("client_not_restored");
    if (await page.getByRole("link", { name: "登录控制中心", exact: true }).getAttribute("href") !== "./") throw new Error("login_link");
  });
  await check("the pickers and the theme switch are radio groups the keyboard drives: one tab stop, arrows, Home and End, wrapping", async () => {
    await openChapter(page, "start");
    // One radio group's radios as the page has them now: the tab index and whether each is checked.
    const radios = (label: string) => page.evaluate((name) => [...document.querySelectorAll<HTMLElement>(`[role="radiogroup"][aria-label="${name}"] [role="radio"]`)]
      .map((item) => ({ tab: item.getAttribute("tabindex"), checked: item.getAttribute("aria-checked") === "true", focused: item === document.activeElement })), label);
    // Waits for the choice to be at `index`, with the focus on it and the group's only tab stop there too.
    const settle = async (label: string, index: number) => {
      await page.waitForFunction(([name, want]) => {
        const items = [...document.querySelectorAll<HTMLElement>(`[role="radiogroup"][aria-label="${name}"] [role="radio"]`)];
        const at = items.findIndex((item) => item.getAttribute("aria-checked") === "true");
        return at === want && items[at] === document.activeElement && items[at].getAttribute("tabindex") === "0" && items.filter((item) => item.getAttribute("tabindex") === "0").length === 1;
      }, [label, index] as const, { timeout: 3_000 }).catch(async () => { throw new Error(`${label}: wanted ${index}, page has ${JSON.stringify(await radios(label))}`); });
    };
    const themeChoice = () => page.evaluate(() => document.documentElement.dataset.theme);
    for (const label of ["选择工具", "选择 Agent 客户端", "主题"]) {
      const group = page.getByRole("radiogroup", { name: label });
      await group.scrollIntoViewIfNeeded();
      const before = await radios(label);
      const count = before.length;
      if (count < 2) throw new Error(`${label}: only ${count} radios`);
      const start = before.findIndex((radio) => radio.checked);
      // Tab enters the group once, on the checked radio.
      if (before.filter((radio) => radio.tab === "0").length !== 1 || before[start]?.tab !== "0" || before.some((radio) => radio.tab !== "0" && radio.tab !== "-1")) throw new Error(`${label}: tab stops ${JSON.stringify(before)}`);
      await group.getByRole("radio", { checked: true }).focus();
      await page.keyboard.press("ArrowRight");
      await settle(label, (start + 1) % count);
      // The pickers keep the choice in the address, as a click does; the first option is the default and is not written.
      if (label !== "主题" && !new URL(page.url()).searchParams.get(label === "选择工具" ? "tool" : "client")) throw new Error(`${label}: choice not in ${page.url()}`);
      await page.keyboard.press("ArrowLeft");
      await settle(label, start);
      await page.keyboard.press("End");
      await settle(label, count - 1);
      await page.keyboard.press("ArrowDown");
      await settle(label, 0);
      await page.keyboard.press("ArrowUp");
      await settle(label, count - 1);
      await page.keyboard.press("Home");
      await settle(label, 0);
      // A key with a modifier is the browser's, and does not move the choice.
      await page.keyboard.press("Shift+ArrowRight");
      await settle(label, 0);
      if (label === "主题") {
        // The switch applies each choice as it lands on it: 浅色, then 深色, then back to following the system.
        if (await themeChoice() !== "light") throw new Error(`theme_light:${await themeChoice()}`);
        await page.keyboard.press("ArrowRight");
        await settle(label, 1);
        if (await themeChoice() !== "dark") throw new Error(`theme_dark:${await themeChoice()}`);
        await page.keyboard.press("End");
        await settle(label, count - 1);
        if (await page.evaluate(() => localStorage.getItem("yeisme.v18.theme")) !== null) throw new Error("theme_preference_not_cleared");
      }
      // Tab leaves the group; it does not walk through its other radios.
      await page.keyboard.press("Tab");
      if (await page.evaluate((name) => document.activeElement?.closest('[role="radiogroup"]')?.getAttribute("aria-label") === name, label)) throw new Error(`${label}: Tab stayed in the group`);
    }
    // The chapter bar is a row of links, every one an ordinary tab stop.
    const tabs = await page.getByRole("navigation", { name: "指南章节" }).getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("tabindex")));
    if (tabs.length < 5 || tabs.some((value) => value !== null)) throw new Error(`chapter_links_tab_stops:${tabs.join(",")}`);
    const found = await axe(page);
    if (found.length) throw new Error(`axe_pickers:${found.join(" | ")}`);
  });
  await check("a signed-out visit to the in-app guide lands on the same place of the public page", async () => {
    await page.goto(`${base}/#/guide?tool=sonora&client=codex`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/guide\.html\?chapter=start&tool=sonora&client=codex#guide-steps$/, { timeout: 15_000 });
    await page.locator('[data-page="public-guide"]').waitFor();
    await page.goto(`${base}/#/guide/tools/sonora?client=codex`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/guide\.html\?chapter=tools&page=sonora&client=codex$/, { timeout: 15_000 });
    await page.getByRole("heading", { name: "Sonora", exact: true }).waitFor();
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /使用指南（无需登录）/ }).click();
    await page.locator('[data-page="public-guide"]').waitFor();
  });
  await check("serves media and scripts by byte range and never answers a missing file with HTML", async () => {
    const script = (await fs.readdir(path.join(root, "dist/assets"))).find((name) => name.endsWith(".js"))!;
    const ranged = await fetch(`${base}/assets/${script}`, { headers: { Range: "bytes=0-99" } });
    if (ranged.status !== 206 || (await ranged.arrayBuffer()).byteLength !== 100 || !ranged.headers.get("content-range")?.startsWith("bytes 0-99/")) throw new Error(`range_${ranged.status}`);
    if ((await fetch(`${base}/assets/${script}`, { headers: { Range: "bytes=999999999-" } })).status !== 416) throw new Error("unsatisfiable_range");
    const missing = await fetch(`${base}/guide/showcase/missing.mp4`);
    if (missing.status !== 404 || (missing.headers.get("content-type") || "").includes("html")) throw new Error(`missing_media_${missing.status}`);
    const hashed = await fetch(`${base}/assets/${script}`);
    if (!hashed.headers.get("cache-control")?.includes("immutable")) throw new Error("asset_cache");
    if ((await fetch(`${base}/guide.html`)).headers.get("cache-control") !== "no-cache") throw new Error("page_cache");
  });
  await check("real samples load: every picture decodes, the video and the audio play from byte ranges", async () => {
    const media: { path: string; status: number }[] = [];
    const onResponse = (response: { url: () => string; status: () => number }) => { const path = new URL(response.url()).pathname; if (/\.(mp4|mp3)$/.test(path)) media.push({ path, status: response.status() }); };
    page.on("response", onResponse);
    try {
      await openChapter(page, "cases");
      await page.locator("#guide-showcase").waitFor();
      await revealAll(page);
      const images = page.locator(".guide-thumb img, .guide-before-after img, .guide-chain-thumb img");
      for (let index = 0; index < await images.count(); index += 1) await images.nth(index).scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".guide-thumb img, .guide-before-after img, .guide-chain-thumb img")].every((image) => image.complete && image.naturalWidth > 0), undefined, { timeout: 15_000 });
      const played = await page.evaluate(async () => {
        const result: Record<string, number> = {};
        for (const [name, selector] of [["video", ".guide-media-frame video"], ["audio", ".guide-audio-card audio"]] as const) {
          const element = document.querySelector<HTMLMediaElement>(selector)!;
          element.muted = true;
          await element.play();
          await new Promise((resolve) => setTimeout(resolve, 1_200));
          element.pause();
          result[name] = element.currentTime;
          if (element instanceof HTMLVideoElement) result.width = element.videoWidth;
        }
        return result;
      });
      if (!(played.video > 0.3) || played.width !== 1280) throw new Error(`video_not_playing:${JSON.stringify(played)}`);
      if (!(played.audio > 0.3)) throw new Error(`audio_not_playing:${JSON.stringify(played)}`);
      if (!media.some((item) => item.path.endsWith(".mp4") && item.status === 206)) throw new Error(`video_not_ranged:${JSON.stringify(media)}`);
    } finally {
      page.off("response", onResponse);
    }
  });
  await check("the sample viewer opens from the keyboard, steps with the arrow keys, closes on Escape and returns focus", async () => {
    const first = page.locator(".guide-thumb").first();
    await first.scrollIntoViewIfNeeded();
    await first.focus();
    await page.keyboard.press("Enter");
    const viewer = page.locator("dialog.guide-viewer[open]");
    await viewer.waitFor();
    if (!(await viewer.getAttribute("aria-label"))?.includes("第 1 张")) throw new Error(`viewer_label:${await viewer.getAttribute("aria-label")}`);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("dialog.guide-viewer")?.getAttribute("aria-label")?.includes("第 2 张"));
    const found = await axe(page);
    if (found.length) throw new Error(`axe_viewer:${found.join(" | ")}`);
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" }).catch(async () => { if (await page.locator("dialog.guide-viewer[open]").count()) throw new Error("viewer_still_open"); });
    if (!await first.evaluate((element) => element === document.activeElement)) throw new Error("focus_not_returned");
  });
  await check("the before and after slider moves with the arrow keys", async () => {
    const range = page.getByRole("slider", { name: "改图前后的分界位置" });
    await range.scrollIntoViewIfNeeded();
    await range.focus();
    for (let index = 0; index < 5; index += 1) await page.keyboard.press("ArrowRight");
    if (await range.inputValue() !== "55") throw new Error(`slider_value:${await range.inputValue()}`);
    const split = await page.locator(".guide-before-after").evaluate((element) => (element as HTMLElement).style.getPropertyValue("--split"));
    if (split !== "55%") throw new Error(`split:${split}`);
  });
  await check("the agent replay reveals a step at a time, moves focus to it, and follows the client choice", async () => {
    const steps = page.locator(".guide-replay-steps [data-step]");
    await page.locator("#guide-replay").scrollIntoViewIfNeeded();
    const picker = page.getByRole("radiogroup", { name: "选择回放的客户端" });
    await picker.getByRole("radio", { name: "Claude Code" }).click();
    const initial = await steps.count();
    if (initial < 3) throw new Error(`initial_steps:${initial}`);
    await page.getByRole("button", { name: /^下一步/ }).click();
    await page.waitForFunction((count) => document.querySelectorAll(".guide-replay-steps [data-step]").length === count + 1, initial);
    if (!await steps.nth(initial).evaluate((element) => element === document.activeElement)) throw new Error("focus_not_on_new_step");
    await page.getByRole("button", { name: "全部展开" }).click();
    await page.locator(".guide-replay-outcome img").waitFor();
    const found = await axe(page);
    if (found.length) throw new Error(`axe_replay:${found.join(" | ")}`);
    await picker.getByRole("radio", { name: "Codex" }).click();
    await page.locator(".guide-replay-head", { hasText: "Codex" }).waitFor();
    if (new URL(page.url()).searchParams.get("client") !== "codex") throw new Error(`client_param:${page.url()}`);
    if (await page.locator(".guide-replay-outcome").count()) throw new Error("result_shown_before_the_end");
    // The client choice travels with the reader: 开始 shows the Codex commands.
    await page.getByRole("navigation", { name: "指南章节" }).getByRole("link", { name: "开始", exact: true }).click();
    if (await page.getByRole("radiogroup", { name: "选择 Agent 客户端" }).getByRole("radio", { checked: true }).innerText() !== "Codex") throw new Error("quick_start_not_following");
  });
  await check("the outline rail marks the section being read while both bars stay on screen", async () => {
    await openChapter(page, "cases");
    const outline = page.getByRole("navigation", { name: "本页大纲" });
    const replay = outline.getByRole("link", { name: "Agent 回放", exact: true });
    if (!await replay.isVisible()) throw new Error("rail_not_shown_at_1440");
    if (await outline.getByRole("button", { name: /本页大纲/ }).isVisible()) throw new Error("fold_button_shown_at_1440");
    await page.locator("#guide-replay").scrollIntoViewIfNeeded();
    await page.evaluate(() => document.getElementById("guide-replay")!.scrollIntoView({ block: "start" }));
    await page.waitForFunction(() => document.querySelector('[aria-label="本页大纲"] a[aria-current="location"]')?.textContent === "Agent 回放", undefined, { timeout: 5_000 });
    const top = await page.getByRole("navigation", { name: "指南章节" }).boundingBox();
    if (!top || top.y < 50 || top.y > 62) throw new Error(`chapter_bar_not_sticky:${JSON.stringify(top)}`);
    // An outline click lands the section under both bars and records it in the address without a new history entry.
    const before = await page.evaluate(() => history.length);
    await outline.getByRole("link", { name: "声音", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#guide-showcase-audio");
    await page.waitForFunction(() => { const top = document.getElementById("guide-showcase-audio")!.getBoundingClientRect().top; return top > 100 && top < 140; }, undefined, { timeout: 5_000 });
    if (await page.evaluate(() => history.length) !== before) throw new Error("outline_click_pushed_history");
  });
  await check("passes axe on every chapter and a tool page, in the light and dark themes", async () => {
    const failures: string[] = [];
    for (const target of [...chapters.map((chapter) => chapterUrl(chapter.id)), `${base}/guide.html?chapter=tools&page=eikona`]) {
      await page.goto(target, { waitUntil: "domcontentloaded" });
      await page.locator('[data-page="public-guide"]').waitFor();
      await revealAll(page);
      const light = await axe(page);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      const dark = await axe(page);
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(() => document.documentElement.dataset.theme !== "dark");
      if (light.length || dark.length) failures.push(`${target} light:${light.join(" | ")} dark:${dark.join(" | ")}`);
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(run, "artifacts", "public-guide-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    if (failures.length) throw new Error(`axe ${failures.join(" || ")}`);
  });
  await check("fits a phone without sideways scrolling on any chapter, folds the outline and passes axe there", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const small = await phone.newPage();
      const failures: string[] = [];
      for (const chapter of chapters) {
        await openChapter(small, chapter.id);
        await revealAll(small);
        const overflow = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) failures.push(`${chapter.id}:overflow_${overflow}`);
        const found = await axe(small);
        if (found.length) failures.push(`${chapter.id}:axe:${found.join(" | ")}`);
        await small.screenshot({ path: path.join(run, "artifacts", `public-guide-phone-${chapter.id}.png`) });
      }
      // On a phone the outline is one button that unfolds the list.
      await openChapter(small, "cases");
      const outline = small.getByRole("navigation", { name: "本页大纲" });
      const fold = outline.getByRole("button", { name: /本页大纲/ });
      if (await outline.getByRole("link", { name: "Agent 回放", exact: true }).isVisible()) failures.push("outline_open_by_default_on_phone");
      await fold.click();
      if (await fold.getAttribute("aria-expanded") !== "true") failures.push("fold_not_expanded");
      await outline.getByRole("link", { name: "Agent 回放", exact: true }).click();
      await small.waitForFunction(() => location.hash === "#guide-replay");
      if (failures.length) throw new Error(failures.join(" || "));
    } finally {
      await phone.close();
    }
  });
  await context.close();
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await fs.rm(temp, { recursive: true, force: true });
  const failed = checks.filter((c) => c.status === "failed");
  const summary = { status: failed.length ? "failed" : "passed", checks: checks.length, failures: failed.map((c) => c.name), evidence: run, real_owner_reads: false, provider_calls: false, mutations: false };
  await fs.writeFile(path.join(run, "summary.json"), JSON.stringify({ ...summary, checks }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}
