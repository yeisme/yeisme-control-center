# 接口与 owner 实施交接

## 当前交付层级

2026-10-21 核对：同源 Bun 服务、账户/会话、任务/请求读取、媒体授权、收集索引、工作队列、工具目录及协作代码已经存在；部分共享项目实现仍在未提交工作树。实现合同分布于 `server/app.ts`、`server/contracts.ts`、`src/shared/**` 与 `src/shared/api/control-center-client.ts`，实际部署/真实授权状态见 [current-status.md](current-status.md)。

后续完成顺序见 [完成方案](completion-roadmap.md)；现有路由、前端调用方和拟议分页/参考/视频接口的逐项设计见 [前端接口补齐](frontend-api-completion.md)。拟议路由尚未实现，不能据此声明 owner 或部署能力。

## 接线边界

浏览器通过自己的同源会话访问聚合接口，服务端调用固定注册的 owner API/MCP。每个 owner 必须把当前用户映射到有效 principal、project 和 action scope；中央 UI 角色不增加领域权限。会话使用 HttpOnly cookie、CSRF 与服务端检查；身份服务复用协议，不假设多个产品共享 cookie 或 grant。

同源服务拥有组织、团队、共享项目 grants、文件夹、成果引用、通知阅读状态、本地收集元数据与派生投影；领域任务调度、原始资产、owner 身份权限和费用账本仍归各 owner。不访问 owner 私有存储，不接受浏览器传入可执行程序、任意 URL、参数列表或 Provider payload。注册表与凭据引用由受控服务端配置提供；Aigora 继续拥有网关 registry、路由、policy 和 MCP 迁移。

媒体预览的有界缓存只属于浏览器当前会话。它缓存已经通过 artifact grant 授权的 Blob/Object URL，不缓存 owner 地址、凭据或原始 Provider payload；缓存到期、登出和 scope/session epoch 变化时必须清理。过程观察投影只保留 owner 明确提供的提示词采集和中间检查点，并携带 coverage、freshness、gap 与 reason；缺失字段保持未知或未提供。

## 最小消费合同

### 工作队列与跨项目交接

控制中心通过 `GET /api/control-center/v1/work-queue` 读取当前授权范围的派生工作项。接口支持 `scope`、签名 `cursor`、`limit`、`kind`、`owner` 和 `state`，返回 `yeisme.work_queue.v1`、session epoch、来源覆盖度、统计和安全引用。

工作项来自任务、提醒账本、服务观测和 owner typed projection，不写入 owner 状态，也不创建第二任务真源。剧本到分镜链路消费 Auctra `creative.flow.read` 与 Scaena `storyboard_workspace_projection.v1`（两者都要求集引用，队列读取最近更新的 ≤3 集，与剧集制作共用缓存）；同一 revision 按 scope/owner/object/source/revision 去重。点击工作项先打开控制中心 Inspector；跳转 Auctra、Scaena 或 Muweave 使用 `yeisme.control_center.launch_context.v1`，不接受任意 URL。Muweave 尚无直接读取合同时显示 `needs_contract`。

`credential_renewal`：个人管理员的队列里，每个需要处理的凭据（`unreadable`、`rejected`、`expired`、`expiring`、`limited`，见“凭据状态”）有一项，由路由用本次请求已经读到的任务连接观测和开放工具读数算出，不新增 owner 调用；个人只读账号与 OIDC 会话没有这类项。`source_ref` 是槽位 id，`work_ref` 对同一槽位不随状态变化，`state` 是凭据状态，`attention_reason` 是原因（没有则为状态），`credential` 字段是 `{ slot, state, stage?, reason?, expires_at?, days_left? }`，不含路径、地址和令牌。优先级：读不到、被拒、已过期为 `critical`，1 天内到期为 `high`，其余为 `normal`。`safe_links` 两条：`services`（`ref` 为槽位 id）与 `guide`（`ref` 为指南「接入」章节里的续签小节，`guide-renew-<tool>` 或通用的 `guide-renew`）。被拒或读不到的连接（`connection:<id>`）或开放工具（`open_tool:<kind>`）已经由这一项说明，所以同一槽位原有的 `service_blocked` 项在它自己的原因也是凭据问题时被替换：凭据行是 `rejected`，替换原因为 `needs_authorization`、`owner_action_denied`、`open_tool_unauthenticated`、`open_tool_forbidden` 的项；凭据行是 `unreadable`，替换原因为 `credential_unreadable`、`open_tool_credential_unreadable` 的项。原因不是这些的（工具暂时读不到、地址被拒绝）是另一个故障，凭据行解释不了，两项都保留，只是文件权限不对的 `unreadable` 行也不会替换 owner 拒绝了凭据的那一项；到期、部分被拒同样两项都保留。被拒、读不到、已过期的凭据也计入 `counts.blocked`。

工作项动作只显示 allowlist 中的 Preview。Preview 只返回规范化输入、digest、阻断原因和所需审批，不代表 Owner 已写入；Confirm、Provider 调用、凭据变更和账本写入仍由既有独立合同与授权门控制。

### 剧集制作（yeisme.drama_episodes.v1 / yeisme.drama_episode.v1）

`GET /api/control-center/v1/drama/episodes?scope=<scope>[&q=][&limit=1..24][&cursor=][&read=all][&episode_ref=...]` 返回当前范围的剧集行。全集来自本地 Auctra 收集索引中的剧本类 text unit（`kind` 为 `screenplay` 或 `screenplay_scene`，已归档的不列出），因此不产生 owner 调用；`episode_ref` 可重复（最多 12 个，合法引用），用于并入任务里出现的集或手动指定的集，行的 `origin` 为 `requested`。每次最多对前 8 集做实时读取（Auctra 与 Scaena 并行），其余行 `read: deferred`；`read=all` 读满一页。每行的 `flow.rail` 永远是五个阶段，`next_attention` 来自 `yeisme.creative_flow.v1`。`universe` 说明来源：`bound`、`coverage`、`reason`（`source_not_configured` 或 `collection_not_synced`）。分页游标已签名，并绑定会话、epoch、范围、搜索与页大小。

`GET /api/control-center/v1/drama/episode?scope=<scope>&episode_ref=<ref>[&scaena_episode_ref=<ref>][&refresh=1]` 返回一集的 `creative_flow` 投影、五节点阶段链、head 拆解的结构（`outline`：场景标题与镜头景别/角度/运镜/时长；`older_attempts`、`truncated`）和每个阶段的安全交接（Auctra/Scaena 命令模板、已配置时的 MuWeave URL）。引用最长 512 且不含控制字符，否则 400 `invalid_reference`；`scaena_episode_ref` 只改变 Scaena 的读取。响应不含 `action_summary`、媒体绑定、prompt、凭据。

两个路由只接受 GET（其余方法 405）。读取走“会话 + epoch + 范围 + 绑定 + 集”隔离的 45 秒缓存；owner 暂时不可用只记 10 秒，之后重试，其余状态（包括未绑定、缺合同）按 45 秒缓存，所以部分连接的范围不会每次请求都重读 owner。同一键的强制刷新 10 秒内只生效一次，响应的 `cache` 为 `hit`、`miss` 或 `refresh_limited`。`order=recent` 把最近更新的剧集排在前面（审阅页用它）。列表的实时读取预算只计需要 owner 调用的行，已缓存的行不占额度。`episode_ref` 查询参数里不合法的引用（控制字符、首尾空白、超长）被忽略而不是让整个请求失败，超过 12 个才返回 400。收集库里不存在的引用（多半是任务里的 Scaena 引用）不会发给 Auctra，因为 Auctra 按引用末尾的数字匹配计划，会把别的集的计划显示在它名下；该行的 Auctra 阶段显示“收集库里没有这一集”。旧版本服务端没有这两个路由，前端据此显示“服务端版本过旧”，不用演示数据补齐。

### 工具目录（yeisme.tool_catalog.v1）

`GET /api/control-center/v1/tool-catalog?scope=<scope>[&refresh=1]` 返回当前授权范围的跨 owner 只读目录。目录包含：

- 服务器：协议、版本、覆盖状态与新鲜度；
- MCP 工具：分页 `tools/list`、注解、输入字段摘要与 digest；
- owner 动作：风险等级、运行时可用性、确认/幂等要求；
- 模型：只透传 owner 声明的 `latest_ready | latest_unverified | unavailable | historical | drifted | unknown_cost`，未声明时为 `unknown`；
- 渠道：`channel.summary.v1`；
- 近 7 天变化：控制中心按 digest 观察，首次读取只建基线。

只允许调用 owner 的只读发现面：`initialize`、`tools/list`、`resources/read`，以及 `getProjectMediaCapabilities`、`credential.status`、`doctor.run`、`sonora.search`。任何目录条目都不会被调用。

刷新与容错：

- 每个 owner 的发现结果缓存 60 秒，`refresh=1` 每 15 秒最多强制刷新一次；
- 瞬时失败时返回上次成功结果，标为 `stale`；
- Aigora 和 Auctra 在获得只读合同前显示 `needs_contract`；MCP Gateway 在当前范围配置了开放工具时，换成它 `/v1/tools` 列出的工具（见下节），否则仍是 `needs_contract`。

旧服务端没有该路由时会返回 405 `operation_not_allowed` 且不带允许方法，页面据此降级显示 `/capabilities` 的基础投影。

### 开放工具（yeisme.open_tool_projection.v1）

DriveBridge 与个人 MCP Gateway 不是任务 owner，控制中心只读它们的“运行投影”。配置在 `ServerConfig.open_tools.{drivebridge,gateway}`（`endpoint`、0600 `credential_ref`、`allow_private_http`、`enabled`、`label`），范围用 `ScopeBinding.open_tools` 列出；只对个人会话可见，由 `personal-config open-tool` 写入。

| 工具 | 只调用的 GET | 保留 | 丢弃 |
| --- | --- | --- | --- |
| DriveBridge（空间级 Agent 令牌，`read`） | `/healthz`（不带凭据）、`/api/v1/capabilities`、`/api/v1/operations?limit=50` | 接口版本、分块、单文件上限；运行的 id、类型、状态、时间、大小或进度、snake_case 错误码 | 公开地址、路径、文件名、摘要、错误文本 |
| MCP Gateway（`mcp:tools:read,mcp:audit:read`，必须绑定工作区） | `/readyz`（不带凭据）、`/v1/tenants/current`、`/v1/backends`、`/v1/tools`、`/v1/operations`、`/v1/usage?group_by=backend` | 后端 id、命名空间、启用、状态（就绪由 `/readyz` 决定）、工具数；工具摘要；REST 运行的 id、类型、状态、时间；7 天调用、失败、p95 | 后端地址、`last_error`、缺失的环境变量名、运行结果；不读 `/healthz` 与 `/v1/runtime/state` |

- 每次调用 5 秒超时、拒绝重定向、响应上限 1 MiB；401/403 → 无权限，404/405 → 待补齐接口，429 → 限流，其余 → 不可用，不透传 owner 文本。
- 缓存：DriveBridge 120 秒（它每次鉴权调用都写审计行），Gateway 60 秒；并发共享；强刷每 15 秒一次；读不到时保留上次读数并标 `stale`，同时写明当前不可用。
- 出现在：`GET /services?observe=1` 的 `services[].open_tool`；`GET /work-queue` 的 `operation_failure`（近 7 天失败或结果未知，每个工具最多 10 条）与 `service_blocked`（工具读不到、后端不可用）；`GET /tool-catalog` 的 Gateway 工具。

### 凭据状态（`GET /services` 的 `credentials`）

owner 与开放工具不报告凭据到期，所以到期时间由签发的人记在配置里、紧挨 `credential_ref`（`credential_expires_at`、`credential_issued_at`，RFC 3339，要带秒和时区；Auctra 读取密钥用 `flow_credential_*`），由 `personal-config` 的 `--expires-at/--expires-in/--issued-at` 与 `credential list|expiry|replace` 维护。配置字段本身不发往浏览器。

只有**个人管理员**的 `GET /services` 多一个 `credentials` 数组（个人只读账号、OIDC 会话都没有，也没有任何到期时间），由 `serviceDirectory` 用本次请求已有的任务连接观测、开放工具读数和范围连接列表调 `credentialStatuses(config, scope, { connections, scopeConnections, openTools })` 得到，不新增 owner 调用；带 `?observe=1` 用新读的观测，否则只凭文件元数据和记录的到期时间。

每行：`{ id, owner, label, state, reason?, stage?, expires_at?, days_left?, last_accepted_at?, shared_with[] }`。`id` 是槽位，只列这个范围用得到的：`connection:<id>`（连接目录给这个范围的连接，含登记的工具项目）、`open_tool:<kind>`（范围列出的）、`provider:<owner>` 与 `owner:<owner>`（范围绑定了该 owner 才出）、`collection:auctra` 与 `collection:auctra:flow`（范围绑定了 Auctra 项目才出）；已停用的不出。`state` 先中先得：`unreadable`（文件不存在、不是普通文件、有组或其他权限位、本进程读不了、为空，只做 stat 与可读性检查，`reason`：`missing|not_file|permissions|empty`；或观测说读不了，`read_failed`）→ `rejected`（连接观测 `authorization=denied`，`owner_denied`；开放工具带凭据的、本该通过的读取任一 401，`unauthenticated`，或全部 403，`forbidden`；`health` 这类不带凭据的读取与 Gateway 用量这类可选读取上的 401 不算）→ `expired` → `expiring`（≤7 天 `stage` `7d`，≤1 天 `1d`）→ `limited`（凭据被接受但某项读取被拒：`content_denied`、`read_forbidden`）→ `ok` / `unknown_expiry`（记录的到期时间读不了时 `reason` 为 `invalid_expiry`）。`days_left` 向上取整，过期后没有；`last_accepted_at` 只来自给定观测，被拒时没有；`shared_with` 只含同一列表内指向同一文件的其他槽位 id。行里没有路径、地址和令牌。提醒键建议 `credential:<slot>:<state>:<stage ?? "-">`。

### Anatomia 任务观测

Anatomia 按 `yeisme.task_observation.v1` 接入任务连接（`owner: "anatomia"`），由 Anatomia 侧变更 `anatomia-control-center-task-observation-v1` 提供（开关 `ANATOMIA_TASK_OBSERVATION_ENABLED`，另需 `ANATOMIA_MCP_ENABLED`）。

- 观察密钥：`observer.read`（必须绑定项目），预览关键帧另需 `observer.content`；`anatomia control service-keys create --scope observer.read [--scope observer.content] --project project:<name> --output-file <file> --json`。
- 回复直接放在 `structuredContent`，没有 `result` / `data` 包装；工具层 `FORBIDDEN` 显示为“需要 owner 授权”。
- 任务族：`decompose`（拉片分析）、`understand`（视频问答）；只列出带项目的分析，存量没有项目的分析不出现。
- 媒体：`anatomia.task_artifact_grant.v1`，地址必须同源、恰为 `/api/v1/control-center/artifact-grants/<32 位十六进制>`、无 query 与 fragment、125 秒内过期，取媒体时带同一个观察凭据。
- 取消：一律 `cancel_not_supported`。

### 后台观察（yeisme.observation_status.v1）

配置 `observation.enabled` 且 `observation` 块有效、进程环境没有设 `YEISME_CONTROL_BACKGROUND=off` 时，服务端自己周期性读任务连接和开放工具，把失败变成提醒，不需要打开浏览器。默认关闭。

- 读什么：每个基础范围（不含共享项目范围）的每个任务连接，活动与历史列表各第一页，外加滚动读取（见下）；提醒按列表行判断，恢复也只看列表行，不读任务详情；同步时 `complete: false`，列表里没出现的任务不会被标成消失，提醒保持 live。每 `open_tools_every` 个周期（默认 3，第一个周期会读）读一次 DriveBridge / MCP Gateway，`operations.attention` 里失败或结果未知的运行变成类别 `operation` 的提醒，每个工具每周期最多 10 条，链接到 `/services`。不调用 Provider，不调用 Auctra，不写 owner。
- 一个连接读一次：同一个连接被几个范围共用时，每个周期只读一次、只走一份预算和一个滚动位置，读到的行再按各范围分发给各自的接收人；任务键里带范围，所以分发时每个范围用自己的键，浏览器按键打开任务不会串范围。
- 滚动读取：owner 的分页顺序不由控制中心决定（例如 Scaena 按不含时间的 id 升序，失败的运行只在 `history`，`video-task`、`delegation` 族和阻塞的委托只在游标之后），`control_center.tasks.list` 没有“更新时间晚于”之类的过滤，所以第一页不能代表“最近失败的”。每个连接在内存里有一个滚动位置，先走历史列表再走活动列表，用 owner 自己的游标一页页走，下个周期从上次停的地方接着走，走完活动列表后从头再来。第一页每周期都读，同时充当从头开始的那一页。游标只在服务进程内存里，重启后重新走；owner 的游标不签名、不出服务端。
- 滚动页读失败：这是滚动读取自己的事，不是连接的事。游标保留，下个周期再读同一页；同一页连续失败 3 次后放弃这一页：owner 的回答到了并给出了下一页的游标（例如页里有一行控制中心拒收，整页被拒）就接着走下一页，否则（连接错误、超时、429/503）这个列表后面的部分读不到，视为这个列表走到头。放弃一页记 `walk_page_skipped` 与 `pages_skipped`；还没放弃的失败记 `walk_page_failed`。连接的第一页照常每个周期读，不进入退避；滚动页的结果也不写进连接的通道状态（浏览器看到的 `channels`），只有第一页的读取会写。放弃过页的一遍不算完整的一遍。相反，连接的**第一页**读失败才是连接的失败：整个连接按下面的退避等待，并忘掉滚动位置（游标可能已作废）。
- 同一任务在一个周期里的多行：同一个任务在这个周期读到的几页里出现不止一行（比如历史第一页里是失败、活动列表较深的一页里是进行中）时，只要有一行显示失败，这个任务就按失败算，不会被另一页上看起来正常的那一行“恢复”；只有没有任何一行失败的任务才会被标成恢复。这样提醒的打开与恢复不随滚动读取走到哪一页而来回翻。
- 给谁：绑定该范围的每个已启用的个人管理员账号（含配置里的旧版所有者，且其角色为 admin），或 `observation.recipients` 列出的其中管理员；只读账号永远收不到。提醒以会话 `background` 逐人写入，一个接收人写入失败（记 `reminder_write_failed`）不影响同一范围的其他接收人，下个周期会补写；之后浏览器同步同一次失败落在同一行，不会重复。
- 预算按 owner 的实际 HTTP 请求数算：每周期至多 40 次，其中包括每个连接的 MCP 握手（`initialize`，进程内每个连接第一次读时多一次）、每个列表页，以及开放工具读取的每个请求（DriveBridge 3 次、Gateway 6 次；读取命中缓存时为 0，但预算按最多的情况预留）。每个读到的连接保底预留 3 次（活动、历史第一页，加一页滚动读取），还没有会话的再加 1 次握手，所以第一个周期每个连接占 4 次，之后占 3 次；预留不下的连接留到下个周期，从它开始轮转。剩下的请求按轮分给仍有页可读的连接，每个连接每周期至多 8 次请求（握手与两个第一页计入）。周期默认 10 分钟（5–1440）；连接读不到后等待时间翻倍，最长 60 分钟；启动后约 1 分钟才跑第一次；两个周期不会同时运行；`stop()` 后不再发起下一轮读取，`stop()` 后立刻 `start()` 只留一个定时器。收到 SIGTERM / SIGINT 时先 `server.close()` 不再接新连接，再停循环，再退出（最长等 8 秒）。
- 记在内存里的东西（退避、滚动位置）只在所有范围的连接都列得出来时才清理已不在配置里的连接；某个范围的连接这次列不出来（已登记的连接来自数据库）时什么也不丢。
- 防刷屏：这一段观察的起点（`observation_enabled_at`）与上个周期的开始（`observation_last_cycle_at`）记入 `control_state`；只有最近更新晚于“起点前 24 小时”的任务才打开新提醒。持续运行或短时间重启不移动起点；某周期开始离上个周期开始超过 24 小时（间隔更长时取两个间隔）时，该周期以自己的开始为新起点，所以停用很久再启用不会为期间的每个失败开提醒。
- 配置校验：启动时一次性检查 `observation` 块：`enabled` 布尔；`interval_minutes` 5–1440 的数（缺省 10）；`open_tools_every` 1–1000 的整数（缺省 3）；`recipients` 至多 100 个非空字符串的数组。有问题的块按代码写日志（`observation_not_an_object`、`observation_enabled_not_boolean`、`observation_interval_out_of_range`、`observation_open_tools_every_out_of_range`、`observation_recipients_invalid`；不写值）并当作未启用，不再夹到范围内。接收人查找与状态路由读配置不会抛错。
- `GET /observation/status[?scope=]`：个人会话，任意角色。响应字段：

  | 字段 | 含义 |
  | --- | --- |
  | `schema_version` | `yeisme.observation_status.v1` |
  | `enabled` / `config_valid` / `running` | 配置启用且有效 / `observation` 块有效 / 本进程的循环在跑 |
  | `interval_minutes` / `open_tools_every` | 周期参数（块无效时为缺省值） |
  | `scope` | 被问的范围，未带 `?scope=` 时为 `null`（会话没有该范围返回 404） |
  | `observed` / `recipient` | 被问范围里有人收后台提醒 / 当前用户是接收人 |
  | `next_run_at` | 下一次运行时间或 `null` |
  | `last_cycle` | 尚未运行为 `null`；否则 `started_at`、`finished_at`，以及 `calls`、`pages_read`、`pages_skipped`、`reminders_opened`、`reminders_recovered`、`connections_read`、`connections_skipped`、`scan_incomplete`、`open_tools_read` 和按错误码的 `errors` |

  `last_cycle` 的计数只含被问范围，未带 `?scope=` 时是该会话自己所有范围相加（同一个范围出现几次只算一次）；不含别的范围的数、错误码或连接，也不含地址、路径、密钥或提醒文本。不调用 owner。`calls` 是为该范围的连接与开放工具发出的 owner HTTP 请求数（握手、列表页、开放工具的各个请求）；几个范围共用的连接或开放工具对每个用到它的范围各记一次，而进程日志里的总数只记一次。`pages_read` 是要过的列表页数，`pages_skipped` 是放弃的滚动页数。`scan_incomplete` 是自进程启动起还没走完一遍（活动与历史都走到末尾，且没有放弃过页）的连接数，含还没读过的；它降到 0 说明每个连接都完整走过一遍。
- 凭据提醒（类别 `credential`，事件键 `credential:<slot>:<state>:<stage>`，`stage` 无则为 `-`）：`server/index.ts` 把 `credentialReminders(services)`（`server/observation-credentials.ts`）接到循环的 `credentials` 选项。每个周期对每个被观察的范围、用该范围的连接目录和**内存里已有的**最新观测（`TaskConnections.cached(scope)`：最近一次 `observe()` 的结果，或只被列表读取碰过的连接的通道与拒绝记录；`OpenToolService.credentialProjections(scope)`：每个开放工具里最近一次**说得清凭据有没有被接受**的读数，见下）调 `credentialStatuses()`，所以它不发任何 owner 请求，也不占周期的请求预算。只有需要处理的行成为事实（`unreadable`、`rejected`、`expired`、`expiring` 的 `7d` 与 `1d` 两步、`limited`）；`ok` 与 `unknown_expiry` 不提醒。标题是槽位名加状态（“MCP Gateway · 凭据被拒”“DriveBridge · 即将到期（7 天内）”），`owner` 是工具，`error_code` 是行里的原因。每个（槽位、状态、阶段）对每个接收人一条，`/services` 为链接目标。凭据不再是问题（续签了、被停用、记录删了），或进入另一个状态/阶段时，原来那条被标 `recovered_at`，不再计未读；同一个（槽位、状态、阶段）以后再次出现（比如新凭据又快到期了）会作为新的未读提醒重新打开，旧的确认、归档、稍后提醒都不带过来。取不到某范围的事实（钩子抛错，记 `credentials_unreadable`）时，该范围既不新开也不恢复。恢复依据证据，不知道不等于恢复：钩子除事实外还返回 `unknown`，是这一周期没有读数的那些事件键，循环对它们底下还开着的提醒原样保留（既不恢复，也不因此重新打开）。没有读数指：连接自进程启动以来没被读过（拒绝的记录只在内存里，一个周期只读预算允许的那么多连接，所以重启后第一批周期里大部分连接是这样），或读过但所有读取都没有得到回答（owner 不可用、限流）；开放工具所有读数都没得到过回答。这些情况下只保留靠 owner 读数才能判断的三种状态（`rejected`、`unreadable`、`limited`），文件和记录的到期是每个周期都知道的，续签后到期类提醒照常恢复。开放工具的读数“说得清”指：至少一个必须带凭据的读取（可选的读取如 Gateway 的 usage 不算）得到了回答，被接受（`ok`）或被拒（401、403，含凭据读不到）；只是连不上、5xx、429、路由不存在的读数不算，凭据仍按上一次说得清的那次读数判断，所以一次网络错误或浏览器强制刷新碰上的 429 不会让“被拒”恢复、下一次 401 又把已经确认过的提醒重新变成未读。服务页上的开放工具卡片仍显示最近一次读数（过期时保留上一次的运行记录），不受影响。被接受的读数、连接的一次成功读取、连接重新被拒是结束或重开提醒的证据。`limited` 里连接的 `content_denied` 只在进程内存里记着：重启后该连接被读过且没有内容拒绝的记录时，这条提醒照旧会恢复，内容读取再被拒时重新打开。

### 提醒投递：重读、桌面通知、稍后提醒

提醒页与铃铛读同一份提醒账本（`GET /notifications`，只读控制中心自己的数据库，不调用 owner）。

- **重读**：页面每 60 秒重读一次第一页，页面不在前台时暂停，回到前台或窗口获得焦点时立即重读并重新计时；开了桌面通知时，页面在后台也继续读。用户加载过更多页时，重读只替换第一页，后面的行保留。重读开始后用户做了别的操作（确认、归档、稍后提醒、重新观察），这次重读的结果被丢弃，不会把旧状态带回来：提醒页与铃铛的每个动作在**开始**时就记一次变更（`beginChange()`），重新观察（`refresh()`）也记一次，在这之前开始的重读都作废（`ChangeClock`、`readUnlessChanged()`，`src/app/reminder-refresh.ts`）。一条稍后提醒到点时，页面自己的时钟走一步：服务端不会清掉 `snoozed_until`，到点后重读回来的行与之前完全相同，行本身不会变，所以提醒页的分组、各分组的数量、首页关注列表都按 provider 的 `now` 计算，`now` 在行变化时和每条稍后提醒到点时重新取（`scheduleSnoozeEnd()`），到点那一刻同时重读一次让徽标对上服务端的数；超过计时器上限（约 24.8 天）的稍后提醒分段等待，每段结束再瞄下一段。
- **桌面通知**（只在浏览器里，没有服务端合同，不使用 service worker 推送）：提醒页工具栏的“桌面通知”开关，默认关；只有点这个开关才会调 `Notification.requestPermission()`。浏览器不支持、页面不是 HTTPS（`localhost` 与 `127.0.0.1` 算安全）、或权限已被拒绝时，开关关着且不可用，旁边用中文写原因。开关与“已通知”的提醒编号按账号存在 `localStorage`（`yeisme.control.desktop-notifications:<账号>`），基线按范围存。规则由纯函数 `planDesktopNotifications()`（`src/app/desktop-notifications.ts`）决定：只通知开关打开之后才变成未读的提醒——打开开关时（以及第一次看到某个范围时）已经未读的、页面在前台时看到的所有未读提醒（包括以前通知过的），都算基线，不通知；提醒不再是未读（确认、已读、稍后提醒、已恢复）就离开基线，之后重新变成未读又是新的；只在页面不可见或窗口没有焦点时才弹；一次最多 3 条，其余合成一条“另有 N 条新提醒”；`tag` 是提醒编号（摘要用 `reminders-summary`）。“已通知”按一条提醒的**事件**记（`noticeMarker()` = 首次出现的时间 + 稍后提醒的结束时间）：同一事件不重复弹，用户自己重新打开也不算新事件；稍后提醒到点是新事件，会再弹一次；一个已恢复的条件再次出现（凭据问题复发，账本把同一条提醒重新打开并换成新的首次出现时间）也是新事件，弹一次。“已通知”最多记 300 条，超出时先忘掉已经不是未读的，再忘最老的；页面看到过的未读提醒在基线里，即使它的记录被忘掉也不会再弹。这个状态按账号存在 `localStorage`，所以浏览器的各个标签页共用：任一标签页关掉开关，其他标签页（包括不在前台、还在后台读取的）通过 `storage` 事件立刻跟着关，开关显示随之更新；每次计划都从存储里重新读开关，读到关着就什么也不做（`stepDesktop()`）。浏览器权限在设置里改回“允许”而开关还存着“开”时，下一次计划把基线重置为当前未读，不补发这期间的通知。内容只有工具或 owner 名、提醒类别和未读总数（“Eikona · 任务失败，共 3 条未读”），没有任务标题、提示词或 owner 写的任何文字。点击通知会让页面获得焦点并打开 `#/reminders?focus=<提醒编号>`（摘要打开 `#/reminders`）。
- **稍后提醒** `POST /notifications/:id/snooze`，请求体恰为 `{ "until": "<RFC 3339，带时区>" }`：要求 CSRF，范围与对象的检查同确认、归档（提醒必须属于该范围且属于当前账号，否则 404 `notification_not_found`）。`until` 必须在未来、至多 30 天后（否则 400 `invalid_snooze_until`，请求体不是只有 `until` 的对象或超过 256 字节为 400 `invalid_request`）。只有未读且未恢复的提醒能稍后提醒，其余 409 `notification_not_snoozable`；再次稍后提醒会替换时间。响应 `{ notification, task_state, task_states_changed: 0, owner_writes: 0 }`，`notification.state` 仍是 `unread`，`snoozed_until` 是写入的时间；到点之前它不计入未读（侧栏徽标、铃铛、提醒页与首页关注数同一口径），在提醒页归入“已降噪”，到点后不需要任何操作就重新计入。同一次失败再次被观察到不会取消稍后提醒；失败版本变了（新指纹）是新的提醒，没有稍后提醒。和确认、归档一样，它只写控制中心的提醒账本，不改任务、不调用 owner，也没有审计行（提醒动作都不写审计）。
- **重新打开** `POST /notifications/:id/reopen`（已有，行为补全）：把已确认、已免提醒、已归档或稍后提醒中的提醒放回未读，同时清掉归档与稍后提醒的时间；已恢复的提醒仍是已恢复。提醒页与铃铛在可以重新打开的提醒上提供“重新打开”，在可以稍后提醒的提醒上提供“稍后提醒：1 小时后 / 明天上午 / 下周一上午”（时间按用户本地时区在浏览器里**点选的那一刻**算出，发给服务端的是绝对时间；页面放了一夜再点，“1 小时后”仍在未来，“明天上午”是点选那天的次日早上，不是菜单画出来那天的）。
- **类别标签**：任务失败（`failure`，默认）显示“Eikona · 未查看”这样的 owner 与状态；`operation` 显示“DriveBridge · 工具运行”，`credential` 显示“MCP Gateway · 凭据”，项目协作类（`generation_batch`、`project_assignment`）仍显示“项目协作”。只有任务失败带“失败版本”（revision、错误码、owner 状态）与“此任务以后都免提醒”“相同错误码以后都免提醒”；其余类别只有“这一条不再提醒”。
- 提醒页上方的一行后台观察状态来自 `GET /observation/status?scope=`（见上一节），只写开没开、每多少分钟、上次多久前读了几页新增恢复几条、下次什么时候、你是不是接收人，旧服务端没有这个路由时不显示。

### Auctra collection owner

Auctra 使用独立的 `ScopeBinding.collection.auctra`，不加入媒体 request owner union。`server/auctra.ts` 消费 owner `collection.snapshot` 与 `collection.record.show`，本地只保留脱敏、无正文的索引。浏览器读取 `/auctra/collection`、`/auctra/collection/records/{record_ref}`，通过 `/auctra/collection/sync` 显式同步。

`collection.record.confirm|archive|labels.set|note.set` 复用 Preview/Confirm/receipt，只修改控制中心元数据与 CAS revision，不执行 Auctra candidate/review/version 写入，不读取小说正文。Auctra event source 发布前保持显式同步；剧本到分镜另消费 `creative.flow.read`，见 [流程合同](creative-flow-integration.md)。

## 统一写入动作合同（本地实现）

控制中心的写入入口只接受服务端 allowlist 中的动作。浏览器不能提交任意 Owner 路径、MCP action 名称、凭据或 Provider 原始 payload。

```text
GET  /api/control-center/v1/actions?scope=<scope_id>
POST /api/control-center/v1/actions/preview?scope=<scope_id>
POST /api/control-center/v1/actions/confirm?scope=<scope_id>
GET  /api/control-center/v1/actions/receipts/<receipt_ref>?scope=<scope_id>
```

Preview/Confirm 使用 `scope_id`、`owner`、`target_kind`、`target_ref`、`action`、`expected_revision` 和稳定 `idempotency_key`。Preview 只返回规范化输入、摘要、过期时间、阻断原因和所需审批；Confirm 只在 Preview 仍有效且摘要一致时执行。

现有 allowlist 涵盖本地组织/团队/共享项目/目录写入、collection 元数据、项目别名、任务取消、Provider run 创建/对账和个人用户管理。是否可执行由当前 session、scope、角色、owner adapter、预算与提交开关共同决定；代码存在不表示真实生成/取消已获准。审阅、交付、Owner 配置与成员领域写动作在对应 adapter 合同发布前返回 `needs_contract`，不会用本地状态伪造成功。

所有 Confirm 都写入审计、遵守 CSRF、scope 和会话 epoch；超时或未知结果只能读取原 receipt，不能自动重试或生成新的 idempotency key。

- `CapabilityDescriptor`：复用现有 owner/capability、风险批准、幂等、执行、readiness 与 schema 引用；仅声明能力不等于当前可执行。
- `InvocationContext`：复用 request/idempotency、project/actor、purpose、budget 和 evidence metadata；领域 body 保持 owner 原生 schema。
- `OperationProjection`：复用 `queued|running|waiting_review|blocked|succeeded|failed|cancelled|unknown`，保留 native_state、terminal、blockers、cursor、artifact/evidence refs 与已授权动作。
- `ServiceInstanceSummary`：实例与环境引用、owner、版本、项目范围、observed_at、freshness、独立 transport/authentication、capabilities、allowed_actions、安全 credential_ref 与 evidence_refs。不可用或未观察的维度不能填零、成功或当前时间。
- `ControlCenterLaunchContext`：来源、环境、原项目引用、明确 owner-project bindings、operation/asset/shot refs、目标视图与受限返回路由。不接收原始凭据；所有接收端重验引用授权。

## 按动作交接

| 页面动作 | canonical owner / 现有入口 | 权限与失败恢复 | 接口缺口与验收 |
| --- | --- | --- | --- |
| Scaena 能力发现 | `/api/v1/**` Public API；scaena.search 与 backing resources | 以当前 principal/project 投影；不存在与不可见保持不透明 | 统一服务实例与管理角色投影 needs_contract；测 owner unavailable/403/空项目 |
| 视频原任务读取、对账 | getVideoProviderTask / reconcileVideoProviderTask；项目 video-tasks 资源，已有发现与读取适配 | 原 submission_ref，不发第二次 paid create；版本与幂等依原合同 | 固定视频输入、known quote、封面与交付成功仍待合同；真实无任务不能证明播放通过 |
| Eikona 能力与任务资产 | `/api/v1/mcp/actions`、search/execute/resources/read backing；run/artifact/review owner 合同 | 调用已发现动作，生成与审阅写门独立 | 服务配置修订、团队投影 needs_contract；测引用权限、失效授权、原 run 恢复 |
| Sonora 任务、审听与交接 | Sonora `/api/v1/**`、sonora.search command/action discovery | 权利、预算、音频 review 保留在 owner | 管理配置/统一用量/成员投影 needs_contract；测缺许可不可重试/未审听不可批准 |
| 配置编辑与回读 | 各服务 application 配置合同；当前部分仅有 service config CLI | admin + owner scope；preview、expected revision、幂等、回读；冲突保留草稿 | 需 owner 提供具名远程管理动作，禁止用远程 Shell 代替；测 CAS、未知提交、重载有效状态 |
| 接入实例 | 受控服务端连接配置；Aigora gateway registry 仍归 Aigora | 环境与 owner-scoped 身份，不接受任意目标探测 | 实例注册与连接测试 facade needs_contract；测 SSRF、scope、非付费检查 |
| 访问凭据与成员 | credentialctl 状态；各 owner scoped access-key / 身份合同 | 页面仅 source/ref/status/scope；签发、轮换和撤销由 owner 执行 | 统一只读投影与授权动作 needs_contract；测秘密不进入浏览器缓存/URL/导出 |
| 成本与用量 | 实际费用的原账本/Provider 结算 owner；网关成本仍归 Aigora | 去重原账单 ref、分币种、估算与确认分离；缺数保持未知 | 各服务 billing_ref / currency / charge_state 适配 needs_contract；测跨服务重复引用与 pending |
| 跨 owner 资产与交接 | Eikona、Sonora、Scaena、DriveBridge 等公开 ref/grant 合同 | 每次交接核验固定版本、权限、用途和接收回执 | 聚合搜索与血缘投影待接；测旧版本、403、过期 grant、不自动采用 |
| 写作与分析 | Auctra accepted revision；Anatomia source/analysis/evidence API | 正文和来源真源留 owner，接受与 production adoption 独立 | 管理摘要适配待接；测修订变化、证据缺失、固定版本返回 |
| 知识、同步、研究与扩展 | Pinax/Capsa/Manju/Quaestor 与各工具公开合同 | 未部署的本地工具只显示 local；不读数据库或复制 canonical 内容 | 各服务摘要按能力矩阵逐项接入，未确认项为 needs_contract |
| 诊断和审计 | 原 owner request/operation/receipt/evidence | SSE 与详情相同权限；只读脱敏导出；缺 cursor 时重新取快照 | 有界轮询作 fallback；测断线、重复/乱序事件、分页与 scope 隔离 |

## 实施顺序与验收归属

同源会话、三媒体 owner 只读聚合和原任务恢复沿用现有实现。优先补批次分页/detail、参考 binding 和视频固定计划，再按矩阵补齐 owner 合同与证据。每个适配器完成自己的契约、权限、本地集成和用户入口验证后独立升级状态；本地、真实 owner、Provider 与部署分别记账。

实现和证据归 `client/yeisme-control-center`；领域接口归各子项目 OpenSpec，根仓仅维护跨项目准入与链接。新结构化配置、schema、回执和任务状态通过 CLI/脚本生成；本轮只交付方案与文档。
