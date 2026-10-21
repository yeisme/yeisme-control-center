# 剧本到分镜控制中心接入

控制中心只消费两个正式 owner projection：

```text
Auctra creative.flow.read
→ yeisme.creative_flow.v1
→ Scaena storyboard_workspace_projection.v1
```

链路范围固定为：

```text
Auctra screenplay
→ DirectorScenePlan
→ StoryboardPlan
→ accepted production handoff
→ Scaena production breakdown
```

读取入口：

```text
GET /api/control-center/v1/creative-flow?scope=<scope-id>&episode_ref=<episode-ref>
```

Auctra owner 入口：

```bash
auctra creative flow read --project <project> --episode <episode-ref> --json
```

Scaena owner 入口：

```text
GET /api/v1/projects/{project_id}/storyboard?episode={episode_ref}&breakdown={breakdown_ref}&cursor={cursor}&limit={limit}
```

`yeisme.creative_flow.v1` 按 `(scope, project_ref, episode_ref)` 生成。没有 episode ref 时，只有一个可确认 episode 才能推断；多个 episode 时返回 `episode_ref_required`，不折叠 stage 或猜测 lineage。

每个 stage 只返回 owner、object kind、safe ref、state、native state、revision、digest、observed_at、freshness、coverage、source_current、review refs、blockers 和 safe refs。状态集合为：

```text
accepted | ready | waiting_review | blocked | stale | missing |
needs_contract | unknown | unavailable | forbidden
```

Scaena projection 必须包含正式 schema、project/episode、projection revision/digest、source metadata 和 breakdown items。缺少 source、version 或 digest 时，Control Center 保持 `needs_contract`，不把 breakdown 解释为 accepted。

工作队列仍是唯一派生队列。创作流程 item 的去重键为：

```text
scope_id + owner + object_kind + source_ref + revision
```

`Notification Ledger` 本阶段不接入创作流程。CLI 命令放在 WorkQueueLink 展示；LaunchContext 只携带服务端生成的 URL、owner route、scope/epoch 绑定、return path 和 safe object refs。

控制中心不会编辑、确认审阅、执行 Provider、导入 handoff、交付或写入 Auctra/Scaena/MuWeave 状态。正文、Prompt、凭据、provider payload、私有路径和媒体 bytes 永不进入投影。
