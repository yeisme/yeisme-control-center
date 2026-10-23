# Yeisme 控制中心：剧集制作看板 v1

## Why

剧本→分镜的数据管线已经存在（`GET /creative-flow`、`yeisme.creative_flow.v1`、工作队列），但控制中心没有“做剧”的入口，真实环境下也读不出来：

- Auctra `creative.flow.read` 与 Scaena `GET /api/v1/projects/{project}/storyboard` 都要求 `episode_ref`，而 `/work-queue` 不带集引用就读流程，只会得到 owner 报错，并让首页常驻“剧本到分镜流程暂不可读”。系统里没有任何剧集发现机制。
- `api.creativeFlow()` 没有页面消费；项目页写着“制作进度 owner 未提供”，审阅页只看任务，交付页是静态空态。
- Scaena 读取器会误报：不发 `limit`、忽略 `next_cursor` 却报 `complete`；没有 source 的集一律报 `needs_contract`；`queued/running/cancelled` 落成 `unknown`；每次拆解尝试都被当成阶段，取到的是最旧一次。
- Auctra 在阶段未全部通过前把流程 coverage 报为 `partial`，这被当成每个阶段的数据缺口，于是第一个已通过的阶段被标为“需要关注”。
- fixture 世界没有任何做剧数据，所以这些页面既看不到也测不了。

## What Changes

- 新增只读页面 `/drama`（“剧集制作”）：按集列出五节点阶段链（剧本、导演计划、创意分镜、制作交接、制作拆解）、下一步（谁来做什么）、新鲜度和关联任务；Inspector 展示阶段链细节、分镜结构、生产任务和安全交接，并允许在读取时指定 Scaena 使用的集引用。
- 新增 `GET /drama/episodes` 与 `GET /drama/episode`：剧集全集取自 Auctra 收集库的剧本类 text unit（Auctra 自己判定“是一集”的条件），不用 Scaena `listEpisodes`（三套引用命名空间不能默认相等）。实时读取有预算（每次最多 8 集）、有界并发（4）、按“会话+epoch+范围+绑定+集”隔离的 45 秒缓存、在途去重和强刷限频。
- 修正读取器：Scaena 小页单次读取、`truncated` 提示、没有 source 视为“未开始”、按更新时间取 head、`in_progress` 状态；Auctra `partial` 视为流程进度而非数据缺口；未绑定 Auctra 的范围报 `needs_contract` 而不是 `forbidden`。
- `/work-queue` 不再发不带集引用的流程读取；改为读最近更新的 ≤3 集（走同一缓存），未开始、进行中和“待采纳”的阶段不进队列，已被 Scaena 接手的交接不再显示为“可交接”。
- 审阅页新增“剧集阶段审阅”，只指向 owner，采用与交付保持禁用。首页队列 Inspector 增加“在剧集制作中查看这一集”。
- fixture 增加做剧世界（Auctra 与 Scaena 的假 owner、三集样例、join-key 不一致样例、降级与空场景），并在启动时灌入本地收集索引。

## Owner Boundary

- 控制中心只读取 owner 已发布的读取合同，不写 Auctra/Scaena/MuWeave，不调用 Provider，不编辑剧本或分镜。
- 投影只含引用、状态、版本、摘要和结构（场景标题、镜头景别/角度/运镜/时长）；剧本正文、`action_summary`、prompt、候选正文、媒体绑定和凭据永不进入响应。
- 生成、审阅、交付没有 owner 读取合同，阶段链用“待合同”标出，不从任务或结果推断。
- 共享项目范围没有 Auctra 绑定；该范围只能显示任务里带集引用的剧集，Auctra 绑定需要单独的迁移变更。
