# control-center-task-prompt-content Specification

## Purpose

任务检查器中的受控原始提示词读取：先写控制中心审计，再通过固定 owner 动作读取任务绑定的正文，正文只在当前页面内存展示。
## Requirements
### Requirement: Audited original prompt read
控制中心 SHALL 在任务检查器中提供显式的原始提示词读取；读取前先写控制中心审计，再通过 owner 公开动作读取，正文只存在于当前页面内存。

#### Scenario: 读取已授权正文
- **WHEN** 任务观察返回 `prompt_capture.readable=true` 和 `capture_ref`，用户填写用途并确认读取
- **THEN** 控制中心先写 `tasks.prompt_read` 审计，再调用 owner 动作，并在当前检查器内展示正文与审计回执

#### Scenario: 未授权或未留存
- **WHEN** 连接未开启 `allow_content`、owner 拒绝、审计失败或 owner 返回 `not_recorded`
- **THEN** 显示对应的明确错误或未留存状态，不显示空正文、不伪造成功、不回退演示数据

#### Scenario: 关闭检查器
- **WHEN** 用户关闭检查器、切换范围或登出
- **THEN** 正文与读取结果从内存清除，不写入 localStorage、服务端持久化、日志或证据目录

