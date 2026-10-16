import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { chromium, expect } from "@playwright/test";

const origin = "http://10.10.1.101:51873";
const state = join(homedir(), ".local/state/yeisme-control-center");
const manifest = JSON.parse(await fs.readFile(join(state, "deployment.json"), "utf8"));
if (manifest.origin !== origin) throw new Error("Unexpected deployed origin.");
let password = "";
for await (const chunk of process.stdin) {
  password += chunk.toString();
  if (password.length > 1025) throw new Error("Input too long.");
}
password = password.replace(/\r?\n$/, "");
if (!password) throw new Error("Provide the existing administrator password through stdin.");
const run = resolve("temp/integration-test-runs/lan-" + new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(run + "/artifacts", { recursive: true });
await fs.writeFile(run + "/command.txt", "bun scripts/verify-lan.ts < secure-stdin\n");
await fs.writeFile(run + "/env.json", JSON.stringify({ origin, real_control_center: true, real_owner_reads: false, browser_tls_verified: false, http_lan_only: true, own_app_restart: true }, null, 2));
await fs.writeFile(run + "/stdout.log", "");
await fs.writeFile(run + "/stderr.log", "");
const results: { name: string; status: string }[] = [];
const isolatedHome = await fs.mkdtemp(join(tmpdir(), "control-lan-browser-"));
const probe = (path: string) => new Promise<{ status: number; body: string }>((ok, no) => {
  const req = request(origin + path, { timeout: 3000 }, response => {
    let body = "";
    response.on("data", chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    response.on("end", () => ok({ status: response.statusCode || 0, body }));
  });
  req.on("error", no);
  req.on("timeout", () => req.destroy(new Error("Probe timed out")));
  req.end();
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let stage = "http-probe";
try {
  const health = await probe("/api/control-center/v1/health");
  expect(health.status).toBe(200);
  expect(JSON.parse(health.body).status).toBe("ok");
  expect((await probe("/api/control-center/v1/session")).status).toBe(401);
  expect((await probe("/source.zip")).status).toBe(404);
  expect((await probe("/docs/daily-management-baseline.md")).status).toBe(404);
  results.push({ name: "LAN HTTP health, anonymous denial and deployment artifact isolation", status: "passed" });
  stage = "browser-launch";
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, env: { ...process.env, HOME: isolatedHome }, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  stage = "browser-http-navigation";
  await page.goto(origin, { waitUntil: "networkidle" });
  stage = "login-form";
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  const login = async () => {
    stage = "login-input";
    await page.getByLabel("用户名", { exact: true }).fill("yeisme");
    await page.getByLabel("个人访问密码", { exact: true }).fill(password);
    stage = "login-submit";
    await page.getByRole("button", { name: "登录个人工作区", exact: true }).click();
    stage = "authenticated-overview";
    await expect(page.getByRole("heading", { name: "运行摘要", exact: true })).toBeVisible();
  };
  await login();
  // Use the browser's same-origin HTTP session for authenticated API checks.
  const api = (path: string, method = "GET", headers: Record<string, string> = {}) => page.evaluate(async ({ path, method, headers }) => {
    const response = await fetch(path, { method, headers, credentials: "same-origin", cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, { path, method, headers });
  stage = "session-api";
  const sessionResponse = await api("/api/control-center/v1/session");
  const session = sessionResponse.body;
  expect(sessionResponse.status).toBe(200);
  expect(session.username).toBe("yeisme");
  expect(session.role).toBe("admin");
  const cookies = await page.context().cookies();
  const cookie = cookies.find(value => value.name === "yeisme_session");
  expect(cookie?.secure).toBe(false);
  expect(cookie?.httpOnly).toBe(true);
  stage = "authorization-checks";
  const denied = await api("/api/control-center/v1/services?scope=not-granted");
  expect(denied.status).toBe(404);
  const csrfDenied = await api("/api/control-center/v1/auth/logout", "POST");
  expect(csrfDenied.status).toBe(403);
  results.push({ name: "specified administrator login, HttpOnly session, scope and CSRF checks", status: "passed" });
  stage = "workspace-v18-readback";
  const workspaceV18 = await api("/api/control-center/v1/workspace-v18/state");
  expect(workspaceV18.status).toBe(200);
  expect(workspaceV18.body.projects.length).toBeGreaterThan(0);
  await page.goto(origin + "/workspace-v18.html", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "早上好，陈序。", exact: true })).toBeVisible();
  results.push({ name: "authenticated v18 workspace entry and demo API readback", status: "passed" });
  await page.goto(origin, { waitUntil: "networkidle" });
  await login();
  await page.getByRole("navigation", { name: "控制中心导航" }).getByRole("button", { name: "服务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "服务与连接", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索服务、用途或 owner" })).toBeVisible();
  const directoryResponse = await api("/api/control-center/v1/services?scope=personal");
  const directory = directoryResponse.body;
  expect(directory.services.length).toBe(26);
  expect(directory.services.filter((v: any) => ["eikona", "scaena", "sonora"].includes(v.id)).every((v: any) => v.configuration === "not_configured")).toBe(true);
  await page.screenshot({ path: run + "/artifacts/services-lan-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.screenshot({ path: run + "/artifacts/services-lan-mobile.png" });
  results.push({ name: "real HTTP service directory and honest unconfigured owners on desktop and mobile", status: "passed" });
  const restarted = spawnSync("systemctl", ["--user", "restart", "yeisme-control-center.service"], { encoding: "utf8" });
  if (restarted.status !== 0) throw new Error("Control center restart failed.");
  await expect.poll(async () => { try { return (await probe("/api/control-center/v1/health")).status; } catch { return 0; } }, { timeout: 10000 }).toBe(200);
  expect((await api("/api/control-center/v1/session")).status).toBe(401);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await login();
  results.push({ name: "own application restart preserves account and revokes old sessions", status: "passed" });
  await page.getByRole("button", { name: "账户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  expect((await api("/api/control-center/v1/session")).status).toBe(401);
  expect(errors).toEqual([]);
  results.push({ name: "logout and browser runtime checks", status: "passed" });
} catch (error) {
  // Never persist Playwright call logs: they can contain filled credentials.
  const category = error instanceof Error ? error.name : "UnknownError";
  await fs.appendFile(run + "/stderr.log", `LAN verification failed at ${stage} (${category}); sensitive browser call logs suppressed.\n`);
  console.log(JSON.stringify({ failed_stage: stage, category }));
  results.push({ name: "LAN verification", status: "failed" });
  process.exitCode = 1;
} finally {
  password = "";
  await browser?.close();
  await fs.rm(isolatedHome, { recursive: true, force: true });
  await fs.writeFile(run + "/stdout.log", results.map(r => r.status + " " + r.name).join("\n") + "\n");
  await fs.writeFile(run + "/summary.json", JSON.stringify({ status: process.exitCode ? "failed" : "passed", results, origin, real_owner_reads: false, real_control_center: true, certificate_validation_disabled: false, http_lan_only: true }, null, 2));
  console.log(JSON.stringify({ evidence: run, results }, null, 2));
}
