# 当前实现状态

本表是控制中心公开仓库的唯一状态摘要。`implemented` 只表示本地代码和合同已存在；`fixture-only` 不代表真实服务；`blocked` 必须保留阻塞原因。

2026-10-21 收尾规划见 [完成方案](completion-roadmap.md) 与 [前端接口补齐](frontend-api-completion.md)。本轮仅核对代码和修改规格/文档，不复跑业务测试或真实验收；下表既有通过数字仍是历史证据。新变更 `yeisme-control-center-completion-v1` 管理公共分页与收尾；旧 v10 方向停止执行，任务可见性 0/4 等旧状态等待按当前覆盖对账，不能据此推断没有代码。

| 能力 | 状态 | 证据层 | 下一道门 |
|---|---|---|---|
| 控制中心前端（13 页导航 App Shell） | `implemented` | 页面数按 `src/app-shell/navigation.ts` 核对；typed client、scope/epoch 守卫、统一读状态、详情 Sheet、亮暗主题与响应式；既有 `test:app`、单元、构建证据 | 当前候选 browser CI |
| 共享组织/项目、成果目录、固定图像批次 | `implemented: deployed 2026-10-22, source uncommitted` | 当前 `server/collaboration.ts`、`server/generation-batches.ts`、ProjectFiles/BatchGeneration；原变更记有本地测试证据，本轮未复跑 | 服务端批次分页/detail、参考绑定选择、Scaena known quote；组织委托/付费/部署单独验收 |
| 前端 fixture 浏览器旅程（I1/I2） | `passed: fixture-only` | `test:browser-journey` 39/39：fake owner + 真实 server 代码 + 浏览器，覆盖登录、服务、任务、事件、结果句柄、请求与正文、组织、用量、模型与工具目录、剧集制作（阶段链、分镜结构、Scaena 集引用指定、交接、焦点回位、窄屏、审阅页、队列、未绑定范围、降级）、scope 切换、迟到响应丢弃、降级来源、无提交/取消；API 层由 `test:contract-integration` 补充；证据 `temp/integration-test-runs/browser-journey-*/` | 不代表真实 owner；I3 只读回读与 I4 文档门已分别记录；自 2026-10-21 起由 CI 运行（与 `test:contract-integration` 27/27 一起） |
| 前端真实只读冒烟 | `passed: real read-only` | `test:preview:real` 7/7（独立端口，真实 owner 只读，无 Provider 调用）；证据 `temp/integration-test-runs/preview-real-*/` | 请求/组织页需 OIDC 委托，个人会话下如实显示 `delegation_unavailable` |
| v18 live 读取 | `implemented` | live API adapter；三 owner 真实只读证据已生成 | 继续补齐 owner 任务覆盖并保持 live submit 关闭 |
| Eikona canary | `passed` | 已有脱敏 canary 记录 | 复验当前版本 |
| Scaena discovery / Video Provider Task read | `implemented: binding blocked` | 实时 guide、8 个 binding、原任务读取和恢复合同；当前至少一个 binding 返回 `binding_disabled`；历史 canary 为 `InvalidApiKey` | owner 修复 binding/Provider 凭据后再单独授权 canary |
| Sonora Provider directory / diagnostics | `implemented: configured read-only` | Provider 目录、`credential.status`、`doctor.run`；最近诊断返回 `success` | 继续保持 submit gate 关闭，提交需单独授权 |
| Sonora live submit | `disabled by default` | 只读诊断与任务读取通过；历史曾有 `credential_missing` | 不调用 `voice.audition`，等待独立 canary 门 |
| 三 owner task observation | `passed: real read-only` | loopback Control Center + current owner endpoints；active=0、history=45；Eikona detail/events/artifact 通过，Sonora detail/events 通过但 artifact 被 `content_not_authorized` 拒绝，Scaena 当前无任务可供 detail/events 复验 | 保持 submit/cancel 关闭；补充 Scaena 真实任务或 owner 明确的空任务证据 |
| 25 项服务目录 | `5 integrated, 20 not_integrated` | 本地目录：3 个任务观测、1 个请求投影（Aigora）、1 个收集投影（Auctra） | owner 合同逐项验收 |
| 部署交付 | `control-center only: activated` | 2026-10-22 经用户明确授权发布（evidence `control-release-2026-10-22T15-35-16-840Z`）：候选构建、组件验证、HTTPS 健康与资源指纹回读均通过；`previous_release`（10-21 版）保留用于回滚；迁移 0005–0008（共享组织/项目、成果目录、批次与动作记录表，以及 `task_notifications` 新增 3 列，均为加法）已应用，发布前先在真实配置库的副本上演练：候选包启动后迁移 5→9、既有表行数不变、完整性检查通过，并确认当前线上版本也能在升级后的结构上启动，所以回滚只需恢复 unit；发布前另存了一份恢复点备份；`authenticated_read=false`，未做真实认证读取；owner 服务不在此发布范围内 | 认证后的真实读取复验；此次发布带上了尚未提交的共享项目切片，源码不在 git 中，只在发布目录里 |
| Provider live submit | `disabled by default` | action manifest 与预算门 | 三 owner live gate |
| 媒体预览缓存 | `implemented: session-only` | 浏览器会话内 LRU Blob/Object URL 缓存；scope、session epoch 和 grant expiry 隔离；服务端仍 `no-store` | 浏览器矩阵复验 Range 播放与 Blob 回退 |
| 提示词采集观察 | `owner-dependent` | 控制中心只规范化 owner 返回的 `prompt_capture`；未返回时显示未提供 | 各 owner 增量观察合同 |
| 中间过程检查点 | `owner-dependent` | `/tasks/{task}/events` 保留 observation、coverage、freshness、gap 和 reason | owner 返回真实 checkpoints |
| 来源覆盖状态 | `implemented: read-only` | Aigora、Scaena、Eikona、Sonora 分别显示可读、不可用、无权限、过期或待合同 | 真实 owner 观察逐项更新 |
| 统一 action contract | `implemented: local contract` | `/actions` descriptor、preview、confirm、receipt readback；任务取消、Provider run、个人用户动作接入；审阅/交付/Owner 管理动作明确返回 `needs_contract` | 各 owner adapter 合同与独立授权 |
| Auctra collection projection | `implemented: local contract` | collection scope binding、body-free snapshot/record API、本地 metadata index 和显式同步 | collection event source 与浏览器旅程仍独立验收 |
| 剧本到分镜 owner flow | `implemented: owner-contract slice` | Auctra `creative.flow.read`、Scaena strict storyboard projection、`yeisme.creative_flow.v1`、episode-safe lineage、queue/Inspector/safe launch | real-owner read、malformed projection、browser journey 和完整链路证据 |
| 剧集制作看板（`/drama`） | `implemented: read-only, published; fixture-verified, real environment unbound` | 剧集全集取自 Auctra 收集库的剧本类 text unit；五节点阶段链（剧本、导演计划、创意分镜、制作交接、制作拆解）、下一步（谁来做什么）、分镜结构（场景标题与镜头景别/角度/运镜/时长，不含 `action_summary`、媒体与 prompt）、关联任务、安全交接；可在读取时指定 Scaena 使用的集引用；`GET /drama/episodes`、`GET /drama/episode`；每次最多实时读取 8 集、并发 4、45 秒身份隔离缓存；单元 `tests/drama*.test.ts`、合同集成、浏览器旅程、视觉矩阵；变更 `yeisme-control-center-drama-board-v1` | 真实只读复验（2026-10-22，`real-owner-read-2026-10-22T15-39-58-054Z`）：三个 core owner ready，看板路由 200，`universe` 为 `bound=false`、`needs_contract`、`source_not_configured`，45 条真实任务都没有 `episode_ref`，所以没有剧集可列；真实队列里没有流程项，也不再有“流程暂不可读”的假缺口。要看到真实剧集需要：配置 Auctra 收集（服务端 `collection.auctra` 加范围绑定，Auctra 需提供 `POST /v1/operations/{op}:invoke`）、服务端 `owners.scaena`，并在“服务与连接”同步收集——这些涉及凭据与授权，未做；生成、审阅、交付没有 owner 读取合同，阶段链标“待合同”；共享项目范围没有 Auctra 绑定，需单独迁移变更 |
| 工作队列与跨项目交接 | `implemented: local + owner projection` | `yeisme.work_queue.v1`、单一派生队列、revision 去重、流程链 Inspector、Auctra/Scaena/MuWeave 安全 LaunchContext | 合同集成、浏览器旅程和现有真实只读门 |
| 工具目录（模型与工具） | `implemented: read-only discovery` | `yeisme.tool_catalog.v1`：分页 tools/list、Eikona runtime capabilities/模型快照/渠道、Sonora 动作注册表与 readiness、Scaena 渠道与 latest_policy；按 owner 缓存、强刷限频、stale 回退；首次读取只建基线的变化账本；单元测试、合同集成和 fixture 浏览器旅程覆盖 | 真实只读已复验（2026-10-21）：Scaena、Sonora 可读；Eikona 为 `partial`，因为已部署版本尚未提供 `eikona://models/readiness` 与 `eikona://channels`（owner 返回 unsupported resource collection）；已部署的 Scaena guide 尚无 `channels[]`；三个 owner 都还没有声明 `latest_ready`，页面显示“状态未声明”。下一道门：owner 部署工作树中的渠道/模型快照资源。Aigora model-directory、MCP Gateway `/v1/tools`、Auctra Pi runtime 仍为 `needs_contract` |
| AI 创作能力推导 | `implemented: discovery-derived` | 不再读取 owner 未实现的 `creative-input/contract`；模式只来自启用的 Scaena binding 和可用的 Eikona/Sonora 动作 | Provider 提交门保持关闭 |
| 视觉系统 v1 | `implemented` | 经校验的 owner 图表色板、与状态色分离的 kind 色、文字角色、PageToolbar/DataTable/StatCard 等共享原语、枚举标签字典、Inspector 焦点陷阱、命令面板目录搜索；before/after 截图矩阵 | 浏览器 CI 矩阵 |

## 证据边界

- transport ready、配置存在或 `tools/list` 成功不等于业务 ready。
- Provider discovery、binding 可用、Provider canary 成功和业务提交权限分别登记；任何一项不能替代另一项。
- fixture、fake MCP、浏览器 mock 只证明客户端行为和合同边界；`bun run preview:fixture` 是开发用夹具预览，夹具 scope 标签带 "Fixture"，应用本身没有 demo 模式。
- unknown 结果只能查询原引用，不得自动重新提交。
- 真实 Provider canary、owner 凭据、部署和发布是独立授权门。
- 最近一次真实只读证据由 `bun run test:owner-live-read` 生成，保存在 `temp/integration-test-runs/real-owner-read-*/`；证据不包含凭据、Provider payload 或真实提交。
- race 检测不属于本项目默认验收。
- `test:task-visibility` 是针对界面重构前版本的遗留门：它断言已被替换的界面（旧区域与标签名、Studio 返回链接、浏览器通知开启流程），在当前界面上登录步骤就会失败，不作为验收依据。等价覆盖由 `test:browser-journey` 和 `test:contract-integration` 提供；CI 自 2026-10-21 起改为运行这两项，该脚本保留但不再由 CI 执行。
- 媒体缓存只存在于当前浏览器会话；不写入 IndexedDB、localStorage、服务端磁盘或发布工件，缓存命中不能提升为新的业务证据。
- owner 未返回提示词采集或中间检查点时，页面显示“来源没有提供提示词采集观察”或“来源尚未返回中间检查点”，不会从任务数量、历史成功或 Provider 目录推导。
- action contract 的 `needs_contract`、`unknown`、`conflict` 和 `unavailable` 保持可见；不会把 Preview 或队列数量当成真实 Owner 写入成功。
- 工作队列是当前 scope 的派生投影，不是任何 owner 的任务真源；创作流程不进入 Notification Ledger；Muweave 直接读取仍为 `needs_contract`。
- 剧集制作只读：Auctra 与 Scaena 都要求 `episode_ref`，所以队列不再发不带集引用的流程读取（它在真实 owner 下只会失败，并让首页常驻“流程暂不可读”）；改读最近更新的 ≤3 集，未开始、进行中和“待采纳”的阶段不进队列。Auctra 在阶段未全部通过前把流程 coverage 报为 `partial`，这是流程进度，不是数据缺口；owner 整体读不到时，剧集只显示“读取失败”，不会显示为已推进。
- 三套剧集引用（Auctra unit id、Scaena 拆解 `episode_ref`、Scaena projection id）不能默认相等，只有可选的 `--auctra-handoff-ref` 路径强制相等；看板按 Auctra 引用读取 Scaena，不一致时由操作员在读取时指定，不落库、不写 owner。

## 请求内容可见性（yeisme-request-content-visibility-v2，2026-10-17）

| 项 | 状态 | 证据 | 阻塞 |
|---|---|---|---|
| 每 owner 服务凭据委托 | `PHASE_PASS` | `tests/owners-delegation.test.ts` 5/5；personal 会话经 `credential_ref` 读取三 owner + Aigora | 无 |
| 附件正文（Eikona 合同） | `PHASE_PASS` | `tests/attachments.test.ts` 7/7；字节走 120s 媒体句柄、文本内联、审计先行 `requests.attachment_read` | 无 |
| 前端附件读取/预览 | `PHASE_PASS` | RequestDetail 附件区（文本/图片/音频/视频预览）；typecheck + 141 tests | 无 |
| fake owner 附件链路 | `PHASE_PASS` | `bun run test:contract-integration` 20/20（服务凭据通道、无 shim） | 无 |
| Scaena 业务正文归档 | `PHASE_PASS` | `agent/scaena` `scaena-request-content-archive-v1`：委托任务 prompt 幂等归档，content:read(input) complete、跨 actor/输出/历史 not_recorded、每次读取审计 | Scaena 附件正文合同（S2 挂账） |
| Sonora 业务文本读取 | `PHASE_PASS` | `cli/sonora` `sonora-request-content-lines-v1`：language-plan 行文本经 content:read(input) complete、输出/无 plan not_recorded、回执 outcome 完整 | Sonora 上传附件合同（N2 挂账） |
| 跨 owner 全链路 | `PHASE_PASS` | `bun run test:contract-integration` 20/20（服务凭据通道：Eikona 正文+附件、Sonora 文本、Aigora 归档、审计、epoch） | 真实 owner 回读（I3 模式）按授权另行执行 |
