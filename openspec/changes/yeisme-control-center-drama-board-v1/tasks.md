# 实施任务

- [x] 1.1 CONTRACT：`src/shared/drama.ts`、`flowStateFrom` 与 `in_progress`、五节点阶段链与下一步推导。 | evidence: tests/drama-read-model.test.ts 14 passed; bun run typecheck clean
- [x] 1.2 BACKEND：Scaena 读取器、流程构建、收集库 `episodeUnits`、`DramaService`、`/drama/*` 路由、工作队列去掉无集引用读取并改读最近 ≤3 集。 | evidence: tests/drama 24, drama-route 13, scaena-storyboard 13, work-queue 12, creative-flow 14 passed; contract-integration 27/27; independent review findings H1 M1 M3 M4 M5 M6 L1-L8 fixed with regression tests (M2 revision check implemented only where Scaena and Auctra share a ref; formats against live owners unverified)
- [x] 1.3 BACKEND：Auctra `partial` 归一化、未绑定范围报 `needs_contract`、Auctra 阶段携带自己的项目引用。 | evidence: tests/drama-read-model.test.ts Auctra reader guards (no request without episode, echoed episode mismatch, blocker tokens, partial normalised, unbound needs_contract)
- [x] 2.1 FIXTURE：做剧世界、假 Auctra 与假 Scaena、join-key 不一致样例、降级与空场景、启动时灌入收集索引。 | evidence: fixture rich/degraded/empty smoked over HTTP; contract-integration 27/27; browser-journey 39/39 against the seeded index
- [x] 3.1 FRONTEND：导航、路由、列表、阶段链、Inspector、Scaena 集引用指定、中文镜头词表、窄屏与深链。 | evidence: browser-journey drama checks: rail states, structure-only inspector, Scaena ref override, hand-off, focus return, 390px; visual-matrix-drama-2026-10-22T04-16-14-676Z 43 shots 0 page errors
- [x] 3.2 FRONTEND：审阅页“剧集阶段审阅”、首页队列 Inspector 的“在剧集制作中查看”、`OwnerLinkRow` 共用。 | evidence: browser-journey: review page stage reviews with adoption disabled; attention queue shows real episode problems and no phantom contract gap
- [x] 4.1 单元与路由测试：`tests/drama*.test.ts`、读取器、流程构建、队列规则。 | evidence: bun run test: 47 files 336 tests passed
- [x] 4.2 合同集成与浏览器旅程：`/drama/*`、旅程中的做剧检查、降级场景、视觉矩阵。 | evidence: test:contract-integration 27/27; test:browser-journey 40/40 incl. new-tab hand-off (mutation-checked: old location.assign fallback navigates the app away) and valid row markup; test:ci:browser 4/4; collaboration journey passed; visual-matrix-drama2 43 shots 0 page errors; an earlier journey run failed only on net::ERR_NETWORK_CHANGED (environmental) and passed on rerun
- [x] 5.1 真实只读复验：用已配置的合法 observer 读取剧集与流程，缺 Auctra 绑定记为覆盖缺口，不造样本、不付费。 | evidence: real-owner-read-2026-10-22T15-39-58-054Z: core owners ready; /drama/episodes 200 with universe bound=false needs_contract source_not_configured (coverage gap recorded, no sample invented); 45 real tasks carry no episode_ref; real queue has 0 flow items and 0 contract_gap items
- [ ] 5.2 共享项目范围的 Auctra 绑定与迁移（单独变更，需要授权）。

## 验证命令

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run build
CONTRACT_OWNER_PORT=4360 bun run test:contract-integration
bun run test:browser-journey
bun scripts/verify-collaboration-journey.ts
bun run check:public-surface
openspec validate yeisme-control-center-drama-board-v1 --strict --no-interactive
```
- [x] 5.3 控制中心单独发布并回读（候选构建、组件验证、升级演练、HTTPS 健康与资源指纹）。 | evidence: control-release-2026-10-22T15-35-16-840Z: candidate intranet-candidate-2026-10-22T15-30-00-944Z, component proof release-component-2026-10-22T15-33-46-928Z, upgrade rehearsal on a VACUUM INTO copy (migrations 5->9, no row-count change, integrity ok, previous release boots on upgraded schema), restore-point backup, HTTPS health and asset fingerprints over trusted TLS, owner configuration unchanged
- [ ] 5.4 配置 Auctra 收集绑定与服务端 owners.scaena 后复验真实剧集（需要凭据与授权，当前未配置）。
