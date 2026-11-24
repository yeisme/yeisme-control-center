## Why

根变更 `drama-process-timing-observability-v1` 让 Scaena、Auctra 和 Eikona 在任务观察里输出 `yeisme.process_timing.v1`，但控制中心在解析任务时把 `timing` 丢掉了，做剧页面也没有任何耗时展示，所以回答不了「做一部剧花了多久」。

## What Changes

- 任务观察解析时保留 `timing`。只保留 run 和父 run 引用、阶段、操作、13 种状态之一、起止时间、五类时长、心跳、停滞阈值和重试数；不转发事件、摘要或证据引用。时长不是非负整数时记为 null，不当成 0。
- 新增纯函数模块 `src/shared/production-time.ts`，在读取时汇总：
  - 根 run 的总时长；
  - 执行、排队、受阻、等人四类时长，以及未细分的部分；
  - 重试、运行中、停滞和等人的数量；
  - 带计时的覆盖数。
  运行中的 run 只增长到最新一次读取的时刻。
- 制作线的每个站带上 `time`，整条线带上 `line.time`（缓存键升到 `production_line.v3`）。故事、设定和分镜三站标为 `needs_contract`。
- 单集工作台、工位卡、工位面板、剧集列表页和项目「制作」页增加耗时展示（见 design）。
- 解析 Scaena 按集制作摘要中的 `timing`，作为整集合计单独显示，不与读取时的合计相加。

## Capabilities

### New Capabilities

- `production-time`：制作耗时的读取、汇总和展示。

## Impact

- 本客户端：`src/`、`server/task-connections.ts`、`server/production.ts`、`scripts/fixtures/`、`tests/`、`docs/`。不新增表、迁移、动作、权限或依赖。
- Scaena：本地变更 `scaena-control-center-production-timing-observation-v1`，未部署。
