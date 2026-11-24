## ADDED Requirements

### Requirement: 计时原样保留
控制中心 SHALL 在任务观察中保留工具发来的 `yeisme.process_timing.v1` 记录，只保留引用、状态、起止时间、五类时长、心跳、停滞阈值和重试数。控制中心 MUST NOT 转发事件、摘要或证据引用；不是非负整数的时长 MUST 记为 null，不得当成 0。

#### Scenario: 时长无效
- **WHEN** 工具发来的 `queue_duration_ms` 是字符串或负数
- **THEN** 这一项为 null，其余字段照常保留

### Requirement: 不另建计时器
控制中心 MUST NOT 为制作耗时新建表或人工计时器，也 MUST NOT 用任务的创建或更新时间推算耗时。

#### Scenario: 任务都没带计时
- **WHEN** 某个范围内的任务都没有 `timing`
- **THEN** 耗时显示为没有计时或待接通，合计为 null，不显示 0

### Requirement: 合计说明覆盖范围
读取时的合计 SHALL 写明带计时的任务数和读到的任务总数，并标「已读任务范围内」。父 run 时间段内的子 run MUST NOT 重复累加。

#### Scenario: 一部分任务带计时
- **WHEN** 读到 138 个任务，其中 3 个带计时
- **THEN** 合计旁边显示「3/138 带计时」

### Requirement: 整集合计来自 Scaena
单集工作台 SHALL 单独显示 Scaena 按集制作摘要里的 `timing`，并标为「Scaena 汇总」。摘要没有 `timing` 时 SHALL 显示「待接通」。整集合计 MUST NOT 与读取时的合计相加。

#### Scenario: Scaena 未部署按集计时
- **WHEN** Scaena 的按集摘要没有 `timing`
- **THEN** 「整集合计」显示「待接通（Scaena 按集计时汇总）」

### Requirement: 剧集归属
项目耗时面板 SHALL 只按 Scaena 的 `episode_ref` 把任务归到集。没有这个引用的任务 SHALL 放进「未标注剧集」。能对应到剧集列表的行 SHALL 可以点进该集的工作台。

#### Scenario: Sonora 任务只带自己的集引用
- **WHEN** 一个 Sonora 任务带 `owner_episode_ref` 但没有 `episode_ref`
- **THEN** 它计入「未标注剧集」

### Requirement: 可访问的图表
耗时条形图 SHALL 用颜色和纹理两种方式区分类别，并带有完整的文字说明和可切换的表格视图。运行中的合计 SHALL 每秒最多刷新一次，并且 MUST 在标签页隐藏时暂停。

#### Scenario: 切换到表格
- **WHEN** 用户在耗时面板里选「表」
- **THEN** 每一行以表格列出累计、执行、排队、受阻、等人、未细分和带计时数
