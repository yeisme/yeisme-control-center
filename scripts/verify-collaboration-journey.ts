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
let projectID = "", seededBatches: string[] = [];
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
    await page.getByRole("dialog").getByRole("checkbox", { name: "Eikona rain-reunion（Fixture · 雨夜重逢）", exact: true }).check();
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
    await page.getByRole("dialog").getByRole("button", { name: "预览", exact: true }).click();
    const viewer = page.locator("[data-media-viewer]");
    await viewer.locator(".viewer-stage img").waitFor();
    await viewer.getByRole("button", { name: "放大", exact: true }).click();
    // A failed read of the next item keeps the viewer on the current one and announces why inside the dialog.
    const title = viewer.getByRole("heading").first(); const shown = await title.textContent();
    await page.route("**/projects/*/items/*/task", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "owner_unavailable", message: "owner unavailable" } }) }), { times: 1 });
    await viewer.getByRole("button", { name: "下一项", exact: true }).click();
    await expect(viewer.getByRole("status").filter({ hasText: "没能打开这一项" })).toBeVisible();
    await expect(title).toHaveText(shown!);
    await viewer.getByRole("button", { name: "下一项", exact: true }).click();
    await expect(title).not.toHaveText(shown!); await expect(viewer.getByText("没能打开这一项")).toHaveCount(0);
    // The viewer stacks over the detail sheet: Escape closes the viewer first, then the sheet.
    await page.keyboard.press("Escape"); await viewer.waitFor({ state: "detached" });
    await expect(page.getByRole("dialog")).toHaveCount(1);
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
    // Refuse both the Clipboard API and the legacy execCommand fallback, so the manual copy box is the only way out.
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw Error("denied"); } } }); Object.defineProperty(document, "execCommand", { configurable: true, value: () => false }); });
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
  await check("batch list pages on the server, keeps filters in the address and drops a lapsed page", async () => {
    projectID = new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("sharedProject")!;
    // Saved through the same preview/confirm actions the batch form uses; the fake Eikona plans and runs them for free.
    seededBatches = await page.evaluate(async (project) => {
      const session = await fetch("/api/control-center/v1/session").then((r) => r.json());
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`/api/control-center/v1${path}?scope=${encodeURIComponent(project)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf }, body: JSON.stringify(body) });
        if (!response.ok) throw Error(`${path} ${response.status} ${(await response.text()).slice(0, 200)}`);
        return response.json();
      };
      const run = async (action: string, input: Record<string, unknown>) => {
        const shared = await fetch(`/api/control-center/v1/projects/${project}`).then((r) => r.json());
        const key = crypto.randomUUID();
        const preview = await post("/actions/preview", { scope_id: project, owner: "control-center", target_kind: "project", target_ref: project, action, expected_revision: String(shared.revision), idempotency_key: key, input });
        const receipt = await post("/actions/confirm", { scope_id: project, preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: key });
        if (receipt.state !== "succeeded") throw Error(`${action} ${receipt.state} ${receipt.error_code}`);
        return receipt;
      };
      await run("project.update", { generation_enabled: true, budget_cap: 5, currency: "USD" });
      const ids: string[] = [];
      for (let n = 1; n <= 22; n += 1) {
        const label = String(n).padStart(2, "0");
        const prepared = await run("generation.input.prepare", { owner: "eikona", rows: [{ id: "row", prompt: `雨夜站台，第 ${label} 版`, model_ref: "fixture/image", size: "1024x1024", aspect: "1:1", candidate_count: 1, folder_id: null, references: [] }] });
        const items = prepared.generation_items.map(({ prompt_capture: _capture, ...item }: Record<string, unknown>) => item);
        ids.push((await run("generation.batch.create", { name: `雨夜站台 · 第 ${label} 批`, items, idempotency_key: crypto.randomUUID() })).result_refs[0]);
      }
      // The oldest batch is submitted, so the only live batch sits on the second page.
      await run("generation.batch.submit", { batch_id: ids[0] });
      return ids;
    }, projectID);
    const batches = page.locator("[data-batch]");
    await page.goto(`${ui}/#/creation?sharedProject=${projectID}`);
    await expect(page.getByText("共 22 个", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(batches).toHaveCount(20);
    await expect(batches.first()).toContainText("第 22 批");
    await page.getByRole("button", { name: "更早的批次", exact: true }).click();
    await expect(batches).toHaveCount(2);
    await expect(batches.last()).toContainText("第 01 批");
    if (!page.url().includes("batchFiltercursor=")) throw Error("the page cursor is not in the address");
    await page.getByRole("button", { name: "回到最新", exact: true }).click();
    await expect(batches).toHaveCount(20);
    // A filter lives in the address, survives a reload and drops the page cursor.
    await page.getByRole("button", { name: "更早的批次", exact: true }).click(); await expect(batches).toHaveCount(2);
    await page.getByLabel("搜索批次名称", { exact: true }).fill("第 07 批");
    await expect(batches).toHaveCount(1);
    if (page.url().includes("batchFiltercursor=")) throw Error("changing a filter kept the page cursor");
    await page.reload();
    await expect(page.getByLabel("搜索批次名称", { exact: true })).toHaveValue("第 07 批");
    await expect(batches).toHaveCount(1);
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(batches).toHaveCount(20);
    // A sharing change moves every session to a new epoch: the old page cursor is refused and the list returns to the newest page.
    await page.getByRole("button", { name: "更早的批次", exact: true }).click(); await expect(batches).toHaveCount(2);
    await page.evaluate(async (project) => {
      const session = await fetch("/api/control-center/v1/session").then((r) => r.json());
      const shared = await fetch(`/api/control-center/v1/projects/${project}`).then((r) => r.json());
      const post = (path: string, body: unknown) => fetch(`/api/control-center/v1${path}?scope=${encodeURIComponent(project)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf }, body: JSON.stringify(body) }).then((r) => r.json());
      const key = crypto.randomUUID();
      const preview = await post("/actions/preview", { scope_id: project, owner: "control-center", target_kind: "project", target_ref: project, action: "project.update", expected_revision: String(shared.revision), idempotency_key: key, input: { budget_cap: 6 } });
      await post("/actions/confirm", { scope_id: project, preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: key });
    }, projectID);
    await page.reload();
    await expect(page.getByText("翻页位置已失效，已回到最新的批次。")).toBeVisible();
    await expect(batches).toHaveCount(20);
    if (page.url().includes("batchFiltercursor=")) throw Error("a lapsed page cursor stayed in the address");
  });
  await check("a batch link switches scope and opens a batch that is not on the first page; its reminder links back", async () => {
    // A new tab starts in the default scope, as a link opened from chat or mail would.
    const linked = await context.newPage();
    try {
      await linked.goto(`${ui}/#/creation?${new URLSearchParams({ sharedProject: projectID, batch: seededBatches[0] })}`);
      const opened = linked.getByLabel("打开的批次").locator("[data-batch]");
      await expect(opened).toContainText("第 01 批", { timeout: 30000 });
      // Opening it read the owner, which reports the submitted batch finished.
      await expect(opened).toContainText("已完成");
      await expect(linked.locator("[data-batch]")).toHaveCount(21);
      await linked.getByRole("button", { name: "收起", exact: true }).click();
      await expect(linked.getByLabel("打开的批次")).toHaveCount(0);
      if (new URL(linked.url()).hash.includes("batch=")) throw Error("closing the batch kept it in the address");
    } finally { await linked.close(); }
    await page.getByRole("button", { name: /^需要关注/ }).click();
    const reminder = page.getByRole("button", { name: /批次「雨夜站台 · 第 01 批」已完成/ });
    if (!await reminder.count()) await page.getByRole("button", { name: "加载更多", exact: true }).click();
    await reminder.first().click();
    await expect(page.getByLabel("打开的批次").locator("[data-batch]")).toContainText("第 01 批");
    await page.goto(`${ui}/#/projects?shared=1&sharedProject=${projectID}`);
    await page.getByRole("heading", { name: "共享影像项目 · 更新", exact: true }).waitFor();
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
