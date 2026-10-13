## Why

当前控制中心叠加了多轮导航、范围栏和自定义控件，偏离用户选定的 AdminCN Free。需要统一模板组件并把日常入口压缩为六项，保留既有领域能力。

## What Changes

- 统一正式版与演示版的外壳、工作区切换器、导航、表格和 Sheet。
- 主入口调整为总览、项目、请求、资产、服务、团队；设置在底部，高级能力进入对应页面。
- 成员去掉统计卡；请求使用紧凑摘要与高级筛选；详情统一概况、内容、执行。
- 保留既有深链、权限、草稿、原请求恢复、统计和导出边界。

## Capabilities

### New Capabilities
- control-center-admincn-workspace：AdminCN 原版组件与六入口工作区，包含菜单、范围与响应式验收。

### Modified Capabilities
无 owner 领域合同变更。

## Impact

仅 client/yeisme-control-center 的界面、验证脚本和交接文档。复用现有依赖与 owner 只读聚合合同；不新增生产写操作。
