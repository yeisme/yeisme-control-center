# 设计

## 剧集全集与 join key

三套引用互不等同：Scaena `listEpisodes` 的 id 是 projection id；拆解 `episode_ref` 是操作员文本（`--episode`）；Auctra 用内容 unit id。只有可选的 `--auctra-handoff-ref` 路径强制相等。因此：

- 全集 = Auctra 收集库中 `record_kind='text_unit'` 且 `kind ∈ {screenplay, screenplay_scene}` 的 `unit_ref`（`AuctraCollectionStore.episodeUnits`，只读本地索引，已归档的不列出）。
- 任务的 `episode_ref` 与手动输入只作为“请求的集”并入（前端合并，服务端 `episode_ref` 查询参数最多 12 个）。
- Scaena 用不同引用保存同一集时，在读取时用 `scaena_episode_ref` 指定；它只改变读取，不落库，也不写 owner。只有在交接已通过/就绪/过期（Scaena 理应已有拆解）而 Scaena 仍为空时才提示。

## 成本与缓存

- 列表：全集来自本地索引，零 owner 调用；每次最多对前 8 集做实时读取（两个 owner 并行），其余 `deferred`，`read=all` 才读满一页（≤24）。有界并发 4。
- 缓存键 = `scope.id + 绑定指纹 + 集 + Scaena 集 + 是否跳过 Auctra`，并含 `session.id` 与 `epoch`（owner bearer 按会话委托）；TTL 45 秒，owner 暂时不可用只记 10 秒（未绑定、缺合同等稳定状态照常 45 秒，否则部分连接的范围每次请求都会重读 owner）；在途去重；LRU 200；缓存只存 owner 派生的投影，epoch 在响应时再包。`refresh=1` 对同一键 10 秒内限一次。列表的实时读取预算只计需要 owner 调用的行。
- `/work-queue` 读最近更新的 ≤3 集，与看板共用缓存，所以首页每 15–30 秒的轮询最多每 45 秒产生一次 owner 读取。

## 读取器语义

- Scaena：`limit=3`，单页（每次拆解都带完整场景树，留出响应上限的余量）；有 `next_cursor` 记 `truncated` 而不降级 coverage；按 `updated_at` 倒序，第一项为 head，`buildCreativeFlow` 只用 head；`source` 缺失且没有拆解引用 source 才算“未开始”，拆解引用了 source 而响应缺 `source` 仍是 `needs_contract`；`queued/running` → `in_progress`，`cancelled` → `blocked` + `breakdown_cancelled`；无 episode 时不调用 owner。
- Auctra：流程 coverage 的 `partial` 表示阶段尚未全部通过，已由各阶段 state 表达，读取器归一化为 `complete`；只有真实读取失败才是缺口。没有 episode 时不调用 owner。
- 阶段链永远五个节点：缺失阶段由其 owner 的 coverage 解释（`not_started` 只在 owner 读取成功且无内容时出现）；下一步“问题优先，其次未开始，其次读不到，全部通过才是完成”，整体读不到绝不显示为已推进。

## 展示

列表不是看板（390px 友好）；行内容用容器查询，Inspector 停靠时自动堆叠。状态用图标形状加文字，不只靠颜色；Auctra 对未采纳剧本的 `blocked/source_not_accepted` 显示为中性“待采纳”。Scaena 的景别/角度/运镜词表有中文标签，未知词原样可读。Inspector 复用 `InspectorShell`，并抽出 `OwnerLinkRow` 与首页队列共用。

## 引用与队列的补充规则

- 收集库里不存在的引用不发给 Auctra：Auctra 按引用末尾数字匹配导演计划与分镜，Scaena 的 `episode:03` 会显示 ep-3 的计划。只有收集库同步过才下这个结论；没同步过时无法排除，照常读取。
- 任务带来的集引用是 owner 提供的文本：服务端忽略不合法的引用（控制字符、首尾空白、超长），不让一个坏引用拖垮整个列表。Auctra 与 Scaena 的返回按同样标准清洗：引用和 blocker 必须是短的机器 token，Auctra 回显的 episode 必须等于请求的 episode，否则按合同缺口处理。
- 拆解基于旧版剧本：Scaena 导入 Auctra 交接时会校验 `source.digest` 等于 Auctra 的 `SourceDigest`，`source.safe_refs` 带 Auctra 的交接引用和版本。两侧有共同引用而 digest 不同即为 `screenplay_revision_mismatch`；该拆解不算当前，也不消耗“可交接”。
- 下一步的优先级：真实问题（失败、过期、待审阅、已通过但来源不再当前）优先于“开始下一个阶段”，中性的“待采纳”排在真实问题之后；其后是未开始、进行中、读不到，全部通过才是完成。阶段链上的当前标记与这句话取自同一个函数。
- 工作队列覆盖度：每个 owner 取各集读取中最差的状态，读不到的 owner 给出一条队列项，只检查了最近更新的 3 集而总数更多时标 `partial`。

