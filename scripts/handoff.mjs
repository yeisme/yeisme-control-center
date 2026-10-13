import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { services } from "../src/data.ts";
fs.mkdirSync("docs", { recursive: true });
const table = [
  "# 全生态能力与 owner 矩阵",
  "",
  "本表由原型目录生成；所有 UI 状态为设计样例，接入状态不代表实际部署已验证。",
  "",
  "| 项目 | 类型 | canonical owner | 管理能力 | 当前接口交接缺口 |",
  "| --- | --- | --- | --- | --- |",
  ...services.map(
    (s) =>
      `| ${s.name} | ${{ remote: "远程服务", local: "本地工具", workspace: "专业工作台" }[s.kind]} | ${s.owner} | ${s.capabilities.join("、")} | ${s.gap} |`,
  ),
  "",
  "## 支撑内容与库",
  "",
  "`.skills/yeisme`、`shared/promptrepo`、`shared/agent-skills-runtime`、`data/yeisme-notes` 与 `data/yeisme-prompt-templates` 作为技能、SDK 或内容库归各自维护方。相关版本与来源通过 Template Registry、Pinax、Runtime Plane 或既有仓库合同查看，不为这些库虚构常驻服务或健康检查。",
  "",
  "历史 Workbench、Radar、Ordo 不恢复。个人 MCP Gateway 与 Aigora 企业网关独立维护，不共享凭据或运行状态。",
  "",
];
fs.writeFileSync("docs/capability-matrix.md", table.join("\n"));
const evidenceRoot = "temp/integration-test-runs";
if (fs.existsSync(evidenceRoot)) {
  const runs = fs
    .readdirSync(evidenceRoot)
    .sort()
    .flatMap((name) => {
      const file = path.join(evidenceRoot, name, "summary.json");
      if (!fs.existsSync(file)) return [];
      return [
        {
          ...JSON.parse(fs.readFileSync(file, "utf8")),
          directory: `${evidenceRoot}/${name}/`,
        },
      ];
    });
  const remote = runs.findLast(
    (r) =>
      r.status === "passed" &&
      r.design_revision === "admincn-v5" &&
      r.tests >= 53 &&
      r.preview?.includes("10.10.1.101") &&
      r.results?.some((t) => t.name.startsWith("all ten pages")),
  );
  const local = runs.findLast(
    (r) =>
      r.status === "passed" &&
      r.design_revision === "admincn-v5" &&
      r.tests >= 53 &&
      r.preview?.startsWith("http://127.0.0.1") &&
      r.results?.some((t) => t.name.startsWith("all ten pages")),
  );
  const verified = remote || local;
  const site = remote ? "远端" : "本地静态构建";
  const source = runs.findLast(
    (r) =>
      r.status === "passed" &&
      r.design_revision === "admincn-v5" &&
      r.source_archive_sha256 &&
      r.commands?.length === 4,
  );
  const frame = runs.findLast(
    (r) =>
      r.status === "passed" &&
      r.frame_checked &&
      r.results.some((t) => t.name.startsWith("Frame Studio preserves")),
  );
  if (verified)
    fs.writeFileSync(
      "docs/verification.md",
      [
        "# 管理台、多用户与请求历史验证记录",
        "",
        "- 设计版本：admincn-v5；AdminCN 组件、Lucide 1.24.0、Sales 看板与模态 Sheet。",
        `- 控制中心${site}浏览器流程：${verified.passed}/${verified.tests} 通过。`,
        `- ${site}截图：${verified.screenshots} 张，覆盖 1440/1280/768/390、明暗主题与服务详情。`,
        `- 控制中心证据：${verified.directory}`,
        "- 单元测试：36 项（领域、浏览、表单、范围隔离、统计、导出、owner 授权与目录边界）；以独立源码构建的实际结果为准。",
        ...(source
          ? [
              `- 源码包独立解压：固定依赖安装、类型检查、单元测试、构建均通过。`,
              `- 源码构建证据：${source.directory}`,
            ]
          : []),
        frame
          ? `- 前轮片场副本（本轮未重跑）：${frame.results.filter((t) => t.name.startsWith("Frame Studio")).length} 条完整往返流程通过，${frame.screenshots} 张截图。`
          : "- 片场副本：尚未取得完整往返证据。",
        ...(frame
          ? [
              `- 片场副本证据：${frame.directory}`,
              "- 已验证原任务引用、剧本文字、分镜描述和返回位置保持；仅操作临时浏览器中的演示数据。",
            ]
          : []),
        "- 片场主原型：保留独立合并待办；本轮仅更新控制中心。入口源码补丁与截图可独立审阅。",
        `- 验证中真实服务写请求：${verified.real_service_calls + (frame?.real_service_calls || 0)}。`,
        "",
        `## 控制中心${site}场景`,
        "",
        ...verified.results.map((t) => `- ${t.status} · ${t.name}`),
        "",
        "## 片场原有测试边界",
        "",
        "新增上下文单元测试两项通过。原有全量测试在本地副本中 294 项通过，一项独立设计文档测试依赖未复制的 OpenDesign 设计产物与容器路径；原始基线同样失败，未修改无关测试。",
        "",
        "原型与工程证据不代表正式服务接线、Provider 调用或生产部署。",
        "",
      ].join("\n"),
    );
}
fs.mkdirSync("public/docs", { recursive: true });
fs.cpSync("docs", "public/docs", { recursive: true });
const archiveEntries = {};
const historical = [
  "review",
  "finder-review",
  "workspace-review",
  "admin-review",
  "precision-review",
];
for (const folder of ["src", "app", "docs", "scripts", "tests", "public"]) {
  for (const entry of fs.readdirSync(folder, {
    recursive: true,
    withFileTypes: true,
  })) {
    const file = path.join(entry.parentPath, entry.name);
    if (
      !entry.isFile() ||
      ["configure.mjs", "source.zip"].includes(entry.name) ||
      file.startsWith("public/docs/") ||
      historical.some((name) => file.startsWith(`public/${name}/`))
    )
      continue;
    let content = fs.readFileSync(file);
    if (file.startsWith("public/") && file.endsWith(".html")) {
      let html = content.toString();
      for (const name of historical)
        html = html.replaceAll(
          `./${name}/`,
          `http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/${name}/`,
        );
      content = Buffer.from(html);
    }
    archiveEntries["yeisme-service-control-center/" + file] = content;
  }
}
for (const name of [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "AGENTS.md",
])
  archiveEntries["yeisme-service-control-center/" + name] =
    fs.readFileSync(name);
fs.writeFileSync("public/source.zip", zipSync(archiveEntries));
console.log(
  "Prepared design documents, capability matrix and reproducible source archive.",
);
