# 任务清单

- [x] 1.1 `@domain:frontend` `@serial` `@owner:control-center` 在 `src/shared/dek-action-projection.ts` 实现 `mapOwnerRefToActionProjection`、`dedupeWorkQueueByActionCursor` 与 `projectCreativeFlowCompletionMilestones`。
- [x] 1.2 `@domain:frontend` `@serial` `@after:1.1` `@gate:bun test tests/dek-action-projection.test.ts && bun run typecheck` 编写 `tests/dek-action-projection.test.ts` 并通过类型检查与单测。
