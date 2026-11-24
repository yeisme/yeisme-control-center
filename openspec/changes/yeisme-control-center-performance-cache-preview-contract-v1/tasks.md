# 实施与验收任务

本变更是 T0 CONTRACT 计划；所有任务默认未完成。任务完成不能宣称 owner 合同、真实读取、性能目标、部署或 Provider 能力已完成。不得运行 race、访问真实 owner、部署或创建 goal。

- [ ] 1.1 CONTRACT：核对当前 cache、media preview、session/scope/epoch/generation 和现有文档证据，维护 proposal 的能力 ledger；owner=Control Center；依赖=无；验证=`openspec validate yeisme-control-center-performance-cache-preview-contract-v1 --strict --no-interactive`；失败=保留缺口并标记 `blocked`，不把页面代码当作合同
- [ ] 1.2 CONTRACT：冻结本地 cache identity、fresh/stale/TTL、在途去重、容量、迟到响应和失效矩阵；owner=Control Center；依赖=1.1；验证=文档审查 + 后续 focused cache tests；失败=保持旧安全缓存策略，禁止跨 scope/epoch 复用
- [ ] 1.3 CONTRACT：冻结媒体 preview 的显式意图、purpose、短时授权、同源代理、MIME/Range、过期/撤权、Object URL 清理和 no-store 边界；owner=Control Center；依赖=1.1；验证=文档审查 + 后续 preview fixture；失败=只保留既有显式 preview，禁止自动预加载和任意 URL
- [ ] 1.4 CONTRACT：逐 owner 建立 handoff 表，确认目录、grant、revision/digest、权限、错误码和撤权语义；owner=Eikona/Scaena/Sonora 等对应 canonical owner；依赖=1.1、1.3；验证=owner 提供公开/批准的只读合同或明确 blocker；失败=返回 `needs_contract`，不编造 adapter
- [ ] 1.5 CONTRACT：冻结版本化 projection、兼容字段、状态保真、unknown/缺字段 fail-closed 规则；owner=Control Center；依赖=1.2、1.3、1.4；验证=OpenSpec strict + DTO review；失败=撤回未经 owner 证实的字段和错误码
- [ ] 2.1 PERFORMANCE：在本地 fake owner/fixture 中建立 cache 命中、去重、stale、清理和 preview 首字节基线；owner=Control Center；依赖=1.2、1.3；验证=focused tests，不运行 race；失败=记录 `introduced/pre_existing/environmental/ambiguous`，不调整成虚假通过
- [ ] 2.2 IMPLEMENTATION：实现本地 cache identity 和媒体 preview 生命周期增量；owner=Control Center；依赖=1.5、2.1；验证=`bun run typecheck` + 聚焦 Vitest；失败=关闭新开关并清理新 generation 条目，保留既有只读路径
- [ ] 2.3 IMPLEMENTATION：实现已批准 owner contract 的 typed adapter 和状态映射；owner=Control Center + 对应 owner；依赖=1.4、1.5；验证=本地 contract integration（不触发 Provider）；失败=回到 `needs_contract`，不返回假数据
- [ ] 3.1 QUALITY：补齐跨 scope、epoch、generation、revision/digest 不一致、过期、撤权、网络失败、迟到响应和重复 preview 场景；owner=Control Center；依赖=2.2；验证=聚焦 Vitest + 浏览器 fixture；失败=按场景隔离修复，不扩大到无关 dirty 文件
- [ ] 3.2 QUALITY：建立脱敏性能指标和容量/TTL回归门；owner=Control Center；依赖=2.1、2.2；验证=本地性能基线与指标 schema 检查；失败=只下调未承诺的本地门，不把 owner SLA 写入控制中心
- [ ] 4.1 INTEGRATION：在 owner 合同明确且独立授权后做真实只读 preview/contract 验证；owner=Control Center + 对应 owner；依赖=2.3、3.1；验证=既有只读 runner，明确不调用 Provider/写动作；失败=保留 `needs_contract`/`forbidden`/`unavailable` 证据，禁止 fallback
- [ ] 4.2 RELEASE：实现 feature gate、回滚演练和旧客户端兼容检查；owner=Control Center；依赖=3.1、3.2、4.1；验证=本地回滚测试与发布前检查；失败=关闭新 adapter、清理新缓存、恢复旧安全只读行为，不改 owner 数据或权限
- [ ] 5.1 CLOSEOUT：补充脱敏证据、更新状态说明并逐项复核 ledger；owner=Control Center；依赖=4.2；验证=OpenSpec strict、typecheck、聚焦测试和 diff 审查；失败=保留未完成项，不归档为已完成，不宣称真实 owner 合同

## 本轮 T0 已执行范围

仅创建/补齐本 change 目录内的 proposal、design、tasks 和 spec 文档，并运行指定 OpenSpec strict 校验。上面的实现、性能、owner 和发布任务不在 T0 勾选。
