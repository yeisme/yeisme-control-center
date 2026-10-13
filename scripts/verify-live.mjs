import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base = process.env.CONTROL_CENTER_LIVE_URL || "http://127.0.0.1:4312";
const run = path.resolve(
  "temp/integration-test-runs/live-" +
    new Date().toISOString().replace(/[:.]/g, "-"),
);
await fs.mkdir(run + "/artifacts", { recursive: true });
await fs.writeFile(run + "/command.txt", "node scripts/verify-live.mjs\n");
await fs.writeFile(
  run + "/env.json",
  JSON.stringify({ base, browser_fixtures: true, real_owner_reads: false }),
);
await fs.writeFile(run + "/stdout.log", "");
await fs.writeFile(run + "/stderr.log", "");
const results = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: "passed" });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "failed", error: e.message });
    await fs.appendFile(run + "/stderr.log", e.stack + "\n");
    console.log("FAIL " + name + ": " + e.message.slice(0, 160));
  }
}
await check(
  "unconfigured live surface requires identity and never silently uses demo",
  async () => {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await p.goto(base);
    await expect(p.locator("main")).toContainText("请登录");
    await expect(p.locator("main")).not.toContainText("雨夜重逢");
    await p.screenshot({ path: run + "/artifacts/live-login.png" });
    await p.close();
  },
);
await check(
  "two same-name tenants clear selection and reject late scope results",
  async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const p = await context.newPage();
    const calls = [];
    let holdOldScope = false,
      releaseOldScope;
    let oldResponseFinished;
    const oldResponse = new Promise((resolve) => {
      oldResponseFinished = resolve;
    });
    const scope = (id) => ({
      id,
      tenant: "tenant-" + id,
      team: "team",
      project: "p",
      label: "同名项目",
      owners: ["eikona"],
    });
    const row = (id) => ({
      id: "same-request",
      owner: "eikona",
      tenant: "tenant-" + id,
      project: "p",
      title: "scope-" + id + "-only",
      kind: "generation",
      state: "succeeded",
      native_state: "succeeded",
      actor: "same-name",
      actor_type: "human",
      created_at: new Date().toISOString(),
      duration_ms: null,
      model: null,
      parent_ref: null,
      attempts: [],
      output_refs: [],
      attachments: [],
      input: "unknown",
      output: "not_recorded",
      submitted: {},
      effective: {},
      coverage: {
        owner: "eikona",
        state: "partial",
        observed_at: new Date().toISOString(),
      },
    });
    await context.route("**/api/control-center/v1/**", async (route) => {
      const u = new URL(route.request().url()),
        s = u.searchParams.get("scope") || "a";
      calls.push({ path: u.pathname, method: route.request().method() });
      let value;
      if (u.pathname.endsWith("/auth/methods")) value = { oidc: true };
      else if (u.pathname.endsWith("/session"))
        value = {
          name: "同名成员",
          identity: "test|one",
          csrf: "fixture-csrf",
          scopes: [scope("a"), scope("b")],
        };
      else if (u.pathname.endsWith("/organization"))
        value = { tenant: "tenant-" + s, sources: [] };
      else if (u.pathname.endsWith("/summary"))
        value = { sources: [], complete: false };
      else if (u.pathname.endsWith("/requests")) {
        if (s === "a" && holdOldScope)
          await new Promise((resolve) => {
            releaseOldScope = resolve;
          });
        value = { rows: [row(s)], coverage: [row(s).coverage] };
      } else value = row(s);
      try {
        await route.fulfill({ json: value });
      } finally {
        if (s === "a" && holdOldScope && u.pathname.endsWith("/requests"))
          oldResponseFinished();
      }
    });
    await p.goto(base + "/#/tasks");
    await expect(p.locator("main")).toContainText("scope-a-only");
    await p.locator("tbody tr").first().locator("td").nth(1).click();
    await expect(
      p.getByRole("button", { name: "关闭详情", exact: true }),
    ).toBeVisible();
    await p.getByRole("button", { name: "关闭详情", exact: true }).click();
    holdOldScope = true;
    const pendingOldScope = p.waitForRequest((request) => {
      const u = new URL(request.url());
      return (
        u.pathname.endsWith("/requests") && u.searchParams.get("scope") === "a"
      );
    });
    await p.getByRole("button", { name: "刷新", exact: true }).click();
    await pendingOldScope;
    await p.getByRole("button", { name: "选择工作范围", exact: true }).click();
    await p.getByRole("combobox", { name: "租户与项目范围" }).click();
    await p
      .getByRole("option", { name: "tenant-b / 同名项目", exact: true })
      .click();
    await p.getByRole("button", { name: "收起工作范围", exact: true }).click();
    await expect(p.locator("main")).toContainText("scope-b-only");
    assert.equal(typeof releaseOldScope, "function");
    releaseOldScope();
    await oldResponse;
    await expect(p.locator("main")).toContainText("scope-b-only");
    await expect(p.locator("main")).not.toContainText("scope-a-only");
    await p.getByRole("button", { name: "列表选项", exact: true }).click();
    await p.getByRole("menuitem", { name: /^导出/, exact: false }).click();
    await expect(p.getByRole("dialog")).toContainText("当前已读取批次");
    await expect(p.getByRole("dialog")).not.toContainText("全部筛选结果");
    await p.getByRole("button", { name: "关闭对话框", exact: true }).click();
    assert.ok(calls.every((c) => c.method === "GET"));
    await p.screenshot({ path: run + "/artifacts/live-scoped-fixture.png" });
    await context.close();
  },
);
await browser.close();
const summary = {
  status: results.every((r) => r.status === "passed") ? "passed" : "failed",
  tests: results.length,
  passed: results.filter((r) => r.status === "passed").length,
  results,
};
await fs.writeFile(
  run + "/stdout.log",
  results.map((r) => r.status + " " + r.name).join("\n"),
);
await fs.writeFile(run + "/summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, results: undefined, evidence: run }));
process.exitCode = summary.status === "passed" ? 0 : 1;
