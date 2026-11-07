## ADDED Requirements

### Requirement: 内容默认放开
控制中心 SHALL 对任务连接默认放开内容读取；仅显式 `false` 关闭单条连接。Owner 授权仍按每次读取独立校验。

#### Scenario: 登录即读
- **WHEN** 面板登录者打开任务检查器且连接未显式关闭内容
- **THEN** 正文读取入口可用，读取先写控制中心审计，正文仅保留在页面内存

#### Scenario: 显式退出
- **WHEN** 某连接配置 `allow_content: false`
- **THEN** 该连接的正文动作被本地拒绝，不影响其他连接

### Requirement: owner 读取目标可配置
控制中心 SHALL 通过 `personal-config owner add|remove` 维护 owner 委托读取目标（origin、密钥文件、生命周期、`--private-http`）。

#### Scenario: 写入目标
- **WHEN** 管理员执行 `owner add eikona <origin> <key-file> --private-http --expires-at never`
- **THEN** 配置获得该 owner 目标并记录永不过期；重启后提示词库/请求页可读取该 owner
