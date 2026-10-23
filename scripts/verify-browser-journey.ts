import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";

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

async function startFixture(scenario: string, latency = 0) {
  const child = spawn("bun", ["scripts/fixture-preview.ts"], {
    cwd: root,
    env: { ...process.env, FIXTURE_SCENARIO: scenario, FIXTURE_LATENCY_MS: String(latency), FIXTURE_PASSWORD: password, FIXTURE_UI_PORT: String(ports.ui), FIXTURE_API_PORT: String(ports.api), FIXTURE_OWNER_PORT: String(ports.owner) },
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
  await fetch(`http://127.0.0.1:${ports.ui}/`).catch(() => {});
  return child;
}

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

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, status: "passed" });
  } catch (error) {
    results.push({ name, status: "failed", detail: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : String(error) });
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

await portsFree();
let fixture = await startFixture("rich");
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: { method: string; path: string }[] = [];
  let ignoreExpectedMediaErrors = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/401/.test(message.text()) && !(ignoreExpectedMediaErrors && /503/.test(message.text()))) errors.push(message.text()); });
  page.on("request", (request) => requests.push({ method: request.method(), path: new URL(request.url()).pathname }));

  await check("login and scoped session", async () => {
    await login(page);
    const body = await page.locator("main").innerText();
    if (!body.includes("需要处理") || !body.includes("服务状态")) throw new Error("home surface incomplete");
  });
  await check("page headers stay compact while retaining accessible names", async () => {
    for (const route of ["projects", "drama", "tasks", "assets", "requests", "review", "services", "capabilities", "usage", "team", "reminders", "creation"]) {
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
    await page.getByRole("button", { name: "确认", exact: true }).first().click();
    await page.waitForFunction((start) => {
      const current = document.querySelector("[data-page=reminders]")?.getAttribute("data-unread");
      return current !== null && Number(current) < Number(start);
    }, before, { timeout: 15_000 });
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
  await check("creation workbench follows owner input contracts", async () => {
    await page.goto(`${ui}/#/creation`, { waitUntil: "domcontentloaded" });
    await page.getByText("统一多模态工作台").waitFor();
    await page.getByRole("button", { name: /图像 · Eikona/ }).click();
    await page.getByRole("button", { name: "图像放大" }).waitFor();
    await page.getByRole("button", { name: "图像放大" }).click();
    await page.getByText("该创作模式至少需要一个参考素材").waitFor();
    await page.getByRole("button", { name: /视频 · Scaena/ }).click();
    await page.getByRole("button", { name: "关键帧视频" }).click();
    await page.getByText("全时间线关键帧").waitFor();
    await page.getByText("提交生成").waitFor();
    if (!await page.getByText("不调用 Provider").count()) throw new Error("provider_preview_gate_missing");
    await shot(page, "creation-workbench");
  });
  await check("tool catalog lists latest owner tools read-only with inspector and pre-check link", async () => {
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
    await inspector.getByRole("button", { name: "在 AI 创作中预检" }).click();
    await page.getByText("统一多模态工作台").waitFor();
    const creation = hashParams(page);
    if (creation.get("owner") !== "eikona" || creation.get("mode") !== "text_to_image") throw new Error(`precheck_link_lost_mode:${page.url()}`);
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
    await page.locator('[data-task-inspector] [data-inline-media-preview="image"]').waitFor();
    if (!hashParams(page).get("task") || !hashParams(page).get("preview")) throw new Error("quick_preview_did_not_open_task_inspector");
    await page.getByRole("button", { name: "关闭预览" }).click();
    if (hashParams(page).get("preview")) throw new Error("inline_preview_query_not_cleared");
    await page.getByRole("button", { name: "关闭详情" }).click();
  });
  await check("project task opens the shared inspector without leaving project context", async () => {
    await page.goto(`${ui}/#/projects`, { waitUntil: "domcontentloaded" });
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
    await page.getByRole("button", { name: "预览 林晚 定妆 A.png" }).click();
    await dialog.locator('[data-inline-media-preview="image"] img').waitFor({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "查看全图" }).click();
    if (await dialog.locator('[data-inline-media-preview="image"]').getAttribute("data-inline-media-expanded") !== "true") throw new Error("image_full_preview_not_expanded");
    await dialog.getByRole("button", { name: "收起全图" }).click();
    if (!hashParams(page).get("preview")) throw new Error("task_detail_did_not_write_preview_query");
    await shot(page, "task-detail");
    await dialog.getByRole("button", { name: "关闭预览" }).click();
    if (hashParams(page).get("preview")) throw new Error("task_inline_preview_query_not_cleared");
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
    await inspector.getByText("选择“预览”后在这里查看内容").waitFor();
    if (hashParams(page).get("preview")) throw new Error("asset_selection_auto_opened_preview");
    await inspector.getByRole("button", { name: /预览 .*/ }).click();
    await inspector.locator(".asset-preview-stage img").waitFor();
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.locator('[data-asset-inspector]').waitFor({ state: "detached" });
  });
  await check("asset details keep preview explicit", async () => {
    await page.goto(`${ui}/#/assets?kind=image`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /打开 .* 详情/ }).first().click();
    const inspector = page.locator('[data-asset-inspector]');
    await inspector.getByRole("heading", { name: "来源与版本" }).waitFor();
    await inspector.getByRole("heading", { name: "生产过程" }).waitFor();
    if (hashParams(page).get("preview")) throw new Error("asset_details_auto_opened_preview");
    await inspector.getByRole("button", { name: /预览 .*/ }).click();
    await inspector.locator(".asset-preview-stage img").waitFor();
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
  await check("audio preview keeps a floating player contract", async () => {
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
      await audioCard.getByRole("button", { name: /打开 .* 详情/ }).click();
      await page.locator('[data-asset-inspector]').getByRole("button", { name: /播放 .*/ }).click();
      const audioPreview = page.locator('[data-asset-inspector] [data-inline-media-preview="audio"]');
      await audioPreview.waitFor();
      if (await page.locator(".audio-dock").count()) throw new Error("audio_dock_should_not_exist");
      const audio = audioPreview.locator("audio");
      await audio.waitFor({ state: "attached" });
      if (mediaFailures < 1) throw new Error(`audio_preview_handle_not_requested:${mediaFailures}`);
      await audioPreview.getByRole("button", { name: "关闭预览" }).click();
      if (hashParams(page).get("preview")) throw new Error("audio_preview_query_not_cleared");
    } finally {
      await page.unroute("**/api/control-center/v1/media/**");
      ignoreExpectedMediaErrors = false;
    }
  });
  await check("task audio preview stays inside the Inspector", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    const row = page.locator('[data-task]').filter({ hasText: "片尾环境音乐 · 长版" }).first();
    await row.waitFor();
    await row.getByRole("button").first().click();
    const taskInspector = page.locator('[data-task-inspector]');
    await taskInspector.getByRole("button", { name: /播放 片尾环境音乐/ }).click();
    await taskInspector.locator('[data-inline-media-preview="audio"] audio').waitFor();
    if (await page.locator(".audio-dock").count()) throw new Error("task_audio_dock_should_not_exist");
    await taskInspector.getByRole("button", { name: "关闭预览" }).click();
    await taskInspector.getByRole("button", { name: "关闭详情" }).click();
  });
  await check("downloads preserve the owner filename and MIME extension", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-task="deleg-0409"] button').first().click();
    await page.getByText("雨巷推镜头.mp4").waitFor();
    const taskInspector = page.locator('[data-task-inspector]');
    await taskInspector.getByRole("button", { name: "预览 雨巷推镜头.mp4" }).click();
    await taskInspector.locator('[data-inline-media-preview="video"] video').waitFor();
    if (await page.locator(".media-stage").count()) throw new Error("video_preview_opened_fullscreen_layer");
    await taskInspector.getByRole("button", { name: "关闭预览" }).click();
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
    const mediaAction = dialog.getByRole("button", { name: /预览|播放/ });
    if (await mediaAction.isEnabled()) throw new Error("preview enabled");
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
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
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
  await check("scope switch never renders the previous scope", async () => {
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /当前授权范围/ }).click();
    await page.getByRole("menuitem", { name: /海岸来信/ }).click();
    await page.locator('[data-task^="run-c-"]').first().waitFor({ timeout: 20_000 });
    if (await page.locator('[data-task="run-2410-active"]').count()) throw new Error("previous scope rows rendered");
  });
  await check("a scope without an Auctra connection says so instead of showing another scope's episodes", async () => {
    await page.goto(`${ui}/#/drama`, { waitUntil: "domcontentloaded" });
    await page.getByText("当前范围没有连接 Auctra 收集库").waitFor({ timeout: 20_000 });
    if (await page.locator('li[data-episode="ep-01"]').count() && (await page.locator('li[data-episode="ep-01"]').innerText()).includes("雨停站台")) throw new Error("previous_scope_episode_rendered");
  });
  await check("logout clears the workspace", async () => {
    await page.getByRole("button", { name: /当前身份/ }).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await page.getByText("进入团队工作空间").waitFor();
  });
  await check("no provider submit, cancel or unexpected mutation", async () => {
    const allowed = /\/auth\/personal$|\/auth\/logout$|\/artifacts\/[^/]+\/access$|content:read$|\/notifications(?:\/|$)/;
    const mutations = requests.filter((request) => request.method !== "GET" && request.method !== "HEAD" && !allowed.test(request.path));
    if (mutations.length) throw new Error(mutations.map((request) => `${request.method} ${request.path}`).join(", "));
    if (requests.some((request) => /provider-runs|\/tasks\/[^/]+\/cancel|\/tasks\/[^/]+$/.test(request.path) && request.method === "DELETE")) throw new Error("provider run, cancel, or task delete requested");
  });
  await check("no runtime errors (rich)", async () => { if (errors.length) throw new Error(errors.join(" | ")); });
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
  await degraded.close();
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
