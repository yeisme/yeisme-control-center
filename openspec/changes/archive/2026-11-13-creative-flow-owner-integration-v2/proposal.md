# Proposal

将 Control Center 的剧本到分镜流程切换为真实 Auctra/Scaena owner contract，形成单一只读队列、Inspector lineage 和安全跳转。

## Goals

- 消费 `creative.flow.read` 与严格 `storyboard_workspace_projection.v1`。
- 以 `(scope, project_ref, episode_ref)` 为流程边界，不折叠多个 episode。
- 固定 stage state、coverage、freshness、edges、next_attention 和 safe launch 语义。
- 队列继续只派生注意事项；Notification Ledger 不扩展。

## Non-goals

- 不编辑剧本或分镜。
- 不执行 handoff、Provider、审阅确认、交付或账本写入。
- 不把 collection snapshot 解释为创作流程成功。
