import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const ports = { ui: 4440, api: 4441, owner: 4442 };
const ui = `http://127.0.0.1:${ports.ui}`;
const run = path.join(root, "temp/integration-test-runs/shared-projects-" + new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
const password = crypto.randomUUID();
const results: { name: string; status: string; detail?: string }[] = [];
const errors: string[] = [], network: { path: string; status: number }[] = [];
let ready = "";
const fixture = spawn("bun", ["scripts/fixture-preview.ts"], { cwd: root, env: { ...process.env, FIXTURE_PASSWORD: password, FIXTURE_UI_PORT: String(ports.ui), FIXTURE_API_PORT: String(ports.api), FIXTURE_OWNER_PORT: String(ports.owner) }, stdio: ["ignore", "pipe", "pipe"] });
fixture.stdout.on("data", (chunk) => { ready += chunk; });
fixture.stderr.on("data", () => {});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let fullMediaRequests = 0;
try {
  const deadline = Date.now() + 45000;
  while (!ready.includes('"status": "ready"')) { if (Date.now() > deadline || fixture.exitCode !== null) throw Error("fixture startup failed"); await new Promise((done) => setTimeout(done, 250)); }
  await fetch(ui).catch(() => {});
  const executablePath = process.env.CHROME_PATH || await fs.stat("/usr/bin/google-chrome").then(() => "/usr/bin/google-chrome").catch(() => undefined);
  browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  page.on("response", (r) => { if (r.status() >= 400) network.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  page.on("request", (r) => { if (/\/artifacts\/[^/]+\/access/.test(r.url()) && /"purpose":"(preview|download)"/.test(r.postData() || "")) fullMediaRequests++; });
  const check = async (name: string, body: () => Promise<void>) => { await body(); results.push({ name, status: "passed" }); };
  await page.goto(ui, { waitUntil: "networkidle" });
  await page.getByLabel("用户名").fill("fixture-admin"); await page.getByLabel("个人访问凭据").fill(password); await page.getByRole("button", { name: "登录 Workspace" }).click();
  await page.locator('[data-page="home"]').waitFor();
  const save = async () => { const dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: "预览变更", exact: true }).click(); await dialog.getByRole("button", { name: "确认保存", exact: true }).click(); await expect(dialog).toHaveCount(0); };
  await check("create organization and owner-bound shared project through preview/confirm", async () => {
    await page.goto(ui + "/#/projects?shared=1");
    await page.getByRole("button", { name: "创建组织", exact: true }).first().click();
    await page.getByRole("dialog").getByLabel(/^名称/).fill("协作验收组织"); await save();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("dialog").getByLabel(/^名称/).fill("共享影像项目");
    await page.getByRole("dialog").getByRole("checkbox", { name: "eikona rain-reunion", exact: true }).check();
    await save(); await page.getByRole("heading", { name: "共享影像项目", exact: true }).waitFor();
    await page.getByRole("button", { name: /^查看成果 / }).first().waitFor();
  });
  await check("folder creation, entering, empty state and breadcrumb return", async () => {
    await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
    await page.getByRole("dialog").getByLabel("文件夹名称").fill("角色定稿"); await save();
    await page.getByRole("button", { name: "角色定稿", exact: true }).last().dblclick();
    await expect(page.getByText("当前目录没有可显示的成果")).toBeVisible();
    await page.getByRole("navigation", { name: "文件夹路径" }).getByRole("button", { name: "成果", exact: true }).click();
  });
  await check("selection remains metadata-only and preview is explicit", async () => {
    const before = fullMediaRequests;
    await page.getByRole("button", { name: /^查看成果 / }).first().click();
    await page.getByRole("dialog").waitFor(); await page.waitForTimeout(500);
    if (fullMediaRequests !== before) throw Error("selection requested original media");
    await page.getByRole("dialog").getByRole("button", { name: "预览 / 播放", exact: true }).click();
    await page.locator('[data-inline-media-preview="image"] img').waitFor();
    await page.getByRole("button", { name: "放大图片", exact: true }).click();
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  });
  await check("rename uses stable project id and URL filtering restores", async () => {
    const projectID = new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("sharedProject");
    await page.getByRole("button", { name: "项目操作：共享影像项目" }).click(); await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    await page.getByRole("dialog").getByLabel(/^名称/).fill("共享影像项目 · 更新"); await save();
    await page.getByRole("heading", { name: "共享影像项目 · 更新", exact: true }).waitFor();
    if (!page.url().includes(projectID!)) throw Error("rename changed stable id");
    await page.getByLabel("搜索成果名称", { exact: true }).fill("不存在的成果"); await page.waitForTimeout(400);
    await page.reload(); await expect(page.getByLabel("搜索成果名称", { exact: true })).toHaveValue("不存在的成果");
    await page.getByRole("button", { name: "重置", exact: true }).click();
  });
  await check("clipboard rejection offers selectable text and notifications separate read from acknowledge", async () => {
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw Error("denied"); } } }); });
    await page.getByRole("button", { name: "项目操作：共享影像项目 · 更新" }).click(); await page.getByRole("menuitem", { name: "复制项目引用", exact: true }).click();
    const fallback = page.getByLabel("手动复制项目引用"); await expect(fallback).toHaveValue(/^yeisme-project:project_/); await fallback.focus();
    const selected = await fallback.evaluate((el) => { const input = el as HTMLInputElement; return input.selectionStart === 0 && input.selectionEnd === input.value.length; }); if (!selected) throw Error("manual copy text is not selected");
    const notificationFacts = await page.evaluate(async () => {
      const session = await fetch("/api/control-center/v1/session").then((r) => r.json());
      const id = session.shared_projects[0].id;
      const page = await fetch("/api/control-center/v1/notifications?scope=" + id).then((r) => r.json());
      return { identity: session.identity, rows: page.rows.map((v: { category: string; read_at?: string; title: string }) => ({ category: v.category, read: !!v.read_at, title: v.title })), unread: page.unread };
    });
    await fs.writeFile(path.join(run, "artifacts", "notification-projection.json"), JSON.stringify(notificationFacts, null, 2));
    await page.getByRole("button", { name: /^需要关注/ }).click();
    const projectNotice = page.getByRole("button", { name: /项目「共享影像项目.*共享设置已更新/ });
    if (!await projectNotice.count()) await page.getByRole("button", { name: "加载更多", exact: true }).click();
    await projectNotice.first().click();
    await expect(page.getByText("阅读通知不会确认处理提醒", { exact: false })).toHaveCount(0);
    const state = await page.evaluate(async () => {
      const session = await fetch("/api/control-center/v1/session").then((r) => r.json());
      const id = session.shared_projects[0].id;
      const page = await fetch("/api/control-center/v1/notifications?scope=" + id).then((r) => r.json());
      return page.rows.filter((v: { category: string; read_at?: string; state: string }) => v.category === "project_assignment" && v.read_at).map((v: { state: string }) => v.state);
    });
    if (!state.length || state.some((v: string) => v !== "unread")) throw Error("reading acknowledged a collaboration event");
  });
  await check("responsive directory sheets and light/dark themes have no horizontal overflow", async () => {
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 960 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((v) => { document.documentElement.dataset.theme = v; document.documentElement.classList.toggle("dark", v === "dark"); }, theme);
        if (width < 1024) { await page.getByRole("button", { name: "浏览目录", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape"); }
        await page.locator("img[alt]").first().waitFor({ state: "visible", timeout: 15000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        if (overflow) throw Error(`horizontal overflow at ${width}/${theme}`);
        await page.screenshot({ path: path.join(run, "artifacts", `${width}-${theme}.png`) });
      }
    }
  });
  if (errors.length) throw Error("browser runtime errors: " + errors.join(" | "));
  await fs.writeFile(path.join(run, "artifacts", "diagnostics.json"), JSON.stringify({ runtime_errors: errors, failed_responses: network, full_media_requests: fullMediaRequests, real_owner_calls: false, provider_calls: false }, null, 2));
} catch (e) { const failurePage = browser?.contexts()[0]?.pages()[0]; if (failurePage) { await failurePage.screenshot({ path: path.join(run, "artifacts", "failure.png") }).catch(() => {}); await fs.writeFile(path.join(run, "artifacts", "failure-ui.txt"), (await failurePage.locator("body").innerText()).slice(0, 6000)); } results.push({ name: "journey", status: "failed", detail: e instanceof Error ? e.message.slice(0, 500) : "unknown failure" }); }
finally {
  await browser?.close(); fixture.kill("SIGTERM");
  await new Promise((done) => { if (fixture.exitCode !== null) done(null); else { fixture.once("exit", done); setTimeout(done, 6000); } });
  await fs.writeFile(path.join(run, "command.txt"), "bun scripts/verify-collaboration-journey.ts\n");
  await fs.writeFile(path.join(run, "env.json"), JSON.stringify({ ports, real_owner_calls: false, provider_calls: false, credentials_logged: false }, null, 2));
  await fs.writeFile(path.join(run, "stdout.log"), results.map((v) => `${v.status} ${v.name}`).join("\n") + "\n");
  await fs.writeFile(path.join(run, "stderr.log"), results.filter((v) => v.status === "failed").map((v) => v.detail).join("\n") + "\n");
  const failed = results.some((v) => v.status === "failed");
  await fs.writeFile(path.join(run, "summary.json"), JSON.stringify({ status: failed ? "failed" : "passed", checks: results, real_owner_calls: false, provider_calls: false }, null, 2));
  console.log(JSON.stringify({ status: failed ? "failed" : "passed", evidence: run, checks: results })); if (failed) process.exitCode = 1;
}
