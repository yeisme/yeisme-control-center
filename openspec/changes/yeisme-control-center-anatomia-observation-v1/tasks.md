# Tasks

## 1. 接入

- [x] 1.1 owner 列表、显示名、媒体类型归类、任务族用词（拉片分析、视频问答）
- [x] 1.2 服务目录改为“任务观测”并写明缺口；来源覆盖条在配置后显示 Anatomia
- [x] 1.3 媒体授权：`anatomia.task_artifact_grant.v1`，同源、精确路由、无 query 与 fragment、过期不超过 125 秒，带观察凭据取媒体
- [x] 1.4 取消一律 `cancel_not_supported`；`personal-config` 的 `connect` 与 `content` 接受 Anatomia，`cancel` 不接受，不钉委托读取默认项目

## 2. 验证

- [x] 2.1 单元测试：Anatomia 的裸 structuredContent、授权路由的六种错误地址、错误 schema、取消被拒；变异检查（去掉 Anatomia 分支后测试失败）
- [x] 2.2 fixture 与合同集成：列表、阶段进度、事件、帧预览、未授权内容 403、带 query 的授权 403、取消 409
- [x] 2.3 浏览器旅程：任务页按 Anatomia 筛选、服务卡、被拒连接、来源覆盖（71/71）
- [x] 2.4 使用指南：“接入”章“更多工具”写 Anatomia 观察密钥的签发与登记（只用占位符），“更多 MCP 工具”加入 Anatomia
- [ ] 2.5 真实环境：用户已同意部署，但未执行。现有 business-test 部署来自另一条代码线（镜像 `20261015-execution-v12-5-5`），它依赖的流式 HTTP、部署回执、Provider 网关、原生视频定位等配置项在当前仓库代码里都不存在，用当前代码加本变更重建会破坏该环境；需先决定把观察合同移植到部署所用的代码线、把部署迁到当前代码线，或另起一个新实例
