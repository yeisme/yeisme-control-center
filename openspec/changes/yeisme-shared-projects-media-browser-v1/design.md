## Context

现有 React、Tailwind、Radix、图标和 Inspector 继续使用。同源服务已采用 SQLite/Drizzle，actions preview/confirm/receipt 是写操作合同。任务、媒体字节和业务成员仍归 Eikona、Scaena 等 owner。

## Goals / Non-Goals

目标是组织隔离、稳定授权与可恢复操作，提供创建项目、分配、成果整理和显式预览的可审阅本地实现。控制中心不新增生成队列、Provider adapter、媒体存储或 owner 业务权限。

## Decisions

### 授权与身份

本地成员键为 issuer 与 subject 的组合；目录不按名字或邮箱合并。组织成员暂停立即撤销项目访问。角色为组织管理员、项目管理员、创作者和查看者；团队与个人 grant 取权限并集。绑定只能来自当前管理员现有的明确源 scope。每次 owner 数据访问还检查接收者原有源 scope，因此共享 grant 不授予新的 owner 权限。

owner 成员目录额外要求非个人、未过期且 audience 匹配的会话；在服务凭据解析前拒绝不合格会话。配置未开放 OIDC 时不显示组织登录入口。

### 写入与恢复

actions 绑定稳定主体、当前 scope、目标、预期版本及幂等键。协作变更与回执处于同一 SQLite 事务。外部调用先持久化开始标记；不确定结果返回 unknown，禁止静默再次调用。原始生成输入只在短暂内存与 owner 中存在；输入交接的持久回执只包含 owner 引用和摘要。

批次在提交前重新查询 owner 计划、检查输入摘要和当前绑定。未知费用、币种不匹配、预算不足、项目禁用及缺少 owner 权限均阻断。费用保留按项目累计，成功、部分失败和未知状态均保留原关联，不推定收费已经撤销。

### 文件与缓存

自动目录是查询视图；手动目录只移动引用。去重键包含项目、owner、实例、任务、artifact 和 owner 提供的媒体版本。缺少版本时不虚构版本。引用保存可重新解析的任务定位信息，服务重启后不依赖旧进程的 task key。

缩略图必须使用独立衍生图；不支持的 owner 返回 needs_contract。Eikona 使用原 owner 授权后生成最大 256 像素 JPEG，短时缓存与授权链接均留在 owner。控制中心另限制缩略图传输大小和 MIME。图片、视频预览保持显式操作，视频沿用 Range 路径。

缓存仅在页面会话内存在；主体、组织/项目、权限版本和媒体版本构成身份与键。切换范围、退出和权限变化立即清空，旧加载结果不会重新写入缓存。

### 通知与筛选

继续使用 task_notifications 一个账本。稳定接收者跨登录保持阅读状态；阅读不改变 acknowledge/mute/archive。浏览器只提议任务 key，服务端重新读取 owner 后才接纳失败事实。历史同指纹记录展示去重，旧 ID 继续可读。

共享 FilterBar 提供 300ms 搜索、可搜索多选、日期、条件标签和重置；同字段 OR、跨字段 AND。URL 保留条件与目录，条件变化取消旧请求并重置分页。成果分页 cursor 绑定主体、权限版本、项目与过滤条件，来源覆盖不足时明确显示部分结果。

## UI Spec

使用现有中性表面、语义 tokens、紧凑控件和 Radix 焦点管理。项目和成员采用工作列表；创建、权限差异与写确认使用 Sheet。文件浏览器在桌面显示目录、面包屑、网格/列表与详情，窄屏目录进入 Sheet。通知桌面 Popover、手机 Sheet；单击选择不会播放媒体。

验收视口为 390、768、1440、1920，明暗主题均检查无横向溢出。覆盖加载、空集、无匹配、失效、无权限、暂不可用、选中、键盘、焦点返回与显式预览。复用 Vitest/Playwright；不新增 Storybook、浏览器框架或新的 UI 栈。

## Migration Plan

运行 `bun scripts/migrate-collaboration.ts --config <path>` 预览，显式 `--apply` 才写入。每个明确 tenant/scope 单独建立组织及项目，保守保留原授权；相同名称或相同 owner 引用不合并。歧义 scope、缺少有效管理员等记录留在原入口。迁移可重跑并通过稳定键去重，不自动在启动时执行，也不迁移或删除旧通知 ID、任务和回执。

## Risks / Trade-offs

- Eikona 新输入先作为 owner 待审提示词保存，不冒充人工接受；owner 的 prompt readiness、价格和付费开关继续决定能否生成。
- Scaena 当前直接视频合同要求未知费用确认，无法满足普通创作者的已知费用准入。视频成功路径、参考 binding 选择仍需 owner 合同补齐，不用伪造报价替代。
- 手动目录没有删除入口，避免在无授权情况下丢弃业务引用。
- 真实委托、真实付费生成、部署和三方 owner 可用性不能用本地 fixture 或编译证明。
## 2026-10-21 后续合同与实现交接

本轮只补方案、接口设计和任务，不修改运行代码。现有共享协作切片保留；批次分页/detail 由 [completion 变更](../yeisme-control-center-completion-v1/design.md) 拥有，参考选择和视频固定计划仍由本变更 4.3/4.2 及 6.x 任务拥有。完整请求/响应/错误与兼容提案见 [前端接口补齐](../../../docs/frontend-api-completion.md)。

| 交接 owner | 必须冻结的最小合同 | 消费任务与停止条件 |
| --- | --- | --- |
| Scaena | 固定 input ref/digest、plan、绑定 exact 输入/模型/参数的 known quote（币种/精确金额/期限）、submit/原操作读取、成员与结果、授权封面/媒体 | 4.2、6.1 先完成；6.2/6.3 才适配两端。只返回 unknown-cost acknowledgement 时继续阻断普通提交 |
| Eikona / Scaena | 参考 binding 目录、exact ref/revision/digest、role、权利状态、模态/数量上限、preview/thumbnail access 和撤权版本 | 4.3 先完成；6.4/6.5 实现 BFF 与选择器。无目录或 grant 返回 needs_contract，不接受本机路径/任意 URL |
| Control Center | 共享 TypeScript DTO、错误映射、权限/epoch/cursor、原批次和预算 reservation 恢复 | 类型先冻结，typed client/server/fixtures 复用；6.6 验本地，7.1 验真实组织，付费与部署沿原对应变更 |

owner 动作名、运行命令和 schema 版本必须以各 owner 实际公布合同冻结；上述字段是交接要求，不是宣称现有上游接口已支持。领域实现与 owner 本地测试留各子项目 OpenSpec，本变更不直接写对端代码或数据库。

