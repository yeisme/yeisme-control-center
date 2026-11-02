# Tasks

## 1. 主列规则

- [x] 1.1 `src/components/ui/Data.tsx`：`mainColumn`、`narrowMainColumn`、`fillMainColumn`，并从 `components/ui` 导出
- [x] 1.2 接入：任务中心与项目三张表用 `fillMainColumn`；目录 MCP 工具与动作、资源紧凑列表用 `mainColumn`；模型、渠道、服务目录、资源详情列表用 `narrowMainColumn`

## 2. 行节奏

- [x] 2.1 资源列表：音频、视频的种类徽标放进与缩略图同尺寸的位置

## 3. 验证

- [x] 3.1 测量 1440 / 1536 / 1920 / 2560 下每张表主列宽度与“主列文字结尾到下一列内容”的距离；1440 不变，1920 与 2560 下最大不超过 490px
- [x] 3.2 浏览器旅程：1920 下任务表与工具表主列为 560px 且上下对齐；注入长描述后表格不横向滚动；资源紧凑列表的名称起点和行高各只有一种
- [x] 3.3 单元测试、类型检查、构建、`test:ci:browser`、共享项目旅程、公开面扫描
