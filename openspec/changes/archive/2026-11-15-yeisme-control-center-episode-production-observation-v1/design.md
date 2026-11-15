## 数据来源
`control_center.production.episodes` 返回 `yeisme.episode_production_observation.v1`：每行是一集的引用、版本、owner 绑定（含派发项按状态计数）和五节状态（references、review、edit、assembly、delivery），每节是 `observed | needs_contract | unavailable` 加原因、状态和计数。没有标题、提示词、正文、媒体地址或金额。

## 调用路径
- 走 `TaskConnections.call`，与任务读取同一个 MCP 会话、同一把观察者 Key；Scaena 侧按观察者白名单与项目范围检查。
- 参数：`episode` 取工作室已知的 Scaena 制作集引用，没有就用集引用；`limit=1`。
- 对这个操作的 FORBIDDEN 一类拒绝映射为 `needs_contract`，不写入连接的拒绝集合，免得一次拒绝让任务读取全部变成「未授权」。

## 校验
- `schema_version` 必须相符，行的 `episode_ref` 或 `production_episode_ref` 必须等于所问的集，否则整页视为对不上，显示「工具返回的内容对不上约定」。
- 引用最长 256 字符、不含空白与控制字符；计数键限 `[a-z0-9_:.-]`、最多 32 个；计数必须是非负整数；owner 最多 50 个。

## 制作线规则
- 设定站：references 节 observed 时，可用数 = total − disabled，原因标 `project_scope`；否则沿用旧的参考输入，再退回节自身的原因。
- 成片站：edit、review、assembly 节 observed 时变成「Scaena 记录」里的一行事实；delivery 节在 Scaena 有按集字段之前总是缺口；没有摘要时三项缺口与以前完全相同。只要还有缺口，成片站就不是「已读到」。
- 集关联：同一 owner 的绑定 `resource_ref` 等于任务的 `owner_episode_ref` 或 `task_ref` 才算关联；有绑定但没有任务时是「还没有」，不是「对不上」；这些任务不再计入「没有标注属于哪一集」。

## 缓存
读取器按范围与集缓存 45 秒，并合并并发请求；`/production` 的缓存键升到 `production_line.v2`。

## 范围限制
- `/production` 只在单集范围读取摘要。项目范围不读：要是逐集读取，一次项目视图就会变成多次 owner 调用。因此项目视图里的设定站和成片站与以前一样。
