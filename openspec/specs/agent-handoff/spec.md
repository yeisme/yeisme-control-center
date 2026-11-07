# agent-handoff Specification

## Purpose
TBD - created by archiving change yeisme-control-center-studio-v20. Update Purpose after archive.
## Requirements
### Requirement: 交给 Agent 的说明
控制中心 SHALL 为以下对象生成 `yeisme.agent_brief.v1` 说明：
- 制作线站点；
- 镜头；
- 工作队列项；
- 任务。

说明包含目标、上下文引用、步骤、护栏、验收，以及用人话写的「回到哪里」。

说明只以一种形式供复制：一段中文文本，按钮为「复制给 Agent 的说明」。控制中心 MUST NOT 提供 Claude Code、Codex 命令或 JSON 形式，MUST NOT 代 Agent 执行其中任何步骤。

复制 MUST 在以下环境下都可靠：
- 非安全上下文（局域网 http 地址）；
- 对话框和检查器里。

复制不成功时，MUST 打开多行的手动复制框，框内是完整文本，换行保留。

#### Scenario: 复制说明
- **WHEN** 用户在某个镜头上选择「交给 Agent」并点「复制给 Agent 的说明」
- **THEN** 剪贴板里是那段中文说明，换行完整；控制中心没有发出任何写请求

#### Scenario: 局域网 http 地址
- **WHEN** 页面不在安全上下文、没有 `navigator.clipboard`，用户在交接抽屉里点复制
- **THEN** 复制仍然成功，焦点留在抽屉里

#### Scenario: 浏览器拒绝复制
- **WHEN** 系统剪贴板与 `execCommand("copy")` 都被拒绝
- **THEN** 手动复制框打开，里面是完整的多行说明，内容已全选

### Requirement: 说明里的护栏
说明 SHALL 要求 Agent 先用 `tools/list`、`<tool>.search` 或 `actions.describe` 取得动作名与参数；会产生费用的步骤 MUST 只做 `dry_run` 或报价并等待人确认；结果未知 MUST 只回查不重试。说明 MUST NOT 包含主机名、端口、令牌、密钥或凭据路径。

#### Scenario: 画面站的说明
- **WHEN** 生成画面站的说明
- **THEN** 其中 Eikona 生成步骤的 `execution_mode` 为 `dry_run`，且全文不含任何地址或令牌

### Requirement: 归属只按 owner 字段
动态时间线 SHALL 只用 owner 的类型字段标注人、服务或 Agent：请求的 `actor_type` 为 `human` 时标「人」，为 `service` 时标「服务」。任务观察只有自由文本 `actor`，时间线 MUST 原样引用并注明「未标类型」，MUST NOT 把它归为人、服务或 Agent。某条请求用 `task_ref` 指明一个任务时，该任务 MAY 沿用这条请求的类型。没有任何字段时 MUST 标为「未知」。时间线 MUST NOT 从名字或文本推断 Agent。

#### Scenario: 没有归属字段
- **WHEN** 任务观察没有 `actor`，也没有请求指明它
- **THEN** 时间线把该事件的发起方标为「未知」

#### Scenario: 只有自由文本
- **WHEN** 任务观察的 `actor` 是「codex agent」
- **THEN** 时间线显示「codex agent（未标类型）」，不显示「Agent」标签

#### Scenario: 请求指明任务
- **WHEN** 一条 `actor_type` 为 `human` 的请求用 `task_ref` 指明了某个任务
- **THEN** 时间线把该任务标为「人」，并且这条请求不再单独出现一次

