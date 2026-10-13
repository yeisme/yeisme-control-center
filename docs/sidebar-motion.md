# 左右侧栏、全屏详情与类别图标

本轮在 AdminCN v7 六入口基础上继续精修，不增加管理层级或领域写操作。

左侧维持256px/48px，使用现有React Spring的阻尼参数。总览、项目、请求、资产、服务和团队使用不同轮廓的Lucide图标；选中及按压仅做小幅反馈。

右侧标题显示对象图标，直接提供“展开全屏详情”和“还原详情”。普通详情420px，配置560px；全屏覆盖当前应用视口，内容最大1200px居中，编辑区域最大760px。固定面板仍可从更多菜单进入。Escape优先退出完整视图；关闭仍遵守原草稿与任务恢复逻辑。

图像使用青绿、视频使用蓝、音频使用紫、文稿使用赭黄；只作用于小型对象图标与浅色底座。导航、操作图标保持中性；成功/错误/未知等状态与类别色独立。

侧栏沿用`mass: 0.8 / tension: 360 / friction: 34 / clamp: true`；工作区宽度过渡约240ms，按钮与图标反馈约120–180ms。开启减少动态效果时移除动画。表格刷新不逐行入场，范围失效立即清理内容。

验证命令：

```sh
bun run typecheck
bun run test
bun run build
bun run build:demo
CONTROL_CENTER_URL=http://127.0.0.1:4320 bun run test:workspace
CONTROL_CENTER_URL=http://127.0.0.1:4320 bun run test:ui
```

本轮仍为设计演示与共享展示组件更新，实际owner读取、部署和生产写操作分别验收。
