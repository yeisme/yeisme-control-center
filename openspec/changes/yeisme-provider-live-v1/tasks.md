## 合同与实现

- [x] 增加 Provider connection、run、capability、usage 类型。
- [x] 增加 MCP Provider adapter、显式 action manifest、幂等和未知结果状态。
- [x] 增加 capabilities、usage、provider-runs、SSE 和 reconcile 路由。
- [x] 增加模型与工具、用量与费用、AI 创作实时页面。
- [x] 增加脱敏 canary 命令和证据目录。

## 验证

- [x] provider manager 单测覆盖幂等、scope、modality 和来源去重。
- [x] `bun run typecheck` | evidence: passed after live workspace and persistence changes
- [x] `bun run test` | evidence: 22 files / 141 tests passed
- [x] `bun run build` | evidence: Vite production build passed
- [x] `bun run test:v18` | evidence: formal App Shell/browser route verification passed (4/4)
- [ ] 真实 canary：`bun run test:provider-live -- --confirm-live --total-cny 30 --image-cny 15 --video-cny 10 --audio-cny 5` | evidence: intentionally not executed; requires separate explicit authorization and real paid Provider calls
- [x] 本地预算 dry-run：`bun run test:provider-live -- --dry-run --total-cny 30 --image-cny 15 --video-cny 10 --audio-cny 5` | evidence: passed; provider_calls=false, mutations=false
- [ ] 2.1 CONTRACT：拆分图像/视频/音频真实canary准入与交付证据；owner=Control Center；scope=docs/provider-live.md、本变更specs；依赖=现有dry-run；视频等待shared-projects固定报价合同；lane=串行；验证=openspec validate yeisme-provider-live-v1 --strict；预期=每模态有渠道/模型/授权/预算币种上限/原键、下载可播放或可解码和实际费用证据；不执行原付费命令，不隐式换汇；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
