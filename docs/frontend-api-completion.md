# 前端接口补齐设计

2026-10-21 工作树核对。本文区分现有实现与提议增量；**所有“拟议”接口、字段和错误码均未实现，也不表示对应 owner 已发布合同**。本轮不生成另一套手写 OpenAPI；以现有 TypeScript shared DTO + server routes 为实现合同源，后续 CONTRACT 任务把批准后的字段落入共享类型，再让 typed client、fixture 和服务端共同消费。

所有路径以前缀 `/api/control-center/v1` 表示。浏览器使用同源 HttpOnly 会话；写动作、媒体授权及显式同步遵守 CSRF、scope、session epoch、重新授权和审计。域内角色、权利和费用仍由 owner 校验。

## 已有接口与调用方

| 用户路径 | 已有接口 | 返回 / 消费方 | 当前缺口 |
| --- | --- | --- | --- |
| 登录与范围 | `GET /auth/methods`、`GET /session`、`POST /auth/personal`、`POST /auth/logout` | `WorkspaceSession`；App Shell | OIDC / 实际组织委托需独立验收 |
| 团队与项目 | `GET /organizations`、`GET /organizations/{org}/members|teams|candidates|binding-options`、`GET /projects`、`GET /projects/{project}`、`GET /projects/{project}/members|bindings` | `Collaboration*`、`SharedProject`；CollaborationDirectory / SharedProjects | 本地组织 grants 不授予 owner 领域权限 |
| 成果浏览 | `GET /projects/{project}/folders`、`GET /projects/{project}/items`、`GET /projects/{project}/items/{item}/task` | `ProjectFolder`、`DirectoryPage<ProjectItem>`、`TaskSnapshot`；ProjectFiles | `DirectoryQuery` 尚未声明已有 `source_cursor`，来源状态为路由附加字段，需共享类型补齐 |
| 批次列表 | `GET /projects/{project}/generation-batches` | `{rows: GenerationBatch[], epoch}`；BatchGeneration / ProjectFiles | 当前无服务端筛选/分页/单项 detail；页面全量过滤；GET 会观察原操作并派生本地通知，不能宣传为纯静态读取 |
| 输入与协作写入 | `/actions`、`/actions/preview`、`/actions/confirm`、`/actions/receipts/{ref}` | 既有 action contract；`useCollaborationAction` | `generation.input.prepare` 只支持 Eikona；Scaena 拒绝；参考 UI 当前传 `references: []` |
| 任务与媒体 | `GET /connections`、`GET /tasks`、`GET /tasks/{key}`、`GET /tasks/{key}/events`、`POST /tasks/{key}/artifacts/{ref}/access` | 任务投影、短时媒体授权；TaskDetail / TaskThumbnail / media-preview | 原媒体必须显式 preview/download；缩略图不能使用完整成果回退 |
| 收集 | `GET /auctra/collection`、`GET /auctra/collection/records/{ref}`、`POST /auctra/collection/sync` | body-free collection index；服务详情 | 真实 collection 读取和浏览器补证；event source 未发布，不新增伪 SSE |
| 流程与交接 | `GET /creative-flow`、`GET /work-queue` | `CreativeFlowProjection`、`WorkQueueResponse` | 真实 episode 投影和安全跳转证据 |
| 请求、正文、附件 | `/requests`、`/requests/summary`、`/requests/{owner}/{id}`、`/requests/{owner}/{id}/content:read` 与既有附件读取路由 | RequestDetail、审计与短时句柄 | Scaena / Sonora 附件 owner 合同与实际授权仍须逐项核验 |
| 工具与成本 | `GET /tool-catalog`、`GET /capabilities`、`GET /usage` | 模型与工具、AI 创作、用量 | discovery 不等于可生成；账单未知不填零 |
| 提醒 | `GET /notifications`、`POST /notifications/{id}/read` 与既有 acknowledge/mute/archive 动作 | 单一通知账本 | 阅读、确认、归档独立；不由客户端自报失败事实 |

路径分支实际以 `server/app.ts` 为准，`members|teams` 等表示多个固定路由而不是字面 URL。

## A1：批次服务端分页与详情（拟议，P1）

沿现有路由增量扩展：

```text
GET /projects/{project}/generation-batches?q=&state=&owner=&from=&to=&cursor=&limit=
GET /projects/{project}/generation-batches/{batch}
```

查询合同：`q` 最多 200 字符；`state`、`owner` 使用 allowlist，逗号分隔同字段 OR、跨字段 AND；时间为 RFC3339，`from` 包含、`to` 不包含，`from >= to` 拒绝。`limit` 默认 20、范围 1–100；按 `created_at DESC, id DESC` 稳定排序。分页 cursor 绑定主体、组织/项目、权限 revision、epoch、全部筛选、排序和快照边界，15 分钟失效；切换筛选清空 cursor。

响应在原 `{rows, epoch}` 上增加 `next_cursor`、`total`、`coverage`、`observed_at`、`sources`，保留 rows 兼容旧消费者。`total` 只统计当前授权本地批次，不代表 owner 总任务；来源不完整不填业务总数 0。`sources` 复用现有连接投影，不另建与任务页不兼容的来源枚举。

详情返回 `{batch, epoch, coverage, observed_at}`，必须验证 batch 属于当前项目；不可见项目/批次统一 404。列表/detail 只观察已有操作，不发生成、不为 unknown 换键。后端按每次请求有界观察、并发复用和同一批次观察去重控制成本；通知按原批次/状态去重。不得为了翻页扫描全部 owner 历史或给旧分页结果重新盖“新鲜”时间。

前端把 `q/state/owner/from/to/cursor` 放 URL，轮询当前页和被打开的批次，旧 scope/epoch 响应丢弃；打开 `?batch=<id>` 时直接请求 detail，不能依赖该批次刚好在第一页。ProjectFiles 的按批次目录同样分页/按需定位，不把全部批次重新拉回来。

错误：400 `invalid_query`、403 明确动作拒绝、404 `not_found`、409 拟议 `cursor_scope_mismatch`、410 拟议 `cursor_expired`、429 限频、503 来源不可用；实现前将拟议码与当前 `AuthError` / `ControlCenterApiError` 对齐。部分来源失败仍可返回 200 + `coverage=partial` 和具体 sources，不伪装完整成功。

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
- 审阅、交付、owner 配置与成员管理已登记 action descriptor，但领域写 adapter 尚缺。每项须单独冻结目标/ref/revision/权限/回执后实现；本地 collection confirm 不得替代 owner review。相关后续合同任务列入 completion 变更，保留用户能力范围。

## 数据、安全与兼容

已有 Control Center canonical 表继续由 `server/db/schema.ts` 和 Drizzle 管理。分页优先复用本地批次和索引；是否加索引在 BACKEND 阶段根据查询计划决定，通过 `bun run db:generate` 生成迁移，不手写 journal/snapshot。生产应用迁移另门处理。

参考目录和访问句柄不持久化媒体 bytes；已有批次仅保存必要引用和摘要。quote 增量若需持久化，记录 exact ref/digest/期限，不存 Provider payload。敏感正文既不进入错误返回，也不进入审计证据；对端错误映射成 allowlist reason。

A1/A2/A3 都必须在测试中覆盖：登录失效、跨组织/项目、旧 epoch、撤权、游标过期与复用、无匹配、来源超时/部分、409 冲突、unknown 恢复、重复确认、重启后按原键恢复、日志脱敏。复用现有 Vitest、fake owner、合同集成和浏览器旅程；新场景补入原 runner，不能拿现有通过数字证明尚未实现的接口。

实现阶段建议改动路径：`src/shared/collaboration.ts`、`src/shared/action-contract.ts`、`src/shared/api/control-center-client.ts`、`server/app.ts`、`server/owners.ts`、`server/generation-batches.ts`、`server/media.ts`、相关页面与现有 tests/scripts。合同阶段先落共享类型；前后端禁止各写一份不可校验 DTO。
