## Why

控制中心（`client/yeisme-control-center`）目前仅通过 `open-tools/gateway.ts` 读取个人 MCP Gateway 的简版健康和 REST 操作计数，既无法像 MCPHub 那样对网关后端、逻辑分组、工具暴露、多客户端接入预设、受管消费者凭据和待决人工审批进行直观管理，也看不到底层 MCP 协议延迟拆分、stdio 进程监管和活跃 Agent 会话，且动态时间线因缺少类型化 `actor_type="agent"` 与 `gateway_call_ref` 关联，无法呈现 Agent 在跨项目工具链中的真实工作轨迹。

## What Changes

- **融入 Studio v20/v21 五入口导航**：
  - 「我的」入口新增子页 **MCP 网关（`#/mcp-gateway`）**：提供概览指标（含 Standard/Compact Token 足迹对比）、后端与 stdio 监管列表、逻辑分组与 `export_profile`、工具暴露勾选、多客户端配置片段一键复制、受管消费者凭据签发/吊销、人工审批与 `config_revisions` 版本回滚。
  - 「动态」入口新增子页 **Agent 与 MCP（`#/agents`）**：采用同源 SSE + 12s 有界轮询降级，实时展示活跃 Agent 会话、底层 MCP 运行态势（网关附加延迟 vs 上游延迟、缓存与 stdio 进程健康）、MCP 调用与下游领域任务（Eikona / Scaena / Sonora / Auctra / Anatomia / DriveBridge）的全链路关联时间轴。
  - 既有「动态 → 时间线（`#/activity`）」「今天（`#/home`）」「服务与连接（`#/services`）」与 `⌘K` 全局搜索协同展示类型化 `Agent` 发起方与待决网关审批。
- **网关双凭据读写分离与受控 `ActionService` 扩展**：
  - `open_tools.gateway` 新增可选 `management_credential_ref`（槽位 `open_tool:gateway:management`）；未配置或 `viewer` 角色下所有写控件解释性只读。
  - `ActionService` 新增 10 个 `owner: "gateway"` 受控动作，严格经由 `Preview（Gateway Plan + Diff + expected_revision） -> Confirm（幂等 Apply） -> Receipt` 执行，严禁编辑后端命令、URL 或暴露明文密钥。

## Capabilities

### New Capabilities
- `personal-mcp-hub`: 控制中心内个人 MCP Gateway 受控读写管理台、分组/暴露控制、多客户端预设复制与凭据生命周期管理。
- `agent-mcp-observability`: 底层 MCP 协议/stdio 遥测、活跃 Agent 会话、同源 SSE + 轮询降级以及跨项目调用—任务确定性关联监控。

### Modified Capabilities
- `control-center-frontend-backend`: 登记 `open_tool:gateway:management` 凭据槽位与网关同源 BFF 读写/SSE 边界。
- `core-service-observation`: 接收并展示下游任务观察中的类型化 `actor_type: "agent"` 与 `origin_refs.gateway_call_ref`。
- `tool-catalog`: 将网关分组、工具暴露状态与 Compact Token 节省信息联动到目录检查器。

## Impact

仅修改本仓库 `src/`、`server/`、`scripts/`、`tests/` 与 `docs/`。严守保护工作区中他人未提交改动（不动提示词库、迁移 `0012`、`docs/live-read-integration.md`、`RequestDetail.tsx`）。不签发真实线上凭据、不付费、不部署、不运行 `-race`。
