import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { serviceDefinitions, type ServiceDirectory, type ControlCenterSession } from "../src/service-directory";
import type { TaskPage, TaskSnapshot } from "../src/task-observation";

const run = path.resolve("temp/integration-test-runs/daily-frontend-" + new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(run + "/artifacts", { recursive: true });
await fs.writeFile(run + "/command.txt", "bun scripts/verify-daily-frontend.ts\n");
await fs.writeFile(run + "/env.json", JSON.stringify({ phase: "FRONTEND", browser: true, api: "network contract mocks", real_backend: false, real_owner_reads: false, provider_calls: false }, null, 2));
await fs.writeFile(run + "/stdout.log", "");
await fs.writeFile(run + "/stderr.log", "");
const results: { name: string; status: string }[] = [];
const pageErrors: string[] = [];
let authenticated = false;
let directoryFailure = false;
const password = "browser-contract-only";
const session: ControlCenterSession = {
  name: "Browser test", username: "test-admin", role: "admin", identity: "yeisme:personal|test-admin", csrf: "test-csrf",
  task_connections: true, scopes: [{ id: "test", tenant: "personal", team: "", project: "p", label: "测试工作区", owners: [] }],
};
const directory: ServiceDirectory = {
  schema_version: "yeisme.service_directory.v1",
  services: serviceDefinitions.map(s => ({ ...s, connections: [], configuration: s.integration === "not_integrated" ? "needs_contract" : "not_configured", observation: "not_checked" })),
};
const task: TaskSnapshot = {
  schema_version: "yeisme.task_observation.v1", locator: { owner: "eikona", instance_id: "test", project: "p", task_family: "run", task_ref: "test-result" },
  task_key: "test-key", connection_id: "eikona-test", title: "测试结果引用", state: "succeeded", native_state: "succeeded", stage: "completed", revision: "1",
  created_at: "2026-10-01T00:00:00Z", updated_at: null, observed_at: new Date().toISOString(), started_at: null,
  progress: { kind: "indeterminate", completed: null, total: null, percent: null }, source: "test", actor: null, parent_ref: null,
  results: [{ ref: "eikona://artifact/test", name: "测试图像", mime: "image/png", bytes: null, state: "candidate" }],
  allowed_actions: [{ action: "cancel", enabled: false, reason: "not_supported" }], coverage: "partial",
};
const taskPage: TaskPage = { rows: [task], next_cursors: {}, connections: [{ id: "eikona-test", owner: "eikona", instance_id: "test", label: "测试图像实例", environment: "test", project: "p", state: "ready", observed_at: new Date().toISOString() }] };
const vite = await createServer({ configFile: path.resolve("vite.config.ts"), server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "error" });
await vite.listen();
const address = vite.httpServer!.address();
if (!address || typeof address === "string") throw Error("Preview port unavailable");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
page.on("pageerror", error => pageErrors.push(error.message));
await page.route("**/api/control-center/**", async route => {
  const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.replace("/api/control-center/v1", "");
  const reply = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
  if (endpoint === "/auth/methods") return reply({ personal: true, username_required: true, oidc: false, mode: "live", owners: [] });
  if (endpoint === "/auth/personal") {
    const input = request.postDataJSON();
    authenticated = input.username === "test-admin" && input.password === password;
    return authenticated ? reply({ ok: true }) : reply({ error: "invalid_credentials" }, 401);
  }
  if (!authenticated) return reply({ error: "login_required" }, 401);
  if (endpoint === "/session") return reply(session);
  if (endpoint === "/auth/logout") { authenticated = false; return reply({ ok: true }); }
  if (url.searchParams.get("scope") !== "test") return reply({ error: "scope_not_found" }, 404);
  if (endpoint === "/services") return directoryFailure ? reply({ error: "source_unavailable" }, 503) : reply(directory);
  if (endpoint === "/tasks") return reply(url.searchParams.get("mode") === "history" ? taskPage : { ...taskPage, rows: [] });
  if (endpoint === "/tasks/test-key") return reply(task);
  if (endpoint === "/tasks/test-key/events") return reply({ events: [], gap: true });
  return reply({ error: "operation_not_allowed" }, 405);
});
const check = async (name: string, fn: () => Promise<void>) => {
  await fn();
  results.push({ name, status: "passed" });
  await fs.appendFile(run + "/stdout.log", "PASS " + name + "\n");
};
const login = async () => {
  await page.getByLabel("用户名", { exact: true }).fill("test-admin");
  await page.getByLabel("个人访问密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录个人工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "运行摘要", exact: true })).toBeVisible();
};
const navigate = async (name: string) => {
  const region = name === "设置" ? page : page.getByRole("navigation", { name: "控制中心导航" });
  await region.getByRole("button", { name, exact: true }).click();
};
try {
  await check("named login, invalid credentials and sensitive-input clearing", async () => {
    await page.goto(origin);
    await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
    await page.getByLabel("用户名", { exact: true }).fill("wrong-user");
    await page.getByLabel("个人访问密码", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "登录个人工作区", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("用户名或密码不正确");
    await expect(page.getByLabel("个人访问密码", { exact: true })).toHaveValue("");
    await page.screenshot({ path: run + "/artifacts/login.png" });
    await login();
  });
  await check("full service directory, search, missing contract and keyboard detail", async () => {
    await navigate("服务");
    await expect(page.getByRole("heading", { name: "服务与连接", exact: true })).toBeVisible();
    const search = page.getByRole("textbox", { name: "搜索服务、用途或 owner" });
    await search.fill("Eikona");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    const open = page.locator("tbody tr").filter({ hasText: "Eikona" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toContainText("当前范围没有已登记");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(open).toBeFocused();
    await search.fill("does-not-exist");
    await expect(page.getByText("没有符合筛选的服务", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.screenshot({ path: run + "/artifacts/services-desktop.png" });
  });
  await check("all six routes preserve real-mode boundaries and local admin role", async () => {
    await navigate("项目");
    await expect(page.getByRole("button", { name: "查看项目请求" })).toBeVisible();
    await navigate("请求");
    await expect(page.getByRole("heading", { name: "任务与执行进展", exact: true })).toBeVisible();
    await navigate("团队");
    await expect(page.getByText("最高管理员（控制中心）", { exact: true })).toBeVisible();
    await navigate("设置");
    await expect(page.getByRole("heading", { name: "个人账号", exact: true })).toBeVisible();
    await expect(page.getByText("最高管理员（控制中心）", { exact: true })).toBeVisible();
    await navigate("总览");
    await expect(page.getByRole("region", { name: "现在需要处理" })).toBeVisible();
  });
  await check("asset entry uses authorized historical result references", async () => {
    await navigate("资产");
    await expect(page.getByRole("heading", { name: "任务结果与资产引用", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "测试结果引用", exact: true }).click();
    await expect(page.getByRole("tab", { name: /结果/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("dialog")).toContainText("测试图像");
    await page.keyboard.press("Escape");
  });
  await check("directory failure clears records rather than switching to demo", async () => {
    await navigate("服务");
    directoryFailure = true;
    await page.getByRole("button", { name: "刷新目录", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("服务目录暂不可用");
    await expect(page.locator("tbody tr")).toHaveCount(0);
    directoryFailure = false;
    await page.getByRole("button", { name: "刷新目录", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "搜索服务、用途或 owner" })).toBeVisible();
  });
  await check("session expiration clears data and returns to named login", async () => {
    authenticated = false;
    await page.getByRole("button", { name: "刷新目录", exact: true }).click();
    await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await page.goto(origin);
    await login();
  });
  await check("observed connection to scoped task history, detail and restored filters", async () => {
    const eikona = directory.services.find(s => s.id === "eikona")!;
    eikona.configuration = "configured";
    eikona.connections = [{ id: "eikona-test", instance_id: "test", label: "Eikona 内网", environment: "test", project: "p", enabled: true,
      configuration: "configured", content_requested: true, cancellation_requested: false,
      runtime: { state: "ready", checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), transport: "verified", authorization: "verified", contract: "supported", task_families: ["run"], content: "not_verified" } }];
    await navigate("服务");
    await page.getByRole("button", { name: "刷新目录", exact: true }).click();
    await page.getByRole("region", { name: "核心服务接入" }).getByRole("button", { name: "查看接入" }).nth(1).click();
    await expect(page.getByRole("dialog")).toContainText(/内容能力尚未验证|本地内容意愿已开启/);
    await page.getByRole("button", { name: "查看此实例任务", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "服务实例", exact: true })).toHaveValue("eikona-test");
    await page.getByRole("tab", { name: "任务历史与结果", exact: true }).click();
    await page.getByRole("button", { name: "测试结果引用", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("test-result");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "服务实例", exact: true })).toHaveValue("eikona-test");
    await navigate("服务");
    await navigate("请求");
    await expect(page.getByRole("combobox", { name: "服务实例", exact: true })).toHaveValue("eikona-test");
    await expect(page.getByRole("tab", { name: "任务历史与结果", exact: true })).toHaveAttribute("aria-selected", "true");
  });
  await check("overview includes historical attention and recent result facts", async () => {
    task.state = "failed";
    await navigate("总览");
    await expect(page.getByRole("region", { name: "现在需要处理" })).toContainText("测试结果引用");
    await page.screenshot({ path: run + "/artifacts/overview-observed.png" });
    task.state = "succeeded";
    await page.getByRole("region", { name: "核心服务接入" }).getByRole("button", { name: "查看接入" }).nth(1).click();
    await expect(page.getByRole("dialog")).toContainText("Eikona");
    await page.keyboard.press("Escape");
    await navigate("请求");
    await expect(page.getByRole("tab", { name: "任务历史与结果", exact: true })).toHaveAttribute("aria-selected", "true");
  });
  await check("responsive service directory in light and dark without page overflow", async () => {
    await navigate("服务");
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await expect(page.getByRole("heading", { name: "服务与连接", exact: true })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        expect(overflow).toBe(false);
        await page.screenshot({ path: `${run}/artifacts/services-${width}-${theme}.png` });
      }
    }
  });
  await check("logout invalidates browser session state", async () => {
    await page.getByRole("button", { name: "账户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
    expect(authenticated).toBe(false);
    expect(pageErrors).toEqual([]);
  });
} catch (error) {
  results.push({ name: "frontend verification", status: "failed" });
  await fs.appendFile(run + "/stderr.log", (error instanceof Error ? error.stack : String(error)) + "\n");
  await page.screenshot({ path: run + "/artifacts/failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await vite.close();
  await fs.writeFile(run + "/summary.json", JSON.stringify({ status: process.exitCode ? "failed" : "passed", results, page_errors: pageErrors, phase: "FRONTEND", real_backend: false, real_owner_reads: false }, null, 2));
  console.log(JSON.stringify({ evidence: run, results }, null, 2));
}
