# Proposal

将 Auctra 接入 Yeisme Control Center 的正式 owner 目录和文本创作信息收集。Control Center server 通过固定的 collection binding 显式同步投影并执行本地 metadata preview/confirm；浏览器不接触 Auctra 凭据，不复制正文或领域状态。

## Goals

- 提供作品/文本单元/candidate/review/version/run/export ref 的 scope-bound、body-free collection projection。
- 在 Control Center 本地保存脱敏索引，并复用 action preview、confirm、receipt 和 audit 管理确认、归档、标签和备注。
- 只提供服务详情中的收集状态与显式同步入口，不增加小说工作台或正文阅读页面。
- 明确 `complete`、`partial`、`needs_contract`、`forbidden`、`unavailable` 和 `unknown`。

## Non-goals

- 不把 Auctra 加入媒体 request owner 的状态模型。
- 不接受浏览器任意 URL、MCP action、路径、凭据、正文或 provider payload。
- 不在 Control Center 写入 Auctra SQLite、`.auctra` 或正文；本地只保存 collection metadata index。
