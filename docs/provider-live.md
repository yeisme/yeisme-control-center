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

真实 canary 必须显式带预算闸门：

```bash
bun run test:provider-live -- --confirm-live --total-cny 30 --image-cny 15 --video-cny 10 --audio-cny 5
```

命令只保存脱敏状态、来源引用和预算结果。它不会写入 token、Authorization、原始 prompt 或 Provider payload；未知结果只查询原始 `run_ref`，不重新提交。

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

AI 创作的能力合同只从上述发现结果推导：
- Scaena：启用 binding 的 `task_mode`，text 推导为文生视频，reference 为图生视频，frames 为首尾帧关键帧；
- Eikona：未标为 unavailable/blocked 的 `generate/edit/upscale` 动作；
- Sonora：`voice.audition`。

owner 没有实现的 `<owner>://creative-input/contract` 不再读取。音乐等需要 plan 与 approval 的多步流程只在“模型与工具”中展示，不进入 AI 创作。

页面加载不执行 `voice.audition` 或 `createVideoProviderTask`，也不自动刷新 Sonora 远程 catalog。`credential_missing`、`InvalidApiKey`、binding disabled 和 owner unavailable 会分别保留为配置、Provider、能力或服务阻塞状态。
