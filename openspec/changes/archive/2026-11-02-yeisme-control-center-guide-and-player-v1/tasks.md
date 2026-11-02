# Tasks

## 1. 使用指南

- [x] 1.1 导航：`guide` 取代侧栏 `creation`；`creation` 保留为隐藏路由（项目批量生成、批次通知），个人范围跳转 `/guide`
- [x] 1.2 指南内容：四个工具的安装、体检、MCP 注册命令逐条核对 owner 文档与 `--help`；Sonora、Auctra 标注已发布二进制尚无 `mcp`
- [x] 1.3 页面：主视觉示意动画、三步上手、调用约定、工具卡片循环演示、逐字点亮标语、常见问题、收尾行动；减少动态时显示最终帧
- [x] 1.4 模型与工具 Inspector 改为「查看接入方式」深链到对应工具卡片
- [x] 1.5 验证：`tests/guide-content.test.ts`（无内网地址、命令一致、FAQ 数量）、浏览器旅程「guide replaces AI creation…」

## 2. 全局音频播放器

- [x] 2.1 `AudioPlayerProvider` + 浮动播放器 + 进度条（指针拖动、悬停时间、slider 键盘合同）
- [x] 2.2 资源库卡片/列表、任务中心快捷操作、任务 Inspector、共享项目成果改用播放器；资源 Inspector 显示同一进度
- [x] 2.3 会话内存与流式两种来源、句柄过期重新申请、范围/会话切换停止、媒体键、只允许一个声源
- [x] 2.4 服务端 CSP 增加 `media-src 'self' blob:`
- [x] 2.5 验证：`tests/audio-playback.test.ts`、浏览器旅程两项音频检查（含两次传输失败后的恢复）

## 3. 启动加载画面

- [x] 3.1 `app/index.html` 内联品牌启动画面（明暗主题、10 秒慢连接提示），会话确认后淡出
- [x] 3.2 页面代码加载时的页面形状骨架

## 4. 发布

- [x] 4.1 发布到 4312（用户 2026-10-26 确认）：control-center-only，`control-release-2026-10-26T15-00-14-174Z`，上一版 `control-release-2026-10-22T15-35-16-840Z` 保留；无新迁移（真实库 9/9 已应用）；HTTPS 回读 CSP 含 `media-src 'self' blob:`；真实只读复验 `real-owner-read-2026-10-26T15-01-55-713Z` 通过（Sonora 抽样结果的播放句柄仍为 `403 content_not_authorized`，与 10-22 相同）
