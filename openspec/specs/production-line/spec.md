# production-line Specification

## Purpose
TBD - created by archiving change yeisme-control-center-episode-production-observation-v1. Update Purpose after archive.
## Requirements
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

### Requirement: 七站制作线投影
控制中心 SHALL 用同一个构建函数产出 `yeisme.production_line.v1`，按顺序包含故事、设定、分镜、画面、动态、声音、成片 7 站；每站 MUST 给出状态、计数、至多 6 个结果引用、等人的决定与下一步，并标明归属工具。

#### Scenario: 一集的制作线
- **WHEN** 用户打开某集的剧集工作室
- **THEN** 页面按 7 站显示，故事与分镜来自创作流阶段，画面、动态、声音、成片来自该集匹配到的任务观察

### Requirement: 状态如实
站点状态 SHALL 取 `observed`、`partial`、`empty`、`unconnected`、`needs_contract`、`unavailable` 之一。只有来源可读且确实没有数据时才是 `empty`；owner 没有合同时 MUST 为 `needs_contract`，范围未配置或未绑定时 MUST 为 `unconnected`，读不到时 MUST 为 `unavailable`。缺失 MUST NOT 被写成 0 或成功。

#### Scenario: 设定与剪辑
- **WHEN** 参考绑定接口返回 `needs_contract`，且没有剪辑与交付合同
- **THEN** 设定站为 `needs_contract`，成片站标明拉片质检的读数，并把剪辑与交付列为 `needs_contract`

#### Scenario: 来源读不到
- **WHEN** Auctra 与 Scaena 返回 503
- **THEN** 故事站与分镜站为 `unavailable`，而不是 `empty`

### Requirement: 剧集与项目两种范围
制作线 SHALL 支持 `episode` 与 `project` 两种范围。剧集范围按 Auctra 与 Scaena 的剧集引用精确匹配任务；项目范围包含范围内的全部任务。剧集范围里无法匹配的任务 MUST NOT 被算进该集。

#### Scenario: 任务没有剧集引用
- **WHEN** 范围内的任务都没有 `episode_ref`
- **THEN** 项目范围的画面、动态、声音、成片站显示这些任务，任何剧集范围的这些站都不显示它们

### Requirement: 任务来源是否读到
任务四站（画面、动态、声音、成片）SHALL 按各自工具的连接状态判断能不能读：任务读取返回了行或逐连接的覆盖情况，就算来源已回答，某个工具的连接被拒只让它自己的站为 `unavailable`。只有读取既没有行也没有覆盖、且处于失败状态时，四站才 MUST 一起为 `unavailable`，并带上原因；会话没有个人任务连接时原因 MUST 为 `personal_connection_required`。来源没回答时 MUST NOT 给出「这一集没标集的任务数」。

#### Scenario: 一个连接被拒
- **WHEN** Eikona 的连接返回 `forbidden`，其余工具可读且没有任务
- **THEN** 画面站为 `unavailable`，动态站为 `empty`

#### Scenario: 没有个人任务连接的会话
- **WHEN** 一个没有个人任务连接的会话读取 `/production`
- **THEN** 任务四站为 `unavailable`，原因 `personal_connection_required`；故事站与分镜站照常读取

### Requirement: 已读到的剧集不丢
项目范围里，剧集来源后来失去连接时，已经读到的剧集 SHALL 继续计入故事站与分镜站，站点状态 MUST 为 `partial` 并带上连接原因；只有一集也没读到时才 MAY 为 `unconnected`。

#### Scenario: 凭据过期前读过
- **WHEN** Auctra 已没有可用委托凭据，但有一集的创作流此前已经读到
- **THEN** 故事站为 `partial`，原因 `delegation_unavailable`，计数为 1

### Requirement: 只读接口与人机同源
`GET /api/control-center/v1/production` SHALL 用同一个构建函数返回制作线，可选 `episode_ref`；它 MUST 只读，按会话、epoch、范围与范围键缓存不超过 15 秒，并 MUST NOT 包含动作摘要、提示词、`content_ref`、`representation_ref`、`media_type` 或凭据。

#### Scenario: Agent 读取
- **WHEN** 已登录的只读会话请求 `/production?scope=…&episode_ref=ep-01`
- **THEN** 返回 7 站与页面「复制 JSON」一致的站点状态，不包含上述禁止字段

### Requirement: 镜头画面状态只给状态
outline 中的镜头 SHALL 可以携带 `frame_state`（由 Scaena 拆解项 `media[].status` 按镜头归并）与 `generation_ready`；没有 `media` 时 `frame_state` MUST 缺省。绑定的引用、类型、摘要与内容 MUST NOT 出现在任何响应中。

#### Scenario: 有绑定的拆解
- **WHEN** Scaena 拆解项为每个镜头返回一条 ready 的 `media`
- **THEN** 镜头板显示「画面已绑定」，响应中没有 `content_ref`、`representation_ref` 与 `media_type`

