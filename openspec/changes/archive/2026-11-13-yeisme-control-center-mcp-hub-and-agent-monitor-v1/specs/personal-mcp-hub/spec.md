## ADDED Requirements

### Requirement: 五入口内的个人 MCP 网关管理工作台
控制中心 SHALL 在「我的」入口下提供 `mcp-gateway` 页面（`#/mcp-gateway`），展示网关连接概况、Standard 与 Compact Schema Token 占用对比、后端服务及 stdio 监管状态、分组与导出配置、工具暴露矩阵、多客户端接入预设、消费者凭据状态以及待处理审批与修订历史。

#### Scenario: 复制多客户端安全接入配置
- **WHEN** 用户在 `#/mcp-gateway` 打开「复制客户端配置」并选择 Claude Code、Codex、Cursor、Pi 或通用 HTTP
- **THEN** 页面 SHALL 展示并可复制由服务端生成的配置 JSON 或 CLI 命令
- **AND** 内容 SHALL 仅包含环境变量占位符，不包含任何真实密钥或内网私密路径

#### Scenario: 受控调整后端工具暴露并确认预览
- **WHEN** `admin` 用户勾选修改某后端的 `exposeTools` 或所属分组并点击保存
- **THEN** 系统 SHALL 先请求 `ActionService.preview` 展示 Gateway Plan 的规范化字段差异与当前 `expected_revision`
- **AND** 用户确认后才执行 `confirm` 并生成带 `operation_id` 与新 `revision` 的回执；若未配置管理凭据或用户为 `viewer`，写操作保持禁用并说明原因

#### Scenario: 受管目录签发新客户端凭据零明文回传
- **WHEN** `admin` 用户发起 `gateway.token.issue` 为新 Agent 客户端签发普通消费者凭据
- **THEN** 凭据仅写入网关主机受管目录的新 `0600` 文件，控制中心仅展示目标文件标识、`key_hint` 与权限范围，网络响应和浏览器存储中不出现明文 Token
