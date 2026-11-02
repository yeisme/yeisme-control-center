# 设计

## 颜色

- **owner 图表色板**（顺序固定为 eikona、scaena、sonora、aigora，不循环）：
  - 亮色：`#0a8fa8,#4f58c2,#d6457a,#6f8a10`，全部配对通过（CVD ΔE 9.3，正常视觉 16.7）；
  - 暗色：`#00a1bd,#6169c5,#bf5884,#859e3a`，全部配对通过（CVD ΔE 8.6，正常视觉 16.2）；
  - 状态色保留给状态，不用于系列。
- **kind 色**：image 青、video 靛、audio 玫红、text 橄榄，与 success/info/warning/danger/review 色族分离；文字与浅底对比度在亮色下不低于 5:1，暗色下不低于 7:1。

## 版式

- 文字角色：`meta` 12、`body-sm` 13、`title-sm` 15、`title` 17、`metric` 22、`display` 26。Tailwind 默认的 xs/sm/base 不改，避免存量尺寸漂移。
- `PageToolbar` 分两行：第一行是用途说明和操作，第二行是指标和新鲜度。非首页继续只保留 `h1.sr-only`。

## 列表

`DataTable` 使用语义 `<table>`。列优先级由表格自身宽度决定（`@2xl`=672px，`@4xl`=896px），因此 Inspector 停靠后列表只隐藏次要列，不会逐字折行。
