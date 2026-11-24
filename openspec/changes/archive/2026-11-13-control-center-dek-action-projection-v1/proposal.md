# 控制中心 DEK `action_id` 投影与完成分级对齐（D4）

## Why

控制中心目前在 `yeisme.work_queue.v1` 与 `yeisme.creative_flow.v1` 上分别展示来自 Eikona `run_id`、Scaena `submission_ref` 与本地 `revision` 的运行状态，但尚未把三者收敛到统一的 DEK `action_id + event_cursor`，也缺少显式的 `ACCEPTED / COMPLETED / BOUND / REVIEWED` 四级完成投影与预览边界标识（Preview 绝不冒充 Owner 已写入或 `production_ready`）。

## What Changes

- 在 `src/shared/dek-action-projection.ts` 新增纯函数投影与去重器：
  - `deriveControlCenterActionID` / `mapOwnerRefToActionProjection`：把 Eikona `run_id`、Scaena `submission_ref` 与控制中心 `revision` 映射关联到同一 `action_id + event_cursor`；
  - `dedupeWorkQueueByActionCursor`：按 `action_id + event_cursor` 确定性去重并保留更高游标与更高完成等级；
  - `projectCreativeFlowCompletionMilestones`：基于 `yeisme.creative_flow.v1` 五阶段 rail 投影显式分离 `ACCEPTED`、`COMPLETED`、`BOUND`、`REVIEWED` 四级完成态，并强制标记 `preview_owner_written: false`、`production_ready: false`。
- 在 `tests/dek-action-projection.test.ts` 补齐去重、跨 Owner `action_id` 映射、四级完成分级与 Preview 诚实边界测试（不触碰在途修改中的页面与 `server/actions.ts`）。

## Capabilities

### New Capabilities

- `control-center-dek-action-projection`：跨 Eikona/Scaena/ControlCenter 的 `action_id + event_cursor` 投影去重与完成分级对齐。

### Modified Capabilities

- 无。不修改既有 `WorkQueueItem` 或 `CreativeFlowProjection` 字段语义，也不新增伪造写操作。

## Impact

- `src/shared/dek-action-projection.ts`
- `tests/dek-action-projection.test.ts`
