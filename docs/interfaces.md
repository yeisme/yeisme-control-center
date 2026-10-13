> 当前 admin-v3 的管理台、多用户与请求统计增量见 [admin-interfaces.md](admin-interfaces.md)。本文保留前轮基础设计，冲突处以本轮规格为准。

# 接口与 owner 实施交接

## 当前交付层级

本轮实现前端交互和设计合同，没有部署聚合服务、账户、生产认证或后端管理接口。Scaena/Eikona/Sonora MCP 可用作为用户给定现状，已有 discovery 在设计调查中读取；不将其提升为所有管理动作已支持。`src/contracts.ts` 是拟议消费投影，不代表已发布 wire schema。

## 接线边界

浏览器通过自己的同源会话访问聚合接口，服务端调用固定注册的 owner API/MCP。每个 owner 必须把当前用户映射到有效 principal、project 和 action scope；中央 UI 角色不增加领域权限。会话使用 HttpOnly cookie、CSRF 与服务端检查；身份服务复用协议，不假设多个产品共享 cookie 或 grant。

聚合层只做认证、范围映射、固定动作适配、展示转换与有界缓存；不拥有第二任务调度器、账本、资产库或配置真源，不访问 owner 私有存储，不接受浏览器传入可执行程序、任意 URL、参数列表或 Provider payload。注册表与凭据引用由受控服务端配置提供；Aigora 继续拥有网关 registry、路由、policy 和 MCP 迁移。Runtime Plane 是实验性本机 broker，不自动成为远程控制中心依赖。

## 最小消费合同

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
