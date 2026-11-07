## ADDED Requirements

### Requirement: 网页管理账号
个人管理员 SHALL 能在网页上管理个人账号：
- 新建账号；
- 重置访问 Key；
- 停用与启用；
- 修改显示名、角色和范围。

登录方式 MUST 仍是用户名加访问 Key，不新增密码。

每个写入接口都 MUST：
- 要求个人管理员会话；
- 通过 `auth.csrf` 校验；
- 在配置锁里写入；
- 记一条审计（`admin.user_created`、`admin.user_rotated`、`admin.user_enabled`、`admin.user_updated`、`admin.user_revoked`）。

这项能力 SHALL 默认开启；`personal.web_accounts.manage` 设为 `false` 时，这些接口 MUST 拒绝写入。

#### Scenario: 新建账号
- **WHEN** 管理员在新建向导里填好用户名、显示名、角色和范围并确认
- **THEN** 新 Key 只显示一次，勾选「我已保存」后才能关闭；用这个 Key 可以在新窗口登录；审计里有一条 `admin.user_created`

#### Scenario: 关闭开关
- **WHEN** 配置里 `personal.web_accounts.manage` 为 `false`
- **THEN** 账号列表仍可读，所有写入接口返回拒绝，页面说明「账号管理已在配置里关闭」

### Requirement: 新 Key 只给一次
重置访问 Key 时，服务端 SHALL：
- 以 0600 权限原子替换摘要文件；
- 让该账号已有的会话全部失效；
- 只在这一次响应里返回新 Key。

新 Key MUST NOT 写进地址、日志、审计或证据。关闭显示框后，界面 MUST 把它从内存状态里清掉。

#### Scenario: 重置后旧 Key
- **WHEN** 管理员重置账号 A 的 Key
- **THEN** 账号 A 已登录的会话失效，用旧 Key 登录被拒绝，新 Key 可以登录

### Requirement: 自助重置
已登录的个人用户 SHALL 能重置自己的访问 Key，前提是提供当前的 Key。新 Key 只显示一次。这个账号的其他会话 MUST 立刻失效；发出请求的会话 SHALL 保留到用户确认已保存，然后退出。

#### Scenario: 当前 Key 不对
- **WHEN** 用户提交的当前 Key 不正确
- **THEN** 重置被拒绝，Key 不变，会话不受影响，审计里记一条拒绝

#### Scenario: 重置成功
- **WHEN** 用户提交正确的当前 Key
- **THEN** 新 Key 只显示一次；同一账号在别处的登录立刻失效；用户勾选已保存并完成后，这里退出登录，旧 Key 登录被拒绝，新 Key 可以登录

### Requirement: 主账号不被锁在门外
配置主账号没有用户名、也还没有别的账号时，网页 MUST 拒绝新建第一个账号（409 `owner_username_required`），并说明先用命令行给主账号起用户名。新账号的用户名 MUST NOT 与主账号的用户名相同（409 `user_exists`）。

#### Scenario: 没有用户名的主账号
- **WHEN** 主账号没有用户名，管理员在网页上新建第一个账号
- **THEN** 创建被拒绝，账号页说明原因，「新建账号」不可用

### Requirement: 账号防护
服务端 MUST 拒绝以下操作：

| 情况 | 返回 |
|---|---|
| 撤掉最后一个管理员 | 409 `last_admin_required` |
| 停用自己 | `cannot_revoke_self` |
| 在网页上改旧版所有者账号 | `legacy_owner_managed_by_cli` |
| 启用一个与有效账号重名的账号 | 拒绝 |
| 修改资料时 `if_match` 与当前不一致 | 409 `user_changed` |

只读账号调用这些接口，MUST 得到 403。

#### Scenario: 最后一个管理员
- **WHEN** 管理员把自己以外仅剩的管理员也改成只读，结果会没有任何有效管理员
- **THEN** 修改被拒绝，返回 `last_admin_required`

### Requirement: 管理页
「成员与管理」页 SHALL 对管理员显示四个分区：账号、组织与团队、工具成员、审计；对其他人只显示组织与团队、工具成员。
- 旧路由 `#/members` 和 `#/audit` MUST 继续可用，并定位到对应分区。
- 「工具成员」分区 MUST 如实说明：工具里的成员目录需要组织身份登录才能读取。
- 「审计」分区 SHALL 能按动作、结果、操作人和日期筛选，并能翻页。

#### Scenario: 个人登录看工具成员
- **WHEN** 个人管理员打开「工具成员」
- **THEN** 页面说明需要组织身份，并指向「账号」与「组织与团队」，不显示一张空表
