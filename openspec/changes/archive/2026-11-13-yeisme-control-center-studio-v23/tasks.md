# 实施任务

- [x] 1.1 导航：7 个入口两组、侧栏底部固定连接和设置、去掉主题按钮和齿轮；账号菜单精简；`G N`。
- [x] 1.2 手机：4 个入口加「更多」弹层。
- [x] 1.3 批量生成变成可见 tab；不在项目范围内时让用户选项目。
- [x] 2.1 作品命名：`resultDisplayName`、`resultName`、`resultSource`；作品页、首页改用；规格未知时不显示规格一行。
- [x] 3.1 项目列表卡片网格；工具项目作为第二个 tab。
- [x] 3.2 项目主页：头部、概览计数与最近产出、资产、制作、任务、成员。
- [x] 3.3 连接 tab：已关联、解除关联、登记工具项目、占位符命令、项目引用。
- [x] 3.4 新建项目向导，包括没有组织时的两步流程。
- [x] 4.1 单测：导航分组、作品命名、项目主页计数、向导步骤、占位符命令。
- [x] 4.2 旅程：浏览器旅程改成新导航并追加 v23 检查；协作旅程改走向导，追加概览计数和解除关联。
- [x] 5.1 回归、文档、视觉矩阵；受保护文件未改动。
- [x] 6.1 发布到内网（只发布控制中心），发布后读回。

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run build
bun run test:app
I1_UI_PORT=4340 I1_API_PORT=4341 I1_OWNER_PORT=4342 bun run test:browser-journey   # 在私有网络命名空间里单独跑
bun scripts/verify-collaboration-journey.ts                                          # 同上
bun run test:public-guide
CONTRACT_OWNER_PORT=4370 CONTRACT_API_PORT=4371 bun run test:contract-integration
bun run check:public-surface
VISUAL_LABEL=v23 bun run test:visual-matrix
openspec validate yeisme-control-center-studio-v23 --strict --no-interactive
```
