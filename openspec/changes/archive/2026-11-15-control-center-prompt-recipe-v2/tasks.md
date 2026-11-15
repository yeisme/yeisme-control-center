# 任务

- [x] 建立 refs-only recipe shared contract、Drizzle schema 和 additive migration。
- [x] 实现 scope 绑定的列表、详情、修订和 archive store。
- [x] 接入 create/revise/archive action、幂等 receipt 和条件更新冲突。
- [x] 接入列表、详情、版本和 use-preview HTTP/API client。
- [x] 在提示词页展示 recipe cards、provenance、digest、版本历史和草稿预览。
- [x] 补充 owner/project scope、非法查询、archive replay、revision conflict 与 no-body persistence 回归测试。
- 后续跟踪（外部 owner，不阻塞归档，2026-11-15）：Eikona/Sonora/Scaena owner 合同、真实授权和 Provider 读取由外部 owner 门单独完成。
- [x] 运行完整 client build、server boot、contract integration、prompt-library 和 OpenSpec 严格验证。 | evidence: bun run typecheck, bun run build, bun run test:server-boot, bun run test:contract-integration, bun run test:prompt-library and openspec validate --all --strict --no-interactive passed; owner contract and real authorization remain separate
