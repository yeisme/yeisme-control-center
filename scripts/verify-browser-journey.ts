import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect, type Page, type Route } from "@playwright/test";
import { openToolToken } from "./fixtures/fake-open-tools";

// I1/I2 browser journey: starts fixture owners + the real server app + Vite, then drives the UI
// through the full read chain (scope switch, late responses, degraded sources) with redacted evidence.

const root = path.resolve(import.meta.dirname, "..");
const ports = { ui: Number(process.env.I1_UI_PORT || 4320), api: Number(process.env.I1_API_PORT || 4321), owner: Number(process.env.I1_OWNER_PORT || 4322) };
const password = "i1-fixture-" + Math.random().toString(36).slice(2, 10);
const run = path.join(root, "temp/integration-test-runs/browser-journey-" + new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
await fs.writeFile(path.join(run, "command.txt"), "bun run test:browser-journey\n");
await fs.writeFile(path.join(run, "env.json"), JSON.stringify({ ports, scenarios: ["rich", "degraded"], real_owner_calls: false, provider_calls: false, credentials_logged: false }, null, 2) + "\n");

const results: { name: string; status: "passed" | "failed"; detail?: string }[] = [];
const stdout: string[] = [];
const stderr: string[] = [];

/** The key the last fixture printed for running its background observation by hand (`FIXTURE_BACKGROUND=on`). */
let observeKey = "";

async function startFixture(scenario: string, latency = 0, extraEnv: Record<string, string> = {}) {
  const child = spawn("bun", ["scripts/fixture-preview.ts"], {
    cwd: root,
    env: { ...process.env, ...extraEnv, FIXTURE_SCENARIO: scenario, FIXTURE_LATENCY_MS: String(latency), FIXTURE_PASSWORD: password, FIXTURE_UI_PORT: String(ports.ui), FIXTURE_API_PORT: String(ports.api), FIXTURE_OWNER_PORT: String(ports.owner) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (chunk) => { log += chunk; });
  child.stderr?.on("data", (chunk) => { stderr.push(String(chunk)); });
  const deadline = Date.now() + 60_000;
  while (!log.includes('"status": "ready"')) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`fixture_start_failed (exit ${child.exitCode}): ` + (log + stderr.join("")).slice(-600));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  observeKey = /"observe_key": "([^"]+)"/.exec(log)?.[1] ?? "";
  await fetch(`http://127.0.0.1:${ports.ui}/`).catch(() => {});
  return child;
}

/** One background observation cycle of the fixture server, now; `skewDays` moves the loop's clock forward first. */
async function observeNow(skewDays = 0) {
  const response = await fetch(`http://127.0.0.1:${ports.api}/__fixture/observe${skewDays ? `?skew_days=${skewDays}` : ""}`, { method: "POST", headers: { "x-fixture-key": observeKey } });
  if (!response.ok) throw new Error(`observe_failed:${response.status}`);
  return await response.json() as { opened: number; recovered: number; calls: number; errors: Record<string, number> };
}

/**
 * A page where notifications are a recording stand-in: it keeps what was shown, counts the times permission was asked
 * for, and can be made to look hidden and unfocused. Nothing real is shown on the desktop.
 */
const notificationMock = `(() => {
  const shown = [];
  const state = { permission: "default", requests: 0, hidden: false };
  class FakeNotification {
    static get permission() { return state.permission; }
    static async requestPermission() { state.requests += 1; state.permission = "granted"; return "granted"; }
    constructor(title, options = {}) { this.title = title; this.options = options; shown.push({ title, body: options.body, tag: options.tag }); }
    close() {}
  }
  window.Notification = FakeNotification;
  window.__notify = { shown, state };
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (state.hidden ? "hidden" : "visible") });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state.hidden });
  document.hasFocus = () => !state.hidden;
  window.__setHidden = (hidden) => {
    state.hidden = hidden;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event(hidden ? "blur" : "focus"));
  };
})();`;

async function portsFree() {
  const deadline = Date.now() + 15_000;
  for (const port of [ports.ui, ports.api, ports.owner, ports.owner + 1, ports.owner + 2]) {
    while (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) }).then(() => true, (error) => error?.name === "TimeoutError")) {
      if (Date.now() > deadline) throw new Error(`port ${port} still in use`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function stopFixture(child: ChildProcess) {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 6000); });
  }
  await portsFree();
}

/**
 * A failed check can leave a menu open, and an open menu takes every other click on its page: the checks after it then time
 * out for a reason that is not theirs, and one failure reads as three. Closes what is open on every page the journey has.
 */
async function closeOpenMenus() {
  for (const target of browser.contexts().flatMap((context) => context.pages())) {
    for (let attempt = 0; attempt < 3 && await target.locator('[role="menu"]').count().catch(() => 0); attempt += 1) {
      await target.keyboard.press("Escape").catch(() => undefined);
      await target.waitForTimeout(150).catch(() => undefined);
    }
  }
}

/** The check that is running, so a runtime error can say which one it happened in. */
let runningCheck = "";
const inCheck = (text: string) => `[${runningCheck.slice(0, 48)}] ${text}`;

async function check(name: string, fn: () => Promise<void>) {
  runningCheck = name;
  try {
    await fn();
    results.push({ name, status: "passed" });
  } catch (error) {
    results.push({ name, status: "failed", detail: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1200) : String(error) });
    await closeOpenMenus();
  }
}

async function login(page: Page) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`http://127.0.0.1:${ports.ui}/`, { waitUntil: "domcontentloaded" });
      await Promise.any([
        page.getByLabel("用户名").waitFor({ state: "visible", timeout: 20_000 }),
        page.locator('[data-page="home"]').waitFor({ state: "visible", timeout: 20_000 }),
      ]);
      if (await page.locator('[data-page="home"]').count()) return;
      await page.getByLabel("用户名").fill("fixture-admin");
      await page.getByLabel("个人访问凭据").fill(password);
      await page.getByRole("button", { name: /登录 Workspace/ }).click();
      await page.waitForSelector('[data-page="home"]', { timeout: 30_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await page.waitForTimeout(750);
    }
  }
  const body = (await page.locator("body").innerText()).slice(0, 240);
  throw new Error(`fixture_login_failed: ${lastError instanceof Error ? lastError.message.slice(0, 120) : "unknown"}; body=${body}`);
}

const executablePath = process.env.CHROME_PATH || (await fs.stat("/usr/bin/google-chrome").then(() => "/usr/bin/google-chrome").catch(() => undefined));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] });
// I1_CPU_THROTTLE=4 slows every page of the run to a quarter of the speed, the way a busy CI runner is: the way to look for a check that
// only passes when the page is quick (a box measured while it is still fading in, a wait that is shorter than a slow entrance).
const cpuThrottle = Number(process.env.I1_CPU_THROTTLE || 1);
if (cpuThrottle > 1) {
  const makeContext = browser.newContext.bind(browser);
  browser.newContext = async (...args: Parameters<typeof makeContext>) => {
    const context = await makeContext(...args);
    context.on("page", (made) => { void context.newCDPSession(made).then((cdp) => cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle })).catch(() => undefined); });
    return context;
  };
}
const ui = `http://127.0.0.1:${ports.ui}`;
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(run, "artifacts", name + ".png") });
const hashParams = (page: Page) => new URLSearchParams(new URL(page.url()).hash.split("?", 2)[1] || "");
async function waitForNoDialogs(page: Page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await page.getByRole("dialog").count() === 0) return;
    await page.waitForTimeout(50);
  }
  throw new Error("dialogs_remain_open");
}

// Accessibility gate: serious and critical axe violations fail the journey. Overlays are scanned on their own, because
// a modal rightly hides the page behind it and a whole-page scan would report that page instead of the overlay.
const axeSource = await fs.readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
type AxeViolation = { id: string; impact?: string | null; nodes: { target: unknown[] }[] };
/**
 * Waits until nothing on the page is moving or fading: every finite animation and transition has finished (finishing one can
 * start another, such as a stagger or the transition that follows a mount, so it looks again until a short pause passes with none)
 * and the page itself is at full opacity. A slow machine, as CI is, is still partway through an entrance when a fixed wait ends,
 * and then a box is a few pixels off and a colour is blended with what is behind it. Gives up after `budgetMs` and goes on.
 */
async function animationsDone(page: Page, budgetMs = 8_000) {
  await page.evaluate(async (budget) => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = performance.now() + budget;
    const running = () => document.getAnimations().filter((animation) => animation.playState !== "finished" && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    for (let quiet = 0; quiet < 2 && performance.now() < deadline;) {
      const pending = running();
      if (pending.length) {
        quiet = 0;
        await Promise.race([Promise.all(pending.map((animation) => animation.finished.catch(() => undefined))), sleep(Math.max(0, deadline - performance.now()))]);
      } else {
        quiet += 1;
        await sleep(60);
      }
    }
    const shown = document.querySelector("[data-page]");
    while (shown && Number(getComputedStyle(shown).opacity) < 1 && performance.now() < deadline) await sleep(50);
  }, budgetMs);
}
async function axeViolations(page: Page, scope?: string) {
  // Finite animations finish first, so a page or panel that is still fading in is not read as low contrast.
  await animationsDone(page);
  if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (selector) => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const { violations } = await axe.run(selector ? { include: [selector] } : document, { resultTypes: ["violations"] });
    return violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id}@${violation.nodes.slice(0, 2).map((node) => node.target.join(" ")).join(",")}`);
  }, scope);
}
async function expectAccessible(page: Page, where: string, scope?: string) {
  const found = await axeViolations(page, scope);
  if (!found.length) return;
  await fs.writeFile(path.join(run, "artifacts", `axe-${where}.json`), JSON.stringify(found, null, 2) + "\n");
  throw new Error(`axe:${where}: ${found.join(" | ")}`);
}
/** A page is ready to scan once it rendered and its loading skeletons are gone. */
async function settled(page: Page) {
  await page.locator("[data-page]").first().waitFor({ timeout: 30_000 });
  await expect(page.locator(".skeleton:visible")).toHaveCount(0, { timeout: 8_000 }).catch(() => undefined);
}
type Theme = "light" | "dark";
/** Evidence names per theme: light keeps the plain name, dark appends `@dark`. */
const themed = (theme: Theme) => (where: string) => theme === "light" ? where : `${where}@dark`;
/** Runs `fn` with the system preference set to dark; the app follows the system while no theme is chosen. */
async function inDarkTheme(target: Page, fn: () => Promise<void>) {
  await target.emulateMedia({ colorScheme: "dark" });
  try {
    await expect(target.locator("html")).toHaveAttribute("data-theme", "dark");
    await fn();
  } finally {
    await target.emulateMedia({ colorScheme: "light" });
    // A failed scan can leave an overlay open; later checks start from a clean page.
    await target.goto(`${ui}/#/home`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(target.locator("html")).toHaveAttribute("data-theme", "light").catch(() => undefined);
  }
}

await portsFree();
let fixture = await startFixture("rich");
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: { method: string; path: string; expected?: boolean }[] = [];
  let ignoreExpectedMediaErrors = false;
  // The sign-out checks make the server refuse a logout on purpose (503, then 403 for a stale token), and the page that holds a
  // made-up token in the stale-token check has its own writes (the reminder sync) refused too; the browser logs each as a console error.
  let expectRefusedLogout = false;
  // Connecting a tool project or managing a collected record is a control-center action (owners are only read). While a
  // check does it on purpose, its preview, confirm and sync are expected, and so are a refused project's 403 and a
  // deliberately stale revision's 409.
  let expectControlActions = false;
  // A dev server that is busy now and then drops one module request while the first page loads (nothing in the app causes it). The page
  // boundary is built for exactly that: it reloads once by itself and the page then renders, which every later check depends on. So that
  // one console message, and only that, is written to the evidence (`dev-server-hiccups.json`) instead of failing the run; anything else fails it.
  const devServerHiccups: string[] = [];
  const isChunkHiccup = (text: string) => /Failed to fetch dynamically imported module/.test(text) && /PageBoundary/.test(text);
  page.on("pageerror", (error) => errors.push(inCheck(error.message)));
  // net::ERR_NETWORK_CHANGED is Chrome reporting that the host's network interfaces changed (container interfaces coming
  // and going on this machine), not an application error; checks that depend on the request still fail on their own.
  page.on("console", (message) => { if (message.type() === "error" && !/401/.test(message.text()) && !/net::ERR_NETWORK_CHANGED/.test(message.text()) && !(ignoreExpectedMediaErrors && /503/.test(message.text())) && !(expectRefusedLogout && /50[3]|403/.test(message.text()) && /\/api\/control-center\/v1\//.test(message.location().url)) && !(expectControlActions && /40[39]/.test(message.text()) && /\/actions\/(preview|confirm)/.test(message.location().url))) (isChunkHiccup(message.text()) ? devServerHiccups : errors).push(inCheck(message.text())); });
  page.on("request", (request) => { const path = new URL(request.url()).pathname; requests.push({ method: request.method(), path, expected: expectControlActions && /\/actions\/(preview|confirm)$|\/auctra\/collection\/sync$/.test(path) }); });

  await check("login and scoped session", async () => {
    await login(page);
    const body = await page.locator("main").innerText();
    if (!body.includes("需要处理") || !body.includes("服务状态")) throw new Error("home surface incomplete");
  });
  await check("page headers stay compact while retaining accessible names", async () => {
    for (const route of ["projects", "drama", "tasks", "assets", "requests", "review", "services", "capabilities", "usage", "team", "reminders", "guide"]) {
      await page.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
      await page.locator(`[data-page]`).first().waitFor();
      if (await page.locator("h1:not(.sr-only)").count()) throw new Error(`visible_page_title:${route}`);
      if (!await page.locator("h1.sr-only").count()) throw new Error(`missing_accessible_page_title:${route}`);
    }
  });
  await check("failure reminders stay unique across reload and do not offer task deletion", async () => {
    await page.goto(`${ui}/#/`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-home-attention]").waitFor({ timeout: 20_000 });
    await page.goto(`${ui}/#/reminders`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "提醒中心" }).waitFor();
    await page.locator("[data-reminder]").first().waitFor({ timeout: 20_000 });
    const before = await page.locator("[data-page=reminders]").getAttribute("data-unread");
    if (!before || before === "0") throw new Error("expected_initial_failure_reminder");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-reminder]").first().waitFor({ timeout: 20_000 });
    const after = await page.locator("[data-page=reminders]").getAttribute("data-unread");
    if (after !== before) throw new Error(`reminder_duplicated_on_reload:${before}->${after}`);
    const rowsAfterReload = await page.locator("[data-reminder]").count();
    await page.goto(`${ui}/#/`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-page=home]").waitFor();
    await page.goto(`${ui}/#/reminders`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-reminder]").first().waitFor({ timeout: 20_000 });
    const afterNavigation = await page.locator("[data-page=reminders]").getAttribute("data-unread");
    if (afterNavigation !== before || await page.locator("[data-reminder]").count() !== rowsAfterReload) throw new Error(`reminder_duplicated_on_navigation:${before}->${afterNavigation}`);
    // The page, the sidebar badge and the bell count the same thing, so handling a reminder lowers all three.
    const navBefore = Number(await page.locator("[data-nav=reminders]").getAttribute("data-badge") || 0);
    const bellBefore = Number(await page.locator("[data-attention-count]").getAttribute("data-attention-count") || 0);
    if (navBefore !== Number(before) || bellBefore !== Number(before)) throw new Error(`reminder_counts_disagree:page=${before},nav=${navBefore},bell=${bellBefore}`);
    await page.getByRole("button", { name: "确认", exact: true }).first().click();
    await page.waitForFunction((start) => {
      const current = document.querySelector("[data-page=reminders]")?.getAttribute("data-unread");
      return current !== null && Number(current) < Number(start);
    }, before, { timeout: 15_000 });
    await expect(page.locator("[data-nav=reminders]")).not.toHaveAttribute("data-badge", String(navBefore));
    await expect(page.locator("[data-attention-count]")).not.toHaveAttribute("data-attention-count", String(bellBefore));
    // A lasting rule for one task: listed below the reminders, and undone from there.
    await page.locator("[data-reminder]").first().getByRole("button", { name: /^更多操作/ }).click();
    await page.getByRole("menuitem", { name: "此任务以后都免提醒" }).click();
    await page.locator("[data-mute-rules]").waitFor({ timeout: 15_000 });
    await page.locator("[data-mute-rules]").getByRole("button", { name: /^撤销免提醒规则/ }).first().click();
    await page.locator("[data-mute-rules]").waitFor({ state: "detached", timeout: 15_000 });
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-task="run-2410-active"] button').first().click();
    await page.getByRole("button", { name: "安全取消" }).waitFor();
    if (await page.getByRole("button", { name: "删除任务" }).count()) throw new Error("running_task_exposed_delete");
    await page.getByRole("button", { name: "关闭详情" }).click();
    await page.getByRole("button", { name: "需要关注" }).click();
    await page.getByRole("button", { name: "打开提醒中心" }).click();
    await page.getByRole("heading", { name: "提醒中心" }).waitFor();
    await page.getByRole("tab", { name: /已降噪/ }).click();
    await page.getByRole("tab", { name: /已降噪/, selected: true }).waitFor();
    await page.getByRole("tab", { name: /需要处理/ }).click();
    await page.locator("[data-reminder]").first().waitFor({ timeout: 20_000 });
    if (await page.getByRole("button", { name: "删除任务" }).count()) throw new Error("failed_task_exposed_delete");
  });
  await check("services show five-dimension connection evidence", async () => {
    await page.goto(`${ui}/#/services`, { waitUntil: "domcontentloaded" });
    await page.getByText("需要 owner 授权").first().waitFor();
    await page.getByRole("heading", { name: "服务目录" }).waitFor();
    await shot(page, "services");
  });
  await check("Anatomia breakdowns show as tasks with stages, frames and an unknown answer on the workbench", async () => {
    await page.goto(`${ui}/#/tasks?owner=anatomia`, { waitUntil: "domcontentloaded" });
    const main = page.locator("#main");
    await main.getByText("拉片分析：重逢-粗剪-v3.mp4").first().waitFor({ timeout: 20_000 });
    await main.getByText("视频问答：参考片-雨夜.mp4").first().waitFor();
    if (await main.getByText("旧车站 · 重逢镜头关键帧").count()) throw new Error("anatomia_filter_kept_other_owners");
    const text = await main.innerText();
    if (!text.includes("拉片分析") || /breakdown|拆解/.test(text)) throw new Error("anatomia_family_words");
    await shot(page, "tasks-anatomia");
    await page.goto(`${ui}/#/services`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-connection="fx-anatomia"]');
    await card.waitFor({ timeout: 20_000 });
    await card.getByText("可读").first().waitFor({ timeout: 20_000 });
    await page.locator('[data-connection="fx-anatomia-denied"]').getByText("需要 owner 授权").first().waitFor({ timeout: 20_000 });
    await page.goto(`${ui}/#/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: "来源覆盖" }).getByText("Anatomia").waitFor({ timeout: 20_000 });
  });
  await check("services and the workbench show open tools without paths or owner text", async () => {
    await page.goto(`${ui}/#/services`, { waitUntil: "domcontentloaded" });
    const tools = page.getByRole("region", { name: "开放工具" });
    const drive = tools.locator('[data-open-tool="drivebridge"]');
    await drive.getByText("运行：进行中 1 · 失败 2 · 结果未知 0", { exact: false }).waitFor({ timeout: 20_000 });
    const gateway = tools.locator('[data-open-tool="gateway"]');
    await gateway.getByText("后端 2/2 可用 · 停用 1").waitFor();
    await gateway.getByText("近 7 天调用 1,204 次", { exact: false }).waitFor();
    const text = await page.locator('[data-page="services"]').innerText();
    for (const leaked of ["/fixture/", "permission denied", "fixture.invalid", "SONORA_FIXTURE_TOKEN", "upstream 502", "backend-leak.example.test"]) if (text.includes(leaked)) throw new Error(`open_tool_leak:${leaked}`);
    await shot(page, "services-open-tools");
    await gateway.getByRole("button", { name: "工具目录" }).click();
    await page.waitForURL(/#\/capabilities\?tab=tools&owner=gateway/);
    await page.getByRole("table", { name: "MCP Gateway MCP 工具" }).getByText("eikona_execute").waitFor({ timeout: 20_000 });
    if (await page.getByRole("table", { name: "Eikona MCP 工具" }).count()) throw new Error("gateway_filter_kept_other_owners");
    await page.goto(`${ui}/#/`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-open-tool="drivebridge"]').getByText("2 个运行要处理").waitFor({ timeout: 20_000 });
    await page.locator('[data-open-tool="gateway"]').getByText("1 个运行要处理").waitFor();
    await page.getByRole("region", { name: "来源覆盖" }).getByText("MCP Gateway").waitFor();
  });
  await check("guide replaces AI creation, moves between chapters from its top bar and switches commands per tool and client", async () => {
    await page.goto(`${ui}/#/creation`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-page="guide"]').waitFor();
    if (!page.url().includes("#/guide")) throw new Error(`creation_not_redirected:${page.url()}`);
    if (await page.locator('[data-nav="creation"]').count()) throw new Error("ai_creation_nav_still_listed");
    await page.locator('[data-nav="guide"][aria-current="page"]').waitFor();
    // The chapter bar keeps its place in the hash route and the sidebar keeps 使用指南 current on every chapter.
    const chapters = page.getByRole("navigation", { name: "指南章节" });
    await chapters.getByRole("link", { name: "案例", exact: true }).click();
    await page.getByRole("heading", { name: "同一个场景，从关键帧做到配乐" }).waitFor();
    if (!page.url().includes("#/guide/cases")) throw new Error(`chapter_not_in_route:${page.url()}`);
    if (await chapters.getByRole("link", { name: "案例", exact: true }).getAttribute("aria-current") !== "page") throw new Error("chapter_not_current");
    await page.locator('[data-nav="guide"][aria-current="page"]').waitFor();
    const bar = await chapters.boundingBox();
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(300);
    const stuck = await chapters.boundingBox();
    if (!bar || !stuck || Math.abs(stuck.y - 60) > 2) throw new Error(`chapter_bar_not_under_top_bar:${JSON.stringify(stuck)}`);
    await page.goBack();
    await page.locator('[data-page="guide"]').waitFor();
    await chapters.getByRole("link", { name: "开始", exact: true }).click();
    await page.getByRole("heading", { name: "从一条体检命令开始" }).waitFor();
    await page.getByRole("radio", { name: /Sonora/ }).click();
    await page.getByText("claude mcp add sonora -- sonora mcp serve --stdio", { exact: true }).waitFor();
    await page.getByRole("radiogroup", { name: "选择 Agent 客户端" }).getByRole("radio", { name: "Codex" }).click();
    await page.getByText("codex mcp add sonora -- sonora mcp serve --stdio", { exact: true }).waitFor();
    if (hashParams(page).get("tool") !== "sonora") throw new Error(`guide_tool_not_in_url:${page.url()}`);
    await shot(page, "guide");
  });
  await check("tool catalog lists latest owner tools read-only with inspector and guide link", async () => {
    await page.goto(`${ui}/#/capabilities`, { waitUntil: "domcontentloaded" });
    await page.getByText("最新上线").waitFor({ timeout: 20_000 });
    for (const name of ["概览", "模型", "渠道", "工具与动作", "动态"]) await page.getByRole("tab", { name: new RegExp(name) }).waitFor();
    await page.getByRole("tab", { name: /模型/ }).click();
    await page.getByRole("table", { name: "当前模型" }).waitFor();
    if (await page.getByRole("table", { name: "历史模型" }).count()) throw new Error("historical_models_visible_by_default");
    await page.getByRole("checkbox", { name: "显示历史模型" }).click();
    await page.getByRole("table", { name: "历史模型" }).waitFor();
    await page.locator('[data-catalog-row="model:eikona:openai/gpt-image-2.5-sunburst@openrouter"] button').click();
    const inspector = page.locator("[data-catalog-inspector]");
    await inspector.waitFor();
    if (await inspector.getByRole("button", { name: /调用|执行|提交/ }).count()) throw new Error("catalog_inspector_offers_invocation");
    await shot(page, "capabilities-model-inspector");
    await inspector.getByRole("button", { name: "查看接入方式" }).click();
    // The catalog leads to the tool's own guide page, not to a card on a long page.
    await page.getByRole("heading", { name: "Eikona", exact: true }).waitFor();
    if (!page.url().includes("#/guide/tools/eikona")) throw new Error(`guide_link_lost_owner:${page.url()}`);
    await page.getByRole("navigation", { name: "本页大纲" }).waitFor();
    await page.goto(`${ui}/#/capabilities?tab=tools&owner=eikona`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-catalog-row="action:eikona:eikona.execute#upscale"] button').click();
    await inspector.getByText("输入合同").first().waitFor();
    await inspector.getByText("scale", { exact: true }).waitFor();
    await page.getByRole("button", { name: "关闭详情" }).click();
    await fetch(`http://127.0.0.1:${ports.owner}/__fixture/catalog-revision?value=1`);
    await page.goto(`${ui}/#/capabilities?tab=changes`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "刷新目录" }).click();
    await page.getByText("black-forest/flux-2-pro@openrouter").first().waitFor({ timeout: 20_000 });
    await shot(page, "capabilities-changes");
    await fetch(`http://127.0.0.1:${ports.owner}/__fixture/catalog-revision?value=0`);
  });
  await check("tasks list all lanes with denied lane isolated", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-task="run-2410-active"]').waitFor();
    if (await page.locator('[data-task^="run-c-"]').count()) throw new Error("other scope rows leaked");
    await page.locator('[data-task="run-2289"]').getByRole("button", { name: /预览/ }).click();
    const viewer = page.locator("[data-media-viewer]");
    await viewer.locator(".viewer-stage img").waitFor();
    if (hashParams(page).get("task") || !hashParams(page).get("preview")) throw new Error("row_preview_should_open_the_viewer_only");
    if (await page.locator("[data-task-inspector]").count()) throw new Error("row_preview_forced_the_inspector_open");
    await viewer.getByRole("button", { name: "关闭预览" }).click();
    await viewer.waitFor({ state: "detached" });
    if (hashParams(page).get("preview")) throw new Error("viewer_preview_query_not_cleared");
  });
  await check("project task opens the shared inspector without leaving project context", async () => {
    // `/projects` opens shared projects by default; owner projects are the explicit `catalog=owner` view.
    await page.goto(`${ui}/#/projects?catalog=owner`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-project]').first().click();
    await page.getByRole("tab", { name: /任务/ }).click();
    const projectPage = page.locator('[data-page="project-detail"]');
    const projectKey = new URLSearchParams(new URL(page.url()).hash.split("?", 2)[1] || "").get("project");
    await projectPage.locator('[data-task]').first().getByRole("button").click();
    await page.locator('[data-task-inspector="fixed"]').waitFor();
    await page.waitForTimeout(220);
    await page.waitForTimeout(250);
    const selectedUrl = new URL(page.url());
    const selectedParams = new URLSearchParams(selectedUrl.hash.split("?", 2)[1] || "");
    if (selectedUrl.hash.split("?", 1)[0] !== "#/projects") throw new Error("project_task_navigated_to_tasks");
    if (selectedParams.get("project") !== projectKey || selectedParams.get("tab") !== "tasks" || !selectedParams.get("task")) throw new Error("project_context_not_preserved");
    const box = await page.locator('[data-task-inspector="fixed"]').boundingBox();
    const viewportRight = await page.evaluate(() => window.innerWidth);
    if (!box || Math.abs(box.x + box.width - viewportRight) > 1) throw new Error(`project_inspector_not_flush_right:${JSON.stringify({ box, viewportRight })}`);
    await page.getByRole("button", { name: "关闭详情" }).click();
    const closedParams = new URLSearchParams(new URL(page.url()).hash.split("?", 2)[1] || "");
    if (closedParams.get("project") !== projectKey || closedParams.get("tab") !== "tasks" || closedParams.has("task")) throw new Error("project_context_not_restored_after_close");
  });
  await check("tool projects: one entry, several Eikona projects, connect by reference and read at once", async () => {
    await page.goto(`${ui}/#/projects`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "工具项目" }).click();
    const eikona = page.locator('[data-owner-group="eikona"] [data-project]');
    await eikona.first().waitFor();
    const refs = await eikona.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-project")));
    for (const ref of ["eikona:rain-reunion", "eikona:rain-teaser"]) if (!refs.includes(ref)) throw new Error(`tool_project_missing:${ref}`);
    await page.getByRole("button", { name: "接入工具项目" }).first().click();
    const dialog = page.getByRole("dialog", { name: "接入工具项目" });
    await expectAccessible(page, "connect-tool-project", '[role="dialog"]');
    expectControlActions = true;
    try {
      // The owner refuses a project the template credential does not cover; the reason shows and the dialog stays.
      await dialog.getByLabel("项目引用").fill("rain-private");
      await dialog.getByRole("button", { name: "校验并接入" }).click();
      await dialog.getByRole("alert").filter({ hasText: "工具拒绝了这个项目" }).waitFor();
      await dialog.getByLabel("项目引用").fill("rain-bts");
      await dialog.getByLabel("本地名称（可选）").fill("片场花絮");
      await dialog.getByRole("button", { name: "校验并接入" }).click();
      await dialog.waitFor({ state: "detached" });
    } finally {
      expectControlActions = false;
    }
    const card = page.locator('[data-project="eikona:rain-bts"]');
    await card.getByText("片场花絮").waitFor();
    // Read without a restart: the connection and its finished task show up within one refresh.
    await card.getByText("1/1 连接可读").waitFor({ timeout: 15_000 });
    await card.click({ button: "right" });
    await page.getByRole("menuitem", { name: "断开接入" }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator('[data-project="eikona:rain-reunion"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: "用它新建共享项目" }).waitFor();
    if (await page.getByRole("menuitem", { name: "断开接入" }).count()) throw new Error("configured_project_offers_disconnect");
    await page.keyboard.press("Escape");
  });
  await check("context menus: right click, Shift+F10 and a long press open the item's own actions above every panel", async () => {
    const items = async () => (await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((text) => text.trim());
    const closeMenu = async () => { await page.keyboard.press("Escape"); await page.getByRole("menu").waitFor({ state: "detached" }); };
    // A tool project's context menu offers exactly what its "更多操作" button does.
    await page.goto(`${ui}/#/projects?catalog=owner`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-project="eikona:rain-reunion"]');
    await card.getByRole("button", { name: /^项目操作：/ }).click();
    const fromButton = await items();
    await closeMenu();
    await card.click({ button: "right" });
    if (JSON.stringify(await items()) !== JSON.stringify(fromButton)) throw new Error(`project_menus_differ:${JSON.stringify(fromButton)}`);
    await expectAccessible(page, "context-menu", '[role="menu"]');
    await closeMenu();
    // Shift+F10 opens the menu where the focused button ends; Esc closes only the menu and focus goes back to the row.
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    const row = page.locator('[data-task="run-2395-failed"]');
    const rowButton = row.locator("[data-row-button]");
    await row.waitFor();
    // Where a menu can go depends on how much of the window lies under the row, which depends on what the page shows above the list
    // and on how far its entrance animation is (a slower machine measures a row lower). So the window is made two known sizes, and
    // the same rule is held in both: the menu starts right under the focused button when it fits there, and otherwise is moved up
    // just far enough to stay inside the window, still across the line where the button ends. Never off the window, never far away.
    const keyboardMenu = async (height: number, place: "top" | "bottom") => {
      await page.setViewportSize({ width: 1440, height });
      await animationsDone(page);
      await page.evaluate(({ id, at }) => {
        const rect = document.querySelector(`[data-task="${id}"]`)!.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + (at === "top" ? rect.top - 200 : rect.bottom - (window.innerHeight - 24)), behavior: "instant" as ScrollBehavior });
      }, { id: "run-2395-failed", at: place });
      await animationsDone(page);
      await rowButton.focus();
      await page.keyboard.press("Shift+F10");
      await page.getByRole("menu").waitFor();
      // The menu pops in; measure it once it has.
      await animationsDone(page);
      const [menu, button, size] = [await page.getByRole("menu").boundingBox(), await rowButton.boundingBox(), page.viewportSize()!];
      if (!menu || !button) throw new Error(`keyboard_menu_unmeasured:${height}`);
      const anchor = button.y + button.height;
      const roomBelow = size.height - anchor - menu.height;
      const under = menu.y >= anchor - 2 && menu.y <= anchor + 8;
      const moved = menu.y >= 0 && menu.y + menu.height <= size.height + 1 && menu.y <= anchor + 8 && menu.y + menu.height >= anchor - 2;
      const atButton = menu.x >= button.x && menu.x <= button.x + button.width;
      if (!atButton || !(roomBelow >= 16 ? under : moved)) throw new Error(`keyboard_menu_misplaced:${height}:${JSON.stringify({ menu, button, size, roomBelow })}`);
      if (!(await items()).includes("复制任务引用")) throw new Error("task_menu_missing_copy");
      await closeMenu();
      return roomBelow;
    };
    try {
      // A tall window has room under the row whatever the page shows above it, so the menu must start right under the button.
      const room = await keyboardMenu(1400, "top");
      if (room < 16) throw new Error(`keyboard_menu_no_room_in_a_tall_window:${room}`);
      // A short one has the row at its bottom edge, so the menu has to be moved up to fit.
      await keyboardMenu(700, "bottom");
    } finally {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    }
    // The menu hands focus back a task after it unmounts, so wait for it briefly rather than reading it at once.
    await rowButton.evaluate((element) => new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const tick = () => element === document.activeElement ? resolve() : Date.now() - started > 3_000 ? reject(new Error("focus_not_returned_to_row")) : requestAnimationFrame(tick);
      tick();
    }));
    // A menu opened inside the task inspector sits above it, and Esc closes the menu before the inspector.
    await rowButton.click();
    const inspector = page.locator("[data-task-inspector]");
    await inspector.waitFor();
    await inspector.getByRole("button", { name: "更多操作" }).click();
    const box = await page.getByRole("menu").boundingBox();
    if (!box || !await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="menu"]'), { x: box.x + box.width / 2, y: box.y + 12 })) throw new Error("menu_under_inspector");
    await closeMenu();
    if (!await inspector.count()) throw new Error("menu_escape_closed_inspector");
    await page.getByRole("button", { name: "关闭详情" }).click();
    // Reminders: the context menu adds opening the task to the "更多操作" items.
    await page.goto(`${ui}/#/reminders`, { waitUntil: "domcontentloaded" });
    const reminder = page.locator("[data-reminder]").first();
    await reminder.click({ button: "right", position: { x: 260, y: 24 } });
    const reminderItems = await items();
    for (const label of ["打开任务", "此任务以后都免提醒", "复制链接"]) if (!reminderItems.includes(label)) throw new Error(`reminder_menu_missing:${label}`);
    await closeMenu();
    // A long press on a phone opens the menu without also opening the row.
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      const phone = await touch.newPage();
      await login(phone);
      await phone.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
      const first = phone.locator("[data-task]").first();
      await first.waitFor();
      const target = await first.boundingBox();
      const cdp = await touch.newCDPSession(phone);
      const point = { x: Math.round(target!.x + target!.width / 2), y: Math.round(target!.y + target!.height / 2) };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await phone.waitForTimeout(900);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await phone.getByRole("menu").waitFor();
      await phone.waitForTimeout(400);
      if (await phone.locator("[data-task-inspector]").count() || new URL(phone.url()).hash.includes("task=")) throw new Error("long_press_also_opened_the_row");
      const menu = await phone.getByRole("menu").boundingBox();
      if (!menu || menu.x < 0 || menu.x + menu.width > 390) throw new Error(`long_press_menu_off_screen:${JSON.stringify(menu)}`);
    } finally {
      await touch.close();
    }
  });
  await check("task pagination density and prompt summary persist across inspector", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("每页数量").selectOption("20");
    await page.getByLabel("列表密度").selectOption("compact");
    await page.getByRole("button", { name: "下一页" }).click();
    await page.getByText(/第 2 \/ \d+ 页/).waitFor();
    await page.getByText("已采集").first().waitFor();
    await page.locator('[data-task] img[alt]').first().waitFor({ timeout: 15_000 });
    const before = await page.getByText(/第 2 \/ \d+ 页/).first().innerText();
    await page.locator('[data-task]').first().getByRole("button").first().click();
    await page.getByRole("button", { name: "关闭详情" }).click();
    if (await page.getByLabel("每页数量").inputValue() !== "20") throw new Error("page_size_reset_after_inspector");
    if (await page.getByLabel("列表密度").inputValue() !== "compact") throw new Error("density_reset_after_inspector");
    if (await page.getByText(/第 2 \/ \d+ 页/).first().innerText() !== before) throw new Error("page_reset_after_inspector");
    await page.getByRole("button", { name: "上一页" }).click();
    await page.getByText(/第 1 \/ \d+ 页/).waitFor();
  });
  await check("task detail events and result handle", async () => {
    await page.locator('[data-task="run-2398-review"] button').click();
    const dialog = page.locator('[data-task-inspector]');
    await page.getByText("采集与过程").first().waitFor();
    await page.getByText("提示词采集").first().waitFor();
    await dialog.locator('[data-inspector-section="prompt"]').getByText("已采集").waitFor();
    const inspector = page.locator('[data-task-inspector="fixed"]');
    await page.waitForTimeout(220);
    const box = await inspector.boundingBox();
    if (!box || Math.round(box.x + box.width) !== 1440) throw new Error(`fixed_inspector_not_flush_right:${JSON.stringify(box)}`);
    const body = dialog.locator('[data-task-inspector-body]');
    await page.evaluate(() => window.scrollTo(0, 120));
    const pageScrollBefore = await page.evaluate(() => Math.round(window.scrollY));
    await body.evaluate((element) => { element.scrollTop = 0; });
    await dialog.getByRole("button", { name: "采集与过程" }).click();
    await page.waitForTimeout(180);
    const pageScrollAfter = await page.evaluate(() => Math.round(window.scrollY));
    const bodyScrollTop = await body.evaluate((element) => Math.round(element.scrollTop));
    if (pageScrollAfter !== pageScrollBefore) throw new Error(`outline_moved_page:${pageScrollBefore}->${pageScrollAfter}`);
    if (bodyScrollTop < 1) throw new Error(`outline_did_not_scroll_inspector:${bodyScrollTop}`);
    if (hashParams(page).get("preview")) throw new Error("task_selection_auto_opened_preview");
    await shot(page, "task-detail");
    await page.getByRole("button", { name: "预览 林晚 定妆 A.png" }).click();
    const viewer = page.locator("[data-media-viewer]");
    await viewer.locator("img[data-loaded]").waitFor({ timeout: 15_000 });
    await viewer.getByRole("button", { name: "放大" }).click();
    if ((await viewer.locator(".viewer-zoom-value").textContent()) === "100%") throw new Error("viewer_zoom_did_not_change");
    if (!hashParams(page).get("preview")) throw new Error("task_detail_did_not_write_preview_query");
    await shot(page, "media-viewer-over-inspector");
    // Escape closes only the topmost layer: the viewer goes, the Inspector underneath stays.
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
    if (hashParams(page).get("preview")) throw new Error("viewer_preview_query_not_cleared");
    if (!await dialog.count()) throw new Error("escape_closed_the_inspector_under_the_viewer");
    await page.getByRole("button", { name: "悬浮任务侧栏" }).click();
    await page.locator('[data-task-inspector="floating"]').waitFor();
    await page.getByRole("button", { name: "关闭详情" }).click();
    await waitForNoDialogs(page);
  });
  await check("asset cards open the large details workspace without reading media", async () => {
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-page="assets"] [data-result]').first();
    await card.waitFor();
    await card.getByRole("button", { name: /打开 .* 详情/ }).click();
    const inspector = page.locator('[data-asset-inspector]');
    await inspector.waitFor();
    await inspector.getByRole("button", { name: "查看大图" }).waitFor();
    if (hashParams(page).get("preview")) throw new Error("asset_selection_auto_opened_preview");
    await inspector.getByRole("button", { name: /预览 .*/ }).click();
    const viewer = page.locator("[data-media-viewer]");
    await viewer.locator(".viewer-stage img").waitFor();
    // Back steps out one layer at a time: first the viewer, then the Inspector.
    await page.goBack({ waitUntil: "domcontentloaded" });
    await viewer.waitFor({ state: "detached" });
    await inspector.waitFor();
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.locator('[data-asset-inspector]').waitFor({ state: "detached" });
  });
  await check("visual preview opens the full-screen viewer in one click and steps through results", async () => {
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-page="assets"] li').first();
    await card.waitFor();
    await card.hover();
    await card.getByRole("button", { name: /^预览 / }).click();
    const viewer = page.locator("[data-media-viewer]");
    await viewer.locator("img[data-loaded]").waitFor({ timeout: 15_000 });
    if (await page.locator("[data-asset-inspector]").count()) throw new Error("card_preview_opened_the_inspector");
    if (hashParams(page).get("result")) throw new Error("card_preview_wrote_result_query");
    const first = await viewer.locator(".viewer-count").textContent();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((label) => document.querySelector("[data-media-viewer] .viewer-count")?.textContent !== label, first);
    await viewer.locator("img[data-loaded]").waitFor({ timeout: 15_000 });
    await shot(page, "media-viewer");
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || "");
    if (!focused.startsWith("预览 ")) throw new Error(`viewer_focus_not_restored:${focused}`);
    if (hashParams(page).get("preview")) throw new Error("viewer_preview_query_not_cleared");
  });
  await check("asset details keep preview explicit", async () => {
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /打开 .* 详情/ }).first().click();
    const inspector = page.locator('[data-asset-inspector]');
    await inspector.getByRole("heading", { name: "来源与版本" }).waitFor();
    await inspector.getByRole("heading", { name: "生产过程" }).waitFor();
    if (hashParams(page).get("preview")) throw new Error("asset_details_auto_opened_preview");
    await inspector.getByRole("button", { name: "查看大图" }).click();
    await page.locator("[data-media-viewer] .viewer-stage img").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("[data-media-viewer]").waitFor({ state: "detached" });
    await inspector.getByRole("button", { name: "关闭资源详情" }).click();
    await waitForNoDialogs(page);
  });
  await check("wide shell keeps the main workspace fluid with a 520px inspector", async () => {
    const previous = page.viewportSize() || { width: 1440, height: 960 };
    await page.setViewportSize({ width: 2048, height: 1080 });
    try {
      await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-page="assets"] [data-result]').first().waitFor();
      const main = await page.locator("main").boundingBox();
      if (!main || main.width < 1750) throw new Error(`wide_main_too_narrow:${JSON.stringify(main)}`);
      await page.locator('[data-page="assets"] [data-result]').first().getByRole("button", { name: /打开 .* 详情/ }).click();
      const inspector = page.locator('[data-asset-inspector="fixed"]');
      await inspector.waitFor();
      const inspectorBox = await inspector.boundingBox();
      const layoutRight = await page.evaluate(() => document.documentElement.clientWidth);
      if (!inspectorBox || Math.round(inspectorBox.width) !== 520 || inspectorBox.x + inspectorBox.width < layoutRight - 16 || inspectorBox.x + inspectorBox.width > layoutRight) throw new Error(`wide_inspector_geometry:${JSON.stringify({ box: inspectorBox, layoutRight })}`);
      const paddingRight = await page.locator('[data-page="assets"]').evaluate((element) => getComputedStyle(element).paddingRight);
      if (paddingRight !== "520px") throw new Error(`wide_content_reserve:${paddingRight}`);
    } finally {
      await page.setViewportSize(previous);
    }
  });
  await check("wide rows: main columns stop at 560px, one long line never widens a table, list rows keep one rhythm", async () => {
    const previous = page.viewportSize() || { width: 1440, height: 960 };
    await page.setViewportSize({ width: 1920, height: 1080 });
    const assetsView = page.getByRole("radiogroup", { name: "资源视图" });
    try {
      // Left to grow, a main column kept every spare pixel: titles ended 550–840px before the next column at 1920.
      const firstColumns = () => page.locator("[data-page] table").evaluateAll((tables) => tables.filter((table) => table.getBoundingClientRect().width > 0).map((table) => Math.round(table.querySelector("tbody td")?.getBoundingClientRect().width || 0)));
      await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-task]").first().waitFor();
      const tasks = await firstColumns();
      if (tasks[0] !== 560) throw new Error(`wide_task_main_column:${JSON.stringify(tasks)}`);
      await page.goto(`${ui}/#/capabilities?tab=tools`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-page] table tbody tr").first().waitFor();
      const tools = await firstColumns();
      if (tools.length < 2 || tools.some((width) => width !== 560)) throw new Error(`wide_tool_main_columns:${JSON.stringify(tools)}`);
      // One owner description far longer than the column used to make the tool table about 2800px wide.
      const overflow = await page.locator("[data-page] table").first().evaluate((table) => {
        const line = [...table.querySelectorAll("tbody td:first-child span.truncate")].at(-1);
        if (line) line.textContent = "Generate images from a prompt through an explicit model channel, with references and per-channel limits. ".repeat(6);
        const box = table.parentElement!;
        return { scroll: box.scrollWidth, client: box.clientWidth, first: Math.round(table.querySelector("tbody td")!.getBoundingClientRect().width) };
      });
      if (overflow.scroll > overflow.client + 1 || overflow.first !== 560) throw new Error(`wide_long_line_overflow:${JSON.stringify(overflow)}`);
      // Audio and video rows keep their badge in a thumbnail-sized slot: names start at one x and rows keep one height.
      await page.goto(`${ui}/#/assets`, { waitUntil: "domcontentloaded" });
      await assetsView.getByRole("radio", { name: "紧凑列表" }).click();
      await page.getByRole("table", { name: "资源紧凑列表" }).locator("tbody tr").first().waitFor();
      const rhythm = await page.getByRole("table", { name: "资源紧凑列表" }).evaluate((table) => {
        const rows = [...table.querySelectorAll("tbody tr")].slice(0, 12);
        return {
          kinds: new Set(rows.map((row) => row.querySelector('td:first-child [role="img"]')?.getAttribute("aria-label") || "thumbnail")).size,
          starts: [...new Set(rows.map((row) => Math.round(row.querySelector("td:first-child .font-semibold")!.getBoundingClientRect().left)))],
          heights: [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)))],
        };
      });
      if (rhythm.kinds < 2 || rhythm.starts.length !== 1 || rhythm.heights.length !== 1) throw new Error(`wide_asset_row_rhythm:${JSON.stringify(rhythm)}`);
    } finally {
      // The view choice is remembered; later checks expect the default gallery.
      if (await assetsView.count()) await assetsView.getByRole("radio", { name: "大图网格" }).click().catch(() => {});
      await page.setViewportSize(previous);
    }
  });
  await check("inspector docks on desktop and becomes a modal drawer on narrow screens", async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-page="assets"] [data-result]').first();
    await card.waitFor();
    await card.getByRole("button", { name: /打开 .* 详情/ }).click();
    const desktopInspector = page.locator('[data-asset-inspector="fixed"]');
    await desktopInspector.waitFor();
    const desktopBox = await desktopInspector.boundingBox();
    const cardBox = await page.locator('[data-page="assets"] [data-result]').last().boundingBox();
    if (!desktopBox || !cardBox || cardBox.x + cardBox.width > desktopBox.x + 1) throw new Error(`desktop_content_under_inspector:${JSON.stringify({ desktopBox, cardBox })}`);
    await page.getByRole("button", { name: "关闭资源详情" }).click();

    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    const tabletCard = page.locator('[data-page="assets"] [data-result]').first();
    await tabletCard.waitFor();
    await tabletCard.getByRole("button", { name: /打开 .* 详情/ }).click();
    const tabletInspector = page.locator('[data-asset-inspector="fixed"]');
    await tabletInspector.waitFor();
    if (await tabletInspector.getAttribute("role") !== "dialog" || await tabletInspector.getAttribute("aria-modal") !== "true") throw new Error("tablet_inspector_not_modal");
    await page.getByRole("button", { name: "关闭资源详情" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    const mobileCard = page.locator('[data-page="assets"] [data-result]').first();
    await mobileCard.waitFor();
    const openButton = mobileCard.getByRole("button", { name: /打开 .* 详情/ });
    await openButton.click();
    const mobileInspector = page.locator('[data-asset-inspector="fixed"]');
    await mobileInspector.waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error("mobile_inspector_horizontal_overflow");
    await page.getByRole("button", { name: "关闭资源详情" }).click();
    await page.waitForFunction(() => document.activeElement instanceof HTMLElement && (document.activeElement.getAttribute("aria-label") || "").startsWith("打开 "));
    await page.setViewportSize({ width: 1440, height: 960 });
  });
  // The task the keyboard check opens; later checks read it from the palette's recent items.
  const keyboardTask = { ref: "", title: "" };
  const focusState = () => page.evaluate(() => {
    const element = document.activeElement;
    return { task: element?.closest("[data-task]")?.getAttribute("data-task") || null, row: element?.hasAttribute("data-row-button") === true, search: element?.hasAttribute("data-page-search") === true, label: element?.getAttribute("aria-label") || "" };
  });
  const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await check("keyboard alone finds a task, opens it, previews it and returns to the row", async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    const row = page.locator("[data-task]").filter({ has: page.getByRole("button", { name: /^预览 / }) }).first();
    await row.waitFor();
    keyboardTask.ref = await row.getAttribute("data-task") || "";
    keyboardTask.title = (await row.locator("[data-row-button]").getAttribute("aria-label") || "").replace(/^打开任务 /, "").split("，")[0];
    await blur();
    await page.keyboard.press("/");
    if (!(await focusState()).search) throw new Error("slash_did_not_focus_search");
    await page.keyboard.type(keyboardTask.title);
    await expect(page.locator("[data-task]").first()).toHaveAttribute("data-task", keyboardTask.ref);
    await page.keyboard.press("ArrowDown");
    let focus = await focusState();
    if (!focus.row || focus.task !== keyboardTask.ref) throw new Error(`arrow_down_missed_row:${JSON.stringify(focus)}`);
    await page.keyboard.press("Enter");
    await page.locator("[data-task-inspector]").waitFor();
    // Docked details keep focus in the list, so Tab reaches the row's own preview.
    await page.keyboard.press("Tab");
    focus = await focusState();
    if (!focus.label.startsWith("预览 ") || focus.task !== keyboardTask.ref) throw new Error(`tab_missed_row_preview:${JSON.stringify(focus)}`);
    await page.keyboard.press("Enter");
    const viewer = page.locator("[data-media-viewer]");
    await viewer.waitFor();
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
    await page.keyboard.press("Escape");
    await page.locator("[data-task-inspector]").waitFor({ state: "detached" });
    await page.waitForFunction((ref) => document.activeElement?.closest("[data-task]")?.getAttribute("data-task") === ref, keyboardTask.ref);
    if (hashParams(page).has("task") || hashParams(page).has("preview")) throw new Error("keyboard_close_left_query");
  });
  await check("a row opened with the mouse returns focus to its row button on Escape", async () => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
      const row = page.locator("[data-task]").nth(1);
      await row.waitFor();
      const ref = await row.getAttribute("data-task");
      // The cell's padding is plain text: the opener is the page body, which is no place to return to.
      await row.locator("td:visible").nth(1).click({ position: { x: 3, y: 3 } });
      await page.locator("[data-task-inspector]").waitFor();
      await page.keyboard.press("Escape");
      await page.locator("[data-task-inspector]").waitFor({ state: "detached" });
      await page.waitForFunction((expected) => document.activeElement?.hasAttribute("data-row-button") === true && document.activeElement.closest("[data-task]")?.getAttribute("data-task") === expected, ref, { timeout: 5_000 }).catch(async () => { throw new Error(`focus_not_on_row_${width}:${JSON.stringify(await focusState())}`); });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });
  await check("the skip link moves focus to the content without changing the route", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-task]").first().waitFor();
    await page.getByRole("link", { name: "跳到主要内容" }).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "main");
    if (!new URL(page.url()).hash.startsWith("#/tasks") || !await page.locator('[data-page="tasks"]').count()) throw new Error(`skip_link_changed_route:${new URL(page.url()).hash}`);
    // <main> is focusable only while focused; otherwise every click on page text would focus it.
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.getElementById("main")?.hasAttribute("tabindex"))) throw new Error("main_kept_tabindex");
    if (!await page.evaluate(() => document.activeElement?.closest("main") !== null)) throw new Error("tab_left_main_after_skip");
  });
  await check("? opens the shortcut reference and page shortcuts stay out of text fields", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-task]").first().waitFor();
    await blur();
    await page.keyboard.press("?");
    const sheet = page.locator("[data-shortcut-sheet]");
    await sheet.getByRole("heading", { name: "键盘快捷键" }).waitFor();
    for (const action of ["聚焦当前页的搜索框", "在任务、资源、请求和提醒之间移动", "放大、缩小、适应窗口"]) await sheet.getByText(action, { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
    await page.keyboard.press("/");
    await page.keyboard.type("?/");
    if (await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value) !== "?/") throw new Error("shortcut_fired_while_typing");
    if (await sheet.count()) throw new Error("shortcut_sheet_opened_while_typing");
  });
  await check("the command palette offers recent items and runs theme and shortcut actions", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-task]").first().waitFor();
    if (!await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("yeisme.recent.v1:")))) throw new Error("recent_items_not_stored");
    const palette = page.getByRole("dialog", { name: "搜索" });
    const run = async (query: string) => { await page.keyboard.press("Control+k"); await palette.waitFor(); await page.keyboard.type(query); await page.keyboard.press("Enter"); await palette.waitFor({ state: "detached" }); };
    try {
      await page.keyboard.press("Control+k");
      await expect(palette.getByRole("option").first()).toContainText("最近打开");
      // With an empty query only recent items carry task titles; the keyboard check's task is one of them.
      const recent = palette.getByRole("option").filter({ hasText: keyboardTask.title });
      await expect(recent).toHaveCount(1);
      await recent.click();
      await palette.waitFor({ state: "detached" });
      await page.waitForFunction((ref) => document.querySelector("[data-task-inspector]") !== null && document.querySelector(`[data-task="${ref}"]`)?.hasAttribute("data-selected") === true, keyboardTask.ref)
        .catch(async () => { throw new Error(`recent_item_did_not_open_task:${page.url().split("#")[1]}:inspector=${await page.locator("[data-task-inspector]").count()}`); });
      await page.keyboard.press("Escape");
      await run("深色");
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark").catch(() => { throw new Error("palette_dark_theme_not_applied"); });
      await run("跟随系统");
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light").catch(() => { throw new Error("palette_system_theme_not_applied"); });
      await run("快捷键");
      await page.locator("[data-shortcut-sheet]").waitFor();
      await page.keyboard.press("Escape");
      await page.locator("[data-shortcut-sheet]").waitFor({ state: "detached" });
    } finally {
      // A palette left open would cover the page for every later check.
      if (await palette.count()) await palette.getByRole("button", { name: "关闭搜索" }).last().click();
    }
  });
  await check("arrow keys move through asset cards, requests and reminders", async () => {
    await page.goto(`${ui}/#/assets`, { waitUntil: "domcontentloaded" });
    const cards = page.locator('[aria-label="资源大图网格"] [data-row-button]');
    await cards.nth(4).waitFor();
    await cards.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(cards.nth(1)).toBeFocused();
    const before = await cards.nth(1).boundingBox();
    await page.keyboard.press("ArrowDown");
    const below = await page.evaluate(() => document.activeElement?.getBoundingClientRect().top ?? 0);
    if (!before || below <= before.y + before.height / 2) throw new Error("grid_arrow_down_stayed_on_row");
    await page.keyboard.press("Home");
    await expect(cards.first()).toBeFocused();
    await page.goto(`${ui}/#/requests`, { waitUntil: "domcontentloaded" });
    const requests = page.locator('[aria-label="请求列表"] [data-row-button]');
    await requests.nth(1).waitFor();
    await blur();
    await page.keyboard.press("/");
    await page.keyboard.press("ArrowDown");
    await expect(requests.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(requests.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(requests.first()).toBeFocused();
    await page.goto(`${ui}/#/reminders`, { waitUntil: "domcontentloaded" });
    const reminders = page.locator('[aria-label="提醒列表"] [data-row-button]');
    await reminders.nth(1).waitFor();
    await reminders.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(reminders.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(reminders.last()).toBeFocused();
  });
  await check("audio plays in the floating player without opening the Inspector", async () => {
    await page.goto(`${ui}/#/assets?kind=audio`, { waitUntil: "domcontentloaded" });
    ignoreExpectedMediaErrors = true;
    try {
      let mediaFailures = 0;
      await page.route("**/api/control-center/v1/media/**", async (route) => {
      if (mediaFailures++ < 2) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "media_unavailable" }) });
        return;
      }
      await route.continue();
      });
      const audioCard = page.locator('[data-page="assets"] [data-result]').first();
      await audioCard.waitFor();
      await audioCard.hover();
      await page.locator('[data-page="assets"] li').first().getByRole("button", { name: /^播放 / }).click();
      await page.locator("[data-audio-dock]").waitFor();
      // Two refused transfers first: the player falls back from memory to a stream, then re-grants the handle.
      await page.waitForFunction(() => { const audio = document.querySelector<HTMLAudioElement>("audio[data-audio-player]"); return !!audio && !audio.paused && audio.currentTime > 0; }, undefined, { timeout: 20_000 });
      if (mediaFailures < 3) throw new Error(`audio_player_did_not_recover:${mediaFailures}`);
      if (await page.locator("[data-asset-inspector]").count()) throw new Error("audio_play_opened_inspector");
      if (hashParams(page).get("preview")) throw new Error("audio_play_wrote_preview_query");
      await page.locator("[data-audio-dock]").getByRole("slider", { name: "播放进度" }).waitFor();
      // Fixture clips last one or two seconds, so the dock may already be paused, buffering or ended here.
      await page.locator("[data-audio-dock] [data-audio-primary]").click();
      await page.waitForFunction(() => document.querySelector<HTMLAudioElement>("audio[data-audio-player]")?.paused === true || document.querySelector("[data-audio-dock]")?.getAttribute("data-audio-dock") === "playing");
      await page.locator("[data-audio-dock]").getByRole("button", { name: "关闭播放器" }).click();
      await page.locator("[data-audio-dock]").waitFor({ state: "detached" });
    } finally {
      await page.unroute("**/api/control-center/v1/media/**");
      ignoreExpectedMediaErrors = false;
    }
  });
  await check("task audio plays in the floating player and mirrors in the Inspector", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    const row = page.locator('[data-task]').filter({ hasText: "片尾环境音乐 · 长版" }).first();
    await row.waitFor();
    await row.getByRole("button").first().click();
    const taskInspector = page.locator('[data-task-inspector]');
    await taskInspector.getByRole("button", { name: /播放 片尾环境音乐/ }).click();
    await page.locator("[data-audio-dock]").waitFor();
    await taskInspector.locator('[data-audio-result] [role="slider"]').waitFor();
    if (await taskInspector.locator("[data-inline-media-preview]").count()) throw new Error("task_audio_rendered_inline_preview");
    await taskInspector.getByRole("button", { name: "关闭详情" }).click();
    await page.locator("[data-audio-dock]").waitFor();
    await page.locator("[data-audio-dock]").getByRole("button", { name: "关闭播放器" }).click();
  });
  await check("audio from the library plays through its list from the floating player", async () => {
    await page.goto(`${ui}/#/assets?kind=audio`, { waitUntil: "domcontentloaded" });
    const dock = page.locator("[data-audio-dock]");
    const position = dock.locator("[data-audio-position]");
    const menu = async (checked: "true" | "false") => {
      await dock.getByRole("button", { name: "更多播放选项" }).click();
      const continuous = page.getByRole("menuitemcheckbox", { name: "播完自动播放下一条" });
      await continuous.click();
      await expect(continuous).toHaveAttribute("aria-checked", checked);
      await page.keyboard.press("Escape");
    };
    const first = page.locator('[data-page="assets"] button[data-audio-phase]').first();
    await first.waitFor();
    await first.click();
    await expect(position).toHaveText(/^1 \/ \d+$/);
    const total = Number((await position.textContent() || "").split(" / ")[1]);
    if (total < 3) throw new Error(`audio_queue_too_short:${total}`);
    const firstTitle = await dock.locator("p").first().textContent();
    await dock.getByRole("button", { name: "下一条" }).click();
    await expect(position).toHaveText(`2 / ${total}`);
    if (await dock.locator("p").first().textContent() === firstTitle) throw new Error("next_kept_previous_title");
    // Continuous play is off by default: a clip that ends keeps its place and requests nothing further.
    await page.waitForFunction(() => document.querySelector("[data-audio-dock]")?.getAttribute("data-audio-dock") === "ended", undefined, { timeout: 20_000 });
    await expect(position).toHaveText(`2 / ${total}`);
    try {
      await menu("true");
      await dock.getByRole("button", { name: "上一条" }).click();
      await expect(position).toHaveText(`1 / ${total}`);
      // Fixture clips last a second or two; with continuous play on, the end of clip 1 starts clip 2 by itself.
      await expect(position).toHaveText(`2 / ${total}`, { timeout: 20_000 });
    } finally {
      await menu("false");
      await dock.getByRole("button", { name: "关闭播放器" }).click();
      await dock.waitFor({ state: "detached" });
    }
  });
  await check("the viewer strip jumps to any result and compares two images side by side", async () => {
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[aria-label="资源大图网格"] [data-result]').first();
    await card.waitFor();
    await card.hover();
    await card.getByRole("button", { name: /^预览 / }).click();
    const viewer = page.locator("[data-media-viewer]");
    await viewer.locator("img[data-loaded]").waitFor({ timeout: 15_000 });
    const tiles = viewer.locator("[data-viewer-strip] button");
    if (await tiles.count() < 3) throw new Error("viewer_strip_too_short");
    await tiles.nth(2).click();
    await expect(viewer.locator(".viewer-count")).toHaveText(/^3 \//);
    await expect(tiles.nth(2)).toHaveAttribute("aria-current", "true");
    await viewer.locator("img[data-loaded]").waitFor({ timeout: 15_000 });
    await viewer.getByRole("button", { name: "并排对比" }).click();
    const paneA = viewer.locator('[data-pane="a"] figcaption');
    const paneB = viewer.locator('[data-pane="b"] figcaption');
    await viewer.locator('[data-pane="b"] img').waitFor({ timeout: 15_000 });
    const a = await paneA.textContent() || "";
    const b = await paneB.textContent() || "";
    if (!a || !b || a.slice(1) === b.slice(1)) throw new Error(`compare_panes:${a}|${b}`);
    await page.keyboard.press("ArrowRight");
    await expect(paneB).not.toHaveText(b, { timeout: 15_000 });
    await expect(paneA).toHaveText(a);
    await expect(viewer.locator("[data-viewer-strip] [data-pinned]")).toHaveCount(1);
    // Escape ends the comparison first and only then closes the viewer.
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-viewer-compare="true"]')).toHaveCount(0);
    await expect(viewer).toHaveCount(1);
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
  });
  // The same pages and overlays are scanned in both themes.
  const desktopAxe = async (theme: Theme) => {
    const tag = themed(theme);
    for (const route of ["", "projects", "drama", "guide", "tasks", "assets", "requests", "reminders", "review", "services", "capabilities", "usage", "team"]) {
      await page.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
      await settled(page);
      await expectAccessible(page, tag(route || "home"));
    }
    // The viewer and the palette are modal; the docked task inspector is part of the page.
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[aria-label="资源大图网格"] [data-result]').first();
    await card.waitFor();
    await card.hover();
    await card.getByRole("button", { name: /^预览 / }).click();
    await page.locator("[data-media-viewer] img[data-loaded]").waitFor({ timeout: 15_000 });
    await expectAccessible(page, tag("viewer"), "[data-media-viewer]");
    await page.keyboard.press("Escape");
    await page.locator("[data-media-viewer]").waitFor({ state: "detached" });
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-task] [data-row-button]").first().click();
    await page.locator("[data-task-inspector-body]").waitFor({ timeout: 15_000 });
    await settled(page);
    await expectAccessible(page, tag("task-inspector"));
    await page.keyboard.press("Escape");
    await page.locator("[data-task-inspector-body]").waitFor({ state: "detached" });
    await blur();
    await page.keyboard.press("?");
    await page.locator("[data-shortcut-sheet]").waitFor();
    await expectAccessible(page, tag("shortcut-sheet"), "[data-shortcut-sheet]");
    await page.keyboard.press("Escape");
    await waitForNoDialogs(page);
    await page.keyboard.press("Control+k");
    await page.locator('[role="dialog"][aria-label="搜索"]').waitFor();
    await expectAccessible(page, tag("command-palette"), '[role="dialog"][aria-label="搜索"]');
    await page.keyboard.press("Escape");
    await waitForNoDialogs(page);
    // Popovers and menus render in a portal; each is scanned while open, then closed with Escape.
    for (const [where, open, scope] of [
      ["source-status", () => page.locator("[data-source-status]").click(), "[data-radix-popper-content-wrapper]"],
      ["notifications", () => page.locator("[data-attention-count]").click(), "[data-radix-popper-content-wrapper]"],
      ["filter-facet", () => page.locator("#main").getByRole("button", { name: /^来源/ }).first().click(), "[data-radix-popper-content-wrapper]"],
      ["identity-menu", () => page.getByRole("button", { name: /当前身份/ }).click(), '[role="menu"]'],
    ] as const) {
      await open();
      await page.locator(scope).first().waitFor();
      await expectAccessible(page, tag(where), scope);
      await page.keyboard.press("Escape");
      await page.locator(scope).first().waitFor({ state: "detached" });
    }
    // Detail panels: docked inspectors are scanned with their page, the request detail is a modal sheet.
    for (const [where, route, open, ready, scope] of [
      ["asset-inspector", "assets", () => page.locator('[data-page="assets"] [data-result]').first().getByRole("button", { name: /打开 .* 详情/ }).click(), "[data-asset-inspector]", undefined],
      ["request-detail", "requests", () => page.locator("[data-request]").first().click(), '[role="dialog"]', '[role="dialog"]'],
      ["drama-inspector", "drama", () => page.locator('li[data-episode="ep-02"] button').first().click(), "[data-drama-inspector]", undefined],
      ["catalog-inspector", "capabilities", async () => {
        await page.getByRole("tab", { name: /模型/ }).click();
        await page.getByRole("table", { name: "当前模型" }).locator("[data-row-button]").first().click();
      }, "[data-catalog-inspector]", undefined],
      ["work-inspector", "", () => page.locator("[data-work-queue-count] button").first().click(), "[data-inspector-body]", undefined],
    ] as const) {
      await page.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
      await settled(page);
      await page.locator('[data-page] [data-result], [data-request], li[data-episode], [role="tab"], [data-work-queue-count] button').first().waitFor({ timeout: 20_000 });
      await open();
      await page.locator(ready).first().waitFor({ timeout: 15_000 });
      await settled(page);
      await expectAccessible(page, tag(where), scope);
      await page.keyboard.press("Escape");
      await waitForNoDialogs(page);
    }
  };
  await check("accessibility: every page and overlay has no serious or critical axe violations", () => desktopAxe("light"));
  await check("accessibility in the dark theme: every page and overlay has no serious or critical axe violations", () => inDarkTheme(page, () => desktopAxe("dark")));
  await check("list pages put the first result on a phone's first screen and keep filters in a drawer", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      for (const [route, first] of [["tasks", "[data-task]"], ["assets", '[data-page="assets"] [data-result]'], ["requests", '[aria-label="请求列表"] li'], ["reminders", "[data-reminder]"]] as const) {
        await page.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
        const row = page.locator(first).first();
        await row.waitFor({ timeout: 20_000 });
        await page.waitForTimeout(300);
        const top = await row.evaluate((element) => element.getBoundingClientRect().top);
        if (top >= 400) throw new Error(`first_result_below_phone_fold:${route}:${Math.round(top)}`);
      }
      // The status line opens the page description and sources; the drawer writes the same parameter as the desktop facets.
      await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-task]").first().waitFor();
      const status = page.locator("[data-page-status]");
      await expect(page.locator('[aria-label="任务连接"]')).toBeHidden();
      await status.click();
      await expect(page.locator('[aria-label="任务连接"]')).toBeVisible();
      await status.click();
      await page.getByRole("button", { name: /^筛选/ }).click();
      const drawer = page.getByRole("dialog", { name: "筛选" });
      await drawer.getByText("Eikona", { exact: true }).first().click();
      await drawer.getByRole("button", { name: "完成" }).click();
      await drawer.waitFor({ state: "detached" });
      if (hashParams(page).get("owner") !== "eikona") throw new Error(`drawer_owner_param:${hashParams(page).get("owner")}`);
      await expect(page.getByRole("button", { name: /^筛选/ })).toHaveAttribute("aria-label", "筛选，已选 1 项");
    } finally {
      await page.setViewportSize({ width: 1440, height: 960 });
    }
  });
  const phoneAxe = async (theme: Theme) => {
    const tag = themed(theme);
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      for (const route of ["", "tasks", "assets", "requests", "reminders", "drama"]) {
        await page.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
        await settled(page);
        await expectAccessible(page, tag(`phone-${route || "home"}`));
      }
      await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-task]").first().waitFor();
      await page.locator("[data-page-status]").click();
      await expectAccessible(page, tag("phone-status-line-open"));
      await page.locator("[data-page-status]").click();
      await page.getByRole("button", { name: /^筛选/ }).click();
      await page.getByRole("dialog", { name: "筛选" }).waitFor();
      await expectAccessible(page, tag("phone-filter-drawer"), '[role="dialog"]');
      await page.keyboard.press("Escape");
      await waitForNoDialogs(page);
      await page.getByRole("button", { name: "打开导航" }).click();
      await expectAccessible(page, tag("phone-navigation"));
      await page.keyboard.press("Escape");
      await page.locator("[data-attention-count]").click();
      await page.getByRole("dialog", { name: "通知" }).waitFor();
      await expectAccessible(page, tag("phone-notifications"), '[role="dialog"]');
      await page.keyboard.press("Escape");
      await waitForNoDialogs(page);
    } finally {
      await page.setViewportSize({ width: 1440, height: 960 });
    }
  };
  await check("accessibility on a phone: folded lines, drawers, navigation and notifications pass axe", () => phoneAxe("light"));
  await check("accessibility on a phone in the dark theme: folded lines, drawers, navigation and notifications pass axe", () => inDarkTheme(page, () => phoneAxe("dark")));
  await check("history: Back closes the topmost overlay, a closed overlay leaves no extra Back step, and the nested viewer returns focus to its opener", async () => {
    try {
      // Each surface is entered from home: Back with the overlay open must close it and stay on the page; after closing it
      // with Escape, one Back must return home rather than land on a copy of the page or reopen the overlay.
      const enter = async (route: string) => {
        await page.goto(`${ui}/#/home`, { waitUntil: "domcontentloaded" });
        await page.locator('[data-page="home"]').waitFor();
        await page.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
        await settled(page);
      };
      const onHome = () => expect(page.locator('[data-page="home"]')).toHaveCount(1, { timeout: 10_000 });
      const surfaces: [string, string, () => Promise<unknown>, string][] = [
        ["task-inspector", "tasks", () => page.locator("[data-task] [data-row-button]").first().click(), "[data-task-inspector]"],
        ["task-viewer", "tasks", () => page.locator("[data-task]").getByRole("button", { name: /^预览 / }).first().click(), "[data-media-viewer]"],
        ["asset-viewer", "assets?kind=image", async () => { const card = page.locator('[aria-label="资源大图网格"] [data-result]').first(); await card.hover(); await card.getByRole("button", { name: /^预览 / }).click(); }, "[data-media-viewer]"],
        ["request-detail", "requests", () => page.locator("[data-request]").first().click(), '[role="dialog"]'],
        ["catalog-inspector", "capabilities", async () => { await page.getByRole("tab", { name: /模型/ }).click(); await page.getByRole("table", { name: "当前模型" }).locator("[data-row-button]").first().click(); }, "[data-catalog-inspector]"],
        ["drama-inspector", "drama", () => page.locator('li[data-episode="ep-02"] button').first().click(), "[data-drama-inspector]"],
        ["work-item", "", () => page.locator("[data-work-queue-count] button").first().click(), "[data-inspector-body]"],
      ];
      for (const [name, route, open, overlay] of surfaces) {
        await enter(route);
        const landing = await page.locator("[data-page]").first().getAttribute("data-page");
        await open();
        await page.locator(overlay).first().waitFor({ timeout: 15_000 });
        await page.goBack();
        await page.locator(overlay).first().waitFor({ state: "detached", timeout: 10_000 }).catch(() => { throw new Error(`back_left_overlay_open:${name}`); });
        if (await page.locator("[data-page]").first().getAttribute("data-page") !== landing) throw new Error(`back_left_the_page:${name}`);
        await enter(route);
        await open();
        await page.locator(overlay).first().waitFor({ timeout: 15_000 });
        await page.keyboard.press("Escape");
        await page.locator(overlay).first().waitFor({ state: "detached", timeout: 10_000 }).catch(() => { throw new Error(`escape_left_overlay_open:${name}`); });
        await page.goBack();
        await onHome().catch(() => { throw new Error(`back_after_close_did_not_leave:${name}:${new URL(page.url()).hash.slice(0, 40)}`); });
      }
      // Nested: the viewer opened from the task inspector closes first, the inspector second, then Back leaves.
      await enter("tasks");
      const row = page.locator("[data-task]").filter({ has: page.getByRole("button", { name: /^预览 / }) }).first();
      await row.locator("[data-row-button]").click();
      const inspector = page.locator("[data-task-inspector]");
      await inspector.waitFor();
      await inspector.getByRole("button", { name: /^预览 / }).first().click();
      await page.locator("[data-media-viewer]").waitFor();
      await page.keyboard.press("Escape");
      await page.locator("[data-media-viewer]").waitFor({ state: "detached", timeout: 10_000 });
      if (!await inspector.count()) throw new Error("viewer_escape_closed_the_inspector");
      // Focus returns to the preview button in the inspector; the button used to be remounted while the preview was
      // requested, and focus fell to the page.
      await expect(inspector.getByRole("button", { name: /^预览 / }).first()).toBeFocused();
      await page.keyboard.press("Escape");
      await inspector.waitFor({ state: "detached", timeout: 10_000 });
      await page.goBack();
      await onHome();
    } finally {
      // An overlay left open by a failure would cover the page for every later check.
      await page.goto(`${ui}/#/home`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
  });
  await check("downloads preserve the owner filename and MIME extension", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-task="deleg-0409"] button').first().click();
    await page.getByText("雨巷推镜头.mp4").waitFor();
    const taskInspector = page.locator('[data-task-inspector]');
    await taskInspector.getByRole("button", { name: "预览 雨巷推镜头.mp4" }).click();
    const viewer = page.locator("[data-media-viewer]");
    await viewer.locator("video").waitFor();
    const viewerDownload = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "下载" }).click();
    if ((await viewerDownload).suggestedFilename() !== "雨巷推镜头.mp4") throw new Error("viewer_download_lost_owner_filename");
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载" }).first().click();
    const download = await downloadPromise;
    if (download.suggestedFilename() !== "雨巷推镜头.mp4") throw new Error(`unexpected_download_name:${download.suggestedFilename()}`);
    await page.keyboard.press("Escape");
  });
  await check("unknown result only re-reads the original task", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-task="deleg-0412"] button').click();
    const dialog = page.locator('[data-task-inspector]');
    await dialog.getByText("提交结果未知").first().waitFor();
    const before = requests.length;
    await dialog.getByRole("button", { name: "重新读取原任务" }).click();
    await page.getByText(/已重新读取原任务|原任务状态已更新/).waitFor();
    const issued = requests.slice(before).filter((request) => request.method !== "GET");
    if (issued.length) throw new Error("re-read issued a non-GET request: " + issued.map((request) => request.path).join(","));
    await page.keyboard.press("Escape");
  });
  await check("content-locked result never requests a handle", async () => {
    await page.goto(`${ui}/#/assets?access=locked`, { waitUntil: "domcontentloaded" });
    const before = requests.filter((request) => request.path.endsWith("/access")).length;
    await page.locator('[data-page="assets"] [data-result]').first().getByRole("button", { name: /打开 .* 详情/ }).click();
    const dialog = page.locator('[data-asset-inspector]');
    await dialog.getByText("内容读取未授权").first().waitFor();
    const mediaActions = await dialog.getByRole("button", { name: /预览|播放/ }).all();
    if (!mediaActions.length) throw new Error("media_action_missing");
    for (const action of mediaActions) if (await action.isEnabled()) throw new Error("preview enabled");
    if (requests.filter((request) => request.path.endsWith("/access")).length !== before) throw new Error("handle requested");
    await page.keyboard.press("Escape");
  });
  await check("requests keep batch and summary separate with per-source coverage", async () => {
    await page.goto(`${ui}/#/requests`, { waitUntil: "domcontentloaded" });
    await page.getByText("全范围汇总").waitFor();
    await page.getByText(/当前批次 \d+ 条/).waitFor();
    await page.getByText("Sonora").first().waitFor();
    await shot(page, "requests");
  });
  await check("content read requires purpose and is audited", async () => {
    await page.goto(`${ui}/#/requests?owner=eikona`, { waitUntil: "domcontentloaded" });
    await page.locator('main [data-page="requests"] ul li button').first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "采集与过程" }).click();
    await dialog.getByText("提示词采集").first().waitFor();
    await dialog.getByRole("tab", { name: "内容" }).click();
    const read = dialog.getByRole("button", { name: /读取输入正文/ });
    if (await read.isEnabled()) throw new Error("read enabled without purpose");
    await dialog.getByPlaceholder(/排查该请求/).fill("I1 集成验证用途");
    await read.click();
    await dialog.getByText("实际生效的业务输入").waitFor();
    await page.keyboard.press("Escape");
    await page.goto(`${ui}/#/team`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "审计" }).click();
    await page.getByText("读取请求正文").first().waitFor();
    await page.getByText("申请结果句柄").first().waitFor();
  });
  await check("personal organization directory rejects service credential fallback", async () => {
    await page.getByRole("tab", { name: "成员" }).click();
    await page.getByText(/所有成员来源都不可读/).waitFor();
    await expect(page.getByText("林舟", { exact: true })).toHaveCount(0);
  });
  await check("usage keeps unknown cost unknown and currencies separate", async () => {
    await page.goto(`${ui}/#/usage`, { waitUntil: "domcontentloaded" });
    await page.getByText("已确认上游成本").waitFor();
    const body = await page.locator("main").innerText();
    if (!body.includes("未知")) throw new Error("unknown cost not shown");
    await shot(page, "usage");
  });
  const rail = (row: ReturnType<Page["locator"]>) => row.locator('ol[aria-label="阶段链"] li[data-stage]');
  const stateOf = async (row: ReturnType<Page["locator"]>, stage: string) => row.locator(`ol[aria-label="阶段链"] li[data-stage="${stage}"]`).getAttribute("data-state");
  await check("drama board lists every episode with a five-stage rail and one next step", async () => {
    await page.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
    await page.locator("li[data-episode]").first().waitFor({ timeout: 20_000 });
    const refs = await page.locator("li[data-episode]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-episode")));
    if (refs.join(",") !== "ep-01,ep-02,ep-03") throw new Error("episodes:" + refs.join(","));
    for (const ref of refs) if (await rail(page.locator(`li[data-episode="${ref}"]`)).count() !== 5) throw new Error("rail_size:" + ref);
    const expected: Record<string, Record<string, string>> = {
      "ep-01": { production_breakdown: "accepted", production_handoff: "accepted" },
      "ep-02": { creative_storyboard: "waiting_review", production_handoff: "missing", production_breakdown: "not_started" },
      "ep-03": { production_handoff: "stale", production_breakdown: "not_started" },
    };
    for (const [ref, stages] of Object.entries(expected)) for (const [stage, state] of Object.entries(stages)) {
      const actual = await stateOf(page.locator(`li[data-episode="${ref}"]`), stage);
      if (actual !== state) throw new Error(`${ref}.${stage}=${actual} expected ${state}`);
    }
    const text = await page.locator("main").innerText();
    if (!text.includes("待审阅：创意分镜（Auctra）") || !text.includes("需处理：制作交接（Auctra）")) throw new Error("next_step_missing");
    if (/waiting review|waiting_review|source_not_accepted/.test(text)) throw new Error("state_code_leaked_into_ui");
    if (!await page.locator("li[data-episode=\"ep-02\"] ol li[aria-current=\"step\"]").count()) throw new Error("current_stage_unmarked");
    await shot(page, "drama-list");
  });
  await check("drama inspector shows structure only and never body text, prompts or media", async () => {
    await page.goto(`${ui}/#/drama?episode=ep-01`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-inspector-section='outline']").waitFor({ timeout: 20_000 });
    const outline = await page.locator("[data-inspector-section='outline']").innerText();
    if (!outline.includes("3 场 · 11 镜") || !outline.includes("更早尝试") || !outline.includes("2 次")) throw new Error("outline_summary:" + outline.slice(0, 160));
    if (/close_up|eye_level|over_the_shoulder|push_in/.test(outline)) throw new Error("camera_tokens_not_localized");
    const raw = await page.evaluate(async () => (await fetch("/api/control-center/v1/drama/episode?scope=fixture-a&episode_ref=ep-01")).text());
    for (const forbidden of ["action_summary", "content_ref", "representation_ref", "media_type", "Authorization", "Bearer"]) if (raw.includes(forbidden)) throw new Error("leaked:" + forbidden);
    await page.locator("[data-drama-inspector]").screenshot({ path: path.join(run, "artifacts", "drama-inspector-ep-01.png") });
  });
  await check("a different Scaena episode ref can be named and is only a read parameter", async () => {
    await page.goto(`${ui}/#/drama?episode=ep-03`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-inspector-section='chain']").waitFor({ timeout: 20_000 });
    await page.getByText("Scaena 中没有引用为「ep-03」的拆解").waitFor({ timeout: 10_000 });
    const before = await page.locator('[data-inspector-section="chain"] li[data-stage="production_breakdown"]').first().getAttribute("data-state");
    if (before !== "not_started") throw new Error("before:" + before);
    await page.getByRole("textbox", { name: "指定 Scaena 使用的剧集引用" }).fill("episode:03");
    await page.getByRole("button", { name: "应用" }).click();
    await page.waitForFunction(() => document.querySelector('[data-inspector-section="chain"] li[data-stage="production_breakdown"]')?.getAttribute("data-state") === "in_progress", null, { timeout: 15_000 });
    if (hashParams(page).get("scaena_episode") !== "episode:03") throw new Error("override_not_in_url");
    await page.getByRole("button", { name: "清除" }).click();
    await page.waitForFunction(() => document.querySelector('[data-inspector-section="chain"] li[data-stage="production_breakdown"]')?.getAttribute("data-state") === "not_started", null, { timeout: 15_000 });
    if (hashParams(page).has("scaena_episode")) throw new Error("override_not_cleared");
  });
  await check("owner hand-off offers command templates and a configured MuWeave link without opening anything", async () => {
    await page.goto(`${ui}/#/drama?episode=ep-01`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-inspector-section='handoff']").waitFor({ timeout: 20_000 });
    const handoff = await page.locator("[data-inspector-section='handoff']").innerText();
    if (!handoff.includes("auctra plan storyboard show") || !handoff.includes("scaena storyboard breakdown show")) throw new Error("command_templates_missing");
    const open = page.locator("[data-inspector-section='handoff']").getByRole("button", { name: "打开", exact: true }).first();
    if (!await open.isEnabled()) throw new Error("muweave_open_disabled");
    // window.open with noopener always returns null, so a "fallback" on null navigates the control center away as well.
    const before = page.url();
    // Nothing listens on the fixture's MuWeave origin; a stub body lets the popup keep the real launch URL instead of an error page.
    await context.route("http://127.0.0.1:4399/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>muweave fixture</title>" }));
    const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 10_000 }), open.click()]);
    // A noopener popup starts with an empty URL; on a slow runner it is still empty when its first load state resolves.
    await popup.waitForURL((url) => url.origin === "http://127.0.0.1:4399", { timeout: 15_000 }).catch(() => {});
    const target = popup.url();
    await popup.close().catch(() => {});
    if (page.url() !== before) throw new Error(`control_center_navigated_away:${page.url()}`);
    if (!target.startsWith("http://127.0.0.1:4399/") || !/episode=ep-01/.test(target)) throw new Error("unexpected_launch_target:" + target);
  });
  await check("episode rows are valid markup and expose every stage state to assistive tech", async () => {
    await page.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
    await page.locator("li[data-episode]").first().waitFor({ timeout: 20_000 });
    if (await page.locator("li[data-episode] button ol, li[data-episode] button li").count()) throw new Error("list_inside_button");
    const row = page.locator('li[data-episode="ep-02"]');
    const names = await row.locator('ol[aria-label="阶段链"] li .sr-only').allInnerTexts();
    if (names.length !== 5 || !names.includes("创意分镜：待审阅（Auctra）") || !names.includes("制作拆解：未开始（Scaena）")) throw new Error("stage_states_not_exposed:" + names.join("|"));
    if (!await row.getByRole("button", { name: "第 2 集 · 末班车" }).count()) throw new Error("title_button_name");
  });
  await check("closing the inspector returns focus to the episode row and Escape closes it", async () => {
    await page.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
    await page.locator("li[data-episode]").first().waitFor({ timeout: 20_000 });
    const row = page.locator('li[data-episode="ep-02"] button');
    await row.click();
    await page.locator("[data-drama-inspector]").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("[data-drama-inspector]").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.closest("li")?.getAttribute("data-episode") === "ep-02", null, { timeout: 5_000 });
    if (hashParams(page).has("episode")) throw new Error("episode_param_not_cleared");
  });
  await check("drama board stays within the viewport on a phone and opens the inspector as a dialog", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await page.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
      await page.locator("li[data-episode]").first().waitFor({ timeout: 20_000 });
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      if (widths.scroll > widths.inner) throw new Error(`overflow:${widths.scroll}>${widths.inner}`);
      await page.locator('li[data-episode="ep-02"] button').click();
      await page.getByRole("dialog", { name: "剧集详情" }).waitFor();
      await shot(page, "drama-phone-inspector");
    } finally {
      await page.setViewportSize({ width: 1440, height: 960 });
    }
  });
  await check("review page points stage reviews to their owner and keeps adoption disabled", async () => {
    await page.goto(`${ui}/#/review`, { waitUntil: "domcontentloaded" });
    const panel = page.locator("section", { hasText: "剧集阶段审阅" }).first();
    await panel.getByText("第 2 集 · 末班车").waitFor({ timeout: 20_000 });
    const text = await panel.innerText();
    if (!text.includes("创意分镜") || !text.includes("控制中心不代为决定")) throw new Error("stage_review_copy:" + text.slice(0, 200));
    if (!await page.getByRole("button", { name: /采用/ }).first().isDisabled()) throw new Error("adopt_enabled");
  });
  await check("the attention queue reports real episode problems and no phantom contract gap", async () => {
    const body = await page.evaluate(async () => (await fetch("/api/control-center/v1/work-queue?scope=fixture-a")).json());
    const flow = body.items.filter((item: { workflow_stage?: string }) => item.workflow_stage).map((item: { workflow_stage: string; kind: string }) => `${item.workflow_stage}:${item.kind}`).sort();
    if (flow.join(",") !== "creative_storyboard:review_required,production_handoff:service_blocked") throw new Error("flow_items:" + flow.join(","));
    if (body.items.some((item: { title: string }) => item.title === "剧本到分镜流程暂不可读")) throw new Error("phantom_contract_gap");
  });
  await check("a flow item opens its chain in the Inspector and hands off by copied command or a configured link only", async () => {
    await page.goto(`${ui}/#/home`, { waitUntil: "domcontentloaded" });
    // The episode-2 storyboard waiting for review is a creative-flow item; its row names the stage.
    const row = page.locator("#home-work-queue li button").filter({ hasText: "创意分镜 · ep-02" }).first();
    await row.waitFor({ timeout: 20_000 });
    await row.click();
    const inspector = page.locator("[data-inspector-section='flow']");
    await inspector.waitFor({ timeout: 10_000 });
    const chain = page.getByRole("list", { name: "剧本到分镜流程" });
    if (await chain.locator('[aria-current="step"]').innerText() !== "创意分镜") throw new Error("current_stage:" + await chain.locator('[aria-current="step"]').innerText());
    if (!new URL(page.url()).hash.includes("work_item=")) throw new Error("work_item_not_in_address");
    const handoff = page.locator("[data-inspector-section='handoff']");
    const text = await handoff.innerText();
    if (!text.includes("auctra plan storyboard show")) throw new Error("auctra_command_missing:" + text.slice(0, 200));
    // Only a server-built URL on the configured MuWeave origin may open; no link in the hand-off leaves for any other host.
    const hrefs = await handoff.locator("a[href]").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
    if (hrefs.length) throw new Error("raw_links_in_handoff:" + hrefs.join(","));
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ui });
    await handoff.getByRole("button", { name: "复制命令（打开 Auctra）" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    if (!copied.startsWith("auctra plan storyboard show")) throw new Error("copied:" + copied.slice(0, 120));
    await page.getByRole("button", { name: "在剧集制作中查看这一集" }).click();
    await page.waitForURL(/#\/drama\?episode=ep-02/, { timeout: 10_000 });
    await page.locator("[data-inspector-section='handoff']").waitFor({ timeout: 20_000 });
    await page.goBack();
    await page.locator("[data-inspector-section='flow']").waitFor({ timeout: 10_000 });
  });
  await check("the Auctra record panel syncs, confirms with the revision it read, and says so when that revision went stale", async () => {
    await page.goto(`${ui}/#/services?focus=auctra`, { waitUntil: "domcontentloaded" });
    const panel = page.locator("#auctra-collection");
    expectControlActions = true;
    try {
      await panel.getByRole("button", { name: "同步记录" }).click();
      const record = panel.locator('[data-collection-record="unit:outline-s1"]');
      await record.waitFor({ timeout: 20_000 });
      const confirm = record.getByRole("button", { name: "确认「第一季 · 故事大纲」" });
      // Another tab confirmed first, so the server refuses this tab's stale revision at confirm; the panel must say so.
      let stale = false;
      await context.route("**/api/control-center/v1/actions/confirm*", async (route) => {
        if (stale) return route.continue();
        stale = true;
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "collection_metadata_conflict", class: "conflict" }) });
      });
      await confirm.click();
      await page.getByText("这条记录刚被改过，已重新读取").first().waitFor({ timeout: 10_000 });
      await context.unroute("**/api/control-center/v1/actions/confirm*");
      await confirm.click();
      await expect(record.getByText("已确认")).toBeVisible({ timeout: 10_000 });
      // The same actions from the row's context menu.
      await record.click({ button: "right" });
      const menu = page.getByRole("menu");
      await menu.getByRole("menuitem", { name: "复制记录引用" }).waitFor();
      if (await menu.getByRole("menuitem", { name: "确认" }).count()) throw new Error("confirm_offered_twice");
      await page.keyboard.press("Escape");
    } finally {
      expectControlActions = false;
    }
  });
  await check("the Auctra record panel shows an empty source, an old sync and a refused sync as exactly that", async () => {
    // A RegExp, because in a glob "?" would stand for any one character.
    const listing = /\/api\/control-center\/v1\/auctra\/collection\?/;
    const syncRoute = /\/api\/control-center\/v1\/auctra\/collection\/sync(\?|$)/;
    let mode: "empty" | "stale" = "empty";
    await context.route(listing, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      return route.fulfill({ response, json: mode === "empty" ? { ...body, rows: [], total: 0 } : { ...body, coverage: "stale" } });
    });
    // The sync itself is refused, as for a session without the administrator role; nothing may claim it worked.
    await context.route(syncRoute, (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "admin_required", class: "forbidden" }) }));
    expectControlActions = true;
    // A separate page: a fresh document reads the listing anew, and the main page's cache and state stay as they were.
    const probe = await context.newPage();
    try {
      await probe.goto(`${ui}/#/services?focus=auctra`, { waitUntil: "domcontentloaded" });
      const panel = probe.locator("#auctra-collection");
      await panel.getByText("还没有收集记录").waitFor({ timeout: 45_000 });
      mode = "stale";
      await panel.getByRole("button", { name: "同步记录" }).click();
      await probe.getByText("同步没有完成：需要管理员。").first().waitFor({ timeout: 15_000 });
      await panel.getByText("已过期").first().waitFor({ timeout: 15_000 });
      if (await probe.getByText(/已同步 Auctra 收集库/).count()) throw new Error("refused_sync_reported_as_done");
    } finally {
      await probe.close();
      expectControlActions = false;
      await context.unroute(listing);
      await context.unroute(syncRoute);
    }
  });
  await check("scope switch never renders the previous scope", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /当前授权范围/ }).click();
    await page.getByRole("menuitem", { name: /海岸来信/ }).click();
    await page.locator('[data-task^="run-c-"]').first().waitFor({ timeout: 20_000 });
    if (await page.locator('[data-task="run-2410-active"]').count()) throw new Error("previous scope rows rendered");
  });
  await check("recent items stay with the scope they were opened in", async () => {
    await expect(page.getByRole("button", { name: /当前授权范围：.*海岸来信/ })).toBeVisible();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "搜索" });
    await palette.waitFor();
    if (!keyboardTask.title) throw new Error("keyboard_task_unknown");
    if (await palette.getByRole("option").filter({ hasText: keyboardTask.title }).count()) throw new Error("recent_item_crossed_scope");
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
  });
  await check("a scope without an Auctra connection says what is missing instead of showing another scope's episodes", async () => {
    await page.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
    await page.getByText(/列不出全部剧集：这个范围还没有绑定 Auctra 项目/).first().waitFor({ timeout: 20_000 });
    if (await page.locator('li[data-episode="ep-01"]').count() && (await page.locator('li[data-episode="ep-01"]').innerText()).includes("雨停站台")) throw new Error("previous_scope_episode_rendered");
    if ((await page.locator("main").innerText()).includes("?episode=")) throw new Error("address_bar_hint_still_shown");
  });
  await check("an episode ref typed into the search opens directly and is listed again as recently opened", async () => {
    await page.getByPlaceholder("搜索标题，或输入剧集引用直接打开").fill("episode:07");
    await page.getByRole("button", { name: "打开「episode:07」" }).click();
    const inspector = page.locator("[data-drama-inspector]");
    await inspector.waitFor({ timeout: 20_000 });
    await expect(inspector).toContainText("按引用打开");
    await page.keyboard.press("Escape");
    await inspector.waitFor({ state: "detached" });
    await page.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
    const row = page.locator('li[data-episode="episode:07"]');
    await row.waitFor({ timeout: 20_000 });
    await expect(row).toContainText("最近打开");
    await shot(page, "drama-unbound-recent");
  });
  await check("an administrator gets from the board to the Auctra connection steps in one step", async () => {
    await page.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "查看连接方法" }).click();
    const steps = page.locator("[data-auctra-steps]");
    await steps.waitFor({ timeout: 20_000 });
    await steps.locator("summary").click();
    await expect(steps).toContainText("personal-config.ts auctra");
    await expect(page.getByRole("button", { name: "同步记录" })).toBeDisabled();
    await shot(page, "services-auctra-steps");
  });
  await check("a page chunk that failed once loads after one automatic reload; one that keeps failing stops at the error screen", async () => {
    // A failed module fetch stays failed for the document's life, so a network blip during the idle prefetch used to leave
    // that page on 页面加载失败 until a manual reload. The probe page shares the session; the main page is not touched.
    const chunk = /\/pages\/usage\/UsageAnalytics\.tsx|\/assets\/UsageAnalytics-[^/]+\.js$/;
    for (const mode of ["once", "always"] as const) {
      let aborted = 0, loads = 0;
      const handler = (route: Route) => {
        if (mode === "always" || aborted === 0) { aborted += 1; return route.abort("internetdisconnected"); }
        return route.continue();
      };
      // Only the probe's own requests fail: a route on the whole context also caught the main page's prefetches.
      const probe = await context.newPage();
      probe.on("load", () => { loads += 1; });
      await probe.route(chunk, handler);
      try {
        await probe.goto(`${ui}/#/home`, { waitUntil: "domcontentloaded" });
        // A cold document under the dev server compiles every module again; on a busy machine that alone can pass 30s.
        await probe.locator('[data-page="home"]').waitFor({ timeout: 60_000 });
        await expect.poll(() => aborted, { timeout: 15_000 }).toBeGreaterThan(0);
        await probe.locator('[data-nav="usage"]').click();
        if (mode === "once") {
          await probe.locator('[data-page="usage"]').waitFor({ timeout: 30_000 });
        } else {
          await probe.getByText("页面加载失败").waitFor({ timeout: 30_000 });
          // One reload, then the error screen stays: a second failure within a minute must not reload again. Documents are
          // counted rather than chunk requests, since one document may fetch the chunk twice (prefetch, then import).
          await probe.waitForTimeout(2_000);
          if (loads !== 2) throw new Error(`chunk_reload_count:${loads - 1}`);
          await expect(probe.getByText("页面加载失败")).toBeVisible();
        }
      } finally {
        await probe.close();
      }
    }
  });
  await check("a logout the server refused keeps the page signed in, says so, and offers a retry", async () => {
    const logoutRoute = "**/api/control-center/v1/auth/logout";
    expectRefusedLogout = true;
    await context.route(logoutRoute, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "source_unavailable", class: "unavailable" }) }));
    try {
      await page.getByRole("button", { name: /当前身份/ }).click();
      await page.getByRole("menuitem", { name: "退出登录" }).click();
      const notice = page.getByRole("status").filter({ hasText: "退出登录没有成功，会话仍然有效" });
      await notice.waitFor({ timeout: 10_000 });
      if (await page.getByText("进入团队工作空间").count()) throw new Error("signed_out_without_the_server");
      await page.getByRole("button", { name: /当前身份/ }).waitFor();
      // Retrying while the server still refuses ends the same way: still signed in, with a new message to try again.
      await notice.getByRole("button", { name: "重试" }).click();
      await page.getByRole("status").filter({ hasText: "退出登录没有成功，会话仍然有效" }).waitFor({ timeout: 10_000 });
      if (await page.getByText("进入团队工作空间").count()) throw new Error("signed_out_by_a_failed_retry");
    } finally {
      await context.unroute(logoutRoute);
      // The browser reports a refused request to the console a moment after the response; keep expecting it until it has.
      await page.waitForTimeout(500);
      expectRefusedLogout = false;
    }
  });
  await check("a request refused for a stale CSRF token reads the session again and says the sign-in changed, instead of reporting a missing permission", async () => {
    const logoutRoute = "**/api/control-center/v1/auth/logout";
    const sessionReads = () => requests.filter((request) => request.path.endsWith("/api/control-center/v1/session")).length;
    // The message of the previous check stays up for a while; this one must see only what its own request says.
    await page.getByText("退出登录没有成功").first().waitFor({ state: "hidden", timeout: 20_000 });
    const before = sessionReads();
    expectRefusedLogout = true;
    await context.route(logoutRoute, (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "csrf_denied", class: "forbidden" }) }));
    // Another tab signed in as someone else: the session read after the refusal carries a different token.
    const sessionRoute = "**/api/control-center/v1/session";
    let swapped = false;
    await context.route(sessionRoute, async (route) => {
      if (swapped) return route.continue();
      swapped = true;
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), csrf: "token-handed-out-by-the-other-session" } });
    });
    try {
      await page.getByRole("button", { name: /当前身份/ }).click();
      await page.getByRole("menuitem", { name: "退出登录" }).click();
      await page.getByRole("status").filter({ hasText: "登录状态已在别处更改" }).waitFor({ timeout: 10_000 });
      for (let wait = 0; wait < 50 && sessionReads() === before; wait += 1) await page.waitForTimeout(100);
      if (sessionReads() === before) throw new Error("session_not_read_again");
      // Still the same signed-in workspace, and the refusal was not reported as a failed sign-out or as a lack of permission.
      await page.getByRole("button", { name: /当前身份/ }).waitFor();
      if (await page.getByText("进入团队工作空间").count()) throw new Error("signed_out_by_a_stale_token");
      if (await page.getByText("退出登录没有成功").count()) throw new Error("stale_token_reported_as_failed_sign_out");
      if (await page.getByText("当前身份无权访问").count()) throw new Error("stale_token_reported_as_forbidden");
    } finally {
      await context.unroute(logoutRoute);
      await context.unroute(sessionRoute);
      // The browser reports a refused request to the console a moment after the response; keep expecting it until it has.
      await page.waitForTimeout(500);
      expectRefusedLogout = false;
    }
    // The page now holds the made-up token; read the real session again before the next check.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /当前身份/ }).waitFor({ timeout: 30_000 });
    // Let the page's own code finish loading before the next check moves on: a reload that cuts a module fetch short is logged as an error.
    await page.locator("[data-page]").first().waitFor({ timeout: 30_000 });
  });
  await check("a refusal that comes back with the same token (a proxy stripping Origin) stops the page after one session read, instead of reloading in a loop", async () => {
    const logoutRoute = "**/api/control-center/v1/auth/logout";
    const sessionReads = () => requests.filter((request) => request.path.endsWith("/api/control-center/v1/session")).length;
    const before = sessionReads();
    expectRefusedLogout = true;
    await context.route(logoutRoute, (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "csrf_denied", class: "forbidden" }) }));
    try {
      await page.getByRole("button", { name: /当前身份/ }).click();
      await page.getByRole("menuitem", { name: "退出登录" }).click();
      await page.getByText("服务端拒绝了本页发出的请求").waitFor({ timeout: 10_000 });
      if (await page.getByText("登录状态已在别处更改").count()) throw new Error("same_token_reported_as_replaced_session");
      // One read of the session, and then nothing more: no round of reads and writes follows.
      const settled = sessionReads();
      if (settled !== before + 1) throw new Error(`session_reads:${settled - before}`);
      await page.waitForTimeout(3_000);
      if (sessionReads() !== settled) throw new Error("page_kept_reloading_after_the_refusal");
    } finally {
      await context.unroute(logoutRoute);
      // The browser reports a refused request to the console a moment after the response; keep expecting it until it has.
      await page.waitForTimeout(500);
      expectRefusedLogout = false;
    }
    // The button on that screen checks again, and the working server lets the page back in.
    await page.getByRole("button", { name: "重新检查" }).click();
    await page.getByRole("button", { name: /当前身份/ }).waitFor({ timeout: 30_000 });
    await page.locator("[data-page]").first().waitFor({ timeout: 30_000 });
  });
  await check("logout clears the workspace", async () => {
    await page.getByRole("button", { name: /当前身份/ }).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await page.getByText("进入团队工作空间").waitFor();
    if (await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("yeisme.recent.v1:")))) throw new Error("recent_items_survived_logout");
  });
  await check("no provider submit, cancel or unexpected mutation", async () => {
    const allowed = /\/auth\/personal$|\/auth\/logout$|\/artifacts\/[^/]+\/access$|content:read$|\/notifications(?:\/|$)/;
    const mutations = requests.filter((request) => request.method !== "GET" && request.method !== "HEAD" && !allowed.test(request.path) && !request.expected);
    if (mutations.length) throw new Error(mutations.map((request) => `${request.method} ${request.path}`).join(", "));
    if (requests.some((request) => /provider-runs|\/tasks\/[^/]+\/cancel|\/tasks\/[^/]+$/.test(request.path) && request.method === "DELETE")) throw new Error("provider run, cancel, or task delete requested");
  });
  await check("no runtime errors (rich)", async () => {
    if (devServerHiccups.length) await fs.writeFile(path.join(run, "artifacts", "dev-server-hiccups.json"), JSON.stringify(devServerHiccups.map((text) => text.slice(0, 300)), null, 2) + "\n");
    if (errors.length) throw new Error(errors.join(" | "));
  });
  // Last of the rich scenario, because it fills one sign-in allowance of this fixture for the machine's address. Sign-ins go through the
  // dev server's proxy, each with another invented address in the forwarding header the client writes. If the proxy let it pass, each
  // would be a client of its own and none would be refused; it replaces the header with the address on its own connection, so they are
  // one client, and the sixth refusal of one account from one address is turned away up front.
  await check("the dev server's proxy counts a client by its connection, never by the forwarding header it wrote", async () => {
    const attempt = (invented: string) => fetch(`${ui}/api/control-center/v1/auth/personal`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": invented },
      body: JSON.stringify({ username: "fixture-admin", key: "a-key-that-is-not-the-key" }),
    });
    const answers: number[] = [];
    for (let i = 1; i <= 6; i++) answers.push((await attempt(`203.0.113.${i}`)).status);
    if (answers.join() !== "401,401,401,401,401,429") throw new Error(`forwarding_header_believed_through_the_dev_proxy:${answers.join()}`);
  });
  await context.close();

  await stopFixture(fixture);
  fixture = await startFixture("rich", 900);
  const slow = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const slowPage = await slow.newPage();
  await check("late responses from the previous scope are discarded", async () => {
    await login(slowPage);
    await slowPage.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await slowPage.getByRole("button", { name: /当前授权范围/ }).click();
    await slowPage.getByRole("menuitem", { name: /海岸来信/ }).click();
    await slowPage.waitForTimeout(6000);
    if (await slowPage.locator('[data-task="run-2410-active"]').count()) throw new Error("late fixture-a rows rendered in fixture-b");
    await slowPage.locator('[data-task^="run-c-"]').first().waitFor({ timeout: 30_000 });
  });
  await slow.close();

  await stopFixture(fixture);
  fixture = await startFixture("degraded");
  const degraded = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const degradedPage = await degraded.newPage();
  const degradedErrors: string[] = [];
  degradedPage.on("pageerror", (error) => degradedErrors.push(error.message));
  await check("degraded: unavailable source stays visible while others render", async () => {
    await login(degradedPage);
    await degradedPage.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await degradedPage.getByText("来源不可用").first().waitFor({ timeout: 30_000 });
    await degradedPage.locator('[data-task="run-2410-active"]').waitFor({ timeout: 30_000 });
    await degradedPage.goto(`${ui}/#/requests`, { waitUntil: "domcontentloaded" });
    await degradedPage.getByText(/Scaena.*来源不可用|来源不可用/).first().waitFor({ timeout: 30_000 });
    await shot(degradedPage, "degraded-requests");
    if (degradedErrors.length) throw new Error(degradedErrors.join(" | "));
  });
  await check("degraded: owner outage shows read failures on the board instead of invented stage states", async () => {
    await degradedPage.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
    await degradedPage.locator("li[data-episode]").first().waitFor({ timeout: 30_000 });
    const text = await degradedPage.locator("main").innerText();
    if (!text.includes("读取失败")) throw new Error("read_failure_not_shown");
    if (text.includes("已推进到制作拆解")) throw new Error("outage_reported_as_progress");
    if (await degradedPage.locator("li[data-episode] ol li[data-state='accepted']").count()) throw new Error("accepted_state_invented_during_outage");
    await shot(degradedPage, "degraded-drama");
    if (degradedErrors.length) throw new Error(degradedErrors.join(" | "));
  });
  await check("degraded: each page keeps source notices to one line and reaches 服务与连接 in one step", async () => {
    // The top bar carries the source status on every width; a page adds at most one line and never repeats the cause.
    const routes = ["", "tasks", "assets", "review", "projects", "requests", "drama", "services", "capabilities", "usage", "reminders"];
    for (const [width, height] of [[1440, 960], [390, 844]] as const) {
      await degradedPage.setViewportSize({ width, height });
      for (const route of routes) {
        await degradedPage.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
        await degradedPage.locator("[data-page]").first().waitFor({ timeout: 30_000 });
        await expect(degradedPage.locator("[data-source-status]")).toHaveAttribute("data-source-status", "partial", { timeout: 30_000 });
        await degradedPage.waitForTimeout(600);
        const layout = await degradedPage.evaluate(() => {
          const shown = (element: Element) => element.getClientRects().length > 0;
          const main = document.getElementById("main")!;
          return {
            stacks: [...main.querySelectorAll(".notice-stack")].filter(shown).map((element) => Math.round(element.getBoundingClientRect().height)),
            causes: [...main.querySelectorAll("[data-notice]")].filter((element) => shown(element) && /个连接暂不可读|数据可能已过期/.test(element.textContent || "")).length,
          };
        });
        const where = `${route || "home"}@${width}`;
        if (layout.stacks.length > 1 || layout.stacks.some((value) => value > 48)) throw new Error(`notices_over_one_line:${where}:${layout.stacks.join(",")}`);
        if (layout.causes > 1) throw new Error(`source_cause_repeated:${where}`);
        if (route === "" && layout.causes) throw new Error("home_repeats_the_work_queue_source_items");
      }
      if (!await degradedPage.locator("[data-source-status]").isVisible()) throw new Error(`top_bar_source_status_hidden@${width}`);
      for (const route of ["tasks", "assets", "review"]) {
        await degradedPage.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
        const line = degradedPage.locator(".notice-stack [data-notice]", { hasText: "个连接暂不可读" });
        await line.waitFor({ timeout: 30_000 });
        if (width === 1440 && !(await line.innerText()).includes("Scaena · 片场委托")) throw new Error(`gap_not_named:${route}`);
        await line.getByRole("button", { name: "服务与连接" }).click();
        await degradedPage.locator('[data-page="services"]').waitFor({ timeout: 15_000 });
      }
      await degradedPage.goto(`${ui}/#/`, { waitUntil: "domcontentloaded" });
      await degradedPage.getByRole("button", { name: /可读连接/ }).click();
      await degradedPage.locator('[data-page="services"]').waitFor({ timeout: 15_000 });
    }
    await degradedPage.setViewportSize({ width: 1440, height: 960 });
    await degradedPage.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await degradedPage.locator("[data-source-status]").click();
    const popover = degradedPage.getByRole("dialog").filter({ hasText: "任务连接" });
    // Two connections are refused in this scope (an old Eikona project and an Anatomia key without observer scope).
    await popover.getByText("需要 owner 授权").first().waitFor();
    await shot(degradedPage, "degraded-source-status");
    await popover.getByRole("button", { name: "查看服务与连接" }).click();
    await degradedPage.locator('[data-page="services"]').waitFor({ timeout: 15_000 });
    if (await popover.count()) throw new Error("source_popover_left_open_after_navigation");
    if (degradedErrors.length) throw new Error(degradedErrors.join(" | "));
  });
  const degradedAxe = async (theme: Theme) => {
    const tag = themed(theme);
    for (const [width, height] of [[1440, 960], [390, 844]] as const) {
      await degradedPage.setViewportSize({ width, height });
      for (const route of ["", "tasks", "assets", "review"]) {
        await degradedPage.goto(`${ui}/#/${route}`, { waitUntil: "domcontentloaded" });
        await settled(degradedPage);
        await expect(degradedPage.locator("[data-source-status]")).toHaveAttribute("data-source-status", "partial", { timeout: 30_000 });
        await expectAccessible(degradedPage, tag(`degraded-${route || "home"}@${width}`));
      }
      const toggle = degradedPage.locator(".notice-stack-toggle");
      if (await toggle.count()) {
        await toggle.click();
        await expectAccessible(degradedPage, tag(`degraded-notice-open@${width}`));
        // The pointer that clicked the toggle can end up on a button of the notice once it has unfolded, which a layout a few pixels
        // different decides (that is how a slower machine first found this). So a button of the notice is scanned with the
        // pointer on it, every time: hovering one used to take its label from 4.9:1 to 4.3:1.
        const action = degradedPage.locator(".notice-stack [data-notice-actions] button").first();
        if (await action.count()) {
          await action.hover();
          await expectAccessible(degradedPage, tag(`degraded-notice-action-hovered@${width}`));
        }
        await toggle.click();
      }
      await degradedPage.locator("[data-source-status]").click();
      await degradedPage.locator("[data-radix-popper-content-wrapper]").waitFor();
      await expectAccessible(degradedPage, tag(`degraded-source-popover@${width}`), "[data-radix-popper-content-wrapper]");
      await degradedPage.keyboard.press("Escape");
    }
    await degradedPage.setViewportSize({ width: 1440, height: 960 });
  };
  await check("degraded: source lines, their unfolded text and the source popover pass axe", () => degradedAxe("light"));
  await check("degraded in the dark theme: source lines, their unfolded text and the source popover pass axe", () => inDarkTheme(degradedPage, () => degradedAxe("dark")));
  await check("degraded: a failed read keeps the last batch and says it may be old", async () => {
    await degradedPage.goto(`${ui}/#/assets`, { waitUntil: "domcontentloaded" });
    const results = degradedPage.locator('[data-page="assets"] [data-result]');
    await results.first().waitFor({ timeout: 30_000 });
    const before = await results.count();
    const status = degradedPage.locator("[data-source-status]");
    const blocked = /\/v1\/(tasks|connections)\?/;
    await degradedPage.route(blocked, (route) => route.abort("failed"));
    try {
      // Both task lanes must fail; the history lane is served from cache for up to 30 s, and backoff spaces cycles.
      await expect(status).toHaveAttribute("data-source-status", "stale", { timeout: 90_000 });
      await degradedPage.locator(".notice-stack [data-notice]", { hasText: "数据可能已过期" }).waitFor();
      if (await results.count() !== before) throw new Error(`stale_batch_dropped:${before}->${await results.count()}`);
      await shot(degradedPage, "degraded-stale-assets");
    } finally {
      await degradedPage.unroute(blocked);
    }
    await degradedPage.locator(".notice-stack [data-notice]", { hasText: "数据可能已过期" }).getByRole("button", { name: "重新读取" }).click();
    await expect(status).toHaveAttribute("data-source-status", "partial", { timeout: 30_000 });
    if (await results.count() !== before) throw new Error("batch_changed_after_recovery");
    if (degradedErrors.length) throw new Error(degradedErrors.join(" | "));
  });
  await degraded.close();

  // Credential lifecycle: DriveBridge's token runs out in three days, and the token the Gateway is configured with is one its owner refuses.
  await stopFixture(fixture);
  fixture = await startFixture("rich", 0, { FIXTURE_CREDENTIALS: "lifecycle", FIXTURE_BACKGROUND: "on" });
  const lifecycle = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const lifecyclePage = await lifecycle.newPage();
  const lifecycleErrors: string[] = [];
  lifecyclePage.on("pageerror", (error) => lifecycleErrors.push(error.message));
  await check("credentials: the expiring and the refused token are marked on their cards, refused rows come first and the renew link opens the guide", async () => {
    await login(lifecyclePage);
    await lifecyclePage.goto(`${ui}/#/services`, { waitUntil: "domcontentloaded" });
    const panel = lifecyclePage.getByRole("region", { name: "凭据" });
    await panel.waitFor({ timeout: 30_000 });
    const gatewayRow = panel.locator('[data-credential-row="open_tool:gateway"]');
    await expect(gatewayRow).toHaveAttribute("data-state", "rejected", { timeout: 30_000 });
    await expect(panel.locator('[data-credential-row="open_tool:drivebridge"]')).toHaveAttribute("data-state", "expiring");
    // Problem rows come first and, among them, the refused ones; healthy rows fold away below.
    const states = await panel.locator("[data-credential-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-state")));
    if (states[0] !== "rejected") throw new Error(`refused_row_not_first:${states.join(",")}`);
    if (states.lastIndexOf("rejected") > states.indexOf("expiring")) throw new Error(`refused_after_expiring:${states.join(",")}`);
    const firstQuiet = states.findIndex((state) => state === "unknown_expiry" || state === "ok");
    if (firstQuiet >= 0 && states.slice(0, firstQuiet).some((state) => state === "unknown_expiry" || state === "ok") || states.slice(firstQuiet).some((state) => state !== "unknown_expiry" && state !== "ok")) throw new Error(`quiet_rows_not_last:${states.join(",")}`);
    if (await panel.locator("[data-credentials-quiet]").evaluate((details) => (details as HTMLDetailsElement).open)) throw new Error("healthy_rows_not_collapsed");
    // Cards: the footer chip says what is wrong, and an expiring or refused token links to its renewal steps.
    const drive = lifecyclePage.locator('[data-open-tool="drivebridge"] [data-credential="open_tool:drivebridge"]');
    await drive.getByText(/\d{2}-\d{2} 到期 · 还剩 3 天/).waitFor({ timeout: 20_000 });
    const renew = drive.getByRole("link", { name: /续签方法/ });
    if (await renew.getAttribute("href") !== "#/guide/connect?section=guide-renew-drivebridge") throw new Error(`renew_href:${await renew.getAttribute("href")}`);
    const gatewayChip = lifecyclePage.locator('[data-open-tool="gateway"] [data-credential="open_tool:gateway"]');
    await gatewayChip.getByText("凭据被拒").waitFor({ timeout: 20_000 });
    if (await gatewayChip.getByRole("link", { name: /续签方法/ }).getAttribute("href") !== "#/guide/connect?section=guide-renew-gateway") throw new Error("gateway_renew_href");
    // An administrator sees how to record an expiry that is missing; nothing on the page names a path or an address.
    await panel.locator("[data-credential-backfill]").getByText("credential <config-file> expiry <slot> <RFC3339>", { exact: false }).waitFor();
    const text = await lifecyclePage.locator('[data-page="services"]').innerText();
    for (const leaked of [openToolToken, "fixture-open-tool-revoked", "/tmp/", "credential_ref", "127.0.0.1"]) if (text.includes(leaked)) throw new Error(`credential_leak:${leaked}`);
    await shot(lifecyclePage, "services-credentials");
    await expectAccessible(lifecyclePage, "services-credentials");
    await panel.locator("[data-credentials-quiet] summary").click();
    await expectAccessible(lifecyclePage, "services-credentials-open");
    // The link lands on that tool's renewal steps inside the 接入 chapter.
    await renew.click();
    await lifecyclePage.waitForURL(/#\/guide\/connect\?section=guide-renew-drivebridge/);
    const heading = lifecyclePage.locator("#guide-renew-drivebridge");
    await heading.waitFor({ timeout: 15_000 });
    await expect(heading).toBeInViewport({ timeout: 10_000 });
    await lifecyclePage.getByRole("navigation", { name: "指南章节" }).getByRole("link", { name: "接入", exact: true }).waitFor();
    const steps = await lifecyclePage.locator('[data-renew-tool="drivebridge"]').innerText();
    if (!steps.includes("agents create") || !steps.includes("state_in_use") || !steps.includes("credential <config-file> replace open_tool:drivebridge")) throw new Error("renew_steps_missing");
    if (lifecycleErrors.length) throw new Error(lifecycleErrors.join(" | "));
  });
  await check("credentials in the dark theme: the panel and its folded rows pass axe", () => inDarkTheme(lifecyclePage, async () => {
    await lifecyclePage.goto(`${ui}/#/services`, { waitUntil: "domcontentloaded" });
    const panel = lifecyclePage.getByRole("region", { name: "凭据" });
    await panel.waitFor({ timeout: 30_000 });
    await expect(panel.locator('[data-credential-row="open_tool:gateway"]')).toHaveAttribute("data-state", "rejected", { timeout: 30_000 });
    await settled(lifecyclePage);
    await panel.locator("[data-credentials-quiet] summary").click();
    await expectAccessible(lifecyclePage, "services-credentials@dark");
  }));
  await lifecycle.close();

  // Reminder delivery: the same fixture, whose background observation is run by hand, read by a page with a recording
  // stand-in for desktop notifications and a clock the checks move forward.
  const delivery = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await delivery.addInitScript(notificationMock);
  const deliveryPage = await delivery.newPage();
  const deliveryErrors: string[] = [];
  deliveryPage.on("pageerror", (error) => deliveryErrors.push(error.message));
  await deliveryPage.clock.install();
  type Shown = { title: string; body: string; tag: string };
  const shownNotices = () => deliveryPage.evaluate(() => (window as unknown as { __notify: { shown: Shown[] } }).__notify.shown);
  const permissionAsked = () => deliveryPage.evaluate(() => (window as unknown as { __notify: { state: { requests: number } } }).__notify.state.requests);
  const hidePage = (hidden: boolean) => deliveryPage.evaluate((value) => (window as unknown as { __setHidden: (hidden: boolean) => void }).__setHidden(value), hidden);
  /** A minute and a bit passes in the page: the re-read of reminders runs once. */
  const aMinute = () => deliveryPage.clock.fastForward(61_000);
  /** Whether the baseline the page keeps for this scope holds a reminder: it holds what the page has seen or was there when the switch was turned on. */
  const baselineHas = (id: string) => deliveryPage.evaluate((value) => {
    const key = Object.keys(localStorage).find((name) => name.startsWith("yeisme.control.desktop-notifications"));
    return !!key && ((JSON.parse(localStorage.getItem(key) || "{}").baselines || {})["fixture-a"] || []).includes(value);
  }, id);
  /** Lets minutes pass, one at a time, until the page's baseline does (or does not) hold the reminder: a read still on its way is waited for, not raced. */
  const untilBaseline = async (id: string, wanted: boolean) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await aMinute();
      const stop = Date.now() + 4_000;
      while (Date.now() < stop) {
        if (await baselineHas(id) === wanted) return;
        await deliveryPage.waitForTimeout(150);
      }
    }
    throw new Error(`baseline_${wanted ? "lacks" : "keeps"}:${id.slice(-6)}`);
  };
  type Listed = { id: string; state: string; category: string; title: string; snoozed_until: string | null; recovered_at: string | null };
  const listed = () => deliveryPage.evaluate(async () => (await (await fetch("/api/control-center/v1/notifications?scope=fixture-a&limit=100", { credentials: "same-origin" })).json()).rows as Listed[]);
  const unreadNow = (rows: Listed[]) => rows.filter((row) => row.state === "unread" && !row.recovered_at && !(row.snoozed_until && Date.parse(row.snoozed_until) > Date.now()));
  const counts = async () => ({
    page: Number(await deliveryPage.locator("[data-page=reminders]").getAttribute("data-unread")),
    nav: Number(await deliveryPage.locator("[data-nav=reminders]").getAttribute("data-badge") || 0),
    bell: Number(await deliveryPage.locator("[data-attention-count]").getAttribute("data-attention-count") || 0),
  });
  const openReminders = async () => {
    await deliveryPage.goto(`${ui}/#/reminders`, { waitUntil: "domcontentloaded" });
    await deliveryPage.locator("[data-page=reminders]").waitFor({ timeout: 30_000 });
    await deliveryPage.locator("[data-reminder]").first().waitFor({ timeout: 30_000 });
  };
  const rowMenu = async (row: ReturnType<Page["locator"]>) => { await row.getByRole("button", { name: /^更多操作/ }).click(); };
  /** Opens one group of reminders and waits until it is the one shown, so no row of the group left behind is read. */
  const openGroup = async (name: RegExp) => {
    await deliveryPage.getByRole("tab", { name }).click();
    await deliveryPage.getByRole("tab", { name, selected: true }).waitFor();
  };

  /** The reminders that were unread when the switch was turned on: the ones that never notify. */
  let unreadAtSwitchOn: string[] = [];
  await check("desktop notifications: permission is asked only by the switch, and each new unread reminder notifies once while the page is hidden", async () => {
    await login(deliveryPage);
    await openReminders();
    if (await permissionAsked() !== 0) throw new Error("permission_asked_on_load");
    const toggle = deliveryPage.getByRole("switch", { name: "桌面通知" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toBeEnabled();
    unreadAtSwitchOn = unreadNow(await listed()).map((row) => row.id);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    if (await permissionAsked() !== 1) throw new Error(`permission_asked:${await permissionAsked()}`);
    // In view, a minute passes and nothing is shown.
    await aMinute();
    if ((await shownNotices()).length) throw new Error("notified_while_in_view");
    // Out of view, the server's background observation writes a burst of new reminders.
    const before = new Set((await listed()).map((row) => row.id));
    await hidePage(true);
    const cycle = await observeNow();
    if (cycle.opened < 5) throw new Error(`expected_a_burst:${cycle.opened}`);
    await aMinute();
    await deliveryPage.waitForFunction(() => (window as unknown as { __notify: { shown: unknown[] } }).__notify.shown.length > 0, undefined, { timeout: 15_000 });
    await deliveryPage.waitForTimeout(500);
    const fresh = unreadNow(await listed()).filter((row) => !before.has(row.id));
    const shown = await shownNotices();
    const individual = shown.filter((notice) => notice.tag !== "reminders-summary");
    const summary = shown.filter((notice) => notice.tag === "reminders-summary");
    // At most three of them, one each; the rest of the burst is one summary that says how many.
    if (individual.length !== Math.min(3, fresh.length) || new Set(individual.map((notice) => notice.tag)).size !== individual.length) throw new Error(`individual:${individual.length} of ${fresh.length}`);
    if (fresh.length > 3 ? summary.length !== 1 || !summary[0].body.startsWith(`另有 ${fresh.length - 3} 条新提醒`) : summary.length !== 0) throw new Error(`summary:${JSON.stringify(summary)}`);
    for (const notice of individual) if (!fresh.some((row) => row.id === notice.tag)) throw new Error(`not_a_new_reminder:${notice.tag}`);
    // Names and counts only: no reminder's own title, no task text.
    for (const notice of shown) for (const row of fresh) if (row.title && (notice.body.includes(row.title) || notice.title.includes(row.title))) throw new Error(`title_in_notification:${row.title}`);
    if (!shown.every((notice) => notice.title === "控制中心提醒" && /共 \d+ 条未读/.test(notice.body))) throw new Error(`notification_shape:${JSON.stringify(shown)}`);
    // Another minute, or two, shows nothing again.
    await aMinute();
    await aMinute();
    if ((await shownNotices()).length !== shown.length) throw new Error("notified_twice");
    // One new reminder gives exactly one notification, with the reminder's own tag. DriveBridge's token comes within a day of running out.
    const known = new Set((await listed()).map((row) => row.id));
    const next = await observeNow(2.5);
    if (next.opened !== 1) throw new Error(`expected_one_new_reminder:${next.opened}`);
    await aMinute();
    await deliveryPage.waitForFunction((count) => (window as unknown as { __notify: { shown: unknown[] } }).__notify.shown.length > count, shown.length, { timeout: 15_000 });
    const added = (await shownNotices()).slice(shown.length);
    const newest = (await listed()).filter((row) => !known.has(row.id));
    if (added.length !== 1 || newest.length !== 1 || added[0].tag !== newest[0].id || !added[0].body.startsWith("DriveBridge · 凭据")) throw new Error(`one_notification:${JSON.stringify(added)} for ${JSON.stringify(newest.map((row) => row.title))}`);
    await aMinute();
    if ((await shownNotices()).length !== shown.length + 1) throw new Error("new_reminder_notified_twice");
    // What arrives while the page is in view is seen there: it does not notify later, when the page is hidden again.
    await hidePage(false);
    const seen = await observeNow(2);
    if (seen.opened !== 1) throw new Error(`expected_one_more_reminder:${seen.opened}`);
    const arrived = (await listed()).find((row) => row.state === "unread" && !row.recovered_at && /已过期/.test(row.title));
    if (!arrived) throw new Error("expected_the_expired_reminder");
    // The page has seen it once it is in the baseline the page keeps; a read still on its way would otherwise land after the page was hidden.
    await untilBaseline(arrived.id, true);
    await hidePage(true);
    await aMinute();
    await aMinute();
    const late = (await shownNotices()).slice(shown.length + 1);
    if (late.length) throw new Error(`notified_for_what_was_in_view:${JSON.stringify(late)}`);
    await hidePage(false);
    if (deliveryErrors.length) throw new Error(deliveryErrors.join(" | "));
  });
  await check("reminders: a snoozed reminder leaves the count and comes back, an archived one is reopened, and they say where they came from", async () => {
    await openReminders();
    await expect(deliveryPage.locator("[data-reminder-kind=credential]").first()).toBeVisible({ timeout: 20_000 });
    const start = await counts();
    if (start.page === 0 || start.nav !== start.page || start.bell !== start.page) throw new Error(`counts_disagree:${JSON.stringify(start)}`);
    // A credential reminder is its own kind: no task version, no per-task mute, snooze choices instead.
    const credentialRow = deliveryPage.locator("[data-reminder-kind=credential][data-reminder]").first();
    if (await credentialRow.locator("[data-reminder-version]").count()) throw new Error("credential_shows_task_version");
    await rowMenu(credentialRow);
    for (const gone of ["此任务以后都免提醒", /^相同错误码/]) if (await deliveryPage.getByRole("menuitem", { name: gone }).count()) throw new Error(`credential_offers:${gone}`);
    for (const offered of ["稍后提醒：1 小时后", "稍后提醒：明天上午", "稍后提醒：下周一上午", "归档"]) await deliveryPage.getByRole("menuitem", { name: offered }).waitFor({ timeout: 5_000 });
    await deliveryPage.keyboard.press("Escape");
    if (!(await credentialRow.innerText()).includes("凭据")) throw new Error("credential_row_unlabelled");
    // Snooze it for an hour: the count drops everywhere, and the row moves to the quiet ones.
    const snoozedId = await credentialRow.getAttribute("data-reminder");
    await rowMenu(credentialRow);
    await deliveryPage.getByRole("menuitem", { name: "稍后提醒：1 小时后" }).click();
    await deliveryPage.waitForFunction((was) => Number(document.querySelector("[data-page=reminders]")?.getAttribute("data-unread")) === was - 1, start.page, { timeout: 15_000 });
    const snoozed = await counts();
    if (snoozed.nav !== start.page - 1 || snoozed.bell !== start.page - 1) throw new Error(`snooze_not_counted_everywhere:${JSON.stringify(snoozed)}`);
    await openGroup(/已降噪/);
    const quiet = deliveryPage.locator(`[data-reminder="${snoozedId}"]`);
    await expect(quiet).toHaveAttribute("data-snoozed", "true", { timeout: 10_000 });
    if (!(await quiet.innerText()).includes("稍后提醒")) throw new Error("snooze_not_shown");
    // Reopened early, it counts again.
    await rowMenu(quiet);
    await deliveryPage.getByRole("menuitem", { name: "重新打开" }).click();
    await deliveryPage.waitForFunction((was) => Number(document.querySelector("[data-page=reminders]")?.getAttribute("data-unread")) === was, start.page, { timeout: 15_000 });
    // Archive one, then reopen it from the archived group with its own button.
    await openGroup(/新失败/);
    const archivedRow = deliveryPage.locator("[data-reminder]").first();
    const archivedId = await archivedRow.getAttribute("data-reminder");
    await rowMenu(archivedRow);
    await deliveryPage.getByRole("menuitem", { name: "归档" }).click();
    await deliveryPage.waitForFunction((was) => Number(document.querySelector("[data-page=reminders]")?.getAttribute("data-unread")) === was - 1, start.page, { timeout: 15_000 });
    await openGroup(/已归档/);
    const archived = deliveryPage.locator(`[data-reminder="${archivedId}"]`);
    await archived.waitFor({ timeout: 10_000 }).catch(async (error) => {
      const rowsHere = await deliveryPage.locator("[data-reminder]").evaluateAll((rows) => rows.map((row) => `${row.getAttribute("data-reminder")?.slice(-6)}:${row.getAttribute("data-reminder-kind")}`));
      const tabs = await deliveryPage.getByRole("tab").allInnerTexts();
      await shot(deliveryPage, "reminders-archived-missing");
      throw new Error(`archived_row_missing:${archivedId?.slice(-6)} rows=${rowsHere.join(",")} tabs=${tabs.join("|").replace(/\s+/g, " ")} url=${deliveryPage.url()} (${String(error).slice(0, 80)})`);
    });
    await archived.getByRole("button", { name: "重新打开", exact: true }).click();
    await archived.waitFor({ state: "detached", timeout: 10_000 });
    await deliveryPage.waitForFunction((was) => Number(document.querySelector("[data-page=reminders]")?.getAttribute("data-unread")) === was, start.page, { timeout: 15_000 });
    const end = await counts();
    if (end.nav !== start.page || end.bell !== start.page) throw new Error(`counts_after_reopen:${JSON.stringify(end)}`);
    // An open-tool run that failed is its own kind too, with the same pieces missing.
    await openGroup(/新失败/);
    const operationRow = deliveryPage.locator("[data-reminder-kind=operation][data-reminder]").first();
    await operationRow.waitFor({ timeout: 10_000 });
    if (await operationRow.locator("[data-reminder-version]").count() || !(await operationRow.innerText()).includes("工具运行")) throw new Error("operation_row_shape");
    // The bell names credential reminders by what they are, not as project collaboration.
    await deliveryPage.getByRole("button", { name: /^需要关注/ }).click();
    const bellRows = deliveryPage.locator("[data-notification]");
    await bellRows.first().waitFor({ timeout: 10_000 });
    const lines = await bellRows.allInnerTexts();
    if (!lines.some((line) => /· 凭据 · 未读/.test(line))) throw new Error(`bell_labels:${lines.slice(0, 6).join(" // ")}`);
    if (lines.some((line) => /项目协作/.test(line))) throw new Error(`bell_calls_them_collaboration:${lines.join(" // ")}`);
    await deliveryPage.keyboard.press("Escape");
    await shot(deliveryPage, "reminders-delivery");
    await expectAccessible(deliveryPage, "reminders-delivery");
    // The same page in the dark theme, with the switch on and the credential pills in view.
    await inDarkTheme(deliveryPage, async () => {
      await openReminders();
      await settled(deliveryPage);
      await deliveryPage.locator("[data-reminder-kind=credential]").first().waitFor({ timeout: 20_000 });
      await expectAccessible(deliveryPage, "reminders-delivery@dark");
    });
    if (deliveryErrors.length) throw new Error(deliveryErrors.join(" | "));
  });
  // The browser clock the checks above moved belongs to this context, not to one page of it: a check that needs the
  // time to run at the server's pace uses a context of its own. The cross-tab check below uses a second tab of this one.
  const postVia = (page: Page, route: string, body: unknown = {}) => page.evaluate(async ({ route, body }) => {
    const csrf = (await (await fetch("/api/control-center/v1/session", { credentials: "same-origin" })).json()).csrf as string;
    const response = await fetch(`/api/control-center/v1${route}?scope=fixture-a`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${route}:${response.status}`);
  }, { route, body });
  /** A page that gains focus reads the reminders again at once. */
  const wakeUp = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const unreadOf = async (page: Page) => Number(await page.locator("[data-page=reminders]").getAttribute("data-unread"));
  const tabCount = async (page: Page, name: RegExp) => Number((await page.getByRole("tab", { name }).innerText()).replace(/\D+/g, ""));
  const tabOf = async (page: Page, name: RegExp) => { await page.getByRole("tab", { name }).click(); await page.getByRole("tab", { name, selected: true }).waitFor(); };

  const real = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const realPage = await real.newPage();
  const realErrors: string[] = [];
  realPage.on("pageerror", (error) => realErrors.push(error.message));
  await check("reminders: a snooze that ends on its own moves the row out of the quiet group and into the count again, with no reload and no click", async () => {
    await login(realPage);
    await realPage.goto(`${ui}/#/reminders`, { waitUntil: "domcontentloaded" });
    await realPage.locator("[data-page=reminders]").waitFor({ timeout: 30_000 });
    const row = realPage.locator("[data-reminder]").first();
    await row.waitFor({ timeout: 30_000 });
    const id = (await row.getAttribute("data-reminder"))!;
    const start = await unreadOf(realPage);
    const before = { fresh: await tabCount(realPage, /新失败/), quiet: await tabCount(realPage, /已降噪/) };
    // The page's own sync of the task list hands it fresh rows now and then, which would regroup them by accident; what the
    // end of a snooze does by itself is what is looked at here, so the sync is held off for the length of the check.
    const syncRoute = /\/notifications\/sync(\?|$)/;
    await realPage.route(syncRoute, (route) => route.abort());
    await tabOf(realPage, /已降噪/);
    // The menu starts at an hour; the route takes any time ahead, so a few seconds are asked for directly.
    await postVia(realPage, `/notifications/${encodeURIComponent(id)}/snooze`, { until: new Date(Date.now() + 5_000).toISOString() });
    await wakeUp(realPage);
    const quiet = realPage.locator(`[data-reminder="${id}"]`);
    await expect(quiet).toHaveAttribute("data-snoozed", "true", { timeout: 10_000 });
    await realPage.waitForFunction((was) => Number(document.querySelector("[data-page=reminders]")?.getAttribute("data-unread")) === was - 1, start, { timeout: 10_000 });
    if (await tabCount(realPage, /已降噪/) !== before.quiet + 1 || await tabCount(realPage, /新失败/) !== before.fresh - 1) throw new Error(`tabs_while_snoozed:${await tabCount(realPage, /新失败/)}/${await tabCount(realPage, /已降噪/)}`);
    // The snooze runs out. Nothing is clicked and nothing is reloaded: the row leaves the quiet group, the tabs and the count follow.
    await quiet.waitFor({ state: "detached", timeout: 20_000 });
    await realPage.waitForFunction((was) => Number(document.querySelector("[data-page=reminders]")?.getAttribute("data-unread")) === was, start, { timeout: 10_000 });
    if (await tabCount(realPage, /已降噪/) !== before.quiet || await tabCount(realPage, /新失败/) !== before.fresh) throw new Error(`tabs_after_expiry:${await tabCount(realPage, /新失败/)}/${await tabCount(realPage, /已降噪/)}`);
    await tabOf(realPage, /新失败/);
    const back = realPage.locator(`[data-reminder="${id}"]`);
    await back.waitFor({ timeout: 10_000 });
    if (await back.getAttribute("data-snoozed") !== null || !(await back.innerText()).includes("未查看")) throw new Error(`not_an_ordinary_new_reminder:${(await back.innerText()).replace(/\s+/g, " ")}`);
    const nav = Number(await realPage.locator("[data-nav=reminders]").getAttribute("data-badge") || 0);
    const bell = Number(await realPage.locator("[data-attention-count]").getAttribute("data-attention-count") || 0);
    if (nav !== start || bell !== start) throw new Error(`badge_and_bell_after_expiry:${nav}/${bell} vs ${start}`);
    await realPage.unroute(syncRoute);
    if (realErrors.length) throw new Error(realErrors.join(" | "));
  });
  await real.close();

  // The same account in a second tab of the delivery context: the switch lives in storage the tabs share.
  const live = await delivery.newPage();
  const liveErrors: string[] = [];
  live.on("pageerror", (error) => liveErrors.push(error.message));
  await check("desktop notifications: turning the switch off in one tab stops a tab that is out of sight", async () => {
    await openReminders();
    // The stand-in forgets its permission with each document, as a real browser would not: grant it again, as it still is.
    const grant = (page: Page) => page.evaluate(() => (window as unknown as { Notification: { requestPermission: () => Promise<string> } }).Notification.requestPermission());
    await grant(deliveryPage);
    await wakeUp(deliveryPage);
    const toggle = deliveryPage.getByRole("switch", { name: "桌面通知" });
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
    const now = await listed();
    const candidates = now.filter((row) => unreadAtSwitchOn.includes(row.id) && row.state === "unread" && !row.recovered_at && !(row.snoozed_until && Date.parse(row.snoozed_until) > Date.now()));
    if (candidates.length < 2) throw new Error(`need_two_old_unread_reminders:${candidates.length}`);
    const [first, second] = candidates;
    await live.goto(`${ui}/#/reminders`, { waitUntil: "domcontentloaded" });
    await live.locator("[data-page=reminders]").waitFor({ timeout: 30_000 });
    await hidePage(true);
    const shownBefore = (await shownNotices()).length;
    // Both are handled while the tab is out of sight; it notices that they are no longer unread.
    for (const row of [first, second]) await postVia(live, `/notifications/${encodeURIComponent(row.id)}/archive`);
    await untilBaseline(first.id, false);
    await untilBaseline(second.id, false);
    // With the switch on, a reminder that becomes unread again is news: one notification, with its own tag.
    await postVia(live, `/notifications/${encodeURIComponent(first.id)}/reopen`);
    await aMinute();
    await deliveryPage.waitForFunction((count) => (window as unknown as { __notify: { shown: unknown[] } }).__notify.shown.length > count, shownBefore, { timeout: 15_000 }).catch(async () => { await aMinute(); await deliveryPage.waitForFunction((count) => (window as unknown as { __notify: { shown: unknown[] } }).__notify.shown.length > count, shownBefore, { timeout: 10_000 }); });
    const added = (await shownNotices()).slice(shownBefore);
    if (added.length !== 1 || added[0].tag !== first.id) throw new Error(`control_notification:${JSON.stringify(added)}`);
    // The person turns the switch off in the other tab (where the browser's permission is the same).
    await grant(live);
    await wakeUp(live);
    const liveToggle = live.getByRole("switch", { name: "桌面通知" });
    await expect(liveToggle).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
    await liveToggle.click();
    await expect(liveToggle).toHaveAttribute("aria-checked", "false");
    // The tab that is out of sight hears of it, without a reload, and does not notify for what becomes unread afterwards.
    await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });
    await postVia(live, `/notifications/${encodeURIComponent(second.id)}/reopen`);
    await aMinute();
    await aMinute();
    if ((await shownNotices()).length !== shownBefore + 1) throw new Error(`notified_after_the_switch_was_turned_off:${JSON.stringify((await shownNotices()).slice(shownBefore + 1))}`);
    await hidePage(false);
    if (deliveryErrors.length || liveErrors.length) throw new Error([...deliveryErrors, ...liveErrors].join(" | "));
  });
  await check("the reminders page says what background observation did, in counts", async () => {
    await openReminders();
    const line = deliveryPage.locator("[data-observation-line]");
    await line.waitFor({ timeout: 20_000 });
    const text = await line.innerText();
    if (!/每 10 分钟观察一次/.test(text) || !/上次.*读了 \d+ 页，新增 \d+ 条、恢复 \d+ 条/.test(text) || !/下次/.test(text) || !text.includes("发给你")) throw new Error(`observation_line:${text}`);
    for (const leaked of ["127.0.0.1", "/tmp/", "needs_authorization", "open_tool_", "fx-", "InvalidApiKey"]) if (text.includes(leaked)) throw new Error(`observation_line_leak:${leaked}`);
  });
  await check("the work queue shows a refused or expiring credential as one renewal item, in place of the blocked service, and links to the renewal steps", async () => {
    await deliveryPage.goto(`${ui}/#/home`, { waitUntil: "domcontentloaded" });
    await deliveryPage.locator("#home-work-queue").waitFor({ timeout: 30_000 });
    // The route: one item per credential that needs attention, and the blocked-service item for the refused Gateway is gone.
    const queue = await deliveryPage.evaluate(async () => (await (await fetch("/api/control-center/v1/work-queue?scope=fixture-a&limit=100", { credentials: "same-origin" })).json()).items as { kind: string; owner: string; source_ref: string; title: string; state: string }[]);
    const renewals = queue.filter((item) => item.kind === "credential_renewal").map((item) => `${item.source_ref}:${item.state}`).sort();
    if (!renewals.includes("open_tool:gateway:rejected") || !renewals.includes("open_tool:drivebridge:expiring") || !renewals.includes("connection:fx-eikona-denied:rejected")) throw new Error(`renewal_items:${renewals.join(",")}`);
    if (queue.some((item) => item.kind === "service_blocked" && item.owner === "gateway" && item.source_ref === "gateway")) throw new Error("gateway_listed_twice");
    if (queue.some((item) => item.kind === "service_blocked" && item.source_ref === "fx-eikona-denied")) throw new Error("denied_connection_listed_twice");
    // The page: they have a tab of their own, and an item opens its panel with both links.
    await deliveryPage.getByRole("radio", { name: "凭据" }).click();
    const items = deliveryPage.locator('[data-work-kind="credential_renewal"]');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    const texts = await items.allInnerTexts();
    if (!texts.some((text) => text.includes("MCP Gateway · 凭据被拒")) || !texts.some((text) => text.includes("DriveBridge · 即将到期"))) throw new Error(`credential_items:${texts.join(" // ")}`);
    if ((await deliveryPage.locator("[data-work-kind]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-work-kind")))).some((kind) => kind !== "credential_renewal")) throw new Error("credential_filter_shows_others");
    await deliveryPage.locator('[data-work-kind="credential_renewal"]', { hasText: "MCP Gateway · 凭据被拒" }).getByRole("button").first().click();
    const links = deliveryPage.getByRole("button", { name: "续签方法" });
    await links.waitFor({ timeout: 10_000 });
    await deliveryPage.getByRole("button", { name: "查看凭据状态" }).waitFor();
    await shot(deliveryPage, "home-credential-renewal");
    await links.click();
    await deliveryPage.waitForURL(/#\/guide\/connect\?section=guide-renew-gateway/, { timeout: 15_000 });
    if (deliveryErrors.length) throw new Error(deliveryErrors.join(" | "));
  });
  await live.close();
  await delivery.close();
} finally {
  await stopFixture(fixture);
  await browser.close();
}

for (const result of results) stdout.push(`${result.status.toUpperCase()} ${result.name}${result.detail ? " :: " + result.detail : ""}`);
const status = results.every((result) => result.status === "passed") ? "passed" : "failed";
await fs.writeFile(path.join(run, "stdout.log"), stdout.join("\n") + "\n");
await fs.writeFile(path.join(run, "stderr.log"), stderr.join(""));
await fs.writeFile(path.join(run, "summary.json"), JSON.stringify({ schema_version: "yeisme.integration_test_evidence.v1", status, evidence_layer: "fixture_owner_browser_journey", real_owner_reads: false, provider_calls: false, mutations: false, results }, null, 2) + "\n");
console.log(stdout.join("\n"));
console.log(JSON.stringify({ status, evidence: run }, null, 2));
process.exitCode = status === "passed" ? 0 : 1;
