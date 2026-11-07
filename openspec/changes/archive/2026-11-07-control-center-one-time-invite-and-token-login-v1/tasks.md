# 实施任务

- [x] 1.1 在 `server/db/schema.ts` 新增 `personal_invite_tokens` 表与 `sessions.invite_id` 列，生成并验证 Drizzle 迁移 `0014_rich_bishop.sql`。 | evidence: migration 0014 and schema validated by invite integration tests
- [x] 1.2 实现 `InviteStore`、`SessionAuth` 一次性票据签发/原子兑换/级联吊销、`auditActions` 扩展及 `/auth/invite`、`/admin/personal-invites` HTTP 路由。 | evidence: InviteStore, SessionAuth, audit actions and HTTP routes validated by tests/invites.test.ts
- [x] 1.3 在 `scripts/personal-config.ts` 补齐 `invite create|list|revoke` CLI 命令并更新 `docs/lan-deployment.md` 与 `docs/design/studio-v21.md`。 | evidence: CLI invite create/list/revoke implemented and deployment docs updated
- [x] 2.1 实现 `src/shared/url-invite.ts`（首帧同步提取脱敏、默认 `#token=` 零泄漏直连链接构建、多行邀请口令格式化与智能粘贴解析）及单测。 | evidence: URL extraction, scrubbing, link building and paste parsing validated by tests/url-invite.test.ts
- [x] 2.2 升级 `main.tsx`、`WorkspaceProvider` 与 `LoginScreen` 支持 `?token=` / `#token=` 自动免密进入、失效友好提示及登录框多行口令粘贴自动识别。 | evidence: token auto-login, invalid invite messaging and multiline paste parsing implemented
- [x] 2.3 升级 `AccountsPanel`、`AccountForm` 与 `KeyRevealDialog` 支持新建账号同步签发一次性直连链接、已有账号及主账号一键生成邀请、邀请状态列表与撤回踢下线。 | evidence: account creation, invite issuance, status listing and revoke implemented
- [x] 3.1 完成本变更全部修改文件零 TypeScript 诊断（注：并行在制的 `mcp-hub` 分支存在 2 处既有未完成类型项已按边界保持原样）、`bun run test`（128+ 文件全绿）、`bun run build` 与 `bun run test:accounts-journey`（12/12 通过，含 Axe 无障碍与零泄漏断言，证据：`temp/integration-test-runs/accounts-2026-11-07T03-42-37-027Z`）。
