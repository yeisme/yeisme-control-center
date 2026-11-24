# 实施与验收任务

由 scripts/openspec-tasks.py 维护状态。

- [x] 1.1 CONTRACT 冻结 Gateway/Skill/模板 body-free DTO 与状态；owner=control-center；依赖=无；验证=openspec validate --strict；失败=保持 needs_contract | evidence: local contract slice: shared DTO + Vitest + typecheck
- [x] 2.1 BACKEND 实现安全 manifest/catalog normalization 与推荐纯函数；owner=control-center；依赖=1.1；验证=focused Vitest；失败=fail closed | evidence: local contract slice: shared DTO + Vitest + typecheck
- [x] 3.1 FRONTEND 接入 Gateway 诊断与 Skills/模板推荐入口；owner=control-center；依赖=1.1,2.1；验证=typecheck + focused UI tests；失败=不显示执行能力 | evidence: local contract slice: shared DTO + Vitest + typecheck
- [ ] 4.1 INTEGRATION 接入 owner 合同后再做只读 catalog/updates；owner=control-center；依赖=owner handoff；验证=contract integration；失败=保持 needs_contract
- [x] 5.1 FRONTEND 资产 preflight 与版本固定选择；owner=control-center；依赖=2.1,4.1；验证=browser journey；失败=不触发 Provider | evidence: 2026-11-13: AssetPreflightPanel in CapabilityHub.tsx + tests/skill-template-experience.test.ts 5/5 + test:browser-journey #/capabilities passed (provider_calls=0, needs_contract)
- [ ] 6.1 INTEGRATION 完整回归与真实只读验收；owner=control-center；依赖=3.1,4.1,5.1；验证=local gates + live read；失败=分类记录
