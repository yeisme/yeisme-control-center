# 任务

- [x] 增加共享 task freshness 投影和 15 分钟/2 小时默认阈值。
- [x] 在 owner task projection、任务列表和 Inspector 展示本地 stale/expired 状态。
- [x] 为 liveness 写入 operation 通知并保存直接任务路径。
- [x] 让通知深链在任务不在首批列表时读取原任务并打开 Inspector。
- [x] 区分提示词历史整理未完成与 owner 未配置，并支持按 owner 重试。
- [x] 指南控制中心命令支持 `YEISME_CONTROL_ORIGIN`。
- [x] 完成全量测试、构建、服务启动、合同集成和严格 OpenSpec 验证。 | evidence: bun run typecheck, bun run test, bun run build, bun run test:server-boot, bun run test:contract-integration and openspec validate --all --strict --no-interactive passed
