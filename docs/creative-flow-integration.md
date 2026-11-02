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
- 展示的结构只含场景标题和镜头景别/角度/运镜/时长；`action_summary`、媒体绑定、prompt 和候选正文不进入投影。生成、审阅、交付没有 owner 读取合同，阶段链标“待补齐接口”。
- 拆解基于旧版剧本：Scaena 导入 Auctra 交接时会校验 `source.digest` 等于 Auctra 的 `SourceDigest`，并在 `source.safe_refs` 里带上 Auctra 的交接引用和版本。所以两侧有共同引用而 digest 不同，就说明剧本在拆解之后又改过；此时该拆解标 `screenplay_revision_mismatch`、不算当前，也不再让“可交接”消失。不是从 Auctra 导入的来源没有共同引用，永远不比较。
- 工作队列的覆盖度：每个 owner 取各集读取里最差的状态；owner 读不到时给出一条“暂时读不到剧集流程”的队列项；只检查了最近更新的 3 集而总数更多时，覆盖度标 `partial`（原因 `episodes_sampled`）。

## 剧集来源与连接（2026-10-28）

- 全集只来自已连接范围的 Auctra 收集索引。没连上时页面按原因分别说明：服务端没有 `collection.auctra`（`collection_target_missing`）、范围没有绑定（`collection_binding_missing`）、没有可用密钥（`delegation_unavailable`）。`/drama/episodes` 的 `sources` 同时给出 Auctra 与 Scaena 拆解读取的配置状态，判断不调用 owner。Scaena 拆解读取用服务端 `owners.scaena`，Scaena 任务连接不等于它。
- 没连上时列表只含三类：最近任务里提到的集（按任务更新时间取最近 12 集，并说明总数）、本标签页打开过的集（最近打开列表里的 `episode` 类，退出登录即清空）、在搜索框输入的完整引用（直接打开）。不再提示用地址栏 `?episode=`。
- 两个 owner 都没连上时，行内显示中性的“未连接来源”（`read_reason=sources_not_connected`），真实失败优先于它；阶段节点和详情里的来源同样写“未连接”，不写“待补齐接口”。

### 同步读完所有页

- Auctra `collection.snapshot` 按 `updated_at` 升序、偏移游标分页，单页最多 200 条，多页时每页都报 `partial`。只读第一页恰好会漏掉最新的剧本。现在一次同步读完所有页（最多 50 页、20 秒），中途停下或失败记为 `partial`（游标表的 `coverage` 与原因），剧集列表随之标“没有读完”；第一页就失败时不改上一次的记录。
- 剧集页在未同步、快照过期或没读完时直接给“立即同步 / 再同步一次”，回执说明存了多少条；部分或失败的同步不会显示为完成。

### 连接 Auctra（管理员）

Auctra 只允许 `service-collector` 密钥调用 `collection.*`，也只允许它调用这些；`creative.flow.read` 因此需要第二把 `service-consumer` 密钥（`collection.auctra.flow_credential_ref`）。只有一个令牌的部署可以只登记一把。访问密钥只在 Auctra 监听非本机地址时生效（要 `--mcp-remote-ack` 和 HTTPS 反向代理）；本机监听用每次启动随机生成的令牌，不适合登记成固定凭据。

```bash
# Auctra 一侧
auctra mcp access-key issue --purpose service-collector --work-ref project:<项目> --key-file <绝对路径>/collector.key
auctra mcp access-key issue --purpose service-consumer --work-ref project:<项目> --key-file <绝对路径>/reader.key
auctra serve --path <项目目录> --listen <地址:端口> --http-authoring --mcp-remote-ack --mcp-access-key-file <密钥库绝对路径>
# 控制中心一侧：只写配置、不发网络请求；之后重启控制中心，在“服务与连接”点“同步记录”
bun scripts/personal-config.ts auctra <配置文件> <Auctra HTTPS 地址> project:<项目> <collector.key> <reader.key>
bun scripts/personal-config.ts status <配置文件>
```

- `creative.flow.read` 不再发 `project_ref`：Auctra 从服务根目录解析项目并拒绝其他写法，迁移作品的收集引用可能与之不同；作用域检查只看 `work_ref`。
- Auctra 侧的已知问题（归 Auctra 修）：导演计划与分镜按引用末尾数字匹配，而这个数字是项目级内容计数器，`scene_007` 会匹配第 7 集的计划。
