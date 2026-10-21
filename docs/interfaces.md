> 当前 admin-v3 的管理台、多用户与请求统计增量见 [admin-interfaces.md](admin-interfaces.md)。本文保留前轮基础设计，冲突处以本轮规格为准。

# 接口与 owner 实施交接

## 当前交付层级

本轮实现前端交互和设计合同，没有部署聚合服务、账户、生产认证或后端管理接口。Scaena/Eikona/Sonora MCP 可用作为用户给定现状，已有 discovery 在设计调查中读取；不将其提升为所有管理动作已支持。`src/contracts.ts` 是拟议消费投影，不代表已发布 wire schema。

## 接线边界

浏览器通过自己的同源会话访问聚合接口，服务端调用固定注册的 owner API/MCP。每个 owner 必须把当前用户映射到有效 principal、project 和 action scope；中央 UI 角色不增加领域权限。会话使用 HttpOnly cookie、CSRF 与服务端检查；身份服务复用协议，不假设多个产品共享 cookie 或 grant。

聚合层只做认证、范围映射、固定动作适配、展示转换与有界缓存；不拥有第二任务调度器、账本、资产库或配置真源，不访问 owner 私有存储，不接受浏览器传入可执行程序、任意 URL、参数列表或 Provider payload。注册表与凭据引用由受控服务端配置提供；Aigora 继续拥有网关 registry、路由、policy 和 MCP 迁移。Runtime Plane 是实验性本机 broker，不自动成为远程控制中心依赖。

媒体预览的有界缓存只属于浏览器当前会话。它缓存已经通过 artifact grant 授权的 Blob/Object URL，不缓存 owner 地址、凭据或原始 Provider payload；缓存到期、登出和 scope/session epoch 变化时必须清理。过程观察投影只保留 owner 明确提供的提示词采集和中间检查点，并携带 coverage、freshness、gap 与 reason；缺失字段保持未知或未提供。

## 最小消费合同

### 工作队列与跨项目交接

控制中心通过 `GET /api/control-center/v1/work-queue` 读取当前授权范围的派生工作项。接口支持 `scope`、签名 `cursor`、`limit`、`kind`、`owner` 和 `state`，返回 `yeisme.work_queue.v1`、session epoch、来源覆盖度、统计和安全引用。

工作项来自任务、提醒账本、服务观测和 owner typed projection，不写入 owner 状态，也不创建第二任务真源。剧本到分镜链路消费 Auctra `creative.flow.read` 与 Scaena `storyboard_workspace_projection.v1`；同一 revision 按 scope/owner/object/source/revision 去重。点击工作项先打开控制中心 Inspector；跳转 Auctra、Scaena 或 Muweave 使用 `yeisme.control_center.launch_context.v1`，不接受任意 URL。Muweave 尚无直接读取合同时显示 `needs_contract`。

工作项动作只显示 allowlist 中的 Preview。Preview 只返回规范化输入、digest、阻断原因和所需审批，不代表 Owner 已写入；Confirm、Provider 调用、凭据变更和账本写入仍由既有独立合同与授权门控制。

### Auctra authoring owner

Auctra 作为文本创作 owner 使用独立的 `authoring` scope binding，不加入媒体 request owner union。服务端固定调用 Auctra `/v1/authoring/capabilities` 和 `/v1/operations/{operation_id}:invoke`，浏览器只调用同源 `/api/control-center/v1/auctra/*` 投影。正文读取必须携带 opaque `unit_ref` 与 byte budget；候选生成、working-copy 写入和 review decision 复用 preview/confirm/receipt，Control Center 不写 `.auctra`、SQLite 或本地文件。

## 统一写入动作合同（本地实现）

控制中心的写入入口只接受服务端 allowlist 中的动作。浏览器不能提交任意 Owner 路径、MCP action 名称、凭据或 Provider 原始 payload。

```text
GET  /api/control-center/v1/actions?scope=<scope_id>
POST /api/control-center/v1/actions/preview?scope=<scope_id>
POST /api/control-center/v1/actions/confirm?scope=<scope_id>
GET  /api/control-center/v1/actions/receipts/<receipt_ref>?scope=<scope_id>
```

Preview/Confirm 使用 `scope_id`、`owner`、`target_kind`、`target_ref`、`action`、`expected_revision` 和稳定 `idempotency_key`。Preview 只返回规范化输入、摘要、过期时间、阻断原因和所需审批；Confirm 只在 Preview 仍有效且摘要一致时执行。

当前控制中心本地可执行的动作是任务取消、Provider run 创建/对账和个人用户管理。审阅、交付、Owner 配置与成员动作已经进入 allowlist，但在对应 Owner adapter 合同发布前返回 `needs_contract`，不会用本地状态伪造成功。

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
| 视频原任务读取、对账 | 已发现 getVideoProviderTask / reconcileVideoProviderTask；项目 video-tasks 资源 | 原 submission_ref，不发第二次 paid create；版本与幂等依原合同 | 消费适配待实现；测 unknown 恢复、重复请求、scope 切换 |
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

正式产品先实现同源会话和安全范围、三媒体 owner 的只读聚合、原任务恢复，再按矩阵补齐管理写接口。每个适配器完成自己的契约、权限、普通集成测试和用户入口验证后独立升级状态。原型模拟成功、源码测试、真实 owner 联调、Provider 执行与生产部署分别记账。

根仓仅维护跨项目准入与链接，客户端实现和证据归未来控制中心 owner，领域接口归各子项目 OpenSpec。新结构化配置、schema 或回执通过 CLI/脚本生成；本轮不创建远程仓库或执行部署。
