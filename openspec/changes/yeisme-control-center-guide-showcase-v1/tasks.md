# Tasks

## 1. 真实生成（预算 ¥300 内）

- [x] 1.1 就绪检查与预算账本（每次调用带 owner 的费用上限，回执不含密钥）
- [x] 1.2 Eikona 双模型对比 6 张、改图 1 次；放大因无超分模型而放弃
- [x] 1.3 Scaena 文生视频、图生视频各 1 段；首尾帧无可用线路
- [x] 1.4 Sonora 两句试听、一段配乐
- [x] 1.5 Claude Code 无头模式（Eikona）与 Codex exec（Sonora）各录三轮对话

## 2. 素材与清单

- [x] 2.1 转码、去元数据、脱敏，放进 `public/guide/showcase/`（3.3MB）
- [x] 2.2 `showcase.ts`、`agent-replays.ts`、`guide-reference.ts`

## 3. 页面

- [x] 3.1 `guide-parts.tsx`（命令行、标题、选择器）从 `GuideContent` 拆出
- [x] 3.2 `Showcase.tsx`：链条、对比画廊与原生 dialog 查看器、前后滑块、视频与音频卡片、未做成的说明
- [x] 3.3 `AgentReplay.tsx`：逐步展开、焦点、客户端联动、结果与两项花费
- [x] 3.4 `Reference.tsx`：工具手册、配置示例、排障表（窄屏改为堆叠）；本页目录；FAQ 12 条
- [x] 3.5 Claude Code 共享 HTTP 接入写法

## 4. 验证

- [x] 4.1 `tests/guide-showcase.test.ts`：文件与大小、8MB 预算、无孤立文件、记录字段、回放结构、配置里的令牌只用变量名
- [x] 4.2 `tests/guide-content.test.ts`：禁用文本扫整个指南目录；Claude Code 共享写法
- [x] 4.3 `verify-public-guide`：媒体播放、查看器、滑块、回放；`verify-release-component` 检查样例媒体；浏览器旅程的客户端选择限定在快速上手
