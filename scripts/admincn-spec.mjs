import fs from "node:fs";
import path from "node:path";
const change = "openspec/changes/unify-admincn-six-entry-workspace";
if (!fs.existsSync(change + "/.openspec.yaml"))
  throw Error("Create the change with openspec new change first.");
const write = (name, text) => {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, text.trim() + "\n");
};
write(
  change + "/proposal.md",
  `
## Why

当前控制中心叠加了多轮导航、范围栏和自定义控件，偏离用户选定的 AdminCN Free。需要统一模板组件并把日常入口压缩为六项，保留既有领域能力。

## What Changes

- 统一正式版与演示版的外壳、工作区切换器、导航、表格和 Sheet。
- 主入口调整为总览、项目、请求、资产、服务、团队；设置在底部，高级能力进入对应页面。
- 成员去掉统计卡；请求使用紧凑摘要与高级筛选；详情统一概况、内容、执行。
- 保留既有深链、权限、草稿、原请求恢复、统计和导出边界。

## Capabilities

### New Capabilities
- control-center-admincn-workspace：AdminCN 原版组件与六入口工作区，包含菜单、范围与响应式验收。

### Modified Capabilities
无 owner 领域合同变更。

## Impact

仅 client/yeisme-control-center 的界面、验证脚本和交接文档。复用现有依赖与 owner 只读聚合合同；不新增生产写操作。
`,
);
write(
  change + "/design.md",
  `
## Context

能力归属为 split-owner。控制中心拥有展示与导航，owner 保留身份、授权、请求、内容和账本。AdminCN Free 固定 dd1afd2f3a794ea9e746197de314f81d43670ea1，MIT。

## Goals / Non-Goals

统一组件和六个日常入口，减少重复控件；正式/演示共用展示。真实服务部署、凭据、授权注册、管理写操作、片场入口不属于本轮。

## Decisions

- AppShell 共用六入口、贯通顶栏、范围切换器与设置入口；旧 usage/audit/approvals 页面保留路由并映射到总览/设置/请求。
- 模板 Button utilities/variants 直接适配 native/Radix；显式声明 Tailwind 源码扫描范围。颜色、字体、边框与圆角使用同一组模板令牌。
- 成员与请求共用 DataTable；列、排序、个人视图、导出合并到显示菜单。高级条件进入筛选弹层。手机用带字段标签的记录排版。
- 团队主页仅成员/团队/邀请，组织设置提供租户、服务账号、访问授权和配额。真实授权目录与团队引用明确区分。
- 请求详情三分区；内容一次只挂载输入或输出读取视图，切换即销毁正文。未采集和未授权不生成样例。
- 普通详情/成员表单420px，复杂配置560px；固定/展开置于更多菜单。固定宽度依据实际工作区测量并为主内容保留560px；断点改变不重建草稿。
- 保留原触发焦点跨 Sheet/固定模式切换；实际关闭后恢复，范围替换不把焦点送回失效对象。

## Risks / Trade-offs

模板采用 Base UI/Next.js；本项目只适配样式结构并保留 Radix/Vite，避免牵动授权与执行状态。旧导航名称只保留路由兼容，测试以新入口验证同一业务行为。

## Validation

复用49项单元测试、原浏览器回归、真实模式fixture与工作区脚本。覆盖四档视口、明暗、减少动态效果、表单错误、同名租户、迟到结果和原操作恢复。独立源码包构建及 OpenDesign 发布/readback 分层记录；截图不包含真实正文。
`,
);
write(
  change + "/specs/control-center-admincn-workspace/spec.md",
  `
## ADDED Requirements

### Requirement: 六入口与统一范围
控制中心 SHALL 在正式及演示模式提供总览、项目、请求、资产、服务、团队六个主入口，设置位于底部；旧深链与领域能力 SHALL 保持可达。

#### Scenario: 从旧统计链接进入
- **WHEN** 用户打开已有 usage 深链
- **THEN** 展示统计与成本，主导航选中总览，并可返回运行摘要。

#### Scenario: 切换租户或权限
- **WHEN** 当前授权范围改变
- **THEN** 清除旧选择、正文和失效草稿，并拒绝迟到响应写入新范围。

### Requirement: 模板组件与简洁列表
全部管理页面 SHALL 复用统一 AdminCN 组件及主题令牌；成员主页 SHALL 不展示重复统计卡，列表 SHALL 保留筛选、排序、列、选择与授权范围导出。

#### Scenario: 窄屏浏览请求
- **WHEN** 视口为390px且存在记录
- **THEN** 首屏可见带字段标签的记录，详情可打开且文档无水平溢出。

#### Scenario: 表格保存视图
- **WHEN** 用户设置筛选和显示列后保存个人视图
- **THEN** 恢复时保留查询条件，并仅导出当前授权查询范围内的可见字段。

### Requirement: 简洁 Sheet 与原操作恢复
请求详情 SHALL 提供概况、内容、执行三个分区。高级固定/展开 SHALL 在更多菜单，草稿与原操作引用 SHALL 在模式切换时保持。

#### Scenario: 固定面板切回手机
- **WHEN** 用户固定详情后缩小视口
- **THEN** 回到全屏 Sheet，保留对象，实际关闭后恢复原记录焦点。

#### Scenario: 内容方向切换
- **WHEN** 用户已读取输入后切换输出
- **THEN** 已读正文从当前界面清除，不缓存或预取另一个方向的敏感正文。

### Requirement: 多租户和组织设置
成员、团队、邀请 SHALL 与服务账号、访问授权、配额和租户目录分别呈现；身份 SHALL 仅依明确绑定关联。

#### Scenario: 打开配额
- **WHEN** 用户从组织设置打开配额用量
- **THEN** 分别展示配置值、生效限制和实际用量，不重复显示授权矩阵；未知用量不绘制为零。
`,
);
const tasks = change + "/tasks.md";
if (!fs.existsSync(tasks))
  write(
    tasks,
    `
## 1. 统一组件与导航
- [x] 1.1 建立正式/演示共用外壳与六入口，保留旧深链。
- [x] 1.2 迁移模板按钮variants与中性令牌，清理被替代的样式。
## 2. 核心工作区
- [x] 2.1 成员、组织设置、请求表格与手机记录排版。
- [x] 2.2 三分区详情、按需正文、Sheet模式与焦点保持。
## 3. 验证与交付
- [ ] 3.1 完成单元、类型、构建和既有浏览器流程回归。
- [ ] 3.2 完成工作区、真实模式fixture、四档明暗与对照截图。
- [ ] 3.3 完成源码包独立安装与构建。
- [ ] 3.4 检查发布基线，增量更新原OpenDesign并远端复验/readback。
`,
  );
console.log("Generated AdminCN workspace OpenSpec artifacts.");
