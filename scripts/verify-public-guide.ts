/**
 * The public guide, end to end against the real server and the production build: it opens without a session, never
 * calls the control-center API, breaks no content policy, keeps its choices in the address, is reached from a
 * signed-out in-app link, serves media with byte ranges, and passes axe in both themes and on a phone.
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
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))).map((animation) => animation.finished.catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]));
  // Evaluated through DevTools rather than an inline <script>, which the page's own content policy rightly blocks.
  if (!await page.evaluate(() => "axe" in window)) await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const { violations } = await (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[] }> } }).axe.run(document, { resultTypes: ["violations"] });
    return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}@${v.nodes.slice(0, 2).map((node) => node.target.join(" ")).join(",")}`);
  });
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

  await check("opens without a session and shows the whole guide", async () => {
    const response = await page.goto(`${base}/guide.html`, { waitUntil: "domcontentloaded" });
    if (response?.status() !== 200) throw new Error(`status_${response?.status()}`);
    if (!(response.headers()["content-security-policy"] || "").includes("object-src 'none'")) throw new Error("csp_header_missing");
    await page.locator('[data-page="public-guide"]').waitFor();
    for (const text of ["三步上手", "先搜索，再执行", "同一个场景，从关键帧做到配乐", "看 Agent 怎么找工具", "每个工具管好一件事", "每个工具从安装到读回结果", "把服务接进 Claude Code 和 Codex", "遇到这些情况，先这样查", "开始之前，你可能想知道", "公开页面"]) await page.getByText(text, { exact: false }).first().waitFor();
    if ((await context.cookies()).length) throw new Error("cookies_set");
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: path.join(run, "artifacts", "public-guide.png") });
  });
  await check("never calls the control-center API and breaks no content policy", async () => {
    await revealAll(page);
    await page.waitForTimeout(500);
    const api = requests.filter((p) => p.startsWith("/api/"));
    if (api.length) throw new Error(`api_requests:${api.join(",")}`);
    const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    if (csp.length) throw new Error(`csp_violations:${csp.join(" | ")}`);
    if (errors.length) throw new Error(`runtime_errors:${errors.join(" | ")}`);
  });
  await check("keeps the chosen tool and client in the address and links to sign-in", async () => {
    await page.getByRole("radiogroup", { name: "选择工具" }).getByRole("radio").nth(1).click();
    await page.getByRole("radiogroup", { name: "选择 Agent 客户端" }).getByRole("radio", { name: /Codex/ }).click();
    const params = new URL(page.url()).searchParams;
    if (!params.get("tool") || params.get("client") !== "codex") throw new Error(`params:${page.url()}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-page="public-guide"]').waitFor();
    if (await page.getByRole("radiogroup", { name: "选择 Agent 客户端" }).getByRole("radio", { checked: true }).innerText() !== "Codex") throw new Error("client_not_restored");
    if (await page.getByRole("link", { name: "登录控制中心", exact: true }).getAttribute("href") !== "./") throw new Error("login_link");
  });
  await check("a signed-out visit to the in-app guide lands on the public page with the same choices", async () => {
    await page.goto(`${base}/#/guide?tool=sonora&client=codex`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/guide\.html\?tool=sonora&client=codex/, { timeout: 15_000 });
    await page.locator('[data-page="public-guide"]').waitFor();
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
      await page.goto(`${base}/guide.html`, { waitUntil: "domcontentloaded" });
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
    if (await page.getByRole("radiogroup", { name: "选择 Agent 客户端" }).getByRole("radio", { checked: true }).innerText() !== "Codex") throw new Error("quick_start_not_following");
    if (await page.locator(".guide-replay-outcome").count()) throw new Error("result_shown_before_the_end");
  });
  await check("passes axe in the light and dark themes", async () => {
    await page.goto(`${base}/guide.html`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-page="public-guide"]').waitFor();
    await revealAll(page);
    const light = await axe(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    const dark = await axe(page);
    await page.screenshot({ path: path.join(run, "artifacts", "public-guide-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    if (light.length || dark.length) throw new Error(`axe light:${light.join(" | ")} dark:${dark.join(" | ")}`);
  });
  await check("fits a phone without sideways scrolling and passes axe there", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const small = await phone.newPage();
      await small.goto(`${base}/guide.html`, { waitUntil: "domcontentloaded" });
      await small.locator('[data-page="public-guide"]').waitFor();
      await revealAll(small);
      const overflow = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`horizontal_overflow_${overflow}`);
      const found = await axe(small);
      await small.screenshot({ path: path.join(run, "artifacts", "public-guide-phone.png") });
      if (found.length) throw new Error(`axe_phone:${found.join(" | ")}`);
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
