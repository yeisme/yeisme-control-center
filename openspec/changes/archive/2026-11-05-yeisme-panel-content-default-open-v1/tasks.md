# 实施与验收任务

- [x] 1.1 内容默认放开 | evidence: `server/task-connections.ts`、`server/media.ts`、`server/service-directory.ts`、`server/contracts.ts`；connect 默认 `--no-content` 退出；`bun run test` 104 文件/979 用例通过。
- [x] 1.2 owner 读取目标命令 | evidence: `scripts/personal-config.ts` 新增 `owner add|remove`（含生命周期与 `--private-http`）；`bun run typecheck` 通过。
- [x] 1.3 线上配置与发布 | evidence: `owner add eikona http://10.10.1.101:18976 .../control-center-rest.key --private-http --expires-at never` 写入；发布 `control-release-2026-11-05T11-18-54-564Z` 激活（tls_verified=true），健康 200。
- [x] 1.4 历史整理完成 | evidence: Eikona 四个项目 `index_more=false`（默认工作区 59 条、proj_7fab 5 条）；Sonora/Scaena 待各自 owner 签发读取凭据。
