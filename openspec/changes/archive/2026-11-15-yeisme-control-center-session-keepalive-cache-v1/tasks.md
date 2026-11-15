# 任务

- [x] 1.1 [BACKEND] 扩展 sessions schema 与迁移，增加 `remembered` 字段，保持旧记录默认 false；验证 `bun run db:generate` 与 DB store 重启读取。
- [x] 1.2 [BACKEND] 增加 remembered 登录期限与空闲清理策略；保留撤销、credential version、epoch、绝对期限和每账号会话上限；验证 session-hardening/login-limits。
- [x] 1.3 [CONTRACT] `/auth/personal` 接受可选布尔 `remember`，非法类型仍 400；登录响应继续只下发 HttpOnly cookie，不回传凭据。
- [x] 2.1 [FRONTEND] 新增可见页 session heartbeat，focus/visibility 恢复立即刷新，单飞且网络错误不清除已有 session；验证 heartbeat 单元测试。
- [x] 2.2 [FRONTEND] 登录页增加默认勾选的“记住此设备”说明，明确 30 天/7 天边界和不存凭据；更新 API/workspace 类型。
- [x] 2.3 [FRONTEND] 复核 scope/session epoch 缓存隔离和 logout 清理，不把登录凭据写入 localStorage/sessionStorage。
- [x] 3.1 [QUALITY] 补齐 remembered session、heartbeat、数据库迁移和网络抖动行为测试。
- [x] 3.2 [QUALITY] 运行 `bun run typecheck`、聚焦 Vitest、`bun run build`，再运行控制中心最终测试门。
- [x] 4.1 [DEPLOY] 使用现有内网发布流程构建候选、重启控制中心并做真实登录/刷新/等待回读；需独立部署授权与证据，不以本地构建代替线上生效。 | evidence: 2026-11-15 线上真实回读（复验账号 release-probe，viewer）：代码随 2026-11-11 的发布上线（迁移 `0016_salty_chat.sql`），当前线上 `control-release-2026-11-12T11-54-29-409Z` 仍包含；勾选记住此设备登录 200，cookie `HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`，会话行 `remembered=1`、绝对期限为登录后 30 天；`/session` 200，等待 90 秒后再读仍是 200，`last_seen` 13:38:33→13:41:26，绝对期限不变；对照的不勾选登录 `Max-Age=43200`、`remembered=0`；两次登出都是 200，之后 `/session` 401，复验账号会话数为 0。7 天和 30 分钟的空闲过期没有在线上等待，由单测覆盖。
