# task-review-observation Specification

## Purpose
TBD - created by archiving change yeisme-control-center-task-review-observation-v1. Update Purpose after archive.
## Requirements
### Requirement: 读取 Eikona 的任务审阅记录
控制中心 SHALL 通过任务自己的 Eikona 任务连接调用 `control_center.tasks.review`，只读，按范围、连接和任务缓存 30 秒。
- 回答 MUST 校验模式、任务引用和计数（已决定加待挑选等于候选数）；对不上时 MUST 记为「读不到」，MUST NOT 采用。
- 回答里的审阅人、理由、候选标签 MUST NOT 被保留或显示。
- 一次批量读取 MUST 只接受本 scope 签发的任务键，最多 10 个；不合格的请求 MUST 在调用 owner 之前被拒绝。
- owner 没有这个动作或拒绝它时 MUST 显示「待接通」；这次拒绝 MUST NOT 让同一连接的任务读取变成未授权。

#### Scenario: owner 没有这个动作
- **WHEN** Eikona 对这个动作回答 `UNKNOWN_ACTION`
- **THEN** 这个任务的审阅记录显示「待接通」，画面站按任务状态判断待挑选，并写明有几个任务的审阅状态待接通

#### Scenario: 拒绝不污染连接
- **WHEN** Eikona 对这个动作回答 `AUTH_ACTION_DENIED`
- **THEN** 审阅记录显示「待接通」，随后的任务列表照常读取，连接状态不是「未授权」

### Requirement: 画面站按 owner 的决定显示待挑选
画面站 SHALL 对 Eikona 回答了的任务按它的决定判断待挑选：有候选且还没有决定才算；已有决定的 MUST NOT 算待挑选。没有回答的任务 SHALL 按任务状态判断。

#### Scenario: Eikona 已经做了决定
- **WHEN** 任务状态是 `waiting_review`，Eikona 记录的决定是 `rejected`
- **THEN** 画面站不把它列为待挑选，并在「Eikona 审阅记录」里计入「已有决定」

#### Scenario: Eikona 说还在等人挑
- **WHEN** 任务状态是 `succeeded`，Eikona 记录有 1 个候选、还没有决定
- **THEN** 画面站把它列为待挑选，下一步是「人来挑选」

### Requirement: 任务详情只读显示审阅记录
Eikona 运行的任务详情 SHALL 显示 Eikona 的决定、候选数、待挑选数、已决定数、下游接收和决定时间，并说明挑选和决定在 Eikona 里做。这一块 MUST NOT 提供任何操作。

#### Scenario: 打开一个待挑选的运行
- **WHEN** 打开 Eikona 记录为「还没有决定」、2 个候选的运行
- **THEN** 详情显示「还没有决定」和候选 2 个，没有按钮

