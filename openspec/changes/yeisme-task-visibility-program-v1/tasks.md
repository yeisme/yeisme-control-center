# 跨项目合同 实施

- [ ] 1.1 CONTRACT：固定可观察任务、进度、权限、结果与取消边界；owner=跨项目合同；scope=本项目；依赖=无；lane=串行；验证=openspec validate yeisme-task-visibility-program-v1 --strict；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例
- [ ] 2.1 BACKEND：本 owner 的授权观测与兼容实现；owner=跨项目合同；scope=本项目；依赖=1.1；lane=串行；验证=openspec validate yeisme-task-visibility-program-v1 --strict；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例
- [ ] 3.1 FRONTEND：本 owner 的公开合同消费者（非界面 owner 仅检查消费合同）；owner=跨项目合同；scope=本项目；依赖=2.1；lane=串行；验证=openspec validate yeisme-task-visibility-program-v1 --strict；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例
- [ ] 4.1 INTEGRATION：本 owner 隔离证据；真实部署和授权独立记账；owner=跨项目合同；scope=本项目；依赖=3.1；lane=串行；验证=openspec validate yeisme-task-visibility-program-v1 --strict；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例

本清单由 scripts/task-visibility-spec.mjs 生成；进展用 mark 更新，不手改状态。

阶段记录：INTEGRATION INTEGRATION_PENDING；三owner局部及两前端组件分层验证通过，不等于真实三进程闭环；仍未部署、改真实权限或调用付费provider

阶段记录：INTEGRATION INTEGRATION_PENDING；三服务独立owner测试进程闭环证据见client/yeisme-control-center/temp/integration-test-runs/task-processes-2026-10-05T14-23-27-148Z；取消/媒体/观察局部通过，不是全MCP生成或发行daemon/日常服务验收；原计划未删项，完整覆盖与授权激活仍待完成。

阶段记录：INTEGRATION INTEGRATION_PENDING；消费者隔离证据增量见client/yeisme-control-center/temp/integration-test-runs/task-processes-2026-10-05T14-47-07-623Z；图片/音频/合成视频、取消、控制中心重启和断连隔离通过；完整任务族/入口/事件/Studio联合与日常授权验收未完成。
