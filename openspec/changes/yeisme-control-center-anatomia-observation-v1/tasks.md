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
- [x] 2.5 真实环境：经用户确认，把观察合同移植到部署所用的代码线（Anatomia 分支 `feat/control-center-observation-deployed-line`，提交 8d35c746/40738f9b，未推送），评审后修了事件续读、恢复任务误判为结果未知、标题路径与授权路由限流等问题，2026-11-01 部署到 business-test（官方备份已校验、只换 API 镜像二进制、旧容器保留可回滚、worker 未改）。为项目 `project:movies-videos-x20` 签发观察密钥（含产物授权）后接入控制中心：只读核对列出该项目 7 个拉片分析（1 个成功、24 帧，6 个失败），详情、事件 200，关键帧授权读取 200；暂存配置与真实配置副本核对通过后写入真实配置并重启。视频问答没有记录项目，按设计不列出
