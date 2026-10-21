import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.APP_URL || "http://127.0.0.1:4298/";
const legacyPathToken = ["workspace", "-v18"].join("");
const run = path.resolve("temp/integration-test-runs/app-shell-" + new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
await fs.writeFile(path.join(run, "command.txt"), `APP_URL=${base} node scripts/verify-app.mjs\n`);
await fs.writeFile(path.join(run, "env.json"), JSON.stringify({ url: base, viewports: [1440, 1280, 768, 390], real_owner_calls: false }, null, 2));

const browserExecutable = process.env.CHROME_PATH || (await fs.stat("/usr/bin/google-chrome").then(() => "/usr/bin/google-chrome").catch(() => undefined));
const browser = await chromium.launch({ headless: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}), args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
const errors = [];
const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error" && !/status of 401/.test(message.text())) errors.push("console: " + message.text()); });
page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
const checks = [];

// Opt-in fault injection for the first-read race: defer the app entry module so Playwright's "network idle"
// fires before React mounts, as it can on a slow CI runner.  APP_SHELL_MOUNT_DELAY_MS=2000 bun run test:ci:browser
// Fails loudly when the entry script cannot be found (e.g. a production build), instead of silently injecting nothing.
const mountDelayMs = Number(process.env.APP_SHELL_MOUNT_DELAY_MS || 0);
if (mountDelayMs > 0) {
  const entry = new URL(base);
  await page.route((url) => url.origin === entry.origin && url.pathname === entry.pathname, async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    const source = await response.text();
    const html = source.replace(/<script type="module" src="(\/src\/main\.tsx)"><\/script>/, `<script type="module">setTimeout(() => import("$1"), ${mountDelayMs});</script>`);
    if (html === source) throw new Error("mount_delay_injection_failed: entry script not found in the served HTML");
    await route.fulfill({ response, body: html, headers: { ...response.headers(), "content-length": String(Buffer.byteLength(html)), "content-encoding": "identity" } });
  });
}

async function check(name, fn) {
  try { await fn(); checks.push({ name, status: "passed" }); }
  catch (error) {
    checks.push({ name, status: "failed", error: error.message });
    // CI uploads the evidence directory, so a flaky failure ships with what the page actually looked like.
    await page.screenshot({ path: path.join(run, "artifacts", `failed-${checks.length}.png`) }).catch(() => {});
  }
}

// `networkidle` only says the network went quiet. The app can still be unmounted (a slow runner) or showing the
// loading screen, so wait for the rendered shell before asserting or measuring on it.
async function waitForShell() {
  try {
    await page.waitForFunction(() => /Yeisme|进入团队工作空间/.test(document.body?.innerText || ""), undefined, { timeout: 20_000 });
  } catch {
    const body = (await page.locator("body").innerText({ timeout: 2000 }).catch(() => "")).trim().slice(0, 160);
    throw new Error(`shell_not_rendered: body=${JSON.stringify(body)} page_errors=${errors.length}`);
  }
  // Settle layout before measuring: late font swaps change text widths. Both waits are best effort and bounded.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 5000))]));
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await check("formal root shell", async () => {
    await waitForShell();
    const body = await page.locator("body").innerText();
    assert.ok(body.includes("Yeisme") || body.includes("进入团队工作空间"), `shell text missing: ${JSON.stringify(body.slice(0, 120))}`);
    assert.equal(body.includes("演示模式"), false);
    assert.equal(body.includes(legacyPathToken), false);
  });
  await check("hash routes remain addressable", async () => {
    for (const route of ["tasks", "requests", "review", "assets", "services", "usage", "capabilities", "team"]) {
      await page.goto(`${base}#/${route}`, { waitUntil: "networkidle" });
      assert.equal(new URL(page.url()).hash, `#/${route}`);
    }
  });
  await check("responsive shell has no horizontal overflow", async () => {
    for (const width of [1440, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await waitForShell();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `overflow at ${width}`);
    }
  });
  await check("no demo or mutation network surface", async () => {
    assert.equal(requests.some((request) => request.url.includes(legacyPathToken) || request.url.includes("mode=demo")), false);
    assert.deepEqual(requests.filter((request) => ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !request.url.includes("/artifacts/")), []);
    assert.deepEqual(errors, []);
  });
  await page.screenshot({ path: path.join(run, "artifacts", "app-shell.png"), fullPage: true });
} finally {
  await fs.writeFile(path.join(run, "stdout.log"), checks.map((check) => `${check.status.toUpperCase()} ${check.name}`).join("\n") + "\n");
  await fs.writeFile(path.join(run, "stderr.log"), checks.filter((check) => check.status === "failed").map((check) => JSON.stringify(check)).join("\n"));
  await fs.writeFile(path.join(run, "summary.json"), JSON.stringify({ status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks, request_count: requests.length, script_errors: errors, evidence_layer: "app_shell_browser", real_integration: false }, null, 2));
  await browser.close();
}

const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";
console.log(JSON.stringify({ status, checks: checks.length, evidence: run, failures: checks.filter((check) => check.status === "failed") }, null, 2));
if (status === "failed") process.exitCode = 1;
