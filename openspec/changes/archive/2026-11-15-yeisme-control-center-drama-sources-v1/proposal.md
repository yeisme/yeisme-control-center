# 剧集来源与 Auctra 连接 v1

## Why

剧集制作页在没有连接 Auctra 收集库的范围里只写一句“列不出全部剧集……也可以用地址栏 `?episode=` 直接查看某一集”。2026-10-28 对照 Auctra 代码检查后发现，缺口不止这句提示：

- 提示不区分“服务端没配 Auctra”“范围没绑定”“没有可用密钥”，管理员不知道该做什么，查看者不知道该找谁；连接步骤在仓库里没有，只能手改 JSON（`personal-config.ts` 没有 Auctra 命令）。
- 打开某一集只能改地址栏；打开过的集离开页面就找不回来；任务引用按字母序截前 12 个，最新的集可能被截掉；搜索时任务引用不受搜索过滤。
- 两个 owner 都没连上时，每行显示“读取失败”，阶段节点显示“待合同”，像故障。
- 连上之后也列不全：Auctra `collection.snapshot` 按更新时间升序分页（每页最多 200 条），控制中心只读第一页，恰好丢掉最新的剧本；同步按钮不报告结果，失败时页面毫无变化。
- Auctra 的 `service-collector` 密钥只能调用 `collection.*`，其他密钥不能调用 `collection.*`，控制中心却只有一个 Auctra 凭据，按访问密钥部署时列表与阶段状态不可能同时可读。

## What Changes

- 服务端：`/drama/episodes` 给出精确的 `universe.reason`、`can_sync`、`complete` 与两个来源的配置状态 `sources`（只看配置，不调用 owner）；行读取在所有来源都只是未连接时报 `sources_not_connected`。
- 同步一次读完所有页（最多 50 页、20 秒），中途停止或失败记为 partial 并在列表上说明；`/auctra/collection` 返回连接状态与上次同步是否读完。
- Auctra 读取按操作选密钥：`collection.*` 用 `credential_ref`（collector），`creative.flow.read` 用 `flow_credential_ref`（consumer），没有第二把时沿用第一把；`creative.flow.read` 不再发送 `project_ref`。
- `personal-config.ts auctra` 登记地址、项目与密钥（只写配置），`status` 报告是否就位且不打印地址与密钥。
- 剧集页：按原因说明缺口并给管理员“查看连接方法”；搜索框输入完整引用可直接打开；记住本标签页打开过的集；任务引用按最近任务选取并说明总数；未同步、过期、没读完时可直接同步并显示回执；未连接显示为中性的“未连接”。
- “服务与连接”：Auctra 面板显示连接状态、项目与上次同步，未连接时禁用同步并给管理员连接步骤。

## Owner Boundary

不写 Auctra 或 Scaena，不签发密钥，不改真实配置。真实范围的连接需要管理员在 Auctra 签发密钥并运行登记命令（凭据与授权，不由代理完成）。Auctra 侧按末尾数字匹配计划的问题记录在文档中，归 Auctra 处理。
