# Design · Yeisme Studio v23

完整设计见 `docs/design/studio-v23.md`。这里只记录实现上的决定。

## 边界

- 职责不变，仍是「观察 · 决定 · 交接」。
- 服务端动作、权限、路由和迁移不改；不新增依赖。
- 所有写操作复用 `project.create`、`organization.create`、`project.bindings.set`、`project.members.set`、`project.update`、`owner_project.connect`，都经过 preview/confirm。
- 证据只记命令和计数。

## 决定

### D1 导航按「入口 → tab」两层，入口分两组

`navigation.ts` 的 `NavEntryId` 改为 `today|projects|create|works|activity|connect|settings`，每个入口带 `group: make|setup`。每个页面恰好属于一个入口，入口内的 tab 就是它的页面。路由和别名不变，所以旧书签、提醒链接和 `/team`、`/admin`、`/services` 都照常可用。

侧栏在 `lg` 以上占满高度，setup 组的第一个入口用 `mt-auto` 推到底部。手机上只显示 `phoneEntries` 里的 4 个入口，其余入口在 DOM 中保留但隐藏，由「更多」弹层（`DetailSheet`）列出；当前页面属于「更多」时，滑块停在「更多」上。

### D2 主题只在两个地方改

侧栏的 `ThemeMenu` 删掉。账号菜单用 `MenuChoiceRow`（Radix RadioGroup 的一行三段）切换主题；完整设置在「设置 → 外观」。账号菜单只留一个设置类入口：「我的账号」。

### D3 项目主页留在 `/projects?sharedProject=<id>`

计划里写的是 `?project=`，但 `project` 已经是工具项目详情的参数，所以沿用 `sharedProject`，tab 用 `tab` 参数（概览不写）。切换 tab 时清掉资产筛选参数。

### D4 计数只来自项目自己的目录

概览先做一次非本地读取（limit 1），让服务端从 owner 同步；再按种类各做一次本地读取（limit 100）。目录读完时显示精确数，读不完（`coverage` 不是 `complete`）时显示「N+」，不估算。

项目列表卡片不显示缩略图拼贴：缩略图的访问句柄绑定当前工作区范围，在列表所在的个人范围里拿不到项目内的句柄。卡片改用文件夹封面和工具徽标。

### D5 向导直接调用 preview/confirm

`NewProjectWizard` 不用 `useCollaborationAction`，因为它可能要连着做两次写操作：

- 有组织：进入确认步时预览 `project.create`，确认时提交。
- 没有组织：进入确认步时预览 `organization.create`（名称「我的工作室」，授权来源是个人范围），确认时提交，再预览并提交 `project.create`。如果组织建好而项目失败，重试时从已建的组织继续，不会再建一个。

没有组织时跳过关联工具和成员两步：绑定候选是按组织算的，组织建好之前没有候选。项目建好后打开连接 tab。

### D6 连接 tab 不碰凭据

- 解除关联：`project.bindings.set`，提交去掉这一项后的列表，先预览再确认。
- 登记工具项目：复用 `ConnectToolProjectDialog`，模板来自个人范围的 `/owner-projects`。
- 新的工具实例需要服务器上的凭据文件，页面只给占位符命令 `bun scripts/personal-config.ts connect <config-file> <connection-id> <tool> https://<owner-host>/mcp <project-id> <key-dir>/<tool>-observer.key`，并写明浏览器不提交凭据。

### D7 命名修正只在展示层

`resultDisplayName` 认出空名和 `Owner result`、`output 3`、`未命名结果` 这类占位名，改用任务类型的中文名（映射表从 `TaskDetail.tsx` 移到 `labels.ts`）加时间。
