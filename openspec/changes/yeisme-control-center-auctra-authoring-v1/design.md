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
