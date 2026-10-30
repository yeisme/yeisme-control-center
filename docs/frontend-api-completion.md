# 前端接口补齐设计

2026-10-21 工作树核对，2026-10-30 更新 A1 与 A5。本文区分现有实现与提议增量；**仍标“拟议”的接口、字段和错误码均未实现，也不表示对应 owner 已发布合同**。A1 已实现并于 2026-10-30 发布。本轮不生成另一套手写 OpenAPI；以现有 TypeScript shared DTO + server routes 为实现合同源，后续 CONTRACT 任务把批准后的字段落入共享类型，再让 typed client、fixture 和服务端共同消费。

所有路径以前缀 `/api/control-center/v1` 表示。浏览器使用同源 HttpOnly 会话；写动作、媒体授权及显式同步遵守 CSRF、scope、session epoch、重新授权和审计。域内角色、权利和费用仍由 owner 校验。

## 已有接口与调用方

| 用户路径 | 已有接口 | 返回 / 消费方 | 当前缺口 |
| --- | --- | --- | --- |
| 登录与范围 | `GET /auth/methods`、`GET /session`、`POST /auth/personal`、`POST /auth/logout` | `WorkspaceSession`；App Shell | OIDC / 实际组织委托需独立验收 |
| 团队与项目 | `GET /organizations`、`GET /organizations/{org}/members|teams|candidates|binding-options`、`GET /projects`、`GET /projects/{project}`、`GET /projects/{project}/members|bindings` | `Collaboration*`、`SharedProject`；CollaborationDirectory / SharedProjects | 本地组织 grants 不授予 owner 领域权限 |
| 成果浏览 | `GET /projects/{project}/folders`、`GET /projects/{project}/items`、`GET /projects/{project}/items/{item}/task` | `ProjectFolder`、`ProjectItemPage`、`TaskSnapshot`；ProjectFiles | 2026-10-30 补齐共享类型：`DirectoryQuery.source_cursor`，`ProjectItemPage` 声明 `next_source_cursor` 与 `sources: TaskConnectionState[]` |
| 批次列表 | `GET /projects/{project}/generation-batches`、`GET /projects/{project}/generation-batches/{batch}` | `GenerationBatchPage`、`GenerationBatchDetail`；BatchList / ProjectFiles | A1 已实现（2026-10-30 发布）：服务端筛选、签名分页和详情；GET 仍会观察本页或本批次的原操作，并在观察到状态变化时派生通知，不能宣传为纯静态读取 |
| 输入与协作写入 | `/actions`、`/actions/preview`、`/actions/confirm`、`/actions/receipts/{ref}` | 既有 action contract；`useCollaborationAction` | `generation.input.prepare` 只支持 Eikona；Scaena 拒绝；参考 UI 当前传 `references: []` |
| 任务与媒体 | `GET /connections`、`GET /tasks`、`GET /tasks/{key}`、`GET /tasks/{key}/events`、`POST /tasks/{key}/artifacts/{ref}/access` | 任务投影、短时媒体授权；TaskDetail / TaskThumbnail / media-preview | 原媒体必须显式 preview/download；缩略图不能使用完整成果回退 |
| 收集 | `GET /auctra/collection`、`GET /auctra/collection/records/{ref}`、`POST /auctra/collection/sync` | body-free collection index；服务详情 | 真实 collection 读取和浏览器补证；event source 未发布，不新增伪 SSE |
| 流程与交接 | `GET /creative-flow`、`GET /work-queue` | `CreativeFlowProjection`、`WorkQueueResponse` | 真实 episode 投影和安全跳转证据 |
| 请求、正文、附件 | `/requests`、`/requests/summary`、`/requests/{owner}/{id}`、`/requests/{owner}/{id}/content:read` 与既有附件读取路由 | RequestDetail、审计与短时句柄 | Scaena / Sonora 附件 owner 合同与实际授权仍须逐项核验 |
| 工具与成本 | `GET /tool-catalog`、`GET /capabilities`、`GET /usage` | 模型与工具、使用指南（只读状态）、共享项目批量生成、用量 | discovery 不等于可生成；账单未知不填零 |
| 提醒 | `GET /notifications`、`POST /notifications/{id}/read` 与既有 acknowledge/mute/archive 动作 | 单一通知账本 | 阅读、确认、归档独立；不由客户端自报失败事实 |

路径分支实际以 `server/app.ts` 为准，`members|teams` 等表示多个固定路由而不是字面 URL。

## A1：批次服务端分页与详情（已实现并发布 2026-10-30）

沿现有路由增量扩展，共享类型在 `src/shared/collaboration.ts`（`GenerationBatchQuery`、`GenerationBatchPage`、`GenerationBatchDetail`、`GenerationBatchSource`）：

```text
GET /projects/{project}/generation-batches?q=&state=&owner=&from=&to=&cursor=&limit=
GET /projects/{project}/generation-batches/{batch}
```

查询合同：

- `q` 最多 200 字符，匹配名称或完整批次 id。名称匹配不区分 ASCII 大小写，`%`、`_` 按普通字符处理。
- `state`、`owner` 使用 allowlist，逗号分隔表示同字段 OR，跨字段 AND；有未知值时整个请求拒绝。
- 时间为 RFC3339，`from` 包含、`to` 不包含，`from >= to` 拒绝。
- `limit` 默认 20、范围 1–100。
- 按 `created_at DESC, id DESC` 排序（id 按字节比较），keyset 游标为 `{created_at, id}`。
- 游标签名绑定身份、session epoch、项目、项目 revision、角色和全部筛选，15 分钟失效；切换筛选会清空 cursor。

过滤、排序和计数都在 SQL 中完成，只解析当前页。迁移 0011 新增 `collaboration_batch_page_idx (project_id, created_at, id)`，由 drizzle-kit 生成。在一个有 4,000 个批次（每批 8 项）的项目上：原先全量读取并解析需 107 ms；现在不带筛选 1.7 ms，按工具加状态筛选 5.1 ms，按名称搜索 2.8 ms。

响应保留原有 `rows`、`epoch`，并增加：

- `next_cursor`；
- `total`：当前授权的本地批次中符合筛选的数量，不代表 owner 任务数；
- `coverage`、`observed_at`；
- `sources`：按工具项目汇总，状态沿用任务页连接状态（`ready`、`not_checked`、`forbidden`、`needs_contract`、`source_unavailable`）。`not_checked` 表示本次超出读取上限、下次轮询优先读取。`reason` 只放错误码，不放 owner 原文。

任一来源不是 `ready` 时 `coverage=partial`，仍返回 200。详情返回 `{batch, epoch, coverage, observed_at, sources}`；项目不可见与批次不存在统一返回 404 `generation_batch_not_found`。

观察规则：

- 列表只观察本页，详情只观察该批次。只读 owner members，不提交、不重试、不为 unknown 换键。
- 每次请求最多读取 24 个进行中的生成项，同时最多 4 个，最久未读的优先，超出部分标为 `not_checked`。
- 同一身份对同一批次、同一生成项的并发读取共用一次。

通知只在本次请求观察到批次状态变化时（以及确认动作时）发出，按 `batch_id:state` 去重，链接为 `/creation?sharedProject=&batch=`。翻回旧批次不会补发。

前端：

- `BatchList` 把 `batchFilter{q,state,owner,from,to,cursor}` 放在地址里，日期按本地日历日换算。
- 只轮询当前页和打开的批次；`?batch=` 直接请求详情。
- 游标过期，或因 epoch 变化而失效时，列表自动回到最新一页并提示。
- 在其他范围打开 `/creation?sharedProject=` 时先切换范围。
- `ProjectFiles` 只取最新 20 个批次；`?batch=` 不在其中时按需补读详情。

错误码与现有实现对齐：

| 状态 | 错误码 | 含义 |
| --- | --- | --- |
| 400 | `invalid_query` | 筛选或 `limit` 不合法 |
| 400 | `cursor_invalid` | 游标伪造或损坏 |
| 409 | `cursor_expired` | 游标过期，或身份、epoch、项目、筛选与签发时不同；拟议的 `cursor_scope_mismatch` 和 410 未采用 |
| 404 | `generation_batch_not_found` | 项目不可见或批次不存在 |
| 401 | — | 未登录 |

验证：

- `tests/batch-paging.test.ts` 10 项：稳定顺序、筛选、过期 / 旧 epoch / 复用的游标、撤权、无匹配、部分来源、读取上限、去重、不提交、脱敏；
- `tests/project-navigation.test.ts` 两项：地址恢复；
- `verify-collaboration-journey` 两项：服务端分页、筛选进地址、失效游标回到最新、跨范围直达非首页批次、提醒回链；
- `verify-contract-integration` 两项：两个 Eikona 项目的批次各自在所属项目观察；停用成员在翻页中途返回 404。

## A2：参考 binding 目录与授权预览（拟议，P1，split-owner）

```text
GET  /projects/{project}/reference-bindings?owner=eikona|scaena&kind=image|video&q=&cursor=&limit=
POST /projects/{project}/reference-bindings/{binding}/access
```

该目录只投影 owner 已存在的不可变 binding。控制中心不上传本机路径、不从任意 URL 下载、不把 `ProjectBinding`（项目连接）当成素材 binding。owner 尚未提供可用目录时返回带 `coverage=unknown`、`availability=needs_contract`、安全 reason 的空目录；这是未知来源，不是“没有素材”。

拟议响应：`{schema_version: yeisme.reference_binding.page.v1, rows, next_cursor, coverage, sources, epoch}`。每条至少包含 `owner, binding_ref, revision, digest, project_ref, kind, label, rights_state, availability, reason?`；`digest` 校验内容身份，别名只显示。rights/availability 只映射 owner 明确提供的状态，不能由“有文件”推断许可。分页默认 20、上限 100，cursor 隔离规则复用 A1。

授权请求仅允许 `{purpose: "thumbnail"|"preview", expected_revision, expected_digest}`；返回控制中心 opaque 同源短时句柄、MIME 和到期时间，复用现有 MediaBridge 的传输、Range、审计、大小限制与撤权重验。若 MediaBridge 目前仅接受 task artifact，先补 owner-reference resolver，不能虚构 task key 或复用不匹配的授权。返回中不出现 owner 原始 URL 或 grant token。

选择动作只保存 exact `owner + binding_ref + revision + digest + role`；角色按 owner 输入 allowlist，Confirm 时 owner 重新验证项目、内容、权利和有效状态。选择可变更前端 draft，改变引用必须清除旧计划/Preview；不得自动接受提示词。预览 403/410 分别显示无权/已失效，不能回退原文件。撤权后新操作阻断，历史 binding 记录保留。

未解决的 owner 项：Eikona/Scaena 的目录动作名、参考预览/缩略图 grant、role 枚举、引用数量与支持模态上限、撤权版本来源。必须在原 shared-projects 4.3 冻结这些项后实现，本文拟议路由不能代替 owner 合同。

## A3：Scaena 固定视频计划和已知费用（拟议，P1，split-owner）

浏览器继续使用现有 `generation.input.prepare`、`generation.batch.create|submit|reconcile` action，**不再另造浏览器直连 Provider submit 接口**。原 shared-projects 4.2 负责在 Scaena owner 冻结合同；控制中心只加 adapter 和表单。

| 阶段 | owner 必须提供的事实 | 控制中心行为 |
| --- | --- | --- |
| 输入 | 不可变 `input_ref/input_digest`，精确 binding/model/参数、references、候选数量 | 正文仅交给 owner，控制中心保留 ref/digest 与安全摘要；输入保存不能被当作纯读 Preview |
| 计划 | `plan_digest`、`quote_ref`、`quote_revision`、费用明确为 known、金额/币种、`expires_at`、支持模态、blockers | quote 必须绑定 exact 输入、计划和项目 binding；最大费用上限或未知费用确认不能冒充报价 |
| 确认 | 原 idempotency key、固定输入与计划、当前授权和权利 | 检查 quote 未过期、币种一致、预算可保留；Confirm 再验证，变化返回冲突 |
| 接收/恢复 | 可查询的原 operation/submission ref、稳定成员 ref、逐项状态 | 接收不确定只查原操作；不能换 key 或重新准备输入“重试” |
| 结果 | 原 task/artifact ref、MIME、版本/digest、授权封面、可读成果状态 | Provider success 与交付可读分开；下载/播放/Range 和媒体探测未过前不声称视频交付成功 |

新 quote 金额推荐十进制字符串并在服务端精确比较；现有批次金额是 number，兼容转换和存储精度必须在 CONTRACT 阶段明确，拒绝溢出、非有限值和隐式换汇。项目预算保留、释放、结算观察不形成第二费用账本；unknown 保留 reservation，终态按 owner 事实精确释放，重启/重复对账不能重复扣减。

当前 `GenerationBatches.prepare/verify` 和页面均明确阻断 Scaena；合同未到位前继续如此，不在本轮取消阻断。

## A4：请求、collection 与交接（复用，P1）

- collection 继续现有 body-free API、显式 sync 和本地元数据 action；`interfaces.md` 旧的 authoring 正文/候选写入描述不再适用。事件 source 未发布时保留 pending；SSE 不是只读收集切片的隐藏前置门。
- request/content/attachment 不另开 BFF 副本。按 owner、任务族列输入/输出/上传清单/附件的 coverage、可读用途和拒绝码；`not_recorded`、`forbidden`、`needs_contract` 分开。Scaena/Sonora 缺附件时，服务端/页面不能通过原 Provider URL 补齐。
- work-queue/creative-flow 保留原 schema、episode、revision/digest、coverage 和受控 LaunchContext；跳转返回地址只允许已有路由。MuWeave direct read 缺合同继续显示 `needs_contract`。
- tool-catalog 的模型/渠道资源由 owner 发布后才可读；Aigora、个人 MCP Gateway、Auctra Pi 等未接入源维持原能力要求和 `needs_contract`，不能在收尾时删掉或虚构目录。
- 审阅、交付、owner 配置与成员管理已登记 action descriptor，但领域写 adapter 尚缺；逐项的 owner 与缺失合同见下文 A5。本地 collection confirm 不得替代 owner review。

## A5：领域写入与额外工具来源的 owner 交接（2026-10-30）

以下能力在控制中心里都已有入口或目录条目，但对应 owner 还没有可调用的合同。控制中心保持现状：

- 动作描述符登记为 `availability: needs_contract`（`server/actions.ts`）：预览返回这个状态，拒绝码作为 blocker；确认只得到 `state: needs_contract`、`error_code` 为该拒绝码的回执，不调用 owner，也不写入任何东西；
- 工作队列 Inspector 显示“待合同”；
- 服务目录显示“待合同”。

本轮不在控制中心实现任何领域写入。下表写明每项由谁负责，以及 owner 发布什么之后才能做适配。

### 领域写入

| 能力 | 已登记动作与拒绝码 | canonical owner | owner 需要发布的合同 | 现有可接的 owner 工作 |
| --- | --- | --- | --- | --- |
| 审阅决定 | `review.request_changes`、`review.approve`，按 eikona / scaena / sonora 各登记一份；`owner_review_contract_not_configured` | 产出该结果的工具：Eikona（`cli/eikona`）、Scaena（`agent/scaena`）、Sonora（`cli/sonora`） | 目标为任务、结果或审阅 ref，加内容 digest；revision 为决定所依据的结果版本，过期返回 409；权限为 owner 侧审阅角色，禁止自审，控制中心的本地组织角色不能授予；回执包括决定、审阅人、owner 回执 ref、幂等结果和有限的拒绝码集合 | Scaena 有 `scaena.replica_stage_review_receipt.v1alpha1`（`agent/scaena/openspec/specs/replica-stage-review-freeze`），字段已覆盖 ref/revision/digest/决定/角色/权限/幂等，但只针对复刻舞台，需扩成对外的审阅决定接口。Eikona、Sonora 只有只读投影（`eikona-control-center-read-projection-v1`、`sonora-control-center-read-projection-v1`），需各自新增审阅决定合同 |
| 交付 | `delivery.prepare`、`delivery.send`；`owner_delivery_contract_not_configured` | 传输与收件：DriveBridge（`cli/drivebridge`）。交付内容仍归产出它的工具 | 目标为交付包 ref，含产物 ref、digest 与收件方；revision 为交付包版本；权限为发送方与收件方授权，对外发送须用户逐次确认；回执包括传输 ref、收件确认、失败与撤回 | DriveBridge 有 `drivebridge-share-receiver-v1`、`remote-mcp-guided-shared-file-access-v1`（收件与共享读取），还缺“由控制中心发起交付”的预览与确认合同 |
| owner 配置 | `owner.config.update`；`owner_config_contract_not_configured` | Aigora（`apigateway/aigora`） | 目标为配置项 ref；revision 为配置版本或 ETag；权限为 Aigora 管理员的 OIDC 委托，个人会话不可；回执包括生效 revision、审计 ref 和回滚点 | 暂无对应变更，需要 Aigora 新开 |
| owner 成员 | `owner.membership.update`；`owner_membership_contract_not_configured` | Aigora | 目标为成员与角色 ref；revision 为成员表版本；权限同上；回执包括变更后的角色与审计 ref。控制中心本地组织成员（`organization.member.set`）不授予任何 owner 权限 | 同上 |

### 额外工具来源

服务目录（`src/service-directory.ts`）中 `integration: not_integrated` 的条目保持“待合同”，不编造任务、目录或连接数据。每个 owner 先发布只读观察合同：连接状态、任务或条目列表、游标、来源覆盖与拒绝码。之后控制中心才按 A1 的分页与来源规则接入。

| 来源 | owner 路径 | 缺口（服务目录原文） |
| --- | --- | --- |
| 个人 MCP Gateway | `mcp/gateway` | 尚无控制中心适配；不复用 Agent 管理凭据。 |
| DriveBridge | `cli/drivebridge` | 控制中心传输、容量和授权投影尚未接入。 |
| Anatomia | `agent/anatomia` | 任务和诊断投影尚未接入。 |
| Pinax | `cli/pinax` | 远程管理 backing 未确认；不读取私有 vault。 |
| Capsa | `backend-server/capsa` | 只读摘要待适配；不解密用户内容。 |
| Manju | `backend-server/manju` | 当前部署及公开观测合同待核验。 |
| Template Registry | `backend-server/template-registry` | 版本目录投影待 typed adapter。 |
| Quaestor | `cli/quaestor` | 远程管理合同未确认。 |
| Digital Human / OpenTalking | `agent/digital-human` | 现行 OpenTalking 与旧目录描述不同；须按当前公开合同接入。 |
| Open Design | `OpenDesign MCP` | 设计读取已用于本次交接，浏览器用户接入未配置。 |
| SoloCut | `OpenDesign / solocut-agent-editor` | 当前仅确认设计原型，不是已部署业务应用。 |
| LayerLab | `OpenDesign / layerlab-agent-design-studio` | 当前仅确认设计原型，不是已部署业务应用。 |
| Firecrawl | `backend-server/firecrawl` | 任务、限流与审计投影尚未接入。 |
| Gitea MCP | `mcp/gitea-mcp` | 仅作工程关联；写操作保留原批准合同。 |
| Blender MCP | `mcp/blender-mcp` | 宿主与观测合同未接入，不建立远程 Shell。 |
| credentialctl | `cli/credentialctl` | 只展示安全状态，不展示或复制秘密。 |
| Runtime Plane | `backend-server/client-runtime` | 实验性工具，不作为默认远程执行入口。 |
| 漫剧榜单 | `tools/manju-hotlist` | 本地工具，不新增常驻服务、不恢复 Radar。 |
| Server Quality Assessor | `cli/server-quality-assessor` | 报告读取尚未适配，不自动发起压力测试。 |
| Yeisme Dist | `cli/yeisme-dist` | 版本目录待适配，不触发真实发布或升级。 |

另有两项读取缺口：

- Eikona 部署版的工具目录缺少模型与渠道资源，需 Eikona 部署发布后才能读到。
- 工具项目的自动发现需要 Eikona、Scaena、Sonora 各自提供“列出该凭据可见项目”的合同（见第三轮 T2）。

## 数据、安全与兼容

已有 Control Center canonical 表继续由 `server/db/schema.ts` 和 Drizzle 管理。分页优先复用本地批次和索引；是否加索引在 BACKEND 阶段根据查询计划决定，通过 `bun run db:generate` 生成迁移，不手写 journal/snapshot。生产应用迁移另门处理。

参考目录和访问句柄不持久化媒体 bytes；已有批次仅保存必要引用和摘要。quote 增量若需持久化，记录 exact ref/digest/期限，不存 Provider payload。敏感正文既不进入错误返回，也不进入审计证据；对端错误映射成 allowlist reason。

A1/A2/A3 都必须在测试中覆盖：登录失效、跨组织/项目、旧 epoch、撤权、游标过期与复用、无匹配、来源超时/部分、409 冲突、unknown 恢复、重复确认、重启后按原键恢复、日志脱敏。复用现有 Vitest、fake owner、合同集成和浏览器旅程；新场景补入原 runner，不能拿现有通过数字证明尚未实现的接口。

实现阶段建议改动路径：`src/shared/collaboration.ts`、`src/shared/action-contract.ts`、`src/shared/api/control-center-client.ts`、`server/app.ts`、`server/owners.ts`、`server/generation-batches.ts`、`server/media.ts`、相关页面与现有 tests/scripts。合同阶段先落共享类型；前后端禁止各写一份不可校验 DTO。
