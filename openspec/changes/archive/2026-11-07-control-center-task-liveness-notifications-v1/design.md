# 设计

## 任务 freshness

`state`、`native_state`、revision 和结果来自 owner。控制中心只增加 `control_center_freshness` 与 reason：活动状态按最后有效 owner 时间计算，终态不计算，缺时间或本次读取失败为 `unknown`。过期不自动取消、重试、删除或改写为 owner `unknown`。

## 通知

失败和本地 liveness 通知都保存 task identity、当前 signed task key、revision 和 `/tasks?task=<key>`。liveness 使用 `category=operation`、`task_liveness_stale|task_liveness_expired`，owner 状态仍为 running/queued。owner 重新报告新鲜状态后恢复该提醒。通知点击后任务页调用已有 task detail 合同，成功即打开 Inspector，失败保留可重试深链。

## 提示词整理

`PromptSource.history_state` 区分 `complete`、`incomplete`、`unknown`、`needs_contract`。页面按 owner 展示 retry，`source_not_configured` 保持合同缺口，不循环请求。

## 指南

公开命令先执行 `export YEISME_CONTROL_ORIGIN='<控制中心地址>'`，后续 curl 通过 `$YEISME_CONTROL_ORIGIN` 构造 URL 和 Origin。真实地址、凭据、token 不写入源码或证据。
