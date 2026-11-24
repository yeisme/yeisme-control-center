## ADDED Requirements

### Requirement: 项目卡片列表
「项目」页 SHALL 用卡片网格列出用户能进入的共享项目。每张卡片显示文件夹封面、名称、工具徽标、角色、授权数和更新时间。能新建项目的用户 SHALL 看到「新建项目」按钮。还没有组织时，页面 SHALL 显示「新建第一个项目」，而不是要求先建组织。工具项目 SHALL 作为同一页的第二个 tab。

#### Scenario: 打开项目
- **WHEN** 用户点一张项目卡片
- **THEN** 地址变为 `/projects?sharedProject=<id>`，显示这个项目的主页

### Requirement: 项目主页
项目主页 SHALL 显示项目名、角色和工具连接，并分为概览、资产、制作、任务、连接、成员 6 个 tab，当前 tab 写在 `tab` 参数里。概览 SHALL 显示视频、音频、图像三个计数块，并显示最近的视频、音频和图像。计数 MUST 来自这个项目自己的目录：读完时显示精确数，读不完时显示「N+」，MUST NOT 估算。点击计数块 SHALL 打开资产 tab，并按这个种类筛选。音频行 SHALL 能直接在全局播放器里播放。

#### Scenario: 计数与资产一致
- **WHEN** 项目关联了一个有图像的工具项目，用户在概览点「图像」
- **THEN** 打开资产 tab，地址带 `kind=image`，列出的图像数和计数块一致

### Requirement: 新建项目向导
「新建项目」SHALL 打开一个分步弹层：

- 有组织时：名称 → 关联工具 → 成员 → 确认。
- 没有组织时：名称 → 确认。

确认步 SHALL 先预览第一个写操作，预览可用时才能点「创建项目」。没有组织时，预览 SHALL 写明「将创建 2 项：组织和项目」，确认时先创建组织「我的工作室」，再创建项目。如果组织已建好、项目失败，重试 MUST 复用这个组织。所有写操作 MUST 走已有的 preview/confirm 动作。创建成功后 SHALL 打开新项目；没有关联工具时 SHALL 打开连接 tab。

#### Scenario: 第一个项目
- **WHEN** 一个还没有组织的控制中心管理员输入项目名并进入确认步
- **THEN** 预览显示「将创建 2 项」；确认后打开新项目的连接 tab

### Requirement: 连接 tab 如实分块
连接 tab SHALL 包含：

- 已关联的工具项目：工具、项目、读取状态，以及给项目管理员的「解除」。解除走 `project.bindings.set`，先预览再确认。
- 「关联工具项目」和「登记新的工具项目」：后者走 `owner_project.connect`。
- 「接入新的工具实例」：只给带占位符的服务器命令和指南链接，并写明浏览器不提交凭据。
- 「Agent 与 CLI 接入」：可复制 `yeisme-project:<id>` 项目引用，并链接到 MCP 网关。

页面 MUST NOT 显示真实地址、密钥或凭据输入框。

#### Scenario: 解除关联
- **WHEN** 项目管理员在连接 tab 点「解除」，再点「确认解除」
- **THEN** 列表变空，显示「还没有关联工具项目」

#### Scenario: 命令模板
- **WHEN** 用户查看「接入新的工具实例」
- **THEN** 命令里只有 `<config-file>`、`<owner-host>` 这类占位符

### Requirement: 作品命名
结果名为空，或是「Owner result」「output 3」「未命名结果」这类占位名时，作品卡片、首页产出和项目主页 SHALL 显示「任务类型中文名 · MM-DD HH:mm」。规格未知时 MUST NOT 显示「规格未提供」这一行。owner 那边的命名不改。

#### Scenario: Sonora 的结果
- **WHEN** Sonora 返回一条名为「Owner result」、任务类型为 `music-job` 的音频
- **THEN** 卡片标题是「音乐生成 · 11-08 14:20」这种格式
