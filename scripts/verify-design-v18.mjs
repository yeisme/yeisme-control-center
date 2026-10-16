import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.V18_URL || "http://127.0.0.1:4313/workspace-v18.html";
const run = path.resolve("temp/integration-test-runs/design-v18-" + new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
await fs.writeFile(path.join(run, "command.txt"), `V18_URL=${base} node scripts/verify-design-v18.mjs\n`);
await fs.writeFile(path.join(run, "env.json"), JSON.stringify({ url: base, viewports: [1440, 1280, 768, 390], real_owner_calls: false }, null, 2));

const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const failures = [];
const requests = [];
const errors = [];
page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) requests.push({ method: request.method(), url: request.url() }); });
page.on("pageerror", (error) => errors.push(error.message));

async function check(name, fn) {
  try { await fn(); return { name, status: "passed" }; }
  catch (error) { failures.push({ name, error: error.message }); return { name, status: "failed", error: error.message }; }
}

const results = [];
try {
  await page.goto(base);
  await page.request.post(new URL("/api/control-center/v1/workspace-v18/reset", base).toString()).catch(() => {});
  await page.reload();
  results.push(await check("workspace shell and grouped navigation entries", async () => {
    assert.equal(await page.locator("[data-page=home]").count(), 1);
    assert.equal(await page.locator("[data-nav]").count(), 9);
    assert.match(await page.locator("body").innerText(), /Rain Studio/);
    assert.match(await page.locator("body").innerText(), /演示模式/);
    assert.match(await page.locator("body").innerText(), /资源运营/);
  }));
  results.push(await check("project to creation journey", async () => {
    await page.locator('[data-nav="projects"]').click();
    await page.locator('[data-project="rain"]').click();
    assert.equal(await page.locator('[data-page="project-detail"]').count(), 1);
    for (const tab of ["units", "assets", "tasks", "review", "delivery", "overview"]) {
      await page.locator(`[data-project-tab="${tab}"]`).click();
      assert.match(page.url(), new RegExp(`tab=${tab}`));
      assert.equal(await page.locator(`[data-project-tab="${tab}"]`).getAttribute("aria-selected"), "true");
    }
    await page.getByRole("button", { name: /进入 AI 创作/ }).click();
    await page.locator('[data-page="creation"]').getByRole("button", { name: /AI 图像/ }).click();
    await page.locator("#creation-form").getByRole("button", { name: /创建演示任务/ }).click();
    await page.waitForSelector('[data-page="tasks"]');
    assert.equal(await page.locator('[data-page="tasks"]').count(), 1);
    assert.match(await page.locator("body").innerText(), /演示任务已加入.*任务中心/);
  }));
  results.push(await check("task status transitions preserve distinct states", async () => {
    const row = page.locator('[data-task="task-demo-1"]');
    assert.equal(await row.count(), 1);
    assert.match(await row.innerText(), /排队中/);
    await row.getByRole("button").last().click();
    await page.waitForFunction(() => document.querySelector('[data-task="task-demo-1"]')?.textContent?.includes("运行中"));
    assert.match(await row.innerText(), /运行中/);
    await row.getByRole("button").last().click();
    await page.waitForFunction(() => document.querySelector('[data-task="task-demo-1"]')?.textContent?.includes("已完成"));
    assert.match(await row.innerText(), /已完成/);
    await row.getByRole("button").first().click();
    assert.match(await page.locator('[role=dialog]').innerText(), /结果引用可见/);
    await page.getByRole("button", { name: /关闭任务详情/ }).click();
  }));
  results.push(await check("asset inspector and review adoption", async () => {
    await page.locator('[data-nav="assets"]').click();
    await page.locator('[data-asset="asset-image-03"]').click();
    assert.match(await page.locator('[role=dialog]').innerText(), /来源任务/);
    await page.getByRole("button", { name: "下载" }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes("下载已开始") || document.body.innerText.includes("下载权限"));
    await page.getByRole("button", { name: /打开审阅/ }).click();
    assert.equal(await page.locator('[data-page="review"]').count(), 1);
    const review = page.locator('[data-review="asset-image-03"]');
    await review.locator('[data-version="image-v2"]').click();
    await review.getByRole("button", { name: /采用/ }).click();
    await page.waitForFunction(() => !document.querySelector('[data-review="asset-image-03"]'));
  }));
  results.push(await check("capability-specific creation forms", async () => {
    await page.locator('[data-nav="creation"]').click();
    await page.getByRole("button", { name: /AI 配音/ }).click();
    assert.ok(await page.getByText("文本／台词", { exact: false }).count() >= 1);
    await page.getByRole("button", { name: /AI 视频/ }).click();
    assert.ok(await page.getByText("时长", { exact: false }).count() >= 1);
    await page.getByRole("button", { name: /文本与剧本/ }).click();
    assert.ok(await page.getByText("创作目标", { exact: false }).count() >= 1);
    await page.locator('[data-nav="review"]').click();
  }));
  results.push(await check("all review decisions and delivery readiness", async () => {
    await page.locator('[data-nav="review"]').click();
    while (await page.locator('[data-action="approve-review"]').count()) {
      const count = await page.locator('[data-action="approve-review"]').count();
      await page.locator('[data-action="approve-review"]').first().click();
      await page.waitForFunction((expected) => document.querySelectorAll('[data-action="approve-review"]').length < expected, count);
    }
    await page.getByRole("button", { name: /查看交付清单/ }).click();
    await page.getByRole("button", { name: /生成演示清单/ }).click();
    await page.waitForFunction(() => document.body.innerText.includes("可以交付"));
    assert.match(await page.locator("body").innerText(), /可以交付/);
    assert.match(await page.locator("body").innerText(), /3 \/ 3 项已固定/);
  }));
  results.push(await check("capability hub and usage analytics", async () => {
    await page.locator('[data-nav="capabilities"]').click();
    assert.equal(await page.locator('[data-page="capabilities"]').count(), 1);
    assert.match(await page.locator("body").innerText(), /模型与工具/);
    assert.match(await page.locator("body").innerText(), /最近已观察/);
    await page.getByRole("tab", { name: /MCP 服务/ }).click();
    assert.match(await page.locator("body").innerText(), /个人 MCP Gateway/);
    await page.locator('[data-nav="usage"]').click();
    assert.equal(await page.locator('[data-page="usage"]').count(), 1);
    assert.match(await page.locator("body").innerText(), /用量与成本/);
    assert.match(await page.locator("body").innerText(), /已确认上游成本/);
    await page.locator('[data-page="usage"] .v18-usage-row').first().click();
    assert.match(await page.locator('[role="dialog"]').innerText(), /Trace|来源引用/);
    await page.locator('[role="dialog"] .v18-icon-button').click();
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
    await page.goto(`${base}#/usage`);
    assert.equal(await page.locator('[data-page="usage"]').count(), 1);
    await page.goto(`${base}#/capabilities`);
    assert.equal(await page.locator('[data-page="capabilities"]').count(), 1);
  }));
  results.push(await check("theme, reduced motion, keyboard and responsive overflow", async () => {
    await page.locator('[data-nav="team"]').click();
    await page.getByRole("button", { name: /深色主题|浅色主题/ }).click();
    assert.ok(["dark", "light"].includes(await page.locator("html").getAttribute("data-theme")));
    await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => document.activeElement !== document.body));
    for (const width of [1440, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `horizontal overflow at ${width}`);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-nav="home"]').click();
    assert.equal(await page.locator('[data-page="home"]').count(), 1);
  }));
  results.push(await check("no mutating network calls or runtime errors", async () => {
    assert.deepEqual(requests.filter((request) => !request.url.includes("/workspace-v18/")), []);
    assert.deepEqual(errors, []);
  }));
  await page.screenshot({ path: path.join(run, "artifacts", "workspace-v18-final.png"), fullPage: true, animations: "disabled" });
} finally {
  await fs.writeFile(path.join(run, "stdout.log"), results.map((result) => `${result.status.toUpperCase()} ${result.name}`).join("\n") + "\n");
  await fs.writeFile(path.join(run, "stderr.log"), failures.length ? JSON.stringify(failures, null, 2) + "\n" : "");
  await fs.writeFile(path.join(run, "summary.json"), JSON.stringify({ status: failures.length ? "failed" : "passed", checks: results, request_count: requests.length, script_errors: errors, evidence_layer: "design_browser", real_integration: false }, null, 2));
  await browser.close();
}

console.log(JSON.stringify({ status: failures.length ? "failed" : "passed", checks: results.length, evidence: run, failures }, null, 2));
if (failures.length) process.exitCode = 1;
