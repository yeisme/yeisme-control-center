## ADDED Requirements

### Requirement: Named personal identity
系统 SHALL 从服务端配置核验 personal username/password，并返回可信角色；旧未配置用户名的个人模式保持兼容。

#### Scenario: 已配置用户名
- **WHEN** 密码正确但用户名缺失或不匹配
- **THEN** 返回统一 invalid_credentials，不创建会话

#### Scenario: 角色与 owner 授权
- **WHEN** 控制中心 admin 查询或操作 owner
- **THEN** 仍检查范围、固定连接及 owner 独立权限，不信任客户端 role

### Requirement: Honest scoped service directory
系统 SHALL 区分产品登记、当前范围配置和实际观测，仅返回允许范围内的非秘密连接信息。

#### Scenario: 未配置或未授权
- **WHEN** 某服务缺合同或未登记当前用户连接
- **THEN** 显示准确缺口，不返回其他用户连接，不补造在线状态或样例任务

#### Scenario: 静态目录查询
- **WHEN** 用户读取目录
- **THEN** 不调用上游、不读取秘密、不执行生成或管理动作

### Requirement: Separate live acceptance
系统 SHALL 分别记录源码、隔离测试、真实授权读取与部署证据。

#### Scenario: 缺部署准入或 observer
- **WHEN** 真实验证缺有效权限或部署允许
- **THEN** 停止相关步骤并请求最小授权，不将演示或进程在线标记为全链路通过
