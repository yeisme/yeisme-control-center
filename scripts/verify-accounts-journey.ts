import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Account management from the web, on its own fixture (FIXTURE_ACCOUNTS=manage) so the main journey keeps refusing every
 * write: create an account and see its key once, sign in with it in another browser, reset the key as the person and as
 * an administrator, edit, disable and enable the account, and find each step in the audit log. Keys stay in this process:
 * the evidence holds check names, timings and counts only.
 */
const root = path.resolve(import.meta.dirname, "..");
const port = (name: string, fallback: number) => Number(process.env[name] || fallback);
const ports = { ui: port("ACCOUNTS_UI_PORT", 4450), api: port("ACCOUNTS_API_PORT", 4451), owner: port("ACCOUNTS_OWNER_PORT", 4452) };
const ui = `http://127.0.0.1:${ports.ui}`;
const run = path.join(root, "temp/integration-test-runs/accounts-" + new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
const password = crypto.randomUUID();
const results: { name: string; status: "passed" | "failed"; seconds: number; detail?: string }[] = [];
const errors: string[] = [];
const requested: string[] = [];
/** Every key this run saw. None may reach an address, storage, a request URL or the audit page. */
const secrets: string[] = [password];
const axeSource = await fs.readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const fixture = spawn("bun", ["scripts/fixture-preview.ts"], { cwd: root, env: { ...process.env, FIXTURE_ACCOUNTS: "manage", FIXTURE_PASSWORD: password, FIXTURE_UI_PORT: String(ports.ui), FIXTURE_API_PORT: String(ports.api), FIXTURE_OWNER_PORT: String(ports.owner) }, stdio: ["ignore", "pipe", "pipe"] });
let ready = "";
fixture.stdout.on("data", (chunk) => { ready += chunk; });
fixture.stderr.on("data", () => {});

let browser: Browser | undefined;
let admin: Page | undefined;

async function check(name: string, body: () => Promise<void>) {
  const started = Date.now();
  process.stderr.write(`… ${name}\n`);
  try {
    await body();
    results.push({ name, status: "passed", seconds: Math.round((Date.now() - started) / 1000) });
    process.stderr.write(`  passed in ${Math.round((Date.now() - started) / 1000)}s\n`);
  } catch (error) {
    let detail = error instanceof Error ? error.message : String(error);
    // What the administrator's page showed when the check failed: the accounts panel's text, never a key.
    const panel = await admin?.locator("[data-accounts], [data-page]").first().innerText().catch(() => "") || "";
    detail = `${detail}\n--- page ---\n${panel.slice(0, 800)}`;
    for (const secret of secrets) detail = detail.split(secret).join("<key>");
    await admin?.screenshot({ path: path.join(run, "artifacts", `failed-${results.length + 1}.png`) }).catch(() => undefined);
    results.push({ name, status: "failed", seconds: Math.round((Date.now() - started) / 1000), detail: detail.slice(0, 1600) });
    process.stderr.write(`  failed in ${Math.round((Date.now() - started) / 1000)}s\n`);
  }
}

async function accessible(page: Page, where: string, scope?: string) {
  await page.waitForTimeout(400);
  if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ content: axeSource });
  const found = await page.evaluate(async (selector) => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[] }> } }).axe;
    const { violations } = await axe.run(selector ? { include: [selector] } : document, { resultTypes: ["violations"] });
    return violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}@${violation.nodes.slice(0, 2).map((node) => node.target.join(" ")).join(",")}`);
  }, scope);
  if (found.length) throw new Error(`axe:${where}: ${found.join(" | ")}`);
}

async function signIn(page: Page, username: string, key: string) {
  await page.goto(ui, { waitUntil: "domcontentloaded" });
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("个人访问凭据").fill(key);
  await page.getByRole("button", { name: "进入创作台" }).click();
}
async function signedIn(page: Page, username: string, key: string) {
  await signIn(page, username, key);
  await page.locator('[data-page="home"]').waitFor({ timeout: 30_000 });
}
async function refused(page: Page, username: string, key: string) {
  await signIn(page, username, key);
  await page.getByRole("alert").waitFor();
  await expect(page.locator('[data-page="home"]')).toHaveCount(0);
}
/** The page is on the sign-in screen: a session that ended is noticed at the next read. */
async function signedOut(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "进入创作台" }).waitFor({ timeout: 20_000 });
}

/** Reads the key a reveal dialog shows, proves it cannot be closed before it is saved, then closes it. */
async function takeKey(page: Page, options: { copy?: boolean; download?: string; axe?: string } = {}) {
  const dialog = page.locator("[data-key-reveal]");
  await dialog.waitFor();
  const key = await dialog.getByLabel("新的访问 Key").inputValue();
  if (!/^yk_live_/.test(key)) throw new Error("revealed value is not an access key");
  secrets.push(key);
  await expect(dialog.getByRole("button", { name: "完成" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  if (options.axe) await accessible(page, options.axe, "[data-key-reveal]");
  if (options.copy) {
    await dialog.getByRole("button", { name: "复制 Key" }).click();
    await dialog.getByRole("button", { name: "已复制" }).waitFor();
    if (await page.evaluate(() => navigator.clipboard.readText()) !== key) throw new Error("copied text is not the key");
    await page.evaluate(() => navigator.clipboard.writeText(""));
  }
  if (options.download) {
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载为文本文件" }).click();
    const name = (await download).suggestedFilename();
    if (name !== options.download) throw new Error(`download named ${name}`);
  }
  await dialog.getByRole("checkbox", { name: "我已保存这个 Key" }).click();
  await dialog.getByRole("button", { name: "完成" }).click();
  await dialog.waitFor({ state: "detached" });
  return key;
}

const row = (page: Page, username: string) => page.locator(`[data-account="${username}"]`);
async function rowAction(page: Page, username: string, action: string) {
  await page.getByRole("button", { name: `账号 @${username} 的操作` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

const contexts: BrowserContext[] = [];
try {
  const deadline = Date.now() + 60_000;
  while (!ready.includes('"status": "ready"')) {
    if (Date.now() > deadline || fixture.exitCode !== null) throw new Error("fixture startup failed");
    await new Promise((done) => setTimeout(done, 250));
  }
  await fetch(ui).catch(() => undefined);
  const executablePath = process.env.CHROME_PATH || await fs.stat("/usr/bin/google-chrome").then(() => "/usr/bin/google-chrome").catch(() => undefined);
  browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
  const open = async () => {
    const context = await browser!.newContext({ viewport: { width: 1440, height: 960 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ui });
    contexts.push(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 200)));
    page.on("request", (request) => requested.push(request.url()));
    return page;
  };
  admin = await open();
  const lin = await open();
  const linElsewhere = await open();
  let linKey = "";

  await check("the accounts tab lists the configuration's owner as command-line only and nobody else yet", async () => {
    await signedIn(admin!, "fixture-admin", password);
    await admin!.goto(`${ui}/#/admin`, { waitUntil: "domcontentloaded" });
    await expect(admin!.getByRole("tab", { name: "账号", exact: true })).toHaveAttribute("aria-selected", "true");
    await admin!.locator("[data-legacy-owner]").getByText("用命令行管理").waitFor();
    await admin!.getByText("还没有其他账号").waitFor();
    await accessible(admin!, "accounts-empty");
  });

  await check("a new account is filled in, checked, then created, and its key is shown once", async () => {
    await admin!.getByRole("button", { name: "新建账号" }).click();
    const sheet = admin!.getByRole("dialog");
    await sheet.getByText("谁要用控制中心？").waitFor();
    await expect(sheet.getByRole("button", { name: "下一步：核对" })).toBeDisabled();
    await accessible(admin!, "account-form", '[role="dialog"]');
    await sheet.getByLabel("用户名").fill("fixture-admin");
    await sheet.getByText("这个用户名已经有了").waitFor();
    await sheet.getByLabel("用户名").fill("lin.zhou");
    await sheet.getByLabel("显示名").fill("林舟");
    await expect(sheet.getByRole("radio", { name: /^只读成员/ })).toBeChecked();
    await sheet.getByRole("checkbox", { name: "Fixture · 雨夜重逢" }).click();
    await sheet.getByRole("button", { name: "下一步：核对" }).click();
    const summary = sheet.locator("[data-account-check]");
    for (const text of ["lin.zhou", "林舟", "只读成员", "Fixture · 雨夜重逢"]) await summary.getByText(text, { exact: true }).waitFor();
    await sheet.getByRole("button", { name: "创建账号并生成 Key" }).click();
    linKey = await takeKey(admin!, { copy: true, download: "yeisme-lin.zhou-access-key.txt", axe: "key-reveal" });
    await row(admin!, "lin.zhou").getByText("有效").waitFor();
    await row(admin!, "lin.zhou").getByText("只读成员").waitFor();
    if ((await admin!.locator("body").innerText()).includes(linKey)) throw new Error("the key is still on the page");
  });

  await check("the new account signs in in another browser and sees what a viewer sees", async () => {
    await signedIn(lin, "lin.zhou", linKey);
    await signedIn(linElsewhere, "lin.zhou", linKey);
    await lin.goto(`${ui}/#/admin`, { waitUntil: "domcontentloaded" });
    await expect(lin.getByRole("tab", { name: "组织与团队", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(lin.getByRole("tab", { name: "账号", exact: true })).toHaveCount(0);
    await expect(lin.getByRole("tab", { name: "审计", exact: true })).toHaveCount(0);
    await lin.goto(`${ui}/#/team`, { waitUntil: "domcontentloaded" });
    await expect(lin.getByRole("button", { name: "重置我的访问 Key" })).toBeEnabled();
  });

  await check("a person resets their own key: a wrong key is refused, the new key is shown once, and only it signs in again", async () => {
    await lin.getByRole("button", { name: "重置我的访问 Key" }).click();
    const ask = lin.locator("[data-own-key-dialog]");
    await accessible(lin, "own-key", "[data-own-key-dialog]");
    await ask.getByLabel("现在的访问 Key").fill("yk_live_not-the-key");
    await ask.getByRole("button", { name: "重置并显示新 Key" }).click();
    await ask.getByRole("alert").getByText("现在的 Key 不对").waitFor();
    await ask.getByLabel("现在的访问 Key").fill(linKey);
    await ask.getByRole("button", { name: "重置并显示新 Key" }).click();
    await lin.locator("[data-key-reveal]").getByText("你的新访问 Key").waitFor();
    // The other browser of the same person was signed out at once; this page stays until the key is saved.
    await signedOut(linElsewhere);
    const fresh = await takeKey(lin);
    await lin.getByRole("button", { name: "进入创作台" }).waitFor();
    await refused(lin, "lin.zhou", linKey);
    await signedIn(lin, "lin.zhou", fresh);
    linKey = fresh;
  });

  await check("an administrator resets the key: the person is signed out and only the new key works", async () => {
    await rowAction(admin!, "lin.zhou", "重置访问 Key");
    const confirm = admin!.locator("[data-account-confirm]");
    await confirm.getByText("重置 @lin.zhou 的访问 Key？").waitFor();
    await accessible(admin!, "account-confirm", "[data-account-confirm]");
    await confirm.getByRole("button", { name: "重置并显示新 Key" }).click();
    const reset = await takeKey(admin!);
    await signedOut(lin);
    await refused(lin, "lin.zhou", linKey);
    await signedIn(lin, "lin.zhou", reset);
    linKey = reset;
  });

  await check("an edit saves the name and refuses a change another tab made meanwhile", async () => {
    await rowAction(admin!, "lin.zhou", "编辑名字、角色和范围");
    const sheet = admin!.getByRole("dialog");
    await sheet.getByText("@lin.zhou").first().waitFor();
    // Another tab of the administrator saves first.
    const other = await admin!.context().newPage();
    await other.goto(`${ui}/#/admin`, { waitUntil: "domcontentloaded" });
    await other.getByRole("button", { name: "账号 @lin.zhou 的操作" }).click();
    await other.getByRole("menuitem", { name: "编辑名字、角色和范围" }).click();
    await other.getByRole("dialog").getByLabel("显示名").fill("林舟（另一个标签页）");
    await other.getByRole("dialog").getByRole("button", { name: "保存修改" }).click();
    await other.getByRole("dialog").waitFor({ state: "detached" });
    await other.close();
    await sheet.getByLabel("显示名").fill("林舟 · 剪辑");
    await sheet.getByRole("button", { name: "保存修改" }).click();
    await sheet.getByText(/刚被改过/).waitFor();
    // The form starts over from what is stored now, and saving again works.
    await expect(sheet.getByLabel("显示名")).toHaveValue("林舟（另一个标签页）");
    await sheet.getByLabel("显示名").fill("林舟 · 剪辑");
    await sheet.getByRole("button", { name: "保存修改" }).click();
    await sheet.waitFor({ state: "detached" });
    await row(admin!, "lin.zhou").getByText("林舟 · 剪辑").waitFor();
  });

  await check("disabling signs the person out at once, the status tabs and search find it, and enabling lets the same key in", async () => {
    await rowAction(admin!, "lin.zhou", "停用账号");
    await admin!.locator("[data-account-confirm]").getByRole("button", { name: "停用账号" }).click();
    await row(admin!, "lin.zhou").getByText("已停用").waitFor();
    await signedOut(lin);
    await refused(lin, "lin.zhou", linKey);
    await admin!.getByRole("radio", { name: /^已停用/ }).click();
    await expect.poll(() => new URL(admin!.url()).hash).toContain("accounts-status=disabled");
    await expect(row(admin!, "lin.zhou")).toHaveCount(1);
    await admin!.getByRole("radio", { name: /^有效/ }).click();
    await expect(row(admin!, "lin.zhou")).toHaveCount(0);
    await admin!.getByRole("radio", { name: /^全部/ }).click();
    await admin!.getByLabel("搜索账号").fill("剪辑");
    await expect(row(admin!, "lin.zhou")).toHaveCount(1);
    await admin!.getByLabel("搜索账号").fill("nobody-here");
    await admin!.getByText("没有符合条件的账号").waitFor();
    await admin!.getByLabel("搜索账号").fill("");
    await rowAction(admin!, "lin.zhou", "启用账号");
    await row(admin!, "lin.zhou").getByText("有效").waitFor();
    await signedIn(lin, "lin.zhou", linKey);
  });

  await check("one-time ?token= invite logs in once, scrubs URL, rejects replay, revokes session, and supports smart paste", async () => {
    await rowAction(admin!, "lin.zhou", "生成一次性免密邀请链接");
    const dialog = admin!.locator("[data-key-reveal]");
    await dialog.waitFor();
    const inviteUrl = await dialog.getByLabel("一次性免密直连链接").inputValue();
    const tokenMatch = inviteUrl.match(/token=(yki_live_[^&#]+)/);
    if (!tokenMatch) throw new Error("invite URL missing yki_live token");
    const rawInviteToken = decodeURIComponent(tokenMatch[1]!);
    secrets.push(rawInviteToken);
    await dialog.getByRole("button", { name: "复制直连链接" }).click();
    await dialog.getByRole("button", { name: "已复制直连链接" }).waitFor();
    await dialog.getByRole("button", { name: "完成" }).click();
    await dialog.waitFor({ state: "detached" });

    // Guest 1 opens ?token= link -> auto-redeems and scrubs token from address bar
    const guest1 = await open();
    await guest1.goto(inviteUrl, { waitUntil: "domcontentloaded" });
    await guest1.locator('[data-page="home"]').waitFor({ timeout: 20_000 });
    if (guest1.url().includes("token=") || guest1.url().includes("yki_live_")) {
      throw new Error("URL was not scrubbed on ?token= entry");
    }
    await guest1.reload({ waitUntil: "domcontentloaded" });
    await guest1.locator('[data-page="home"]').waitFor({ timeout: 20_000 });

    // Guest 2 opens the exact same ?token= link -> rejected on second use
    const guest2 = await open();
    await guest2.goto(inviteUrl, { waitUntil: "domcontentloaded" });
    await guest2.getByRole("alert").waitFor();
    await expect(guest2.getByRole("alert")).toContainText("已失效");
    if (guest2.url().includes("token=") || guest2.url().includes("yki_live_")) {
      throw new Error("URL was not scrubbed on failed ?token= entry");
    }

    // Smart paste of multi-line invite card into LoginScreen fills username + key
    await guest2.evaluate((card) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", card);
      const input = document.querySelector('input[autocomplete="username"]')!;
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, `用户名：lin.zhou\n访问 Key：${linKey}`);
    await guest2.getByRole("button", { name: "进入创作台" }).click();
    await guest2.locator('[data-page="home"]').waitFor({ timeout: 20_000 });

    // Admin revokes the consumed invite -> Guest 1's invite-backed session ends, Guest 2's key session stays alive
    const invRow = admin!.locator("[data-invite]").first();
    await invRow.getByRole("button", { name: "撤回并踢下线" }).click();
    await signedOut(guest1);
    await guest2.reload({ waitUntil: "domcontentloaded" });
    await guest2.locator('[data-page="home"]').waitFor({ timeout: 20_000 });
    await guest1.context().close();
    await guest2.context().close();
  });

  await check("the palette opens the new-account form", async () => {
    const palette = admin!.getByRole("dialog", { name: "搜索" });
    await admin!.keyboard.press("Control+k");
    await palette.waitFor();
    await admin!.keyboard.type("新建账号");
    await expect(palette.getByRole("option").first()).toContainText("新建账号");
    await admin!.keyboard.press("Enter");
    await palette.waitFor({ state: "detached" });
    await admin!.getByRole("dialog").getByText("谁要用控制中心？").waitFor();
    if (new URL(admin!.url()).hash.includes("new=1")) throw new Error("the address kept new=1");
    await admin!.getByRole("dialog").getByRole("button", { name: "取消" }).click();
    await expect(admin!.getByRole("dialog")).toHaveCount(0);
  });

  await check("the audit log has every step, filters by action, and holds no key", async () => {
    await admin!.goto(`${ui}/#/admin?tab=audit`, { waitUntil: "domcontentloaded" });
    const rows = admin!.locator('[data-page="admin"] tbody tr');
    await rows.first().waitFor();
    for (const label of ["新建账号", "重置账号 Key", "重置自己的 Key", "修改账号", "停用账号", "启用账号"]) {
      await admin!.getByLabel("动作", { exact: true }).selectOption({ label });
      await expect(rows.first()).toContainText(label);
    }
    await admin!.getByLabel("动作", { exact: true }).selectOption({ label: "重置自己的 Key" });
    await admin!.getByLabel("结果", { exact: true }).selectOption("denied");
    await expect(rows).toHaveCount(1);
    await accessible(admin!, "audit-filtered");
    const text = await admin!.locator("body").innerText();
    for (const secret of secrets) if (text.includes(secret)) throw new Error("a key is on the audit page");
  });

  await check("on a phone the account list restacks into labelled cards without horizontal overflow", async () => {
    await admin!.setViewportSize({ width: 390, height: 844 });
    await admin!.goto(`${ui}/#/admin`, { waitUntil: "domcontentloaded" });
    await row(admin!, "lin.zhou").waitFor();
    if (await admin!.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error("horizontal overflow at 390");
    await accessible(admin!, "accounts-phone");
    await admin!.screenshot({ path: path.join(run, "artifacts", "accounts-390.png") });
    await admin!.setViewportSize({ width: 1440, height: 960 });
  });

  await check("no key reached an address, browser storage or a request URL, and no page threw", async () => {
    for (const page of [admin!, lin]) {
      const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
      for (const secret of secrets) if (stored.includes(secret)) throw new Error("a key is in storage or the address");
    }
    for (const url of requested) for (const secret of secrets) if (url.includes(secret)) throw new Error("a key is in a request URL");
    if (errors.length) throw new Error("runtime errors: " + errors.join(" | "));
  });
} catch (error) {
  let detail = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) detail = detail.split(secret).join("<key>");
  results.push({ name: "journey", status: "failed", seconds: 0, detail: detail.slice(0, 600) });
} finally {
  if (admin && results.some((result) => result.status === "failed")) await admin.screenshot({ path: path.join(run, "artifacts", "failure.png") }).catch(() => undefined);
  for (const context of contexts) await context.close().catch(() => undefined);
  await browser?.close();
  fixture.kill("SIGTERM");
  await new Promise((done) => { if (fixture.exitCode !== null) done(null); else { fixture.once("exit", done); setTimeout(done, 6000); } });
  const failed = results.filter((result) => result.status === "failed");
  await fs.writeFile(path.join(run, "command.txt"), "bun scripts/verify-accounts-journey.ts\n");
  await fs.writeFile(path.join(run, "env.json"), JSON.stringify({ ports, fixture_accounts: "manage", real_owner_calls: false, provider_calls: false, keys_logged: false }, null, 2) + "\n");
  await fs.writeFile(path.join(run, "summary.json"), JSON.stringify({ status: failed.length ? "failed" : "passed", passed: results.length - failed.length, failed: failed.length, checks: results, request_count: requested.length, runtime_errors: errors.length }, null, 2) + "\n");
  console.log(JSON.stringify({ status: failed.length ? "failed" : "passed", evidence: path.relative(root, run), passed: results.length - failed.length, failed: failed.map((result) => ({ name: result.name, detail: result.detail })) }, null, 2));
  if (failed.length) process.exitCode = 1;
}
