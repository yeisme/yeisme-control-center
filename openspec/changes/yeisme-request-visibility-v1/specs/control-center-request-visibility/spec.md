## ADDED Requirements

### Requirement: Scoped request metadata
系统 SHALL 仅展示当前可信身份在目标 owner 授权范围内的请求元数据，且原始状态与身份必须保留。

#### Scenario: 同名成员跨租户
- **WHEN** 两个租户存在同名成员或项目且调用者只获一个范围
- **THEN** 搜索、分页、导出和详情均不得返回另一范围数据

#### Scenario: 来源不可用
- **WHEN** 一个 owner 读取失败
- **THEN** 系统保留其他获授权来源，并显示失败来源与观察时间，不生成正常或零值

### Requirement: Query-wide statistics
系统 SHALL 使用完整授权筛选范围计算指标，不以当前分页替代全量。不同对象种类和币种分别统计。

#### Scenario: 当前分页只有一条
- **WHEN** 全查询匹配多条而第一页仅一条
- **THEN** 汇总反映全查询范围；上传未知字节保持 null

### Requirement: Controlled business content
系统 SHALL 将业务正文读取与普通元数据查询分离，校验范围、用途、独立权限，并先持久化读取审计；没有合同或历史记录时保持明确缺失状态。

#### Scenario: 内容读取权限失效
- **WHEN** 权限被撤销或审计写入失败
- **THEN** 不读取或显示正文，保留可理解的恢复状态，不重新生成请求

### Requirement: Presentation and scope invalidation
客户端 SHALL 在环境、租户、身份或权限改变时清除旧选择和内容，并拒绝旧范围迟到响应。

#### Scenario: 工作区切换断点
- **WHEN** 用户在右侧工作区查看对象并切换桌面到手机
- **THEN** 同一合法对象可继续查看，关闭后恢复原列表位置；范围变化则立即清理

