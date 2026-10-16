## 合同与实现

- [x] 增加 Provider connection、run、capability、usage 类型。
- [x] 增加 MCP Provider adapter、显式 action manifest、幂等和未知结果状态。
- [x] 增加 capabilities、usage、provider-runs、SSE 和 reconcile 路由。
- [x] 增加模型与工具、用量与费用、AI 创作实时页面。
- [x] 增加脱敏 canary 命令和证据目录。

## 验证

- [x] provider manager 单测覆盖幂等、scope、modality 和来源去重。
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] `bun run test:v18`
- [ ] 真实 canary：`bun run test:provider-live -- --confirm-live --total-cny 30 --image-cny 15 --video-cny 10 --audio-cny 5`
