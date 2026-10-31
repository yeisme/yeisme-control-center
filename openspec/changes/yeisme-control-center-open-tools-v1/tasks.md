# Tasks

## 1. 读取层

- [x] 1.1 `ServerConfig.open_tools` 与 `ScopeBinding.open_tools`；地址校验抽成 `endpointURL`，与任务连接共用
- [x] 1.2 `server/open-tools/types.ts`：固定 GET、5 秒超时、拒绝重定向、1 MiB 上限、0600 凭据；拒绝码映射，不透传 owner 文本
- [x] 1.3 `server/open-tools/service.ts`：按工具缓存（DriveBridge 120 秒，因为每次鉴权调用都写审计行；Gateway 60 秒）、并发共享、强刷 15 秒节流、读不到时保留上次读数并标过期
- [x] 1.4 DriveBridge 适配：公开的 `/healthz` 不带凭据；`/api/v1/capabilities` 只留接口版本、分块与单文件上限；`/api/v1/operations?limit=50` 按真实状态与类型词表映射，错误只留 snake_case 码；未带 `--enabled` 时写明原因
- [x] 1.5 Gateway 适配：`/readyz`（未就绪时读出失败的后端）、`/v1/tenants/current`（没绑工作区时写明）、`/v1/backends`、`/v1/tools`、`/v1/operations`、`/v1/usage?group_by=backend`；不读 `/healthz`（本地文件路径）与 `/v1/runtime/state`（进程信息）；丢弃后端地址、`last_error`、缺失的环境变量名与运行结果

## 2. 读模型与界面

- [x] 2.1 `yeisme.open_tool_projection.v1`（`src/shared/open-tools.ts`）与标签
- [x] 2.2 服务目录：接入类型“运行投影”，只对个人会话附上读数；服务页“开放工具”卡片
- [x] 2.3 工作台：`operation_failure` 队列项（每个工具最多 10 条，未识别的状态不提）、工具读不到或后端不可用时“来源受阻”、来源覆盖与“服务状态”列出开放工具
- [x] 2.4 工具目录：配置 Gateway 后用它的工具取代占位卡，并记入变化账本；owner 筛选加入 MCP Gateway
- [x] 2.5 `personal-config open-tool` 与 `open-tool <tool> off`；`status` 不报地址与凭据

## 3. 验证

- [x] 3.1 单元测试：`tests/open-tools.test.ts`（映射与丢弃、拒绝码、凭据权限、地址、缓存与过期、工作台、服务目录、工具目录）、`tests/personal-config.test.ts`
- [x] 3.2 fixture：假 DriveBridge 与假 Gateway（`scripts/fixtures/fake-open-tools.ts`），fixture 预览与合同集成都接上；合同集成新增三项
- [x] 3.3 浏览器旅程：服务页开放工具卡片、工具目录按 Gateway 筛选、工作台行与来源覆盖（71/71）；全量单元测试 493 项、类型检查、构建、CI 浏览器、合同集成 38/38、启动检查 7/7、公开面扫描 0 项
- [x] 3.4 使用指南：“接入”章“更多工具”写 DriveBridge 与 MCP Gateway 的只读凭据签发与登记（只用占位符）；公开指南 12/12
- [ ] 3.5 真实环境：MCP Gateway 已接入（2026-10-31，经用户授权；个人网关没有配置管理令牌，改由属主管理凭据走 Action plan 并经属主确认签发普通凭据，仅 `mcp:discover`、`mcp:tools:read`，30 天，绑定 agent 共享工作区；私有实例只读核对：就绪、3 个后端可用、工具进目录、用量显示“未授权”；随后写入真实配置并重启）。DriveBridge 未完成：服务治理开启时，运维命令 `agents create` 以空间属主的身份签发，但属主是密钥用户、没有用户记录，被判为 `forbidden`（两次各停服约 2 秒，服务已恢复）；需属主用自己的用户密钥调 `POST /api/v1/agents`，或由 DriveBridge 修复运维签发路径
