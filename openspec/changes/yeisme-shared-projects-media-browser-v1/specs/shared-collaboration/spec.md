## ADDED Requirements

### Requirement: 组织授权隔离
服务 MUST 根据稳定账号、活动组织成员和项目 grant 计算权限，不能按显示名称或 owner 引用合并项目。

#### Scenario: 同名跨组织项目
- **WHEN** 两组织创建同名项目并绑定同一 owner 引用
- **THEN** 项目、文件夹、回执和成员授权仍独立，未获组织授权者收到 not_found

#### Scenario: 团队授权与暂停
- **WHEN** 团队创作者权限与个人查看权限同时存在
- **THEN** 有效权限为创作者，暂停组织成员后立即失去项目访问

### Requirement: 成员读取需要组织委托
owner 成员读取 MUST 在凭据解析与出站前校验组织会话、有效期和 audience，个人会话不得使用服务凭据补齐。

#### Scenario: 个人会话存在服务凭据
- **WHEN** 个人会话访问 owner 成员目录
- **THEN** 在读取服务凭据和发出 owner 请求前返回 delegation_unavailable

### Requirement: 本地写入与回执原子持久化
协作写入 MUST 绑定主体、scope、目标、版本、幂等键并重新授权，本地变更与成功回执 MUST 同事务持久化。

#### Scenario: 重启后确认原请求
- **WHEN** 相同主体重新确认相同预览与幂等键
- **THEN** 返回原回执，不重复创建项目
