# Yeisme 控制中心：使用指南改为顶部栏章节与本页大纲 v1

## Why

用户要求把控制中心里的文档改为顶部栏跳转，并设计大纲（2026-10-30）。

只读探查：

- **一整页太长**：使用指南共 10 节，从英雄区到常见问题。
- **目录不可用**：目录是一排不吸顶的按钮，在桌面端位于第一屏底部，在手机上要往下滑两屏。它不标出当前位置，地址也不随所在小节变化，无法分享，也不能用“后退”返回。
- **内容重复**：“工具”卡片与“工具手册”大量重复。
- **规模**：接下来还要加 Anatomia、DriveBridge、MCP Gateway 的手册，单页会更长。

## What Changes

**大纲**：五章，各章小节如下。

- **开始**：英雄区、三步上手、调用约定、接下来。
- **工具**：总览分创作工具与更多 MCP 工具。每个工具一页，原工具卡与原手册合并为常用命令、MCP、安装、手册各主题、真实样例。
- **案例**：真实案例、Agent 回放。
- **接入**：Claude Code 与 Codex 配置；新增“接入控制中心”。
- **排障与问答**：排障、常见问题、核心原则。

**顶部栏**：

- 章节栏 `nav[aria-label="指南章节"]` 由真实链接组成，当前章标 `aria-current="page"`。
- 站内吸顶于工作区顶栏下方，公开页吸顶于 56px 页头下方；手机上横向滚动。

**本页大纲**：

- 内容列足够宽时显示为右侧吸顶栏，否则收成一个按钮。
- 当前小节标 `aria-current="location"`；滚动不写地址，点大纲时用 replace 写入。

**地址**：

- 纯函数模块 `guide-location.ts`。
- 站内地址：`#/guide/<章>/<页>?tool=&client=&section=`。
- 公开页地址：`guide.html?chapter=&page=&tool=&client=#小节`。
- 旧的 `?tool=` 地址落到“开始”的三步并选中该工具。别名 help、mcp、docs、cli 落到相应章节。
- 未登录访问任一指南地址，都跳到公开页的同一位置。
- 目录检查器的“查看接入方式”改为直接打开工具页。

**其他**：

- 章节之间有上一章 / 下一章。换章时回到顶部，焦点落到本章标题；同章内移动不新增历史记录。
- 样式改用容器查询，让站内带侧栏时按真实列宽排版。
- 公开页仍不用 Radix、不发 API 请求；新增指南文件不得引入 ui 汇总入口或 Radix。

## Impact

- **前端**：`src/pages/guide/`（新增 `guide-location.ts`、`GuideNav.tsx`、`GuideTools.tsx`；重写 `GuideContent.tsx`、`GuidePage.tsx`、`PublicGuide.tsx`、`Reference.tsx`）、`src/styles/guide.css`、`src/app/App.tsx`、`src/app/auth.tsx`、`src/pages/capabilities/catalog-view.ts`。
- **测试与脚本**：`tests/guide-location.test.ts`（新）、`tests/public-guide.test.ts`、`tests/guide-content.test.ts`、`tests/catalog-view.test.ts`、`tests/frontend-read-model.test.ts`；`scripts/verify-public-guide.ts`、`scripts/verify-browser-journey.ts`、`scripts/capture-visual-matrix.ts`。
- 不改服务器与接口，不发布。
