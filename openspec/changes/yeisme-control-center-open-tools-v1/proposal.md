# Yeisme 控制中心：工作台接入 DriveBridge 与个人 MCP Gateway v1

## Why

用户要求继续完善工作台，接入 Anatomia 等常见开放工具（2026-10-30），并选定本轮另接 DriveBridge 与 MCP Gateway。

只读探查：

- **DriveBridge**：服务目录里标为“未接入”。Agent 令牌只能读 `/healthz`、`/api/v1/capabilities` 与 `/api/v1/operations`；令牌最长 30 天，`read` scope 同时覆盖该空间的文件内容。
- **MCP Gateway**：服务目录里标为“未接入”，工具目录里是一张“待合同”占位卡。Gateway 能签发带 scope 的只读令牌；MCP 调用的失败只出现在用量计数里，`/v1/operations` 只记 REST 运行。
- **共同点**：两者都不是任务 owner，没有项目、任务与结果，现有任务观测合同套不上；需要一个只读的“运行投影”。

## What Changes

**配置**：

- `ServerConfig.open_tools.{drivebridge,gateway}`：`endpoint`、`credential_ref`（0600 文件）、`allow_private_http`、`enabled`、`label`。
- `ScopeBinding.open_tools`：哪些范围能看到它们。和任务连接一样，只对个人会话可见。
- `personal-config open-tool <drivebridge|gateway> <endpoint> <凭据文件> [--private-http] [--replace]`，以及 `open-tool <tool> off`；`status` 只报是否就位，不报地址和凭据。

**服务端** `server/open-tools/`：

- 只调用固定的 GET 路由：每次 5 秒超时、拒绝重定向、响应超过 1 MiB 即丢弃；地址校验与任务连接共用 `endpointURL`。
- 拒绝码：401 / 403 → 无权限，404 / 405 → 待补齐接口，429 → 限流，其余 → 不可用。不透传 owner 的错误文本。
- 缓存：每个工具 60 秒，并发请求共享一次读取；强制刷新最多每 15 秒一次；读不到时保留上次读数，标为过期，同时如实写明当前不可用。

**读模型** `yeisme.open_tool_projection.v1`（`src/shared/open-tools.ts`）：

- 状态、各项检查、简短事实（接口版本、分块大小等）。
- 运行：最近的运行，以及近 7 天失败或结果未知的运行；每条只有引用、类型、状态、原状态、时间、大小或进度、错误码。
- Gateway 另有后端（id、命名空间、启用、状态、工具数、检查时间）与用量（调用、失败、p95）。
- 丢弃：路径、文件名、摘要、公开地址、后端地址、`last_error` 文本、缺失的环境变量名、进程信息。

**界面**：

- **服务目录**：新增接入类型“运行投影”。服务页新增“开放工具”卡片：健康检查、事实、后端、用量与最近运行。
- **工作台**：“服务状态”列出开放工具；队列新增“运行失败”（`operation_failure`），工具读不到或后端不可用时进入“来源受阻”；来源覆盖条在配置后显示这两个工具。
- **工具目录**：配置了 Gateway 时，用它列出的工具取代“待合同”占位卡；owner 筛选加入 MCP Gateway。

## Impact

- **服务端**：`server/open-tools/`（新）、`server/contracts.ts`、`server/app.ts`、`server/service-directory.ts`、`server/work-queue.ts`、`server/tool-catalog.ts`、`server/task-connections.ts`（抽出 `endpointURL`）。
- **前端**：`src/shared/open-tools.ts`（新）、`src/service-directory.ts`、`src/shared/work-queue.ts`、`src/pages/services/`、`src/pages/home/`、`src/components/SourceCoverage.tsx`、`src/pages/capabilities/`、标签。
- **脚本与测试**：`scripts/personal-config.ts`、`scripts/fixtures/fake-open-tools.ts`（新）、fixture 预览、合同集成、浏览器旅程；`tests/open-tools.test.ts`（新）、`tests/personal-config.test.ts`。
- 不调用任何工具、不写入、不取消；不发布，真实凭据另行签发。
