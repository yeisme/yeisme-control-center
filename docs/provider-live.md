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

真实 canary 必须显式带预算闸门，按模态分别运行。验收时用私有实例运行：

```bash
bun scripts/run-provider-canary.ts --confirm-live --modality audio --run-label <新标签> --total-usd 0.5 --audio-usd 0.5
```

- 这个命令用本仓源码起一个私有实例：真实配置的副本、临时登录，canary 账本库放在仓外（`~/.local/state/yeisme-control-center/provider-canary.sqlite`）。它不发布，也不碰线上服务和真实库。
- 跑完会把 Sonora 的输出经 `artifact.access` 取回一次，用 ffprobe 解码。
- `--sonora-voice <声音引用>` 只改私有副本里的 Sonora 声音，并记进证据。
- 也可以直接对某个实例跑 `bun run test:provider-live -- …`，需要设好 `YEISME_CONTROL_ORIGIN` 和 `YEISME_CONTROL_LOGIN_FILE`。

- 预算以 USD 给出，这是 owner 为一次运行设上限的币种，原样交给 owner，不换汇。带 `-cny` 的旧参数会被拒绝，不会被换算。
- 服务端上限为单次图像 $2、视频 $1.4、音频 $0.7，合计 $4，仍在 2026-10-14 授权的 ¥30 以内。
- `--run-label` 决定幂等键 `live-canary-<标签>-<owner>`。账本里已有的标签直接返回原来的运行，不会再提交；新的尝试必须换新标签。
- 不带标签时用 2026-10-14 的键，但那几次运行不在现在的任何库里。Scaena、Eikona 会按 owner 侧幂等键返回原结果；Sonora 试听没有 owner 侧幂等，会重新渲染一次。

命令只保存脱敏状态、来源引用和预算结果。它不会写入 token、Authorization、原始 prompt 或 Provider payload；未知结果只查询原始 `run_ref`，不重新提交。

## 分模态准入与交付证据（2026-10-30）

图像、视频、音频分别准入、分别记证据。任何一个模态通过，不代表另外两个通过。

| | 图像（Eikona） | 视频（Scaena） | 音频（Sonora） |
| --- | --- | --- | --- |
| 渠道与模型 | `eikona://models/readiness` 与 `eikona://channels` 标为可用的模型 | 启用 binding 的 `task_mode` 与渠道（`scaena://video-tasks/guide`） | `sonora://capabilities` 中 `voice.audition` 就绪的 provider 与音色 |
| 授权 | Eikona provider 连接；owner 凭据只在服务端 | Scaena Provider API key（10-14 曾报 `InvalidApiKey`） | Sonora provider 凭据与条款版本（10-14 曾报 `credential_missing`） |
| 预算上限（owner 执行） | `max_cost_usd`，等于请求的 USD 上限。Eikona 会静默忽略动作没声明的参数，所以先确认 `generate` 声明了它再提交；每次提交前重新读取一次。没声明时能力显示待补齐接口（`owner_cost_cap_undeclared`），提交返回 `provider_cost_cap_unsupported`；读不到合同时返回 `provider_cost_cap_unverified` | `max_cost_micro_usd`，等于请求的 USD 上限 × 10⁶ | `max_cost_usd`，等于请求的 USD 上限 |
| 已知费用 | owner 估价 | **缺**：等待共享项目的固定视频计划与 known-cost 报价合同（[前端接口补齐](frontend-api-completion.md) A3），之前不准入 | owner 估价 |
| 原键 | `live-canary-20261014-eikona`（已成功，`waiting_review`） | `live-canary-20261014-scaena`（`rejected_no_generation`） | `live-canary-20261030c-sonora`（2026-10-30 通过） |
| 交付证据 | 下载结果能解码出图像尺寸 | 下载结果能播放：有时长、编码与分辨率 | 下载结果能解码：有时长与采样率 |
| 费用证据 | owner 回执里带币种的实际费用 | 同左 | 同左 |

共同规则：

- owner 回执里的费用只有带币种时才记为已确认。没有币种时费用记为未知，不按人民币或美元猜测。
- 未知结果只核对原键，不重新提交。新的尝试必须用新的 `--run-label`。
- 在 provider 调用之前被拒的运行记为失败，并释放预留：预算超限、币种不符、owner 不接受上限或无法确认上限，以及 Eikona 的 `COST_LIMIT_EXCEEDED`、`UNKNOWN_COST_REJECTED`。其他错误时请求可能已经发出，记为未知。
- 不执行原付费命令。每次真实运行都要用户单独确认预算。

2026-10-30 修复了原适配层的隐式换汇，修复前：

- Scaena 把人民币金额原样当作美元（¥10 上限变成 $10，约放宽 7 倍）；
- Sonora 把人民币除以 10 当作美元；
- 回执没有币种时一律记为人民币。

现在请求必须以 USD 给出上限，其他币种直接拒绝（`provider_budget_currency_mismatch`）。owner 估价用的是别的币种时，同样不提交：没有汇率就无法和上限比较。用量页的“内部预算观察”按服务端返回的币种显示。

截至 2026-10-29，三个 owner 通过各自 CLI 都已真实出过图、视频和配音（使用指南的真实案例）。

## 2026-10-30 真实验收

经用户授权真实消费，在私有实例上验收（当时的提交加本节的修复）。这些修复已于同日发布到 4312（`control-release-2026-10-30T08-03-42-569Z`）。

- **音频：通过。**
  - 运行 `live-canary-20261030c-sonora` 成功。
  - 输出 1 个 WAV（PCM、44.1kHz、单声道、2.69 秒），取回后能解码。
  - owner 报告实际费用 0 USD；上限 $0.5 由 Sonora 执行。
  - 声音用的是 `sonora://voice/fish-audio/zh-hero`。真实配置里的 `sonora://voice/openai-tts/alloy` 在 Sonora 没有 openai-tts 凭据，用它提交会失败。真实配置要么改用 fish-audio 声音，要么在 Sonora 配上 openai-tts 凭据。
  - 同日经用户要求，真实配置已改用 `sonora://voice/fish-audio/zh-hero`，并重启了服务。改前的配置另存在 `~/.local/state/yeisme-control-center/backups/`。
- **图像：可以提交，尚未做过真实生图。**
  - Eikona 的 MCP `generate`、`edit`、`upscale` 已声明 `max_cost_usd`（owner 变更 `eikona-mcp-submit-cost-cap-v1`，2026-11-02 部署到 Eikona 服务）：上限只能收紧，估价超过上限或无法换算成 USD 时，在 provider 提交前拒绝。
  - 控制中心这一侧（发送上限；Eikona 没声明时不提交）已随 2026-11-02 的发布上线，能力目录里图像能力不再有阻断。
  - 范围绑定的 Eikona 项目已改成与 Provider 钉的项目一致；之前两者不同，请求会被 `provider_project_mismatch` 拒绝。
  - `openai/gpt-image-2.5-sunburst` 单张按 Eikona 的美元价目估价约 0.12 USD。第一次真实生图按单次确认执行，预算、模型和提示词先给用户看。
  - 走共享项目批量生成需要 Eikona 委托令牌，即真实组织委托，目前没有。
- **视频：未准入**，等待 Scaena 的 known-cost 报价合同。

验收途中发现并修复：

- **canary 没带 `Origin`**：个人登录和 CSRF 检查都要求它，canary 自加上这两项检查后就没跑通过。
- **Sonora 的 `provider_id` 解析错误**：`sonora://voice/<provider>/…` 按 `/` 切分后取到空串，现在与发现阶段用同一个解析。
- **Sonora 拒绝未声明的参数**：现在只发 `voice.audition` 声明的五个参数，幂等键放在 `args` 旁边。
- **回执读漏**：现在读 `audio_asset_ref`（输出）、`provider_usage_ref`（来源）和 `cost_usd`。字段名本身写明了币种，算作带币种的费用。
- **诊断误判**：Sonora 把诊断包在执行信封里，信封的 `status: success` 只表示调用成功；原来误把它当作“已配置”，所以缺凭据的 openai-tts 也显示为可提交。现在读信封里的诊断，`configured: false` 优先。
- **能力投影**：带上范围绑定的 owner 项目（`project_ref`），canary 按它发请求，不再用范围本身的名字。

前两次尝试（标签 `20261030`、`20261030b`）都在 provider 调用之前被拒，没有花费。

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
