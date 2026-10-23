# 控制中心 实施

- [ ] 1.1 CONTRACT：将旧任务观察要求对账当前共享合同、后续已归档规格与覆盖矩阵；owner=Control Center；scope=src/task-observation.ts、observation-contract.ts、此变更specs、说明文档；依赖=无；lane=串行；验证=openspec validate yeisme-task-visibility-v1 --strict；预期=任务、结果、进度、权限和取消边界逐项有实现/证据/缺口，不按0/4重写现有代码；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
- [ ] 2.1 BACKEND：核对并仅修复当前任务观测/媒体/取消回执的未覆盖合同缺口；owner=Control Center；scope=server/task-connections.ts、media.ts、app.ts及相应tests；依赖=1.1；lane=串行；验证=bun run test -- tests/task-connections.test.ts tests/task-cancel.test.ts tests/media-bridge.test.ts；预期=只补introduced且属于本项的缺口；授权/Range/unknown原回执不回退；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
- [ ] 3.1 FRONTEND：核对当前任务Inspector、显式媒体与深链的消费覆盖；owner=Control Center；scope=任务/媒体相关src与现有tests；依赖=1.1；联调等待2.1；lane=串行；验证=bun run typecheck；bun run test -- tests/task-links.test.ts tests/frontend-read-model.test.ts；预期=选择不播放、旧epoch不写回、确认revision固定、原任务可定位；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
- [ ] 4.1 INTEGRATION：以现行合同/浏览器旅程补齐本地验收，真实owner覆盖逐项记录；owner=Control Center；scope=scripts/verify-contract-integration.ts、verify-browser-journey.ts、脱敏证据；依赖=2.1、3.1；真实读取另需合法observer；lane=串行；验证=bun run test:contract-integration；bun run test:browser-journey；预期=不用已过时test:task-visibility作为当前UI门；不执行真实取消；fixture与真实证据分开；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据

本清单由 scripts/task-visibility-spec.mjs 生成；进展用 mark 更新，不手改状态。

阶段记录：FRONTEND INTEGRATION_PENDING；媒体/通知意愿/深链组件通过：temp/integration-test-runs/task-visibility-2026-10-05T12-14-43-303Z；三owner独立进程、取消、完整v8仍待验

阶段记录：INTEGRATION INTEGRATION_PENDING；隔离system通过：temp/integration-test-runs/task-processes-2026-10-05T14-23-27-148Z；三个owner测试进程＋真实持久化＋fake外部边界，MCP观察/浏览器媒体/三族取消；Sonora与Scaena提交仍为application入口、非发行daemon。组件task-visibility-2026-10-05T14-23-18-623Z通过；75测试与构建通过；全MCP入口、视频、重启/撤权组合与日常只读仍未完成。

阶段记录：INTEGRATION INTEGRATION_PENDING；增量system通过：temp/integration-test-runs/task-processes-2026-10-05T14-47-07-623Z；新增Scaena canonical run合成视频解码/seek/Range/HEAD、控制中心重启重新登录查原回执、临时observer失效拒绝旧媒体句柄与Sonora断连隔离；仍非全MCP提交/发行daemon/owner执行中重启/Studio联合验收。

阶段记录：FRONTEND INTEGRATION_PENDING；确认时固定revision修复：后台detail刷新不扩大取消确认范围；组件temp/integration-test-runs/task-visibility-2026-10-05T14-56-49-522Z验证版本冲突不执行、丢回包/unknown/requested只查回执、布局与筛选；typecheck/build及75测试通过。
- [ ] 5.1 CONTRACT：用现行证据核对原四阶段并处置旧脚本/Studio历史要求；owner=Control Center；scope=本变更说明与tasks、docs/current-status.md；依赖=1.1、4.1；lane=串行；验证=openspec validate yeisme-task-visibility-v1 --strict；预期=保留历史记录，旧Studio不复活；已实现仅凭对应证据经CLI结项，不批量mark；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
