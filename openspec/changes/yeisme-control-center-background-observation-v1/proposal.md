# Yeisme 控制中心：服务端后台观察 v1

## Why

提醒只在浏览器打开并调用 `POST /notifications/sync` 时才会产生：服务端除了 SSE 心跳没有任何后台工作。没人开着页面的夜里，任务失败不会变成提醒；DriveBridge、MCP Gateway 里失败的传输和工具调用也只在打开服务页时才看得到。

另外，读 `buildWorkQueue` 时发现一个会被后台提醒放大的 bug：任何没有对应任务的提醒，不分类别，都会被当成 `task_failure` / `task_unknown` 工作项。项目分享、批次完成这类提醒已经会误入首页；后台再写入“开放工具运行失败”“凭据到期”类提醒，首页会被一堆“失败任务”淹没。

## What Changes

- **后台观察循环**（`server/observation-loop.ts`）：配置里 `observation.enabled` 为真且 `observation` 块有效时启动。每个周期对每个基础范围的每个任务连接读活动列表和历史列表的第一页，再按下面的“滚动读取”往后走几页，把行交给与浏览器同步相同的账本入口 `NotificationStore.sync`（`complete: false`，列表里没出现的任务不会被标成消失）；由列表行判断恢复，不读任务详情。
  - **滚动读取（评审发现：只读第一页会漏）**：owner 的分页顺序不由控制中心决定（Scaena 按不含时间的 id 升序，失败的运行只在 `history`，`video-task`、`delegation` 族和阻塞的委托只在游标之后），`control_center.tasks.list` 也没有“更新时间晚于”之类的过滤，所以第一页里没有失败不等于没有失败。每个连接（按范围）在内存里有一个滚动位置，先走历史列表再走活动列表，用 owner 自己的游标一页页走，下个周期从上次停的地方接着走，走完活动列表后从头再来；第一页本来每周期都读，它同时充当从头开始的那一页，一页放得下的列表不多花一次调用。游标只在服务进程内存里（owner 的原始游标，不签名、不出服务端）；`TaskConnections.scan()` 为此新增（`list()` 的行为不变，它没有人用的 `only` 参数已删）。摘要里有 `pages_read`、`pages_skipped` 与 `scan_incomplete`（自进程启动起还没完整走完一遍的连接数，含还没读过的）。
  - **滚动页读失败是滚动读取自己的事（第二轮评审：一个反复失败的深页会拖慢整个连接、卡住滚动）**：原先滚动页失败和第一页失败用同一个整连接退避，第一页只在第 0、20、60、120、180 分钟才读，还会把浏览器看到的通道状态写成 `source_unavailable`；一行不合格的数据也会让整页被拒，瞬时的 429/503 也丢掉走了多远。现在：滚动页失败只停该连接的滚动到下个周期，游标保留，下个周期读同一页；同一页连续失败 3 次后放弃它——owner 的回答到了并给出下一页游标（页里有一行被拒）就接着走下一页，否则这个列表后面读不到，当作走到头——并计数（`walk_page_skipped`、`pages_skipped`）；放弃过页的一遍不算完整的一遍（`scan_incomplete` 继续计这个连接）。滚动页不写连接的通道状态；第一页照常每周期读，只有第一页失败才让整个连接退避并忘掉滚动位置。
  - **一个周期里同一任务的多行以失败为准（第二轮评审：恢复取决于读页顺序）**：原先同一任务的几行按“后读的赢”去重，历史第一页是失败、活动较深页是进行中的任务不会开提醒，滚动读取走到不同页时提醒每个周期开了又恢复。现在先把所有行按任务分类，只要有一行失败就按失败算、不恢复；只有没有任何一行失败的任务才能恢复。
  - 接收人：绑定该范围的每个已启用个人管理员账号（含配置里 `personal.username` 的旧版所有者，且其 `personal.role` 为 admin），或 `observation.recipients` 里列出的其中管理员；只读账号永远不是接收人。只观察配置里的基础范围，不碰共享项目范围（`project_*`）。
  - 提醒按接收人逐份写入，`session_id` 记为 `background`。账本的 id 与指纹不含会话，所以之后浏览器同步同一次失败会落在同一行上，不会出现第二份。
  - **防刷屏**：这一段观察的起点写入既有的 `control_state`（`observation_enabled_at`），上个周期的开始时间写入 `observation_last_cycle_at`；只有最近更新时间晚于“起点前 24 小时”的任务才会打开新提醒。持续运行或几分钟的重启不移动起点；某个周期的开始离上个周期的开始超过 24 小时（间隔更长时取两个间隔），说明期间被停用或服务停了，该周期以自己的开始为新起点（评审发现：停用几个月再启用，原先会为首次启用以来的每个失败开提醒）。
  - **预算按 owner 的实际 HTTP 请求数算（第二轮评审：原先只数逻辑调用，25 个长列表连接一个周期实际有 52、53 个请求）**：每个周期至多 40 次，其中包括每个连接的 MCP 握手（`initialize`，进程内第一次读时多一次）、每个列表页和开放工具读取的每个请求（DriveBridge 3 次、Gateway 6 次，预算按最多预留，命中缓存时实际为 0）；每个读到的连接保底预留 3 次（活动、历史第一页，加一页滚动读取），还没有会话的再加 1 次握手，所以第一个周期每个连接占 4 次（25 个连接读 10 个）、之后占 3 次（读 13 个），预留不下的留到下个周期；剩下的请求按轮分给仍有页可读的连接，每个连接每周期至多 8 次请求（握手与第一页计入）；摘要的 `calls` 是实际请求数，测试里的假 owner 把握手也记入（`requests()`），合同集成里再与假 owner 自己的计数核对；一个连接被几个范围共用时每周期只读一次、只占一份预算与一个滚动位置，读到的行用各范围自己的任务键分发给各范围自己的接收人（`TaskConnections.forScope()`）；某连接读不到后，下次等待时间翻倍，最长 60 分钟，恢复后清零；不调用 Provider，不调用 Auctra；两个周期不会同时运行；启动后 60 秒加最多 15 秒抖动才跑第一次；`stop()` 取消定时器并等待正在运行的周期，该周期不再发起下一轮读取；`stop()` 后立刻 `start()`，旧运行的收尾不会再排定或覆盖定时器（世代号）。
  - **收尾（第二轮评审）**：一个接收人写入失败（`reminder_write_failed`）不影响同一范围的其他接收人，下个周期补写；退避与滚动位置只在所有范围的连接都列得出来时才清理已离开配置的连接，某个范围这次列不出来时什么也不丢；状态里同一个范围出现几次只算一次。
  - **配置校验（评审发现：`recipients` 写成字符串会让每个周期失败、状态 503）**：启动时一次性检查 `observation` 块（`enabled` 布尔，`interval_minutes` 5–1440 的数，`open_tools_every` 1–1000 的整数，`recipients` 至多 100 个非空字符串的数组；缺省的可选键不算问题）。有问题的块按问题代码写日志（不写值）并当作未启用；不再把越界的周期悄悄夹到范围内。接收人查找与 `GET /observation/status` 通过同一个不会抛错的读取函数（`server/observation-config.ts`）读配置，任何配置内容都不会让它们 5xx，也不会让 `live-readback` 误判回滚。
  - **开放工具**：DriveBridge、MCP Gateway 每 `open_tools_every` 个周期（默认 3，第一个周期会读）读一次（DriveBridge 每次带凭据的调用都会在它那边留一条审计）；`operations.attention` 里失败或结果未知的运行变成类别 `operation` 的提醒，每个工具每个周期至多 10 条，点开进入 `/services`。
  - **凭据提醒**：循环对每个被观察的范围向“凭据生命周期”（`server/observation-credentials.ts`，用 `credentialStatuses()`）要需要处理的凭据，写成类别 `credential`、键为 `credential:<slot>:<state>:<stage>` 的提醒；不再是问题或进入另一个状态/阶段时，原来那条标为已恢复，同一步以后再出现则重新打开成新的未读提醒。事实只用内存里已有的最新观测算出（`TaskConnections.cached()`、`OpenToolService.credentialProjections()`：每个开放工具里最近一次说得清凭据有没有被接受的读数），不发 owner 请求，不占预算；没有读数（重启后还没读过的连接、读取都没得到回答的连接或工具）的槽位，底下还开着的被拒、读不到、部分被拒提醒原样保留，不知道不等于恢复。
- **启动**（`server/index.ts`）：仅当 `observation.enabled`、`observation` 块有效且环境变量 `YEISME_CONTROL_BACKGROUND` 不为 `off` 时启动循环（发布候选检查把它设为 `off`）；块无效时写一行日志说明问题代码并当作未启用；收到 SIGTERM / SIGINT 时先 `server.close()` 不再接新连接，再停循环，再退出（最长等 8 秒）。
- **新路由** `GET /observation/status`：个人会话可读（任意角色），返回是否启用、配置是否有效、是否在运行、周期参数、下一次运行时间、被问范围是否有人接收、当前用户是否是接收人，以及上一个周期的摘要。摘要按范围分开记数（评审发现：全局一份 `last_cycle` 会把别的范围的提醒数、错误码和连接数泄露给只能看一个范围的会话）；响应只含被问范围（`?scope=`，会话没有该范围返回 404）或会话自己所有范围相加的数，不含别的范围的数据。不调用任何 owner，不含地址、路径或密钥。
- **修复工作队列**：只有失败类别的提醒才会在没有对应任务时变成 `task_failure` / `task_unknown` 工作项。
- **凭据续签工作项**：`GET /work-queue` 对个人管理员多一种 `credential_renewal` 项，由路由用本次请求已经读到的观测算出（见 `docs/interfaces.md`）。
- **接缝整理（行为不变）**：
  - `createApp` 拆成 `createControlCenter(config, deps) → { handle, services }`，`createApp` 仍返回 `handle`。
  - `failureOf` 移到 `server/notifications.ts`，成为导出的 `failureFact()`，浏览器同步与后台循环共用。
  - 新增 `audited()`，替换动作类路由里重复的审计 begin/complete try/catch。
  - 新增 `ActionService.succeeded()` / `outcome()`，替换手写的成功回执。
  - 两处重复的“项目分配通知”循环合并为一个函数。
  - `NotificationStore.event()` 兼容地接受 `/services` 目标，以及 owner、错误码和状态；`TaskConnections.list()` 可限定只读指定连接。

## Impact

- 默认关闭：没有 `observation` 配置或 `enabled` 不为真时，行为与之前完全一致。
- 打开后会多出对 owner 的周期性只读调用，上限见上；DriveBridge 的审计行数随 `open_tools_every` 增加而减少。
- 浏览器同步与后台共用账本：用户在浏览器里确认、归档、免提醒的结果，后台不会改回去。
- 提醒页与铃铛给 `operation`（“工具运行”）与 `credential`（“凭据”）各自的标签（见 `yeisme-control-center-reminder-delivery-v1`）。
- 工作队列新增 `credential_renewal` 类型：个人管理员每个需要处理的凭据一项，链接到服务页的凭据与指南的续签小节；被拒或读不到的连接、工具原有的 `service_blocked` 项被它替换。
