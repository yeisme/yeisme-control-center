# 多用户、历史与统计接口交接

这是前端展示与工程交接设计，不是新增生产 API 的实现声明。能力归属为 split-owner：控制中心负责查询组合、显示转换和交互，各 owner 保留身份、成员关系、授权、任务、资产和账本。

## 已读取的来源与边界

| 页面能力 | 维护 owner 与源码合同 | 本轮接入结论 | 正式接线要求 |
| --- | --- | --- | --- |
| 网关请求、时间线与汇总 | Aigora operator-v1：observability/requests、summary、facets、timeline | 已核对本地 OpenAPI；未验证远端登录或运行数据 | 使用有界查询及服务端汇总，验证实际 filter/sort 支持，不能将一页记录当作全量统计 |
| 组织、团队、成员与角色 | Aigora tenant 管理、成员管理和 role catalog | 已核对安全投影、授权矩阵与负责人转移规范 | 查询当前用户可授予的角色；幂等键、原生错误和回执保留 |
| 团队、用户绑定邀请与归档 | DriveBridge server teams_model / teams_change、team-workspace 规范 | 已核对 admin/member、最后管理员和空间 custodian 独立保护 | expected_revision、用户绑定邀请、同一邀请续期与归档保护按 owner 合同执行 |
| 项目成员和访问授权 | Yeitra domain/team、domain.Role | 已核对 admin/editor/reviewer/viewer 与事务边界 | 保留项目 authorization revision；不能把其角色映射为全平台角色 |
| 图像任务历史 | Eikona /api/v1/runs、run lifecycle、workspace projection | 存在有界 run.list.v1；部分身份与跨项目统计字段需补齐 | 保留项目和授权域过滤，不能通过普通 run 查询读取 Scaena 受限域 |
| 视频任务与产出 | Scaena OperationProjection、production 与 asset workspace projection | 复用原任务、恢复、资产和证据引用 | 跨用户历史索引与汇总投影标记 needs_contract，不读取私有存储 |
| 音频任务与工作区 | Sonora verified workload identity、audio workspace projection | 主体、项目、授权 epoch 与只读投影已存在源码 | 发行者接入、跨用户历史统计与成员管理分别验收，不把 workload 主体直接当成通用用户目录 |
| 其他生态项目 | 既有 capability-matrix 中的 owner | 本轮保留覆盖与专业入口 | 支持程度不足时标记 needs_contract/local_only，不能伪造多用户或账务数据 |

以上“已核对”只表示本地源码或规范证据；正式服务的 deployed/enforced/verified 状态需要 owner 分别提供。

## 前端展示接口

新增 ManagementScope、RequestFact、HistoryQuery、Member 与组织演示状态。它们不是可直接透传的 wire DTO。正式适配至少需要：

- 范围上下文：受信任的环境、租户、团队、主体、owner 项目引用和授权版本。客户端传入范围只能收窄权限。
- 请求事实：owner + 原始 request/operation 引用、业务类别、原始状态、观察时间、明确调用者、父子关联和资产引用。缺少关联时返回未知或未关联。
- 用量事实：账单来源引用、币种、金额是否已知、结算状态和费用视角。客户费用与上游成本独立读取。
- 成员投影：owner、租户与资源范围、原成员引用、主体类型、原角色、状态、修订版本、可执行动作与不可执行原因。凭据和邀请秘密不进入客户端。
- 统计响应：与查询一致的时间窗口与过滤条件、分母、分组与样本数、来源覆盖、完整性、观察时间及下一页游标。现有 owner 不支持的分组需新增聚合合同。

角色 catalog 和动作可用性由 owner 返回；原型中的固定目录只是设计样例。Aigora 的暂停或原子负责人转移不被推断为 DriveBridge、Yeitra 的等价操作。DriveBridge 团队成员关系与文件空间权限必须分开接线。

跨项目主体只通过已验证的 issuer/subject 或显式绑定关联，不按邮箱或显示名称合并。平台管理员只有平台可授予的能力，仍需满足目标 owner 的授权。

## 查询与写操作

正式路径仍为浏览器 → 同源聚合服务 → 固定注册 owner API/MCP。聚合层只做会话授权范围映射、展示适配和有界缓存。列表、统计、搜索、导出和深链必须使用相同授权条件；浏览器不枚举所有分页构造生产全量统计。

所有写动作固定具名，携带 owner 版本和幂等引用。先预览影响，再确认，最后回读有效结果。版本冲突读取最新事实后重新预览，不自动重放旧变更。超时保持原操作引用，通过原结果查询恢复；只有明确的新尝试才单独确认费用。

跨 owner 批量动作逐项保留范围、权限检查、版本和回执；部分失败不整体展示成功，也不自动补交失败项。正式导出需要 owner 授权范围内的分页或导出合同，不能包含因列隐藏而应无权读取的费用数据。

## 实施验收入口

前端可在请求历史演练筛选、分页、保存视图、导出与详情；统计页演练原引用下钻；组织页演练成员变更、邀请、最后负责人保护、归档和配置冲突。设计演示菜单提供只读、失效、保存失败及版本冲突状态。

owner 后续交接需逐项附带真实认证测试、跨租户拒绝、角色授予矩阵、未知操作恢复、费用来源和读回证据。OpenDesign 的截图、内存回执或源码构建均不能代替这些证据。不得用远程 Shell 绕过缺失的管理合同。
