# 控制中心一次性免密直连邀请（`?token=`）与口令智能粘贴

## Why

控制中心（`client/yeisme-control-center`）在 Studio v21 中已支持网页端新建个人账号与重置访问 Key，但邀请同事或在其他设备登录时仍存在明显摩擦：管理员新建账号后需要把「用户名」和「`yk_live_*` 访问 Key」分别发给对方，受邀者打开登录页还要分别填入两个输入框；如果直接把长期 `yk_live_*` 放进链接又会导致聊天记录泄漏或二次转发失控。对齐 `docs/architecture/cross-project-invite-and-token-login.md` 与 DriveBridge 的成功实践，需要为控制中心补齐 **一次性免密直连邀请链接（`?token=yki_live_*`）+ 首帧地址栏脱敏 + 类百度网盘邀请口令智能粘贴**。

## What Changes

- **服务端一次性邀请票据存储与原子兑换（Drizzle + SQLite）**：
  - 在 `server/db/schema.ts` 新增 `personal_invite_tokens` 表（仅存 `token_hash` SHA-256、`username`、`created_by`、`label`、`expires_at`、`consumed_at`、`revoked_at`）与 `sessions.invite_id` 可选外键列，生成迁移 `0014`；
  - 新增公开同源兑换端点 `POST /api/control-center/v1/auth/invite`（受 `Origin` 校验、`LoginLimiter` 速率限制与 `audit_events` 审计保护）：原子校验票据未过期、未吊销、未消费且目标个人账号处于启用状态，单次兑换成功后立即置 `consumed_at` 并签发绑定 `invite_id` 的 `yeisme_session` Cookie；
  - 会话校验闭环：当某张邀请票据被吊销（`revoked_at` 非空）或目标账号被停用时，`SessionAuth.current()` 立即拒绝并清理对应会话；而目标账号正常轮转主 Key 不会误杀合法未吊销的受邀票据，反之吊销某张访客票据也不会影响账号本人的主 Key 会话；
  - 新增管理员管理接口：`GET /api/control-center/v1/admin/personal-invites`、`POST /api/control-center/v1/admin/personal-invites`（为指定已启用账号签发 1h / 24h / 7d / 30d 一次性邀请票据）、`POST /api/control-center/v1/admin/personal-invites/:id/revoke`，以及 `POST /api/control-center/v1/admin/personal-users` 支持可选 `issue_invite_ttl_hours` 在新建账号时一步同签发一次性免密直连链接；
  - `scripts/personal-config.ts` 新增 `invite <config-file> create <username> [--ttl 24h|7d] [--label ...]`、`list`、`revoke <id>` 命令行运维支持。
- **前端 `?token=` 自动注入脱敏与智能口令粘贴**：
  - 新增纯函数模块 `src/shared/url-invite.ts`：支持从 `location.search` 或 `location.hash` 提取 `?token=` / `?invite=`，首帧同步 `history.replaceState` 擦除敏感参数后自动调用 `/auth/invite` 完成免密进入；若票据已被使用或过期，停留在登录页并以清晰中文横幅提示原因；
  - 升级 `LoginScreen`（`src/app/auth.tsx`）：在用户名或访问凭据框粘贴整段邀请口令文案（如含 `用户名：lin.zhou` + `访问 Key：yk_live_...` 或含 `?token=yki_live_...` 链接）时，自动识别并一键兑换或双框回填；
  - 升级 `AccountsPanel`、`AccountForm` 与 `KeyRevealDialog`：新建账号默认可勾选「同时生成一次性免密直连邀请链接（7 天有效）」，账号行菜单新增「生成一次性邀请链接」，管理面板展示活跃/已使用邀请记录并支持一键吊销；展示弹窗提供「复制免密直连链接」「复制完整邀请口令」与「复制访问 Key」。

## Capabilities

### New Capabilities
- `personal-ephemeral-invites`：控制中心个人模式下的一次性邀请票据签发、SHA-256 持久化、同源 POST 单次原子兑换、会话级联吊销、CLI 子命令与审计记录。
- `invite-link-and-smart-paste-ux`：首帧 URL 擦除自动登录、多行邀请口令卡片一键复制与登录框智能粘贴解析。

### Modified Capabilities
- 扩展 Studio v21 `accounts` 管理面板与 `KeyRevealDialog`，保持原有用户名 + `yk_live_*` 密钥登录、`if_match` 并发控制与 `last_admin_required` 保护完全不变。

## Impact

仅修改 `client/yeisme-control-center` 下的 `server/`、`src/`、`scripts/`、`tests/` 与 `docs/`。不涉及任何下游领域 owner 凭据签发、不发起外部付费调用、不修改生产配置，遵循 SQLite Drizzle 迁移规范与零明文证据门禁。
