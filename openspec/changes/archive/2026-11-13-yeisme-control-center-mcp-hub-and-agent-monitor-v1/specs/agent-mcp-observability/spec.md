## ADDED Requirements

### Requirement: 底层 MCP 工作态势与跨项目 Agent 实时监控台
控制中心 SHALL 在「动态」入口下提供 `agents` 页面（`#/agents`），展示活跃 Agent 会话、底层 MCP 遥测（网关代理开销 vs 上游执行延迟、后端探针、缓存新鲜度、stdio 子进程监管状态）以及 MCP 调用与领域任务的关联时间轴。

#### Scenario: 同源 SSE 实时更新与有界轮询自动降级
- **WHEN** 用户在前台打开 `#/agents`
- **THEN** 页面优先连接同源 `/api/control-center/v1/agent-monitor/stream` 接收增量状态推送
- **AND** 当上游不支持流或连接中断时，前端自动切换为 12 秒有界轮询并明确显示当前刷新模式，不丢失已有快照

#### Scenario: MCP 调用确定性跳转下游领域任务
- **WHEN** 一条网关 MCP 调用 `call_ref` 与当前授权范围内某条 Eikona、Scaena、Sonora、Anatomia 任务或 DriveBridge 操作的 `origin_refs.gateway_call_ref` 精确匹配
- **THEN** 调用行与右侧检查器 SHALL 显示关联的下游任务状态徽标并提供直达该任务详情的深链
- **AND** 无精确引用匹配的记录 SHALL 独立展示，禁止按相近时间戳猜测关联

#### Scenario: 结果未知调用禁止重发
- **WHEN** 某条 MCP 调用或网关管理操作处于 `unknown` 状态
- **THEN** 界面 SHALL 醒目提示先回查原 `call_ref` 与下游任务状态，不提供重试或重新执行按钮
