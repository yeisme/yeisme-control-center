import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect, type Page, type Route } from "@playwright/test";

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

// Accessibility gate: serious and critical axe violations fail the journey. Overlays are scanned on their own, because
// a modal rightly hides the page behind it and a whole-page scan would report that page instead of the overlay.
const axeSource = await fs.readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
type AxeViolation = { id: string; impact?: string | null; nodes: { target: unknown[] }[] };
async function axeViolations(page: Page, scope?: string) {
  // Finite animations finish first, so a page or panel that is still fading in is not read as low contrast.
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))).map((animation) => animation.finished.catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]));
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
  // Connecting a tool project or managing a collected record is a control-center action (owners are only read). While a
  // check does it on purpose, its preview, confirm and sync are expected, and so are a refused project's 403 and a
  // deliberately stale revision's 409.
  let expectControlActions = false;
  page.on("pageerror", (error) => errors.push(error.message));
  // net::ERR_NETWORK_CHANGED is Chrome reporting that the host's network interfaces changed (container interfaces coming
  // and going on this machine), not an application error; checks that depend on the request still fail on their own.
  page.on("console", (message) => { if (message.type() === "error" && !/401/.test(message.text()) && !/net::ERR_NETWORK_CHANGED/.test(message.text()) && !(ignoreExpectedMediaErrors && /503/.test(message.text())) && !(expectControlActions && /40[39]/.test(message.text()) && /\/actions\/(preview|confirm)/.test(message.location().url))) errors.push(message.text()); });
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
  await check("guide replaces AI creation and switches commands per tool and client", async () => {
    await page.goto(`${ui}/#/creation`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-page="guide"]').waitFor();
    if (!page.url().includes("#/guide")) throw new Error(`creation_not_redirected:${page.url()}`);
    if (await page.locator('[data-nav="creation"]').count()) throw new Error("ai_creation_nav_still_listed");
    await page.locator('[data-nav="guide"][aria-current="page"]').waitFor();
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
    await page.locator("#guide-tool-eikona.is-highlighted").waitFor();
    if (hashParams(page).get("tool") !== "eikona") throw new Error(`guide_link_lost_owner:${page.url()}`);
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
    // Shift+F10 opens the menu under the focused row; Esc closes only the menu and focus goes back to the row.
    await page.goto(`${ui}/#/tasks`, { waitUntil: "domcontentloaded" });
    const row = page.locator('[data-task="run-2395-failed"]');
    const rowButton = row.locator("[data-row-button]");
    await rowButton.focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menu").waitFor();
    const [menuBox, rowBox] = [await page.getByRole("menu").boundingBox(), await row.boundingBox()];
    if (!menuBox || !rowBox || menuBox.x < 1 || menuBox.y < rowBox.y || menuBox.y > rowBox.y + rowBox.height + 8) throw new Error(`keyboard_menu_misplaced:${JSON.stringify({ menuBox, rowBox })}`);
    if (!(await items()).includes("复制任务引用")) throw new Error("task_menu_missing_copy");
    await closeMenu();
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
    await popover.getByText("需要 owner 授权").waitFor();
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
