# 个人 MCP 网关管理与跨项目 Agent 监控设计说明

对应本地 OpenSpec：`openspec/changes/yeisme-control-center-mcp-hub-and-agent-monitor-v1/`。

## 1. 功能定位与导航入口

在保留 Studio v20/v21 五入口 App Shell 的前提下，参考 MCPHub 的控制台与活动监控体验：

- **「我的 → MCP 网关」（`#/mcp-gateway`）**：个人 MCP Gateway 的受控读写管理台，包含概览卡片（后端状态、暴露工具数、Standard vs Compact Schema Token 足迹、成功率与网关附加 p95 延迟）、后端与 stdio 子进程监管列表、逻辑分组与 `export_profile`、工具暴露勾选、多客户端配置片段一键复制（Claude Code、Codex、Cursor、Pi、Cherry Studio、OpenCode、Generic HTTP）、消费者凭据签发/吊销、人工审批与 `config_revisions` 回滚。
- **「动态 → Agent 与 MCP」（`#/agents`）**：底层 MCP 协议/进程态势与跨项目 Agent 实时监控台。展示活跃 Agent 会话、网关代理开销 vs 上游真实执行耗时、后端探针与缓存新鲜度、以及“MCP 调用 ↔ 领域任务（Eikona / Scaena / Sonora / Auctra / Anatomia / DriveBridge）”全链路检查器。
- **「动态 → 时间线」（`#/activity`）**：当任务或请求携带类型化 `actor_type: "agent"` 时真实显示 `发起：Agent · <名称>`，不再猜测或一律归为未知。

## 2. 双凭据槽位与配置命令

控制中心服务端将个人网关的日常观察与管理严格分离：

- `open_tools.gateway.credential_ref`：工作区绑定的普通只读观察凭据（槽位 `open_tool:gateway`）。
- `open_tools.gateway.management_credential_ref`：可选的网关个人管理凭据（`mcp-gateway admin bootstrap` 生成的 `0600` 文件，槽位 `open_tool:gateway:management`）。

通过 `scripts/personal-config.ts` 配置（不接受网页提交密钥或地址）：

```bash
bun scripts/personal-config.ts open-tool <config.json> gateway \
  --endpoint http://127.0.0.1:18787 \
  --key-file /secure/gateway-observer.token \
  --management-key-file /secure/gateway-owner.token \
  --private-http
```

## 3. 同源 BFF 接口与受控 Action 白名单

### 只读与流式路由（`/api/control-center/v1/`）

- `GET /mcp-gateway/overview?scope=<scope>[&refresh=1]`
- `GET /mcp-gateway/presets?scope=<scope>`
- `GET /mcp-gateway/governance?scope=<scope>`（仅 `admin`）
- `GET /agent-monitor/snapshot?scope=<scope>[&window=1h|24h|7d]`
- `GET /agent-monitor/calls/<call_ref>?scope=<scope>`
- `GET /agent-monitor/stream?scope=<scope>[&after_cursor=...]`（同源 SSE，断线或不支持时前端自动降级为 12 秒有界轮询）

### 受控写入动作（`ActionService` · `owner: "gateway"`）

所有动作仅对 `admin` 且已配置 `management_credential_ref` 开放，严格执行 `Preview（Gateway Plan + Diff + expected_revision） -> Confirm（幂等 Apply） -> Receipt`：

- `gateway.backend.enable` / `gateway.backend.disable`
- `gateway.backend.exposure.patch`（仅允许 `description`、`timeoutSeconds`、`restartPolicy`、`idleSeconds`、`gateway.{namespace,exposeTools,hideTools,groupIds}`；拒绝修改 `url`、`command`、`args`、`workDir`、`headers`、`env`）
- `gateway.group.profile.upsert`
- `gateway.tools.refresh` / `gateway.runtime.reload`
- `gateway.client.mode.set`
- `gateway.approval.decide`
- `gateway.token.issue`（仅写入主机受管目录的新 `0600` 文件，网页零明文密钥）/ `gateway.token.revoke`
- `gateway.config.rollback`
