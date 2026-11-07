# motion Specification

## Purpose
TBD - created by archiving change yeisme-control-center-studio-v21. Update Purpose after archive.
## Requirements
### Requirement: 动效令牌与两类动效
动效 SHALL 使用 `tokens.css` 里统一的时长、缓动和位移令牌，并分成两类：
- **微交互**（悬停、按下、选中、指示条）：90–180ms，位移不超过 3px。
- **空间动效**（面板、抽屉、浮层、共享元素、路由）：200–320ms，沿真实几何从触发点或屏幕边缘出来；退场约为入场的 0.7 倍。

动效 MUST NOT 回弹，MUST 可以打断，首帧 MUST 就能读。动效 MUST 只改 transform、opacity 和 filter。

对话框、抽屉、弹出层和菜单 MUST 立即关闭，不做退场动画：退场期间这一层仍是最上层，会吃掉下一次 Esc、挡住外面的点击。只有不占键盘的层 SHALL 淡出：提示、通知和遮罩；遮罩淡出期间 MUST NOT 接收点击。

#### Scenario: 关闭菜单后马上点
- **WHEN** 用户按 Esc 关闭一个菜单，紧接着点页面上的按钮
- **THEN** 菜单立即消失，这次点击落在按钮上

#### Scenario: 连按两次 Esc
- **WHEN** 检查器上开着交给 Agent 的抽屉，用户连按两次 Esc
- **THEN** 第一次关掉抽屉，第二次关掉检查器

### Requirement: 减少动效
系统偏好减少动效，或用户在设置里选了「减少」时，所有动效 MUST 只做透明度变化，不超过 120ms，或直接切换。权限和业务状态的更新 MUST NOT 因动画而延迟。

#### Scenario: 打开检查器
- **WHEN** 在减少动效下打开右侧检查器
- **THEN** 面板没有位移，只在 120ms 内淡入

### Requirement: 滑动指示与只播一次的入场
Tabs、切换组、侧栏入口和检查器分区导航的选中块 SHALL 滑到新位置，而不是跳过去。页面入场动画每次挂载 MUST 只播一次；关闭检查器 MUST NOT 让整页重播入场动画。

#### Scenario: 关闭检查器
- **WHEN** 用户在任务页关闭检查器
- **THEN** 列表原地保持，没有重新淡入

