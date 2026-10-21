# 实施任务

- [x] 1.1 token：kind 色、owner 图表色板（经校验）、文字角色、层级、`--faint`、侧栏焦点环、删除死 CSS。
- [x] 1.2 原语：PageToolbar、MetricStrip、StatCard、Progress、DataTable、NoticeStack、Tabs、ToggleGroup、Checkbox、Tooltip、IconButton、Pill 尺寸、Button 禁用原因。
- [x] 1.3 统一枚举标签字典。
- [x] 2.1 模型与工具、AI 创作接入新原语。
- [x] 2.2 首页、任务、资源库、请求、服务、用量、提醒、审阅、团队、项目接入新原语。
- [x] 3.1 Inspector 模态焦点陷阱与移动端控件收敛；命令面板 combobox 语义与目录分组。
- [x] 3.2 修复 TaskDetail 重复 Escape 监听。
- [x] 4.1 视觉证据：before/after 截图矩阵（1440 亮/暗、390、2048 Inspector）。

## 验证命令

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run build
bun run test:app
bun run test:browser-journey
VISUAL_LABEL=after bun run test:visual-matrix
```
