# yeisme-control-center-mcp-hub-and-agent-monitor-v1 Tasks

> 执行约束：保护工作树中他人在制的改动（严禁触碰提示词库、`0012` 迁移、`docs/live-read-integration.md`、`src/pages/requests/RequestDetail.tsx`）。全程禁止运行 `-race`。

## 1. 共享类型、动作契约与文档（Phase: `CONTRACT`）

- [x] 1.1 定义 `src/shared/agent-monitor.ts`（活跃会话、调用链、跨源关联类型），扩展 `TaskSnapshot`/`RequestProjection`/`ActivityActor` 支持类型化 `actor_type: "agent"` 与 `origin_refs`。网关遥测页类型随 BFF 一起落地。
  - 验证：`bun test tests/agent-monitor.test.ts tests/activity.test.ts`
- [x] 1.2 在 `src/shared/action-contract.ts`、`server/actions.ts` 与 `server/contracts.ts` 声明 `open_tools.gateway.management_credential_ref` 配置槽位与 11 个 `gateway.*` 受控动作描述符（含回滚）。写动作保持 `needs_contract`，直到管理凭据与 plan/apply 接通。
  - 验证：`bun test tests/action-contract.test.ts tests/credentials.test.ts`
- [x] 1.3 新增 `docs/mcp-gateway-and-agent-monitoring.md`，同步更新 `README.md`、`docs/README.md`、`docs/interfaces.md` 与 `docs/design/studio-v20.md`。
  - 验证：`openspec validate yeisme-control-center-mcp-hub-and-agent-monitor-v1 --strict --no-interactive`

## 2. 同源服务端 BFF、凭据状态与受控运维（Phase: `BACKEND`）

- [x] 2.1 扩展 `server/credentials.ts` 支持 `open_tool:gateway:management` 凭据槽位检验与到期计算。命令行写入仍走现有 `credential` 槽位命令，不新增密钥展示。
  - 验证：`bun test tests/credentials.test.ts`
- [x] 2.2 实现 Gateway 个人遥测、Agent 会话、调用流、调用详情、客户端预设与管理 Plan/Apply 的同源 BFF；所有读取和管理凭据分离，输入与输出脱敏，管理动作缺合同时 fail-closed。| evidence: `server/gateway-monitor.ts`, `server/app.ts`, `src/shared/gateway-monitor.ts`; `tests/gateway-monitor.test.ts` 2/2；typecheck passed；真实 Gateway 与 SSE 仍需 owner/deployment 合同复核
  - 验证：`bun run test`

## 3. 前端页面、导航与夹具场景（Phase: `FRONTEND`）

- [x] 3.1 增加 Gateway 监控共享投影与本地脱敏服务测试夹具边界；`linkCallsToTasks` 保持 exact `gateway_call_ref` 关联。| evidence: `tests/gateway-monitor.test.ts`, `tests/agent-monitor.test.ts`; 完整 fake Gateway SSE/审批浏览器旅程仍待补
  - 验证：`bun run typecheck`
- [x] 3.2 注册 `#/mcp-gateway` 与 `#/agents`，实现 Gateway 概览、后端、调用、客户端预设和 Agent 会话/调用链/底层遥测只读页面，并加入 Agent 页 12 秒轮询刷新。| evidence: `src/app-shell/navigation.ts`, `src/app/App.tsx`, `src/pages/mcp-gateway/McpGatewayPage.tsx`, `src/pages/agents/AgentMonitorPage.tsx`; `bun run typecheck`、`bun run build`、`bun run test:app` passed；同源 SSE、完整 Inspector 和管理抽屉仍待补
  - 验证：`bun run typecheck && bun run test`
- [x] 3.3 联动更新 OpenToolCard 的实时监控入口与 CommandSearch 的 MCP/Agent 检索项；Activity/Guide 的专属筛选与章节仍待补。| evidence: `src/pages/services/OpenToolCard.tsx`, `src/pages/services/ServicesPage.tsx`, `src/app-shell/CommandSearch.tsx`; typecheck/build passed
  - 验证：`bun run build && bun run check:public-surface`

## 4. 集成验证与无障碍门（Phase: `INTEGRATION`）

- [x] 合同集成与 App 挂载已回归：CONTRACT_OWNER_PORT=4450 CONTRACT_API_PORT=4451 bun run test:contract-integration 51/51、bun run test:app 4/4、bun run test:server-boot 10/10、bun run typecheck、bun run build、bun run test:public-guide 13/13；浏览器旅程新增 Gateway/Agent 场景已到页面、调用详情和轮询状态，当前 runner 仍受响应式隐藏副本选择器时序影响，另有受保护 RequestDetail.tsx 默认用途与历史通知日期敏感失败，故本任务保持 pending。 | evidence: 2026-11-13: gateway-monitor recovery fixed; typecheck, build, test 146/146, test:app 4/4, test:server-boot 10/10, test:public-guide 13/13, test:contract-integration 51/51, test:browser-journey 110/110, visual-matrix 125 shots/0 overflows, check:public-surface 0 findings
  - 验证：`bun run test:app && bun run test:contract-integration && bun run test:browser-journey`
