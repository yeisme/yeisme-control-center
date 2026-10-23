# Tasks

- [x] 建立 Auctra creative flow reader 与 Scaena strict projection reader。
- [x] 扩展 yeisme.creative_flow.v1 的 controlled state、source coverage、edge evidence、next attention。
- [x] 修复 episode cardinality、flow dedupe 和 LaunchContext command boundary。
- [x] 更新 WorkQueue Inspector 的流程链和安全命令展示。
- [x] 增加 Auctra/Scaena contract integration fixtures 与 malformed projection tests。
- [x] 更新 interfaces、current-status、creative-flow integration 文档。
- [ ] 完成 real-owner read、browser journey 和 security evidence；不运行 race。
- [ ] 7.1 INTEGRATION：验证真实Auctra/Scaena exact episode投影和来源覆盖；owner=Control Center；scope=既有只读配置、temp/integration-test-runs；依赖=原实现任务及合法owner读取范围；lane=串行；验证=扩展既有bun run test:owner-live-read覆盖creative-flow；先核实owner合同；预期=source/revision/digest齐全；多episode缺ref拒绝；缺合同/空集如实记录，无导入/审阅写入；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
- [ ] 7.2 INTEGRATION：补流程链到Inspector和受控LaunchContext浏览器/安全证据；owner=Control Center；scope=scripts/verify-browser-journey.ts与既有fixtures；依赖=既有flow合同；真实分支证据另看7.1；lane=串行；验证=bun run test:browser-journey；bun run test -- tests/creative-flow-route.test.ts tests/work-queue-route.test.ts；预期=episode切换、malformed source、旧epoch、外部URL拒绝、返回定位通过；原最终项待本地/真实/安全三类齐全；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
