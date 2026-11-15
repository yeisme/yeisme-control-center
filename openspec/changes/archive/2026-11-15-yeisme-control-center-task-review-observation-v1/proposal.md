## Why
制作线的画面站和任务详情判断「待挑选」只看任务状态 `waiting_review`。真实 Eikona 从不发出这个状态：它的审阅决定记在自己的 `reviewdecision` 存储里，观察者读不到。所以真实环境里画面站要么永远没有「待挑选」，要么在 Eikona 已经做了决定之后还显示「待挑选」。Eikona 本地新增了观察者只读动作 `control_center.tasks.review`（变更 `eikona-control-center-review-observation-v1`），控制中心需要消费它。

## What Changes
- 新增读取器：通过任务自己的 Eikona 任务连接（观察者 Key）调用 `control_center.tasks.review`，校验模式、任务引用与计数，按范围、连接和任务缓存 30 秒。
- 新增只读路由 `GET /task-reviews?scope&task_key=…`，一次最多 10 个已签名的任务键。
- 制作线画面站：Eikona 回答了的任务，按它的决定判断是否待挑选（有候选且还没有决定才算）；已经有决定的不再算待挑选，即使任务状态还是 `waiting_review`；没回答的任务仍按任务状态。卡片和站点详情多一行「Eikona 审阅记录」。
- 剧集工作室只为画面站显示的任务（待挑选的和结果背后的）发起读取；`GET /production` 用同一规则。
- 任务详情：Eikona 运行显示只读的「Eikona 审阅记录」（决定、候选数、待挑选、已决定、下游接收、决定时间），不显示审阅人和理由，也没有任何操作按钮。
- owner 没有这个动作（`UNKNOWN_ACTION`）或拒绝它时显示「待接通」；这次拒绝 MUST NOT 让同一连接的任务读取被判成未授权。

## Capabilities
### New Capabilities
- task-review-observation: 控制中心只读消费 Eikona 的任务审阅记录。

## Impact
- 只读；不新增凭据、不复用 Agent 管理 Key、不写 owner、不部署。审阅决定仍只在 Eikona 里做；`server/actions.ts` 的 review.* 仍是 `needs_contract`。
- 部署版 Eikona 还没有这个动作，真实环境里会显示「审阅状态待接通」，画面站继续按任务状态判断。
- 不包含：Sonora / Scaena 的审阅记录、从控制中心做审阅决定、候选级别的明细。
