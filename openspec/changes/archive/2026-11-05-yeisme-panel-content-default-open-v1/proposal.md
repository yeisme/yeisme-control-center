## Why

内容读取的连接开关默认关闭，且没有配置 owner 委托读取目标（`config.owners`）的命令入口：面板登录后提示词库/请求页对所有 owner 显示未完成或未配置，任务检查器也拿不到正文授权事实。Owner（用户本人）已明确决定：能登录面板就能看，默认放开，不逐连接设置。

## What Changes

- `allow_content` 默认放开：未设置即允许，显式 `false` 才关闭；connect 默认带内容（`--no-content` 退出）。
- 新增 `personal-config owner add|remove` 命令，写入/移除 owner 委托读取目标（origin + 密钥文件 + 生命周期 + `--private-http`）。
- Eikona 委托读取目标已配置（18976，`control-center-rest` 键，永不过期）。

## Capabilities

### New Capabilities
- `control-center-content-default-open`: 面板默认放开内容读取与 owner 读取目标的配置合同。

## Impact

server 连接门、personal-config、任务检查器读取入口。Owner 授权仍在每次读取时校验；Sonora/Scaena 需各自 owner 签发读取凭据后才能接通。
