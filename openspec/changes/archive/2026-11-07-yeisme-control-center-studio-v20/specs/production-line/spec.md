## ADDED Requirements

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
