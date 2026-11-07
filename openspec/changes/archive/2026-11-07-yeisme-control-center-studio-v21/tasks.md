# 实施任务

- [x] 0.1 基线：工作区状态、改动和受保护文件的指纹，记在 `temp/integration-test-runs/studio-v21-<ts>/p0/`。
- [x] 0.2 设计文档 `docs/design/studio-v21.md` 与本变更；`openspec validate yeisme-control-center-studio-v21 --strict --no-interactive`。
- [x] 1.1 层级刻度 `--z-*`，替换各处字面值；胶片颗粒层降到大图之下。
- [x] 1.2 `copyText()`：挂进对话框，以 copy 事件为准；多行手动复制框。
- [x] 1.3 交给 Agent 只留中文说明；删除命令与 JSON 形式；更新指南和 v20 的 agent-handoff 规格。
- [x] 2.1 纯函数：页窗口、排序、偏好（含迁移）。
- [x] 2.2 Pager、`usePagedRows`、DataTable v2（窄屏卡片、排序）、FilterBar 清页码。
- [x] 2.3 接入任务、请求、提醒、作品、用量、剧集、动态、审阅、模型与工具（每个工具的动作分页）。审计与成员在 5.2 的管理页里接入；服务目录条目很少，不分页。
- [x] 3.1 匹配器、查询语法、筛选计数、保存视图（纯函数）。
- [x] 3.2 QueryBar、SavedViews、QueryScope；按需读取更早的历史。
- [x] 4.1 ⌘K：排序、来源、范围、高亮、预览、服务端补查；按平台显示的快捷键。
- [x] 5.1 服务端：重置 Key、启用、修改、自助重置；防护、审计与开关。
- [x] 5.2 管理页：账号、组织与团队、工具成员、审计；新建向导与 Key 只显示一次。
- [x] 5.3 fixture `FIXTURE_ACCOUNTS=manage` 与写入流程旅程。
- [x] 6.1 设备偏好、设置页。
- [x] 6.2 快捷键表、分发器、改键、速查表。
- [x] 7.1 动效令牌、motion.css、presence、滑动指示、页面入场只播一次。
- [x] 8.1 悬浮胶囊侧栏（桌面竖向、手机底部）与数字徽标。
- [x] 9.1 SidePanel：三种布局、调宽、上一项 / 下一项、退场、不闪烁。
- [x] 10.1 大图 v2：FLIP、交叉淡化、手势、操作区、信息抽屉。
- [x] 10.2 画廊 v2：缩略图大小、按比例排列、视频海报。
- [x] 11.1 创作页原地点击：站点、结果、决定、镜头；叠层后退。
- [x] 12.1 回归、文档、视觉矩阵；受保护文件未改动。

## 验证命令

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run build
bun run test:app
I1_UI_PORT=4340 I1_API_PORT=4341 I1_OWNER_PORT=4342 bun run test:browser-journey
.claude/skills/yeisme-ui-motion-quality/scripts/check_motion_policy.sh
bun run test:public-guide
CONTRACT_OWNER_PORT=4370 CONTRACT_API_PORT=4371 bun run test:contract-integration   # 本机 4330 被占用时换端口
bun run check:public-surface
VISUAL_LABEL=v21 bun run test:visual-matrix
openspec validate yeisme-control-center-studio-v21 --strict --no-interactive
```
