# Tasks

## 1. 授权

- [x] 1.1 `server/app.ts` 的 `authorizeAction`：非协作类动作在 preview 与 confirm 都要求 admin，`admin.*` 另要求个人会话；`POST /provider-runs` 与 reconcile 在读请求体和查运行之前检查 | evidence: 单元 `tests/viewer-authz.test.ts` 4 项通过；把检查改成直接放行后 4 项全部失败（变异检查）
- [x] 1.2 原先用无角色身份执行动作的三个测试（`action-contract`、`project-metadata`、`provider-live`）改为显式 admin，它们测的是功能不是授权 | evidence: `bunx vitest run` 498 项通过
- [x] 1.3 合同集成新增“个人 viewer 可以读，但不能执行管理或付费动作” | evidence: `test:contract-integration` 39/39
- [x] 1.4 `server/contracts.ts` 加 `CredentialLifecycle` 与 `ObservationConfig` 类型，供本轮凭据到期与后台巡检使用，无行为变化 | evidence: `bun run typecheck` 通过
