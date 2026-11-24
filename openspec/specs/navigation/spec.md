# navigation Specification

## Purpose
TBD - created by archiving change yeisme-control-center-studio-v23. Update Purpose after archive.
## Requirements
### Requirement: 七个入口分两组
侧栏 SHALL 按顺序显示 7 个一级入口。「制作」组是今天、项目、剧集、作品、动态；「接入」组是连接、设置。在 `lg` 及以上宽度，接入组 SHALL 固定在侧栏底部，用分隔线和制作组隔开。每个可路由页面 SHALL 恰好属于一个入口，并显示为入口内的一个 tab。已有路由和别名（包括 `/team`、`/admin`、`/services`、`/connections`、`/members`）MUST 照常可用。

#### Scenario: 桌面侧栏
- **WHEN** 用户在 1440 宽度登录
- **THEN** 侧栏依次显示今天、项目、剧集、作品、动态、连接、设置，设置入口离侧栏底部不超过 24px

#### Scenario: 旧地址
- **WHEN** 用户打开 `/services`
- **THEN** 打开「服务与连接」，侧栏「连接」标为当前

### Requirement: 设置和主题只有一处入口
侧栏 MUST NOT 有主题按钮和齿轮按钮。账号菜单 SHALL 只包含：身份信息、一行主题三段切换、「我的账号」、「退出登录」。完整的外观设置 SHALL 只在「设置 → 偏好」里。

#### Scenario: 账号菜单
- **WHEN** 用户打开账号菜单
- **THEN** 菜单里有主题切换组，菜单项只有「我的账号」和「退出登录」

### Requirement: 手机的「更多」
在手机宽度，底部胶囊 SHALL 只显示今天、项目、作品、动态和「更多」。「更多」SHALL 打开一个底部弹层，列出剧集、连接、设置。当前页面属于这三个入口之一时，「更多」SHALL 标为当前。

#### Scenario: 从「更多」进入设置
- **WHEN** 用户在 390 宽度点「更多」，再点「设置」
- **THEN** 打开设置页，弹层关闭，「更多」的 `aria-current` 为 `true`

### Requirement: 批量生成可见
「批量生成」SHALL 作为「剧集」入口的一个可见 tab。不在项目范围内打开时，页面 SHALL 列出可进入的项目，并提供「全部项目」和「去新建项目」，MUST NOT 静默跳转。带 `?owner=` 的旧工具链接 SHALL 仍然去使用指南。

#### Scenario: 个人范围
- **WHEN** 用户在个人范围打开「批量生成」
- **THEN** 页面写明「批量生成在项目里进行」，并列出可进入的项目

### Requirement: 快捷键
`G N` SHALL 打开「连接」；`G P` SHALL 打开「项目」。快捷键表 MUST 没有冲突。

#### Scenario: 键盘进入项目
- **WHEN** 焦点不在输入框时，用户依次按 `g`、`p`
- **THEN** 打开项目列表

