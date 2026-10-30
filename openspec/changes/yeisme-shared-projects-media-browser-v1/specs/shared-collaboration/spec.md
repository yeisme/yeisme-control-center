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

### Requirement: 用户可创建本地共享项目
控制中心管理员 MUST 能创建协作组织，并成为该组织管理员。组织管理员 MUST 能在该组织内创建共享项目。普通成员、查看者和只读会话 MUST NOT 创建组织或项目。创建只写入控制中心本地协作记录，MUST NOT 在 Aigora、Scaena、Eikona、Sonora 或其他 owner 中创建领域项目，也 MUST NOT 把本地 grant 当成 owner 领域权限。

#### Scenario: 管理员创建空项目
- **WHEN** 组织管理员提交 `project.create`，名称合法，绑定为空或全部来自当前身份的 binding options
- **THEN** 服务创建独立项目，指定或当前管理员成为项目管理员，未绑定的项目仍可管理成员与文件夹，生成与成果读取保持等待关联

#### Scenario: 非管理员创建
- **WHEN** 非该组织管理员的会话调用 `project.create`，或非控制中心管理员调用 `organization.create`
- **THEN** 服务拒绝写入，不创建记录

#### Scenario: 绑定不在候选内
- **WHEN** 创建请求包含手填的 owner、项目引用或不在 binding options 中的绑定
- **THEN** 返回 `invalid_project_bindings`，不向 owner 发出创建请求

### Requirement: 前端按同一权限展示创建能力
共享项目页 MUST 按服务端权限展示创建入口，不得只在规格或服务端保留该能力。创建组织仅在组织列表返回 `can_create` 时可见；创建项目仅对当前选中组织的管理员可见。提交 MUST 走 preview 再 confirm，预览不可用时 MUST 不能确认保存。

#### Scenario: 管理员看到入口
- **WHEN** 控制中心管理员打开侧栏「项目」（`#/projects`），且当前组织角色为 admin
- **THEN** 页面直接进入共享项目，显示「创建组织」与「创建项目」，空组织列表提供创建组织动作；`#/projects?catalog=owner` 才显示 owner 连接，并可返回共享项目

#### Scenario: 非管理员不看到入口
- **WHEN** 会话不是控制中心管理员，或当前组织角色不是 admin
- **THEN** 对应的创建组织或创建项目按钮不渲染；直接调用动作仍由服务端拒绝

#### Scenario: 创建表单不接受任意 owner
- **WHEN** 用户打开创建项目表单
- **THEN** owner 关联只能勾选服务端返回的 binding options，没有候选时说明当前身份没有可绑定的 owner 项目，表单说明操作只影响控制中心协作数据
