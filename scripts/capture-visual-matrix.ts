import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

// Visual evidence matrix: fixture owners + real server app + Vite, every route in light/dark/mobile
// plus docked-inspector states. Screenshots only; no real owner or Provider calls.

const root = path.resolve(import.meta.dirname, "..");
const label = (process.env.VISUAL_LABEL || "snapshot").replace(/[^a-z0-9-]/gi, "");
const ports = { ui: Number(process.env.VM_UI_PORT || 4630), api: Number(process.env.VM_API_PORT || 4631), owner: Number(process.env.VM_OWNER_PORT || 4632) };
const password = "vm-fixture-" + Math.random().toString(36).slice(2, 10);
const run = path.join(root, `temp/integration-test-runs/visual-matrix-${label}-` + new Date().toISOString().replace(/[:.]/g, "-"));
const routes = ["", "projects", "projects?shared=1", "creation", "drama", "drama?studio=ep-01", "drama?studio=ep-01&station=motion", "prompts", "guide", "guide/flow", "guide/tools", "guide/tools/eikona", "guide/cases", "assets", "activity", "tasks", "reminders", "requests", "review", "services", "mcp-gateway", "agents", "capabilities", "usage", "team", "admin", "admin?tab=audit", "settings"];
const coreRoutes = ["", "projects", "drama", "tasks", "assets", "capabilities", "services", "mcp-gateway", "agents", "guide"];
const viewports = [
  { name: "1440-light", width: 1440, height: 960, theme: "light", routes },
  { name: "1440-dark", width: 1440, height: 960, theme: "dark", routes },
  { name: "1920-light", width: 1920, height: 1080, theme: "light", routes: coreRoutes },
  { name: "1280-light", width: 1280, height: 900, theme: "light", routes: coreRoutes },
  { name: "768-light", width: 768, height: 1024, theme: "light", routes: coreRoutes },
  { name: "390-light", width: 390, height: 844, theme: "light", routes },
] as const;
await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
await fs.writeFile(path.join(run, "command.txt"), `VISUAL_LABEL=${label} bun scripts/capture-visual-matrix.ts\n`);
await fs.writeFile(path.join(run, "env.json"), `${JSON.stringify({
  ports,
  viewports: viewports.map((v) => ({ name: v.name, width: v.width, height: v.height, theme: v.theme, routes: v.routes.length })),
  scenario: "rich",
  real_owner_calls: false,
  provider_calls: false,
  credentials_logged: false,
}, null, 2)}\n`);

function startFixture(): Promise<ChildProcess> {
  const child = spawn("bun", ["scripts/fixture-preview.ts"], {
    cwd: root,
    env: { ...process.env, FIXTURE_SCENARIO: "rich", FIXTURE_PASSWORD: password, FIXTURE_UI_PORT: String(ports.ui), FIXTURE_API_PORT: String(ports.api), FIXTURE_OWNER_PORT: String(ports.owner) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (chunk) => { log += chunk; });
  child.stderr?.on("data", (chunk) => { log += chunk; });
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 60_000;
    const poll = setInterval(() => {
      if (log.includes('"status": "ready"')) { clearInterval(poll); resolve(child); }
      else if (Date.now() > deadline || child.exitCode !== null) { clearInterval(poll); reject(new Error("fixture_start_failed: " + log.slice(-600))); }
    }, 250);
  });
}

async function login(page: Page) {
  await page.goto(`http://127.0.0.1:${ports.ui}/`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("用户名").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByLabel("用户名").fill("fixture-admin");
  await page.getByLabel("个人访问凭据").fill(password);
  await page.getByRole("button", { name: /进入创作台/ }).click();
  await page.waitForSelector('[data-page="home"]', { timeout: 30_000 });
}

async function settle(page: Page, route: string) {
  await page.goto(`http://127.0.0.1:${ports.ui}/#/${route}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-page]").first().waitFor({ timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}

const executablePath = process.env.CHROME_PATH || (await fs.stat("/usr/bin/google-chrome").then(() => "/usr/bin/google-chrome").catch(() => undefined));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] });
const fixture = await startFixture();
const shots: string[] = [];
const errors: string[] = [];
const overflows: { variant: string; route: string; scrollWidth: number; innerWidth: number }[] = [];
const stdoutLines: string[] = [];
const stderrLines: string[] = [];
let status: "passed" | "failed" = "failed";
try {
  for (const variant of viewports) {
    const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height } });
    await context.addInitScript((theme) => localStorage.setItem("yeisme.v18.theme", theme), variant.theme);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${variant.name}: ${error.message}`));
    await login(page);
    for (const route of variant.routes) {
      await settle(page, route);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      if (overflow.scrollWidth > overflow.innerWidth + 1) {
        overflows.push({ variant: variant.name, route: route || "home", ...overflow });
      }
      // Guide chapters are nested routes and the studio is a query; the file name flattens both.
      const file = `${variant.name}-${(route || "home").replace(/[/?=&]/g, "-")}.png`;
      await page.screenshot({ path: path.join(run, "artifacts", file), fullPage: variant.width < 800 ? false : true });
      shots.push(file);
      stdoutLines.push(`CAPTURED ${file} (${overflow.scrollWidth}/${overflow.innerWidth})`);
    }
    await context.close();
  }
  for (const [width, height] of [[1280, 900], [2048, 1080]] as const) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(() => localStorage.setItem("yeisme.v18.theme", "light"));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${width}-inspector: ${error.message}`));
    await login(page);
    for (const route of ["tasks", "assets", "capabilities", "drama"]) {
      await settle(page, route);
      const target = page.locator("[data-task] button, [data-result] button, [data-catalog-row], li[data-episode] button").first();
      if (await target.count()) {
        await target.click().catch(() => {});
        await page.waitForTimeout(800);
      }
      const file = `${width}-inspector-${route}.png`;
      await page.screenshot({ path: path.join(run, "artifacts", file) });
      shots.push(file);
      stdoutLines.push(`CAPTURED ${file}`);
    }
    await context.close();
  }
  // States a route alone does not show: the viewer with its information, the gallery in rows by shape, a shot open.
  const states = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await states.addInitScript(() => localStorage.setItem("yeisme.v18.theme", "light"));
  const statePage = await states.newPage();
  statePage.on("pageerror", (error) => errors.push(`states: ${error.message}`));
  await login(statePage);
  const capture = async (name: string, act: () => Promise<unknown>) => {
    try {
      await act();
      await statePage.waitForTimeout(700);
      await statePage.screenshot({ path: path.join(run, "artifacts", `1440-state-${name}.png`) });
      shots.push(`1440-state-${name}.png`);
    } catch (error) {
      errors.push(`state ${name}: ${error instanceof Error ? error.message.slice(0, 160) : error}`);
    }
  };
  await capture("viewer-info", async () => {
    await settle(statePage, "assets?kind=image");
    const card = statePage.locator('[aria-label="资源大图网格"] [data-result]').first();
    await card.hover();
    await card.getByRole("button", { name: /^预览 / }).click();
    await statePage.locator("[data-media-viewer] .viewer-stage img[data-loaded]").waitFor({ timeout: 15_000 });
    await statePage.keyboard.press("i");
  });
  await capture("gallery-justified", async () => {
    await settle(statePage, "assets?kind=image");
    await statePage.getByRole("radiogroup", { name: "排列方式" }).getByRole("radio", { name: "按比例" }).click();
  });
  await capture("studio-shot", async () => {
    await settle(statePage, "drama?studio=ep-01");
    await statePage.locator("[data-shot-board] [data-row-button]").first().click();
    await statePage.locator("[data-shot-inspector]").waitFor();
  });
  await states.close();
  status = errors.length === 0 && overflows.length === 0 ? "passed" : "failed";
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(message);
  stderrLines.push(message);
} finally {
  await browser.close();
  fixture.kill("SIGTERM");
}
if (errors.length) stderrLines.push(...errors);
if (overflows.length) stderrLines.push(...overflows.map((item) => `OVERFLOW ${item.variant} ${item.route}: ${item.scrollWidth}>${item.innerWidth}`));
await fs.writeFile(path.join(run, "stdout.log"), `${stdoutLines.join("\n")}\n`);
await fs.writeFile(path.join(run, "stderr.log"), stderrLines.length ? `${stderrLines.join("\n")}\n` : "");
await fs.writeFile(path.join(run, "summary.json"), `${JSON.stringify({
  schema_version: "yeisme.integration_test_evidence.v1",
  status,
  evidence_layer: "visual_matrix",
  real_owner_reads: false,
  provider_calls: false,
  mutations: false,
  label,
  viewports: viewports.map((v) => v.name),
  shots: shots.length,
  page_errors: errors,
  overflows,
}, null, 2)}\n`);
console.log(JSON.stringify({ status, run: path.relative(root, run), shots: shots.length, page_errors: errors.length, overflows: overflows.length }));
process.exit(status === "passed" ? 0 : 1);
