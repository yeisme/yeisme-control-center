# Design · Yeisme Studio v20

完整设计（原则、信息架构、令牌、7 站、人机分工、场景矩阵）见 `docs/design/studio-v20.md`。这里只记录实现上的决定。

## 边界

- 控制中心仍是「观察 · 决定 · 交接」：不编辑剧本、分镜或时间线。根 AGENTS.md 规定，持久剪辑或漫剧开发中心客户端需要重新准入，本变更不越过这条线。
- 不新增鉴权方式。Agent 用人分发的访问 Key 登录，审计记在该账号名下。专用 Agent 身份属于授权变更，另行批准。
- 不新增写入动作。所有写入仍走现有 preview → confirm，付费动作仍由人确认。

## 决定

### D1 令牌换值，不换名

`tests/notice-action-hover.test.ts` 按 hex 解析 `tokens.css` 的第一个 `:root` 块与 `[data-theme="dark"]` 块。亮色状态色保持原值；它还断言旧的 10% 着色在亮色 warning 上低于 4.5:1，这条反证必须继续成立。只换画布、表面、墨色、线、主色与侧栏系，并新增语义令牌（`--lime`、`--warm`、`--surface-hero`、`--radius-hero`、`--radius-tile`、`--rail-width`、`--tabbar-height`、`--font-display`、`--grain-opacity`）。

### D2 入口与分区标签

5 个入口带 `data-nav-entry`；入口内的分区标签沿用页面 id 的 `data-nav`、`aria-current` 和徽标。分区标签放在主区顶部且不吸顶，指南章节栏仍贴在顶栏下方 60px。浏览器旅程里「提醒徽标、铃铛、页面未读三方一致」在提醒页上由分区标签承担。

### D3 每页一个 h1

列表页继续用 sr-only h1（旅程里 12 个路由的「紧凑页头」检查保持），文字保持原名；展示性大标题用 h2。今天页保留可见 h1。

### D4 制作线由一个纯函数构建

`buildProductionLine()` 在 `src/shared/production-line.ts`，UI 用客户端已经有的数据（剧集详情、任务观察、工作队列）构建；`GET /production` 在服务端用同一个函数构建。两种范围：

- `episode`：按剧集引用（Auctra 引用与 Scaena 引用）匹配任务。
- `project`：范围内全部任务。真实环境目前没有任务带剧集引用、Auctra 也未绑定，项目范围让制作线今天就有用。

站点状态：`observed | partial | empty | unconnected | needs_contract | unavailable`。

- `needs_contract`：owner 没有提供该环节的读取合同（设定、剪辑、审阅采用、交付）。
- `unconnected`：合同存在但本范围没有配置或绑定（例如 Auctra 收集未绑定）。
- `unavailable`：读了但读不到。

`empty` 只在来源可读且确实没有数据时出现。缺失不写成 0，不写成成功。

### D5 镜头画面状态只给状态

Scaena 拆解项的 `media[]` 与镜头上的 `generation_ready` 都在其公开合同里（`agent/scaena/internal/productionbackend/api/openapi/openapi.go`）。outline 每个镜头新增：

- `frame_state: "ready" | "pending"`：按 `shot_ref` 归并 `media[].status`。
- `generation_ready`：布尔值。

不复制 `candidate_ref`、`representation_ref`、`content_ref`、`media_type`、`digest`。这是对 drama-board「structure-only storyboard outline」的收窄补充：仍不暴露绑定本身，只暴露有没有。

### D6 Agent 说明只复制，不执行

`buildAgentBrief()` 产出 `yeisme.agent_brief.v1`：目标、上下文引用（复用 `launch_context.v1` 的安全引用）、步骤、护栏、验收与回到哪里。

- 步骤只用三种来源：
  1. 已有只读命令模板（`stageOwnerLinks`）。
  2. 指南录制过的 MCP 调用：`eikona.execute generate` 和 `sonora.execute voice.audition`，花钱的一律 `dry_run` 或只报价。
  3. 「先 search / describe 再调用」的发现步骤。
- 没有主机名、端口、令牌或密钥，参数占位写 `<…>`。
- 控制中心不代 Agent 执行任何动作。

### D7 `/production` 的读取预算

服务端 `/production` 复用 `drama.episode()` 的 45 秒缓存，以及与 `/work-queue` 相同的任务读取。另加一层按 session、epoch、scope、范围键做的 15 秒结果缓存，防止 Agent 轮询放大对 owner 的读取。

## 风险

| 风险 | 处理 |
| --- | --- |
| 旅程与视觉矩阵依赖旧文案与旧导航 | `data-nav`、页面 id、sr-only h1 文字保持；改动的断言在同一变更里更新并说明 |
| 把「降噪」做成「藏错」 | 失败、未知、未授权在今天页仍可见；状态语义沿用现有标签函数 |
| 演示图冒充真实作品 | 封面只取真实结果；没有就用排版封面 |
| 夹具与应用混淆 | 夹具只给开发与测试世界补 `episode` 引用；应用没有回退 |
