import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base = process.env.CONTROL_CENTER_URL || "http://127.0.0.1:4320";
const run = path.resolve(
  "temp/integration-test-runs/v7-" +
    new Date().toISOString().replace(/[:.]/g, "-"),
);
await fs.mkdir(run + "/artifacts", { recursive: true });
await fs.writeFile(
  run + "/command.txt",
  "CONTROL_CENTER_URL=" + base + " bun run test:workspace\n",
);
await fs.writeFile(
  run + "/env.json",
  JSON.stringify({ base, synthetic_data: true, production_mutations: false }),
);
await fs.writeFile(run + "/stdout.log", "");
await fs.writeFile(run + "/stderr.log", "");
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const results = [],
  errors = [];
async function check(name, action) {
  if (
    process.env.VERIFY_FILTER &&
    !new RegExp(process.env.VERIFY_FILTER).test(name)
  )
    return;
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(base + "#/tasks?env=main&project=rain");
    await p.getByRole("tab", { name: /请求历史/ }).click();
    await action(p);
    results.push({ name, status: "passed" });
    console.log("PASS " + name);
    await fs.appendFile(run + "/stdout.log", "PASS " + name + "\n");
  } catch (e) {
    results.push({ name, status: "failed", error: e.message });
    console.log("FAIL " + name + ": " + e.message.slice(0, 160));
    await fs.appendFile(run + "/stderr.log", name + "\n" + e.stack + "\n");
  } finally {
    await p.close();
  }
}
async function detail(p) {
  await p.locator("tbody tr").first().locator("td").nth(1).click();
  await expect(
    p.getByRole("button", { name: "关闭详情", exact: true }),
  ).toBeVisible();
}
async function more(p, action) {
  await p.getByRole("button", { name: "详情更多操作", exact: true }).click();
  await p.getByRole("menuitem", { name: action, exact: true }).click();
}
async function org(p, section) {
  await p.getByRole("button", { name: "组织设置", exact: true }).click();
  await p.getByRole("menuitem", { name: section, exact: true }).click();
}
await check(
  "six primary entries, one workspace switch and useful first viewport",
  async (p) => {
    await expect(
      p.locator(".page-heading,.workspace-label,.scope-bar,.nav-children"),
    ).toHaveCount(0);
    await expect(p.locator(".header-demo")).toBeVisible();
    assert.deepEqual(
      await p.locator(".navigation-tree .nav-item").allTextContents(),
      ["总览", "项目", "请求", "资产", "服务", "团队"],
    );
    await expect(
      p.getByRole("button", { name: "选择工作范围", exact: true }),
    ).toHaveCount(1);
    assert.ok((await p.locator("tbody tr").first().boundingBox()).y <= 305);
    await p.screenshot({
      path: run + "/artifacts/request-history.png",
      animations: "disabled",
    });
    await p.getByRole("button", { name: "选择工作范围", exact: true }).click();
    for (const label of [
      "环境",
      "管理视角",
      "租户范围",
      "团队范围",
      "项目范围",
    ])
      await expect(
        p.getByRole("combobox", { name: label, exact: true }),
      ).toBeVisible();
  },
);
await check(
  "three detail sections and controlled content retain original identity",
  async (p) => {
    await detail(p);
    assert.deepEqual(
      await p.locator(".right-workspace [role=tab]").allTextContents(),
      ["概况", "内容", "执行"],
    );
    await p.getByRole("tab", { name: "内容", exact: true }).click();
    await p.getByRole("button", { name: "读取完整输入", exact: true }).click();
    await expect(p.locator(".request-readable")).toContainText("设计样例");
    await p.screenshot({
      path: run + "/artifacts/input-workspace.png",
      mask: [p.locator(".request-readable")],
    });
    await p.getByRole("button", { name: "输出与响应", exact: true }).click();
    await expect(p.locator(".request-readable")).toHaveCount(0);
    await p.getByRole("button", { name: "输入与附件", exact: true }).click();
    await expect(p.locator(".request-readable")).toHaveCount(0);
  },
);
await check(
  "workspace menu pins at 1280, resizes, expands and restores focus",
  async (p) => {
    const row = p.locator("tbody tr").first();
    await row.focus();
    await p.keyboard.press("Enter");
    const title = await p.locator(".workspace-heading h2").innerText();
    await expect(p.locator(".workspace-object-icon")).toBeVisible();
    await p.setViewportSize({ width: 1280, height: 900 });
    await more(p, "固定详情");
    await expect(p.locator(".right-workspace.docked")).toBeVisible();
    await expect(
      p.getByRole("button", { name: "展开全屏详情", exact: true }),
    ).toBeVisible();
    const sep = p.getByRole("separator", { name: "调整详情宽度" });
    await sep.focus();
    await p.keyboard.press("ArrowLeft");
    const contentWidth = await p
      .locator(".main")
      .evaluate(
        (e) =>
          e.getBoundingClientRect().width -
          parseFloat(getComputedStyle(e).paddingLeft) -
          parseFloat(getComputedStyle(e).paddingRight),
      );
    assert.ok(contentWidth >= 559);
    await more(p, "展开完整视图");
    assert.equal(
      Math.round((await p.locator(".right-workspace").boundingBox()).width),
      await p.evaluate(() => document.documentElement.clientWidth),
    );
    await p.keyboard.press("Escape");
    await expect(p.locator(".right-workspace.docked")).toBeVisible();
    await more(p, "展开完整视图");
    await more(p, "收起完整视图");
    await p.setViewportSize({ width: 390, height: 844 });
    await expect(p.locator(".right-workspace.docked")).toHaveCount(0);
    await expect(p.locator(".workspace-heading h2")).toHaveText(title);
    await expect
      .poll(async () =>
        Math.round((await p.locator(".right-workspace").boundingBox()).width),
      )
      .toBeLessThanOrEqual(390);
    await p.keyboard.press("Escape");
    await expect(p.locator(".right-workspace")).toHaveCount(0);
    await expect(row).toBeFocused();
  },
);
await check(
  "navigation preferences keep six entries without duplicated shortcuts",
  async (p) => {
    await p.getByRole("button", { name: "请求导航选项", exact: true }).click();
    await p.getByRole("menuitem", { name: "收藏入口", exact: true }).click();
    await expect(p.locator(".nav-favorite")).toHaveCount(1);
    await expect(p.locator(".navigation-tree .nav-item")).toHaveCount(6);
    await p.getByRole("button", { name: "请求导航选项", exact: true }).click();
    await p.getByRole("menuitem", { name: "上移", exact: true }).click();
    assert.equal(
      (await p.locator(".navigation-tree .nav-item").allTextContents())[1],
      "请求",
    );
  },
);
await check(
  "organization separates access and quota and uses a compact form",
  async (p) => {
    await p
      .getByRole("navigation", { name: "控制中心导航" })
      .getByRole("button", { name: "团队", exact: true })
      .click();
    assert.deepEqual(await p.locator("main [role=tab]").allTextContents(), [
      "成员",
      "团队",
      "邀请",
    ]);
    assert.ok((await p.locator("tbody tr").first().boundingBox()).y <= 300);
    await p.getByRole("button", { name: "邀请成员", exact: true }).click();
    await expect
      .poll(async () =>
        Math.round((await p.locator(".right-workspace").boundingBox()).width),
      )
      .toBe(420);
    await expect
      .poll(async () =>
        p.locator(".editor-scroll .field").evaluateAll((fields) =>
          fields.every((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 200 && r.right <= 1441;
          }),
        ),
      )
      .toBe(true);
    await p.screenshot({
      path: run + "/artifacts/member-form.png",
      animations: "disabled",
    });
    await p.keyboard.press("Escape");
    await org(p, "访问授权");
    await expect(p.getByRole("table", { name: "授权矩阵" })).toBeVisible();
    await expect(p.locator(".quota-list")).toHaveCount(0);
    await org(p, "配额用量");
    await expect(p.locator(".quota-list")).toBeVisible();
    await expect(p.getByRole("table", { name: "授权矩阵" })).toHaveCount(0);
    await p.screenshot({
      path: run + "/artifacts/tenant-quotas.png",
      animations: "disabled",
    });
  },
);
for (const width of [1440, 1280, 768, 390])
  await check("workspace and form layout " + width, async (p) => {
    await detail(p);
    await p.getByRole("tab", { name: "内容", exact: true }).click();
    await p.setViewportSize({ width, height: 900 });
    await p.emulateMedia({ reducedMotion: "reduce" });
    for (const theme of ["light", "dark"]) {
      await p.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      const panel = await p.locator(".right-workspace").boundingBox();
      for (const field of await p.locator(".right-workspace input").all()) {
        const box = await field.boundingBox();
        assert.ok(box && box.x >= panel.x && box.x + box.width <= width + 1);
      }
      await p.screenshot({
        path: run + `/artifacts/input-${width}-${theme}.png`,
        animations: "disabled",
      });
    }
  });
await check(
  "mobile list shows labelled records instead of clipped desktop columns",
  async (p) => {
    await p.setViewportSize({ width: 390, height: 844 });
    const first = await p.locator("tbody tr").first().boundingBox();
    assert.ok(first.y < 400 && first.y + first.height < 844);
    await expect(p.locator("thead")).not.toBeVisible();
    await expect(
      p.locator("tbody tr").first().locator("[data-column=state]"),
    ).toBeVisible();
    await p.screenshot({
      path: run + "/artifacts/mobile-records.png",
      animations: "disabled",
    });
  },
);
await browser.close();
if (errors.length)
  results.push({
    name: "page exceptions",
    status: "failed",
    error: errors.join("; "),
  });
const summary = {
  design_revision: "admincn-v7",
  status: results.every((r) => r.status === "passed") ? "passed" : "failed",
  tests: results.length,
  passed: results.filter((r) => r.status === "passed").length,
  results,
};
await fs.writeFile(run + "/summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, results: undefined, evidence: run }));
process.exitCode = summary.status === "passed" ? 0 : 1;
