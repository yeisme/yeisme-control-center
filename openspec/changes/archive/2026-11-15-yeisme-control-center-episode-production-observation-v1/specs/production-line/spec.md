## ADDED Requirements

### Requirement: 读取 Scaena 按集制作摘要
控制中心 SHALL 通过范围内已有的 Scaena 任务连接调用 `control_center.production.episodes`，只读，按范围与集缓存 45 秒。
- 返回页 MUST 校验模式，且行必须对应所问的集；对不上时 MUST 显示「读不到」，MUST NOT 采用。
- owner 没有这个操作或拒绝它时 MUST 显示「待接通」；这次拒绝 MUST NOT 让同一连接的任务读取变成未授权。
- 没有个人任务连接的会话 MUST 不调用 owner。

#### Scenario: owner 没有这个操作
- **WHEN** Scaena 对这个操作回答 `UNKNOWN_ACTION`
- **THEN** 成片站仍列出剪辑、审阅采用、交付三项待接通，任务读取不受影响

#### Scenario: 拒绝不污染连接
- **WHEN** Scaena 对这个操作回答 FORBIDDEN
- **THEN** 摘要显示「待接通」，随后的任务列表照常读取，连接状态不是「未授权」

### Requirement: 设定站与成片站用 Scaena 的记录
有摘要时，制作线 SHALL：
- 设定站显示项目级可用参考数，并说明按整个项目统计；
- 成片站把 Scaena 记录到的剪辑、审阅、合成预览显示为记录与计数，交付保持「交付状态待接通」；
- 只要还有缺口，成片站 MUST 保持「只读到一部分」；任何地方 MUST NOT 写「已完成闭环」。

#### Scenario: 完整摘要
- **WHEN** Scaena 返回这一集的参考、审阅、剪辑、合成预览都已记录，交付为 `needs_contract`
- **THEN** 设定站显示可用参考数，成片站显示三行「Scaena 记录」，缺口里只剩交付（和 Anatomia 的集关联）

### Requirement: 按 Scaena 绑定关联任务
Eikona 与 Sonora 的任务 SHALL 只在 Scaena 为这一集记录了同一 owner 的绑定、且绑定的 `resource_ref` 等于任务的 `owner_episode_ref` 或任务引用时算进这一集，并标「由 Scaena 记录的派发关联」。没有绑定时 MUST 仍显示「任务和剧集对上」待接通。

#### Scenario: 有绑定
- **WHEN** Scaena 为这一集记录了 Sonora 绑定 `sonora://episodes/e1`，Sonora 有一个任务的 `owner_episode_ref` 正是它
- **THEN** 声音站计入这个任务并显示关联来源；其他 Sonora 任务仍算作没有标注集
