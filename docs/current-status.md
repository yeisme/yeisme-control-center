# 当前实现状态

本表是控制中心公开仓库的唯一状态摘要。`implemented` 只表示本地代码和合同已存在；`fixture-only` 不代表真实服务；`blocked` 必须保留阻塞原因。

| 能力 | 状态 | 证据层 | 下一道门 |
|---|---|---|---|
| Yeisme Workspace v18.1 live 客户端 | `implemented` | 根入口、类型、单元、构建和真实只读预览 | browser CI |
| v18 演示写操作 | `fixture-only` | loopback 内存 demo API | 不升级为生产写入 |
| v18 live 读取 | `implemented` | live API adapter；三 owner 真实只读证据已生成 | 继续补齐 owner 任务覆盖并保持 live submit 关闭 |
| Eikona canary | `passed` | 已有脱敏 canary 记录 | 复验当前版本 |
| Scaena live | `blocked: InvalidApiKey` | Provider 返回错误 | owner 修复凭据 |
| Sonora live | `blocked: downstream credential missing` | Provider 诊断 | owner 补齐凭据 |
| 三 owner task observation | `passed: real read-only` | loopback Control Center + current owner endpoints；active=0、history=45；Eikona detail/events/artifact 通过，Sonora detail/events 通过但 artifact 被 `content_not_authorized` 拒绝，Scaena 当前无任务可供 detail/events 复验 | 保持 submit/cancel 关闭；补充 Scaena 真实任务或 owner 明确的空任务证据 |
| 26 项服务目录 | `3 connected, 23 not_integrated` | 本地目录 | owner 合同逐项验收 |
| 部署交付 | `candidate only` | 候选构建与组件验证 | HTTPS 目标、回滚和人工授权 |
| Provider live submit | `disabled by default` | action manifest 与预算门 | 三 owner live gate |

## 证据边界

- transport ready、配置存在或 `tools/list` 成功不等于业务 ready。
- fixture、fake MCP、浏览器 mock 只证明客户端行为和合同边界。
- unknown 结果只能查询原引用，不得自动重新提交。
- 真实 Provider canary、owner 凭据、部署和发布是独立授权门。
- 最近一次真实只读证据由 `bun run test:owner-live-read` 生成，保存在 `temp/integration-test-runs/real-owner-read-*/`；证据不包含凭据、Provider payload 或真实提交。
- race 检测不属于本项目默认验收。
