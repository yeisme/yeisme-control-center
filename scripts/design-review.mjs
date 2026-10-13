import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
const area = "temp/integration-test-runs";
function latest(prefix) {
  return fs
    .readdirSync(area)
    .filter((n) => n.startsWith(prefix))
    .sort()
    .reverse()
    .find((n) => {
      try {
        return (
          JSON.parse(
            fs.readFileSync(path.join(area, n, "summary.json"), "utf8"),
          ).status === "passed"
        );
      } catch {
        return false;
      }
    });
}
if (process.argv.includes("--capture-reference")) {
  const run = path.join(
    area,
    "reference-v7-clean-" + new Date().toISOString().replace(/[:.]/g, "-"),
  );
  fs.mkdirSync(run + "/artifacts", { recursive: true });
  fs.writeFileSync(
    run + "/command.txt",
    "node scripts/design-review.mjs --capture-reference\n",
  );
  fs.writeFileSync(
    run + "/env.json",
    JSON.stringify({
      commit: "dd1afd2f3a794ea9e746197de314f81d43670ea1",
      viewport: "1440x1000",
      runner_adjustments: [
        "local Turbopack root",
        "Tailwind source scan limited to src",
        "hide Next dev indicator",
        "block third-party GitHub widget script",
      ],
      template_component_styles_unchanged: true,
    }),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const results = [];
  fs.writeFileSync(run + "/stdout.log", "");
  fs.writeFileSync(run + "/stderr.log", "");
  try {
    for (const [name, url] of [
      ["orders", "/dashboard/orders"],
      ["members", "/apps/users/list"],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      await page.route("https://buttons.github.io/**", (r) => r.abort());
      const response = await page.goto("http://127.0.0.1:4333" + url, {
        waitUntil: "networkidle",
        timeout: 35000,
      });
      if (response?.status() !== 200)
        throw Error("Reference failed: " + name + " " + response?.status());
      await page.screenshot({
        path: run + "/artifacts/reference-" + name + ".png",
        animations: "disabled",
      });
      if (name === "members") {
        await page
          .getByRole("button", { name: "Add New User", exact: true })
          .click();
        await page.screenshot({
          path: run + "/artifacts/reference-member-sheet.png",
          animations: "disabled",
        });
      }
      results.push(name);
      await page.close();
    }
  } catch (error) {
    fs.writeFileSync(run + "/stderr.log", error.stack);
    console.log(error.message.slice(0, 150));
  } finally {
    await browser.close();
  }
  const status = results.length === 2 ? "passed" : "failed";
  fs.writeFileSync(run + "/stdout.log", results.join("\n"));
  fs.writeFileSync(
    run + "/summary.json",
    JSON.stringify(
      {
        status,
        results,
        reference_commit: "dd1afd2f3a794ea9e746197de314f81d43670ea1",
      },
      null,
      2,
    ),
  );
  console.log(run + " " + status);
  process.exitCode = status === "passed" ? 0 : 1;
} else {
  const reference = latest("reference-v7-clean-"),
    after = latest("visual-v7-");
  if (!reference || !after)
    throw Error("Capture the reference and final client screenshots first.");
  const target = "public/review-v7";
  fs.mkdirSync(target, { recursive: true });
  const images = {};
  const copy = (name, file) => {
    fs.copyFileSync(file, target + "/" + name + ".png");
    images[name] = file;
  };
  for (const name of ["orders", "members", "member-sheet"])
    copy(
      "reference-" + name,
      path.join(area, reference, "artifacts", "reference-" + name + ".png"),
    );
  for (const name of [
    "members",
    "tasks",
    "member-sheet",
    "request-sheet",
    "services",
    "overview",
    "settings",
    "mobile-requests",
  ])
    copy("after-" + name, path.join(area, after, "artifacts", name + ".png"));
  copy("before-members", "temp/admincn-v7-baseline/screenshots/members.png");
  copy("before-tasks", "temp/admincn-v7-baseline/screenshots/tasks.png");
  copy("before-sheet", "temp/admincn-v7-baseline/screenshots/sheet.png");
  const figure = (name, label) =>
    `<figure><figcaption>${label}</figcaption><a href="review-v7/${name}.png"><img loading="lazy" src="review-v7/${name}.png" alt="${label}"></a></figure>`;
  fs.writeFileSync(
    "public/admincn-v7-review.html",
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yeisme · AdminCN 视觉对照</title><style>*{box-sizing:border-box}body{font:14px/1.6 system-ui;margin:0;background:#fafafa;color:#171717}main{max-width:1600px;margin:auto;padding:32px}header{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:32px}h1{font-size:24px;margin:0}h2{font-size:18px;margin:32px 0 16px}p{color:#737373}a{color:inherit}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.pair{grid-template-columns:1fr 1fr}figure{margin:0;min-width:0}figcaption{margin-bottom:10px;font-weight:500}img{display:block;width:100%;border:1px solid #e5e5e5;border-radius:10px;background:white}.open{background:#171717;color:white;padding:9px 14px;border-radius:8px;text-decoration:none;white-space:nowrap}footer{margin-top:32px;border-top:1px solid #e5e5e5;padding-top:20px}@media(max-width:800px){main{padding:16px}.grid{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}}</style><main><header><div><h1>AdminCN 原版统一 · 六入口工作区</h1><p>原模板、改造前、改造后。同为1440×1000；点击图片查看原尺寸。手机截图为390×844。</p></div><a class="open" href="index.html?rev=admincn-v7#/members?env=main&project=rain">打开新版 →</a></header><h2>成员列表</h2><div class="grid">${figure("reference-members", "AdminCN Free 原版 · Users")}${figure("before-members", "Yeisme 改造前 · 重复统计与导航")}${figure("after-members", "Yeisme 新版 · 成员、团队、邀请")}</div><h2>请求与详情</h2><div class="grid">${figure("before-tasks", "改造前 · 请求历史")}${figure("after-tasks", "新版 · 查询与记录优先")}${figure("after-request-sheet", "新版 · 概况、内容、执行")}</div><h2>表单与总览</h2><div class="grid">${figure("reference-member-sheet", "原版编辑 Sheet")}${figure("after-member-sheet", "新版成员 Sheet")}${figure("after-overview", "新版运行摘要")}</div><div class="grid pair">${figure("reference-orders", "AdminCN Free 原版 · Orders")}${figure("after-services", "新版服务目录")}</div><h2>设置与手机</h2><div class="grid pair">${figure("after-settings", "新版设置")}${figure("after-mobile-requests", "手机 · 带字段标签的请求记录")}</div><footer><p>AdminCN Free MIT，固定源码 <a href="https://github.com/shadcnstudio/shadcn-nextjs-admincn-admin-template-free/tree/dd1afd2f3a794ea9e746197de314f81d43670ea1">dd1afd2f</a>。原模板在本地运行，组件样式未改；仅限定构建扫描范围、关闭开发标记和外部GitHub小挂件。模板人物为上游示例，Yeisme记录为设计样例；没有真实请求正文。</p><a href="docs/admincn-v7.md">组件与接口规格</a> · <a href="docs/verification-v7.md">验证记录</a> · <a href="source.zip">下载源码</a></footer></main></html>`,
  );
  fs.writeFileSync(
    "temp/delivery/visual-v7-manifest.json",
    JSON.stringify(
      {
        revision: "admincn-v7",
        reference,
        after,
        images,
        real_request_bodies: false,
      },
      null,
      2,
    ),
  );
  console.log("Generated AdminCN v7 reference and before/after comparison.");
}
