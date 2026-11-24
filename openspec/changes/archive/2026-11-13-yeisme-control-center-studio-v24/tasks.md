# 实施任务

- [x] 1.1 项目卡片：封面拼贴（`local=1`，最多 4 个）、「新建项目」卡片。
- [x] 1.2 顶栏：范围副标题不显示 ID；「暂无连接」及弹层说明。
- [x] 2.1 项目主页：头部、tab 横向滚动、`SectionHeader`、图像网格上限。
- [x] 2.2 `ItemPlaceholder` 与无边框的 `ItemThumbnail`。
- [x] 2.3 连接 tab 按工具分组，「解除关联」进操作菜单；协作旅程定位器同步。
- [x] 3.1 文案：「需要工具授权」「工具成果 / 项目成果」、资产覆盖提示；资产网格卡片样式。
- [x] 4.1 单测：范围副标题、封面布局、图像上限、连接分组。
- [x] 4.2 回归：浏览器旅程 106/110（与基线同数）、协作旅程 3/3、合同集成 50/51（网关监控 `recovery` 一项，来自其他工作流对 `server/gateway-monitor.ts` 的改动）、公开指南 13/13、公开面检查 0 项、视觉对比。
- [x] 5.1 发布到内网（只发布控制中心），发布后读回：健康、静态资源、只读账号读回均通过；线上资源含 v24 代码。

```bash
cd client/yeisme-control-center
bun run typecheck && bun run test && bun run build && bun run test:app
I1_UI_PORT=4340 I1_API_PORT=4341 I1_OWNER_PORT=4342 bun run test:browser-journey   # 在私有网络命名空间里单独跑
bun scripts/verify-collaboration-journey.ts                                          # 同上，连续 3 次
CONTRACT_OWNER_PORT=4370 CONTRACT_API_PORT=4371 bun run test:contract-integration
bun run test:public-guide
bun run check:public-surface
openspec validate yeisme-control-center-studio-v24 --strict --no-interactive
```
