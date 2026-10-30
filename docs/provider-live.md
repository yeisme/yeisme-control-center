# Provider 实时调用

正式控制中心从服务端读取 Provider 连接。凭据不放在仓库或浏览器；通过用户级 `credential_ref` 或临时环境变量注入：

```bash
YEISME_PROVIDER_EIKONA_URL="$EIKONA_MCP_URL" \
YEISME_PROVIDER_EIKONA_TOKEN="$EIKONA_MCP_TOKEN" \
YEISME_PROVIDER_SCAENA_URL="$SCAENA_MCP_URL" \
YEISME_PROVIDER_SCAENA_TOKEN="$SCAENA_MCP_TOKEN" \
YEISME_PROVIDER_SONORA_URL="$SONORA_MCP_URL" \
YEISME_PROVIDER_SONORA_TOKEN="$SONORA_MCP_TOKEN" \
YEISME_CONTROL_CONFIG="$HOME/.config/yeisme-control-center/config.json" \
bun run serve
```

真实 canary 必须显式带预算闸门，按模态分别运行：

```bash
bun run test:provider-live -- --confirm-live --modality audio --run-label 20261030 --total-usd 0.5 --audio-usd 0.5
```

- 预算以 USD 给出，这是 owner 为一次运行设上限的币种，原样交给 owner，不换汇。带 `-cny` 的旧参数会被拒绝，不会被换算。
- 服务端上限为单次图像 $2、视频 $1.4、音频 $0.7，合计 $4，仍在 2026-10-14 授权的 ¥30 以内。
- `--run-label` 决定幂等键 `live-canary-<标签>-<owner>`。不带时沿用 2026-10-14 的原键，只核对那几次运行，不会新提交。

命令只保存脱敏状态、来源引用和预算结果。它不会写入 token、Authorization、原始 prompt 或 Provider payload；未知结果只查询原始 `run_ref`，不重新提交。

## 分模态准入与交付证据（2026-10-30）

图像、视频、音频分别准入、分别记证据。任何一个模态通过，不代表另外两个通过。

| | 图像（Eikona） | 视频（Scaena） | 音频（Sonora） |
| --- | --- | --- | --- |
| 渠道与模型 | `eikona://models/readiness` 与 `eikona://channels` 标为可用的模型 | 启用 binding 的 `task_mode` 与渠道（`scaena://video-tasks/guide`） | `sonora://capabilities` 中 `voice.audition` 就绪的 provider 与音色 |
| 授权 | Eikona provider 连接；owner 凭据只在服务端 | Scaena Provider API key（10-14 曾报 `InvalidApiKey`） | Sonora provider 凭据与条款版本（10-14 曾报 `credential_missing`） |
| 预算上限（owner 执行） | **缺**：Eikona 的 MCP `generate` 不接收费用上限（`max_cost_usd` 只在 CLI 执行策略里），目前只有控制中心的预留在限额。准入前需要 Eikona 让 MCP 生成接受上限 | `max_cost_micro_usd`，等于请求的 USD 上限 × 10⁶ | `max_cost_usd`，等于请求的 USD 上限 |
| 已知费用 | owner 估价 | **缺**：等待共享项目的固定视频计划与 known-cost 报价合同（[前端接口补齐](frontend-api-completion.md) A3），之前不准入 | owner 估价 |
| 原键 | `live-canary-20261014-eikona`（已成功，`waiting_review`） | `live-canary-20261014-scaena`（`rejected_no_generation`） | `live-canary-20261014-sonora`（提交前阻塞，无 run ref） |
| 交付证据 | 下载结果能解码出图像尺寸 | 下载结果能播放：有时长、编码与分辨率 | 下载结果能解码：有时长与采样率 |
| 费用证据 | owner 回执里带币种的实际费用 | 同左 | 同左 |

共同规则：

- owner 回执里的费用只有带币种时才记为已确认。没有币种时费用记为未知，不按人民币或美元猜测。
- 未知结果只核对原键，不重新提交。新的尝试必须用新的 `--run-label`。
- 不执行原付费命令。每次真实运行都要用户单独确认预算。

2026-10-30 修复了原适配层的隐式换汇，修复前：

- Scaena 把人民币金额原样当作美元（¥10 上限变成 $10，约放宽 7 倍）；
- Sonora 把人民币除以 10 当作美元；
- 回执没有币种时一律记为人民币。

现在请求必须以 USD 给出上限，其他币种直接拒绝（`provider_budget_currency_mismatch`）。owner 估价用的是别的币种时，同样不提交：没有汇率就无法和上限比较。用量页的“内部预算观察”按服务端返回的币种显示。

截至 2026-10-29，三个 owner 通过各自 CLI 都已真实出过图、视频和配音（使用指南的真实案例）。但这条控制中心 canary 链路自 10-14 以后没有重跑，所以上面的原键记录仍是最近一次 canary 证据。

## 2026-10-14 canary readback

- Eikona：真实生成已受理并完成，`run_20261014_075938_173843116`，owner 状态为 `succeeded / waiting_review`；未执行 reroll。
- Scaena：原始 submission `video-provider-task:76158e936223c39a7c11a474` 已核对为 `rejected_no_generation`，owner 返回 `InvalidApiKey`，没有视频产出。
- Sonora：`voice.audition` 在 Provider 提交前因 `credential_missing` 阻塞，没有 run ref，也没有费用。

上述结果是 owner 实时回执，不等同于三模态全部成功；修复 Scaena Provider 凭据和 Sonora 对应 Provider 凭据后，使用原有 scope 与新的明确幂等键继续。未知结果仍只核对原始引用。

## 只读 Provider 目录与恢复

控制中心默认只做以下只读观察：

- 全部 owner：`initialize` 与分页 `tools/list`（最多 5 页）；发现阶段的 `tools/call` 只允许下列只读诊断，其余一律在本地拒绝。
- Eikona：读取 `eikona://runtime/capabilities`，observer 凭据也可读。`eikona://models/readiness` 和 `eikona://channels` 需要 provider 连接，被拒时 coverage 记为 `partial`。
- Scaena：读取 `scaena://video-tasks/guide`（binding、`channel.summary.v1`、latest_policy、原生渠道）、`getProjectMediaCapabilities`、`getVideoProviderTask` 和 `reconcileVideoProviderTask`。
- Sonora：读取 `sonora://capabilities`（动作注册表与 readiness 矩阵）、provider/model/voice 目录、`credential.status` 和 `doctor.run`。

共享项目批量生成（原 AI 创作工作台已改为“使用指南”）的能力合同只从上述发现结果推导：
- Scaena：启用 binding 的 `task_mode`，text 推导为文生视频，reference 为图生视频，frames 为首尾帧关键帧；
- Eikona：未标为 unavailable/blocked 的 `generate/edit/upscale` 动作；
- Sonora：`voice.audition`。

owner 没有实现的 `<owner>://creative-input/contract` 不再读取。音乐等需要 plan 与 approval 的多步流程只在“模型与工具”中展示，调用方式见“使用指南”。

页面加载不执行 `voice.audition` 或 `createVideoProviderTask`，也不自动刷新 Sonora 远程 catalog。`credential_missing`、`InvalidApiKey`、binding disabled 和 owner unavailable 会分别保留为配置、Provider、能力或服务阻塞状态。
