# Tasks

- [x] 增加 Auctra collection binding 与 service directory `collection_projection`。
- [x] 新增 Auctra collection reader、scope 校验、OIDC/service credential 选择和 body-free 投影。
- [x] 新增 `/auctra/collection`、`/auctra/collection/records/{record_ref}`、`/auctra/collection/sync`。
- [x] 新增本地 collection metadata index、dedupe、scope isolation、stale/unknown 状态和 cursor 保存。
- [x] 接入本地 collection metadata action descriptors、preview/confirm、receipt readback 和 audit。
- [x] 移除小说工作台入口、正文读取和 Auctra 领域写动作。
- [x] 新增 Auctra collection/service-directory tests。
- [ ] 补 Control Center 浏览器旅程和真实 owner collection read evidence。
- [ ] Auctra 发布 collection event source 后，再评估 SSE relay；当前保持显式同步。
- [x] 8.1 INTEGRATION：补collection显式同步、本地元数据CAS和权限状态浏览器旅程；owner=Control Center；scope=scripts/verify-browser-journey.ts与既有fixtures；依赖=既有collection合同；lane=串行；验证=bun run test:browser-journey；bun run test -- tests/auctra-authoring.test.ts；预期=空/错/过期/无权/范围切换、同步回读通过；不读正文、不伪造owner审阅；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据 | evidence 2026-10-30：浏览器旅程 69/69 新增两项——同步后读回记录、按读到的 metadata revision 确认、revision 过期时（409 `collection_metadata_conflict`）提示并重新读取、右键菜单与按钮一致；来源为空、同步过期（已过期）、同步被拒（403 需要管理员）时如实显示且不报成功；范围切换到未绑定 Auctra 的范围时同步禁用由既有检查覆盖。顺带修复：面板原来丢弃 `runAction` 的结果，冲突与失败都无声无息。
- [ ] 8.2 INTEGRATION：读取真实Auctra collection snapshot与安全record；owner=Control Center；scope=既有合法Auctra binding与脱敏证据；依赖=合法只读授权；8.1；lane=串行；验证=扩展既有bun run test:owner-live-read，读取snapshot/record并验证coverage；预期=实际记录或真实空集；不持久化正文；原浏览器+真实复合项分别有据；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
- [x] 8.3 CONTRACT：跟踪Auctra event source发布条件与SSE消费评估；owner=Control Center；scope=本变更design/specs；依赖=Auctra事件合同；不阻塞已有显式sync切片；lane=串行；验证=openspec validate yeisme-control-center-auctra-authoring-v1 --strict；预期=event id、cursor/replay、scope/epoch、断线恢复/撤权明确；owner未发布则原SSE项继续pending；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据 | evidence: 2026-10-30 核对：Auctra 未发布 collection event source，cli/auctra OpenSpec 无相关提案；design.md 新增“Event source（等待 Auctra 发布）”写明事件 id、游标重放与过期回退、scope/epoch、断线恢复、撤权五项合同条件与控制中心消费评估（同源单连接扇出、按会话 scope/epoch 再过滤、只做本地索引增量、snapshot 为准、五类测试）；spec 增场景 collection event source not yet published；SSE relay 任务保持 pending，显式同步切片不受影响
