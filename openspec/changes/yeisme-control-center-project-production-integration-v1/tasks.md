# 实施与验收任务

由 scripts/openspec-tasks.py 维护状态。

- [x] 1.1 CONTRACT 冻结来源绑定/隔离/制作/快照；owner=control-center；依赖=无；验证=openspec validate --strict；失败=检查合同 | evidence: 2026-11-13: specs/project-production-integration/spec.md & design.md frozen; openspec validate --strict passed
- [x] 2.1 BACKEND 隔离配置与只读策略；owner=control-center；依赖=1.1；验证=focused tests；失败=复现隔离边界 | evidence: 2026-11-13: scripts/isolated-read-config.mjs + server/read-only-policy.ts + tests/isolated-read-config.test.ts 5/5 passed
- [x] 3.1 INTEGRATION 真实只读基线；owner=control-center；依赖=2.1；验证=test:owner-live-read；失败=记录权限或来源阻塞 | evidence: 2026-11-13: test:owner-live-read (real-owner-read-2026-11-13T06-43-01-641Z) passed read-only across Eikona/Scaena/Sonora/Anatomia/Gateway/DriveBridge/Auctra
- [x] 4.1 BACKEND collection binding/索引/缓存/Gateway；owner=control-center；依赖=1.1；验证=focused tests；失败=原切片修复 | evidence: 2026-11-13: server/project-collection-routes.ts + tests/project-collection-binding.test.ts 5/5 + tests/gateway-monitor.test.ts 4/4 passed
- [x] 5.1 FRONTEND 来源管理/深链/读取守卫；owner=control-center；依赖=4.1；验证=typecheck/browser；失败=原切片修复 | evidence: 2026-11-13: ProjectCollectionSource.tsx + DramaPage.tsx non-fallback sharedProject guard + verify-collaboration-journey.ts 9/9 passed
- [x] 6.1 INTEGRATION 回归/视觉/真实链路；owner=control-center；依赖=4.1,5.1；验证=local gates + live-read；失败=归类 | evidence: 2026-11-13: full local gates + test:browser-journey 110/110 + test:visual-matrix 125 shots + test:owner-live-read passed; 7.1 deploy remains blocked_by_deploy_authorization
- [ ] 7.1 INTEGRATION 冻结快照/迁移/发布；owner=control-center；依赖=6.1；验证=release component + readback；失败=停止或回滚
