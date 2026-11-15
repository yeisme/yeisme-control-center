## Why
制作线的设定站和成片站一直写死「待接通」：参考、剪辑、审阅、交付的状态没有来源；Eikona 和 Sonora 的任务也对不上集。Scaena 制作中心其实已经按集存了绑定、派发、审阅和合成预览，只是没有给观察者读。Scaena 本地新增了只读操作 `control_center.production.episodes`（变更 `scaena-control-center-episode-production-observation-v1`），控制中心需要消费它。

## What Changes
- 新增读取器：通过范围内已有的 Scaena 任务连接（观察者 Key）调用 `control_center.production.episodes`，校验模式与集引用，清洗引用、限制数组，按范围缓存 45 秒。
- 新增 `GET /episode-production`；`GET /production` 的单集范围也读它；剧集工作室把它交给制作线。
- 制作线：
  - 设定站：Scaena 参考库有读数时显示项目级可用参考数，并标明「按整个项目统计」；
  - 成片站：剪辑、审阅、合成预览有记录就显示记录与计数；交付仍是「交付状态待接通」；还有缺口时成片站保持「只读到一部分」；
  - 集关联：任务的 `owner_episode_ref` 或任务引用等于 Scaena 为这一集记录的同一 owner 绑定时，算进这一集，并标「由 Scaena 记录的派发关联」。
- owner 没有这个操作（`UNKNOWN_ACTION`）、拒绝、或返回内容对不上时，一律如实显示「待接通」或「读不到」，不推断；对这个操作的拒绝 MUST NOT 让连接的任务读取被判成未授权。

## Capabilities
### New Capabilities
- production-line: 制作线消费 Scaena 按集制作摘要。

## Impact
- 只读；不新增凭据、不复用 Agent 管理 Key、不写 owner、不部署。
- 部署版 Scaena 还没有这个操作，真实环境里会显示「Scaena 尚未提供这一集的制作摘要」。
- 不包含：交付与集的关联、从控制中心做审阅或交付、Eikona/Scaena 运行上的 `episode_ref`、操作人类型（归 attribution 变更）。
