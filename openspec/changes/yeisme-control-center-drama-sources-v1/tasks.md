# 实施任务

- [x] 1.1 BACKEND：`auctraConnection` / `scaenaStoryboardConnection`，`/drama/episodes` 的精确原因、`can_sync`、`complete`、`sources` 与 `sources_not_connected`。 | evidence: tests/drama.test.ts (unbound reasons, no-credential, sources_not_connected vs real failure)
- [x] 1.2 BACKEND：`syncCollection` 读完所有页（50 页 / 20 秒上限），partial 记录，`/auctra/collection` 的 `connection` 与 `last_sync`。 | evidence: tests/auctra-sync.test.ts 6 passed; contract-integration 27/27 with a two-record page size
- [x] 1.3 BACKEND：Auctra 读取按操作选密钥，`creative.flow.read` 不发 `project_ref`；服务目录复用连接判断。 | evidence: tests/drama-sources.test.ts "Auctra reader keys"
- [x] 2.1 CONFIG：`personal-config.ts auctra` 与 `status.auctra`（不打印地址与密钥）。 | evidence: tests/personal-config.test.ts Auctra cases
- [x] 3.1 FRONTEND：剧集页原因说明、查看连接方法、搜索直接打开、最近打开、任务引用按最近选取、内联同步与回执、“未连接”状态。 | evidence: browser-journey new checks passed; fixture probe screenshots 1440/390
- [x] 3.2 FRONTEND：“服务与连接” Auctra 面板连接状态、上次同步、禁用同步与管理员连接步骤、`?focus=auctra`。 | evidence: browser-journey "an administrator gets from the board to the Auctra connection steps in one step"
- [x] 4.1 文档：`docs/creative-flow-integration.md` 剧集来源、同步、连接 Auctra。
- [ ] 5.1 真实范围连接 Auctra 后复验全部剧集（需要管理员签发 Auctra 密钥、部署 Auctra 服务并运行登记命令）。
- [ ] 5.2 Auctra 侧：导演计划与分镜按项目级计数器的末尾数字匹配集（归 Auctra 的 OpenSpec）。

## 验证命令

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run build
CONTRACT_OWNER_PORT=4360 bun run test:contract-integration
bun run test:browser-journey
bun run check:public-surface
openspec validate yeisme-control-center-drama-sources-v1 --strict --no-interactive
```
