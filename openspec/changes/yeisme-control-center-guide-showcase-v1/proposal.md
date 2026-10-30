# Yeisme 控制中心：使用指南扩写，真实案例与 Agent 调用 v1

## Why

交互路线第三轮 T5（`docs/interaction-roadmap.md`）。用户的原话是：“目前使用指南不够详细，缺少真实生成案例，允许真实消费完善展示，同时 agent 调用，设计更多具体展示效果”。用户确认的前提：真实消费总上限 ¥300；样例素材提交进仓库，总量不超过 8MB。

T4 之后的指南：

- 输出全是 CSS 示意动画，页面写着“输出和对话只是示例”。
- 每个工具只有三条命令和一个 MCP 命令，缺初始化、凭据、费用、输出位置和排障。
- 没有 Agent 调用的真实过程。

## What Changes

- **真实生成**（2026-10-29，局域网 Eikona、Scaena、Sonora 服务；回执与花费记在 `temp/guide-showcase-<ts>/`，不进仓库）：
  - Eikona：同一提示词，GPT Image 2.5 与 Grok Imagine 各三张；改图一次。
  - Scaena：Seedance 2.5 文生视频 4 秒；MiniMax-H3 图生视频 5 秒，首帧用改图结果。
  - Sonora：Fish Audio 中英文两句试听；Suno V6 器乐配乐 33 秒（brief → plan → approval → generate → reconcile）。
  - Agent：Claude Code 无头模式经 Eikona 生成一张图，Codex exec 经 Sonora 配音一句。两段都是三轮对话，第一轮停下来等确认，保存结构化记录。
- **素材**：
  - 位置：`public/guide/showcase/`，16 个文件共 3.3MB。
  - 格式：图片 webp；视频 h264 720p、faststart，配 webp 海报；音频 128k mp3。
  - 全部去除元数据。文件名、调用和 run ref 都已脱敏。
- **清单**：
  - `showcase.ts` 每条记录工具、提示词、原样调用（去掉幂等键）、模型、owner 报告的费用（未报告就写未报告）、耗时、短 ref、替代文字。
  - `agent-replays.ts` 是两段回放：压缩重复查询并注明次数，保留每次调用的动作和参数。Agent 自己的解释不对时加编者注；内部通道名换成占位符。
- **页面**：
  - 新增本页目录、真实案例、Agent 回放、工具手册、配置示例、排障。
  - FAQ 扩到 12 条。
  - 首屏说明改为指向真实记录。
- **展示**：
  - 关键帧 → 改图 → 视频 → 配音 → 配乐的链条。
  - 双模型对比画廊，用原生 `<dialog>` 轻量全屏查看（方向键切换、Esc 关闭、焦点回到缩略图）。
  - 改图前后滑块（方向键可调）。
  - 视频带海报，音频卡片。
  - 回放逐步展开，焦点落到新出现的一步；跟随页面的 Claude Code / Codex 选择。
  - 每个样例都有“AI 生成”标签。
  - 减少动态效果时不播动画。
- **命令修正**：Claude Code 增加共享 HTTP 服务的接入写法。`${VAR}` 用单引号原样写进 `.mcp.json`，连接时展开；录制时实测可用。
- **验证**：
  - `verify-public-guide` 增加 4 项：图片解码、视频音频按 Range 播放、查看器键盘操作、滑块、回放焦点与客户端联动。
  - 发布组件检查样例媒体。
  - 清单完整性单元测试。
  - 禁用文本检查扩到整个指南目录。

## Owner Boundary

- 只改控制中心的前端、样例素材和验证脚本。
- 不改 owner 仓库、服务部署和凭据。
- 真实花费远低于上限。没做成的照实写在页面上：
  - 首尾帧视频：Scaena 没有启用首尾帧模式的线路。
  - 无损放大：这台 Eikona 没有配置超分模型。
  - 更多音色：其他 TTS Provider 缺凭据或额度，韩语音色被 Provider 拒绝。
- 录制中发现的 owner 问题记入路线文档，交给各 owner：
  - Eikona：dry run 接受了不合 16 像素对齐的画布；MCP 状态不带失败原因。
  - Sonora：402 被归为 internal_error；`asset.get` 对音频资产报内部错误。
