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

async function check(name, fn) {
  try { await fn(); checks.push({ name, status: "passed" }); }
  catch (error) { checks.push({ name, status: "failed", error: error.message }); }
}

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await check("formal root shell", async () => {
    const body = await page.locator("body").innerText();
    assert.ok(body.includes("Yeisme") || body.includes("进入团队工作空间"));
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
      await page.goto(base, { waitUntil: "networkidle" });
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
