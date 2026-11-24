# Design

## Read path

```text
GET /api/control-center/v1/creative-flow?scope=<scope>&episode_ref=<episode-ref>
```

Control Center server 通过固定 origin 和现有 owner auth 调用：

- Auctra operation `creative.flow.read`
- Scaena `GET /api/v1/projects/{project_id}/storyboard`

Auctra contract 缺失时返回 `source_coverage.auctra=needs_contract`；Scaena malformed projection 时返回 `source_coverage.scaena=needs_contract`。两者都不得被转换为 complete。

## Projection rules

- stages 使用五个固定 stage；breakdown 可有多个同 episode item。
- state 集合固定为 `accepted`、`ready`、`waiting_review`、`blocked`、`stale`、`missing`、`needs_contract`、`unknown`、`unavailable`、`forbidden`。
- edges 只连接同一 episode 的安全 refs，并带 relation、state、source revision/digest、evidence refs。
- next_attention 带 owner、action、reason、source ref、evidence refs。
- 多 episode 且请求没有 episode_ref 时不猜测，返回 `episode_ref_required`。
- 队列 dedupe key 为 `scope_id + owner + object_kind + source_ref + revision`。
- CLI command 放在 WorkQueueLink；LaunchContext 只携带 safe refs、route、return_path 和 server-generated URL。

## Security

- 只接受服务端配置 origin；拒绝任意 URL、scope/epoch/origin/LaunchContext 篡改。
- projection 只允许 refs、state、revision、digest、review refs、blockers 和安全导航数据。
- MuWeave 只进入既有 script/storyboard route，不自动打开或播放媒体。
