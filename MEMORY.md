# 控制中心记忆

## 2026-11-05: 内容默认放开 + owner 目标 + 线上发布（未提交）

- `allow_content` 改默认放开（未设=允许，显式 false 退出）；connect 默认带内容（`--no-content` 退出）；新增 `personal-config owner add|remove`（origin+key+生命周期+`--private-http`）。Owner 用户明确指示：能登录面板就能看。
- 线上 `config.owners.eikona` = http://10.10.1.101:18976 + `control-center-rest.key`（never）；发布 `control-release-2026-11-05T11-18-54-564Z` 已激活（tls_verified=true）。发布走 prepare-intranet-release → verify-release-component → control-release --apply（YEISME_CONTROL_CENTER_ONLY=1、YEISME_RELEASE_ALLOW_DIRTY=1）。
- Eikona 历史整理全部完成（59+5 条）；任务检查器「读取原始提示词」全链路可用（控制中心审计→owner MCP→owner 审计→正文）。
- Sonora（要求 workload identity）/ Scaena（要求 scoped prompt read grant）的提示词库读取仍被各自 owner 拒绝；需各自 owner 签发读取凭据后 `owner add` 接入，本轮未改这两个服务。

跨会话长期记忆。

## 2026-11-05: C 端体验提案 v19（设计原型，未实现）

- 用户反馈「控制中心像 SaaS，不像 C 端」。已产出 `design-proposals/c-end-studio-v19/`：四屏可点静态原型（今天 / 作品 / 创作·剧集 / 手机）+ 前后对比 + 亮暗两套截图；说明文档 `docs/design/c-end-experience-v1.md`（诊断、IA 14→5、令牌、页面规格、P1–P4 落地路线、验收）。
- 未改运行时 `src/`、未改接口/测试；原型不连接 owner、不写入、不进入构建。原型交互核查见 `prototype/verify.mjs`（筛选、灯箱、命令面板、主题、命名与溢出检查全过）。
- 下一步需用户确认是否落 P1（令牌 + App Shell 5 入口 + 今天页），建议独立分支；现有 14 路由与 `data-nav` 保留。

## 2026-11-06: Yeisme Studio v20（已实现，未提交）

- 变更 `openspec/changes/yeisme-control-center-studio-v20/`（strict 校验通过），设计 `docs/design/studio-v20.md`，接续 v19 提案。
- 运行时已落地：
  - 外壳：5 入口（今天 / 创作 / 作品 / 动态 / 我的），桌面 88px rail、手机底部 tab、分区标签。
  - 页面：今天页、剧集工作室 `#/drama?studio=`、作品画廊（2 组筛选 + 更多筛选）、动态时间线 `#/activity`、指南「流程」章节、登录页「回到你的创作台」。
- 验证（fixture）：浏览器旅程 81/83，与基线相同的两项已有失败；合同集成 47/47；公开指南 13/13；`test:app` 4/4；视觉矩阵 64 张。证据在 `temp/integration-test-runs/studio-v20-*/final/NOTES.md`。
- 人机同源：
  - `buildProductionLine()`（`yeisme.production_line.v1`）同时供页面与只读 `GET /production` 使用，15 秒结果缓存。
  - 「交给 Agent」：`yeisme.agent_brief.v1`，只复制、不执行；付费步骤只 dry run。
- 已知 owner 缺口（如实显示，不补）：
  - 参考绑定、剪辑、审阅采用、交付都还没有合同。
  - 只有 Scaena 任务带 `episode_ref`，Eikona / Sonora 单集里写「待接通 · 任务和剧集对上」。
  - 任务没有发起方类型字段，时间线不会出现「Agent」。
- 工作区里其他人在做的改动：
  - 提示词库页打开时会 POST `prompts/<owner>/history/index`，fixture owner 回 503；浏览器旅程因此不收录 prompts 路由。
  - `docs/live-read-integration.md` 的未提交改动含私网地址，`check:public-surface` 因此失败。两处都不是 v20 的改动，未触碰。
