## ADDED Requirements

### Requirement: 真实联调强制隔离
验证实例 SHALL 使用临时绝对数据库和配置路径，禁用后台观察及领域写入口，不得打开或迁移源数据库。

#### Scenario: 源配置指定生产数据库
- **WHEN** 用带 database.path 的源配置启动验证
- **THEN** 输出配置只能使用私有临时数据库，源路径保持不变，后台观察关闭

#### Scenario: 真实验证提交领域写请求
- **WHEN** 在隔离只读模式调用生成、取消或管理写入
- **THEN** 服务端在执行前拒绝

### Requirement: 来源独立授权
共享项目 SHALL 通过独立 collection binding 引用 Auctra，并对当前访问者逐次解析授权，不借创建者身份。

#### Scenario: 来源撤权或绑定修订
- **WHEN** 来源授权撤销、解绑或更换作品
- **THEN** 旧索引和缓存不可读，confirm 旧 preview 失败且不改变状态

### Requirement: 项目制作深链恢复
前端 SHALL 从 sharedProject 恢复项目 scope 后读取剧集与制作线，无权时不得回退个人范围。

#### Scenario: 新标签打开剧集链接
- **WHEN** 合法用户打开带 sharedProject 的单集链接
- **THEN** 项目、来源、制作聚合保持一致；零条、未同步和部分失败明确区分

### Requirement: 候选来源可追溯
发布 SHALL 使用经过验收的完整审核快照，包含必要未跟踪源码且排除私有配置和证据。

#### Scenario: 候选快照变化
- **WHEN** 构建或激活前发现源码摘要变化
- **THEN** 阻断发布并要求重新验证同一快照
