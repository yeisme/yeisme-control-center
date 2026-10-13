import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { verifyAssets } from "./verify-assets.mjs";

const base =
  process.env.CONTROL_CENTER_URL || "http://127.0.0.1:4298/?mode=demo";
const frame = process.env.FRAME_URL || "";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const area = path.resolve("temp/integration-test-runs/" + runId);
await fs.mkdir(path.join(area, "artifacts"), { recursive: true });
await fs.writeFile(
  path.join(area, "command.txt"),
  `CONTROL_CENTER_URL=${base}${frame ? " FRAME_URL=" + frame : ""} bun run test:ui\n`,
);
await fs.writeFile(
  path.join(area, "env.json"),
  JSON.stringify(
    {
      node: process.version,
      preview: base,
      frame: frame || null,
      temporary_browser_context: true,
      real_service_mutations: false,
    },
    null,
    2,
  ),
);
const results = [],
  errors = [],
  forbidden = [];
let browser;
let count = 0;
const log = async (text) => {
  console.log(text);
  await fs.appendFile(path.join(area, "stdout.log"), text + "\n");
};
await fs.writeFile(path.join(area, "stdout.log"), "");
await fs.writeFile(path.join(area, "stderr.log"), "");
const check = async (name, fn) => {
  if (
    process.env.VERIFY_FILTER &&
    !new RegExp(process.env.VERIFY_FILTER).test(name)
  )
    return;
  try {
    await fn();
    results.push({ name, status: "passed" });
    await log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "failed", error: e.message });
    await fs.appendFile(
      path.join(area, "stderr.log"),
      name + ": " + e.stack + "\n",
    );
    await log("FAIL " + name + ": " + e.message.slice(0, 180));
  }
};
const pick = async (p, label, text) => {
  const demo = ["状态演练", "身份演练"].includes(label);
  const scope = [
    "管理视角",
    "租户范围",
    "团队范围",
    "项目范围",
    "环境",
  ].includes(label);
  if (
    (scope || demo || label === "环境") &&
    (await p.getByRole("button", { name: "关闭详情", exact: true }).isVisible())
  ) {
    await p.getByRole("button", { name: "关闭详情", exact: true }).click();
    if (await p.getByRole("alertdialog").isVisible())
      await p.getByRole("button", { name: "放弃修改", exact: true }).click();
  }
  const advanced = [
    "服务筛选",
    "调用者筛选",
    "历史项目",
    "输入类型",
    "附件筛选",
    "产出筛选",
  ].includes(label);
  if (scope)
    await p.getByRole("button", { name: "选择工作范围", exact: true }).click();
  if (advanced)
    await p
      .getByRole("button", { name: "更多筛选", exact: true })
      .first()
      .click();
  if (demo)
    await p.getByRole("button", { name: "设计演示", exact: true }).click();
  await p.getByRole("combobox", { name: label, exact: true }).click();
  await p.getByRole("option", { name: text, exact: true }).click();
  if (demo)
    await p.getByRole("button", { name: "关闭对话框", exact: true }).click();
  if (scope)
    await p.getByRole("button", { name: "收起工作范围", exact: true }).click();
  if (advanced) await p.keyboard.press("Escape");
};
const nav = async (p, label) => {
  const close = p.getByRole("button", { name: "关闭详情", exact: true });
  if (await close.isVisible()) await close.click();
  if (
    await p.getByRole("button", { name: "打开导航", exact: true }).isVisible()
  )
    await p.getByRole("button", { name: "打开导航", exact: true }).click();
  const names = {
    运行总览: "总览",
    项目与工作台: "项目",
    请求与生成: "请求",
    资产与交接: "资产",
    服务与连接: "服务",
    组织与成员: "团队",
  };
  if (label === "设置" || label === "诊断与审计") {
    await p
      .locator("aside")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    if (label === "诊断与审计")
      await p.getByRole("tab", { name: "诊断与审计", exact: true }).click();
  } else if (label === "统计与成本") {
    await p
      .getByRole("navigation", { name: "控制中心导航" })
      .getByRole("button", { name: "总览", exact: true })
      .click();
    await p.getByRole("tab", { name: "统计与成本", exact: true }).click();
  } else if (label === "审阅与批准") {
    await p
      .getByRole("navigation", { name: "控制中心导航" })
      .getByRole("button", { name: "请求", exact: true })
      .click();
    await p.getByRole("button", { name: "待处理", exact: true }).click();
  } else
    await p
      .getByRole("navigation", { name: "控制中心导航" })
      .getByRole("button", { name: names[label] || label, exact: true })
      .click();
};
const tableMenu = async (p) => {
  if (
    await p
      .getByRole("menu")
      .isVisible()
      .catch(() => false)
  )
    await p.keyboard.press("Escape");
  await p
    .getByRole("button", { name: "列表选项", exact: true })
    .first()
    .click();
};
const exportHistory = async (p) => {
  await tableMenu(p);
  await p.getByRole("menuitem", { name: "导出请求历史", exact: true }).click();
};
const orgSection = async (p, name) => {
  await p.getByRole("button", { name: "组织设置", exact: true }).click();
  await p.getByRole("menuitem", { name, exact: true }).click();
};
const fresh = async (hash = "") => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await ctx.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method()) ||
      /\/api\/v[0-9]|\/mcp$/.test(u.pathname)
    ) {
      forbidden.push({ method: req.method(), path: u.pathname });
      await route.abort();
      return;
    }
    if (
      frame &&
      base.startsWith("http://127.0.0.1") &&
      u.pathname.startsWith("/api/projects/yeisme-service-control-center/raw/")
    ) {
      const target =
        base.replace(/\/$/, "") + "/" + u.pathname.split("/raw/")[1];
      const r = await route.fetch({ url: target });
      await route.fulfill({ response: r });
      return;
    }
    await route.continue();
  });
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  const p = await ctx.newPage();
  await p.goto(base + hash, { waitUntil: "networkidle" });
  return { p, ctx };
};
const shot = async (p, name) => {
  await p.waitForFunction(
    () =>
      [
        ...document.querySelectorAll(
          ".object-view,.quicklook,.finder-inspector,.inspector.drawer,.modal",
        ),
      ].every((el) => Number(getComputedStyle(el).opacity) > 0.999),
    null,
    { timeout: 5000 },
  );
  await p.screenshot({
    animations: "disabled",
    path: path.join(area, "artifacts", name + ".png"),
  });
  count++;
};
try {
  const exe =
    process.env.CHROME_PATH ||
    (existsSync("/usr/bin/google-chrome")
      ? "/usr/bin/google-chrome"
      : undefined);
  browser = await chromium.launch({
    headless: true,
    ...(exe ? { executablePath: exe } : {}),
  });
  await check("all ten pages navigate and show scoped content", async () => {
    const { p, ctx } = await fresh();
    for (const label of [
      "运行总览",
      "项目与工作台",
      "服务与连接",
      "请求与生成",
      "资产与交接",
      "审阅与批准",
      "统计与成本",
      "诊断与审计",
      "组织与成员",
      "设置",
    ]) {
      await nav(p, label);
      await expect(p.locator("h1")).toHaveText(
        {
          运行总览: "总览",
          项目与工作台: "项目",
          服务与连接: "服务",
          请求与生成: "请求",
          资产与交接: "资产",
          审阅与批准: "待处理",
          组织与成员: "团队",
        }[label] || label,
      );
      await shot(p, "page-" + label);
    }
    await ctx.close();
  });
  await check("three core services expose all five detail views", async () => {
    const { p, ctx } = await fresh();
    await nav(p, "服务与连接");
    for (const name of ["Scaena", "Eikona", "Sonora"]) {
      await p
        .getByRole("button", { name: "管理 " + name, exact: true })
        .click();
      for (const tab of ["概况", "连接与能力", "配置", "访问", "诊断"]) {
        await p.getByRole("tab", { name: tab, exact: true }).click();
        await expect(p.getByRole("tabpanel", { name: tab })).toBeVisible();
      }
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
    }
    await ctx.close();
  });
  await check(
    "unknown result reconciles original identity without duplicate submission",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "请求与生成");
      await p
        .getByRole("button", { name: "旧车站 · 重逢镜头视频", exact: true })
        .click();
      await p
        .getByRole("button", { name: "查询原结果", exact: true })
        .evaluate((el) => {
          el.click();
          el.click();
        });
      await expect(
        p.getByText("result_recovered", { exact: true }),
      ).toBeVisible();
      await expect(
        p.getByText("demo:scaena:video-039", { exact: true }),
      ).toBeVisible();
      await expect(
        p.getByRole("button", {
          name: "旧车站 · 重逢镜头视频",
          exact: true,
          includeHidden: true,
        }),
      ).toHaveCount(1);
      await expect(
        p.getByRole("button", { name: "批准新的尝试", exact: true }),
      ).toHaveCount(0);
      await ctx.close();
    },
  );
  await check(
    "rights failure cannot retry; paid retry needs explicit acknowledgement",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "请求与生成");
      await p
        .getByRole("button", { name: "林晚 · 第 01 场对白", exact: true })
        .click();
      await expect(
        p.getByRole("button", { name: "批准新的尝试", exact: true }),
      ).toHaveCount(0);
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await p
        .getByRole("button", { name: "创作资料库 · 来源采集", exact: true })
        .click();
      await p
        .getByRole("button", { name: "批准新的尝试", exact: true })
        .click();
      await expect(
        p.getByRole("button", { name: "确认操作", exact: true }),
      ).toBeDisabled();
      await p.getByRole("checkbox", { name: /我已确认影响范围/ }).check();
      await p.getByRole("button", { name: "确认操作", exact: true }).click();
      await expect(
        p.getByText("demo:firecrawl:source-008-attempt-2", { exact: true }),
      ).toBeVisible();
      await expect(
        p.locator("tbody tr").filter({ hasText: "创作资料库 · 来源采集" }),
      ).toHaveCount(2);
      await ctx.close();
    },
  );
  await check(
    "batch reconcile reports independent successes and failures",
    async () => {
      const { p, ctx } = await fresh();
      await pick(p, "状态演练", "批量部分失败");
      await nav(p, "请求与生成");
      await p
        .getByRole("checkbox", {
          name: "选择 旧车站 · 重逢镜头视频",
          exact: true,
        })
        .check();
      await p
        .getByRole("checkbox", {
          name: "选择 林晚 · 第 01 场对白",
          exact: true,
        })
        .check();
      await p.getByRole("button", { name: "查询原结果", exact: true }).click();
      await expect(
        p.locator(".right-workspace").filter({ hasText: "批量处理结果" }),
      ).toBeVisible();
      await expect(
        p.getByText("此任务不支持原结果对账，保留原状态", { exact: true }),
      ).toBeVisible();
      await shot(p, "batch-partial");
      await ctx.close();
    },
  );
  await check(
    "configuration previews then saves and reads back a new revision",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "服务与连接");
      await p.getByRole("button", { name: "管理 Scaena", exact: true }).click();
      await p.getByRole("tab", { name: "配置", exact: true }).click();
      await p
        .getByRole("button", { name: "编辑演示配置", exact: true })
        .click();
      await p
        .getByRole("spinbutton", { name: "并发上限", exact: true })
        .fill("7");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await shot(p, "config-preview");
      await p
        .getByRole("button", { name: "确认变更并回读", exact: true })
        .click();
      await expect(p.locator(".receipt-summary")).toContainText(
        "配置已更新并回读",
      );
      await p.getByRole("button", { name: "返回配置", exact: true }).click();
      await expect(p.locator(".config-version")).toContainText("r2");
      await expect(p.getByRole("tabpanel", { name: "配置" })).toContainText(
        "7",
      );
      await ctx.close();
    },
  );
  await check(
    "configuration conflict preserves draft and rebases on fresh revision",
    async () => {
      const { p, ctx } = await fresh();
      await pick(p, "状态演练", "配置版本冲突");
      await nav(p, "服务与连接");
      await p.getByRole("button", { name: "管理 Scaena", exact: true }).click();
      await p.getByRole("tab", { name: "配置", exact: true }).click();
      await p
        .getByRole("button", { name: "编辑演示配置", exact: true })
        .click();
      await p
        .getByRole("spinbutton", { name: "并发上限", exact: true })
        .fill("8");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await p
        .getByRole("button", { name: "确认变更并回读", exact: true })
        .click();
      await expect(p.getByRole("alert")).toContainText("配置版本冲突");
      await shot(p, "config-conflict");
      await p
        .getByRole("button", { name: "读取新版本并保留草稿", exact: true })
        .click();
      await expect(
        p.getByRole("button", { name: "确认变更并回读", exact: true }),
      ).toHaveCount(0);
      await expect(
        p.getByRole("spinbutton", { name: "并发上限", exact: true }),
      ).toHaveValue("8");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await p
        .getByRole("button", { name: "确认变更并回读", exact: true })
        .click();
      await p.getByRole("button", { name: "返回配置", exact: true }).click();
      await expect(p.locator(".config-version")).toContainText("r3");
      await ctx.close();
    },
  );
  await check(
    "configuration save failure keeps draft and effective revision",
    async () => {
      const { p, ctx } = await fresh();
      await pick(p, "状态演练", "配置保存失败");
      await nav(p, "服务与连接");
      await p.getByRole("button", { name: "管理 Eikona", exact: true }).click();
      await p.getByRole("tab", { name: "配置", exact: true }).click();
      await p
        .getByRole("button", { name: "编辑演示配置", exact: true })
        .click();
      await p
        .getByRole("spinbutton", { name: "并发上限", exact: true })
        .fill("9");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await p
        .getByRole("button", { name: "确认变更并回读", exact: true })
        .click();
      await expect(p.getByRole("alert")).toContainText("保存失败");
      await p.getByRole("button", { name: "返回修改", exact: true }).click();
      await expect(
        p.getByRole("spinbutton", { name: "并发上限", exact: true }),
      ).toHaveValue("9");
      await p.getByRole("button", { name: "取消", exact: true }).click();
      await p.getByRole("button", { name: "放弃修改", exact: true }).click();
      await expect(p.locator(".config-version")).toContainText("r1");
      await ctx.close();
    },
  );
  await check(
    "onboarding accepts references and remains unverified",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "服务与连接");
      await p.getByRole("button", { name: "接入服务", exact: true }).click();
      await p
        .getByRole("textbox", { name: "实例名称", exact: true })
        .fill("Eikona · 工作室二号");
      await p.getByRole("button", { name: "下一步", exact: true }).click();
      await p
        .getByRole("textbox", { name: "连接引用", exact: true })
        .fill("https://untrusted.invalid");
      await p.getByRole("button", { name: "检查引用", exact: true }).click();
      await expect(p.getByRole("alert")).toContainText("不输入网址");
      await p
        .getByRole("textbox", { name: "连接引用", exact: true })
        .fill("connection://lan/eikona-two");
      await p.getByRole("button", { name: "检查引用", exact: true }).click();
      await p
        .getByRole("button", { name: "保存演示实例", exact: true })
        .click();
      await expect(p.locator(".receipt-summary")).toContainText(
        "演示实例已保存",
      );
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await expect(
        p.getByRole("button", {
          name: "管理 Eikona · 工作室二号",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        p.locator("tr").filter({ hasText: "Eikona · 工作室二号" }),
      ).toContainText("待接入");
      await ctx.close();
    },
  );
  await check(
    "scope and role changes invalidate details, rows and actions",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "请求与生成");
      await p
        .getByRole("button", { name: "旧车站 · 重逢镜头视频", exact: true })
        .click();
      await pick(p, "项目范围", "海岸来信");
      await expect(
        p.getByRole("complementary", { name: "详情与上下文" }),
      ).toHaveCount(0);
      await expect(
        p.getByRole("button", { name: "旧车站 · 重逢镜头视频", exact: true }),
      ).toHaveCount(0);
      await pick(p, "环境", "隔离测试环境");
      await expect(p.locator("tbody tr")).toHaveCount(0);
      await pick(p, "环境", "内网主环境");
      await pick(p, "项目范围", "全部项目");
      await pick(p, "身份演练", "只读成员");
      await nav(p, "服务与连接");
      await expect(
        p.getByRole("button", { name: "接入服务", exact: true }),
      ).toBeDisabled();
      await p.getByRole("button", { name: "管理 Scaena", exact: true }).click();
      await p.getByRole("tab", { name: "配置", exact: true }).click();
      await expect(
        p.getByRole("button", { name: "编辑演示配置", exact: true }),
      ).toBeDisabled();
      await ctx.close();
    },
  );

  await check(
    "pending recovery is invalidated when project scope changes",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "请求与生成");
      await p
        .getByRole("button", { name: "旧车站 · 重逢镜头视频", exact: true })
        .click();
      await p.clock.install();
      await p.getByRole("button", { name: "查询原结果", exact: true }).click();
      await pick(p, "项目范围", "海岸来信");
      await p.clock.runFor(800);
      await expect(
        p.getByRole("button", { name: "旧车站 · 重逢镜头视频", exact: true }),
      ).toHaveCount(0);
      await pick(p, "项目范围", "全部项目");
      await p
        .getByRole("button", { name: "旧车站 · 重逢镜头视频", exact: true })
        .click();
      await expect(
        p.getByText("unknown_accept", { exact: true }),
      ).toBeVisible();
      await ctx.close();
    },
  );
  await check(
    "all failure scenarios render truthful state and permission gates",
    async () => {
      const { p, ctx } = await fresh();
      for (const value of [
        "服务不可达",
        "认证失效",
        "权限不足",
        "能力缺失",
        "快照过期",
      ]) {
        await pick(p, "状态演练", value);
        await expect(p.locator(".global-notice")).toBeVisible();
        await nav(p, "请求与生成");
        await p
          .getByRole("button", { name: "旧车站 · 重逢镜头视频", exact: true })
          .click();
        if (value !== "快照过期")
          await expect(
            p.getByRole("button", { name: "查询原结果", exact: true }),
          ).toBeDisabled();
        await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      }
      await pick(p, "状态演练", "空工作空间");
      await expect(p.locator("tbody tr")).toHaveCount(0);
      await ctx.close();
    },
  );
  await check(
    "costs deduplicate and preserve currency and uncertainty",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "统计与成本");
      await p.getByRole("tab", { name: "原始费用回执", exact: true }).click();
      await expect(p.locator(".cost-summary")).toContainText("¥ 1.28");
      await expect(p.locator(".cost-summary")).toContainText("$ 0.08");
      await expect(p.locator("tbody tr")).toHaveCount(5);
      await expect(
        p.locator("tr").filter({ hasText: "demo:scaena:bill-39" }),
      ).toContainText("—");
      await ctx.close();
    },
  );
  await check(
    "search keyboard, dialog escape and focus restoration",
    async () => {
      const { p, ctx } = await fresh();
      await p.keyboard.press("Control+k");
      await expect(p.getByRole("dialog", { name: "搜索与跳转" })).toBeVisible();
      await p
        .getByRole("textbox", { name: "全局搜索", exact: true })
        .fill("Sonora");
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Sonora 服务", exact: true })
        .click();
      await expect(p.locator(".inspector")).toContainText("Sonora");
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await p.getByRole("button", { name: "接入服务", exact: true }).click();
      await p.keyboard.press("Escape");
      await expect(
        p.getByRole("button", { name: "接入服务", exact: true }),
      ).toBeFocused();
      await ctx.close();
    },
  );
  await check(
    "four viewport sizes, both themes, all page layouts and detail drawers",
    async () => {
      for (const width of [1440, 1280, 768, 390]) {
        for (const theme of ["light", "dark"]) {
          const { p, ctx } = await fresh();
          await p.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
          // Allow the responsive shell spring to settle before the first navigation action.
          await p.waitForTimeout(220);
          if (theme === "dark") {
            await p.evaluate(() =>
              localStorage.setItem("yeisme-control-center.ui.theme", "dark"),
            );
            await p.reload({ waitUntil: "networkidle" });
          }
          for (const label of [
            "运行总览",
            "项目与工作台",
            "服务与连接",
            "请求与生成",
            "资产与交接",
            "审阅与批准",
            "统计与成本",
            "诊断与审计",
            "组织与成员",
            "设置",
          ]) {
            await nav(p, label);
            const size = await p.evaluate(() => ({
              width: innerWidth,
              scroll: document.body.scrollWidth,
            }));
            assert.ok(
              size.scroll <= size.width + 1,
              `${label} overflow at ${width}`,
            );
            await expect(p.locator("h1")).toBeVisible();
            await shot(p, `${theme}-${width}-${label}`);
          }
          await nav(p, "服务与连接");
          await p
            .getByRole("button", { name: "管理 Scaena", exact: true })
            .click();
          await expect(p.locator(".inspector")).toBeVisible();
          await shot(p, `${theme}-${width}-service-detail`);
          await p
            .getByRole("button", { name: "关闭详情", exact: true })
            .click();
          await ctx.close();
        }
      }
    },
  );
  await check(
    "Finder selection, keyboard, views, sorting and quick look preserve object identity",
    async () => {
      const { p, ctx } = await fresh("#/projects?env=main&project=all");
      const rain = () =>
        p.getByRole("option", { name: "雨夜重逢", exact: true });
      await rain().click();
      await expect(rain()).toHaveAttribute("aria-selected", "true");
      await expect(p.locator(".inspector")).toHaveCount(0);
      await p.keyboard.press("ArrowLeft");
      await expect(
        p.getByRole("option", { name: "海岸来信", exact: true }),
      ).toBeFocused();
      await p.keyboard.press("ArrowRight");
      await p.keyboard.press("Space");
      await expect(
        p.getByRole("dialog", { name: "雨夜重逢", exact: true }),
      ).toBeVisible();
      await shot(p, "finder-project-quick-look");
      await p.keyboard.press("Escape");
      await expect(rain()).toBeFocused();
      await p.getByRole("button", { name: "列表视图", exact: true }).click();
      await expect(p.locator(".finder-list")).toBeVisible();
      await expect(rain()).toHaveAttribute("aria-selected", "true");
      await p.getByRole("button", { name: "排序", exact: true }).click();
      await p
        .getByRole("menuitemradio", { name: "名称 Z → A", exact: true })
        .click();
      await expect(rain()).toHaveAttribute("aria-selected", "true");
      assert.equal(
        await p.locator(".finder-list-row").first().getAttribute("aria-label"),
        "雨夜重逢",
      );
      await rain().click({ button: "right" });
      await p.getByRole("menuitem", { name: "显示简介", exact: true }).click();
      await expect(p.locator(".inspector")).toContainText("关联服务");
      await shot(p, "finder-project-list-info");
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await rain().focus();
      await p.keyboard.press("Enter");
      await expect(p.locator("h1")).toHaveText("请求");
      await expect(
        p.getByRole("button", { name: "选择工作范围", exact: true }),
      ).toHaveText(/雨夜重逢/);
      await p.keyboard.press("Alt+ArrowLeft");
      await expect(p.locator("h1")).toHaveText("项目");
      await expect(rain()).toHaveAttribute("aria-selected", "true");
      await expect(p.locator(".finder-list")).toBeVisible();
      await p.keyboard.press("Alt+ArrowRight");
      await expect(p.locator("h1")).toHaveText("请求");
      await ctx.close();
    },
  );
  await check(
    "Finder asset preview, independent view preferences and filter invalidation",
    async () => {
      const { p, ctx } = await fresh("#/assets");
      const first = p
        .getByRole("listbox", { name: "资产浏览器" })
        .getByRole("option")
        .first();
      await first.click();
      const name = await first.getAttribute("aria-label");
      await p.keyboard.press("Space");
      await expect(p.getByRole("dialog", { name, exact: true })).toBeVisible();
      await p.keyboard.press("ArrowRight");
      await expect(p.getByRole("dialog")).toHaveCount(1);
      await p.keyboard.press("Escape");
      await expect(
        p.locator("[role=option][aria-selected=true]"),
      ).toBeFocused();
      await p.getByRole("button", { name: "列表视图", exact: true }).click();
      await expect(p.locator(".finder-list")).toBeVisible();
      await nav(p, "项目与工作台");
      await expect(
        p.getByRole("button", { name: "图标视图", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await nav(p, "资产与交接");
      await expect(
        p.getByRole("button", { name: "列表视图", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await pick(p, "资产类型", "音频");
      const audio = p
        .getByRole("listbox", { name: "资产浏览器" })
        .getByRole("option")
        .first();
      await audio.click();
      await p.keyboard.press("Space");
      await expect(p.getByRole("dialog")).toContainText("审听媒体待接入");
      await expect(p.locator("audio,video")).toHaveCount(0);
      await shot(p, "finder-audio-quick-look");
      await p.keyboard.press("Escape");
      await pick(p, "资产类型", "图像");
      await expect(p.locator("[role=option][aria-selected=true]")).toHaveCount(
        0,
      );
      await expect(p.locator(".inspector")).toHaveCount(0);
      await p.reload();
      await expect(
        p.getByRole("button", { name: "列表视图", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await ctx.close();
    },
  );
  await check(
    "Finder history restores query and clears on environment or identity changes",
    async () => {
      const { p, ctx } = await fresh("#/projects");
      await p
        .getByRole("textbox", { name: "搜索项目", exact: true })
        .fill("雨");
      const rain = p.getByRole("option", { name: "雨夜重逢", exact: true });
      await rain.dblclick();
      await expect(p.locator("h1")).toHaveText("请求");
      await p.keyboard.press("Alt+ArrowLeft");
      await expect(
        p.getByRole("textbox", { name: "搜索项目", exact: true }),
      ).toHaveValue("雨");
      await expect(rain).toHaveAttribute("aria-selected", "true");
      await nav(p, "服务与连接");
      await pick(p, "环境", "隔离测试环境");
      await p.getByRole("button", { name: "账户菜单" }).click();
      await expect(p.getByRole("menuitem", { name: /^后退/ })).toHaveAttribute(
        "data-disabled",
        "",
      );
      await p.keyboard.press("Escape");
      await p.getByRole("button", { name: "账户菜单" }).click();
      await expect(p.getByRole("menuitem", { name: /^前进/ })).toHaveAttribute(
        "data-disabled",
        "",
      );
      await p.keyboard.press("Escape");
      await expect(p.locator(".inspector")).toHaveCount(0);
      await pick(p, "环境", "内网主环境");
      await nav(p, "项目与工作台");
      await pick(p, "身份演练", "只读成员");
      await p.getByRole("button", { name: "账户菜单" }).click();
      await expect(p.getByRole("menuitem", { name: /^后退/ })).toHaveAttribute(
        "data-disabled",
        "",
      );
      await p.keyboard.press("Escape");
      await expect(p.locator("[role=option][aria-selected=true]")).toHaveCount(
        0,
      );
      await ctx.close();
    },
  );
  await check(
    "Finder reduced motion and rapid panel and view changes settle cleanly",
    async () => {
      const { p, ctx } = await fresh("#/projects");
      await p.emulateMedia({ reducedMotion: "reduce" });
      const rain = p.getByRole("option", { name: "雨夜重逢", exact: true });
      await rain.click();
      for (let i = 0; i < 4; i++) {
        await p.getByRole("button", { name: "列表视图", exact: true }).click();
        await p.getByRole("button", { name: "图标视图", exact: true }).click();
      }
      await expect(p.getByRole("listbox", { name: "项目浏览器" })).toHaveCount(
        1,
      );
      await expect(rain).toHaveAttribute("aria-selected", "true");
      for (let i = 0; i < 4; i++) {
        await p.getByRole("button", { name: "显示简介", exact: true }).click();
        await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      }
      await expect(p.locator(".inspector")).toHaveCount(0);
      await rain.focus();
      await p.keyboard.press("Space");
      await expect(p.getByRole("dialog")).toBeVisible();
      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog")).toHaveCount(0);
      await p.getByRole("button", { name: "显示简介", exact: true }).click();
      await pick(p, "项目范围", "海岸来信");
      await expect(p.locator(".inspector")).toHaveCount(0);
      await expect(
        p.getByRole("option", { name: "雨夜重逢", exact: true }),
      ).toHaveCount(0);
      await ctx.close();
    },
  );
  await check(
    "Finder normal motion rapid navigation and external diagnostic context stay intact",
    async () => {
      const { p, ctx } = await fresh("#/projects");
      for (let i = 0; i < 5; i++) {
        await p.getByRole("button", { name: "列表视图", exact: true }).click();
        await nav(p, "资产与交接");
        await p.getByRole("button", { name: "图标视图", exact: true }).click();
        await nav(p, "项目与工作台");
      }
      await expect(
        p.getByRole("listbox", { name: "项目浏览器" }).getByRole("option"),
      ).toHaveCount(3);
      await p.getByRole("option", { name: "雨夜重逢", exact: true }).click();
      await p.keyboard.press("Space");
      await p.evaluate(() => {
        location.hash = "#/projects?env=staging&project=all";
      });
      await expect(p.getByRole("dialog")).toHaveCount(0);
      await expect(
        p.getByRole("option", { name: "雨夜重逢", exact: true }),
      ).toHaveCount(0);
      await p.goto(
        base +
          "#/tasks?source=frame&source_project=original-project&source_task=original-task&source_shot=shot-2&return_page=storyboard",
        { waitUntil: "networkidle" },
      );
      await expect(
        p.getByRole("heading", { name: "诊断上下文已接收", exact: true }),
      ).toBeVisible();
      await expect(p.locator(".inspector")).toContainText("original-task");
      await expect(p.locator(".inspector")).toContainText("shot-2");
      await ctx.close();
    },
  );
  await check(
    "Finder long service names and full service directory remain navigable",
    async () => {
      const { p, ctx } = await fresh("#/services");
      await expect(p.locator("tbody tr")).toHaveCount(25);
      await p.getByRole("button", { name: "接入服务", exact: true }).click();
      const long =
        "Eikona · 跨项目视觉资产与长名称显示边界验证 · 工作室扩展实例";
      await p
        .getByRole("textbox", { name: "实例名称", exact: true })
        .fill(long);
      await p.getByRole("button", { name: "下一步", exact: true }).click();
      await p.getByRole("button", { name: "检查引用", exact: true }).click();
      await p
        .getByRole("button", { name: "保存演示实例", exact: true })
        .click();
      await expect(p.locator(".receipt-summary")).toContainText(
        "演示实例已保存",
      );
      await p.getByRole("button", { name: "返回详情", exact: true }).click();
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await expect(
        p.getByRole("button", { name: "管理 " + long, exact: true }),
      ).toBeVisible();
      await pick(p, "每页记录数", "50 条 / 页");
      await expect(p.locator("tbody tr")).toHaveCount(26);
      await p.setViewportSize({ width: 390, height: 844 });
      await p
        .getByRole("textbox", { name: "搜索服务", exact: true })
        .fill("长名称");
      await expect(p.locator("tbody tr")).toHaveCount(1);
      assert.ok(
        await p.evaluate(() => document.body.scrollWidth <= innerWidth + 1),
      );
      await shot(p, "finder-long-service-mobile");
      await ctx.close();
    },
  );
  const editConfig = async (p, name = "Scaena") => {
    await nav(p, "服务与连接");
    await p.getByRole("button", { name: "管理 " + name, exact: true }).click();
    await p.getByRole("tab", { name: "配置", exact: true }).click();
    await p.getByRole("button", { name: "编辑演示配置", exact: true }).click();
  };
  await check(
    "Workspace field validation preserves blanks and focuses the first invalid input",
    async () => {
      const { p, ctx } = await fresh();
      await editConfig(p);
      await expect(
        p.getByRole("button", { name: "预览变更", exact: true }),
      ).toBeDisabled();
      const concurrency = p.getByRole("spinbutton", {
          name: "并发上限",
          exact: true,
        }),
        timeout = p.getByRole("spinbutton", { name: "请求超时", exact: true });
      await concurrency.fill("");
      await timeout.fill("601");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await expect(concurrency).toHaveValue("");
      await expect(concurrency).toHaveAttribute("aria-invalid", "true");
      await expect(concurrency).toBeFocused();
      await expect(timeout).toHaveAttribute("aria-invalid", "true");
      const description = await concurrency.getAttribute("aria-describedby");
      assert.ok(description?.split(" ").every((id) => id.length));
      await shot(p, "workspace-invalid-fields");
      await concurrency.fill("1.5");
      await timeout.fill("90");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await expect(concurrency).toHaveAttribute("aria-invalid", "true");
      await concurrency.fill("4");
      await concurrency.blur();
      await expect(
        p.getByRole("button", { name: "预览变更", exact: true }),
      ).toBeDisabled();
      await expect(p.locator(".workspace-editor")).toBeVisible();
      await ctx.close();
    },
  );
  await check(
    "Workspace dirty navigation protects drafts across close, object and page changes",
    async () => {
      const { p, ctx } = await fresh();
      await editConfig(p);
      const input = p.getByRole("spinbutton", {
        name: "并发上限",
        exact: true,
      });
      await input.fill("9");
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await expect(p.getByRole("alertdialog")).toBeVisible();
      await p.getByRole("button", { name: "继续编辑", exact: true }).click();
      await expect(input).toHaveValue("9");
      await expect(p.getByRole("alertdialog")).toHaveCount(0);
      await p.mouse.click(20, 120);
      await expect(p.getByRole("alertdialog")).toBeVisible();
      await expect(p.locator("h1")).toHaveText("服务");
      await shot(p, "workspace-discard-dialog");
      await p.getByRole("button", { name: "放弃修改", exact: true }).click();
      await nav(p, "资产与交接");
      await expect(p.locator("h1")).toHaveText("资产");
      await expect(p.locator(".workspace-editor")).toHaveCount(0);
      await editConfig(p);
      await expect(input).toHaveValue("4");
      await ctx.close();
    },
  );
  await check(
    "Workspace Sheet constrains focus, dismisses by overlay and restores scroll",
    async () => {
      const { p, ctx } = await fresh("#/services");
      const row = p.getByRole("button", { name: "管理 Scaena", exact: true });
      await row.scrollIntoViewIfNeeded();
      const scroll = await p.evaluate(() => scrollY);
      await row.click();
      await expect(p.locator(".right-workspace")).toHaveCSS("width", "420px");
      await expect(p.locator(".workspace-resize")).toHaveCount(0);
      for (let i = 0; i < 20; i++) await p.keyboard.press("Tab");
      assert.ok(
        await p.evaluate(
          () => !!document.activeElement.closest(".right-workspace"),
        ),
      );
      await p.setViewportSize({ width: 1440, height: 620 });
      const header = await p.locator(".workspace-header").boundingBox();
      const footer = await p.locator(".workspace-footer").boundingBox();
      await p
        .locator(".workspace-content")
        .evaluate((el) => (el.scrollTop = el.scrollHeight));
      assert.equal(
        (await p.locator(".workspace-header").boundingBox()).y,
        header.y,
      );
      assert.equal(
        (await p.locator(".workspace-footer").boundingBox()).y,
        footer.y,
      );
      await p.mouse.click(20, 120);
      await expect(p.locator(".right-workspace")).toHaveCount(0);
      await expect(row).toBeFocused();
      assert.ok(Math.abs((await p.evaluate(() => scrollY)) - scroll) < 2);
      await shot(p, "admincn-sheet-focus-return");
      await ctx.close();
    },
  );
  await check(
    "Workspace drafts and field errors survive desktop, sheet and mobile breakpoints",
    async () => {
      const { p, ctx } = await fresh();
      await editConfig(p);
      await p
        .getByRole("spinbutton", { name: "并发上限", exact: true })
        .fill("8");
      const timeout = p.getByRole("spinbutton", {
        name: "请求超时",
        exact: true,
      });
      await timeout.fill("");
      await timeout.blur();
      for (const width of [1280, 768, 390, 1440]) {
        await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await expect(
          p.getByRole("spinbutton", { name: "并发上限", exact: true }),
        ).toHaveValue("8");
        await expect(timeout).toHaveValue("");
        await expect(timeout).toHaveAttribute("aria-invalid", "true");
        await expect(p.locator(".right-workspace")).toHaveCount(1);
        assert.ok(
          await p.evaluate(() => document.body.scrollWidth <= innerWidth + 1),
        );
        await shot(p, "workspace-form-" + width);
      }
      await ctx.close();
    },
  );
  await check(
    "Workspace submitting operations can be hidden and resumed without duplicate writes",
    async () => {
      const { p, ctx } = await fresh();
      await editConfig(p);
      await p
        .getByRole("spinbutton", { name: "并发上限", exact: true })
        .fill("7");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await shot(p, "workspace-config-preview");
      await p.clock.install();
      await p
        .getByRole("button", { name: "确认变更并回读", exact: true })
        .evaluate((el) => {
          el.click();
          el.click();
        });
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await expect(p.locator(".right-workspace")).toHaveCount(0);
      await p.clock.runFor(800);
      await p.getByRole("button", { name: /查看操作回执/ }).click();
      await p.clock.runFor(800);
      await expect(p.locator(".receipt-summary")).toContainText(
        "配置已更新并回读",
      );
      await expect(p.locator(".right-workspace")).toContainText(
        "demo:config:scaena:r2",
      );
      await shot(p, "workspace-resumed-receipt");
      await p.getByRole("button", { name: "返回配置", exact: true }).click();
      await expect(p.locator(".config-version")).toContainText("r2");
      await nav(p, "诊断与审计");
      await expect(p.getByText("配置更新并回读", { exact: true })).toHaveCount(
        1,
      );
      await ctx.close();
    },
  );
  await check(
    "Workspace environment changes immediately discard old form data and late submissions",
    async () => {
      const { p, ctx } = await fresh();
      await editConfig(p);
      await p
        .getByRole("spinbutton", { name: "并发上限", exact: true })
        .fill("7");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await shot(p, "workspace-scope-before");
      await p.clock.install();
      await p
        .getByRole("button", { name: "确认变更并回读", exact: true })
        .click();
      await pick(p, "环境", "隔离测试环境");
      await p.clock.runFor(800);
      await expect(p.locator(".right-workspace,.workspace-resume")).toHaveCount(
        0,
      );
      await expect(p.getByRole("alertdialog")).toHaveCount(0);
      await pick(p, "环境", "内网主环境");
      await p.getByRole("button", { name: "管理 Scaena", exact: true }).click();
      await p.clock.runFor(700);
      await p.getByRole("tab", { name: "配置", exact: true }).click();
      await expect(p.locator(".config-version")).toContainText("r1");
      await ctx.close();
    },
  );
  await check(
    "Workspace onboarding validates fields and preserves draft when moving between steps",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "服务与连接");
      await p.getByRole("button", { name: "接入服务", exact: true }).click();
      await p.getByRole("button", { name: "下一步", exact: true }).click();
      const name = p.getByRole("textbox", { name: "实例名称", exact: true });
      await expect(name).toBeFocused();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await name.fill("Eikona · 分镜草稿实例");
      await p.getByRole("button", { name: "下一步", exact: true }).click();
      const connection = p.getByRole("textbox", {
        name: "连接引用",
        exact: true,
      });
      await connection.fill("https://untrusted.invalid");
      await p
        .getByRole("textbox", { name: "凭据引用", exact: true })
        .fill("not-a-reference");
      await p.getByRole("button", { name: "检查引用", exact: true }).click();
      await expect(connection).toBeFocused();
      await expect(p.locator(".field-error")).toHaveCount(2);
      await shot(p, "workspace-connect-invalid");
      await p.getByRole("button", { name: "上一步", exact: true }).click();
      await expect(name).toHaveValue("Eikona · 分镜草稿实例");
      await p.getByRole("button", { name: "下一步", exact: true }).click();
      await expect(connection).toHaveValue("https://untrusted.invalid");
      await connection.fill("connection://lan/draft");
      await p
        .getByRole("textbox", { name: "凭据引用", exact: true })
        .fill("credentialctl://team/draft");
      await p.getByRole("button", { name: "检查引用", exact: true }).click();
      await expect(p.locator(".right-workspace")).toContainText("待真实验证");
      await expect(p.locator(".right-workspace")).toContainText("待接口接线");
      await shot(p, "workspace-connect-review");
      await ctx.close();
    },
  );
  await check(
    "Workspace review forms require a reason and acknowledgement and retain a receipt",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "审阅与批准");
      await p
        .getByRole("button", { name: /旧车站 · 氛围参考 v3/ })
        .first()
        .click();
      await p.getByRole("button", { name: "拒绝并说明", exact: true }).click();
      const reason = p.getByRole("textbox", { name: "拒绝原因", exact: true });
      await reason.fill("  ");
      await reason.blur();
      await expect(reason).toHaveAttribute("aria-invalid", "true");
      await p.getByRole("checkbox", { name: /我已确认影响范围/ }).check();
      await expect(
        p.getByRole("button", { name: "确认操作", exact: true }),
      ).toBeDisabled();
      await reason.fill("请补充候选图像的来源与授权说明。");
      await p.getByRole("button", { name: "确认操作", exact: true }).click();
      await expect(p.locator(".receipt-summary")).toContainText(
        "审阅决定已拒绝",
      );
      await expect(p.locator(".right-workspace")).toContainText(
        "请补充候选图像的来源与授权说明。",
      );
      await shot(p, "workspace-review-receipt");
      await p.getByRole("button", { name: "返回详情", exact: true }).click();
      await expect(
        p.getByRole("button", { name: "批准此项", exact: true }),
      ).toBeDisabled();
      await ctx.close();
    },
  );
  await check(
    "Workspace read states and broken thumbnail previews are truthful",
    async () => {
      const { p, ctx } = await fresh();
      await nav(p, "服务与连接");
      await p.getByRole("button", { name: "管理 Scaena", exact: true }).click();
      await p
        .getByRole("button", { name: "检查演示连接", exact: true })
        .click();
      await expect(
        p.getByRole("status", { name: "正在读取对象", exact: true }),
      ).toBeVisible();
      await expect(
        p.getByRole("status", { name: "正在读取对象", exact: true }),
      ).toHaveCount(0);
      await pick(p, "状态演练", "服务不可达");
      await p.getByRole("button", { name: "管理 Scaena", exact: true }).click();
      await p
        .getByRole("button", { name: "检查演示连接", exact: true })
        .click();
      await expect(
        p.getByText("读取失败 · 保留最近快照", { exact: true }),
      ).toBeVisible();
      await shot(p, "workspace-read-failure");
      await ctx.route("**/media/**", (r) => r.abort());
      await p.goto(base + "#/assets", { waitUntil: "networkidle" });
      await expect(
        p.locator(".extend-thumbnail[data-state=error]"),
      ).toHaveCount(2);
      await expect(p.getByText("预览不可用", { exact: true })).toHaveCount(2);
      await ctx.close();
    },
  );
  if (frame)
    await check(
      "Frame Studio launches diagnostics and returns without modifying creative state",
      async () => {
        const { p, ctx } = await fresh();
        await p.goto(frame + "#/tasks", { waitUntil: "networkidle" });
        await expect(
          p.getByRole("link", { name: "控制中心（新标签页）", exact: true }),
        ).toBeVisible();
        await p.getByRole("button", { name: "服务状态", exact: true }).click();
        await expect(
          p.getByRole("dialog", { name: "当前项目服务状态" }),
        ).toContainText("尚未进行真实检查");
        await p.getByRole("button", { name: "关闭", exact: true }).click();
        const link = p.getByRole("link", { name: /查看诊断 / }).first();
        await expect(link).toBeVisible();
        const href = await link.getAttribute("href"),
          url = new URL(href),
          q = new URLSearchParams(url.hash.split("?")[1]);
        assert.ok(q.get("source_project"));
        assert.ok(q.get("source_task"));
        const before = await p.locator("#main-content").innerText();
        const popupPromise = p.waitForEvent("popup");
        await link.click();
        const popup = await popupPromise;
        await popup.waitForLoadState("networkidle");
        await expect(
          popup.getByRole("heading", { name: "诊断上下文已接收" }),
        ).toBeVisible();
        await expect(
          popup.getByText(q.get("source_task"), { exact: true }),
        ).toBeVisible();
        await shot(popup, "frame-diagnostic-context");
        await popup
          .getByRole("button", { name: "返回创作位置", exact: true })
          .click();
        await expect.poll(() => popup.isClosed()).toBe(true);
        assert.equal(await p.locator("#main-content").innerText(), before);
        await p.getByRole("button", { name: "专业分镜", exact: true }).click();
        await shot(p, "frame-integration");
        await ctx.close();
      },
    );
  if (frame)
    await check(
      "Frame Studio preserves screenplay and shot drafts across center navigation",
      async () => {
        const { p, ctx } = await fresh();
        await p.goto(frame + "#/script", { waitUntil: "networkidle" });
        const screenplay = p.getByRole("textbox", {
          name: "正文块 2 动作描述",
          exact: true,
        });
        const scriptDraft = "往返验收：雨停之前，先保留这一段创作草稿。";
        await screenplay.fill(scriptDraft);
        const roundtrip = async () => {
          const link = p.getByRole("link", {
            name: "控制中心（新标签页）",
            exact: true,
          });
          const before = await link.getAttribute("href");
          const wait = p.waitForEvent("popup");
          await link.click();
          const popup = await wait;
          await popup.waitForLoadState("networkidle");
          await popup
            .getByRole("button", { name: "返回创作位置", exact: true })
            .click();
          await expect.poll(() => popup.isClosed()).toBe(true);
          assert.equal(await link.getAttribute("href"), before);
        };
        await roundtrip();
        await expect(screenplay).toHaveValue(scriptDraft);
        await p.getByRole("button", { name: "专业分镜", exact: true }).click();
        const shotDraft = "往返验收：保持当前镜头的机位、描述与未采用候选。";
        await p
          .getByRole("textbox", { name: "画面描述", exact: true })
          .fill(shotDraft);
        await roundtrip();
        await expect(
          p.getByRole("textbox", { name: "画面描述", exact: true }),
        ).toHaveValue(shotDraft);
        for (const width of [1440, 1280]) {
          await p.setViewportSize({ width, height: 1000 });
          for (const theme of ["light", "dark"]) {
            const toggle = p.getByRole("button", {
              name: theme === "dark" ? "切换深色主题" : "切换浅色主题",
              exact: true,
            });
            if (await toggle.count()) await toggle.click();
            await p
              .getByRole("button", { name: "服务状态", exact: true })
              .click();
            await expect(
              p.getByRole("dialog", { name: "当前项目服务状态" }),
            ).toBeVisible();
            await shot(p, `frame-${width}-${theme}-services`);
            await p.getByRole("button", { name: "关闭", exact: true }).click();
            const dimensions = await p.evaluate(() => ({
              viewport: innerWidth,
              body: document.body.scrollWidth,
            }));
            assert.ok(
              dimensions.body <= dimensions.viewport + 1,
              "Frame layout exceeds viewport",
            );
          }
        }
        await ctx.close();
      },
    );
  await check(
    "Admin table filtering, pagination, sorting, columns, saved view and scoped CSV",
    async () => {
      const { p, ctx } = await fresh("#/tasks");
      await p.getByRole("tab", { name: /请求历史/ }).click();
      const table = p.getByRole("table", { name: "请求历史", exact: true });
      await expect(table.locator("tbody tr")).toHaveCount(25);
      const first = await table.locator("tbody tr").first().innerText();
      await p.getByRole("button", { name: "下一页", exact: true }).click();
      assert.notEqual(
        await table.locator("tbody tr").first().innerText(),
        first,
      );
      await p.getByRole("button", { name: "第一页", exact: true }).click();
      await table.getByRole("checkbox").nth(1).click();
      await expect(p.locator(".admin-selection")).toContainText("已选择 1 项");
      await pick(p, "服务筛选", "Eikona");
      await expect(p.locator(".admin-selection")).toHaveCount(0);
      assert.ok(
        (await table.locator("tbody tr").allTextContents()).every((t) =>
          t.includes("Eikona"),
        ),
      );
      await p.waitForTimeout(180);
      await tableMenu(p);
      await p.getByRole("menuitem", { name: "显示列", exact: true }).click();
      const modelColumn = p.getByRole("menuitemcheckbox", {
        name: "模型 / 能力",
        exact: true,
      });
      await expect(modelColumn).toBeVisible();
      await p.waitForTimeout(120);
      await modelColumn.focus();
      await p.keyboard.press("Space");
      await p.keyboard.press("Escape");
      await expect(
        table.getByRole("columnheader", { name: /模型/ }),
      ).toBeVisible();
      await tableMenu(p);
      await p
        .getByRole("menuitem", { name: "保存当前视图", exact: true })
        .click();
      await pick(p, "服务筛选", "全部服务");
      await tableMenu(p);
      await p
        .getByRole("menuitem", { name: "恢复已保存视图", exact: true })
        .click();
      await p.getByRole("button", { name: "更多筛选", exact: true }).click();
      await expect(
        p.getByRole("combobox", { name: "服务筛选", exact: true }),
      ).toContainText("Eikona");
      await p.keyboard.press("Escape");
      const exportedTitle = await table
        .locator(".record-title strong")
        .first()
        .innerText();
      await exportHistory(p);
      await expect(p.getByRole("dialog")).toContainText("全部筛选结果");
      const download = p.waitForEvent("download");
      await p.getByRole("button", { name: "导出 CSV", exact: true }).click();
      const exported = await download;
      const csv = await fs.readFile(await exported.path(), "utf8");
      const records = csv.trim().split(/\r?\n/);
      assert.match(records[0], /模型/);
      assert.ok(
        records.slice(1).every((line) => line.includes("Eikona")),
        "CSV must retain the active owner filter",
      );
      assert.ok(
        records.slice(1).some((line) => line.includes(exportedTitle)),
        "CSV must retain the visible request title",
      );
      await shot(p, "admin-history-table");
      await ctx.close();
    },
  );
  await check(
    "Admin record type multi-select and explicit custom date validation",
    async () => {
      const { p, ctx } = await fresh("#/tasks");
      await p.getByRole("tab", { name: /请求历史/ }).click();
      await p.getByRole("button", { name: "更多筛选", exact: true }).click();
      await p.getByRole("button", { name: "记录类型", exact: true }).click();
      await p.getByRole("checkbox", { name: "网关调用", exact: true }).check();
      await p.getByRole("checkbox", { name: "生成任务", exact: true }).check();
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
      assert.ok(
        (await p.locator("tbody tr").allTextContents()).every((t) =>
          /网关调用|生成任务/.test(t),
        ),
      );
      await p
        .getByRole("button", { name: "选择时间范围", exact: true })
        .click();
      await p.getByLabel("开始日期", { exact: true }).fill("2026-10-10");
      await p.getByLabel("结束日期", { exact: true }).fill("2026-09-01");
      await expect(
        p.getByText("结束日期应不早于开始日期。", { exact: true }),
      ).toBeVisible();
      await p.getByRole("button", { name: "完成", exact: true }).click();
      await expect(p.locator("tbody tr")).toHaveCount(0);
      await ctx.close();
    },
  );
  await check(
    "Admin analytics drilldown matches the source filter and finance hides for reader",
    async () => {
      const { p, ctx } = await fresh("#/usage");
      await expect(p.locator(".recharts-wrapper")).toHaveCount(2);
      await p
        .getByRole("table", { name: "统计明细" })
        .locator("tbody tr")
        .filter({ hasText: "Aigora" })
        .click();
      await expect(p.locator("h1")).toHaveText("请求");
      await p.getByRole("button", { name: "更多筛选", exact: true }).click();
      await expect(
        p.getByRole("combobox", { name: "服务筛选", exact: true }),
      ).toContainText("Aigora");
      await p.keyboard.press("Escape");
      await pick(p, "身份演练", "只读成员");
      await nav(p, "统计与成本");
      await expect(
        p.getByRole("tab", { name: "费用与账单", exact: true }),
      ).toHaveCount(0);
      await expect(
        p.getByRole("button", { name: "选择工作范围" }),
      ).toContainText("个人");
      await ctx.close();
    },
  );
  await check(
    "Admin same-name tenants and identities remain isolated across list, details and export",
    async () => {
      const { p, ctx } = await fresh("#/members");
      await p
        .getByRole("table", { name: "成员列表" })
        .locator("tbody tr")
        .filter({ hasText: "m-3" })
        .click();
      await expect(p.locator(".right-workspace")).toContainText("DriveBridge");
      await pick(p, "租户范围", "北岸工作室");
      await expect(p.locator(".right-workspace")).toHaveCount(0);
      await expect(p.locator("tbody tr")).toHaveCount(2);
      await expect(p.locator("tbody")).not.toContainText("m-3");
      await expect(p.locator("tbody")).toContainText("m-9");
      await nav(p, "项目与工作台");
      await expect(p.locator('[data-object-id="rain"]')).toHaveCount(0);
      await nav(p, "请求与生成");
      await p.getByRole("tab", { name: /请求历史/ }).click();
      await expect(p.locator("tbody")).not.toContainText("Yeisme");
      await pick(p, "管理视角", "个人");
      await expect(p.locator("tbody tr")).toHaveCount(0);
      await ctx.close();
    },
  );
  const memberEdit = async (p) => {
    await nav(p, "组织与成员");
    await p
      .getByRole("table", { name: "成员列表" })
      .locator("tbody tr")
      .filter({ hasText: "m-3" })
      .click();
    await p.getByRole("button", { name: "调整角色", exact: true }).click();
    await pick(p, "选择项目角色", "团队管理员");
  };
  await check(
    "Admin member role change previews only its owner and produces a stable receipt",
    async () => {
      const { p, ctx } = await fresh();
      await memberEdit(p);
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await expect(p.locator(".right-workspace")).toContainText(
        "团队成员 → 团队管理员",
      );
      await p.getByRole("checkbox", { name: /我已确认对象/ }).check();
      await p
        .getByRole("button", { name: "确认提交", exact: true })
        .evaluate((el) => {
          el.click();
          el.click();
        });
      await expect(p.locator(".right-workspace")).toContainText("变更已确认");
      await expect(p.locator(".right-workspace")).toContainText(
        "demo:organization:role:m-3:3",
      );
      await p.getByRole("button", { name: "完成", exact: true }).click();
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await expect(
        p.locator("tbody tr").filter({ hasText: "m-3" }),
      ).toContainText("团队管理员");
      await expect(
        p.locator("tbody tr").filter({ hasText: "m-4" }),
      ).toContainText("开发成员");
      await ctx.close();
    },
  );
  await check(
    "Admin member conflict requires a refreshed revision and a second preview",
    async () => {
      const { p, ctx } = await fresh();
      await pick(p, "状态演练", "配置版本冲突");
      await memberEdit(p);
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await p.getByRole("checkbox", { name: /我已确认对象/ }).check();
      await p.getByRole("button", { name: "确认提交", exact: true }).click();
      await expect(p.locator(".right-workspace")).toContainText("版本冲突");
      await p
        .getByRole("button", { name: "读取新版本并重新编辑", exact: true })
        .click();
      await expect(
        p.getByRole("combobox", { name: "选择项目角色" }),
      ).toContainText("团队管理员");
      await expect(
        p.getByRole("button", { name: "确认提交", exact: true }),
      ).toHaveCount(0);
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await expect(p.locator(".right-workspace")).toContainText("v4");
      await p.getByRole("checkbox", { name: /我已确认对象/ }).check();
      await p.getByRole("button", { name: "确认提交", exact: true }).click();
      await expect(p.locator(".right-workspace")).toContainText("变更已确认");
      await ctx.close();
    },
  );
  await check(
    "Admin member save failure retains input and dirty navigation can be discarded",
    async () => {
      const { p, ctx } = await fresh();
      await pick(p, "状态演练", "配置保存失败");
      await memberEdit(p);
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await p.getByRole("checkbox", { name: /我已确认对象/ }).check();
      await p.getByRole("button", { name: "确认提交", exact: true }).click();
      await expect(p.locator(".right-workspace")).toContainText(
        "保存失败，草稿已保留",
      );
      await p.getByRole("button", { name: "返回修改", exact: true }).click();
      await expect(
        p.getByRole("combobox", { name: "选择项目角色" }),
      ).toContainText("团队管理员");
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await expect(p.getByRole("alertdialog")).toBeVisible();
      await p.getByRole("button", { name: "继续编辑", exact: true }).click();
      await expect(p.locator("h1")).toHaveText("团队");
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await p.getByRole("button", { name: "放弃修改", exact: true }).click();
      await nav(p, "服务与连接");
      await expect(p.locator("h1")).toHaveText("服务");
      await ctx.close();
    },
  );
  await check(
    "Admin invitation uses a bound account combobox and does not claim email delivery",
    async () => {
      const { p, ctx } = await fresh("#/members");
      await p.getByRole("button", { name: "邀请成员", exact: true }).click();
      await p.getByRole("combobox", { name: "邀请账号", exact: true }).click();
      await p
        .getByRole("combobox", { name: "搜索邀请账号", exact: true })
        .fill("许");
      await p.keyboard.press("Enter");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await p.getByRole("checkbox", { name: /我已确认对象/ }).check();
      await p.getByRole("button", { name: "确认提交", exact: true }).click();
      await expect(p.locator(".right-workspace")).toContainText("邀请已创建");
      await expect(p.locator(".right-workspace")).toContainText(
        "没有发送真实邮件",
      );
      await shot(p, "admin-invitation-receipt");
      await ctx.close();
    },
  );
  await check(
    "Admin owner safeguards, team archive and blank quota validation",
    async () => {
      const { p, ctx } = await fresh("#/members");
      await p
        .locator("tbody tr")
        .filter({ hasText: /\bm-1\b/ })
        .click();
      await expect(
        p.getByRole("button", { name: "调整角色", exact: true }),
      ).toBeDisabled();
      await expect(
        p.getByRole("button", { name: "移除", exact: true }),
      ).toHaveCount(0);
      await p.getByRole("button", { name: "关闭详情", exact: true }).click();
      await p.getByRole("tab", { name: "团队", exact: true }).click();
      await p
        .locator(".team-card")
        .filter({ hasText: "影像制作组" })
        .getByRole("button", { name: "归档", exact: true })
        .click();
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await expect(
        p.getByText("请填写变更原因。", { exact: true }),
      ).toBeVisible();
      await p
        .getByLabel("变更原因", { exact: true })
        .fill("阶段制作完成，保留只读成果");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await p.getByRole("checkbox", { name: /我已确认对象/ }).check();
      await p.getByRole("button", { name: "确认提交", exact: true }).click();
      await expect(p.locator(".right-workspace")).toContainText("变更已确认");
      await p.getByRole("button", { name: "完成", exact: true }).click();
      await expect(
        p.locator(".team-card").filter({ hasText: "影像制作组" }),
      ).toContainText("已归档");
      await orgSection(p, "配额用量");
      await p
        .getByRole("button", { name: "调整配额", exact: true })
        .first()
        .click();
      await p.getByLabel("配置上限", { exact: true }).fill("");
      await p.getByRole("button", { name: "预览变更", exact: true }).click();
      await expect(p.getByLabel("配置上限", { exact: true })).toHaveValue("");
      await expect(p.locator(".field-error")).toContainText("整数");
      await ctx.close();
    },
  );
  await check(
    "Admin history, analytics and member form responsive themes and reduced motion",
    async () => {
      for (const width of [1440, 1280, 768, 390])
        for (const theme of ["light", "dark"]) {
          const { p, ctx } = await fresh("#/tasks");
          await p.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
          await p.emulateMedia({ reducedMotion: "reduce" });
          await p.evaluate((t) => {
            localStorage.setItem("yeisme-control-center.ui.theme", t);
          }, theme);
          await p.reload();
          await p.getByRole("tab", { name: /请求历史/ }).click();
          await shot(p, `admin-${theme}-${width}-history`);
          assert.ok(
            await p.evaluate(() => document.body.scrollWidth <= innerWidth + 1),
          );
          await nav(p, "统计与成本");
          await shot(p, `admin-${theme}-${width}-analytics`);
          assert.ok(
            await p.evaluate(() => document.body.scrollWidth <= innerWidth + 1),
          );
          await nav(p, "组织与成员");
          await p
            .getByRole("button", { name: "邀请成员", exact: true })
            .click();
          await expect(p.locator(".right-workspace")).toBeVisible();
          await shot(p, `admin-${theme}-${width}-member-form`);
          assert.ok(
            await p.evaluate(() => document.body.scrollWidth <= innerWidth + 1),
          );
          await ctx.close();
        }
    },
  );
  await verifyAssets({ check, fresh, pick, nav, shot });
  await check(
    "Precision sparse queue has one toolbar and no inactive pagination",
    async () => {
      const { p, ctx } = await fresh("#/tasks?env=main&project=research");
      await expect(
        p.getByRole("textbox", { name: "搜索任务", exact: true }),
      ).toHaveCount(1);
      await expect(
        p.getByRole("button", { name: "列表选项", exact: true }),
      ).toHaveCount(1);
      await tableMenu(p);
      await expect(
        p.getByRole("menuitem", { name: "导出任务列表", exact: true }),
      ).toHaveCount(1);
      await p.keyboard.press("Escape");
      await expect(
        p.getByRole("button", { name: "下一页", exact: true }),
      ).toHaveCount(0);
      await expect(p.getByRole("combobox", { name: "每页记录数" })).toHaveCount(
        0,
      );
      await expect(p.getByRole("button", { name: "选择时间范围" })).toHaveCount(
        0,
      );
      await expect(p.getByText("ACTIVITY", { exact: true })).toHaveCount(0);
      await shot(p, "precision-sparse-queue");
      await nav(p, "运行总览");
      await expect(
        p.locator(".admin-table-block.embedded .admin-table-toolbar"),
      ).toHaveCount(0);
      await expect(
        p.locator(".admin-table-block.embedded .admin-pagination"),
      ).toHaveCount(0);
      await ctx.close();
    },
  );
  await check(
    "Precision scope picker preserves labels, scoped data and trigger focus",
    async () => {
      const { p, ctx } = await fresh("#/tasks");
      const trigger = p.getByRole("button", {
        name: "选择工作范围",
        exact: true,
      });
      await trigger.click();
      for (const label of ["管理视角", "租户范围", "团队范围", "项目范围"])
        await expect(
          p.getByRole("combobox", { name: label, exact: true }),
        ).toBeVisible();
      await p.getByRole("combobox", { name: "项目范围", exact: true }).click();
      await p.getByRole("option", { name: "创作资料库", exact: true }).click();
      await p
        .getByRole("button", { name: "收起工作范围", exact: true })
        .click();
      await expect(trigger).toBeFocused();
      await expect(trigger).toContainText("创作资料库");
      await expect(p.locator("tbody tr")).toHaveCount(1);
      await trigger.click();
      await p.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      assert.equal(
        await p.locator(".nav-item svg").first().getAttribute("viewBox"),
        "0 0 24 24",
      );
      await ctx.close();
    },
  );
  await check(
    "AdminCN overview metrics drill into exactly the displayed fact scope",
    async () => {
      const { p, ctx } = await fresh("#/overview");
      const metric = p.getByRole("button", { name: /^网关调用 / });
      const expected = Number(
        await metric.locator(".metric-value").innerText(),
      );
      assert.ok(expected > 0);
      await metric.click();
      await expect(p.locator("h1")).toHaveText("请求");
      await expect(p.locator(".results-summary b").first()).toHaveText(
        String(expected),
      );
      await exportHistory(p);
      await expect(p.getByRole("dialog")).toContainText(
        "全部筛选结果 · " + expected + " 条",
      );
      await p.getByRole("button", { name: "关闭对话框", exact: true }).click();
      await nav(p, "运行总览");
      await pick(p, "环境", "隔离测试环境");
      await pick(p, "状态演练", "空工作空间");
      await expect(
        p
          .locator(".sales-metric")
          .filter({ hasText: "已决成功率" })
          .locator(".metric-value"),
      ).toHaveText("—");
      await expect(
        p
          .locator(".sales-metric")
          .filter({ hasText: "网关调用" })
          .locator(".metric-value"),
      ).toHaveText("0");
      await ctx.close();
    },
  );
  await check(
    "AdminCN direct scope navigation clears an open dirty Sheet and obsolete content",
    async () => {
      const { p, ctx } = await fresh("#/services");
      await editConfig(p);
      await p
        .getByRole("spinbutton", { name: "并发上限", exact: true })
        .fill("13");
      await p.evaluate(
        () => (location.hash = "#/services?env=staging&project=all"),
      );
      await expect(p.locator(".right-workspace")).toHaveCount(0);
      await expect(p.getByRole("alertdialog")).toHaveCount(0);
      await expect(p.locator("tbody tr")).toHaveCount(0);
      await expect(p.locator(".scope-environment")).toHaveText("测试环境");
      await p
        .getByRole("button", { name: "选择工作范围", exact: true })
        .click();
      await expect(
        p.getByRole("combobox", { name: "环境", exact: true }),
      ).toContainText("隔离测试环境");
      await p
        .getByRole("button", { name: "收起工作范围", exact: true })
        .click();
      await expect(
        p.locator(".finder-statusbar,.workspace-resize"),
      ).toHaveCount(0);
      await ctx.close();
    },
  );
  await check(
    "no page exceptions or real service mutation attempts",
    async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(forbidden, []);
    },
  );
} catch (e) {
  results.push({
    name: "verification setup",
    status: "failed",
    error: e.message,
  });
  await fs.appendFile(path.join(area, "stderr.log"), e.stack + "\n");
} finally {
  if (browser) await browser.close();
  const summary = {
    run_id: runId,
    design_revision: "admincn-v7",
    status: results.every((r) => r.status === "passed") ? "passed" : "failed",
    preview: base,
    tests: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    screenshots: count,
    frame_checked: !!frame,
    real_service_calls: forbidden.length,
    results,
  };
  await fs.writeFile(
    path.join(area, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await fs.writeFile(
    path.join(area, "artifacts/results.json"),
    JSON.stringify(
      { page_errors: errors, forbidden_requests: forbidden },
      null,
      2,
    ),
  );
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile(
    "docs/verification.md",
    `# 原型验证记录\n\n- 本轮结果：${summary.status}\n- 浏览器流程：${summary.passed}/${summary.tests}\n- 截图：${count}\n- 片场往返：${frame ? "已纳入本轮" : "本轮未执行"}\n- 真实服务写请求：${forbidden.length}\n- 证据目录：temp/integration-test-runs/${runId}/\n\n${results.map((r) => "- " + r.status + " · " + r.name).join("\n")}\n\n工程与设计证据不代表真实服务接线、Provider 调用或生产部署已完成。\n`,
  );
  await log(
    JSON.stringify({
      status: summary.status,
      passed: summary.passed,
      tests: summary.tests,
      screenshots: count,
      evidence: area,
    }),
  );
  if (summary.failed) process.exitCode = 1;
}
