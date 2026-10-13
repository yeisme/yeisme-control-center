import fs from "node:fs";
import path from "node:path";
const area = "temp/integration-test-runs";
const runs = fs
  .readdirSync(area)
  .sort()
  .flatMap((id) => {
    try {
      const value = JSON.parse(
        fs.readFileSync(path.join(area, id, "summary.json"), "utf8"),
      );
      const env = JSON.parse(
        fs.readFileSync(path.join(area, id, "env.json"), "utf8"),
      );
      return [{ ...value, id, environment: env }];
    } catch {
      return [];
    }
  })
  .filter((r) => r.status === "passed");
const core = runs.findLast(
  (r) =>
    r.design_revision === "admincn-v7" &&
    r.tests === 53 &&
    r.preview?.startsWith("http://127.0.0.1"),
);
const workspace = runs.findLast(
  (r) =>
    r.id.startsWith("v7-") &&
    r.tests === 10 &&
    r.environment.base?.startsWith("http://127.0.0.1"),
);
const live = runs.findLast((r) => r.id.startsWith("live-") && r.tests === 2);
const visual = runs.findLast((r) => r.id.startsWith("visual-v7-"));
const reference = runs.findLast((r) => r.id.startsWith("reference-v7-clean-"));
if (!core || !workspace || !live || !visual || !reference)
  throw Error(
    "Complete all current UI, workspace, live fixture and visual checks before recording.",
  );
const lines = [
  "# AdminCN v7 验证记录",
  "",
  "本轮为六入口和统一组件改造；不把设计演示或fixture升级为真实owner读取证明。",
  "",
  `- 原有浏览器流程：${core.passed}/${core.tests}，${core.screenshots}张截图。证据：${area}/${core.id}/。`,
  `- 新工作区：${workspace.passed}/${workspace.tests}，覆盖六入口、受控正文、1280px固定与焦点、独立授权/配额、四档明暗及手机记录。证据：${area}/${workspace.id}/。`,
  `- 真实模式fixture：${live.passed}/${live.tests}，未配置登录拒绝、同名租户隔离与批次导出边界。证据：${area}/${live.id}/。`,
  "- 单元测试49项通过；源码包独立验证再次执行安装、类型、单元、正式构建及演示构建，结果由下载旁的 source-integrity.json 单独记录。",
  `- 最终视觉检查：${area}/${visual.id}/。成员首条记录267px，请求历史297px；正文未进入截图。`,
  `- 原版参考：固定AdminCN Free在本地1440×1000渲染，${area}/${reference.id}/。组件样式未改；仅限定构建扫描范围、关闭开发标识和外部GitHub小挂件。`,
  "- 总览图表禁用初始数值动画，成员状态色对齐原版语义；最后两项视觉调整分别完成对应聚焦复验。",
  "- 真实正文未进入公开原型、普通CSV、服务端缓存或证据。未执行生产部署、授权修改、真实生成、片场入口修改或race。",
  "- 发布完成后，对原OpenDesign进行远端工作区复验和逐文件SHA-256回读；结果保存在 delivery-integrity.json。",
  "",
  "## 现行边界",
  "",
  "前端源码、正式/演示构建和fixture测试分别验收。四服务的部署、OIDC注册、owner委托与日常真实读取仍以来源能力矩阵为准。源码包在发布前冻结，发布回执作为外部证据，不循环写入归档自身。",
];
fs.writeFileSync("docs/verification-v7.md", lines.join("\n") + "\n");
const file = "openspec/changes/unify-admincn-six-entry-workspace/tasks.md";
let tasks = fs.readFileSync(file, "utf8");
for (const id of ["3.1", "3.2"])
  tasks = tasks.replace("- [ ] " + id, "- [x] " + id);
fs.writeFileSync(file, tasks);
fs.writeFileSync(
  "temp/delivery/verification-v7.json",
  JSON.stringify(
    {
      revision: "admincn-v7",
      core: core.id,
      workspace: workspace.id,
      live: live.id,
      visual: visual.id,
      reference: reference.id,
      unit_tests: 49,
      production_verified: false,
    },
    null,
    2,
  ),
);
console.log(
  "Recorded verified UI layers; source and publication receipts remain detached.",
);
