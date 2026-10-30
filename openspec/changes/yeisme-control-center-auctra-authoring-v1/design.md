# Design

## Binding

`ScopeBinding.collection.auctra` 保存 tenant/project/actor/audience；`ServerConfig.collection.auctra` 保存 origin、audience 和服务端 credential ref。OIDC delegation 优先，credential ref 只在服务端读取。Auctra 独立于媒体 `Owner` union，避免误入请求、用量和任务统计。

## Collection projections

- `GET /api/control-center/v1/auctra/collection`：读取本地 collection index，支持 record kind、state、label 和 cursor。
- `GET /api/control-center/v1/auctra/collection/records/{record_ref}`：读取本地 body-free record detail。
- `POST /api/control-center/v1/auctra/collection/sync`：显式从 Auctra 拉取 snapshot、upsert sanitized metadata、保存 cursor 和 coverage。
- Control Center 不保存正文、不打开文档、不持久化 prompt，不做隐藏 polling。

## Local metadata actions

`collection.record.confirm`、`collection.record.archive`、`collection.record.labels.set` 和 `collection.record.note.set` 进入现有 preview/confirm/receipt flow。ActionService 只改变 Control Center metadata index，并记录 scope、actor、时间和 CAS revision；任何 Auctra candidate/review/version 状态仍由 Auctra 管理。

## UI

不新增工作台入口。Services 页面中的 Auctra 服务详情显示收集覆盖、同步时间、fresh/stale/unknown/needs_contract/forbidden/unavailable 状态、记录列表和本地确认/归档动作。页面复用现有 scope/epoch guard 和 no-store API。

## Event source（等待 Auctra 发布）

截至 2026-10-30，Auctra 没有发布 collection event source，`cli/auctra` 的 OpenSpec 也没有相关提案。控制中心继续只做显式同步：不做隐藏轮询，不提供伪 SSE。

Auctra 发布的事件合同至少要写明以下几点，控制中心才开始做 SSE relay：

- **事件 id**：在 project 内唯一、单调递增，可作为 `Last-Event-ID` 的重放起点。事件体只含 record ref、kind、revision、digest、状态和时间，不含正文或 prompt。
- **游标与重放**：可以从游标处重放。游标过期时返回明确的错误码，消费方据此回退为一次显式 snapshot 同步，不静默丢事件。
- **scope 与 epoch**：事件按 tenant/project 过滤，授权口径与 collection snapshot 一致。
- **断线恢复**：给出心跳间隔与超时；重连带最后一个事件 id；超出保留期时要求重新同步。
- **撤权**：授权被撤销时，Auctra 关闭流并返回拒绝码。

合同发布后，控制中心按以下方式评估消费：

- 服务端对每个范围维持一条上游连接，扇出给浏览器。浏览器只连同源接口，不接触 Auctra 的 origin 或凭据。
- 转发前按当前会话的 scope 与 epoch 再过滤一次；epoch 变化或撤权时关闭浏览器连接，collection 状态显示为 forbidden 或 stale，保留本地索引但不宣称新鲜。
- 事件只触发本地索引的增量更新，与显式同步共用同一套清洗规则与 CAS，不改 Auctra 的状态。
- 事件 id 与 snapshot cursor 的对应关系由 Auctra 定义；对不上时以 snapshot 为准。
- 要有测试覆盖：断线重放、epoch 变化、撤权、游标过期回退、正文不落地。

在此之前，tasks 里“Auctra 发布 collection event source 后，再评估 SSE relay”保持 pending。
