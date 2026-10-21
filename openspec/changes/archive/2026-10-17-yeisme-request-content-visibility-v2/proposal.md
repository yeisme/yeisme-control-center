# 请求内容可见性完善：提示词、消息数据、响应与附件

## Why

控制中心当前无法看到用户提交的提示词、消息数据与响应。根因是**委托断层**：请求正文读取要求会话携带 owner 委托令牌（OIDC access token + audience），内网 personal 登录两者皆无，导致请求列表、详情与正文全部 `delegation_unavailable`。前端正文 UI 与 owner 侧文本合同（Eikona/Scaena/Aigora）已就绪，附件正文合同仅 Eikona 有；Scaena 正文恒 `not_recorded`（无业务归档）、Sonora 文本与附件全未采集，由各自子项目变更补齐。

## What Changes

- **每 owner 服务凭据委托通道**：`config.owners[owner].credential_ref`（0600 用户级文件）；OIDC 会话委托优先，personal 会话以服务凭据 + scope binding 的 actor 读取；两者皆无才 `delegation_unavailable`。
- **附件正文接入（Eikona 合同先行）**：控制中心新路由 `POST /requests/{owner}/{id}/attachments/{ref}/content:read`，审计先行（新审计动作 `requests.attachment_read`）；文本附件直接返回，图片/音频/视频附件经 MediaBridge 字节句柄短期预览。
- **前端消费**：RequestDetail 附件区按需读取与内联预览；delegation 提示随凭据配置更新。
- **fixtures 与验证**：fake owner 补附件端点与服务凭据鉴权；contract-integration 扩展附件链路断言。

## 不做什么

- 不新增写操作、不自动重试、不把正文写入 localStorage/日志/服务端缓存。
- 不访问 owner 私有数据库；Aigora 附件不做透传（既定边界，归档业务文本提取已覆盖 prompt/响应）。
- 不在本变更实现 Scaena/Sonora 的 owner 侧合同（归各自子项目变更：Scaena 业务正文归档+附件、Sonora 业务文本+上传附件）；控制中心对未就绪 owner 如实返回 `needs_contract`/`not_recorded`。

## Impact

- 合同：`config.owners[owner]` 新增可选 `credential_ref`；新路由与审计动作向后兼容增量。
- 关联变更：`agent/scaena`、`cli/sonora` 各自 OpenSpec 变更补齐 owner 侧；本变更先行冻结线合同。
- Owned paths：`server/`、`src/pages/requests`、`src/shared/`、`tests/`、`scripts/fixtures/`、本变更目录。
