# Yeisme 控制中心：服务页清晰度与治理 v1

## Why

第五轮 W5：把几处“能用但说不清”的地方收拢。

- **服务目录太长。** 目录有 25 项，其中 17 项只是登记，控制中心没有读它们的合同（“未接入”）。它们占了表格的大半，把真正在用的 8 项和要处理的问题挤到后面。
- **同一个状态四种写法。** “已知存在、但 owner 还没提供控制中心能用的接口”（`needs_contract`）在不同地方叫“待补齐接口”“待接口”“待接入”“待合同”，用户分不清它们是不是同一回事。
- **指南的单选组不能用方向键。** 选工具、选 Agent 客户端、公开页的主题开关都标了 `role="radio"`，却没有 roving tabindex 也没有方向键：每个选项都是一个 Tab 停靠点，方向键什么也不做。2026-10-28 的评审记过这条（“独立无障碍任务”），一直没做。
- **不过期的凭据永远像个缺口。** Auctra 的服务密钥和几把观察密钥不会过期，「凭据」面板却只能写“未记录到期时间”，还会数进“有 N 项没有记录”的提示里。
- **`observe` 比服务端松。** 服务端把超过 100 个、或有一个超过 200 个字符的接收人列表当作无效，并把整块观察关掉；`personal-config observe --recipients` 却照写不误，界限也各写各的。
- **文档过时。** 状态表里 Eikona 费用上限、服务目录的 5/20、发布卫生与凭据生命周期的“未发布”、剧集看板的“没接 Auctra”、Sonora 播放句柄 403 都已不是现状；额外工具来源表还把已接入的 DriveBridge、Anatomia、MCP Gateway 列作缺口。

## What Changes

- **服务目录分组。** 表格只列已接入的和配置过的条目（要处理的问题留在这里）；其余 `not_integrated` 且没配置的条目折叠成一个「未接入」分组，默认收起。标题是一个 `h3`，里面是带 `aria-expanded` 与 `aria-controls` 的按钮，数量写在标题里（`17 项`；筛选或搜索只留下一部分时 `3 / 17 项`）；收起时内容留在页面里但 `hidden`。展开或收起按浏览器记住（本地存储键 `yeisme.control.services.unintegrated-open`，与资源视图、检查器模式同类的偏好），存储不可用时按收起处理、不报错。输入搜索文字或选「缺口」筛选，就是在要这些条目：匹配的条目直接列出，标题变成没有按钮的纯文字，记住的状态不动，清掉搜索后回到记住的状态。分组里的行不再重复“未接入”与状态胶囊，标题已经说了。`src/pages/services/directory-groups.ts`（纯函数与偏好读写）、`ServiceDirectory.tsx`（面板），`ServicesPage.tsx` 只负责摆。
- **一个短词。** `src/shared/read-model/labels.ts` 的 `needsContractLabel = "待补齐接口"` 是 `needs_contract` 的唯一短标签：请求覆盖、读取状态、开放工具状态与读取项、过程时间线、目录覆盖、Provider 就绪、来源覆盖、剧集阶段链、目录页的待补齐面板与指标提示、MuWeave 交接行、工作队列详情都用它。选这个词，是因为它说的是“该由 owner 补接口”；“待接入”会读成“去接入它”，还会和同一页上的“未接入”分组撞车。“未接入”只留给服务目录里控制中心没有合同的条目。解释缺口的长句不动。
- **指南单选组键盘。** 键位在 `src/pages/guide/radio-keys.ts`（单元覆盖），接线与 Tab 行为由 `scripts/verify-public-guide.ts` 里的浏览器步骤守住（单元测试在 node 里跑，按不了键）：`radioTarget` 用 `src/shared/keyboard.ts` 的 `moveIndex` 走位，加上单选组该有的首尾绕回；`radioTabIndex` 让已选项（没有已选时第一项）成为唯一的 Tab 停靠点；`moveBetweenRadios` 把方向键、Home、End 变成“移动焦点并选中”，带修饰键的按键和组不用的按键留给浏览器。接入 `Picker`（选工具、选 Agent 客户端、选回放的客户端）与公开页的主题开关。章节栏是一排真实链接（`nav` 与 `aria-current`），它的模式就是 Tab 逐个走，所以不加 roving。
- **不过期的凭据。** `credential_expires_at`（Auctra 读取密钥为 `flow_credential_expires_at`）可以是字面值 `"never"`。`credentialStatuses()` 把它判为 `ok`，没有 `expires_at`、`days_left`、`stage`，行上多一个 `never_expires: true`；文件读不到、被拒、部分读取被拒仍按原顺序先于它；卡片与面板写“不过期”，不再数进“没有记录”。`parseRfc3339` 不变，仍拒绝一切不是时间的值；只有全小写的 `never` 被认，`Never`、`forever`、只有日期的写法仍是“到期时间读不了”。`personal-config` 的 `--expires-at never`（`connect`、`open-tool`、`provider`、`auctra`、`credential replace`）与 `credential <配置文件> expiry <槽位> never` 存这个词；`--issued-at`、`--expires-in` 不接受它；重跑同一个文件保留它，换文件清掉；`credential list` 打印 `expires_at: "never"`。指南与「凭据」面板的补记提示说明了这个写法。
- **`observe` 与服务端一致。** 现有的 `observation` 若根本不是对象（手改成了字符串、数字、数组），`observe` 以 `observation_not_an_object` 拒绝、什么也不写，不会把它展开进新块；界限取自 `server/observation-config.ts` 的 `observationBounds`；写之前用 `observationProblems` 检查整块，服务端会当作无效的块（周期或读取频率越界、接收人超过 100 个或某个超过 200 个字符，或上次手改留下的问题）一概拒绝，列出问题代码，什么也不写。
- **文档。** `docs/current-status.md` 修正过时的行并补第五轮的行（发布卫生与复验账号、凭据生命周期、后台观察、Eikona 费用上限、剧集看板的真实作品、Sonora 真实播放）；`docs/frontend-api-completion.md` 的额外工具来源表去掉已接入的三项并改用“待接入”；`docs/lan-deployment.md` 写明无效的 `observation` 块按未启用处理并按问题代码记日志，以及给剧集看板运行 Auctra 服务的形态（只有占位符）。
- **不做的事。** 不改服务端接口和数据库；不把章节栏改成 tablist（会让链接失去链接的语义，也会破坏旅程里按链接取的选择器）；不动 `docs/interfaces.md`。

## Impact

- 没有数据库迁移，没有新依赖，没有新接口。`CredentialStatus` 多一个可选字段 `never_expires`，旧页面看不到它也不出错。
- **服务页的深链。** `#/services?ref=<槽位>`（工作队列的续签项带它）打开「凭据」面板里对应的那一行：高亮、滚到视野里、取得焦点，行在折叠的“其余”里时先展开那一组；每个链接只做一次，数据重新读取不会再展开或抢焦点，读者可以随时再折叠。槽位不存在、写错或缺省时没有任何变化，也不报错。解析与选择在 `src/pages/services/credential-target.ts`。
- **先升级服务端，再记 `never`。** 还没带这次改动的服务端读到 `credential_expires_at: "never"` 会把它当作“到期时间读不了”（一个要更正的记录），在服务页显示警告；所以先发布，再给凭据记 `never`。
- 用户看得见的变化：服务目录的“未接入”条目默认收起；“待接口”“待接入”“待合同”一律写“待补齐接口”；指南的选择器用方向键；工作队列的续签项能直接定位到凭据行。
- `personal-config observe` 现在会拒绝以前能写进去、但服务端会当作无效的块（超过 100 个接收人等）；已经写进配置的无效块不会被改动，下次 `observe` 会点名问题并要求用参数改正。
- 旅程脚本 `scripts/verify-browser-journey.ts` 里的服务页检查（目录标题「服务目录」、连接卡片、开放工具、凭据面板的 `[data-credentials-quiet]`、`[data-credential-backfill]`）都不用改。
