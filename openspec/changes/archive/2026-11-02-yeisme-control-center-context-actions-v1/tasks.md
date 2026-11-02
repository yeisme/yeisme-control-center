# Tasks

## 1. 动作模型与原语

- [x] 1.1 `ItemAction`、`actionGroups`、`renderActions`、`ActionsMenu`、`ActionsContextMenu`
- [x] 1.2 菜单层级 80；两套菜单项样式合并；`ContextMenuLabel`、`ContextMenuCheckboxItem`；菜单内点击不冒泡；右键菜单宽度跟随可用空间
- [x] 1.3 Shift+F10 与菜单键；关闭后焦点回到原行；长按不触发行点击；快捷键表
- [x] 1.4 `DataTable.rowActions`；`useCopy` 与手动复制框；`linkActions`（在新标签打开、复制链接）

## 2. 逐页接入

- [x] 2.1 任务行；任务详情“更多”改用动作模型，删除多余 Esc 监听与“删除任务”项
- [x] 2.2 工具项目卡片与详情头；共享项目行与详情头
- [x] 2.3 提醒行；通知弹层每一条
- [x] 2.4 资源卡片与表格行；请求行；剧集行；服务连接卡片；目录四类表格
- [x] 2.5 侧栏导航

## 3. 验证

- [x] 3.1 单元测试 `tests/item-actions.test.ts`：分组与分隔线、两种菜单项一致、不可用原因
- [x] 3.2 浏览器旅程：右键与“更多操作”一致、菜单 axe、Shift+F10 位置与焦点回位、详情内菜单在最上层且 Esc 只关菜单、提醒菜单、手机长按不打开行且菜单不出屏
