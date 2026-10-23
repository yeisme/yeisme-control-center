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
- Aigora、MCP Gateway 和 Auctra 在获得只读合同前显示 `needs_contract`。

旧服务端没有该路由时会返回 405 `operation_not_allowed` 且不带允许方法，页面据此降级显示 `/capabilities` 的基础投影。

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
