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
- [ ] 真实 canary：图像、视频、音频三个模态分别按 2.2–2.4 验收，全部通过后再勾选；命令按模态运行（`bun scripts/run-provider-canary.ts --confirm-live --modality <模态> --run-label <新标签> --total-usd <上限> --<模态>-usd <上限>`），预算以 USD 给出 | evidence: intentionally not executed; requires separate explicit authorization and real paid Provider calls
- [x] 本地预算 dry-run：`bun run test:provider-live -- --dry-run --total-cny 30 --image-cny 15 --video-cny 10 --audio-cny 5` | evidence: passed; provider_calls=false, mutations=false
- [x] 2.1 CONTRACT：拆分图像/视频/音频真实canary准入与交付证据；owner=Control Center；scope=docs/provider-live.md、本变更specs；依赖=现有dry-run；视频等待shared-projects固定报价合同；lane=串行；验证=openspec validate yeisme-provider-live-v1 --strict；预期=每模态有渠道/模型/授权/预算币种上限/原键、下载可播放或可解码和实际费用证据；不执行原付费命令，不隐式换汇；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据 | evidence: docs/provider-live.md 新增分模态准入与交付证据表（图像/视频/音频各自的渠道与模型、授权、owner 执行的 USD 上限、已知费用、原键、可解码或可播放的下载、带币种的实际费用）；视频等待 A3 known-cost 报价合同、图像缺 Eikona MCP generate 的 max_cost_usd，均不准入；核对时发现并修复隐式换汇：预算改为 USD（owner 设上限的币种）原样传给 owner，其他币种与异币种估价一律 provider_budget_currency_mismatch，去掉 Scaena ¥→$ 1:1 与 Sonora ÷10，回执无币种时费用记为未知；canary 脚本按模态（--modality）与新标签（--run-label）运行，拒绝 CNY 参数；spec 增 Budget caps stay in the owner's currency 与 Per-modality canary admission；tests/provider-live 8/8、全量 461、typecheck、旅程 69/69、合同 33/33、server-boot 7/7；未执行任何付费命令
- [x] 2.2 INTEGRATION：音频真实 canary（Sonora voice.audition）；owner=Control Center；scope=server/provider-live.ts、scripts/test-provider-live.ts、scripts/run-provider-canary.ts；依赖=2.1；lane=串行；验证=bun scripts/run-provider-canary.ts --confirm-live --modality audio --run-label <新标签> --total-usd 0.5 --audio-usd 0.5；预期=owner 执行的 USD 上限、原键、带币种的实际费用、下载可解码（时长与采样率）；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据 | evidence: 2026-10-30 经用户授权真实消费验收；scripts/run-provider-canary.ts 起本仓私有实例（真实配置副本、临时登录、canary 账本库在仓外），未发布、不碰线上；run live-canary-20261030c-sonora：succeeded，source sonora://provider-usage/fish-audio-audition-3455…，输出 1 个 WAV（pcm_s16le、44.1kHz、单声道、2.69s）经 artifact.access 取回并由 ffprobe 解码；owner 报告实际费用 0 USD（confirmed），上限 $0.5 由 Sonora max_cost_usd 执行；声音改用 sonora://voice/fish-audio/zh-hero（evidence overrides.json），因真实配置的 openai-tts 在 Sonora 缺凭据；前两次（标签 20261030、20261030b）都在 provider 调用前被拒、无花费：Sonora 拒绝未声明参数（idempotency_key 放进了 args），以及 openai-tts 缺凭据；途中修复 canary 缺 Origin 头、Sonora provider_id 解析、参数只发已声明的且幂等键放在 args 旁、回执读 audio_asset_ref/provider_usage_ref/cost_usd、诊断读执行信封内的 projection（原把信封 status=success 误判为已配置）；证据 temp/integration-test-runs/provider-live-2026-10-30T06-09-10-320Z
- [ ] 2.3 INTEGRATION：图像真实 canary（Eikona generate）；owner=Control Center；scope=同 2.2；依赖=Eikona MCP generate 接收 max_cost_usd，且真实配置里 Eikona provider 项目与范围绑定一致；lane=串行；验证=同 2.2，--modality image；预期=owner 执行的上限、原键、带币种的实际费用、下载可解码出图像尺寸；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
- [ ] 2.4 INTEGRATION：视频真实 canary（Scaena createVideoProviderTask）；owner=Control Center；scope=同 2.2；依赖=Scaena 固定视频计划与 known-cost 报价合同（前端接口补齐 A3）；lane=串行；验证=同 2.2，--modality video；预期=owner 执行的上限、原键、带币种的实际费用、下载可播放（时长、编码、分辨率）；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
