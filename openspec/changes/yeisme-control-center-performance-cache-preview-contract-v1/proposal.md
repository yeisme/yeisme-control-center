# 控制中心性能、缓存与媒体预览合同收敛计划（T0）

## Why

控制中心已经有若干局部实现：观察读模型在内存中做 stale-while-revalidate，媒体预览在当前会话内保存 Blob/Object URL，缓存键包含范围、会话 epoch 和对象引用；服务端媒体响应仍以 `no-store` 和短时授权为边界。现有页面也已经把 `needs_contract`、`forbidden`、`unavailable`、`stale` 等状态分开显示。

但这些事实散落在页面、缓存工具、API client 和说明文档中，还没有一份能被后续实现共同消费的性能/缓存/预览合同。尤其缺少：

- 哪些缓存是控制中心本地派生物，哪些内容仍归 owner 真源；
- scope、session epoch、generation、revision 和 digest 的失效边界；
- 预览必须经过何种明确用户意图、授权、过期和 MIME/Range 边界；
- owner 尚未发布目录、grant、内容 revision 或撤权语义时，控制中心如何保持 `needs_contract`；
- 性能目标、缓存指标和回滚方式如何记录而不把本地 fixture 或旧线上证据冒充当前 owner 合同。

本变更是 T0 的合同收敛计划，不是代码实现、owner 适配、压力测试或发布。它只冻结后续工作应回答的问题、能力归属和兼容边界。

## What Changes

- 新增一份能力 ledger，逐项标记 `fit`、`split-owner`、`blocked`、`reject-now`，并为每项写明 canonical owner、当前证据、合同缺口和下一步。
- 定义控制中心本地缓存的身份边界：至少受 `scope_id`、session epoch 和本地 generation 保护；退出、切换范围、权限 epoch 变化和会话替换时清理受影响的缓存。
- 定义媒体预览的消费边界：预览是显式动作，不是列表读取或搜索的副作用；短时 grant、同源代理、过期/撤权重验、MIME/Range 和 Object URL 生命周期均不得越过当前会话。
- 定义可兼容的合同演进方式：保留已有 owner 状态与旧字段语义，新增字段只能通过版本化、可识别的 projection/adapter 引入；缺合同时 fail closed，不猜 URL、字段、权限或成功结果。
- 给出后续实现、只读 fixture、合同集成和真实只读验收的分层任务，以及禁用新路径、清理新缓存键和回到既有安全路径的回滚方案。

## Capability ledger

| 能力 | 归属 | canonical owner | 当前事实 | 合同缺口 / 下一步 |
| --- | --- | --- | --- | --- |
| 读模型缓存、去重、stale 展示 | `fit` | Control Center | `ObservationCacheStore` 在页面内存中按 key 保存 fresh/stale 和在途请求；scope/generation/session epoch 会触发清理 | 尚无统一 TTL、容量、指标和跨页面语义。下一步由 Control Center 冻结本地 cache-key/TTL/失效合同并补 focused tests |
| 媒体 Blob/Object URL 生命周期 | `fit` | Control Center | `MediaSessionCache` 只在会话内存保存，按范围/epoch/任务/产物/MIME 建 key，并在过期、切换范围、退出时清理 | 需要把清理、迟到结果、上限和撤权后的行为写成可测合同；不进入 durable cache。下一步由 Control Center 冻结并在本地 fixture 验证 |
| 原始媒体、权利和内容 revision | `split-owner` | 产生该任务/结果的 owner（Eikona、Scaena、Sonora 等） | 控制中心只消费 owner 明确返回的引用、授权结果、revision/digest 和状态 | owner 尚未统一发布目录、grant、Range、撤权和 revision 语义。下一步由各 owner 发布只读内容/授权合同，Control Center 再做 typed adapter |
| artifact preview grant 与同源代理 | `split-owner` | 访问授权由对应 owner 决定，传输审计与代理边界由 Control Center 承担 | 当前路径使用短时控制中心句柄和同源 `/media/`，服务端 `no-store`；浏览器不接收 owner 原始 URL/token | 缺少跨 owner 的最小响应、过期码、重授权和 Range 语义。下一步先收 owner 合同，再冻结本地 adapter；不得用本地句柄冒充 owner grant |
| 预览交互与安全状态 | `fit` | Control Center | 列表/搜索不自动读取媒体；显式 preview/download 才进入授权流程，失败状态保持可见 | 需要统一 `needs_contract`/`forbidden`/`expired`/`unavailable`/`stale` 映射及可访问提示。下一步由 Control Center 做 projection contract 和浏览器 fixture |
| owner 目录、任务和结果真源 | `split-owner` | 各领域 owner | 控制中心是聚合和派生投影，不拥有 owner 任务或原始内容 | 目录分页、来源覆盖、授权范围、revision/digest 尚未逐 owner 冻结。下一步由 owner 提供合同；在此之前保持空投影 + 缺口，不返回示例数据 |
| 性能预算与观测 | `fit`（只负责本地消费指标） | Control Center；owner 延迟仍归 owner | 可在本地记录请求去重、缓存命中、等待和响应大小等脱敏指标 | 尚无基线、阈值、采样和不泄露内容的指标合同。下一步冻结本地指标名与验收阈值；不对未测 owner 延迟作承诺 |
| 领域写入、付费、部署和真实 owner 验收 | `reject-now` | 对应领域 owner / 发布 owner | 本变更没有写入、Provider、授权变更或部署权限 | 不得借 T0 文档生成执行能力。下一步是独立授权后的 owner handoff 和只读合同验证 |

## Canonical owner 与合同声明

- **Control Center** 是本变更中文档、缓存生命周期、本地投影、预览 UI 状态映射和 fail-closed adapter 的 canonical owner。
- **原始媒体、内容权利、任务状态、revision/digest、目录和 owner grant** 仍由产生它们的领域 owner 负责。Control Center 不因已有页面或历史 fixture 获得这些真源的所有权。
- owner 尚未发布或本 checkout 未能验证的字段、端点、错误码、权限、TTL 和撤权行为一律记为 `needs_contract`/`blocked_dependency`；本变更不伪造 owner 合同，不把拟议 DTO 写成已发布 API。

## Scope / Non-goals

本轮只交付 proposal、design、tasks 和增量 spec，并用现有 OpenSpec CLI 校验结构。明确不做：

- 不修改 `src/`、`server/`、数据库、迁移、测试 runner、构建配置或现有 docs；
- 不执行真实 owner 读取、Provider、付费、权限变更、部署或发布；
- 不运行 race，不访问真实 owner，不创建或更新 goal；
- 不引入 localStorage/sessionStorage 凭据、持久化原始媒体、owner token、任意 URL 下载或远程 Shell；
- 不把本地 cache key、fixture grant 或历史线上证据宣称为 owner canonical contract。

## Compatibility and rollback

兼容边界分为三层：

1. **缓存**：继续只允许当前会话内的派生读模型和媒体对象；旧页面的 owner 状态、`rows`、scope 和 epoch 语义不被重命名。新增 cache key 必须能识别旧/新 generation，身份不匹配时宁可 miss，也不能跨主体复用。
2. **预览**：保留现有显式 preview/download 入口与同源传输边界。未授权、过期、撤权、缺合同和暂时不可用不互相降级；不能以完整原图替代缩略图、以 owner URL 替代 grant，也不能把 preview 当作写入或 Provider 调用。
3. **合同**：新增 projection/adapter 采用显式版本和 additive 字段，原有 owner `state`/`native_state`/`revision`/`digest`（若 owner 提供）保持原样；未知、缺失或不一致字段进入 `needs_contract`，不猜测默认成功。旧客户端能继续读取已有安全字段，新客户端在看不到新合同证据时退回安全只读状态。

后续实现的回滚顺序为：先关闭新 preview/cache adapter 的 feature gate，再停止新合同路由的读取；保留已有 `no-store`、授权重验和旧只读列表；清理仅由新 generation 标识的内存条目和 Object URL，不删除 owner 数据、不撤销用户权限、不重放未知操作。若曾有本地加法迁移，必须先提供向后兼容读取和独立回滚迁移；T0 本身没有迁移，因此本轮回滚仅为“不采纳这些计划文档”。

## Acceptance of T0

T0 通过的定义只有：四份 OpenSpec artifact 结构完整、中文内容明确区分已知事实/拟议合同/owner 缺口、包含 Mermaid、ledger、canonical owner、兼容边界和回滚方式，并通过：

```bash
cd client/yeisme-control-center
openspec validate yeisme-control-center-performance-cache-preview-contract-v1 --strict --no-interactive
```

这不代表代码、owner 合同、真实读取、性能目标或部署已经完成。
