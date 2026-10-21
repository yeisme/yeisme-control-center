# 日常管理交付

- [x] 1.1 CONTRACT：主原型、本地基线与全部现存服务目录；scope=src/service-directory.ts、docs/daily-management-baseline.md；依赖=无；验证=bun scripts/daily-management-spec.ts generate；预期=目录与文档一致，退役项目不登记；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查
- [x] 2.1 CONTRACT：个人身份、目录和交付边界；scope=server/contracts.ts、src/service-directory.ts、此变更；依赖=1.1；验证=openspec validate yeisme-personal-daily-management-v1 --strict；预期=合同完整，无 owner 越权；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查
- [x] 3.1 BACKEND：用户名、角色、受控目录与健康；scope=server/、scripts/personal-config.ts、tests/相关测试；依赖=2.1；验证=bun run test -- tests/personal-auth.test.ts tests/service-directory.test.ts；预期=成功、拒绝及兼容用例通过；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查
- [x] 4.1 FRONTEND：真实登录、全服务目录、设置与工作区；scope=src/相关组件、tests/相关测试；依赖=2.1；验证=bun run typecheck 及隔离浏览器验证；预期=六入口、异常状态和响应式可用；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查
- [ ] 5.1 INTEGRATION：核心三服务真实只读；scope=独立运行配置与脱敏证据；依赖=3.1、4.1及合法 observer；验证=受限能力、原任务、原结果读取；预期=三服务分别有真实证据，不付费、不发真实取消；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查 | evidence: partial real-owner-read evidence: Eikona and Sonora task/detail/events read; Scaena connection read passed but no observed task, so task/result coverage remains INTEGRATION_PENDING
- [ ] 6.1 INTEGRATION：最终质量和安全；scope=本项目测试入口；依赖=5.1；验证=bun run typecheck && bun run test && bun run build 及目标浏览器链路；预期=无新增失败，证据六件套齐全，不运行 race；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查 | evidence: local gates passed (typecheck, 22 files/141 tests, build, test:app, test:ci:browser, contract-integration 20/20, browser-journey 16/16, server-boot 6/6, motion 0 warnings, public-surface 0 findings); final task remains pending until 5.1 real-owner evidence is complete
- [ ] 7.1 INTEGRATION：configured internal origin 交付与运行说明；scope=控制中心专属运行环境及docs；依赖=6.1、部署准入与凭据安全初始化；验证=HTTPS、登录、核心读取、重启恢复；预期=实际可访问，停止不影响 owner；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查

使用 bun scripts/daily-management-spec.ts mark <编号> <证据引用> 更新，不手改状态。

验证 1.1：docs/daily-management-baseline.md

验证 2.1：src/service-directory.ts; server/contracts.ts; openspec strict validation passed

验证 3.1：temp/integration-test-runs/daily-backend-2026-10-07T16-22-09-863Z/summary.json

验证 4.1：temp/integration-test-runs/daily-frontend-2026-10-07T16-38-19-817Z/summary.json

阶段记录：INTEGRATION INTEGRATION_PENDING；本地门禁、前端与 fake MCP 组件验证见 docs/daily-management-delivery.md；真实 observer、部署准入与 TLS 尚缺，5.1/6.1/7.1 不标完成。

阶段记录：INTEGRATION INTEGRATION_PENDING；控制中心专项部署准入已获用户确认；真实HTTPS/登录/重启通过，证据=lan-2026-10-08T07-29-22-153Z；三owner旧运行版本与独立observer尚缺，完整5.1/6.1/7.1仍未完成。
