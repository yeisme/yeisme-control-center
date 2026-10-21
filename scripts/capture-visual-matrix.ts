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
const routes = ["", "projects", "creation", "assets", "tasks", "reminders", "requests", "review", "services", "capabilities", "usage", "team"];
await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
await fs.writeFile(path.join(run, "command.txt"), `VISUAL_LABEL=${label} bun scripts/capture-visual-matrix.ts\n`);
await fs.writeFile(path.join(run, "env.json"), JSON.stringify({ ports, scenario: "rich", real_owner_calls: false, provider_calls: false, credentials_logged: false }, null, 2) + "\n");

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
  await page.getByRole("button", { name: /登录 Workspace/ }).click();
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
try {
  for (const variant of [
    { name: "1440-light", width: 1440, height: 960, theme: "light" },
    { name: "1440-dark", width: 1440, height: 960, theme: "dark" },
    { name: "390-light", width: 390, height: 844, theme: "light" },
  ]) {
    const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height } });
    await context.addInitScript((theme) => localStorage.setItem("yeisme.v18.theme", theme), variant.theme);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${variant.name}: ${error.message}`));
    await login(page);
    for (const route of routes) {
      await settle(page, route);
      const file = `${variant.name}-${route || "home"}.png`;
      await page.screenshot({ path: path.join(run, "artifacts", file), fullPage: variant.width < 800 ? false : true });
      shots.push(file);
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 2048, height: 1080 } });
  await context.addInitScript(() => localStorage.setItem("yeisme.v18.theme", "light"));
  const page = await context.newPage();
  await login(page);
  for (const route of ["tasks", "assets", "capabilities"]) {
    await settle(page, route);
    const target = page.locator("[data-task] button, [data-result] button, [data-catalog-row]").first();
    if (await target.count()) {
      await target.click().catch(() => {});
      await page.waitForTimeout(800);
    }
    const file = `2048-inspector-${route}.png`;
    await page.screenshot({ path: path.join(run, "artifacts", file) });
    shots.push(file);
  }
  await context.close();
} finally {
  await browser.close();
  fixture.kill("SIGTERM");
}
await fs.writeFile(path.join(run, "summary.json"), JSON.stringify({ label, shots: shots.length, page_errors: errors }, null, 2) + "\n");
console.log(JSON.stringify({ run: path.relative(root, run), shots: shots.length, page_errors: errors.length }));
process.exit(0);
