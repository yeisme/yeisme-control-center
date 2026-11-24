# Spec: 控制中心 DEK action_id 统一投影

## ADDED Requirements

### Requirement: 跨 Owner 运行引用按 action_id + event_cursor 去重

系统 MUST 支持把 Eikona `run_id`、Scaena `submission_ref` 与控制中心 `revision` 关联到同一 `action_id`，并按 `(action_id, event_cursor)` 去重保留最新观测状态。

#### Scenario: 同一 action_id 的重复或乱序游标事件收敛

- **WHEN** `dedupeWorkQueueByActionCursor` 收到同一 `action_id` 的旧游标与新游标记录
- **THEN** MUST 只保留一条高游标记录并保留 `eikona_run_ref` / `scaena_submission_ref` / `control_center_revision` 关联

### Requirement: 四级完成状态严格分离

系统 MUST 在 `yeisme.creative_flow.v1` 投影上显式分离 `ACCEPTED`、`COMPLETED`、`BOUND`、`REVIEWED` 四级里程碑；Preview 模式 MUST 固定 `preview_owner_written=false` 与 `production_ready=false`。

#### Scenario: ACCEPTED 不得冒充 COMPLETED 或 REVIEWED

- **WHEN** 某条 `action_id` 仅处于 `ACCEPTED` 状态且无权威 `readback_ref`
- **THEN** `COMPLETED`、`BOUND`、`REVIEWED` 里程碑 MUST 保持 `false`
