# yeisme-control-center-production-time-v1

Yeisme Studio v25 让做剧页面能回答「做这一集、这部剧花了多久」：

- **数据**：任务观察带上各工具自己的 `yeisme.process_timing.v1` 记录（只取引用、状态、起止时间和五类时长），读取时相加。不新增表，没有人工计时器，也不从创建或更新时间推算耗时。
- **单集工作台**：头部有一行「已计时 …」；新增「耗时」面板，放指标条、各站分段条（同一刻度）、Scaena 整集合计以及图/表切换。运行中的任务每秒走一次，标签页隐藏时暂停。
- **工位**：卡片上有 6px 分段条；工位面板新增「耗时」分区，列出最慢的任务。
- **剧集列表页、项目「制作」页**：「做到现在花了 …」面板，按集排列（可点进单集），另有「未标注剧集」行和最慢的三个站。
- **Scaena 整集合计**：读 Scaena 按集制作摘要的 `timing`（本地变更 `scaena-control-center-production-timing-observation-v1`，未部署）。没有这个字段时显示「待接通」，并且不与任务相加的结果合并。

- 设计文档：[docs/design/studio-v25.md](../../../docs/design/studio-v25.md)
- 上一版：[yeisme-control-center-studio-v24](../yeisme-control-center-studio-v24/README.md)
- 计时契约：根变更 `drama-process-timing-observability-v1`（只引用，不修改）
