## Why
MCP 连接成功后，用户无法区分协议可用、工具发现、调用验证和领域任务结果，也无法安全使用官方 Skills 与最新模板来准备资产生产。

## What Changes
- fit：控制中心拥有 MCP 连接诊断、Skill/模板推荐、版本选择、更新提醒和资产 preflight 的消费体验。
- split-owner：Gateway discovery/validate、模板 resolver/catalog、Skills 源和资产生产仍由各自 owner 提供。
- reject-now：不执行远程代码、不接受任意 URL、不读取私有模板正文、不自动提交 Provider。
- 新增 body-free DTO、安全 normalization、推荐与选择状态；owner 合同缺失时保持 `needs_contract`。

## Capabilities
### New Capabilities
- `mcp-skill-template-experience`: MCP 四态诊断、Skill/模板推荐、版本固定、更新与 preflight。
### Modified Capabilities
无；现有 Gateway、模板目录和资产生产合同保持兼容，新增字段不改变旧行为。

## Impact
限 `client/yeisme-control-center` 的 shared DTO、server normalization、UI 和测试。远程源与 Registry 未发布合同时不生成 adapter 假数据，不执行生成、取消、审阅或交付。
