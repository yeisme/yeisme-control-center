import fs from "node:fs";
import path from "node:path";
const change = "openspec/changes/refine-sidebar-fullscreen-motion";
if (!fs.existsSync(change + "/.openspec.yaml"))
  throw Error("Create the change with openspec new change first.");
const write = (name, text) => {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, text.trim() + "\n");
};
write(change + "/proposal.md", `
## Why

现有右侧展开仍为1120px加宽面板，左右侧栏的对象图标、类别提示和动作反馈不足。需要保留AdminCN六入口，同时将右侧详情升级为可还原的全屏工作区。

## What Changes

- 六入口图标使用语义明确的Lucide，左侧展开/收起使用现有React Spring。
- 右侧显示对象图标，直接提供全屏展开/还原，并保留固定面板与草稿。
- 媒体使用低饱和类别色，控件与导航维持中性风格。
- 普通列表及权限逻辑保持，范围失效立即清除旧内容。

## Capabilities

### New Capabilities
- control-center-sidebar-motion：统一侧栏、类别图标与全屏详情。

### Modified Capabilities
无owner领域合同变更。

## Impact

fit：本轮能力属于客户端展示。领域身份、正文、资产与账本继续split-owner；不增加真实管理写入或生产部署。
`);
write(change + "/design.md", `
## Context

复用AdminCN Neutral、Geist、Lucide与现有React/Radix/React Spring；不添加依赖，不改变六主入口及旧深链。

## Decisions

- 左侧宽度256/48px，使用阻尼弹簧；默认单色图标，选中与按钮反馈保持轻量。
- 右侧详情420px、配置560px；展开为应用视口全屏。全屏内容最大1200px，编辑表单最大760px；手机隐藏最大化入口。
- 直接展开/还原按钮与原更多菜单共存，Escape先还原完整视图，再按现有草稿保护关闭。
- 图像、视频、音频、文稿使用独立明暗色令牌，状态颜色与类别颜色分别表达含义。
- React Spring负责侧栏与工作区连续变化；CSS负责控件与宽度过渡。减少动态效果立即呈现最终状态。
- 模式改变不重建内容或发请求；固定模式主区仍至少保留560px。范围与权限失效不等待退出动画。

## Validation

保留49项单元与53条浏览器流程；工作区用例增加可见对象图标、直接全屏按钮、全屏宽度和Escape还原。四档明暗布局、焦点、草稿、权限隔离继续回归。截图与录屏仅使用演示数据。
`);
write(change + "/specs/control-center-sidebar-motion/spec.md", `
## ADDED Requirements

### Requirement: 右侧全屏详情
控制中心 SHALL 将右侧详情展开到应用完整视口，保留原对象、标签页、草稿和还原位置。

#### Scenario: 固定详情展开和还原
- **WHEN** 用户在固定面板点击展开并随后按Escape
- **THEN** 先展示全屏详情，再还原固定面板，原对象和焦点恢复规则保持。

#### Scenario: 移动视口
- **WHEN** 视口小于640px
- **THEN** 详情为全屏且隐藏无意义的最大化按钮，表单内容不水平溢出。

### Requirement: 统一图标与动效
侧栏和详情 SHALL 使用同一Lucide图标体系，媒体类别 SHALL 使用明暗主题对应的轻量色彩，导航及操作保持中性。

#### Scenario: 减少动态效果
- **WHEN** 用户开启系统减少动态效果
- **THEN** 界面直接呈现最终状态，权限和业务状态更新不被动画延迟。

#### Scenario: 原操作保持
- **WHEN** 用户快速切换工作区显示模式
- **THEN** 不产生新的读取或提交，失效范围正文立即清除。
`);
write(change + "/tasks.md", `
## 1. 组件与视觉
- [x] 1.1 统一导航语义图标、类别令牌和对象标题图标。
- [x] 1.2 接入侧栏弹簧与全屏详情展开/还原。
## 2. 验证与交付
- [x] 2.1 类型、单元、构建与工作区回归。
- [ ] 2.2 完整浏览器、最终截图与减少动态效果验证。
- [ ] 2.3 更新源包、原OpenDesign预览并远端回读。
`);
console.log("Generated sidebar and fullscreen specification.");
