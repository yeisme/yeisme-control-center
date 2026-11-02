# 设计

## 数据来源

| Owner | 来源 | 产出 |
|---|---|---|
| 全部 | `initialize` + `tools/list`（跟随 `nextCursor`，最多 5 页） | 服务信息、MCP 工具、注解、输入摘要 |
| Eikona | `eikona://runtime/capabilities`（observer 可读） | 动作、runtime_availability、风险等级 |
| Eikona | `eikona://models/readiness`、`eikona://channels`（需要 provider 连接） | 模型快照、渠道；被拒时 coverage 为 `partial` |
| Sonora | `sonora://capabilities`（`sonora.mcp.discovery.v1`）、`doctor.run`、`credential.status`、`sonora.search` | 动作（lane）、readiness 矩阵、模型与声线 |
| Scaena | `getProjectMediaCapabilities`、`scaena://video-tasks/guide` | binding、`channel.summary.v1`、latest_policy、原生渠道 |

发现阶段只允许以下调用：`initialize`、`tools/list`、`resources/read`，以及 `getProjectMediaCapabilities`、`credential.status`、`doctor.run`、`sonora.search`。其他 `tools/call` 一律在本地拒绝。

## 归一化规则

- **风险等级**：
  - Eikona 依据 `kind`、`side_effects`、`blockers`：generation 为付费外部调用，mutation 为写入，readonly 为只读，`HUMAN_DECISION_REQUIRED` 为人工门。
  - Sonora 依据 lane：readonly 为只读，mutation 为写入，gated 为付费外部调用。
  - Scaena 按 guide v1 动作名固定映射。
  - 词表之外一律为 `unknown`。
- **模型 status**：只接受 owner 声明的 `latest_ready | latest_unverified | unavailable | historical | drifted | unknown_cost`，其余为 `unknown`。
- **错误映射**：401/403 或拒绝类消息为 `forbidden`；资源缺失为 `needs_contract`；超时或 5xx 为 `unavailable`；部分资源不可读为 `partial`。

## 缓存与变化

- 按 owner 缓存发现结果，TTL 60 秒，并发请求复用同一次发现。
- 强制刷新每个 owner 15 秒最多一次。
- 瞬时失败时返回上次成功结果，新鲜度标为 `stale`；对应的 `/capabilities` 行 `supports_live_submit=false`。
- 变化账本只在新鲜、完整读取的条目类型上记录新增、变更和移除；失败或部分读取不记移除。

## 降级

服务端版本没有该路由时（404，或 405 且没有允许方法），页面明确提示，并显示 `/capabilities` 的基础投影，不使用 fixture 补齐。
