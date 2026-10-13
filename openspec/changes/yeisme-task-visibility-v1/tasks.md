# 控制中心 实施

- [ ] 1.1 CONTRACT：固定可观察任务、进度、权限、结果与取消边界；owner=控制中心；scope=本项目；依赖=无；lane=串行；验证=bun run typecheck && bun run test && bun run build；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例
- [ ] 2.1 BACKEND：本 owner 的授权观测与兼容实现；owner=控制中心；scope=本项目；依赖=1.1；lane=串行；验证=bun run typecheck && bun run test && bun run build；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例
- [ ] 3.1 FRONTEND：本 owner 的公开合同消费者（非界面 owner 仅检查消费合同）；owner=控制中心；scope=本项目；依赖=2.1；lane=串行；验证=bun run typecheck && bun run test && bun run build；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例
- [ ] 4.1 INTEGRATION：本 owner 隔离证据；真实部署和授权独立记账；owner=控制中心；scope=本项目；依赖=3.1；lane=串行；验证=bun run typecheck && bun run test && bun run build；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例

本清单由 scripts/task-visibility-spec.mjs 生成；进展用 mark 更新，不手改状态。

阶段记录：FRONTEND INTEGRATION_PENDING；媒体/通知意愿/深链组件通过：temp/integration-test-runs/task-visibility-2026-10-05T12-14-43-303Z；三owner独立进程、取消、完整v8仍待验

阶段记录：INTEGRATION INTEGRATION_PENDING；隔离system通过：temp/integration-test-runs/task-processes-2026-10-05T14-23-27-148Z；三个owner测试进程＋真实持久化＋fake外部边界，MCP观察/浏览器媒体/三族取消；Sonora与Scaena提交仍为application入口、非发行daemon。组件task-visibility-2026-10-05T14-23-18-623Z通过；75测试与构建通过；全MCP入口、视频、重启/撤权组合与日常只读仍未完成。

阶段记录：INTEGRATION INTEGRATION_PENDING；增量system通过：temp/integration-test-runs/task-processes-2026-10-05T14-47-07-623Z；新增Scaena canonical run合成视频解码/seek/Range/HEAD、控制中心重启重新登录查原回执、临时observer失效拒绝旧媒体句柄与Sonora断连隔离；仍非全MCP提交/发行daemon/owner执行中重启/Studio联合验收。

阶段记录：FRONTEND INTEGRATION_PENDING；确认时固定revision修复：后台detail刷新不扩大取消确认范围；组件temp/integration-test-runs/task-visibility-2026-10-05T14-56-49-522Z验证版本冲突不执行、丢回包/unknown/requested只查回执、布局与筛选；typecheck/build及75测试通过。
