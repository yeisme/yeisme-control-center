import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.YEISME_PREVIEW_UI_URL || "http://127.0.0.1:4298";
const username = process.env.YEISME_PREVIEW_USERNAME || "preview-admin";
const password = process.env.YEISME_PREVIEW_PASSWORD;
if (!password) throw new Error("YEISME_PREVIEW_PASSWORD is required");
const run = path.resolve("temp/integration-test-runs/preview-real-" + new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(path.join(run, "artifacts"), { recursive: true, mode: 0o700 });
await fs.writeFile(path.join(run, "command.txt"), "bun run test:preview:real\n");
await fs.writeFile(path.join(run, "env.json"), JSON.stringify({ base, username, real_owner_reads: true, provider_calls: false, credentials_logged: false }, null, 2) + "\n");
await fs.writeFile(path.join(run, "stdout.log"), "");
await fs.writeFile(path.join(run, "stderr.log"), "");
const executablePath = process.env.CHROME_PATH || (await fs.stat("/usr/bin/google-chrome").then(() => "/usr/bin/google-chrome").catch(() => undefined));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const loginSurface = await page.locator("body").innerText();
  results.push({ name: "login_surface", status: loginSurface.includes("进入团队工作空间") && loginSurface.includes("个人访问凭据") ? "passed" : "failed" });
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("个人访问凭据").fill(password);
  await page.getByRole("button", { name: /登录 Workspace/ }).click();
  await page.waitForSelector('[data-page="home"]');
  const overview = await page.locator("body").innerText();
  results.push({ name: "authenticated_overview", status: overview.includes("需要处理") && overview.includes("服务状态") && overview.includes("真实只读") ? "passed" : "failed" });
  await page.goto(base + "/#/capabilities", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-page="capabilities"]');
  // Live discovery runs owner MCP calls on open; wait for the directory instead of the first paint.
  await page.getByRole("listitem").filter({ hasText: "Sonora" }).first().waitFor({ timeout: 45_000 }).catch(() => {});
  const services = await page.locator("body").innerText();
  results.push({ name: "real_owner_capability_directory", status: services.includes("模型与工具") && services.includes("Provider 提交默认关闭") && ["Eikona", "Scaena", "Sonora"].every((owner) => services.includes(owner)) && !services.includes("雨夜重逢") ? "passed" : "failed" });
  await page.goto(base + "/#/review", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-page="review"]');
  const review = await page.locator("body").innerText();
  results.push({ name: "real_owner_review_boundary", status: (review.includes("审阅数据未提供") || review.includes("待审阅")) && review.includes("四种事实分开记录") && !review.includes("演示意见") && !review.includes("雨夜重逢") ? "passed" : "failed" });
  await page.goto(base + "/#/usage", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-page="usage"]');
  const usage = await page.locator("body").innerText();
  results.push({ name: "real_owner_usage_boundary", status: usage.includes("owner 返回的模型用量回执") && usage.includes("不补零") && !usage.includes("Rain Studio · 演示预算") && !usage.includes("覆盖至 2026-10-14") ? "passed" : "failed" });
  await page.goto(base + "/#/tasks", { waitUntil: "networkidle" });
  const malformedTaskQuery = requests.some((request) => /\/tasks\?mode=(active|history)\?/.test(request.url));
  results.push({ name: "task_query_scope_contract", status: malformedTaskQuery ? "failed" : "passed" });
  await page.goto(base + "/#/creation", { waitUntil: "networkidle" });
  const mutationSurface = requests.filter((request) => /voice\.audition|createVideoProviderTask|\/provider-runs/.test(request.url));
  results.push({ name: "creation_submit_remains_closed", status: mutationSurface.length === 0 ? "passed" : "failed", requests: mutationSurface });
  await page.screenshot({ path: path.join(run, "artifacts", "real-preview-services.png"), fullPage: true });
  await page.close();
} catch (error) {
  results.push({ name: "browser_flow", status: "failed", error: error instanceof Error ? error.message : "preview_browser_failed" });
  await fs.writeFile(path.join(run, "stderr.log"), String(error?.stack || error) + "\n");
} finally {
  await browser.close();
}
const summary = { schema_version: "yeisme.integration_test_evidence.v1", status: results.every((item) => item.status === "passed") ? "passed" : "failed", real_owner_reads: true, provider_calls: false, mutations: false, results, evidence: run };
await fs.writeFile(path.join(run, "stdout.log"), results.map((item) => `${item.status} ${item.name}`).join("\n") + "\n");
await fs.writeFile(path.join(run, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.status === "passed" ? 0 : 1;
