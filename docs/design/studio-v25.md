# Yeisme Studio v25 · 制作耗时

- 状态：控制中心已于 2026-11-12 发布到内网（`control-release-2026-11-12T11-54-29-409Z`），源码未提交；Scaena 按集计时仍是本地变更，未部署（`openspec/changes/yeisme-control-center-production-time-v1/`）
- 日期：2026-11-12
- 接续：[v24](studio-v24.md)
- 计时契约：根变更 `drama-process-timing-observability-v1`（`yeisme.process_timing.v1`，只引用，不修改）
- 适用：`client/yeisme-control-center`；Scaena 本地变更 `scaena-control-center-production-timing-observation-v1`

## 0. 一句话

做剧页面能回答「做这一集、这部剧花了多久」。数字只来自各工具自己的计时记录，并写明覆盖了多少任务。

## 1. 原则

1. **只用工具的计时。** 不建表，不做人工计时器，也不用创建或更新时间推算。没有计时就写「没有计时」或「待接通」，不写 0。
2. **说清覆盖范围。** 读取时的合计旁边始终写「x/y 带计时」和「已读任务范围内」。任务页有分页上限，所以这个数不是完整总数。
3. **两层合计不相加。** Scaena 的整集合计覆盖这一集全部派发记录，单独显示并标「Scaena 汇总」；它与读取时的合计口径不同。
4. **颜色之外还有纹理和文字。** 受阻用斜纹，等人用点状；图例写出类别名和数值；条形图带文字说明，另有表格视图。

## 2. 数据链路

```
工具任务观察 .timing (yeisme.process_timing.v1)
  → server/task-connections.ts normalizeProcessTiming（白名单字段；无效时长 → null）
  → src/shared/production-time.ts rollupTime / episodeTimeRows / slowestRuns
  → src/shared/production-line.ts station.time / line.time（缓存键 production_line.v3）
  → src/pages/drama/ProductionTime.tsx

Scaena control_center.production.episodes 行 .timing
  → src/shared/episode-production.ts 解析
  → line.time.owner_total（observed / needs_contract / unavailable）
```

汇总规则：

| 情况 | 做法 |
|---|---|
| 子 run 的时间段完全落在父 run 内 | 算作父 run 的时间，不重复计 |
| run 只是指向上一次尝试（Scaena 的重试） | 单独计时，并记一次重试 |
| 运行中、排队、受阻、等人的 run | 增长到 `as_of`；增长部分按状态归到对应类别 |
| 停滞的 run | 停在工具最后写入的值 |
| 工具没有拆分类别的部分 | 计入「未细分」 |
| 各类加起来超过总时长 | 标记重叠，条形按各类之和绘制 |

`as_of` = max(页面当前时间, 计时任务最新的 `observed_at`)。前端从 `as_of` 起，按「正在增长的 run 数 × 秒」累加，每秒最多刷新一次；标签页隐藏时暂停，回到页面时重新读取。

## 3. 界面

| 位置 | 内容 |
|---|---|
| 单集工作台头部 | 一行「已计时 2 小时 14 分 · 1 个等人确认 · 1 个停滞」，没有计时时写「耗时待接通」 |
| 单集工作台「耗时」面板 | 指标条（累计、执行、排队、受阻、等人、重试）；有计时的站各一行分段条，用同一刻度，点击打开工位；没有计时的站合成一行文字说明原因；「整集合计」写 Scaena 汇总或待接通；图/表切换；图例；样本说明 |
| 工位卡 | 6px 分段条和「1 小时 12 分 · 2/3 带计时」；故事、设定和分镜站写「耗时：…待接通」 |
| 工位面板「耗时」分区 | 分段条、图例、事实格（累计、带计时、重试、在跑、停滞、最早开始）、最慢的 5 个任务（点击打开任务） |
| 剧集列表页、项目「制作」页 | 「做到现在花了 …」；各集按耗时排序，能对应到剧集的行可点进工作台；「未标注剧集」行；最慢的三个站以及主要耗在哪类 |

样本少于 30 个时只写「观察样本 N，仅供参考」，不给百分位。

## 4. 动效

条形只出现一次：透明度加 `scaleX(0.6 → 1)`，从左端展开，时长为 `--dur-page`，逐行错开 30ms，最多错开 8 行。减少动效时只做透明度，时长 120ms。

## 5. Scaena 本地变更

`episode_production_observation` 行新增 `timing`，内容是这一集派发记录的 `DelegationTiming` 投影之和，与任务观察用同一个函数。Scaena 还没有记录受阻和等人时长，所以这两项为 null，`splits_recorded` 为 false，面板据此加一句说明。派发记录超过读取上限时标 `truncated`，界面写「未数全」。

部署前，真实环境的整集合计保持「待接通」。

## 6. 已知限制

- Scaena 的计时是近似值：总时长取更新时间减创建时间，派发的执行时长等于总时长。
- Eikona 和 Sonora 的任务观察还没有计时，它们只计入覆盖数的分母。
- 只有 Scaena 的 `episode_ref` 能把任务归到集；其他工具的任务进「未标注剧集」。
- 故事、设定和分镜站不是由带计时的任务组成，耗时待接通。
