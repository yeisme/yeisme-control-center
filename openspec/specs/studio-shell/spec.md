# studio-shell Specification

## Purpose
TBD - created by archiving change yeisme-control-center-studio-v20. Update Purpose after archive.
## Requirements
### Requirement: 五个入口与分区标签
控制中心 SHALL 以 5 个入口（今天、创作、作品、动态、我的）组织全部页面，每个入口内的页面以分区标签呈现；每个页面 MUST 恰好属于一个入口。

#### Scenario: 打开提醒页
- **WHEN** 用户打开 `#/reminders`
- **THEN** 「动态」入口标为当前，分区标签中带 `data-nav="reminders"` 的标签标为 `aria-current="page"` 并显示未读数，与铃铛和页面的未读数一致

#### Scenario: 隐藏页面
- **WHEN** 用户经通知打开 `#/creation`
- **THEN** 页面可用，但任何入口或分区标签里都没有 `data-nav="creation"`

### Requirement: 旧路由与别名保留
控制中心 SHALL 保留全部既有路由、`pageFromPath` 别名与命令面板里的全部页面；改变入口层级 MUST NOT 让任何既有深链失效。

#### Scenario: 旧深链
- **WHEN** 用户打开 `#/connections` 或 `#/drama?episode=ep-01`
- **THEN** 分别进入服务页与该集的快速查看，与改造前一致

### Requirement: 手机底部导航
视口宽度小于 1024px 时，控制中心 SHALL 用底部 5 个 tab 替代侧栏和汉堡菜单，并为浮动播放器、抽屉与页面底部让出 tab 栏高度和安全区。

#### Scenario: 390 宽
- **WHEN** 在 390×844 的视口打开任意列表页
- **THEN** 底部显示 5 个可达的 tab，第一条结果仍在 400px 以内，页面没有横向溢出

### Requirement: 每页一个 h1
每个页面 SHALL 恰好有一个 h1。列表与工具页的 h1 保持视觉隐藏并沿用原名，展示性大标题 MUST 使用 h2 或更低层级。

#### Scenario: 剧集工作室
- **WHEN** 用户打开 `#/drama?studio=ep-01`
- **THEN** 页面的 h1 为视觉隐藏的「剧集制作」，集名以 h2 显示

