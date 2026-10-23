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

## 剧集发现与读取成本

两个 owner 都要求 `episode_ref`，所以流程投影只能按集读取。`GET /api/control-center/v1/drama/episodes` 与 `drama/episode` 负责发现与按集读取，页面是 `/drama`（“剧集制作”）。

- 全集来自本地 Auctra 收集索引中的剧本类 text unit，这是 Auctra 自己判定“一集”的条件。Scaena `listEpisodes` 不用于发现：它的 id 是 projection id，拆解 `episode_ref` 是操作员文本，Auctra 用内容 unit id，三者只有在可选的 `--auctra-handoff-ref` 路径下才强制相等。
- Scaena 用不同的集引用保存同一集时，用 `scaena_episode_ref` 在读取时指定；Auctra 阶段仍按 Auctra 引用过滤，Scaena 阶段按指定引用过滤。这只改变读取。
- Scaena 读取一页（`limit=3`，每次拆解都带完整场景树，页大小要留出响应上限的余量），按更新时间倒序，第一项是当前拆解；还有更早尝试时标 `truncated`，不降级 coverage。没有 source 的集是“未开始”，拆解引用了 source 而响应缺 `source` 才是合同缺口。
- 阶段链永远五个节点；缺失阶段由其 owner 的 coverage 解释。Auctra 在阶段全部通过前把流程 coverage 报为 `partial`，读取器把它归一化为数据完整，进度由各阶段的 state 表达。
- 成本：列表零 owner 调用地列出全集，每次最多实时读取 8 集，有界并发 4；读取按“会话 + epoch + 范围 + 绑定 + 集”缓存 45 秒、在途去重、强制刷新 10 秒限一次。`/work-queue` 读最近更新的 ≤3 集并共用同一缓存。
- 展示的结构只含场景标题和镜头景别/角度/运镜/时长；`action_summary`、媒体绑定、prompt 和候选正文不进入投影。生成、审阅、交付没有 owner 读取合同，阶段链标“待合同”。
- 拆解基于旧版剧本：Scaena 导入 Auctra 交接时会校验 `source.digest` 等于 Auctra 的 `SourceDigest`，并在 `source.safe_refs` 里带上 Auctra 的交接引用和版本。所以两侧有共同引用而 digest 不同，就说明剧本在拆解之后又改过；此时该拆解标 `screenplay_revision_mismatch`、不算当前，也不再让“可交接”消失。不是从 Auctra 导入的来源没有共同引用，永远不比较。
- 工作队列的覆盖度：每个 owner 取各集读取里最差的状态；owner 读不到时给出一条“暂时读不到剧集流程”的队列项；只检查了最近更新的 3 集而总数更多时，覆盖度标 `partial`（原因 `episodes_sampled`）。
