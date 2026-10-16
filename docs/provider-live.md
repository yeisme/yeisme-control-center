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
