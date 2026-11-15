# 日常管理交付

- [x] 1.1 CONTRACT：主原型、本地基线与全部现存服务目录；scope=src/service-directory.ts、docs/daily-management-baseline.md；依赖=无；验证=bun scripts/daily-management-spec.ts generate；预期=目录与文档一致，退役项目不登记；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查
- [x] 2.1 CONTRACT：个人身份、目录和交付边界；scope=server/contracts.ts、src/service-directory.ts、此变更；依赖=1.1；验证=openspec validate yeisme-personal-daily-management-v1 --strict；预期=合同完整，无 owner 越权；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查
- [x] 3.1 BACKEND：用户名、角色、受控目录与健康；scope=server/、scripts/personal-config.ts、tests/相关测试；依赖=2.1；验证=bun run test -- tests/personal-auth.test.ts tests/service-directory.test.ts；预期=成功、拒绝及兼容用例通过；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查
- [x] 4.1 FRONTEND：真实登录、全服务目录、设置与工作区；scope=src/相关组件、tests/相关测试；依赖=2.1；验证=bun run typecheck 及隔离浏览器验证；预期=六入口、异常状态和响应式可用；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查
- [ ] 5.1 INTEGRATION：核心三服务真实只读；证据 `temp/integration-test-runs/real-owner-read-2026-11-07T12-21-33-507Z/`：Eikona/Sonora 详情、事件和 artifact 读取通过，Scaena connection ready 但无任务（`no_task_observed`），故 Scaena task/result coverage 保持 INTEGRATION_PENDING；无 Provider submit/cancel。 2026-11-15 复查（`real-owner-read-2026-11-15T13-47-04-816Z`）：Scaena 仍为 0 活动、0 历史任务（`no_task_observed`），继续待定。
- [x] 6.1 INTEGRATION：独立完成当前候选本地工程与安全门，真实读取另验；owner=Control Center；scope=本项目现有测试入口与脱敏证据；依赖=3.1、4.1与当前本地实现稳定；不依赖5.1的外部样本；lane=串行；验证=bun run typecheck；bun run test；bun run build；bun run test:app；bun run test:browser-journey；bun run check:public-surface；预期=当前diff无新增失败、六件套齐全、不运行race；5.1未过只影响真实交付，不把旧141tests作为本次证据；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据 | evidence: 2026-10-30 当前候选（已发布 control-release-2026-10-30T01-13-07-675Z 的同一源码，之后只改 docs/tests/scripts）本地门：bun run typecheck 通过；bun run test 69 files/457 tests；bun run build 通过；bun run test:app 4/4（app-shell-2026-10-30T01-31-03-400Z）；bun run test:browser-journey 69/69（browser-journey-2026-10-29T19-01-47-783Z）；check:public-surface 0 findings；另 test:ci:browser 4/4、contract-integration 33/33、server-boot 7/7、public-guide 11/11；六件套齐全；未运行 race；按任务文字不依赖 5.1，旧 141 tests 证据不再使用，5.1 真实只读仍单独待验
- [x] 7.1 INTEGRATION：configured internal origin 交付与运行说明；scope=控制中心专属运行环境及docs；依赖=6.1、部署准入与凭据安全初始化；验证=HTTPS、登录、核心读取、重启恢复；预期=实际可访问，停止不影响 owner；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查 | evidence: 2026-11-15 内网 origin（`control-release-2026-11-12T11-54-29-409Z`）：HTTPS 健康 200；复验账号登录和核心读取通过（`temp/integration-test-runs/daily-pre-restart-2026-11-15T13-44-32-861Z`，10/10）；只重启控制中心 app unit 后 1.1 秒恢复 200，重启前的会话仍是 200，重启后读回通过（`daily-post-restart-2026-11-15T13-45-21-441Z`，10/10）；8 个 owner、TLS unit 的 PID 都没变，停控制中心不影响 owner

使用 bun scripts/daily-management-spec.ts mark <编号> <证据引用> 更新，不手改状态。

验证 1.1：docs/daily-management-baseline.md

验证 2.1：src/service-directory.ts; server/contracts.ts; openspec strict validation passed

验证 3.1：temp/integration-test-runs/daily-backend-2026-10-07T16-22-09-863Z/summary.json

验证 4.1：temp/integration-test-runs/daily-frontend-2026-10-07T16-38-19-817Z/summary.json

阶段记录：INTEGRATION INTEGRATION_PENDING；本地门禁、前端与 fake MCP 组件验证见 docs/daily-management-delivery.md；真实 observer、部署准入与 TLS 尚缺，5.1/6.1/7.1 不标完成。

阶段记录：INTEGRATION INTEGRATION_PENDING；控制中心专项部署准入已获用户确认；真实HTTPS/登录/重启通过，证据=lan-2026-10-08T07-29-22-153Z；三owner旧运行版本与独立observer尚缺，完整5.1/6.1/7.1仍未完成。
- [x] 8.1 INTEGRATION：对照当前候选复验认证后HTTPS读取与重启恢复；owner=Control Center；scope=控制中心独立部署目标和运行证据；依赖=6.1、7.1具体目标授权；保留独立owner边界；lane=串行；验证=按现有lan-deployment runbook核对候选指纹、登录、主要读取和原回执恢复；预期=健康/静态资源与认证业务读取分开；旧部署不证明新共享协作schema已发布；不重启owner；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据 | evidence: 2026-11-15 对照当前线上候选 `control-release-2026-11-12T11-54-29-409Z`：`dist/index.html` 与线上返回的 sha256 一致（430da867…）；认证读取和重启恢复见 7.1 的两份证据；健康和静态资源检查与认证业务读取分开记录；没有重启 owner。按要求注明：manifest 的 `source_dirty=true`，候选从脏工作树构建
