# 实施任务

- [x] 0.1 基线：工作区状态、改动与已有失败记录在 `temp/integration-test-runs/studio-v20-<ts>/baseline/`。
- [x] 0.2 设计文档 `docs/design/studio-v20.md` 与本变更；`openspec validate yeisme-control-center-studio-v20 --strict --no-interactive`。
- [x] 1.1 令牌 v20 与基础件换皮（Button、Panel、Pill、PageToolbar lead、DetailSheet 手机底部滑出、颗粒与 rise、减动效）。
- [x] 2.1 外壳：5 个入口 rail、手机底部 tab、分区标签、顶栏重排；旧路由、别名、`data-nav`、⌘K 保留。
- [x] 3.1 今天：hero、等你决定（≤3）、正在片场、今天的产出、全部待办（原钩子保留）、系统侧栏与状态线。
- [x] 4.1 制作线构建函数与读模型（剧集与项目两种范围，状态诚实）。
- [x] 4.2 Scaena outline 镜头 `frame_state` 与 `generation_ready`（只给状态）。
- [x] 4.3 剧集横卡、剧集工作室、镜头板；快速查看抽屉保留。
- [x] 5.1 Agent 说明构建函数、交给 Agent 抽屉与各入口。
- [x] 5.2 服务端只读 `GET /production` 与 15 秒结果缓存；合同集成检查。
- [x] 5.3 指南「流程」章节（公开页同步）。
- [x] 6.1 作品画廊、更多筛选、待你挑选。
- [x] 6.2 动态时间线（人 / Agent / 服务 / 未知，只按 owner 字段）。
- [x] 7.1 我的分区、登录页、启动屏、文案收口、移动端。
- [x] 8.1 回归：typecheck、test、build、test:app、browser-journey、public-guide、contract-integration、public-surface、visual-matrix；证据与前后截图。结果见 `temp/integration-test-runs/studio-v20-*/final/NOTES.md`：
  - 浏览器旅程与 Vitest 只剩改动前就有的失败。
  - `check:public-surface` 只因工作区里他人未提交的 `docs/live-read-integration.md` 失败。v20 新增和改动的文件按同样规则扫描无命中。

## 验证命令

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run build
bun run test:app
I1_UI_PORT=4340 I1_API_PORT=4341 I1_OWNER_PORT=4342 bun run test:browser-journey
bun run test:public-guide
CONTRACT_OWNER_PORT=4370 CONTRACT_API_PORT=4371 bun run test:contract-integration   # 本机 4330 被占用时换端口
bun run check:public-surface
VISUAL_LABEL=v20 bun run test:visual-matrix
openspec validate yeisme-control-center-studio-v20 --strict --no-interactive
```
