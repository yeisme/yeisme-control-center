## ADDED Requirements

### Requirement: Authorized task observation
系统 SHALL 返回当前授权范围内的任务、真实阶段、计数、原始状态和观察时间，不因刷新触发执行。

#### Scenario: 生成尚未结束
- **WHEN** MCP任务已受理且provider仍在执行
- **THEN** 控制台可以找到任务并展示未知百分比及真实阶段

#### Scenario: 范围或权限改变
- **WHEN** 当前身份切换项目或权限撤销
- **THEN** 清除旧内容并拒绝迟到响应与越权媒体访问

### Requirement: Recovery without resubmission
系统 SHALL 保留原任务引用；取消和内容读取必须独立授权，不自动生成新尝试。

#### Scenario: 结果未知
- **WHEN** 客户端中断或事件游标过期
- **THEN** 查询原snapshot，未确认结果不重投、不伪造成功
