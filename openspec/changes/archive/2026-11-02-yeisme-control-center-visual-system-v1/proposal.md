# Yeisme 控制中心：视觉系统 v1

## Why

v18.1 的 forest/lime 视觉骨架已经成型，但页面成品感不足：
- 页面顶部是只有一个按钮的空白带；
- 提示与 pill 堆叠，原始枚举和 JSON 直接展示；
- 三种表格写法并存，Inspector 停靠时任务列表会折行；
- kind 色与状态色撞色，没有字号体系，图表配色偏离品牌。

## What Changes

- **Token**：
  - kind 色改为状态色族之外的低饱和色相，文字对比度不低于 4.5:1；
  - owner 图表色板经 dataviz 校验器校验（亮色与暗色各自校验）；
  - 新增文字角色、raised/selected 层级和侧栏 lime 焦点环；
  - `--faint` 调整到 4.5:1 以上；
  - 删除未使用的媒体 CSS。
- **共享原语**：
  - `PageToolbar`、`MetricStrip`、`StatCard`、`Progress`（未知值不画空轨道）；
  - `DataTable`：容器查询控制列显示，不依赖视口；
  - `NoticeStack`、`Tabs`/`TabPanel`、`ToggleGroup`、`Checkbox`、`Tooltip`、`IconButton`；
  - `Pill` 新增尺寸；`Button` 在禁用时显示原因。
- **枚举标签**：统一字典 `src/shared/read-model/labels.ts`。
- **页面应用**：各页面接入上述原语，保留所有只读边界、显式预览和浏览器验收依赖的选择器。
- **交互与可访问性**：
  - Inspector 在模态抽屉与最大化模式下焦点留在面板内，<768px 隐藏固定/最大化按钮；
  - 命令面板改为 combobox 语义，支持分组和目录搜索；
  - 侧栏宽度过渡遵循 reduced-motion。

## Boundary

不新增依赖，不恢复 Recharts，不建立第二套 UI 体系，不恢复 AdminCN/v17。视觉调整不改变任何 owner 数据语义。
